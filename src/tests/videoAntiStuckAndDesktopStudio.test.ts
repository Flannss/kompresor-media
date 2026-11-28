import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoMetadata, VideoProcessRequest } from '../engines/contracts';
import { PHOTO_FILTER_PRESETS } from '../engines/grading/photoFilters';
import { COLOR_GRADE_PRESETS } from '../engines/shared/colorGrades';
import * as ffmpegEngine from '../engines/video/ffmpegVideoEngine';
import { parseFfmpegTimeSeconds } from '../engines/video/ffmpegVideoEngine';
import * as mediaRecorderEngine from '../engines/video/mediaRecorderVideoEngine';
import { processVideo } from '../engines/video/videoEngineOrchestrator';
import { VideoCancelledError } from '../engines/video/videoErrors';
import { buildFfmpegArgs } from '../engines/video/videoFilterGraph';
import * as webCodecsEngine from '../engines/video/webCodecsVideoEngine';
import { normalizeMonotonicTimestampUs } from '../engines/video/webCodecsVideoEngine';
import { getMediaPreset } from '../presets/mediaPresets';

function makeVideoRequest(overrides?: Partial<VideoProcessRequest>): VideoProcessRequest {
  const metadata: VideoMetadata = {
    kind: 'video',
    fileName: 'vfr_iphone_clip.mov',
    mimeType: 'video/quicktime',
    sizeBytes: 8_500_000,
    width: 1920,
    height: 1080,
    orientation: 'landscape',
    aspectRatio: '16:9',
    durationSec: 12,
    fpsHint: 60,
    codecHint: 'HEVC',
    hasAudioHint: false,
  };
  const edit = structuredClone(getMediaPreset('whatsapp-status').video);
  return {
    requestId: 'req-t019-1',
    file: new File([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])], 'vfr_iphone_clip.mov', {
      type: 'video/quicktime',
    }),
    sourceMetadata: metadata,
    edit,
    preferredBackend: 'auto',
    ...overrides,
  };
}

describe('KM-T019 Video Anti-Stuck Watchdogs, VFR Resilience, Log Progress & Swatch Presets', () => {
  beforeEach(() => {
    if (!URL.createObjectURL) {
      (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () =>
        `blob:mock/${Math.random()}`;
    } else {
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock/${Math.random()}`);
    }
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(
      (tagName: string, options?: ElementCreationOptions) => {
        const el = origCreate(tagName, options);
        if (tagName.toLowerCase() === 'video') {
          (el as HTMLVideoElement).load = () => {};
          queueMicrotask(() => {
            el.dispatchEvent(new Event('loadedmetadata'));
          });
        }
        return el;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aborts a hung Tier-1 WebCodecs promise after stall watchdog and automatically falls back without hanging', async () => {
    const req = makeVideoRequest();
    let capturedTier1Signal: AbortSignal | undefined;

    vi.spyOn(webCodecsEngine, 'runWebCodecsVideoTranscode').mockImplementation((_r, _prog, sig) => {
      capturedTier1Signal = sig;
      // Intentionally never resolve & emit zero progress to simulate GPU encoder hang
      return new Promise(() => {});
    });

    vi.spyOn(mediaRecorderEngine, 'canUseMediaRecorderMp4').mockReturnValue(false);
    const ffSpy = vi.spyOn(ffmpegEngine, 'runFfmpegVideoTranscode').mockResolvedValueOnce({
      outputBlob: new Blob([new Uint8Array(2048)], { type: 'video/mp4' }),
      outputFileName: 'vfr_iphone_clip-hd-1080p.mp4',
      outputWidth: 1920,
      outputHeight: 1080,
      durationSec: 12,
      engineDetail: 'ffmpeg-wasm-st (fallback)',
    });

    const result = await processVideo(req, () => {}, undefined, {
      tier1StallTimeoutMs: 60,
    });

    expect(capturedTier1Signal?.aborted).toBe(true);
    expect(ffSpy).toHaveBeenCalledTimes(1);
    expect(result.backend).toBe('ffmpeg-wasm-st');
    expect(result.outputWidth).toBe(1920);
  });

  it('halts immediately on explicit AbortController cancel with zero fallback attempts', async () => {
    const req = makeVideoRequest();
    const controller = new AbortController();

    vi.spyOn(webCodecsEngine, 'runWebCodecsVideoTranscode').mockImplementation(
      () => new Promise(() => {})
    );
    const mrSpy = vi.spyOn(mediaRecorderEngine, 'runMediaRecorderVideoTranscode');
    const ffSpy = vi.spyOn(ffmpegEngine, 'runFfmpegVideoTranscode');

    const pending = processVideo(req, () => {}, controller.signal, {
      tier1StallTimeoutMs: 5000,
    });
    setTimeout(() => controller.abort(), 15);

    await expect(pending).rejects.toBeInstanceOf(VideoCancelledError);
    expect(mrSpy).not.toHaveBeenCalled();
    expect(ffSpy).not.toHaveBeenCalled();
  });

  it('normalizes duplicate/out-of-order VFR timestamps monotonically in microseconds', () => {
    let last = -1;
    const rawInputs = [0, 0, 0, 16667, 16666, -50, Number.NaN, 33333, 33333];
    const normalized: number[] = [];
    for (const ts of rawInputs) {
      last = normalizeMonotonicTimestampUs(ts, last);
      normalized.push(last);
    }

    for (let i = 1; i < normalized.length; i += 1) {
      expect(normalized[i]).toBeGreaterThan(normalized[i - 1]);
    }
    expect(normalized[0]).toBe(0);
    expect(normalized[1]).toBe(1);
    expect(normalized[2]).toBe(2);
    expect(normalized[4]).toBe(16668);
  });

  it('parses FFmpeg log time=HH:MM:SS.xx accurately and injects VFR +genpts, mux queue, and audio-less -an flags', () => {
    expect(
      parseFfmpegTimeSeconds('frame= 120 fps=24 q=28.0 size= 512kB time=00:00:05.50 bitrate=762.5kbits/s')
    ).toBe(5.5);
    expect(parseFfmpegTimeSeconds('frame= 360 time=01:02:03.25 speed=1.4x')).toBe(3723.25);
    expect(parseFfmpegTimeSeconds('frame=   1 fps=0.0 q=0.0 size=0kB time=N/A bitrate=N/A')).toBeNull();
    expect(parseFfmpegTimeSeconds('')).toBeNull();

    const edit = structuredClone(getMediaPreset('whatsapp-status').video);
    const built = buildFfmpegArgs({
      inputFileNameOnFs: 'input.mov',
      sourceMetadata: { width: 1920, height: 1080, durationSec: 12, hasAudioHint: false },
      edit,
      performanceTier: 'desktop',
    });

    const fflagsIdx = built.args.indexOf('-fflags');
    const inputIdx = built.args.indexOf('-i');
    expect(fflagsIdx).toBeGreaterThanOrEqual(0);
    expect(built.args[fflagsIdx + 1]).toBe('+genpts');
    expect(fflagsIdx).toBeLessThan(inputIdx);

    const maxMuxIdx = built.args.indexOf('-max_muxing_queue_size');
    expect(maxMuxIdx).toBeGreaterThan(inputIdx);
    expect(built.args[maxMuxIdx + 1]).toBe('1024');

    expect(built.args).toContain('-an');
    expect(built.args).not.toContain('-af');
  });

  it('provides bespoke CSS swatch gradients across all 12 photo filters and 7 color grades', () => {
    expect(PHOTO_FILTER_PRESETS).toHaveLength(12);
    for (const f of PHOTO_FILTER_PRESETS) {
      expect(f.swatchGradient).toContain('linear-gradient');
    }
    expect(COLOR_GRADE_PRESETS).toHaveLength(7);
    for (const g of COLOR_GRADE_PRESETS) {
      expect(g.swatchGradient).toContain('linear-gradient');
    }
  });
});
