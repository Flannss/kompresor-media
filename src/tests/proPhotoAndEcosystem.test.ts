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
import { getBackdropClasses } from '../features/workspace/BeforeAfterPreview';
import { initTheme, THEME_STORAGE_KEY } from '../shared/hooks/useTheme';
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

  it('computes progressive 1.5x upscale steps across HD/2K/3K/4K/8K, overrides preset caps, and enforces device guardrails', () => {
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
    expect(desktopProfile.photoInteractivePreviewEdge).toBe(1600);

    const basePreset = getMediaPreset('whatsapp-hd').image;
    for (const [resId, expectedW, expectedH] of [
      ['hd', 1920, 1280],
      ['2k', 2560, 1707],
      ['3k', 3072, 2048],
      ['4k', 3840, 2560],
      ['8k', 7680, 5120],
    ] as const) {
      const dims = computePhotoTargetDimensions(
        1200,
        800,
        { ...basePreset, maxEdgePx: 1600, targetResolution: resId },
        {
          maxCanvasPixels: desktopProfile.maxPhotoCanvasPixels,
          allow8K: desktopProfile.allow8KPhotoExport,
        }
      );
      expect(dims).toEqual({
        width: expectedW,
        height: expectedH,
        clampedByMemoryGuard: false,
        appliedTargetResolution: resId,
      });
    }

    const highTablet = getDeviceProfile({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Tablet) Chrome/130.0.0.0',
      viewportWidth: 820,
      deviceMemoryGB: 8,
      hardwareConcurrency: 8,
      maxTouchPoints: 5,
    });
    expect(highTablet.photoInteractivePreviewEdge).toBe(1280);
    expect(highTablet.allow8KPhotoExport).toBe(true);

    const lowTabletIpad = getDeviceProfile({
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      viewportWidth: 820,
      deviceMemoryGB: null,
      hardwareConcurrency: 6,
      maxTouchPoints: 5,
    });
    expect(lowTabletIpad.allow8KPhotoExport).toBe(false);

    const iphoneX = getDeviceProfile({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) Safari/604.1',
      viewportWidth: 375,
      deviceMemoryGB: null,
      hardwareConcurrency: null,
      maxTouchPoints: 5,
    });
    expect(iphoneX.useGlassLite).toBe(true);
    expect(iphoneX.allow8KPhotoExport).toBe(false);
    expect(iphoneX.photoInteractivePreviewEdge).toBe(960);
    expect(iphoneX.releaseFfmpegAfterExport).toBe(true);
    expect(iphoneX.maxPhotoCanvasPixels).toBe(15_000_000);
    expect(iphoneX.maxPhotoCanvasPixels).toBeLessThan(16_700_000);

    // 8K requested on iPhone X downgrades safely to 4K; 2K/3K/4K (3:2) stay native without clamping!
    for (const [resId, expectedW, expectedH] of [
      ['2k', 2560, 1707],
      ['3k', 3072, 2048],
      ['4k', 3840, 2560],
    ] as const) {
      const mobileNative = computePhotoTargetDimensions(
        1200,
        800,
        { ...basePreset, targetResolution: resId },
        {
          maxCanvasPixels: iphoneX.maxPhotoCanvasPixels,
          allow8K: iphoneX.allow8KPhotoExport,
        }
      );
      expect(mobileNative).toEqual({
        width: expectedW,
        height: expectedH,
        clampedByMemoryGuard: false,
        appliedTargetResolution: resId,
      });
    }

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
    expect(mobileGuarded.clampedByMemoryGuard).toBe(false);
    expect(mobileGuarded.width * mobileGuarded.height).toBeLessThanOrEqual(15_000_000);

    // Full-res WhatsApp HD (2560px) and Status WA HD (1920px) retain complete target dimensions
    const mobileWaHd = computePhotoTargetDimensions(
      3600,
      2400,
      getMediaPreset('whatsapp-hd').image,
      {
        maxCanvasPixels: iphoneX.maxPhotoCanvasPixels,
        allow8K: iphoneX.allow8KPhotoExport,
      }
    );
    expect(mobileWaHd.width).toBe(2560);
    expect(mobileWaHd.height).toBe(1707);

    const mobileWaStatus = computePhotoTargetDimensions(
      2160,
      3840,
      getMediaPreset('whatsapp-status').image,
      {
        maxCanvasPixels: iphoneX.maxPhotoCanvasPixels,
        allow8K: iphoneX.allow8KPhotoExport,
      }
    );
    expect(mobileWaStatus.width).toBe(1080);
    expect(mobileWaStatus.height).toBe(1920);
  });

  it('produces pairwise distinct RGB outputs for all 5 Photo Quality Models and scales with modelStrength', () => {
    const baseImg = makePatternImageData(8, 8);
    // Inject warm skin-tone pixels + crisp edge variation
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const idx = (y * 8 + x) * 4;
        baseImg.data[idx] = 205;
        baseImg.data[idx + 1] = 165;
        baseImg.data[idx + 2] = 135;
      }
    }

    const clonePattern = () =>
      ({ width: 8, height: 8, data: new Uint8ClampedArray(baseImg.data) }) as unknown as ImageData;

    const modelIds = [
      'realphoto',
      'high-quality',
      'ultra-detail',
      'studio-portrait',
      'hdr-dynamic',
    ] as const;

    const outputs = new Map<string, Uint8ClampedArray>();
    for (const id of modelIds) {
      const copy = clonePattern();
      applyQualityModelPass(copy, id, 1.6, 80, '2k');
      let deltaVsOrig = 0;
      for (let i = 0; i < copy.data.length; i += 4) {
        deltaVsOrig +=
          Math.abs(copy.data[i] - baseImg.data[i]) +
          Math.abs(copy.data[i + 1] - baseImg.data[i + 1]) +
          Math.abs(copy.data[i + 2] - baseImg.data[i + 2]);
        expect(copy.data[i + 3]).toBe(240);
      }
      expect(deltaVsOrig).toBeGreaterThan(0);
      outputs.set(id, copy.data);
    }

    // Verify every pair of models differs measurably
    for (let a = 0; a < modelIds.length; a += 1) {
      for (let b = a + 1; b < modelIds.length; b += 1) {
        const d1 = outputs.get(modelIds[a])!;
        const d2 = outputs.get(modelIds[b])!;
        let pairDiff = 0;
        for (let i = 0; i < d1.length; i += 4) {
          pairDiff +=
            Math.abs(d1[i] - d2[i]) +
            Math.abs(d1[i + 1] - d2[i + 1]) +
            Math.abs(d1[i + 2] - d2[i + 2]);
        }
        expect(pairDiff).toBeGreaterThan(0);
      }
    }

    // Verify strength scaling (0% vs 50% vs 100%)
    const img0 = clonePattern();
    const img50 = clonePattern();
    const img100 = clonePattern();
    applyQualityModelPass(img0, 'hdr-dynamic', 1.0, 0, 'original');
    applyQualityModelPass(img50, 'hdr-dynamic', 1.0, 50, 'original');
    applyQualityModelPass(img100, 'hdr-dynamic', 1.0, 100, 'original');
    let diff0_50 = 0;
    let diff50_100 = 0;
    for (let i = 0; i < img0.data.length; i += 4) {
      diff0_50 +=
        Math.abs(img0.data[i] - img50.data[i]) +
        Math.abs(img0.data[i + 1] - img50.data[i + 1]) +
        Math.abs(img0.data[i + 2] - img50.data[i + 2]);
      diff50_100 +=
        Math.abs(img100.data[i] - img50.data[i]) +
        Math.abs(img100.data[i + 1] - img50.data[i + 1]) +
        Math.abs(img100.data[i + 2] - img50.data[i + 2]);
    }
    expect(diff0_50).toBeGreaterThan(0);
    expect(diff50_100).toBeGreaterThan(0);
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

  it('defaults theme to Slate Gelap (km-theme-v4) and Architectural Slate / Porcelain stage backdrop', () => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    expect(THEME_STORAGE_KEY).toBe('km-theme-v4');
    expect(initTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    expect(getBackdropClasses('studio')).toBe('bg-[var(--bg-stage-media)]');
    expect(getBackdropClasses('light')).toBe('bg-[#F8FAFC]');
    expect(getBackdropClasses('dark')).toBe('bg-[#0F172A]');
    expect(getBackdropClasses('checker')).toBe('bg-checkerboard');
  });
});
