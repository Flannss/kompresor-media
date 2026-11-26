import { describe, expect, it } from 'vitest';
import {
  applySharpen,
  buildExportFileName,
  computeProgressiveSteps,
  computeReductionPct,
  computeRotatedDimensions,
  computeTargetDimensions,
  formatOutputMimeShort,
} from '../engines/image/pixelOps';
import { getMediaPreset, MEDIA_PRESETS } from '../presets/mediaPresets';

describe('image pixelOps & presets', () => {
  it('computes rotated dimensions accurately for 0/90/180/270', () => {
    expect(computeRotatedDimensions(2400, 1600, 0)).toEqual({ width: 2400, height: 1600 });
    expect(computeRotatedDimensions(2400, 1600, 90)).toEqual({ width: 1600, height: 2400 });
    expect(computeRotatedDimensions(2400, 1600, 180)).toEqual({ width: 2400, height: 1600 });
    expect(computeRotatedDimensions(2400, 1600, 270)).toEqual({ width: 1600, height: 2400 });
  });

  it('computes aspect-preserving target dimensions without upscaling', () => {
    expect(computeTargetDimensions(2400, 1600, 1600)).toEqual({ width: 1600, height: 1067 });
    expect(computeTargetDimensions(1200, 2400, 1920)).toEqual({ width: 960, height: 1920 });
    expect(computeTargetDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(computeTargetDimensions(2400, 1600, null)).toEqual({ width: 2400, height: 1600 });
  });

  it('uses progressive step-down scaling only when downscaling more than 2x', () => {
    expect(computeProgressiveSteps(2400, 1600, 1600, 1067)).toEqual([
      { width: 1600, height: 1067 },
    ]);
    expect(computeProgressiveSteps(4000, 3000, 1600, 1200)).toEqual([
      { width: 2000, height: 1500 },
      { width: 1600, height: 1200 },
    ]);
  });

  it('applies 3x3 sharpening with [0, 255] clamping and alpha preservation', () => {
    const data = new Uint8ClampedArray(3 * 3 * 4);
    for (let i = 0; i < 9; i += 1) {
      data[i * 4] = 40;
      data[i * 4 + 1] = 40;
      data[i * 4 + 2] = 40;
      data[i * 4 + 3] = 200;
    }
    // Bright center pixel (index 4)
    data[4 * 4] = 180;
    data[4 * 4 + 1] = 180;
    data[4 * 4 + 2] = 180;
    data[4 * 4 + 3] = 123;

    const fakeImageData = { width: 3, height: 3, data } as unknown as ImageData;
    applySharpen(fakeImageData, 0);
    expect(fakeImageData.data[4 * 4]).toBe(180);

    applySharpen(fakeImageData, 50);
    // alpha = 0.325 => 180*(1+1.3) - 4*40*0.325 = 414 - 52 = 362 -> clamped to 255
    expect(fakeImageData.data[4 * 4]).toBe(255);
    expect(fakeImageData.data[4 * 4 + 3]).toBe(123);
  });

  it('builds Indonesian export filenames and reduction percentages', () => {
    expect(buildExportFileName('liburan.png', 'image/jpeg')).toBe('liburan-kompresor.jpg');
    expect(buildExportFileName('foto.lama.jpg', 'image/webp')).toBe('foto.lama-kompresor.webp');
    expect(buildExportFileName('logo', 'image/png')).toBe('logo-kompresor.png');

    expect(computeReductionPct(1000, 250)).toBe(75);
    expect(formatOutputMimeShort('image/jpeg')).toBe('JPG');
    expect(formatOutputMimeShort('image/webp')).toBe('WebP');
    expect(formatOutputMimeShort('image/png')).toBe('PNG');
  });

  it('exposes all 4 Indonesian share presets with valid image targets', () => {
    expect(MEDIA_PRESETS.map((p) => p.label)).toEqual([
      'WhatsApp',
      'Status WA',
      'Story IG',
      'Atur Sendiri',
    ]);
    expect(getMediaPreset('whatsapp-chat').image.maxEdgePx).toBe(1600);
    expect(getMediaPreset('whatsapp-status').image.maxEdgePx).toBe(1920);
  });
});
