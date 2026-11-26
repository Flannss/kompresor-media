import type { VideoEditState, VideoQualityTier } from '../contracts';

export interface VideoDimensions {
  width: number;
  height: number;
}

export interface ClampedTrimRange {
  startSec: number;
  endSec: number;
  durationSec: number;
  isTrimmed: boolean;
}

/**
 * Computes aspect-preserving even dimensions capped at maxHeightPx without upscaling.
 */
export function computeEvenScaledDimensions(
  srcWidth: number,
  srcHeight: number,
  maxHeightPx: number | null
): VideoDimensions {
  if (srcWidth <= 0 || srcHeight <= 0) {
    throw new Error(`Resolusi video tidak valid: ${srcWidth}x${srcHeight}`);
  }
  const scale = maxHeightPx !== null && maxHeightPx > 0 && srcHeight > maxHeightPx
    ? maxHeightPx / srcHeight
    : 1;
  const rawW = Math.floor(srcWidth * scale);
  const rawH = Math.floor(srcHeight * scale);
  return {
    width: Math.max(2, rawW - (rawW % 2)),
    height: Math.max(2, rawH - (rawH % 2)),
  };
}

export function clampTrimRange(
  startSec: number,
  endSec: number | null,
  totalDurationSec: number
): ClampedTrimRange {
  const safeTotal = Number.isFinite(totalDurationSec) && totalDurationSec > 0 ? totalDurationSec : 0;
  if (safeTotal <= 0) {
    return { startSec: 0, endSec: 0, durationSec: 0, isTrimmed: false };
  }

  const minGap = Math.min(0.2, safeTotal);
  const clampedStart = Math.min(Math.max(0, Number.isFinite(startSec) ? startSec : 0), Math.max(0, safeTotal - minGap));
  const rawEnd = endSec !== null && Number.isFinite(endSec) ? endSec : safeTotal;
  const clampedEnd = Math.min(safeTotal, Math.max(clampedStart + minGap, rawEnd));

  const isTrimmed = clampedStart > 0.05 || clampedEnd < safeTotal - 0.05;
  return {
    startSec: Number(clampedStart.toFixed(3)),
    endSec: Number(clampedEnd.toFixed(3)),
    durationSec: Number((clampedEnd - clampedStart).toFixed(3)),
    isTrimmed,
  };
}

export function resolveCustomVideoParams(
  qualityTier: VideoQualityTier
): Pick<VideoEditState, 'crf' | 'targetBitrateBps' | 'maxrateKbps' | 'bufsizeKbps' | 'audioBitrateKbps'> {
  switch (qualityTier) {
    case 'light':
      return {
        crf: 29,
        targetBitrateBps: 850_000,
        maxrateKbps: 1000,
        bufsizeKbps: 2000,
        audioBitrateKbps: 96,
      };
    case 'high':
      return {
        crf: 23,
        targetBitrateBps: 2_800_000,
        maxrateKbps: 3400,
        bufsizeKbps: 6800,
        audioBitrateKbps: 128,
      };
    case 'balanced':
    default:
      return {
        crf: 26,
        targetBitrateBps: 1_800_000,
        maxrateKbps: 2200,
        bufsizeKbps: 4400,
        audioBitrateKbps: 128,
      };
  }
}

export function buildVideoExportFileName(originalName: string): string {
  const dotIdx = originalName.lastIndexOf('.');
  const rawBase = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  const cleanBase = rawBase.trim() || 'video';
  return `${cleanBase}-kompresor.mp4`;
}
