import { describe, expect, it } from 'vitest';
import {
  applyColorGradeToImageData,
  applyEnhanceRecipe,
  buildColorGradeFfmpegFilters,
  buildSvgFilterParams,
  COLOR_GRADE_PRESETS,
  compute1080pTargetDimensions,
  createDefaultColorGrade,
  createDefaultEnhanceSuite,
  hasActiveColorGrade,
  hasActiveEnhancements,
} from '../engines/shared/colorGrades';

const ALLOWED_FFMPEG_FILTER_PREFIXES = [
  'eq=',
  'colorchannelmixer=',
  'colorbalance=',
  'curves=',
];

describe('1080p Enhancement Suite & LUT-free 7-Look Color Grading Engine', () => {
  it('supports all 3 1-tap enhancement recipes cleanly', () => {
    const defaults = createDefaultEnhanceSuite();
    expect(hasActiveEnhancements(defaults)).toBe(false);

    const dark = applyEnhanceRecipe('dark-footage', defaults);
    expect(dark.noise.enabled).toBe(true);
    expect(dark.colorContrast.enabled).toBe(true);
    expect(dark.colorContrast.shadowBright).toBeGreaterThan(0);

    const crisp = applyEnhanceRecipe('crisp-text', defaults);
    expect(crisp.sharpen.enabled).toBe(true);
    expect(crisp.upscale1080.enabled).toBe(true);
    expect(crisp.sharpen.strength).toBeGreaterThanOrEqual(1.2);

    const balanced = applyEnhanceRecipe('hd-balanced', defaults);
    expect(balanced.noise.enabled).toBe(true);
    expect(balanced.sharpen.enabled).toBe(true);
    expect(balanced.colorContrast.enabled).toBe(true);
    expect(balanced.upscale1080.enabled).toBe(true);
  });

  it('computes orientation-aware 1080p HD even dimensions with keepAspect lock vs crop-fill', () => {
    expect(compute1080pTargetDimensions(640, 360, true)).toEqual({ width: 1920, height: 1080 });
    expect(compute1080pTargetDimensions(360, 640, true)).toEqual({ width: 1080, height: 1920 });
    expect(compute1080pTargetDimensions(854, 480, true)).toEqual({ width: 1920, height: 1078 });
    expect(compute1080pTargetDimensions(1000, 1000, true)).toEqual({ width: 1080, height: 1080 });
    expect(compute1080pTargetDimensions(1000, 1000, false)).toEqual({ width: 1920, height: 1080 });
    expect(compute1080pTargetDimensions(500, 900, false)).toEqual({ width: 1080, height: 1920 });
  });

  it('builds valid LUT-free FFmpeg segments and SVG filter params across all 7 grades', () => {
    for (const preset of COLOR_GRADE_PRESETS) {
      const state = {
        gradeId: preset.id,
        intensity: 85,
        tone: { temperature: 10, tint: -5, shadows: 8, highlights: -8 },
      };
      const segments = buildColorGradeFfmpegFilters(state);
      for (const seg of segments) {
        expect(
          ALLOWED_FFMPEG_FILTER_PREFIXES.some((prefix) => seg.startsWith(prefix))
        ).toBe(true);
        expect(seg.includes('lut3d')).toBe(false);
        expect(seg.includes('haldclut')).toBe(false);
      }

      const svg = buildSvgFilterParams(state);
      expect(svg.active).toBe(true);
      expect(svg.matrixValues.split(' ').length).toBe(20);
    }
  });

  it('blends grade intensity smoothly from 0% to 100% on ImageData', () => {
    const base = new Uint8ClampedArray([140, 110, 90, 255]);
    const zeroBlend = { width: 1, height: 1, data: new Uint8ClampedArray(base) } as unknown as ImageData;
    applyColorGradeToImageData(zeroBlend, {
      gradeId: 'teal-orange',
      intensity: 0,
      tone: createDefaultColorGrade().tone,
    });
    expect(zeroBlend.data[0]).toBe(140);
    expect(zeroBlend.data[2]).toBe(90);

    const fullBlend = { width: 1, height: 1, data: new Uint8ClampedArray(base) } as unknown as ImageData;
    applyColorGradeToImageData(fullBlend, {
      gradeId: 'teal-orange',
      intensity: 100,
      tone: createDefaultColorGrade().tone,
    });
    expect(`${fullBlend.data[0]},${fullBlend.data[1]},${fullBlend.data[2]}`).not.toBe('140,110,90');

    expect(
      hasActiveColorGrade({
        gradeId: 'original',
        intensity: 100,
        tone: { temperature: 0, tint: 0, shadows: 0, highlights: 0 },
      })
    ).toBe(false);
    expect(
      hasActiveColorGrade({
        gradeId: 'original',
        intensity: 100,
        tone: { temperature: 15, tint: 0, shadows: 0, highlights: 0 },
      })
    ).toBe(true);
  });
});
