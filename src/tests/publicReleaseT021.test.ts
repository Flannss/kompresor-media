import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoMetadata, VideoProcessRequest } from '../engines/contracts';
import {
  applyQualityModelPass,
  computeImageLaplacianEnergy,
} from '../engines/image/pixelOps';
import * as ffmpegEngine from '../engines/video/ffmpegVideoEngine';
import { VideoCancelledError } from '../engines/video/videoErrors';
import { buildFfmpegArgs, shouldUseFfmpegBackend } from '../engines/video/videoFilterGraph';
import {
  buildVideoSegments,
  computeVideoTargetDimensions,
  estimateVideoOutputBytes,
  isLongFormVideoCandidate,
  resolveLongVideoProfileParams,
} from '../engines/video/videoPresets';
import { resolveHardwareVideoBitrateBps } from '../engines/video/webCodecsVideoEngine';
import { DEFAULT_MAX_VIDEO_BYTES } from '../features/upload/fileValidator';
import { getMediaPreset, MEDIA_PRESETS } from '../presets/mediaPresets';
import {
  formatFriendlyMediaError,
  isCancellationError,
} from '../shared/utils/friendlyError';
import { useMediaStore } from '../store/useMediaStore';

function makeImageDataCompat(width: number, height: number, data: Uint8ClampedArray): ImageData {
  return {
    width,
    height,
    data,
    colorSpace: 'srgb',
  } as unknown as ImageData;
}

function makeSoftPhotoSample(width = 64, height = 64): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      // Soft hazy ramp + smoothed step transition to test super-clarity recovery
      const ramp = Math.round(92 + (1 / (1 + Math.exp(-(x - width / 2) * 0.45))) * 76);
      const texture = Math.round(Math.sin(y * 0.35) * 8);
      data[i] = Math.min(255, Math.max(0, ramp + texture));
      data[i + 1] = Math.min(255, Math.max(0, ramp - texture));
      data[i + 2] = Math.min(255, Math.max(0, ramp + 4));
      data[i + 3] = 255;
    }
  }
  return makeImageDataCompat(width, height, data);
}

function makeTestVideoRequest(overrides?: Partial<VideoProcessRequest>): VideoProcessRequest {
  const metadata: VideoMetadata = {
    kind: 'video',
    fileName: 'vlog_sample.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 4_000_000,
    width: 1280,
    height: 720,
    orientation: 'landscape',
    aspectRatio: '16:9',
    durationSec: 12,
    fpsHint: 30,
    codecHint: 'H.264',
    hasAudioHint: true,
  };
  const edit = structuredClone(getMediaPreset('vlog-hd').video);
  edit.outputFormat = 'mkv'; // route through FFmpeg when testing orchestrator or direct runner
  return {
    requestId: `req-${Math.random().toString(36).slice(2, 8)}`,
    file: new File([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])], 'vlog_sample.mp4', {
      type: 'video/mp4',
    }),
    sourceMetadata: metadata,
    edit,
    preferredBackend: 'ffmpeg-wasm-st',
    ...overrides,
  };
}

describe('KM-T021 Public Production Release Hardening & Capabilities', () => {
  beforeEach(() => {
    ffmpegEngine.resetFfmpegEngineForTests();
    useMediaStore.getState().clearMedia();
  });

  afterEach(() => {
    ffmpegEngine.resetFfmpegEngineForTests();
    vi.doUnmock('@ffmpeg/ffmpeg');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('prevents 2nd-run 4% hang, auto-retries stalled loads, and converts called FFmpeg.terminate() to VideoCancelledError', async () => {
    type MockMode = 'ok' | 'stall-once' | 'terminate-on-load';
    let mode: MockMode = 'ok';
    let loadCalls = 0;
    let terminateCalls = 0;

    vi.doMock('@ffmpeg/ffmpeg', () => {
      class MockFFmpeg {
        loaded = false;
        private listeners: Record<'progress' | 'log', Array<(ev: never) => void>> = {
          progress: [],
          log: [],
        };
        private activeReject: ((reason?: unknown) => void) | null = null;

        on(ev: 'progress' | 'log', cb: (payload: never) => void) {
          this.listeners[ev].push(cb);
        }
        off(ev: 'progress' | 'log', cb: (payload: never) => void) {
          this.listeners[ev] = this.listeners[ev].filter((fn) => fn !== cb);
        }
        async load() {
          loadCalls += 1;
          const callNum = loadCalls;
          if (mode === 'stall-once' && callNum === 1) {
            return new Promise<boolean>((_resolve, reject) => {
              this.activeReject = reject;
            });
          }
          if (mode === 'terminate-on-load') {
            return new Promise<boolean>((_resolve, reject) => {
              this.activeReject = reject;
            });
          }
          this.loaded = true;
          return true;
        }
        async writeFile() {
          return true;
        }
        async exec() {
          for (const cb of this.listeners.log) {
            (cb as (ev: { message: string }) => void)({ message: 'time=00:00:06.00' });
          }
          for (const cb of this.listeners.progress) {
            (cb as (ev: { progress: number }) => void)({ progress: 1 });
          }
          return 0;
        }
        async readFile() {
          return new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        }
        async deleteFile() {
          return true;
        }
        terminate() {
          terminateCalls += 1;
          this.loaded = false;
          if (this.activeReject) {
            const r = this.activeReject;
            this.activeReject = null;
            r(new Error('called FFmpeg.terminate()'));
          }
        }
      }
      return { FFmpeg: MockFFmpeg };
    });

    const freshFfmpegMod = await import('../engines/video/ffmpegVideoEngine');
    freshFfmpegMod.resetFfmpegEngineForTests();

    // 1. Run #1 -> completes cleanly, followed immediately by Run #2 (never stuck at 4%)
    const run1 = await freshFfmpegMod.runFfmpegVideoTranscode(makeTestVideoRequest(), () => {});
    expect(run1.outputBlob.size).toBe(8);

    const run2Progress: number[] = [];
    const run2 = await freshFfmpegMod.runFfmpegVideoTranscode(
      makeTestVideoRequest(),
      (p) => run2Progress.push(p.ratio)
    );
    expect(run2.outputBlob.size).toBe(8);
    expect(run2Progress.some((r) => r >= 0.9)).toBe(true);

    // 2. Abort mid-load firing "called FFmpeg.terminate()" -> must throw VideoCancelledError (NEVER leak string), then Run #3 recovers cleanly
    freshFfmpegMod.resetFfmpegEngineForTests();
    mode = 'terminate-on-load';
    const abortCtrl = new AbortController();
    const cancelRun = freshFfmpegMod.runFfmpegVideoTranscode(
      makeTestVideoRequest(),
      () => {},
      abortCtrl.signal,
      { loadTimeoutMs: 5000 }
    );
    setTimeout(() => abortCtrl.abort(), 15);
    await expect(cancelRun).rejects.toBeInstanceOf(VideoCancelledError);
    expect(terminateCalls).toBeGreaterThanOrEqual(1);

    // Run #3 immediately after cancel completes cleanly
    mode = 'ok';
    const run3 = await freshFfmpegMod.runFfmpegVideoTranscode(makeTestVideoRequest(), () => {});
    expect(run3.outputBlob.size).toBe(8);

    // 3. Stalled load on attempt 0 auto-retries attempt 1 and succeeds
    freshFfmpegMod.resetFfmpegEngineForTests();
    loadCalls = 0;
    mode = 'stall-once';
    const retryRun = await freshFfmpegMod.runFfmpegVideoTranscode(
      makeTestVideoRequest(),
      () => {},
      undefined,
      { loadTimeoutMs: 30 }
    );
    expect(loadCalls).toBe(2);
    expect(retryRun.outputBlob.size).toBe(8);
  });

  it('formats internal technical exceptions into clean Indonesian errors with zero leak strings', () => {
    expect(isCancellationError(new Error('called FFmpeg.terminate()'))).toBe(true);
    expect(isCancellationError(new VideoCancelledError())).toBe(true);

    const oomMsg = formatFriendlyMediaError(new Error('RuntimeError: memory access out of bounds (OOM)'), 'video');
    expect(oomMsg).not.toMatch(/RuntimeError|FFmpeg|terminate|OOM/i);
    expect(oomMsg).toContain('Memori perangkat');

    const codecMsg = formatFriendlyMediaError(new DOMException('EncodingError at VideoEncoder', 'EncodingError'), 'video');
    expect(codecMsg).not.toMatch(/EncodingError|VideoEncoder/i);
    expect(codecMsg).toContain('codec');

    const subMsg = formatFriendlyMediaError(new Error('ErrnoError 29'), 'subtitle');
    expect(subMsg).not.toMatch(/ErrnoError/i);
    expect(subMsg).toContain('.SRT');
  });

  it('calibrates Vlog & Konten HD preset, 8.5 Mbps bitrate, aq-mode=2, sc_threshold 40, and zero fast_bilinear on <=1080p', () => {
    expect(MEDIA_PRESETS.length).toBe(11);
    const vlog = getMediaPreset('vlog-hd').video;
    expect(vlog.targetResolution).toBe('1080p');
    expect(vlog.targetBitrateBps).toBe(8_500_000);
    expect(vlog.crf).toBe(18);
    expect(vlog.maxrateKbps).toBe(10500);
    expect(vlog.bufsizeKbps).toBe(17000);
    expect(vlog.clarityModel).toBe('sharp-1080p');
    expect(resolveHardwareVideoBitrateBps(vlog)).toBe(8_500_000);

    // Orientation-safe 1080p scaling
    expect(computeVideoTargetDimensions(1280, 720, '1080p', 1080)).toEqual({ width: 1920, height: 1080 });
    expect(computeVideoTargetDimensions(720, 1280, '1080p', 1080)).toEqual({ width: 1080, height: 1920 });

    // Mobile 4K Vlog uses bicubic (NOT fast_bilinear) + aq-mode=2 + sc_threshold 40
    const mobileVlog = buildFfmpegArgs({
      inputFileNameOnFs: 'input.mov',
      sourceMetadata: { width: 3840, height: 2160, durationSec: 20, hasAudioHint: true },
      edit: vlog,
      performanceTier: 'low-memory-mobile',
    });
    expect(mobileVlog.filterGraph.vfChain).toContain('flags=bicubic');
    expect(mobileVlog.filterGraph.vfChain).not.toContain('fast_bilinear');
    expect(mobileVlog.args[mobileVlog.args.indexOf('-sc_threshold') + 1]).toBe('40');
    expect(mobileVlog.args).toContain('aq-mode=2');

    // <= 1080p source uses lanczos (zero fast_bilinear)
    const wa1080Mobile = buildFfmpegArgs({
      inputFileNameOnFs: 'input.mp4',
      sourceMetadata: { width: 1280, height: 720, durationSec: 20, hasAudioHint: true },
      edit: structuredClone(getMediaPreset('whatsapp-status').video),
      performanceTier: 'low-memory-mobile',
    });
    expect(wa1080Mobile.filterGraph.vfChain).toContain('flags=lanczos');
    expect(wa1080Mobile.filterGraph.vfChain).not.toContain('fast_bilinear');
  });

  it('supports Video Panjang (30+ mnt) profiles, WebCodecs streaming priority, MB estimator, 10/15-min segments, and 2 GB cap', () => {
    expect(DEFAULT_MAX_VIDEO_BYTES).toBe(2 * 1024 * 1024 * 1024);
    expect(isLongFormVideoCandidate({ durationSec: 300, sizeBytes: 10_000_000 })).toBe(true);
    expect(isLongFormVideoCandidate({ durationSec: 120, sizeBytes: 150 * 1024 * 1024 })).toBe(true);
    expect(isLongFormVideoCandidate({ durationSec: 120, sizeBytes: 50 * 1024 * 1024 })).toBe(false);

    const longSpec = getMediaPreset('long-video').video;
    expect(longSpec.longVideoProfile).toBe('balanced-hd');
    expect(shouldUseFfmpegBackend(longSpec)).toBe(false);

    const spaceSaver = { ...longSpec, ...resolveLongVideoProfileParams('space-saver') };
    const balanced = { ...longSpec, ...resolveLongVideoProfileParams('balanced-hd') };
    const archive = { ...longSpec, ...resolveLongVideoProfileParams('clear-archive') };

    expect(spaceSaver.targetResolution).toBe('720p');
    expect(spaceSaver.audioBitrateKbps).toBe(96);
    expect(resolveHardwareVideoBitrateBps(spaceSaver)).toBe(2_200_000);
    expect(resolveHardwareVideoBitrateBps(balanced)).toBe(4_200_000);
    expect(resolveHardwareVideoBitrateBps(archive)).toBe(6_500_000);

    const estLow = estimateVideoOutputBytes(1800, spaceSaver);
    const estMid = estimateVideoOutputBytes(1800, balanced);
    const estHigh = estimateVideoOutputBytes(1800, archive);
    expect(estLow).toBeLessThan(estMid);
    expect(estMid).toBeLessThan(estHigh);

    const segs10 = buildVideoSegments(3120, 10);
    expect(segs10).toHaveLength(6);
    expect(segs10[0]).toMatchObject({ startSec: 0, endSec: 600 });
    expect(segs10[5]).toMatchObject({ startSec: 3000, endSec: 3120 });

    const segs15 = buildVideoSegments(2700, 15);
    expect(segs15).toHaveLength(3);
  });

  it('produces >= +25% real Laplacian edge sharpness gain with multi-scale 4K super-clarity', () => {
    const soft = makeSoftPhotoSample(64, 64);
    const lapBefore = computeImageLaplacianEnergy(soft);

    const hq = makeSoftPhotoSample(64, 64);
    applyQualityModelPass(hq, 'high-quality', 3.2, 80, '4k', { skipDenoise: true });
    const lapHq = computeImageLaplacianEnergy(hq);
    const gainPct = ((lapHq - lapBefore) / lapBefore) * 100;
    expect(gainPct).toBeGreaterThanOrEqual(25);

    const ultra = makeSoftPhotoSample(64, 64);
    applyQualityModelPass(ultra, 'ultra-detail', 3.2, 80, '4k', { skipDenoise: true });
    const lapUltra = computeImageLaplacianEnergy(ultra);
    expect(lapUltra).toBeGreaterThan(lapHq);
  });
});
