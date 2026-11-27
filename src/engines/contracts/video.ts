import type { ColorGradeState, EnhancementSuiteState } from './gradeAndEnhance';
import type { VideoMetadata } from './media';

export type VideoPresetId =
  | 'whatsapp-hd'
  | 'whatsapp-fast'
  | 'whatsapp-status'
  | 'instagram-story'
  | 'tiktok-hd'
  | 'web-light'
  | 'custom';

export type VideoOutputFormat = 'mp4' | 'mov' | 'webm' | 'mkv';
export type VideoOutputMime =
  | 'video/mp4'
  | 'video/quicktime'
  | 'video/webm'
  | 'video/x-matroska';

export type VideoExecutionBackend = 'webcodecs-mediabunny' | 'ffmpeg-wasm-st';

export type VideoQualityTier = 'light' | 'balanced' | 'high';

export type VideoClarityModel = 'original' | 'natural-hd' | 'sharp-1080p' | 'low-light';
export type VideoTargetResolution = 'original' | '720p' | '1080p' | '2k';

export type AudioBitrateKbps = 96 | 128 | 160 | 192 | 320;

export type SubtitleRenderMode = 'hardsub' | 'softsub';
export type SubtitleSize = 'small' | 'medium' | 'large';
export type SubtitlePosition = 'bottom' | 'center' | 'top';

export interface VideoStabilizeOptions {
  enabled: boolean;
  mode: 'light' | 'medium';
}

export interface VideoAudioOptions {
  enabled: boolean;
  muteAudio: boolean;
  /** Range: -12..+12 dB */
  volumeDb: number;
  normalize: boolean;
  vocalClarity: boolean;
  /** Range: -6..+6 dB */
  bassDb: number;
  /** Range: -6..+6 dB */
  trebleDb: number;
  fadeInOut: boolean;
  bitrateKbps: AudioBitrateKbps;
}

export interface SubtitleCue {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
}

export interface VideoSubtitleOptions {
  enabled: boolean;
  mode: SubtitleRenderMode;
  cues: SubtitleCue[];
  size: SubtitleSize;
  position: SubtitlePosition;
  sourceFileName: string | null;
}

export interface VideoEditState {
  presetId: VideoPresetId;
  compressEnabled: boolean;
  outputFormat: VideoOutputFormat;
  /** Semantic target resolution preset/override ('original' honors maxHeightPx). */
  targetResolution: VideoTargetResolution;
  /** Max height in pixels (null keeps original height while ensuring even dimensions). */
  maxHeightPx: number | null;
  fpsCap: number | null;
  qualityTier: VideoQualityTier;
  clarityModel: VideoClarityModel;
  /** Clarity strength 0..100 (default 80). */
  clarityStrength: number;
  targetBitrateBps: number;
  crf: number;
  maxrateKbps: number;
  bufsizeKbps: number;
  audioBitrateKbps: AudioBitrateKbps;
  trimStartSec: number;
  trimEndSec: number | null;
  muteAudio: boolean;
  enhanceSuite: EnhancementSuiteState;
  colorGrade: ColorGradeState;
  stabilize: VideoStabilizeOptions;
  audio: VideoAudioOptions;
  subtitle: VideoSubtitleOptions;
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
  outputFormat: VideoOutputFormat;
  outputMime: VideoOutputMime;
  outputWidth: number;
  outputHeight: number;
  durationSec: number;
  hasAudio: boolean;
  inputBytes: number;
  outputBytes: number;
  durationMs: number;
  activeModules: string[];
  effectiveBitrateMbps?: number;
  colorStandard?: string;
  appliedFps?: number | null;
  engineDetail?: string;
  notice?: string;
}
