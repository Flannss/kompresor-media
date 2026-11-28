import type {
  AudioCodec,
  AudioSample as MediabunnyAudioSample,
  VideoCodec,
  VideoSample as MediabunnyVideoSample,
} from 'mediabunny';
import type {
  SubtitleCue,
  VideoEditState,
  VideoProcessProgress,
  VideoProcessRequest,
} from '../contracts';
import { releaseCanvasSurface } from '../image/pipelineRunner';
import {
  compute1080pTargetDimensions,
  getCssPreviewFilter,
  resolveGradeAndEnhanceCoefficients,
} from '../shared/colorGrades';
import { drawHardsubCuesOnCanvas, findActiveCuesAtTime } from './subtitleParser';
import { VideoCancelledError } from './videoErrors';
import {
  getEffectiveAudioBitrateKbps,
  getVideoFormatMeta,
  isAudioMuted,
} from './videoFilterGraph';
import {
  buildVideoExportFileName,
  clampTrimRange,
  computeVideoTargetDimensions,
  resolveEffectiveVideoBitrateBps,
} from './videoPresets';

export class VideoFallbackRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoFallbackRequiredError';
  }
}

export const DEFAULT_WEBCODECS_STALL_MS = 15_000;
export const MIN_VFR_FRAME_DURATION_US = 8_000;
export const MAX_VFR_FRAME_DURATION_US = 100_000;

/**
 * Normalizes VFR / smartphone frame timestamps to strictly increasing microseconds so
 * WebCodecs VideoEncoder & MP4/MOV muxers never deadlock on duplicate/zero PTS deltas.
 */
export function normalizeMonotonicTimestampUs(rawTsUs: number, lastTsUs: number): number {
  const safeRaw = Number.isFinite(rawTsUs) ? Math.max(0, Math.round(rawTsUs)) : 0;
  return lastTsUs < 0 ? safeRaw : Math.max(lastTsUs + 1, safeRaw);
}

async function runWithStallWatchdog<T>(params: {
  promise: Promise<T>;
  stallTimeoutMs: number;
  getLastActivityAt: () => number;
  onStall: () => void;
  onAbortCleanup?: () => void;
  signal?: AbortSignal;
  stallMessage: string;
}): Promise<T> {
  const { promise, stallTimeoutMs, getLastActivityAt, onStall, onAbortCleanup, signal, stallMessage } =
    params;

  if (signal?.aborted) {
    onAbortCleanup?.();
    throw new VideoCancelledError();
  }

  let pollId: ReturnType<typeof setInterval> | null = null;
  let onAbort: (() => void) | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => {
          onAbortCleanup?.();
          reject(new VideoCancelledError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        const checkIntervalMs = Math.min(500, Math.max(25, Math.floor(stallTimeoutMs / 4)));
        pollId = setInterval(() => {
          if (signal?.aborted) return;
          if (Date.now() - getLastActivityAt() >= stallTimeoutMs) {
            onStall();
            reject(new VideoFallbackRequiredError(stallMessage));
          }
        }, checkIntervalMs);
      }),
    ]);
  } finally {
    if (pollId !== null) {
      clearInterval(pollId);
    }
    if (onAbort) {
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

export interface WebCodecsTranscodeOutput {
  outputBlob: Blob;
  outputFileName: string;
  outputWidth: number;
  outputHeight: number;
  durationSec: number;
  engineDetail?: string;
}

const BT709_COLOR_SPACE: VideoColorSpaceInit = {
  primaries: 'bt709',
  transfer: 'bt709',
  matrix: 'bt709',
  fullRange: false,
};

const HARDWARE_H264_CODEC_CANDIDATES = [
  'avc1.640028',
  'avc1.4D002A',
  'avc1.42E028',
] as const;

/**
 * Resolves calibrated social-HD, Vlog HD (8.5 Mbps), and Long-Form bitrates
 * for Hardware WebCodecs & MediaRecorder video exports.
 */
export function resolveHardwareVideoBitrateBps(edit: VideoEditState): number {
  return resolveEffectiveVideoBitrateBps(edit);
}

/**
 * Builds a WebCodecs VideoEncoderConfig prioritizing smooth motion & quality cadence over
 * frame-dropping realtime shortcuts.
 */
export function buildHardwareH264EncoderConfig(params: {
  codec: string;
  width: number;
  height: number;
  bitrate: number;
  framerate?: number;
}): VideoEncoderConfig {
  return {
    codec: params.codec,
    width: params.width,
    height: params.height,
    bitrate: params.bitrate,
    framerate: params.framerate ?? 30,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'quality',
    avc: { format: 'avc' },
  };
}

/**
 * Probes WebCodecs hardware H.264 encoder profiles in preference order (High -> Main -> Baseline).
 */
export async function probeHardwareH264Codec(params: {
  width: number;
  height: number;
  bitrate: number;
  framerate?: number;
}): Promise<string | null> {
  if (
    typeof VideoEncoder === 'undefined' ||
    typeof VideoEncoder.isConfigSupported !== 'function'
  ) {
    return null;
  }

  for (const codec of HARDWARE_H264_CODEC_CANDIDATES) {
    try {
      const support = await VideoEncoder.isConfigSupported(
        buildHardwareH264EncoderConfig({
          codec,
          width: params.width,
          height: params.height,
          bitrate: params.bitrate,
          framerate: params.framerate,
        })
      );
      if (support.supported) {
        return support.config?.codec ?? codec;
      }
    } catch {
      // Try next H.264 profile candidate cleanly
    }
  }
  return null;
}

export interface ResolvedGpuVisualParams {
  contrastMul: number;
  brightnessAdd: number;
  saturationMul: number;
  invGamma: number;
  monoBlend: number;
  blackLift: number;
  shadows: [number, number, number];
  midtones: [number, number, number];
  highlights: [number, number, number];
  sharpenAmount: number;
  cssFilter: string;
}

export function resolveGpuVisualParams(edit: VideoEditState): ResolvedGpuVisualParams {
  const c = resolveGradeAndEnhanceCoefficients(
    edit.colorGrade,
    edit.enhanceSuite.colorContrast.enabled ? edit.enhanceSuite.colorContrast : undefined
  );
  const clarityModel = edit.clarityModel ?? 'original';
  const clarityScale = Math.min(1, Math.max(0, (edit.clarityStrength ?? 80) / 100));

  let contrastMul = c.contrastMul;
  let saturationMul = c.saturationMul;
  let gammaExp = c.gammaExp;

  if (clarityScale > 0.01) {
    if (clarityModel === 'sharp-1080p') {
      contrastMul *= 1 + 0.04 * clarityScale;
      saturationMul *= 1 + 0.05 * clarityScale;
    } else if (clarityModel === 'low-light') {
      gammaExp *= 1 + 0.08 * clarityScale;
      contrastMul *= 1 + 0.03 * clarityScale;
      saturationMul *= 1 + 0.04 * clarityScale;
    }
  }

  let sharpenAmount = 0;
  if (edit.enhanceSuite.sharpen.enabled) {
    sharpenAmount = Math.min(1.2, Math.max(0.15, edit.enhanceSuite.sharpen.strength * 0.65));
  } else if (clarityScale > 0.01) {
    if (clarityModel === 'natural-hd') sharpenAmount = 0.34 * clarityScale;
    else if (clarityModel === 'sharp-1080p') sharpenAmount = 0.58 * clarityScale;
    else if (clarityModel === 'low-light') sharpenAmount = 0.26 * clarityScale;
  }

  const baseCss = getCssPreviewFilter(
    edit.colorGrade,
    edit.enhanceSuite.colorContrast.enabled ? edit.enhanceSuite.colorContrast : undefined
  );
  const cssParts = baseCss !== 'none' ? [baseCss] : [];
  if (clarityScale > 0.01 && clarityModel === 'sharp-1080p') {
    cssParts.push(
      `contrast(${(1 + 0.04 * clarityScale).toFixed(3)}) saturate(${(1 + 0.05 * clarityScale).toFixed(3)})`
    );
  } else if (clarityScale > 0.01 && clarityModel === 'low-light') {
    cssParts.push(
      `brightness(${(1 + 0.04 * clarityScale).toFixed(3)}) contrast(${(1 + 0.03 * clarityScale).toFixed(3)})`
    );
  }

  return {
    contrastMul,
    brightnessAdd: c.brightnessAdd,
    saturationMul,
    invGamma: 1 / Math.max(0.5, gammaExp),
    monoBlend: c.monoBlend,
    blackLift: c.blackLift,
    shadows: [c.rs, c.gs, c.bs],
    midtones: [c.rm, c.gm, c.bm],
    highlights: [c.rh, c.gh, c.bh],
    sharpenAmount,
    cssFilter: cssParts.length > 0 ? cssParts.join(' ') : 'none',
  };
}

function createCanvasSurface(
  width: number,
  height: number,
  preferDomCanvas = false
): OffscreenCanvas | HTMLCanvasElement {
  if (!preferDomCanvas && typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function computeDrawRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  coverFit: boolean
): { dx: number; dy: number; dw: number; dh: number } {
  const safeSrcW = Math.max(1, srcW);
  const safeSrcH = Math.max(1, srcH);
  const scale = coverFit
    ? Math.max(dstW / safeSrcW, dstH / safeSrcH)
    : Math.min(dstW / safeSrcW, dstH / safeSrcH);
  const dw = safeSrcW * scale;
  const dh = safeSrcH * scale;
  return {
    dx: (dstW - dw) / 2,
    dy: (dstH - dh) / 2,
    dw,
    dh,
  };
}

const VERTEX_SHADER_SRC = `
attribute vec2 aPos;
attribute vec2 aUv;
uniform vec2 uUvScale;
uniform vec2 uUvOffset;
varying vec2 vUv;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vUv = (aUv - 0.5) * uUvScale + 0.5 + uUvOffset;
}
`;

const FRAGMENT_SHADER_SRC = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uTexelSize;
uniform float uSharpen;
uniform float uContrast;
uniform float uBrightness;
uniform float uSaturation;
uniform float uInvGamma;
uniform float uMonoBlend;
uniform float uBlackLift;
uniform vec3 uShadows;
uniform vec3 uMidtones;
uniform vec3 uHighlights;
varying vec2 vUv;

float calcLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 col = texture2D(uTex, vUv).rgb;

  if (uSharpen > 0.005) {
    float cL = calcLuma(col);
    float n1 = calcLuma(texture2D(uTex, clamp(vUv + vec2(uTexelSize.x, 0.0), 0.0, 1.0)).rgb);
    float n2 = calcLuma(texture2D(uTex, clamp(vUv - vec2(uTexelSize.x, 0.0), 0.0, 1.0)).rgb);
    float n3 = calcLuma(texture2D(uTex, clamp(vUv + vec2(0.0, uTexelSize.y), 0.0, 1.0)).rgb);
    float n4 = calcLuma(texture2D(uTex, clamp(vUv - vec2(0.0, uTexelSize.y), 0.0, 1.0)).rgb);
    float detail = (cL - 0.25 * (n1 + n2 + n3 + n4)) * uSharpen * 1.45;
    float antiHalo = detail / (1.0 + abs(detail) * 3.0);
    col = clamp(col + antiHalo, 0.0, 1.0);
  }

  if (uMonoBlend > 0.005) {
    float gray = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(gray), uMonoBlend);
  }

  if (abs(uSaturation - 1.0) > 0.005) {
    float l = calcLuma(col);
    col = mix(vec3(l), col, uSaturation);
  }

  col = (col + uBrightness - 0.5) * uContrast + 0.5;
  float lNorm = clamp(calcLuma(col), 0.0, 1.0);
  float sw = max(0.0, 1.0 - lNorm * 2.0);
  float hw = max(0.0, lNorm * 2.0 - 1.0);
  float mw = 1.0 - abs(lNorm * 2.0 - 1.0);
  col += (uShadows * sw + uMidtones * mw + uHighlights * hw) * 0.647;

  if (uBlackLift > 0.002) {
    col = uBlackLift + col * (1.0 - uBlackLift * 1.4);
  }

  col = pow(clamp(col, 0.0, 1.0), vec3(uInvGamma));
  gl_FragColor = vec4(col, 1.0);
}
`;

interface WebGlPipelineHandle {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  tex: WebGLTexture;
  vbo: WebGLBuffer;
  uTexelSize: WebGLUniformLocation | null;
  uUvScale: WebGLUniformLocation | null;
  uUvOffset: WebGLUniformLocation | null;
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createWebGlVideoPipeline(
  width: number,
  height: number,
  params: ResolvedGpuVisualParams
): WebGlPipelineHandle | null {
  const attrs: WebGLContextAttributes = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  };
  let canvas = createCanvasSurface(width, height);
  let gl =
    (canvas.getContext('webgl2', attrs) as WebGLRenderingContext | null) ??
    (canvas.getContext('webgl', attrs) as WebGLRenderingContext | null);

  // Safari iOS 16 exposes OffscreenCanvas without WebGL; retry with DOM <canvas> before 2D fallback
  if (!gl && typeof document !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    releaseCanvasSurface(canvas);
    canvas = createCanvasSurface(width, height, true);
    gl =
      (canvas.getContext('webgl2', attrs) as WebGLRenderingContext | null) ??
      (canvas.getContext('webgl', attrs) as WebGLRenderingContext | null);
  }

  if (!gl) {
    releaseCanvasSurface(canvas);
    return null;
  }

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    releaseCanvasSurface(canvas);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    releaseCanvasSurface(canvas);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    releaseCanvasSurface(canvas);
    return null;
  }

  const vbo = gl.createBuffer();
  const tex = gl.createTexture();
  if (!vbo || !tex) {
    if (vbo) gl.deleteBuffer(vbo);
    if (tex) gl.deleteTexture(tex);
    gl.deleteProgram(program);
    releaseCanvasSurface(canvas);
    return null;
  }

  gl.useProgram(program);
  gl.viewport(0, 0, width, height);

  // Fullscreen quad: posX, posY, u, v (flip Y so canvas top-left matches UV)
  const quad = new Float32Array([
    -1, -1, 0, 1,
     1, -1, 1, 1,
    -1,  1, 0, 0,
     1,  1, 1, 0,
  ]);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  const posLoc = gl.getAttribLocation(program, 'aPos');
  const uvLoc = gl.getAttribLocation(program, 'aUv');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(uvLoc);
  gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0);
  gl.uniform1f(gl.getUniformLocation(program, 'uSharpen'), params.sharpenAmount);
  gl.uniform1f(gl.getUniformLocation(program, 'uContrast'), params.contrastMul);
  gl.uniform1f(gl.getUniformLocation(program, 'uBrightness'), params.brightnessAdd);
  gl.uniform1f(gl.getUniformLocation(program, 'uSaturation'), params.saturationMul);
  gl.uniform1f(gl.getUniformLocation(program, 'uInvGamma'), params.invGamma);
  gl.uniform1f(gl.getUniformLocation(program, 'uMonoBlend'), params.monoBlend);
  gl.uniform1f(gl.getUniformLocation(program, 'uBlackLift'), params.blackLift);
  gl.uniform3fv(gl.getUniformLocation(program, 'uShadows'), params.shadows);
  gl.uniform3fv(gl.getUniformLocation(program, 'uMidtones'), params.midtones);
  gl.uniform3fv(gl.getUniformLocation(program, 'uHighlights'), params.highlights);

  return {
    canvas,
    gl,
    program,
    tex,
    vbo,
    uTexelSize: gl.getUniformLocation(program, 'uTexelSize'),
    uUvScale: gl.getUniformLocation(program, 'uUvScale'),
    uUvOffset: gl.getUniformLocation(program, 'uUvOffset'),
  };
}

export interface ScheduledFrameSlot {
  frameIndex: number;
  outTimestampUs: number;
  outDurationUs: number;
  isKeyFrame: boolean;
}

/**
 * Generates uniform CFR frame timestamps & 2-second keyframe cadence without drift or 1us glitches.
 */
export function buildCfrFrameSchedule(params: {
  totalFrames: number;
  targetFps: number;
  keyframeIntervalSec?: number;
}): ScheduledFrameSlot[] {
  const totalFrames = Math.max(0, Math.floor(params.totalFrames));
  const targetFps = Math.max(1, params.targetFps);
  const keyIntervalFrames = Math.max(
    1,
    Math.round((params.keyframeIntervalSec ?? 2) * targetFps)
  );
  const slots: ScheduledFrameSlot[] = [];
  for (let i = 0; i < totalFrames; i += 1) {
    const outTimestampUs = Math.round((i * 1_000_000) / targetFps);
    const nextTimestampUs = Math.round(((i + 1) * 1_000_000) / targetFps);
    slots.push({
      frameIndex: i,
      outTimestampUs,
      outDurationUs: Math.max(1, nextTimestampUs - outTimestampUs),
      isKeyFrame: i % keyIntervalFrames === 0,
    });
  }
  return slots;
}

/**
 * Normalizes VFR / "Asli" frame timings using 1-frame lookahead while keeping every
 * frame duration clamped to [MIN_VFR_FRAME_DURATION_US, MAX_VFR_FRAME_DURATION_US].
 */
export function normalizeVfrFrameTimingsUs(params: {
  rawTimestampsUs: number[];
  rawDurationsUs?: number[];
  fallbackFps?: number;
}): Array<{ outTimestampUs: number; outDurationUs: number }> {
  const { rawTimestampsUs, rawDurationsUs, fallbackFps = 30 } = params;
  if (rawTimestampsUs.length === 0) return [];
  const defaultDurUs = Math.min(
    MAX_VFR_FRAME_DURATION_US,
    Math.max(MIN_VFR_FRAME_DURATION_US, Math.round(1_000_000 / Math.max(1, fallbackFps)))
  );
  const baseRawUs = Number.isFinite(rawTimestampsUs[0]) ? Math.round(rawTimestampsUs[0]) : 0;
  const startOffsetsUs: number[] = [];
  for (let i = 0; i < rawTimestampsUs.length; i += 1) {
    const raw = Number.isFinite(rawTimestampsUs[i])
      ? Math.max(0, Math.round(rawTimestampsUs[i] - baseRawUs))
      : 0;
    if (i === 0) {
      startOffsetsUs.push(0);
    } else {
      startOffsetsUs.push(Math.max(startOffsetsUs[i - 1] + MIN_VFR_FRAME_DURATION_US, raw));
    }
  }
  return startOffsetsUs.map((outTimestampUs, i) => {
    const explicitDur = rawDurationsUs?.[i];
    const rawDeltaUs =
      i + 1 < startOffsetsUs.length
        ? startOffsetsUs[i + 1] - outTimestampUs
        : explicitDur !== undefined && Number.isFinite(explicitDur) && explicitDur > 0
          ? Math.round(explicitDur)
          : defaultDurUs;
    const outDurationUs = Math.min(
      MAX_VFR_FRAME_DURATION_US,
      Math.max(MIN_VFR_FRAME_DURATION_US, rawDeltaUs)
    );
    return { outTimestampUs, outDurationUs };
  });
}

function createGpuVideoFrameRenderer(params: {
  VideoSampleCtor: typeof MediabunnyVideoSample;
  edit: VideoEditState;
  width: number;
  height: number;
  cues: SubtitleCue[];
  useHardsub: boolean;
}): {
  render: (
    sample: MediabunnyVideoSample,
    outTimestampSec: number,
    outDurationSec: number
  ) => MediabunnyVideoSample;
  getEngineModeLabel: () => string;
  dispose: () => void;
} {
  const { VideoSampleCtor, edit, width, height, cues, useHardsub } = params;
  const visual = resolveGpuVisualParams(edit);
  const coverFit = edit.enhanceSuite.upscale1080.enabled && !edit.enhanceSuite.upscale1080.keepAspect;

  let glHandle: WebGlPipelineHandle | null = useHardsub
    ? null
    : createWebGlVideoPipeline(width, height, visual);
  let fallbackCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  let fallbackCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  let usedWebGl = false;
  let used2dCanvas = false;

  const ensure2dContext = () => {
    if (!fallbackCanvas) {
      let surface = createCanvasSurface(width, height);
      let ctx = surface.getContext('2d') as
        | OffscreenCanvasRenderingContext2D
        | CanvasRenderingContext2D
        | null;
      if (!ctx && typeof document !== 'undefined') {
        releaseCanvasSurface(surface);
        surface = createCanvasSurface(width, height, true);
        ctx = surface.getContext('2d');
      }
      if (!ctx) {
        releaseCanvasSurface(surface);
        throw new VideoFallbackRequiredError('Kanvas GPU 2D tidak tersedia untuk memproses frame video.');
      }
      fallbackCanvas = surface;
      fallbackCtx = ctx;
      fallbackCtx.imageSmoothingEnabled = true;
      fallbackCtx.imageSmoothingQuality = 'high';
    }
    return { canvas: fallbackCanvas, ctx: fallbackCtx! };
  };

  return {
    getEngineModeLabel: () =>
      usedWebGl && !used2dCanvas ? 'WebGL GPU' : glHandle ? 'WebGL GPU' : 'Canvas GPU',

    render: (sample, outTimestampSec, outDurationSec) => {
      if (!useHardsub && glHandle && sample.rotation === 0 && !sample.flip) {
        const vf = sample.toVideoFrame();
        try {
          const { gl, canvas, uTexelSize, uUvScale, uUvOffset, tex } = glHandle;
          const srcW = Math.max(1, sample.displayWidth || vf.displayWidth || vf.codedWidth);
          const srcH = Math.max(1, sample.displayHeight || vf.displayHeight || vf.codedHeight);
          const rect = computeDrawRect(srcW, srcH, width, height, coverFit);
          const uvScaleX = width / Math.max(1, rect.dw);
          const uvScaleY = height / Math.max(1, rect.dh);

          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vf);
          if (uTexelSize) gl.uniform2f(uTexelSize, 1 / srcW, 1 / srcH);
          if (uUvScale) gl.uniform2f(uUvScale, uvScaleX, uvScaleY);
          if (uUvOffset) gl.uniform2f(uUvOffset, 0, 0);

          gl.clearColor(0, 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          usedWebGl = true;
          return new VideoSampleCtor(canvas, {
            timestamp: outTimestampSec,
            duration: outDurationSec,
            colorSpace: BT709_COLOR_SPACE,
          });
        } catch {
          const g = glHandle;
          glHandle = null;
          if (g) {
            g.gl.deleteTexture(g.tex);
            g.gl.deleteBuffer(g.vbo);
            g.gl.deleteProgram(g.program);
            releaseCanvasSurface(g.canvas);
          }
        } finally {
          vf.close();
        }
      }

      used2dCanvas = true;
      const { canvas, ctx } = ensure2dContext();
      const srcW = Math.max(1, sample.displayWidth);
      const srcH = Math.max(1, sample.displayHeight);
      const rect = computeDrawRect(srcW, srcH, width, height, coverFit);

      ctx.save();
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      if ('filter' in ctx) {
        (ctx as CanvasRenderingContext2D).filter = visual.cssFilter;
      }
      sample.draw(ctx, rect.dx, rect.dy, rect.dw, rect.dh);
      ctx.restore();

      if (useHardsub) {
        const active = findActiveCuesAtTime(cues, outTimestampSec);
        if (active.length > 0) {
          drawHardsubCuesOnCanvas(ctx, width, height, active, edit.subtitle.size, edit.subtitle.position);
        }
      }

      return new VideoSampleCtor(canvas, {
        timestamp: outTimestampSec,
        duration: outDurationSec,
        colorSpace: BT709_COLOR_SPACE,
      });
    },

    dispose: () => {
      if (glHandle) {
        try {
          glHandle.gl.deleteTexture(glHandle.tex);
          glHandle.gl.deleteBuffer(glHandle.vbo);
          glHandle.gl.deleteProgram(glHandle.program);
        } catch {
          // Ignore GL teardown failures on context loss
        }
        releaseCanvasSurface(glHandle.canvas);
        glHandle = null;
      }
      if (fallbackCanvas) {
        releaseCanvasSurface(fallbackCanvas);
        fallbackCanvas = null;
        fallbackCtx = null;
      }
    },
  };
}

export async function runWebCodecsVideoTranscode(
  request: VideoProcessRequest,
  onProgress: (progress: VideoProcessProgress) => void,
  signal?: AbortSignal,
  cuesAlreadyTrimmed = false,
  options?: { stallTimeoutMs?: number }
): Promise<WebCodecsTranscodeOutput> {
  if (signal?.aborted) {
    throw new VideoCancelledError();
  }

  if (
    typeof VideoDecoder === 'undefined' ||
    typeof VideoEncoder === 'undefined' ||
    typeof VideoFrame === 'undefined'
  ) {
    throw new VideoFallbackRequiredError(
      'Browser tidak mendukung WebCodecs VideoDecoder/Encoder.'
    );
  }

  const t0 = performance.now();
  const { file, sourceMetadata, edit, requestId } = request;
  const formatMeta = getVideoFormatMeta(edit.outputFormat);

  onProgress({
    requestId,
    backend: 'webcodecs-mediabunny',
    stage: 'probing',
    ratio: 0.03,
    elapsedMs: 0,
    detail: 'Memeriksa akselerasi hardware GPU perangkat…',
  });

  const mediabunny = await import('mediabunny');
  if (signal?.aborted) {
    throw new VideoCancelledError();
  }

  const {
    ALL_FORMATS,
    AudioSampleSink,
    AudioSampleSource,
    BlobSource,
    BufferTarget,
    ConversionCanceledError,
    Input,
    MkvOutputFormat,
    MovOutputFormat,
    Mp4OutputFormat,
    Output,
    Quality,
    VideoSample,
    VideoSampleSink,
    VideoSampleSource,
    WebMOutputFormat,
    canEncodeAudio,
    canEncodeVideo,
  } = mediabunny;

  const targetDims = edit.enhanceSuite.upscale1080.enabled
    ? compute1080pTargetDimensions(
        sourceMetadata.width,
        sourceMetadata.height,
        edit.enhanceSuite.upscale1080.keepAspect
      )
    : computeVideoTargetDimensions(
        sourceMetadata.width,
        sourceMetadata.height,
        edit.targetResolution ?? 'original',
        edit.maxHeightPx
      );

  const hardwareBitrateBps = resolveHardwareVideoBitrateBps(edit);
  const effectiveFps = edit.fpsCap && edit.fpsCap > 0 ? Math.min(60, edit.fpsCap) : undefined;
  const videoQuality = new Quality({
    bitrate: hardwareBitrateBps,
    bitrateMode: 'variable',
  });

  let selectedVideoCodec: VideoCodec;
  let selectedAudioCodec: AudioCodec;
  let probedH264Codec: string | null = null;

  if (edit.outputFormat === 'webm') {
    const canVp9 = await canEncodeVideo('vp9', {
      width: targetDims.width,
      height: targetDims.height,
      quality: videoQuality,
    });
    if (canVp9) {
      selectedVideoCodec = 'vp9';
    } else {
      const canVp8 = await canEncodeVideo('vp8', {
        width: targetDims.width,
        height: targetDims.height,
        quality: videoQuality,
      });
      if (!canVp8) {
        throw new VideoFallbackRequiredError('Encoder WebM (VP9/VP8) tidak tersedia di WebCodecs.');
      }
      selectedVideoCodec = 'vp8';
    }
    selectedAudioCodec = 'opus';
  } else {
    probedH264Codec = await probeHardwareH264Codec({
      width: targetDims.width,
      height: targetDims.height,
      bitrate: hardwareBitrateBps,
      framerate: effectiveFps ?? 30,
    });
    if (!probedH264Codec) {
      throw new VideoFallbackRequiredError(
        'Encoder hardware H.264 WebCodecs tidak tersedia — beralih ke mode CPU optimal.'
      );
    }
    selectedVideoCodec = 'avc';
    selectedAudioCodec = 'aac';
  }

  if (signal?.aborted) {
    throw new VideoCancelledError();
  }

  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });
  const stallTimeoutMs = options?.stallTimeoutMs ?? DEFAULT_WEBCODECS_STALL_MS;
  let lastActivityAt = Date.now();
  const touchActivity = () => {
    lastActivityAt = Date.now();
  };

  try {
    onProgress({
      requestId,
      backend: 'webcodecs-mediabunny',
      stage: 'demuxing',
      ratio: 0.04,
      elapsedMs: performance.now() - t0,
      detail: 'Membaca video & trek audio…',
    });

    const primaryVideo = await runWithStallWatchdog({
      promise: input.getPrimaryVideoTrack(),
      stallTimeoutMs,
      getLastActivityAt: () => lastActivityAt,
      onStall: () => input.dispose(),
      signal,
      stallMessage: 'Pembacaan trek video WebCodecs terlalu lama — beralih ke mode berikutnya.',
    });
    touchActivity();

    if (!primaryVideo) {
      throw new VideoFallbackRequiredError('Trek video tidak terbaca oleh demuxer WebCodecs.');
    }

    const muted = isAudioMuted(edit);
    const audioBitrateBps = Math.min(160_000, Math.max(96_000, getEffectiveAudioBitrateKbps(edit) * 1000));
    const audioQuality = new Quality({
      bitrate: audioBitrateBps,
      bitrateMode: 'variable',
    });
    const primaryAudio = await input.getPrimaryAudioTrack().catch(() => null);
    let discardAudio = muted || !primaryAudio;
    let audioTransform: { numberOfChannels?: number; sampleRate?: number } | undefined;

    if (!discardAudio && primaryAudio) {
      const channels = await primaryAudio.getNumberOfChannels().catch(() => 0);
      const sampleRate = await primaryAudio.getSampleRate().catch(() => 48_000);
      const decodable = await primaryAudio.canDecode().catch(() => false);
      if (channels <= 0 || !decodable) {
        discardAudio = true;
      } else {
        const canDirect = await canEncodeAudio(selectedAudioCodec, {
          numberOfChannels: channels,
          sampleRate,
          quality: audioQuality,
        }).catch(() => false);
        if (!canDirect) {
          const canStereo48k = await canEncodeAudio(selectedAudioCodec, {
            numberOfChannels: 2,
            sampleRate: 48_000,
            quality: audioQuality,
          }).catch(() => false);
          if (!canStereo48k) {
            throw new VideoFallbackRequiredError(
              `Encoder audio ${selectedAudioCodec.toUpperCase()} tidak tersedia.`
            );
          }
          audioTransform = { numberOfChannels: 2, sampleRate: 48_000 };
        }
      }
    }

    const trim = clampTrimRange(edit.trimStartSec, edit.trimEndSec, sourceMetadata.durationSec);
    const target = new BufferTarget();

    const outputFormatObj =
      edit.outputFormat === 'webm'
        ? new WebMOutputFormat()
        : edit.outputFormat === 'mov'
          ? new MovOutputFormat({ fastStart: 'in-memory' })
          : edit.outputFormat === 'mkv'
            ? new MkvOutputFormat()
            : new Mp4OutputFormat({ fastStart: 'in-memory' });

    const output = new Output({
      format: outputFormatObj,
      target,
    });

    const useHardsub =
      edit.subtitle.enabled &&
      edit.subtitle.mode === 'hardsub' &&
      edit.subtitle.cues.length > 0;

    let shiftedCues = edit.subtitle.cues;
    if (useHardsub && !cuesAlreadyTrimmed && trim.isTrimmed) {
      const { adjustCuesForTrim } = await import('./subtitleParser');
      shiftedCues = adjustCuesForTrim(edit.subtitle.cues, trim.startSec, trim.endSec);
    }

    const gpuRenderer = createGpuVideoFrameRenderer({
      VideoSampleCtor: VideoSample,
      edit,
      width: targetDims.width,
      height: targetDims.height,
      cues: shiftedCues,
      useHardsub,
    });

    const coverFit =
      edit.enhanceSuite.upscale1080.enabled && !edit.enhanceSuite.upscale1080.keepAspect;

    const videoSource = new VideoSampleSource({
      codec: selectedVideoCodec,
      ...(probedH264Codec ? { fullCodecString: probedH264Codec } : {}),
      quality: videoQuality,
      latencyMode: 'quality',
      hardwareAcceleration: 'prefer-hardware',
      keyFrameInterval: 2,
      sizeChangeBehavior: coverFit ? 'cover' : 'contain',
      onEncoderConfig: (cfg) => {
        cfg.latencyMode = 'quality';
        if (effectiveFps) {
          cfg.framerate = effectiveFps;
        }
      },
    });
    output.addVideoTrack(
      videoSource,
      effectiveFps ? { frameRate: effectiveFps } : undefined
    );

    const audioSource =
      !discardAudio && primaryAudio
        ? new AudioSampleSource({
            codec: selectedAudioCodec,
            quality: audioQuality,
            ...(audioTransform ? { transform: audioTransform } : {}),
          })
        : null;
    if (audioSource) {
      output.addAudioTrack(audioSource);
    }

    let stopped = false;
    let emittedVideoFrames = 0;
    let lastProgressRatio = 0;
    const totalExpectedDurationSec = Math.max(0.05, trim.durationSec || sourceMetadata.durationSec || 1);

    const emitTranscodeProgress = (currentTimeSec: number) => {
      if (signal?.aborted || stopped) return;
      const ratio = Math.min(0.97, Math.max(0.06, 0.06 + (currentTimeSec / totalExpectedDurationSec) * 0.91));
      if (ratio - lastProgressRatio < 0.01 && ratio < 0.96) {
        return;
      }
      lastProgressRatio = ratio;
      onProgress({
        requestId,
        backend: 'webcodecs-mediabunny',
        stage: 'transcoding',
        ratio,
        elapsedMs: performance.now() - t0,
        detail: useHardsub
          ? 'Merender subtitle dengan akselerasi hardware GPU…'
          : 'Menyandikan video HD via akselerasi hardware GPU…',
      });
    };

    const sinkStartSec = trim.isTrimmed ? trim.startSec : 0;
    const sinkEndSec = trim.isTrimmed ? trim.endSec : Number.POSITIVE_INFINITY;
    const clipDurationUs = trim.isTrimmed
      ? Math.max(MIN_VFR_FRAME_DURATION_US, Math.round(trim.durationSec * 1_000_000))
      : Number.POSITIVE_INFINITY;

    const pumpVideo = async () => {
      const videoSink = new VideoSampleSink(primaryVideo, {
        hardwareAcceleration: 'prefer-hardware',
      });
      const sampleIter = videoSink.samples(sinkStartSec, sinkEndSec);
      const slotTsUs = (slotIdx: number) =>
        effectiveFps ? Math.round((slotIdx * 1_000_000) / effectiveFps) : 0;
      const keyIntervalFrames = effectiveFps ? Math.max(1, Math.round(effectiveFps * 2)) : 60;

      let cfrSlotIdx = 0;
      let nextVfrStartUs = 0;
      let lastVfrKeyTsUs = -1;
      let heldSample: MediabunnyVideoSample | null = null;

      const emitFrame = async (
        srcSample: MediabunnyVideoSample,
        outTimestampUs: number,
        outDurationUs: number,
        isKeyFrame: boolean
      ) => {
        touchActivity();
        const outTimestampSec = outTimestampUs / 1_000_000;
        const outDurationSec = Math.max(MIN_VFR_FRAME_DURATION_US / 1_000_000, outDurationUs / 1_000_000);
        const renderedSample = gpuRenderer.render(srcSample, outTimestampSec, outDurationSec);
        try {
          await videoSource.add(renderedSample, { keyFrame: isKeyFrame });
          emittedVideoFrames += 1;
          touchActivity();
          emitTranscodeProgress(outTimestampSec + outDurationSec);
        } finally {
          renderedSample.close();
        }
      };

      const pullNextValidSample = async (): Promise<MediabunnyVideoSample | null> => {
        while (!signal?.aborted && !stopped) {
          const step = await sampleIter.next();
          if (step.done) return null;
          const candidate = step.value;
          const candidateEnd = candidate.timestamp + Math.max(0, candidate.duration);
          if (trim.isTrimmed && candidateEnd <= sinkStartSec && candidate.duration > 0) {
            candidate.close();
            continue;
          }
          if (trim.isTrimmed && candidate.timestamp >= sinkEndSec) {
            candidate.close();
            return null;
          }
          return candidate;
        }
        return null;
      };

      try {
        heldSample = await pullNextValidSample();
        while (heldSample && !signal?.aborted && !stopped) {
          const nextSample = await pullNextValidSample();
          const currRelUs = Math.max(0, Math.round((heldSample.timestamp - sinkStartSec) * 1_000_000));

          if (effectiveFps) {
            const nextRelUs = nextSample
              ? Math.max(currRelUs + 1, Math.round((nextSample.timestamp - sinkStartSec) * 1_000_000))
              : Number.POSITIVE_INFINITY;
            const midpointUs = nextSample
              ? (currRelUs + nextRelUs) / 2
              : Math.min(
                  clipDurationUs,
                  currRelUs +
                    Math.max(
                      Math.round(1_000_000 / effectiveFps),
                      Math.round((heldSample.duration > 0 ? heldSample.duration : 1 / effectiveFps) * 1_000_000)
                    )
                );

            let emittedForHeld = 0;
            while (!signal?.aborted && !stopped) {
              const gridTsUs = slotTsUs(cfrSlotIdx);
              if (gridTsUs >= clipDurationUs && cfrSlotIdx > 0) break;
              if (nextSample) {
                if (gridTsUs > midpointUs && cfrSlotIdx > 0) break;
              } else if ((gridTsUs >= midpointUs && cfrSlotIdx > 0) || emittedForHeld >= 2) {
                break;
              }
              const nextGridTsUs = slotTsUs(cfrSlotIdx + 1);
              const outDurationUs = Math.max(1, nextGridTsUs - gridTsUs);
              const isKeyFrame = cfrSlotIdx % keyIntervalFrames === 0;
              await emitFrame(heldSample, gridTsUs, outDurationUs, isKeyFrame);
              cfrSlotIdx += 1;
              emittedForHeld += 1;
            }
          } else {
            const outTimestampUs = emittedVideoFrames === 0 ? 0 : Math.max(nextVfrStartUs, currRelUs);
            const fallbackDurUs = Math.min(
              MAX_VFR_FRAME_DURATION_US,
              Math.max(
                MIN_VFR_FRAME_DURATION_US,
                Math.round((heldSample.duration > 0 ? heldSample.duration : 1 / 30) * 1_000_000)
              )
            );
            const nextRawRelUs = nextSample
              ? Math.max(
                  outTimestampUs + MIN_VFR_FRAME_DURATION_US,
                  Math.round((nextSample.timestamp - sinkStartSec) * 1_000_000)
                )
              : outTimestampUs + fallbackDurUs;
            const outDurationUs = Math.min(
              MAX_VFR_FRAME_DURATION_US,
              Math.max(MIN_VFR_FRAME_DURATION_US, nextRawRelUs - outTimestampUs)
            );
            nextVfrStartUs = outTimestampUs + MIN_VFR_FRAME_DURATION_US;
            const isKeyFrame =
              emittedVideoFrames === 0 ||
              lastVfrKeyTsUs < 0 ||
              outTimestampUs - lastVfrKeyTsUs >= 2_000_000;
            if (isKeyFrame) {
              lastVfrKeyTsUs = outTimestampUs;
            }
            await emitFrame(heldSample, outTimestampUs, outDurationUs, isKeyFrame);
          }

          heldSample.close();
          heldSample = nextSample;
        }
      } finally {
        heldSample?.close();
        await sampleIter.return?.().catch(() => {});
        videoSource.close();
      }
    };

    const pumpAudio = async () => {
      if (!audioSource || !primaryAudio) return;
      const audioSink = new AudioSampleSink(primaryAudio);
      const audIter = audioSink.samples(sinkStartSec, sinkEndSec);
      let prevAudioTsSec = -1;

      try {
        while (!signal?.aborted && !stopped) {
          const step = await audIter.next();
          if (step.done) break;
          const rawSample: MediabunnyAudioSample = step.value;
          let trimmedSample: MediabunnyAudioSample = rawSample;
          try {
            touchActivity();
            const sampleStart = rawSample.timestamp;
            const sampleEnd = rawSample.timestamp + rawSample.duration;
            if (trim.isTrimmed && (sampleEnd <= trim.startSec || sampleStart >= trim.endSec)) {
              continue;
            }
            if (trim.isTrimmed) {
              const startFrame =
                sampleStart < trim.startSec
                  ? Math.min(
                      rawSample.numberOfFrames,
                      Math.max(0, Math.round((trim.startSec - sampleStart) * rawSample.sampleRate))
                    )
                  : 0;
              const endFrame =
                sampleEnd > trim.endSec
                  ? Math.max(
                      startFrame,
                      Math.min(
                        rawSample.numberOfFrames,
                        Math.round((trim.endSec - sampleStart) * rawSample.sampleRate)
                      )
                    )
                  : rawSample.numberOfFrames;
              if (endFrame <= startFrame) {
                continue;
              }
              if (startFrame > 0 || endFrame < rawSample.numberOfFrames) {
                trimmedSample = rawSample.trim(startFrame, endFrame);
              }
            }
            const relStartSec = Math.max(0, trimmedSample.timestamp - sinkStartSec);
            const monotonicTsSec =
              prevAudioTsSec < 0 ? relStartSec : Math.max(prevAudioTsSec + 1e-6, relStartSec);
            prevAudioTsSec = monotonicTsSec;
            trimmedSample.setTimestamp(monotonicTsSec);
            await audioSource.add(trimmedSample);
            touchActivity();
          } finally {
            if (trimmedSample !== rawSample) {
              trimmedSample.close();
            }
            rawSample.close();
          }
        }
      } finally {
        await audIter.return?.().catch(() => {});
        audioSource.close();
      }
    };

    const runPipeline = async () => {
      touchActivity();
      await output.start();
      await Promise.all([pumpVideo(), pumpAudio()]);
      if (signal?.aborted) {
        throw new VideoCancelledError();
      }
      if (emittedVideoFrames === 0) {
        throw new VideoFallbackRequiredError('Tidak ada frame video yang berhasil diproses WebCodecs.');
      }
      touchActivity();
      await output.finalize();
    };

    try {
      await runWithStallWatchdog({
        promise: runPipeline(),
        stallTimeoutMs,
        getLastActivityAt: () => lastActivityAt,
        onStall: () => {
          stopped = true;
          void output.cancel().catch(() => {});
        },
        onAbortCleanup: () => {
          stopped = true;
          void output.cancel().catch(() => {});
        },
        signal,
        stallMessage: 'Penyandian hardware WebCodecs terhenti (15 dtk) — beralih ke mode berikutnya.',
      });
    } catch (err) {
      stopped = true;
      void output.cancel().catch(() => {});
      if (err instanceof VideoCancelledError || err instanceof ConversionCanceledError || signal?.aborted) {
        throw new VideoCancelledError();
      }
      if (err instanceof VideoFallbackRequiredError) {
        throw err;
      }
      throw new VideoFallbackRequiredError(
        err instanceof Error ? err.message : 'Eksekusi hardware WebCodecs gagal.'
      );
    } finally {
      gpuRenderer.dispose();
    }

    if (signal?.aborted) {
      throw new VideoCancelledError();
    }

    if (!target.buffer || target.buffer.byteLength === 0) {
      throw new VideoFallbackRequiredError('Buffer hasil hardware WebCodecs kosong.');
    }

    onProgress({
      requestId,
      backend: 'webcodecs-mediabunny',
      stage: 'finalizing',
      ratio: 0.99,
      elapsedMs: performance.now() - t0,
    });

    const gpuMode = gpuRenderer.getEngineModeLabel();
    return {
      outputBlob: new Blob([target.buffer], { type: formatMeta.mime }),
      outputFileName: buildVideoExportFileName(
        file.name,
        edit.outputFormat,
        edit.targetResolution
      ),
      outputWidth: targetDims.width,
      outputHeight: targetDims.height,
      durationSec: trim.durationSec,
      engineDetail: `webcodecs-hardware (${probedH264Codec ?? selectedVideoCodec} · ${gpuMode} · CFR quality)`,
    };
  } finally {
    input.dispose();
  }
}
