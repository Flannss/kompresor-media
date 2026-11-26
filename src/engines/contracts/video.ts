import type { VideoMetadata } from './media';

export type VideoPresetId =
  | 'whatsapp-chat'
  | 'whatsapp-status'
  | 'instagram-story'
  | 'web-light'
  | 'custom';

export type VideoExecutionBackend = 'webcodecs-mediabunny' | 'ffmpeg-wasm-st';

export type VideoQualityTier = 'light' | 'balanced' | 'high';

export interface VideoEditState {
  presetId: VideoPresetId;
  /** Max height in pixels (null keeps original height while ensuring even dimensions). */
  maxHeightPx: number | null;
  qualityTier: VideoQualityTier;
  targetBitrateBps: number;
  crf: number;
  maxrateKbps: number;
  bufsizeKbps: number;
  audioBitrateKbps: number;
  trimStartSec: number;
  trimEndSec: number | null;
  muteAudio: boolean;
}

export type VideoProcessStage =
  | 'probing'
  | 'loading-core'
  | 'demuxing'
  | 'transcoding'
  | 'muxing'
  | 'finalizing';

export interface VideoProcessProgress {
  requestId: string;
  backend: VideoExecutionBackend;
  stage: VideoProcessStage;
  /** Clamped progress ratio in [0, 1]. */
  ratio: number;
  elapsedMs: number;
  detail?: string;
}

export interface VideoProcessRequest {
  requestId: string;
  file: File;
  sourceMetadata: VideoMetadata;
  edit: VideoEditState;
  preferredBackend?: VideoExecutionBackend | 'auto';
}

export interface VideoProcessResult {
  requestId: string;
  backend: VideoExecutionBackend;
  outputBlob: Blob;
  outputFileName: string;
  outputMime: 'video/mp4';
  outputWidth: number;
  outputHeight: number;
  durationSec: number;
  hasAudio: boolean;
  inputBytes: number;
  outputBytes: number;
  durationMs: number;
}
