import { beforeEach, describe, expect, it } from 'vitest';
import type { ColorGradeId } from '../engines/contracts';
import {
  applyColorAdjustments,
  applyEdgePreservingDenoiseParams,
  applySharpen,
  buildExportFileName,
  computeCropPixels,
  computeProgressiveSteps,
  computeReductionPct,
  computeRotatedDimensions,
  computeTargetDimensions,
  formatOutputMimeShort,
} from '../engines/image/pixelOps';
import {
  applyColorGradeToImageData,
  COLOR_GRADE_PRESETS,
  compute1080pTargetDimensions,
} from '../engines/shared/colorGrades';
import { getMediaPreset, MEDIA_PRESETS } from '../presets/mediaPresets';
import { useMediaStore } from '../store/useMediaStore';

function makeSolidImageData(r: number, g: number, b: number, a = 255): ImageData {
  const data = new Uint8ClampedArray([r, g, b, a, r + 20, g, Math.max(0, b - 20), a]);
  return { width: 2, height: 1, data } as unknown as ImageData;
}

describe('image pixelOps, 1080p HD Enhance Suite, Color Grades, and studio history', () => {
  beforeEach(() => {
    useMediaStore.getState().clearMedia();
  });

  it('computes rotated dimensions accurately for 0/90/180/270', () => {
    expect(computeRotatedDimensions(2400, 1600, 0)).toEqual({ width: 2400, height: 1600 });
    expect(computeRotatedDimensions(2400, 1600, 90)).toEqual({ width: 1600, height: 2400 });
    expect(computeRotatedDimensions(2400, 1600, 180)).toEqual({ width: 2400, height: 1600 });
    expect(computeRotatedDimensions(2400, 1600, 270)).toEqual({ width: 1600, height: 2400 });
  });

  it('computes normalized crop rectangles in pixels with boundary clamping', () => {
    expect(computeCropPixels(2000, 1000, null)).toEqual({ sx: 0, sy: 0, sw: 2000, sh: 1000 });
    expect(
      computeCropPixels(2000, 1000, { x: 0.1, y: 0.2, width: 0.5, height: 0.5 })
    ).toEqual({ sx: 200, sy: 200, sw: 1000, sh: 500 });
    expect(
      computeCropPixels(1000, 1000, { x: -0.2, y: 0.9, width: 2, height: 0.5 })
    ).toEqual({ sx: 0, sy: 900, sw: 1000, sh: 100 });
  });

  it('computes aspect-preserving target dimensions and orientation-aware 1080p dimensions', () => {
    expect(computeTargetDimensions(2400, 1600, 1600)).toEqual({ width: 1600, height: 1067 });
    expect(computeTargetDimensions(1200, 2400, 1920)).toEqual({ width: 960, height: 1920 });
    expect(computeTargetDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(computeTargetDimensions(2400, 1600, null)).toEqual({ width: 2400, height: 1600 });

    // 720p landscape -> 1920x1080
    expect(compute1080pTargetDimensions(1280, 720, true)).toEqual({
      width: 1920,
      height: 1080,
    });
    // 720x1280 portrait -> 1080x1920
    expect(compute1080pTargetDimensions(720, 1280, true)).toEqual({
      width: 1080,
      height: 1920,
    });
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

  it('applies edge-preserving denoise parameters while preserving alpha', () => {
    const data = new Uint8ClampedArray(3 * 3 * 4);
    for (let i = 0; i < 9; i += 1) {
      data[i * 4] = 100;
      data[i * 4 + 1] = 105;
      data[i * 4 + 2] = 110;
      data[i * 4 + 3] = 220;
    }
    data[4 * 4] = 112;
    data[4 * 4 + 1] = 115;
    data[4 * 4 + 2] = 118;
    const img = { width: 3, height: 3, data } as unknown as ImageData;

    applyEdgePreservingDenoiseParams(img, 5, 4);
    expect(img.data[4 * 4]).toBeLessThan(112);
    expect(img.data[4 * 4 + 3]).toBe(220);
  });

  it('applies color adjustments accurately with [0, 255] clamping and alpha preservation', () => {
    const brighter = makeSolidImageData(100, 120, 140, 210);
    applyColorAdjustments(brighter, { brightness: 50, contrast: 0, saturation: 0, temperature: 0 });
    expect(brighter.data[0]).toBeGreaterThan(100);
    expect(brighter.data[3]).toBe(210);

    const desaturated = makeSolidImageData(200, 80, 40, 255);
    applyColorAdjustments(desaturated, {
      brightness: 0,
      contrast: 0,
      saturation: -100,
      temperature: 0,
    });
    expect(desaturated.data[0]).toBe(desaturated.data[1]);
    expect(desaturated.data[1]).toBe(desaturated.data[2]);

    const warmer = makeSolidImageData(120, 120, 120, 255);
    applyColorAdjustments(warmer, { brightness: 0, contrast: 0, saturation: 0, temperature: 60 });
    expect(warmer.data[0]).toBeGreaterThan(warmer.data[2]);
  });

  it('applies all 7 Color Grade presets with distinct pixel outputs and Noir B&W luma parity', () => {
    expect(COLOR_GRADE_PRESETS.map((f) => f.id)).toEqual([
      'original',
      'iphone-pro',
      'teal-orange',
      'golden-hour',
      'vintage-kodak',
      'vivid-hdr',
      'noir-bw',
    ]);

    const signatures = new Set<string>();
    for (const preset of COLOR_GRADE_PRESETS) {
      const img = makeSolidImageData(150, 110, 90, 240);
      applyColorGradeToImageData(img, {
        gradeId: preset.id as ColorGradeId,
        intensity: 100,
        tone: { temperature: 0, tint: 0, shadows: 0, highlights: 0 },
      });
      expect(img.data[3]).toBe(240);
      signatures.add(`${img.data[0]},${img.data[1]},${img.data[2]}`);
      if (preset.id === 'noir-bw') {
        expect(img.data[0]).toBe(img.data[1]);
        expect(img.data[1]).toBe(img.data[2]);
      }
    }
    expect(signatures.size).toBe(COLOR_GRADE_PRESETS.length);
  });

  it('applies 3x3 sharpening with anti-artifact option and alpha preservation', () => {
    const data = new Uint8ClampedArray(3 * 3 * 4);
    for (let i = 0; i < 9; i += 1) {
      data[i * 4] = 40;
      data[i * 4 + 1] = 40;
      data[i * 4 + 2] = 40;
      data[i * 4 + 3] = 200;
    }
    data[4 * 4] = 180;
    data[4 * 4 + 1] = 180;
    data[4 * 4 + 2] = 180;
    data[4 * 4 + 3] = 123;

    const fakeImageData = { width: 3, height: 3, data } as unknown as ImageData;
    applySharpen(fakeImageData, 0, true);
    expect(fakeImageData.data[4 * 4]).toBe(180);

    applySharpen(fakeImageData, 50, true);
    expect(fakeImageData.data[4 * 4]).toBe(255);
    expect(fakeImageData.data[4 * 4 + 3]).toBe(123);
  });

  it('builds Indonesian export filenames (including AVIF) and reduction percentages', () => {
    expect(buildExportFileName('liburan.png', 'image/jpeg')).toBe('liburan-kompresor.jpg');
    expect(buildExportFileName('foto.lama.jpg', 'image/webp')).toBe('foto.lama-kompresor.webp');
    expect(buildExportFileName('potret.png', 'image/avif')).toBe('potret-kompresor.avif');
    expect(buildExportFileName('logo', 'image/png')).toBe('logo-kompresor.png');

    expect(computeReductionPct(1000, 250)).toBe(75);
    expect(formatOutputMimeShort('image/jpeg')).toBe('JPG');
    expect(formatOutputMimeShort('image/webp')).toBe('WebP');
    expect(formatOutputMimeShort('image/avif')).toBe('AVIF');
    expect(formatOutputMimeShort('image/png')).toBe('PNG');
  });

  it('exposes all calibrated Indonesian share presets including WhatsApp HD, Vlog HD, and Long Video', () => {
    expect(MEDIA_PRESETS.length).toBe(11);
    const waHd = getMediaPreset('whatsapp-hd').image;
    expect(waHd.maxEdgePx).toBe(2560);
    expect(waHd.outputFormat).toBe('image/jpeg');
    expect(waHd.quality).toBe(0.92);
    expect(waHd.targetSizeKB).toBe(3584);
    expect(waHd.sharpenAmount).toBe(12);

    expect(getMediaPreset('whatsapp-fast').image.maxEdgePx).toBe(1600);

    const waStatus = getMediaPreset('whatsapp-status').image;
    expect(waStatus.maxEdgePx).toBe(1920);
    expect(waStatus.outputFormat).toBe('image/jpeg');
    expect(waStatus.quality).toBe(0.92);
    expect(waStatus.targetSizeKB).toBe(1600);

    expect(getMediaPreset('archive-hd').image.qualityModel).toBe('high-quality');
    expect(getMediaPreset('web-light').image.outputFormat).toBe('image/webp');
  });

  it('manages photo Undo, Redo, and Reset history snapshots cleanly', () => {
    const store = useMediaStore.getState();
    expect(store.photoHistoryIndex).toBe(0);

    store.rotatePhoto90();
    store.toggleFlipH();
    store.selectColorGrade('teal-orange');

    let next = useMediaStore.getState();
    expect(next.photoHistoryIndex).toBe(3);
    expect(next.imageEdit.rotationDeg).toBe(90);
    expect(next.imageEdit.flipH).toBe(true);
    expect(next.imageEdit.colorGrade.gradeId).toBe('teal-orange');

    next.updateImageEdit(
      { adjustments: { ...next.imageEdit.adjustments, contrast: 25 } },
      { commitHistory: false, preservePreset: true }
    );
    expect(useMediaStore.getState().photoHistoryIndex).toBe(3);
    useMediaStore.getState().commitCurrentPhotoSnapshot();
    expect(useMediaStore.getState().photoHistoryIndex).toBe(4);
    expect(useMediaStore.getState().imageEdit.adjustments.contrast).toBe(25);

    useMediaStore.getState().undoPhotoEdit();
    expect(useMediaStore.getState().imageEdit.adjustments.contrast).toBe(0);
    expect(useMediaStore.getState().imageEdit.colorGrade.gradeId).toBe('teal-orange');

    useMediaStore.getState().undoPhotoEdit();
    expect(useMediaStore.getState().imageEdit.colorGrade.gradeId).toBe('original');

    useMediaStore.getState().redoPhotoEdit();
    expect(useMediaStore.getState().imageEdit.colorGrade.gradeId).toBe('teal-orange');

    useMediaStore.getState().resetPhotoEdits();
    next = useMediaStore.getState();
    expect(next.imageEdit.rotationDeg).toBe(0);
    expect(next.imageEdit.flipH).toBe(false);
    expect(next.imageEdit.colorGrade.gradeId).toBe('original');
    expect(next.imageEdit.adjustments.contrast).toBe(0);
  });
});
