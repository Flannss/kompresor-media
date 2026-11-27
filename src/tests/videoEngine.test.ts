import { describe, expect, it } from 'vitest';
import {
  buildVideoExportFileName,
  clampTrimRange,
  computeEvenScaledDimensions,
  resolveCustomVideoParams,
} from '../engines/video/videoPresets';
import { getMediaPreset, MEDIA_PRESETS } from '../presets/mediaPresets';

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

  it('provides consistent video preset configurations across all 6 calibrated destinations', () => {
    expect(MEDIA_PRESETS.length).toBe(6);
    expect(getMediaPreset('whatsapp-hd').video.maxHeightPx).toBe(1080);
    expect(getMediaPreset('whatsapp-hd').video.targetBitrateBps).toBe(4_500_000);
    expect(getMediaPreset('whatsapp-fast').video.maxHeightPx).toBe(720);
    expect(getMediaPreset('whatsapp-status').video.maxHeightPx).toBe(1080);
    expect(getMediaPreset('instagram-story').video.maxHeightPx).toBe(1080);
    expect(getMediaPreset('web-light').video.maxHeightPx).toBe(480);

    // HD upscale capped cleanly at 1080p with even dimensions
    expect(computeEvenScaledDimensions(854, 480, 1080, 2)).toEqual({ width: 1708, height: 960 });
    expect(computeEvenScaledDimensions(1280, 720, 1080, 2)).toEqual({ width: 1920, height: 1080 });
  });
});
