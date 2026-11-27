import type { VideoEditState, VideoOutputFormat, VideoQualityTier } from '../contracts';

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
 * Computes aspect-preserving even dimensions (divisible by 2 for H.264/VP8/VP9 YUV420p),
 * optionally upscaling up to 1080p when Jernihkan HD upscale is active.
 */
export function computeEvenScaledDimensions(
  srcWidth: number,
  srcHeight: number,
  maxHeightPx: number | null,
  upscaleFactor: 1 | 1.5 | 2 = 1
): VideoDimensions {
  if (srcWidth <= 0 || srcHeight <= 0) {
    throw new Error(`Resolusi video tidak valid: ${srcWidth}x${srcHeight}`);
  }

  let scale = 1;
  if (upscaleFactor > 1) {
    const capH = maxHeightPx !== null && maxHeightPx > 0 ? Math.min(maxHeightPx, 1080) : 1080;
    const desiredH = Math.min(capH, Math.round(srcHeight * upscaleFactor));
    scale = desiredH / srcHeight;
  } else if (maxHeightPx !== null && maxHeightPx > 0 && srcHeight > maxHeightPx) {
    scale = maxHeightPx / srcHeight;
  }

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
  const clampedStart = Math.min(
    Math.max(0, Number.isFinite(startSec) ? startSec : 0),
    Math.max(0, safeTotal - minGap)
  );
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
): Pick<
  VideoEditState,
  'crf' | 'targetBitrateBps' | 'maxrateKbps' | 'bufsizeKbps' | 'audioBitrateKbps'
> {
  switch (qualityTier) {
    case 'light':
      return {
        crf: 29,
        targetBitrateBps: 950_000,
        maxrateKbps: 1150,
        bufsizeKbps: 2300,
        audioBitrateKbps: 96,
      };
    case 'high':
      return {
        crf: 21,
        targetBitrateBps: 4_200_000,
        maxrateKbps: 4800,
        bufsizeKbps: 9600,
        audioBitrateKbps: 192,
      };
    case 'balanced':
    default:
      return {
        crf: 25,
        targetBitrateBps: 2_200_000,
        maxrateKbps: 2600,
        bufsizeKbps: 5200,
        audioBitrateKbps: 128,
      };
  }
}

export function buildVideoExportFileName(
  originalName: string,
  outputFormat: VideoOutputFormat = 'mp4'
): string {
  const dotIdx = originalName.lastIndexOf('.');
  const rawBase = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  const cleanBase = rawBase.trim() || 'video';
  return `${cleanBase}-kompresor.${outputFormat}`;
}
