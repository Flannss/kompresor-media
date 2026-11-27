import type {
  AudioCodec,
  ConversionVideoOptions,
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
} from './videoPresets';

export class VideoFallbackRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoFallbackRequiredError';
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
 * Resolves calibrated social-HD bitrates for Hardware WebCodecs video exports
 * to guarantee crisp playback after WhatsApp, IG Reels, and TikTok re-compression.
 */
export function resolveHardwareVideoBitrateBps(edit: VideoEditState): number {
  switch (edit.presetId) {
    case 'whatsapp-hd':
      return 6_200_000;
    case 'whatsapp-status':
      return 4_600_000;
    case 'instagram-story':
      return 7_000_000;
    case 'tiktok-hd':
      return 7_500_000;
    case 'web-light':
    case 'whatsapp-fast':
      return 2_200_000;
    default:
      return edit.targetBitrateBps;
  }
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
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width: params.width,
        height: params.height,
        bitrate: params.bitrate,
        framerate: params.framerate ?? 30,
        hardwareAcceleration: 'prefer-hardware',
        avc: { format: 'avc' },
      });
      if (support.supported) {
        return support.config?.codec ?? codec;
      }
    } catch {
      // Try next H.264 profile candidate cleanly
    }
  }
  return null;
}

interface ResolvedGpuVisualParams {
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

function resolveGpuVisualParams(edit: VideoEditState): ResolvedGpuVisualParams {
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

function createCanvasSurface(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function computeDrawRect(
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
  const canvas = createCanvasSurface(width, height);
  const attrs: WebGLContextAttributes = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  };
  const gl =
    (canvas.getContext('webgl2', attrs) as WebGLRenderingContext | null) ??
    (canvas.getContext('webgl', attrs) as WebGLRenderingContext | null);
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

function createGpuVideoFrameProcessor(params: {
  VideoSampleCtor: typeof MediabunnyVideoSample;
  edit: VideoEditState;
  width: number;
  height: number;
  cues: SubtitleCue[];
  useHardsub: boolean;
}): {
  process: NonNullable<ConversionVideoOptions['process']>;
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
      fallbackCanvas = createCanvasSurface(width, height);
      fallbackCtx = fallbackCanvas.getContext('2d');
      if (!fallbackCtx) {
        releaseCanvasSurface(fallbackCanvas);
        fallbackCanvas = null;
        throw new VideoFallbackRequiredError('Kanvas GPU 2D tidak tersedia untuk memproses frame video.');
      }
      fallbackCtx.imageSmoothingEnabled = true;
      fallbackCtx.imageSmoothingQuality = 'high';
    }
    return { canvas: fallbackCanvas, ctx: fallbackCtx! };
  };

  return {
    getEngineModeLabel: () =>
      usedWebGl && !used2dCanvas ? 'WebGL GPU' : glHandle ? 'WebGL GPU' : 'Canvas GPU',

    process: (sample) => {
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
            timestamp: sample.timestamp,
            duration: sample.duration,
            colorSpace: BT709_COLOR_SPACE,
          });
        } catch {
          // Tear down WebGL path cleanly if GPU VideoFrame import isn't supported and switch to 2D canvas
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

      // GPU-backed 2D OffscreenCanvas fallback (also renders hardsub subtitles when active)
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
        const active = findActiveCuesAtTime(cues, sample.timestamp);
        if (active.length > 0) {
          drawHardsubCuesOnCanvas(ctx, width, height, active, edit.subtitle.size, edit.subtitle.position);
        }
      }

      return new VideoSampleCtor(canvas, {
        timestamp: sample.timestamp,
        duration: sample.duration,
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
  cuesAlreadyTrimmed = false
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
    BlobSource,
    BufferTarget,
    Conversion,
    ConversionCanceledError,
    Input,
    MkvOutputFormat,
    MovOutputFormat,
    Mp4OutputFormat,
    Output,
    Quality,
    VideoSample,
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

  try {
    const primaryVideo = await input.getPrimaryVideoTrack();
    if (!primaryVideo) {
      throw new VideoFallbackRequiredError('Trek video tidak terbaca oleh demuxer WebCodecs.');
    }

    const muted = isAudioMuted(edit);
    const audioBitrateBps = Math.min(160_000, Math.max(128_000, getEffectiveAudioBitrateKbps(edit) * 1000));
    const primaryAudio = await input.getPrimaryAudioTrack();
    if (!muted && primaryAudio) {
      const canAud = await canEncodeAudio(selectedAudioCodec, {
        quality: new Quality({ bitrate: audioBitrateBps, bitrateMode: 'variable' }),
      });
      if (!canAud) {
        throw new VideoFallbackRequiredError(
          `Encoder audio ${selectedAudioCodec.toUpperCase()} tidak tersedia.`
        );
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

    const gpuProcessor = createGpuVideoFrameProcessor({
      VideoSampleCtor: VideoSample,
      edit,
      width: targetDims.width,
      height: targetDims.height,
      cues: shiftedCues,
      useHardsub,
    });

    const coverFit =
      edit.enhanceSuite.upscale1080.enabled && !edit.enhanceSuite.upscale1080.keepAspect;

    const videoOptions: ConversionVideoOptions = {
      fit: coverFit ? 'cover' : 'contain',
      codec: selectedVideoCodec,
      ...(probedH264Codec ? { fullCodecString: probedH264Codec } : {}),
      quality: videoQuality,
      hardwareAcceleration: 'prefer-hardware',
      keyFrameInterval: 2,
      forceTranscode: true,
      ...(effectiveFps ? { frameRate: effectiveFps } : {}),
      process: gpuProcessor.process,
      processedWidth: targetDims.width,
      processedHeight: targetDims.height,
    };

    let conversion: Awaited<ReturnType<typeof Conversion.init>>;
    try {
      conversion = await Conversion.init({
        input,
        output,
        tracks: 'primary',
        copy: false,
        showWarnings: false,
        ...(trim.isTrimmed ? { trim: { start: trim.startSec, end: trim.endSec } } : {}),
        video: videoOptions,
        audio:
          muted || !primaryAudio
            ? { discard: true }
            : {
                codec: selectedAudioCodec,
                quality: new Quality({
                  bitrate: audioBitrateBps,
                  bitrateMode: 'variable',
                }),
                forceTranscode: edit.outputFormat === 'webm',
              },
      });
    } catch (initErr) {
      gpuProcessor.dispose();
      if (initErr instanceof ConversionCanceledError || signal?.aborted) {
        throw new VideoCancelledError();
      }
      throw new VideoFallbackRequiredError(
        initErr instanceof Error ? initErr.message : 'Inisialisasi hardware WebCodecs gagal.'
      );
    }

    const unexpectedDiscard = conversion.discardedTracks.find(
      (d) => d.reason !== 'discarded_by_user'
    );
    if (!conversion.isValid || unexpectedDiscard) {
      gpuProcessor.dispose();
      const reason = unexpectedDiscard?.reason ?? 'konfigurasi trek tidak valid';
      throw new VideoFallbackRequiredError(`WebCodecs tidak dapat memproses trek (${reason}).`);
    }

    conversion.onProgress = (progressRatio) => {
      if (signal?.aborted) return;
      const clamped = Math.min(
        0.98,
        Math.max(0.05, Number.isFinite(progressRatio) ? progressRatio : 0)
      );
      onProgress({
        requestId,
        backend: 'webcodecs-mediabunny',
        stage: 'transcoding',
        ratio: clamped,
        elapsedMs: performance.now() - t0,
        detail: useHardsub
          ? 'Merender subtitle dengan akselerasi hardware GPU…'
          : 'Menyandikan video HD via akselerasi hardware GPU…',
      });
    };

    const onAbort = () => {
      void conversion.cancel();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      await conversion.execute();
    } catch (err) {
      if (err instanceof ConversionCanceledError || signal?.aborted) {
        throw new VideoCancelledError();
      }
      throw new VideoFallbackRequiredError(
        err instanceof Error ? err.message : 'Eksekusi hardware WebCodecs gagal.'
      );
    } finally {
      signal?.removeEventListener('abort', onAbort);
      gpuProcessor.dispose();
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

    const gpuMode = gpuProcessor.getEngineModeLabel();
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
      engineDetail: `webcodecs-hardware (${probedH264Codec ?? selectedVideoCodec} · ${gpuMode})`,
    };
  } finally {
    input.dispose();
  }
}
