export type DeviceTier = 'desktop' | 'high-mobile' | 'standard-mobile';
export type PerformanceTier = 'low-memory-mobile' | 'standard-mobile' | 'desktop';

export interface DeviceCapabilityInput {
  userAgent?: string;
  viewportWidth?: number;
  deviceMemoryGB?: number | null;
  hardwareConcurrency?: number | null;
  maxTouchPoints?: number;
}

export interface AdaptiveQueueLimits {
  tier: DeviceTier;
  label: string;
  maxPhotos: number;
  maxVideos: number;
  maxTotal: number;
}

export interface DeviceProfile {
  isIOS: boolean;
  isWebKitSafari: boolean;
  isMobile: boolean;
  isTablet: boolean;
  isMobileViewport: boolean;
  deviceMemoryGB: number | null;
  hardwareConcurrency: number | null;
  performanceTier: PerformanceTier;
  maxPreviewEdge: number;
  photoInteractivePreviewEdge: number;
  previewDebounceMs: number;
  imageWorkerPoolSize: number;
  maxQueuePhotos: number;
  maxQueueVideos: number;
  maxQueueTotal: number;
  useLightweightCssPreview: boolean;
  useGlassLite: boolean;
  allow8KPhotoExport: boolean;
  maxPhotoCanvasPixels: number;
  releaseFfmpegAfterExport: boolean;
  maxDualVideoBytes: number;
}

const HARD_QUEUE_CAP = 9;
const LOW_MEM_DUAL_VIDEO_CAP_BYTES = 35 * 1024 * 1024;

export function detectDeviceCapability(input?: DeviceCapabilityInput): {
  isIOS: boolean;
  isWebKitSafari: boolean;
  isMobile: boolean;
  isTablet: boolean;
  isMobileViewport: boolean;
  memoryGB: number | null;
  cores: number | null;
} {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const win = typeof window !== 'undefined' ? window : undefined;

  const ua = input?.userAgent ?? nav?.userAgent ?? '';
  const width = input?.viewportWidth ?? win?.innerWidth ?? 1280;
  const touchPoints = input?.maxTouchPoints ?? nav?.maxTouchPoints ?? 0;

  const memRaw =
    input?.deviceMemoryGB !== undefined
      ? input.deviceMemoryGB
      : (nav as unknown as { deviceMemory?: number } | undefined)?.deviceMemory ?? null;
  const memoryGB = typeof memRaw === 'number' && Number.isFinite(memRaw) && memRaw > 0 ? memRaw : null;

  const coresRaw = input?.hardwareConcurrency !== undefined ? input.hardwareConcurrency : nav?.hardwareConcurrency ?? null;
  const cores = typeof coresRaw === 'number' && Number.isFinite(coresRaw) && coresRaw > 0 ? coresRaw : null;

  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1);
  const isWebKitSafari =
    isIOS || (/Safari/i.test(ua) && !/Chrome|CriOS|Edg|EdgiOS|FxiOS|OPR|Android/i.test(ua));

  const isPhoneUa = /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua);
  const isTabletUa =
    /iPad|Tablet/i.test(ua) ||
    (/Android/i.test(ua) && !/Mobile/i.test(ua)) ||
    (/Macintosh/i.test(ua) && touchPoints > 1);

  const isTablet = isTabletUa || (!isPhoneUa && width >= 768 && width <= 1024 && touchPoints > 0);
  const isMobile = isPhoneUa || (!isTablet && width < 768);
  const isMobileViewport = width < 768;

  return {
    isIOS,
    isWebKitSafari,
    isMobile,
    isTablet,
    isMobileViewport,
    memoryGB,
    cores,
  };
}

export function getDeviceProfile(input?: DeviceCapabilityInput): DeviceProfile {
  const {
    isIOS,
    isWebKitSafari,
    isMobile,
    isTablet,
    isMobileViewport,
    memoryGB,
    cores,
  } = detectDeviceCapability(input);

  let performanceTier: PerformanceTier;
  if (isIOS || (isMobile && (memoryGB === null || memoryGB <= 4))) {
    performanceTier = 'low-memory-mobile';
  } else if (isMobile || isTablet) {
    performanceTier = 'standard-mobile';
  } else {
    performanceTier = 'desktop';
  }

  const useLightweightCssPreview =
    isIOS || isWebKitSafari || performanceTier === 'low-memory-mobile';
  const useGlassLite = isIOS || performanceTier === 'low-memory-mobile';

  if (performanceTier === 'low-memory-mobile') {
    return {
      isIOS,
      isWebKitSafari,
      isMobile,
      isTablet,
      isMobileViewport,
      deviceMemoryGB: memoryGB,
      hardwareConcurrency: cores,
      performanceTier,
      maxPreviewEdge: 960,
      photoInteractivePreviewEdge: 960,
      previewDebounceMs: 140,
      imageWorkerPoolSize: 1,
      maxQueuePhotos: 6,
      maxQueueVideos: 2,
      maxQueueTotal: 6,
      useLightweightCssPreview,
      useGlassLite,
      allow8KPhotoExport: false,
      maxPhotoCanvasPixels: 11_500_000,
      releaseFfmpegAfterExport: true,
      maxDualVideoBytes: LOW_MEM_DUAL_VIDEO_CAP_BYTES,
    };
  }

  if (performanceTier === 'standard-mobile') {
    return {
      isIOS,
      isWebKitSafari,
      isMobile,
      isTablet,
      isMobileViewport,
      deviceMemoryGB: memoryGB,
      hardwareConcurrency: cores,
      performanceTier,
      maxPreviewEdge: 1280,
      photoInteractivePreviewEdge: 1280,
      previewDebounceMs: 90,
      imageWorkerPoolSize: 1,
      maxQueuePhotos: HARD_QUEUE_CAP,
      maxQueueVideos: 3,
      maxQueueTotal: HARD_QUEUE_CAP,
      useLightweightCssPreview,
      useGlassLite,
      allow8KPhotoExport: false,
      maxPhotoCanvasPixels: 24_000_000,
      releaseFfmpegAfterExport: false,
      maxDualVideoBytes: Number.POSITIVE_INFINITY,
    };
  }

  return {
    isIOS,
    isWebKitSafari,
    isMobile,
    isTablet,
    isMobileViewport,
    deviceMemoryGB: memoryGB,
    hardwareConcurrency: cores,
    performanceTier: 'desktop',
    maxPreviewEdge: 1600,
    photoInteractivePreviewEdge: 1280,
    previewDebounceMs: 60,
    imageWorkerPoolSize: 2,
    maxQueuePhotos: HARD_QUEUE_CAP,
    maxQueueVideos: 5,
    maxQueueTotal: HARD_QUEUE_CAP,
    useLightweightCssPreview,
    useGlassLite,
    allow8KPhotoExport: true,
    maxPhotoCanvasPixels: 67_108_864,
    releaseFfmpegAfterExport: false,
    maxDualVideoBytes: Number.POSITIVE_INFINITY,
  };
}

export function getAdaptiveQueueLimits(input?: DeviceCapabilityInput): AdaptiveQueueLimits {
  const { isMobile, isTablet, memoryGB, cores } = detectDeviceCapability(input);

  // Desktop (>= 8 GB RAM or >= 4 CPU cores)
  if (
    !isMobile &&
    !isTablet &&
    ((memoryGB !== null && memoryGB >= 8) ||
      (cores !== null && cores >= 4) ||
      (memoryGB === null && cores === null))
  ) {
    return {
      tier: 'desktop',
      label: 'Desktop',
      maxPhotos: HARD_QUEUE_CAP,
      maxVideos: 5,
      maxTotal: HARD_QUEUE_CAP,
    };
  }

  // Tablet or high-RAM mobile (>= 6 GB RAM)
  if (isTablet || (memoryGB !== null && memoryGB >= 6)) {
    return {
      tier: 'high-mobile',
      label: isTablet ? 'Tablet' : 'Ponsel Kelas Atas',
      maxPhotos: HARD_QUEUE_CAP,
      maxVideos: 3,
      maxTotal: HARD_QUEUE_CAP,
    };
  }

  // Mid/low-RAM mobile (<= 4 GB RAM or unknown mobile)
  if (isMobile) {
    return {
      tier: 'standard-mobile',
      label: 'Perangkat Seluler',
      maxPhotos: 6,
      maxVideos: 2,
      maxTotal: 6,
    };
  }

  // Conservative desktop fallback (< 8 GB RAM & < 4 cores)
  return {
    tier: 'high-mobile',
    label: 'Perangkat Standar',
    maxPhotos: HARD_QUEUE_CAP,
    maxVideos: 3,
    maxTotal: HARD_QUEUE_CAP,
  };
}
