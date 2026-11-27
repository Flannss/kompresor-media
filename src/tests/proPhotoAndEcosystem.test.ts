import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhotoFilterId } from '../engines/contracts';
import {
  applyPhotoFilterToImageData,
  getPhotoFilterCssPreview,
  PHOTO_FILTER_PRESETS,
} from '../engines/grading/photoFilters';
import {
  applyClarity,
  applyColorAdjustments,
  applyQualityModelPass,
  computePhotoTargetDimensions,
  computeProgressiveSteps,
  computeStraightenScale,
} from '../engines/image/pixelOps';
import {
  executePlatformShareFlow,
  PLATFORM_SHARE_META,
} from '../features/export-share/shareHelper';
import {
  getMediaPreset,
  PHOTO_PRESET_IDS,
  VIDEO_PRESET_IDS,
} from '../presets/mediaPresets';
import { getDeviceProfile } from '../shared/utils/deviceCapability';

function makePatternImageData(w = 6, h = 6): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = (y * w + x) * 4;
      const edge = (x + y) % 2 === 0 ? 155 : 95;
      data[idx] = edge;
      data[idx + 1] = edge - 25;
      data[idx + 2] = edge - 45;
      data[idx + 3] = 240;
    }
  }
  return { width: w, height: h, data } as unknown as ImageData;
}

describe('KM-T008 Pro Photo Studio (2K-8K RealPhoto, 12 Filters, Adjustments, Ecosystem)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('computes progressive 1.5x upscale steps and enforces mobile 8K & <12 MP memory guardrails', () => {
    const upSteps = computeProgressiveSteps(1000, 750, 3840, 2880);
    expect(upSteps.length).toBeGreaterThanOrEqual(3);
    expect(upSteps[upSteps.length - 1]).toEqual({ width: 3840, height: 2880 });
    expect(upSteps[0].width).toBeLessThanOrEqual(1500);

    const desktopProfile = getDeviceProfile({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0',
      viewportWidth: 1440,
      deviceMemoryGB: 8,
      hardwareConcurrency: 8,
      maxTouchPoints: 0,
    });
    expect(desktopProfile.useGlassLite).toBe(false);
    expect(desktopProfile.allow8KPhotoExport).toBe(true);

    const basePreset = getMediaPreset('whatsapp-hd').image;
    const desktop8k = computePhotoTargetDimensions(
      1200,
      800,
      { ...basePreset, targetResolution: '8k' },
      {
        maxCanvasPixels: desktopProfile.maxPhotoCanvasPixels,
        allow8K: desktopProfile.allow8KPhotoExport,
      }
    );
    expect(desktop8k).toEqual({
      width: 7680,
      height: 5120,
      clampedByMemoryGuard: false,
      appliedTargetResolution: '8k',
    });

    const iphoneX = getDeviceProfile({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) Safari/604.1',
      viewportWidth: 375,
      deviceMemoryGB: null,
      hardwareConcurrency: null,
      maxTouchPoints: 5,
    });
    expect(iphoneX.useGlassLite).toBe(true);
    expect(iphoneX.allow8KPhotoExport).toBe(false);
    expect(iphoneX.maxPhotoCanvasPixels).toBeLessThan(12_000_000);

    // 8K requested on mobile/iPhone X safely downgrades and clamps square 4K below 12 MP
    const mobileGuarded = computePhotoTargetDimensions(
      2000,
      2000,
      { ...basePreset, targetResolution: '8k' },
      {
        maxCanvasPixels: iphoneX.maxPhotoCanvasPixels,
        allow8K: iphoneX.allow8KPhotoExport,
      }
    );
    expect(mobileGuarded.appliedTargetResolution).toBe('4k');
    expect(mobileGuarded.clampedByMemoryGuard).toBe(true);
    expect(mobileGuarded.width * mobileGuarded.height).toBeLessThanOrEqual(11_500_000);
  });

  it('produces distinct pixel outputs for RealPhoto vs High Quality quality models', () => {
    const imgReal = makePatternImageData();
    const imgHq = makePatternImageData();

    applyQualityModelPass(imgReal, 'realphoto', 1.6);
    applyQualityModelPass(imgHq, 'high-quality', 1.6);

    let diffs = 0;
    for (let i = 0; i < imgReal.data.length; i += 4) {
      if (
        imgReal.data[i] !== imgHq.data[i] ||
        imgReal.data[i + 1] !== imgHq.data[i + 1] ||
        imgReal.data[i + 2] !== imgHq.data[i + 2]
      ) {
        diffs += 1;
      }
      expect(imgReal.data[i + 3]).toBe(240);
      expect(imgHq.data[i + 3]).toBe(240);
    }
    expect(diffs).toBeGreaterThan(0);
  });

  it('applies all 12 photo filters with distinct pixels, exact intensity scaling, Noir B&W parity, and CSS previews', () => {
    expect(PHOTO_FILTER_PRESETS.map((f) => f.id)).toEqual([
      'original',
      'realphoto',
      'flagship-pro',
      'cinematic',
      'golden-hour',
      'vintage-kodak',
      'vivid-hdr',
      'editorial-matte',
      'pastel-soft',
      'cool-studio',
      'moody-dark',
      'noir-bw',
    ]);

    const signatures = new Set<string>();
    const cssPreviews = new Set<string>();
    for (const look of PHOTO_FILTER_PRESETS) {
      const img = makePatternImageData(2, 2);
      const r0 = img.data[0];
      applyPhotoFilterToImageData(img, look.id as PhotoFilterId, 100);
      expect(img.data[3]).toBe(240);
      signatures.add(`${img.data[0]},${img.data[1]},${img.data[2]}`);

      if (look.id === 'noir-bw') {
        expect(img.data[0]).toBe(img.data[1]);
        expect(img.data[1]).toBe(img.data[2]);
      }

      // 0% intensity must preserve pixels completely
      const untouched = makePatternImageData(2, 2);
      applyPhotoFilterToImageData(untouched, look.id as PhotoFilterId, 0);
      expect(untouched.data[0]).toBe(r0);

      const css = getPhotoFilterCssPreview(look.id as PhotoFilterId, 100);
      if (look.id === 'original') {
        expect(css).toBe('none');
      } else {
        expect(css).not.toBe('none');
        cssPreviews.add(css);
      }
    }
    expect(signatures.size).toBe(12);
    expect(cssPreviews.size).toBe(11);
  });

  it('supports extended Pro Photo adjustments (Vibrance, Highlights, Shadows, Clarity, Vignette, Straighten)', () => {
    const imgVib = makePatternImageData(4, 4);
    const beforeSpread = imgVib.data[0] - imgVib.data[2];
    applyColorAdjustments(imgVib, { vibrance: 80 });
    expect(imgVib.data[0] - imgVib.data[2]).toBeGreaterThan(beforeSpread);

    const imgVig = makePatternImageData(10, 10);
    const centerIdx = (5 * 10 + 5) * 4;
    const cornerIdx = 0;
    applyColorAdjustments(imgVig, { vignette: 80 });
    expect(imgVig.data[centerIdx]).toBeGreaterThan(imgVig.data[cornerIdx]);

    const imgClarity = makePatternImageData(6, 6);
    applyClarity(imgClarity, 70);
    expect(imgClarity.data[3]).toBe(240);

    expect(computeStraightenScale(1600, 1200, 0)).toBe(1);
    expect(computeStraightenScale(1600, 1200, 10)).toBeGreaterThan(1.1);
  });

  it('exposes multi-platform Photo & Video presets and honest WhatsApp/Instagram/TikTok share flows', async () => {
    expect(PHOTO_PRESET_IDS).toContain('instagram-feed');
    expect(PHOTO_PRESET_IDS).toContain('tiktok-hd');
    expect(PHOTO_PRESET_IDS).toContain('archive-hd');
    expect(VIDEO_PRESET_IDS).toContain('tiktok-hd');

    expect(PLATFORM_SHARE_META.instagram.url).toContain('instagram.com');
    expect(PLATFORM_SHARE_META.tiktok.url).toContain('tiktok.com');

    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0'
    );
    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') el.click = clickSpy;
      return el;
    });

    const outcomeIg = await executePlatformShareFlow({
      platform: 'instagram',
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      objectUrl: 'blob:http://localhost/ig',
      fileName: 'ig-kompresor.jpg',
      mimeType: 'image/jpeg',
    });
    expect(outcomeIg).toBe('desktop-helper');

    const outcomeTk = await executePlatformShareFlow({
      platform: 'tiktok',
      blob: new Blob(['x'], { type: 'video/mp4' }),
      objectUrl: 'blob:http://localhost/tk',
      fileName: 'tk-kompresor.mp4',
      mimeType: 'video/mp4',
    });
    expect(outcomeTk).toBe('desktop-helper');
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });
});
