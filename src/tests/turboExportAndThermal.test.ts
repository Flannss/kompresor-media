import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as imageEngineClient from '../engines/image/imageEngineClient';
import {
  runImagePipeline,
  type Canvas2DContextLike,
  type CanvasAdapter,
  type CanvasSurfaceLike,
} from '../engines/image/pipelineRunner';
import { buildExportFileName } from '../engines/image/pixelOps';
import * as videoOrchestrator from '../engines/video/videoEngineOrchestrator';
import { VideoCancelledError } from '../engines/video/videoErrors';
import {
  buildFfmpegArgs,
  buildFfmpegFilterGraph,
  shouldUseFfmpegBackend,
} from '../engines/video/videoFilterGraph';
import { resolveHardwareVideoBitrateBps } from '../engines/video/webCodecsVideoEngine';
import * as fileValidator from '../features/upload/fileValidator';
import * as metadataReader from '../features/upload/metadataReader';
import { getMediaPreset } from '../presets/mediaPresets';
import { useMediaStore } from '../store/useMediaStore';

interface MockCanvas extends CanvasSurfaceLike {
  data: Uint8ClampedArray;
}

function makeMockAdapter(recordedSizes: Array<{ w: number; h: number }>): CanvasAdapter<MockCanvas> {
  return {
    createCanvas(width: number, height: number): MockCanvas {
      const data = new Uint8ClampedArray(width * height * 4);
      const canvas: MockCanvas = {
        width,
        height,
        data,
        getContext(): Canvas2DContextLike {
          return {
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
            save() {},
            restore() {},
            translate() {},
            rotate() {},
            scale() {},
            drawImage(source: CanvasImageSource, ...rest: number[]) {
              // Bilinear-like nearest fill on resize/draw so edge energy tests are realistic
              const dstW = rest.length >= 4 && rest[2] > 0 ? rest[2] : canvas.width;
              const dstH = rest.length >= 4 && rest[3] > 0 ? rest[3] : canvas.height;
              const srcObj = source as unknown as {
                width?: number;
                height?: number;
                data?: Uint8ClampedArray;
              };
              const srcW = Math.max(1, srcObj.width ?? dstW);
              const srcH = Math.max(1, srcObj.height ?? dstH);
              const srcData = srcObj.data;
              if (!srcData) {
                for (let y = 0; y < canvas.height; y += 1) {
                  for (let x = 0; x < canvas.width; x += 1) {
                    const p = (y * canvas.width + x) * 4;
                    const v = x < canvas.width / 2 ? 70 : 195;
                    canvas.data[p] = v;
                    canvas.data[p + 1] = v;
                    canvas.data[p + 2] = v;
                    canvas.data[p + 3] = 255;
                  }
                }
                return;
              }
              for (let y = 0; y < Math.min(dstH, canvas.height); y += 1) {
                const sy = Math.min(srcH - 1, Math.floor((y * srcH) / Math.max(1, dstH)));
                for (let x = 0; x < Math.min(dstW, canvas.width); x += 1) {
                  const sx = Math.min(srcW - 1, Math.floor((x * srcW) / Math.max(1, dstW)));
                  const sp = (sy * srcW + sx) * 4;
                  const dp = (y * canvas.width + x) * 4;
                  canvas.data[dp] = srcData[sp];
                  canvas.data[dp + 1] = srcData[sp + 1];
                  canvas.data[dp + 2] = srcData[sp + 2];
                  canvas.data[dp + 3] = srcData[sp + 3];
                }
              }
            },
            getImageData(_sx: number, _sy: number, sw: number, sh: number): ImageData {
              recordedSizes.push({ w: sw, h: sh });
              return { width: sw, height: sh, data: canvas.data } as unknown as ImageData;
            },
            putImageData(imageData: ImageData) {
              canvas.data.set(imageData.data);
            },
          };
        },
      };
      return canvas;
    },
    async encodeBlob(canvas: MockCanvas, format) {
      return new Blob([Uint8Array.from(canvas.data)], { type: format });
    },
  };
}

describe('KM-T016 Turbo Export Speed & Mobile Thermal Safety', () => {
  beforeEach(() => {
    useMediaStore.getState().clearMedia();
    if (!URL.createObjectURL) {
      (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () =>
        `blob:mock/${Math.random()}`;
    } else {
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock/${Math.random()}`);
    }
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calibrates Hardware WebCodecs bitrates accurately and routes FFmpeg exclusively for special filters', () => {
    expect(resolveHardwareVideoBitrateBps(getMediaPreset('whatsapp-hd').video)).toBe(6_200_000);
    expect(resolveHardwareVideoBitrateBps(getMediaPreset('whatsapp-status').video)).toBe(4_600_000);
    expect(resolveHardwareVideoBitrateBps(getMediaPreset('instagram-story').video)).toBe(7_000_000);
    expect(resolveHardwareVideoBitrateBps(getMediaPreset('tiktok-hd').video)).toBe(7_500_000);
    expect(resolveHardwareVideoBitrateBps(getMediaPreset('web-light').video)).toBe(2_200_000);

    // Hardware WebCodecs eligible for standard MP4/MOV + color grade + 1080p clarity
    const gradedMov = structuredClone(getMediaPreset('whatsapp-status').video);
    gradedMov.outputFormat = 'mov';
    gradedMov.colorGrade.gradeId = 'iphone-pro';
    expect(shouldUseFfmpegBackend(gradedMov)).toBe(false);

    // Deshake / subtitle / audio EQ / WebM / MKV -> FFmpeg
    const stabilized = structuredClone(getMediaPreset('whatsapp-hd').video);
    stabilized.stabilize.enabled = true;
    expect(shouldUseFfmpegBackend(stabilized)).toBe(true);
  });

  it('uses smooth veryfast on mobile 1080p HD, reserves superfast+fastdecode for mobile 720p/light, and omits slow 3D hqdn3d on Natural HD', () => {
    const waStatus = structuredClone(getMediaPreset('whatsapp-status').video);
    const mobileBuilt = buildFfmpegArgs({
      inputFileNameOnFs: 'input.mp4',
      sourceMetadata: { width: 1280, height: 720, durationSec: 12, hasAudioHint: true },
      edit: waStatus,
      performanceTier: 'low-memory-mobile',
    });

    expect(mobileBuilt.filterGraph.vfChain).not.toContain('hqdn3d=');
    expect(mobileBuilt.filterGraph.vfChain).toContain('scale=1920:1080:flags=lanczos,setsar=1');
    expect(mobileBuilt.filterGraph.vfChain).toContain('unsharp=5:5:0.36:5:5:0.0');
    expect(mobileBuilt.encoderPreset).toBe('veryfast');
    expect(mobileBuilt.args[mobileBuilt.args.indexOf('-preset') + 1]).toBe('veryfast');
    expect(mobileBuilt.args).not.toContain('-tune');
    expect(mobileBuilt.args[mobileBuilt.args.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
    expect(mobileBuilt.args[mobileBuilt.args.indexOf('-colorspace') + 1]).toBe('bt709');
    expect(mobileBuilt.args[mobileBuilt.args.indexOf('-maxrate') + 1]).toBe('4800k');
    expect(mobileBuilt.args[mobileBuilt.args.indexOf('-bufsize') + 1]).toBe('9600k');
    expect(mobileBuilt.args[mobileBuilt.args.indexOf('-threads') + 1]).toBe('1');

    // Explicit mobile light / 720p mode uses superfast + fastdecode
    const mobileLightEdit = structuredClone(waStatus);
    mobileLightEdit.qualityTier = 'light';
    mobileLightEdit.targetResolution = '720p';
    mobileLightEdit.maxHeightPx = 720;
    const mobileLightBuilt = buildFfmpegArgs({
      inputFileNameOnFs: 'input.mp4',
      sourceMetadata: { width: 1280, height: 720, durationSec: 12, hasAudioHint: true },
      edit: mobileLightEdit,
      performanceTier: 'low-memory-mobile',
    });
    expect(mobileLightBuilt.encoderPreset).toBe('superfast');
    expect(mobileLightBuilt.args[mobileLightBuilt.args.indexOf('-preset') + 1]).toBe('superfast');
    expect(mobileLightBuilt.args[mobileLightBuilt.args.indexOf('-tune') + 1]).toBe('fastdecode');

    // Malam & Minim Cahaya still preserves temporal hqdn3d cleanly even on mobile
    const nightEdit = structuredClone(waStatus);
    nightEdit.clarityModel = 'low-light';
    const nightFg = buildFfmpegFilterGraph(
      { width: 1280, height: 720, durationSec: 10 },
      nightEdit,
      'low-memory-mobile'
    );
    expect(nightFg.vfChain).toContain('hqdn3d=');

    // Desktop fallback retains veryfast & hqdn3d on natural-hd
    const desktopBuilt = buildFfmpegArgs({
      inputFileNameOnFs: 'input.mp4',
      sourceMetadata: { width: 1280, height: 720, durationSec: 12, hasAudioHint: true },
      edit: waStatus,
      performanceTier: 'desktop',
    });
    expect(desktopBuilt.filterGraph.vfChain).toContain('hqdn3d=');
    expect(desktopBuilt.args[desktopBuilt.args.indexOf('-preset') + 1]).toBe('veryfast');
  });

  it('aborts active video processing immediately on Batalkan and ignores stale late cancellation races', async () => {
    vi.spyOn(fileValidator, 'validateMediaFile').mockResolvedValue({
      valid: true,
      kind: 'video',
      detectedMime: 'video/mp4',
      declaredMime: 'video/mp4',
      fileName: 'klip.mp4',
      sizeBytes: 500_000,
      signatureLabel: 'MP4',
      warnings: [],
    });
    vi.spyOn(metadataReader, 'readMediaMetadata').mockResolvedValue({
      kind: 'video',
      fileName: 'klip.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 500_000,
      width: 1280,
      height: 720,
      orientation: 'landscape',
      aspectRatio: '16:9',
      durationSec: 6,
      codecHint: 'avc1',
      hasAudioHint: true,
    });

    let capturedSignal1: AbortSignal | undefined;
    let triggerLateStaleReject!: () => void;
    let runCount = 0;

    vi.spyOn(videoOrchestrator, 'processVideo').mockImplementation(async (req, _onProg, sig) => {
      runCount += 1;
      if (runCount === 1) {
        capturedSignal1 = sig;
        return new Promise((_resolve, reject) => {
          triggerLateStaleReject = () => reject(new VideoCancelledError());
          sig?.addEventListener('abort', () => {
            // Simulate delayed worker termination response in test step 2
          });
        });
      }
      return {
        requestId: req.requestId,
        backend: 'webcodecs-mediabunny',
        outputBlob: new Blob(['hd-mp4'], { type: 'video/mp4' }),
        outputFileName: 'klip-hd-1080p.mp4',
        outputFormat: 'mp4',
        outputMime: 'video/mp4',
        outputWidth: 1920,
        outputHeight: 1080,
        durationSec: 6,
        hasAudio: true,
        inputBytes: 500_000,
        outputBytes: 120_000,
        durationMs: 42,
        activeModules: ['1080p'],
      };
    });

    const vidFile = new File([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])], 'klip.mp4', {
      type: 'video/mp4',
    });
    await useMediaStore.getState().addMediaFiles([vidFile], { replace: true });

    const run1Promise = useMediaStore.getState().startVideoProcessing();
    expect(useMediaStore.getState().videoProcessStatus).toBe('processing');
    await new Promise((r) => setTimeout(r, 15));
    expect(capturedSignal1?.aborted).toBe(false);

    useMediaStore.getState().cancelVideoProcessing();
    expect(capturedSignal1?.aborted).toBe(true);
    expect(useMediaStore.getState().videoProcessStatus).toBe('cancelled');
    expect(useMediaStore.getState().videoProgress).toBeNull();
    expect(useMediaStore.getState().items).toHaveLength(1);

    // Start run #2 BEFORE run #1 rejects late -> stale cancellation must NOT wipe run #2's result
    const run2Promise = useMediaStore.getState().startVideoProcessing();
    triggerLateStaleReject();
    await Promise.all([run1Promise, run2Promise]);

    const finalState = useMediaStore.getState();
    expect(finalState.videoProcessStatus).toBe('ready');
    expect(finalState.videoProcessResult?.outputWidth).toBe(1920);
  });

  it('reuses cached full-res photo Blob instantaneously across repeated exports without re-running the Worker', async () => {
    vi.spyOn(fileValidator, 'validateMediaFile').mockResolvedValue({
      valid: true,
      kind: 'image',
      detectedMime: 'image/png',
      declaredMime: 'image/png',
      fileName: 'potret.png',
      sizeBytes: 20_000,
      signatureLabel: 'PNG',
      warnings: [],
    });
    vi.spyOn(metadataReader, 'readMediaMetadata').mockResolvedValue({
      kind: 'image',
      fileName: 'potret.png',
      mimeType: 'image/png',
      sizeBytes: 20_000,
      width: 1200,
      height: 800,
      orientation: 'landscape',
      aspectRatio: '3:2',
      exifOrientation: null,
      hasAlpha: false,
      isAnimated: false,
    });

    const spy = vi.spyOn(imageEngineClient, 'processImage').mockImplementation(async (req) => ({
      requestId: req.requestId,
      backend: 'worker-offscreen-canvas',
      outputBlob: new Blob(['2k-jpeg'], { type: req.edit.outputFormat }),
      outputFileName: buildExportFileName(
        req.file.name,
        req.edit.outputFormat,
        req.edit.targetResolution
      ),
      outputMime: req.edit.outputFormat,
      outputWidth: req.previewMaxEdgePx ? 1600 : 2560,
      outputHeight: req.previewMaxEdgePx ? 1067 : 1707,
      inputBytes: req.file.size,
      outputBytes: req.previewMaxEdgePx ? 50_000 : 240_000,
      durationMs: 18,
    }));
    vi.spyOn(imageEngineClient, 'generateBaseThumbnail').mockResolvedValue(
      new Blob(['thumb'], { type: 'image/jpeg' })
    );

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'potret.png', { type: 'image/png' });
    await useMediaStore.getState().addMediaFiles([file], { replace: true });
    await new Promise((r) => setTimeout(r, 15));

    useMediaStore.getState().updateImageEdit(
      { targetResolution: '2k', proTools: ['sharpen'] },
      { commitHistory: true, preservePreset: true }
    );
    await new Promise((r) => setTimeout(r, 15));
    expect(useMediaStore.getState().items[0].needsFullResExport).toBe(true);

    const callsBeforeFirstExport = spy.mock.calls.length;
    const firstExport = await useMediaStore.getState().ensureFullResPhotoExport();
    expect(firstExport?.result.outputWidth).toBe(2560);
    expect(spy).toHaveBeenCalledTimes(callsBeforeFirstExport + 1);

    // Repeating export with identical editGeneration MUST hit cached Blob immediately (0 extra Worker calls)
    const callsAfterFirstExport = spy.mock.calls.length;
    const cachedExport = await useMediaStore.getState().ensureFullResPhotoExport();
    expect(cachedExport?.url).toBe(firstExport?.url);
    expect(spy).toHaveBeenCalledTimes(callsAfterFirstExport);

    // Editing increments editGeneration -> forces fresh render cleanly on next export
    useMediaStore.getState().updateImageEdit(
      { proTools: ['sharpen', 'dehaze'] },
      { commitHistory: true, preservePreset: true }
    );
    await new Promise((r) => setTimeout(r, 15));
    const thirdExport = await useMediaStore.getState().ensureFullResPhotoExport();
    expect(thirdExport?.result.outputWidth).toBe(2560);
    expect(spy.mock.calls.length).toBeGreaterThan(callsAfterFirstExport);
  });

  it('runs heavy Pro Photo tools (dehaze/deblur) at pre-upscale source dimensions BEFORE 2K upscaling and fused single-pass post-sharpen', async () => {
    const getImageDataSizes: Array<{ w: number; h: number }> = [];
    const adapter = makeMockAdapter(getImageDataSizes);
    const fakeBitmap = {
      width: 240,
      height: 160,
      close() {},
    } as unknown as ImageBitmap;

    const edit = structuredClone(getMediaPreset('whatsapp-hd').image);
    edit.targetResolution = '2k';
    edit.proTools = ['dehaze', 'deblur', 'sharpen'];
    edit.proToolStrength = 80;

    const out = await runImagePipeline(fakeBitmap, edit, adapter, undefined, {
      allow8K: true,
      isMobileThermalGuard: false,
    });

    expect(out.width).toBe(2560);
    expect(out.height).toBe(1707);
    // Pre-upscale pass must have captured at source 240x160 BEFORE 2560x1707 single fused post-pass!
    expect(getImageDataSizes).toEqual([
      { w: 240, h: 160 },
      { w: 2560, h: 1707 },
    ]);
  });
});
