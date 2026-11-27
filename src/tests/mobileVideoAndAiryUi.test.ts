import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoMetadata, VideoProcessRequest } from '../engines/contracts';
import * as ffmpegEngine from '../engines/video/ffmpegVideoEngine';
import * as mediaRecorderEngine from '../engines/video/mediaRecorderVideoEngine';
import { processVideo } from '../engines/video/videoEngineOrchestrator';
import { VideoCancelledError } from '../engines/video/videoErrors';
import { buildFfmpegFilterGraph } from '../engines/video/videoFilterGraph';
import * as webCodecsEngine from '../engines/video/webCodecsVideoEngine';
import { getMediaPreset } from '../presets/mediaPresets';

function makeVideoRequest(overrides?: Partial<VideoProcessRequest>): VideoProcessRequest {
  const metadata: VideoMetadata = {
    kind: 'video',
    fileName: 'iphone_4k60.mov',
    mimeType: 'video/quicktime',
    sizeBytes: 12_000_000,
    width: 3840,
    height: 2160,
    orientation: 'landscape',
    aspectRatio: '16:9',
    durationSec: 10,
    fpsHint: 60,
    codecHint: 'HEVC + AAC',
    hasAudioHint: true,
  };
  const edit = structuredClone(getMediaPreset('whatsapp-status').video);
  return {
    requestId: 'req-t017-1',
    file: new File([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])], 'iphone_4k60.mov', {
      type: 'video/quicktime',
    }),
    sourceMetadata: metadata,
    edit,
    preferredBackend: 'auto',
    ...overrides,
  };
}

describe('KM-T017 3-Tier Video Routing, 4K-60fps Fast Downscale & COOP/COEP Headers', () => {
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

  it('routes Tier-1 WebCodecs -> Tier-2 MediaRecorder MP4 -> Tier-3 FFmpeg cleanly and aborts immediately on cancel', async () => {
    const req = makeVideoRequest();

    // Case 1: WebCodecs succeeds -> backend === 'webcodecs-mediabunny'
    const wcSpy = vi.spyOn(webCodecsEngine, 'runWebCodecsVideoTranscode').mockResolvedValueOnce({
      outputBlob: new Blob([new Uint8Array(2048)], { type: 'video/mp4' }),
      outputFileName: 'iphone_4k60-kompresor.mp4',
      outputWidth: 1920,
      outputHeight: 1080,
      durationSec: 10,
      engineDetail: 'webcodecs-hardware',
    });
    const mrSpy = vi.spyOn(mediaRecorderEngine, 'runMediaRecorderVideoTranscode');
    const ffSpy = vi.spyOn(ffmpegEngine, 'runFfmpegVideoTranscode');

    const res1 = await processVideo(req, () => {});
    expect(res1.backend).toBe('webcodecs-mediabunny');
    expect(wcSpy).toHaveBeenCalledTimes(1);
    expect(mrSpy).not.toHaveBeenCalled();
    expect(ffSpy).not.toHaveBeenCalled();

    // Case 2: WebCodecs throws VideoFallbackRequiredError + MediaRecorder MP4 supported -> Tier-2 'mediarecorder-native'
    wcSpy.mockRejectedValueOnce(new webCodecsEngine.VideoFallbackRequiredError('iOS 16 HEVC MOV'));
    vi.spyOn(mediaRecorderEngine, 'canUseMediaRecorderMp4').mockReturnValue(true);
    mrSpy.mockResolvedValueOnce({
      outputBlob: new Blob([new Uint8Array(2048)], { type: 'video/mp4' }),
      outputFileName: 'iphone_4k60-kompresor.mp4',
      outputWidth: 1920,
      outputHeight: 1080,
      durationSec: 10,
      engineDetail: 'Hardware HP (MediaRecorder MP4)',
    });

    const res2 = await processVideo(req, () => {});
    expect(res2.backend).toBe('mediarecorder-native');
    expect(mrSpy).toHaveBeenCalledTimes(1);
    expect(ffSpy).not.toHaveBeenCalled();

    // Case 3: Both WebCodecs and MediaRecorder unsupported -> Tier-3 'ffmpeg-wasm-st'
    wcSpy.mockRejectedValueOnce(new webCodecsEngine.VideoFallbackRequiredError('no webcodecs'));
    mrSpy.mockRejectedValueOnce(new webCodecsEngine.VideoFallbackRequiredError('no mp4 recorder'));
    ffSpy.mockResolvedValueOnce({
      outputBlob: new Blob([new Uint8Array(2048)], { type: 'video/mp4' }),
      outputFileName: 'iphone_4k60-kompresor.mp4',
      outputWidth: 1920,
      outputHeight: 1080,
      durationSec: 10,
      engineDetail: 'ffmpeg-wasm-st',
    });

    const res3 = await processVideo(req, () => {});
    expect(res3.backend).toBe('ffmpeg-wasm-st');
    expect(ffSpy).toHaveBeenCalledTimes(1);

    // Case 4: VideoCancelledError NEVER falls through to MediaRecorder or FFmpeg
    wcSpy.mockRejectedValueOnce(new VideoCancelledError());
    mrSpy.mockClear();
    ffSpy.mockClear();
    await expect(processVideo(req, () => {})).rejects.toBeInstanceOf(VideoCancelledError);
    expect(mrSpy).not.toHaveBeenCalled();
    expect(ffSpy).not.toHaveBeenCalled();
  });

  it('places fps=30 FIRST before 4K downscale, selects fast_bilinear on mobile & bicubic on desktop, and trims mobile unsharp', () => {
    const waStatus = structuredClone(getMediaPreset('whatsapp-status').video);

    // Low-memory mobile 4K -> 1080p with Natural HD
    const mobileNaturalFg = buildFfmpegFilterGraph(
      { width: 3840, height: 2160, durationSec: 15 },
      waStatus,
      'low-memory-mobile'
    );
    expect(mobileNaturalFg.vfChain.startsWith('fps=30,')).toBe(true);
    expect(mobileNaturalFg.vfChain.indexOf('fps=30')).toBeLessThan(
      mobileNaturalFg.vfChain.indexOf('scale=')
    );
    expect(mobileNaturalFg.vfChain).toContain('scale=1920:1080:flags=fast_bilinear,setsar=1');
    expect(mobileNaturalFg.vfChain).not.toContain('flags=lanczos');
    expect(mobileNaturalFg.vfChain).not.toContain('unsharp=');

    // Mobile 4K -> 1080p with Sharp 1080p caps unsharp to lightweight 0.20 (0.25 * 0.8)
    const sharpEdit = structuredClone(waStatus);
    sharpEdit.clarityModel = 'sharp-1080p';
    sharpEdit.clarityStrength = 100;
    const mobileSharpFg = buildFfmpegFilterGraph(
      { width: 3840, height: 2160, durationSec: 15 },
      sharpEdit,
      'low-memory-mobile'
    );
    expect(mobileSharpFg.vfChain).toContain('unsharp=5:5:0.25:5:5:0.0');

    // Desktop 4K -> 1080p uses bicubic + fps=30 first
    const desktopFg = buildFfmpegFilterGraph(
      { width: 3840, height: 2160, durationSec: 15 },
      waStatus,
      'desktop'
    );
    expect(desktopFg.vfChain.startsWith('fps=30,')).toBe(true);
    expect(desktopFg.vfChain).toContain('scale=1920:1080:flags=bicubic,setsar=1');
  });

  it('configures COOP/COEP/CORP, Cache-Control, and application/wasm headers in vercel.json', () => {
    const vercelPath = path.resolve(process.cwd(), 'vercel.json');
    const vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8')) as {
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };

    const getHeaderMap = (source: string) => {
      const entry = vercel.headers.find((h) => h.source === source);
      expect(entry, `missing header rule for ${source}`).toBeDefined();
      return Object.fromEntries(entry!.headers.map((h) => [h.key, h.value]));
    };

    const allRule = getHeaderMap('/(.*)');
    expect(allRule['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(allRule['Cross-Origin-Embedder-Policy']).toBe('require-corp');

    const rootRule = getHeaderMap('/');
    expect(rootRule['Cache-Control']).toBe('no-cache, no-store, must-revalidate');

    const assetsRule = getHeaderMap('/assets/(.*)');
    expect(assetsRule['Cross-Origin-Resource-Policy']).toBe('same-origin');

    const wasmRule = getHeaderMap('/ffmpeg/(.*)\\.wasm');
    expect(wasmRule['Content-Type']).toBe('application/wasm');
    expect(wasmRule['Cross-Origin-Resource-Policy']).toBe('same-origin');

    const ffmpegRule = getHeaderMap('/ffmpeg/(.*)');
    expect(ffmpegRule['Cross-Origin-Resource-Policy']).toBe('same-origin');
  });
});
