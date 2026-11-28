import { describe, expect, it } from 'vitest';
import {
  buildVideoExportFileName,
  clampTrimRange,
  computeEvenScaledDimensions,
  computeVideoTargetDimensions,
  resolveCustomVideoParams,
} from '../engines/video/videoPresets';
import { getMediaPreset, MEDIA_PRESETS } from '../presets/mediaPresets';
import { getDeviceProfile } from '../shared/utils/deviceCapability';
import { useMediaStore } from '../store/useMediaStore';

describe('video presets, trim helpers, and even scaling', () => {
  it('computes aspect-preserving even dimensions without upscaling', () => {
    // Downscale 1080p landscape to 720p -> 1280x720
    expect(computeEvenScaledDimensions(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    // Irregular aspect ratio forced to even integers for libx264 / H.264 YUV420p
    const scaledOdd = computeEvenScaledDimensions(853, 480, 480);
    expect(scaledOdd.width % 2).toBe(0);
    expect(scaledOdd.height % 2).toBe(0);
    expect(scaledOdd).toEqual({ width: 852, height: 480 });

    // No upscaling if source height <= maxHeightPx
    expect(computeEvenScaledDimensions(854, 480, 1080)).toEqual({ width: 854, height: 480 });
    expect(computeEvenScaledDimensions(641, 361, null)).toEqual({ width: 640, height: 360 });
  });

  it('clamps trim ranges safely within total duration and respects minimum gap', () => {
    expect(clampTrimRange(0, null, 45)).toEqual({
      startSec: 0,
      endSec: 45,
      durationSec: 45,
      isTrimmed: false,
    });

    expect(clampTrimRange(-5, 30, 45)).toEqual({
      startSec: 0,
      endSec: 30,
      durationSec: 30,
      isTrimmed: true,
    });

    // Ensures end >= start + 0.2 even when user passes overlapping bounds
    expect(clampTrimRange(10, 10, 45)).toEqual({
      startSec: 10,
      endSec: 10.2,
      durationSec: 0.2,
      isTrimmed: true,
    });

    // Caps beyond total duration
    expect(clampTrimRange(5, 99, 12.5)).toEqual({
      startSec: 5,
      endSec: 12.5,
      durationSec: 7.5,
      isTrimmed: true,
    });
  });

  it('resolves video quality tiers consistently', () => {
    const light = resolveCustomVideoParams('light');
    const balanced = resolveCustomVideoParams('balanced');
    const high = resolveCustomVideoParams('high');

    expect(light.crf).toBeGreaterThan(balanced.crf);
    expect(balanced.crf).toBeGreaterThan(high.crf);
    expect(light.targetBitrateBps).toBeLessThan(balanced.targetBitrateBps);
    expect(balanced.targetBitrateBps).toBeLessThan(high.targetBitrateBps);
  });

  it('builds multi-format MP4/MOV/WebM/MKV export filenames for Indonesian studio outputs', () => {
    expect(buildVideoExportFileName('clip-liburan.MOV', 'mp4')).toBe('clip-liburan-kompresor.mp4');
    expect(buildVideoExportFileName('kamera.depan.webm', 'mov')).toBe('kamera.depan-kompresor.mov');
    expect(buildVideoExportFileName('video', 'mkv')).toBe('video-kompresor.mkv');
    expect(buildVideoExportFileName('video.mp4', 'webm')).toBe('video-kompresor.webm');
  });

  it('provides consistent video preset configurations across all calibrated destinations', () => {
    expect(MEDIA_PRESETS.length).toBe(11);
    const waHd = getMediaPreset('whatsapp-hd').video;
    expect(waHd.targetResolution).toBe('1080p');
    expect(waHd.maxHeightPx).toBe(1080);
    expect(waHd.fpsCap).toBe(30);
    expect(waHd.crf).toBe(19);
    expect(waHd.maxrateKbps).toBe(7500);
    expect(waHd.bufsizeKbps).toBe(15000);
    expect(waHd.targetBitrateBps).toBe(7_000_000);
    expect(waHd.audioBitrateKbps).toBe(128);
    expect(waHd.clarityModel).toBe('natural-hd');

    expect(getMediaPreset('whatsapp-fast').video.maxHeightPx).toBe(720);

    const waStatus = getMediaPreset('whatsapp-status').video;
    expect(waStatus.targetResolution).toBe('1080p');
    expect(waStatus.maxHeightPx).toBe(1080);
    expect(waStatus.fpsCap).toBe(30);
    expect(waStatus.crf).toBe(20);
    expect(waStatus.maxrateKbps).toBe(4800);
    expect(waStatus.bufsizeKbps).toBe(9600);
    expect(waStatus.audioBitrateKbps).toBe(128);
    expect(waStatus.clarityModel).toBe('natural-hd');

    const igStory = getMediaPreset('instagram-story').video;
    expect(igStory.maxHeightPx).toBe(1080);
    expect(igStory.maxrateKbps).toBe(8000);
    expect(igStory.audioBitrateKbps).toBe(160);

    const tiktok = getMediaPreset('tiktok-hd').video;
    expect(tiktok.maxHeightPx).toBe(1080);
    expect(tiktok.fpsCap).toBe(30);
    expect(tiktok.maxrateKbps).toBe(8500);
    expect(tiktok.audioBitrateKbps).toBe(160);

    expect(getMediaPreset('web-light').video.maxHeightPx).toBe(720);
    expect(getMediaPreset('web-light').video.maxrateKbps).toBe(2400);

    // HD upscale capped cleanly at 1080p with even dimensions
    expect(computeEvenScaledDimensions(854, 480, 1080, 2)).toEqual({ width: 1708, height: 960 });
    expect(computeEvenScaledDimensions(1280, 720, 1080, 2)).toEqual({ width: 1920, height: 1080 });
    expect(computeVideoTargetDimensions(640, 360, '1080p', 1080)).toEqual({ width: 1920, height: 1080 });
    expect(computeVideoTargetDimensions(360, 640, '1080p', 1080)).toEqual({ width: 1080, height: 1920 });
    expect(computeVideoTargetDimensions(1920, 1080, '2k', 1440)).toEqual({ width: 2560, height: 1440 });
  });

  it('keeps 1080p HD unlocked on iPhone X while guarding 2K video and honoring explicit desktop 2K across presets', () => {
    const iphoneX = getDeviceProfile({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) Safari/604.1',
      viewportWidth: 375,
      deviceMemoryGB: null,
      hardwareConcurrency: null,
      maxTouchPoints: 5,
    });
    expect(iphoneX.allow2KVideoExport).toBe(false);
    expect(iphoneX.releaseFfmpegAfterExport).toBe(true);

    const desktop = getDeviceProfile({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0',
      viewportWidth: 1440,
      deviceMemoryGB: 8,
      hardwareConcurrency: 8,
      maxTouchPoints: 0,
    });
    expect(desktop.allow2KVideoExport).toBe(true);

    useMediaStore.getState().clearMedia();
    useMediaStore.setState({
      deviceProfile: desktop,
      items: [
        {
          id: 'vid-desk-1',
          file: new File(['mp4'], 'clip.mp4', { type: 'video/mp4' }),
          validation: { valid: true, kind: 'video', mimeType: 'video/mp4', signatureLabel: 'MP4' },
          metadata: {
            kind: 'video',
            fileName: 'clip.mp4',
            mimeType: 'video/mp4',
            sizeBytes: 2_000_000,
            width: 1280,
            height: 720,
            orientation: 'landscape',
            durationSec: 10,
            hasAudioHint: true,
          },
          objectUrl: 'blob:mock/vid',
          status: 'ready',
          progress: 0,
          selectedPresetId: 'whatsapp-hd',
          imageEdit: getMediaPreset('whatsapp-hd').image,
          photoHistory: [getMediaPreset('whatsapp-hd').image],
          photoHistoryIndex: 0,
          imageResult: null,
          needsFullResExport: false,
          videoEdit: structuredClone(getMediaPreset('whatsapp-hd').video),
          videoProgress: null,
          videoResult: null,
          outputUrl: null,
          errorMessage: null,
          baseThumbnailUrl: null,
          processSeq: 0,
        },
      ],
      activeItemId: 'vid-desk-1',
    } as never);

    // Explicit 2K target stays 2K even if user changes preset afterwards
    useMediaStore.getState().updateVideoEdit({ targetResolution: '2k' });
    expect(useMediaStore.getState().videoEdit.targetResolution).toBe('2k');
    expect(useMediaStore.getState().videoEdit.maxHeightPx).toBe(1440);
    useMediaStore.getState().setPreset('whatsapp-status');
    expect(useMediaStore.getState().videoEdit.targetResolution).toBe('2k');
    expect(useMediaStore.getState().videoEdit.maxHeightPx).toBe(1440);
  });
});
