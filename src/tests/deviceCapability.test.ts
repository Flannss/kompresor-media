import { describe, expect, it } from 'vitest';
import { getAdaptiveQueueLimits } from '../shared/utils/deviceCapability';

describe('adaptive multi-queue device capability limits', () => {
  it('allows up to 9 photos / 5 videos / 9 total on capable desktops', () => {
    const limits = getAdaptiveQueueLimits({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0',
      viewportWidth: 1440,
      deviceMemoryGB: 8,
      hardwareConcurrency: 8,
      maxTouchPoints: 0,
    });
    expect(limits).toMatchObject({
      tier: 'desktop',
      maxPhotos: 9,
      maxVideos: 5,
      maxTotal: 9,
    });
    expect(limits.maxTotal).toBeLessThanOrEqual(9);
  });

  it('caps videos to 3 on tablets and high-RAM mobile devices while allowing 9 photos', () => {
    const tabletLimits = getAdaptiveQueueLimits({
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      viewportWidth: 820,
      deviceMemoryGB: null,
      hardwareConcurrency: 6,
      maxTouchPoints: 5,
    });
    expect(tabletLimits).toMatchObject({
      tier: 'high-mobile',
      maxPhotos: 9,
      maxVideos: 3,
      maxTotal: 9,
    });

    const highPhone = getAdaptiveQueueLimits({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0.0.0 Mobile',
      viewportWidth: 412,
      deviceMemoryGB: 8,
      hardwareConcurrency: 8,
      maxTouchPoints: 5,
    });
    expect(highPhone).toMatchObject({
      tier: 'high-mobile',
      maxPhotos: 9,
      maxVideos: 3,
      maxTotal: 9,
    });
  });

  it('reduces batch ceiling cleanly to 6 photos / 2 videos on mid/low-RAM or unknown mobile devices', () => {
    const lowPhone = getAdaptiveQueueLimits({
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Redmi Note) Chrome/125.0.0.0 Mobile',
      viewportWidth: 390,
      deviceMemoryGB: 4,
      hardwareConcurrency: 4,
      maxTouchPoints: 5,
    });
    expect(lowPhone).toMatchObject({
      tier: 'standard-mobile',
      maxPhotos: 6,
      maxVideos: 2,
      maxTotal: 6,
    });

    const iosUnknownMem = getAdaptiveQueueLimits({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148',
      viewportWidth: 390,
      deviceMemoryGB: null,
      hardwareConcurrency: null,
      maxTouchPoints: 5,
    });
    expect(iosUnknownMem).toMatchObject({
      tier: 'standard-mobile',
      maxPhotos: 6,
      maxVideos: 2,
      maxTotal: 6,
    });
  });
});
