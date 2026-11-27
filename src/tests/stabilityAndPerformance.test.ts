import { describe, expect, it, vi } from 'vitest';
import type { ColorGradeId } from '../engines/contracts';
import {
  applyEdgePreservingDenoiseParams,
  applySharpen,
} from '../engines/image/pixelOps';
import {
  COLOR_GRADE_PRESETS,
  createDefaultColorGrade,
  getCssPreviewFilter,
} from '../engines/shared/colorGrades';
import {
  CHUNK_RELOAD_COOLDOWN_MS,
  CHUNK_RELOAD_STORAGE_KEY,
  isStaleChunkError,
  recoverFromStaleChunkError,
} from '../shared/utils/chunkRecovery';
import { getDeviceProfile } from '../shared/utils/deviceCapability';

function makeMockStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>();
  return {
    getItem(key) {
      return map.get(key) ?? null;
    },
    setItem(key, val) {
      map.set(key, val);
    },
  };
}

describe('KM-T007 stability, stale chunk recovery, and iOS/mobile performance', () => {
  it('classifies iPhone X, high-RAM mobile, and Desktop performance tiers accurately', () => {
    const iphoneX = getDeviceProfile({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      viewportWidth: 375,
      deviceMemoryGB: null,
      hardwareConcurrency: null,
      maxTouchPoints: 5,
    });
    expect(iphoneX).toMatchObject({
      isIOS: true,
      isWebKitSafari: true,
      performanceTier: 'low-memory-mobile',
      maxPreviewEdge: 960,
      previewDebounceMs: 140,
      imageWorkerPoolSize: 1,
      maxQueuePhotos: 6,
      maxQueueVideos: 2,
      maxQueueTotal: 6,
      useLightweightCssPreview: true,
      releaseFfmpegAfterExport: true,
    });

    const highMobile = getDeviceProfile({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0.0.0 Mobile',
      viewportWidth: 412,
      deviceMemoryGB: 8,
      hardwareConcurrency: 8,
      maxTouchPoints: 5,
    });
    expect(highMobile).toMatchObject({
      isIOS: false,
      isWebKitSafari: false,
      performanceTier: 'standard-mobile',
      maxPreviewEdge: 1280,
      previewDebounceMs: 90,
      imageWorkerPoolSize: 1,
      useLightweightCssPreview: false,
      releaseFfmpegAfterExport: false,
    });

    const desktop = getDeviceProfile({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0',
      viewportWidth: 1440,
      deviceMemoryGB: 8,
      hardwareConcurrency: 8,
      maxTouchPoints: 0,
    });
    expect(desktop).toMatchObject({
      isIOS: false,
      performanceTier: 'desktop',
      maxPreviewEdge: 1600,
      previewDebounceMs: 60,
      imageWorkerPoolSize: 2,
      maxQueueTotal: 9,
      useLightweightCssPreview: false,
      releaseFfmpegAfterExport: false,
    });
  });

  it('produces lightweight pure-CSS preview filters for all 7 color grades', () => {
    expect(getCssPreviewFilter(createDefaultColorGrade())).toBe('none');
    expect(
      getCssPreviewFilter({
        gradeId: 'teal-orange',
        intensity: 0,
        tone: createDefaultColorGrade().tone,
      })
    ).toBe('none');

    const nonOriginalOutputs = new Set<string>();
    for (const preset of COLOR_GRADE_PRESETS) {
      if (preset.id === 'original') continue;
      const css = getCssPreviewFilter({
        gradeId: preset.id as ColorGradeId,
        intensity: 100,
        tone: createDefaultColorGrade().tone,
      });
      expect(css).not.toBe('none');
      expect(css).toContain('brightness(');
      expect(css).toContain('contrast(');
      expect(css).toContain('saturate(');
      if (preset.id === 'noir-bw') {
        expect(css).toContain('grayscale(1.000)');
      }
      nonOriginalOutputs.add(css);
    }
    expect(nonOriginalOutputs.size).toBe(6);
  });

  it('detects stale dynamic import errors and guards auto-reload against infinite loops', () => {
    expect(
      isStaleChunkError(
        new TypeError('Failed to fetch dynamically imported module: https://example/x.js')
      )
    ).toBe(true);
    expect(isStaleChunkError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new Error('Loading chunk 42 failed.'))).toBe(true);
    expect(isStaleChunkError(new Error('Invalid video dimensions'))).toBe(false);

    const storage = makeMockStorage();
    const reload = vi.fn();
    let fakeTime = 1_000_000;

    const first = recoverFromStaleChunkError(
      new Error('Failed to fetch dynamically imported module: /assets/old.js'),
      { storage, reload, now: () => fakeTime }
    );
    expect(first).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHUNK_RELOAD_STORAGE_KEY)).toBe(String(fakeTime));

    // Cooldown window blocks immediate loop
    fakeTime += CHUNK_RELOAD_COOLDOWN_MS - 1_000;
    const second = recoverFromStaleChunkError(new Error('Importing a module script failed.'), {
      storage,
      reload,
      now: () => fakeTime,
    });
    expect(second).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    // After cooldown expires, recovery is permitted again
    fakeTime += 2_000;
    const third = recoverFromStaleChunkError(new Error('Loading chunk 99 failed'), {
      storage,
      reload,
      now: () => fakeTime,
    });
    expect(third).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('processes multi-row 6x6 images cleanly with 3-row rolling buffers for denoise and sharpen', () => {
    const w = 6;
    const h = 6;
    const raw = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const idx = (y * w + x) * 4;
        raw[idx] = 100;
        raw[idx + 1] = 100;
        raw[idx + 2] = 100;
        raw[idx + 3] = 245;
      }
    }
    // Single noise spike at (2, 3) within tolerance
    const spikeIdx = (3 * w + 2) * 4;
    raw[spikeIdx] = 114;
    raw[spikeIdx + 1] = 114;
    raw[spikeIdx + 2] = 114;

    const denoiseImg = { width: w, height: h, data: new Uint8ClampedArray(raw) } as unknown as ImageData;
    applyEdgePreservingDenoiseParams(denoiseImg, 5, 4);
    expect(denoiseImg.data[spikeIdx]).toBeLessThan(114);
    expect(denoiseImg.data[spikeIdx + 3]).toBe(245);

    const sharpImg = { width: w, height: h, data: new Uint8ClampedArray(raw) } as unknown as ImageData;
    applySharpen(sharpImg, 60, true);
    expect(sharpImg.data[spikeIdx]).toBeGreaterThan(114);
    expect(sharpImg.data[spikeIdx + 3]).toBe(245);
  });
});
