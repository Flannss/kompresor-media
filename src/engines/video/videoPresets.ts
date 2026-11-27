import { sanitizeExportBaseName } from '../../shared/utils/sanitizeFileName';
import type {
  VideoClarityModel,
  VideoEditState,
  VideoOutputFormat,
  VideoQualityTier,
  VideoTargetResolution,
} from '../contracts';

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

export const VIDEO_CLARITY_MODEL_LABELS: Record<VideoClarityModel, string> = {
  original: 'Asli (Hemat)',
  'natural-hd': 'Natural HD',
  'sharp-1080p': 'Tajam 1080p',
  'low-light': 'Malam & Minim Cahaya',
};

/**
 * Resolves exact orientation-aware even output dimensions for semantic Video targets
 * ('original' | '720p' | '1080p' | '2k'), scaling both up and down cleanly for YUV420p.
 */
export function computeVideoTargetDimensions(
  srcWidth: number,
  srcHeight: number,
  targetResolution: VideoTargetResolution,
  maxHeightPx: number | null
): VideoDimensions {
  if (!Number.isFinite(srcWidth) || !Number.isFinite(srcHeight) || srcWidth <= 0 || srcHeight <= 0) {
    throw new Error(`Resolusi video tidak valid: ${srcWidth}x${srcHeight}`);
  }

  if (targetResolution === '1080p' || targetResolution === '2k') {
    const longEdge = targetResolution === '2k' ? 2560 : 1920;
    const shortEdge = targetResolution === '2k' ? 1440 : 1080;
    const isPortrait = srcHeight > srcWidth;
    if (srcWidth === srcHeight) {
      return { width: shortEdge, height: shortEdge };
    }
    const maxW = isPortrait ? shortEdge : longEdge;
    const maxH = isPortrait ? longEdge : shortEdge;
    const scale = Math.min(maxW / srcWidth, maxH / srcHeight);
    const rawW = Math.round(srcWidth * scale);
    const rawH = Math.round(srcHeight * scale);
    return {
      width: Math.max(2, rawW - (rawW % 2)),
      height: Math.max(2, rawH - (rawH % 2)),
    };
  }

  if (targetResolution === '720p') {
    return computeEvenScaledDimensions(srcWidth, srcHeight, 720, 1);
  }

  return computeEvenScaledDimensions(srcWidth, srcHeight, maxHeightPx, 1);
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
  if (!Number.isFinite(srcWidth) || !Number.isFinite(srcHeight) || srcWidth <= 0 || srcHeight <= 0) {
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
        crf: 24,
        targetBitrateBps: 2_200_000,
        maxrateKbps: 2400,
        bufsizeKbps: 4800,
        audioBitrateKbps: 128,
      };
    case 'high':
      return {
        crf: 19,
        targetBitrateBps: 7_500_000,
        maxrateKbps: 8000,
        bufsizeKbps: 16000,
        audioBitrateKbps: 160,
      };
    case 'balanced':
    default:
      return {
        crf: 21,
        targetBitrateBps: 4_800_000,
        maxrateKbps: 5200,
        bufsizeKbps: 10400,
        audioBitrateKbps: 128,
      };
  }
}

export function buildVideoExportFileName(
  originalName: string,
  outputFormat: VideoOutputFormat = 'mp4',
  targetResolution?: VideoTargetResolution
): string {
  const leaf = originalName.split(/[\\/]/).pop() ?? originalName;
  const dotIdx = leaf.lastIndexOf('.');
  const rawBase = dotIdx > 0 ? leaf.slice(0, dotIdx) : leaf;
  const cleanBase = sanitizeExportBaseName(rawBase, 'video');
  const suffix =
    targetResolution && targetResolution !== 'original' ? `hd-${targetResolution}` : 'kompresor';
  return `${cleanBase}-${suffix}.${outputFormat}`;
}
