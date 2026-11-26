import type {
  ImageEditState,
  ImagePresetId,
  VideoEditState,
  VideoPresetId,
} from '../engines/contracts';

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
    label: 'WhatsApp',
    shortLabel: 'WhatsApp',
    summary: 'Foto dikecilkan ke 1600 px dengan format JPG agar tetap jernih dan ringan dikirim lewat chat.',
    targetLimitLabel: 'Ringan & cepat kirim',
    image: {
      presetId: 'whatsapp-chat',
      maxEdgePx: 1600,
      outputFormat: 'image/jpeg',
      quality: 0.82,
      sharpenAmount: 20,
      rotationDeg: 0,
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
    label: 'Status WA',
    shortLabel: 'Status WA',
    summary: 'Resolusi hingga 1920 px dengan kualitas 85% supaya foto status tetap tajam.',
    targetLimitLabel: 'Tajam untuk status',
    image: {
      presetId: 'whatsapp-status',
      maxEdgePx: 1920,
      outputFormat: 'image/jpeg',
      quality: 0.85,
      sharpenAmount: 15,
      rotationDeg: 0,
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
    label: 'Story IG',
    shortLabel: 'Story IG',
    summary: 'Detail tinggi hingga 1920 px dengan kompresi seimbang untuk Story atau Feed.',
    targetLimitLabel: 'Kualitas visual seimbang',
    image: {
      presetId: 'instagram-story',
      maxEdgePx: 1920,
      outputFormat: 'image/jpeg',
      quality: 0.86,
      sharpenAmount: 15,
      rotationDeg: 0,
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
    label: 'Atur Sendiri',
    shortLabel: 'Atur Sendiri',
    summary: 'Sesuaikan format, batas ukuran, tingkat kualitas, dan arah foto secara manual.',
    targetLimitLabel: 'Sesuaikan manual',
    image: {
      presetId: 'custom',
      maxEdgePx: 1600,
      outputFormat: 'image/jpeg',
      quality: 0.85,
      sharpenAmount: 15,
      rotationDeg: 0,
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
