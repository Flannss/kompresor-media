export type DeviceTier = 'desktop' | 'high-mobile' | 'standard-mobile';

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

const HARD_QUEUE_CAP = 9;

export function detectDeviceCapability(input?: DeviceCapabilityInput): {
  isMobile: boolean;
  isTablet: boolean;
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

  const isPhoneUa = /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua);
  const isTabletUa = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || (/Macintosh/i.test(ua) && touchPoints > 1);

  const isTablet = isTabletUa || (!isPhoneUa && width >= 768 && width <= 1024 && touchPoints > 0);
  const isMobile = isPhoneUa || (!isTablet && width < 768);

  return { isMobile, isTablet, memoryGB, cores };
}

export function getAdaptiveQueueLimits(input?: DeviceCapabilityInput): AdaptiveQueueLimits {
  const { isMobile, isTablet, memoryGB, cores } = detectDeviceCapability(input);

  // Desktop (>= 8 GB RAM or >= 4 CPU cores)
  if (!isMobile && !isTablet && ((memoryGB !== null && memoryGB >= 8) || (cores !== null && cores >= 4) || (memoryGB === null && cores === null))) {
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
