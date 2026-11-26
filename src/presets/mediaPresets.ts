import type { ImageEditState, ImagePresetId, VideoEditState, VideoPresetId } from '../engines/contracts';

export type MediaPresetId = ImagePresetId & VideoPresetId;

export interface MediaPresetSpec {
  id: MediaPresetId;
  label: string;
  shortLabel: string;
  summary: string;
  targetLimitLabel: string;
  image: ImageEditState;
  video: VideoEditState;
}

export const MEDIA_PRESETS: readonly MediaPresetSpec[] = [
  {
    id: 'whatsapp-chat',
    label: 'WhatsApp Chat',
    shortLabel: 'WA Chat',
    summary: 'Balanced 1600 px photo / 720p H.264 MP4 tuned to avoid harsh chat re-compression.',
    targetLimitLabel: '<= 16 MB fast share',
    image: {
      presetId: 'whatsapp-chat',
      maxEdgePx: 1600,
      outputFormat: 'image/jpeg',
      quality: 0.84,
      sharpenAmount: 0.35,
      stripMetadata: true,
    },
    video: {
      presetId: 'whatsapp-chat',
      maxHeightPx: 720,
      targetBitrateBps: 1_800_000,
      crf: 26,
      trimStartSec: 0,
      trimEndSec: null,
      muteAudio: false,
    },
  },
  {
    id: 'whatsapp-status',
    label: 'WhatsApp Status',
    shortLabel: 'WA Status',
    summary: 'Crisp 1280 px photo / 720p video with 30 s trim ceiling and mild detail sharpen.',
    targetLimitLabel: '720p / 30 s target',
    image: {
      presetId: 'whatsapp-status',
      maxEdgePx: 1280,
      outputFormat: 'image/jpeg',
      quality: 0.85,
      sharpenAmount: 0.45,
      stripMetadata: true,
    },
    video: {
      presetId: 'whatsapp-status',
      maxHeightPx: 720,
      targetBitrateBps: 1_500_000,
      crf: 27,
      trimStartSec: 0,
      trimEndSec: 30,
      muteAudio: false,
    },
  },
  {
    id: 'instagram-story',
    label: 'Instagram Story / Feed',
    shortLabel: 'IG Story',
    summary: 'High-detail 1920 px photo / 720p higher-bitrate MP4 preserving texture and sharpness.',
    targetLimitLabel: '1080x1920 / 60 s',
    image: {
      presetId: 'instagram-story',
      maxEdgePx: 1920,
      outputFormat: 'image/jpeg',
      quality: 0.9,
      sharpenAmount: 0.4,
      stripMetadata: true,
    },
    video: {
      presetId: 'instagram-story',
      maxHeightPx: 720,
      targetBitrateBps: 2_800_000,
      crf: 23,
      trimStartSec: 0,
      trimEndSec: 60,
      muteAudio: false,
    },
  },
  {
    id: 'custom',
    label: 'Custom',
    shortLabel: 'Custom',
    summary: 'Manual control over target edge, format, quality, sharpen, trim window, and audio.',
    targetLimitLabel: 'Manual parameters',
    image: {
      presetId: 'custom',
      maxEdgePx: 1600,
      outputFormat: 'image/webp',
      quality: 0.85,
      sharpenAmount: 0.3,
      stripMetadata: true,
    },
    video: {
      presetId: 'custom',
      maxHeightPx: 720,
      targetBitrateBps: 2_000_000,
      crf: 25,
      trimStartSec: 0,
      trimEndSec: null,
      muteAudio: false,
    },
  },
] as const;

export function getMediaPreset(presetId: MediaPresetId): MediaPresetSpec {
  return MEDIA_PRESETS.find((p) => p.id === presetId) ?? MEDIA_PRESETS[0];
}
