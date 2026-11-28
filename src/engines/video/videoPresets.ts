import { sanitizeExportBaseName } from '../../shared/utils/sanitizeFileName';
import type {
  AudioBitrateKbps,
  LongVideoProfileId,
  VideoClarityModel,
  VideoEditState,
  VideoMetadata,
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

export interface LongVideoProfileSpec {
  id: LongVideoProfileId;
  label: string;
  badge: string | null;
  summary: string;
  targetResolution: VideoTargetResolution;
  maxHeightPx: number;
  fpsCap: number;
  qualityTier: VideoQualityTier;
  targetBitrateBps: number;
  crf: number;
  maxrateKbps: number;
  bufsizeKbps: number;
  audioBitrateKbps: AudioBitrateKbps;
}

export interface VideoSegmentRange {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  label: string;
}

export const LONG_VIDEO_DURATION_THRESHOLD_SEC = 300; // 5 minutes
export const LONG_VIDEO_SIZE_THRESHOLD_BYTES = 150 * 1024 * 1024; // 150 MB

export const LONG_VIDEO_PROFILE_SPECS: Record<LongVideoProfileId, LongVideoProfileSpec> = {
  'space-saver': {
    id: 'space-saver',
    label: 'Hemat Ruang',
    badge: null,
    summary: '720p · 2,2 Mbps · Audio 96k · Ukuran ringkas & cepat',
    targetResolution: '720p',
    maxHeightPx: 720,
    fpsCap: 30,
    qualityTier: 'light',
    targetBitrateBps: 2_200_000,
    crf: 23,
    maxrateKbps: 2600,
    bufsizeKbps: 5200,
    audioBitrateKbps: 96,
  },
  'balanced-hd': {
    id: 'balanced-hd',
    label: 'Seimbang HD',
    badge: 'Rekomendasi',
    summary: '1080p · 4,2 Mbps · Audio 128k · Jernih stabil 30+ mnt',
    targetResolution: '1080p',
    maxHeightPx: 1080,
    fpsCap: 30,
    qualityTier: 'balanced',
    targetBitrateBps: 4_200_000,
    crf: 20,
    maxrateKbps: 4800,
    bufsizeKbps: 9600,
    audioBitrateKbps: 128,
  },
  'clear-archive': {
    id: 'clear-archive',
    label: 'Arsip Jernih',
    badge: null,
    summary: '1080p · 6,5 Mbps · Audio 160k · Detail presentasi & acara',
    targetResolution: '1080p',
    maxHeightPx: 1080,
    fpsCap: 30,
    qualityTier: 'high',
    targetBitrateBps: 6_500_000,
    crf: 18,
    maxrateKbps: 7500,
    bufsizeKbps: 15000,
    audioBitrateKbps: 160,
  },
};

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

export function resolveLongVideoProfileParams(
  profile: LongVideoProfileId
): Pick<
  VideoEditState,
  | 'longVideoProfile'
  | 'targetResolution'
  | 'maxHeightPx'
  | 'fpsCap'
  | 'qualityTier'
  | 'targetBitrateBps'
  | 'crf'
  | 'maxrateKbps'
  | 'bufsizeKbps'
  | 'audioBitrateKbps'
> {
  const spec = LONG_VIDEO_PROFILE_SPECS[profile] ?? LONG_VIDEO_PROFILE_SPECS['balanced-hd'];
  return {
    longVideoProfile: spec.id,
    targetResolution: spec.targetResolution,
    maxHeightPx: spec.maxHeightPx,
    fpsCap: spec.fpsCap,
    qualityTier: spec.qualityTier,
    targetBitrateBps: spec.targetBitrateBps,
    crf: spec.crf,
    maxrateKbps: spec.maxrateKbps,
    bufsizeKbps: spec.bufsizeKbps,
    audioBitrateKbps: spec.audioBitrateKbps,
  };
}

export function isLongFormVideoCandidate(
  metadata: Pick<VideoMetadata, 'durationSec' | 'sizeBytes'>
): boolean {
  return (
    metadata.durationSec >= LONG_VIDEO_DURATION_THRESHOLD_SEC ||
    metadata.sizeBytes >= LONG_VIDEO_SIZE_THRESHOLD_BYTES
  );
}

/**
 * Resolves calibrated effective video bitrate across hardware WebCodecs, MediaRecorder,
 * and output size estimation.
 */
export function resolveEffectiveVideoBitrateBps(edit: VideoEditState): number {
  switch (edit.presetId) {
    case 'whatsapp-hd':
      return 6_200_000;
    case 'whatsapp-status':
      return 4_600_000;
    case 'instagram-story':
      return 7_000_000;
    case 'tiktok-hd':
      return 7_500_000;
    case 'vlog-hd':
      return 8_500_000;
    case 'web-light':
    case 'whatsapp-fast':
      return 2_200_000;
    case 'long-video':
      return edit.targetBitrateBps || 4_200_000;
    default:
      return edit.targetBitrateBps;
  }
}

/**
 * Estimates final container file size mathematically from trimmed duration * (video + audio bitrate)
 * plus ~2% MP4/MOV muxer overhead.
 */
export function estimateVideoOutputBytes(durationSec: number, edit: VideoEditState): number {
  const safeTotal = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  if (safeTotal <= 0) return 0;

  const trim = clampTrimRange(edit.trimStartSec, edit.trimEndSec, safeTotal);
  const activeDur = trim.durationSec > 0 ? trim.durationSec : safeTotal;
  const videoBps = resolveEffectiveVideoBitrateBps(edit);
  const isMuted = edit.muteAudio || (edit.audio.enabled && edit.audio.muteAudio);
  const audioKbps = isMuted ? 0 : edit.audio.enabled ? edit.audio.bitrateKbps : edit.audioBitrateKbps;
  const totalBps = videoBps + audioKbps * 1000;
  return Math.max(0, Math.round(((totalBps * activeDur) / 8) * 1.02));
}

function formatSegmentMinuteMark(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Builds chronological trim segment chunks (e.g. 10-min or 15-min slices) for long-form exports.
 */
export function buildVideoSegments(
  totalDurationSec: number,
  segmentMinutes: 10 | 15 = 10
): VideoSegmentRange[] {
  const safeTotal = Number.isFinite(totalDurationSec) && totalDurationSec > 0 ? totalDurationSec : 0;
  if (safeTotal <= 0) return [];
  const stepSec = segmentMinutes * 60;
  const count = Math.ceil(safeTotal / stepSec);
  const segments: VideoSegmentRange[] = [];
  for (let i = 0; i < count; i += 1) {
    const startSec = i * stepSec;
    const endSec = Math.min(safeTotal, (i + 1) * stepSec);
    if (endSec - startSec < 0.2) break;
    segments.push({
      index: i + 1,
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
      durationSec: Number((endSec - startSec).toFixed(3)),
      label: `Bagian ${i + 1} (${formatSegmentMinuteMark(startSec)}–${formatSegmentMinuteMark(endSec)})`,
    });
  }
  return segments;
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
