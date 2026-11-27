import type { ColorGradeState, EnhancementSuiteState } from './gradeAndEnhance';
import type { ImageMetadata } from './media';

export type ImagePresetId =
  | 'whatsapp-hd'
  | 'whatsapp-fast'
  | 'whatsapp-status'
  | 'instagram-story'
  | 'instagram-feed'
  | 'tiktok-hd'
  | 'web-light'
  | 'archive-hd'
  | 'custom';

export type ImageOutputFormat = 'image/jpeg' | 'image/webp' | 'image/png' | 'image/avif';

export type ImageRotation = 0 | 90 | 180 | 270;

export type CropAspectId = 'free' | '1:1' | '4:5' | '3:4' | '16:9' | '9:16';

export type PhotoQualityModel = 'realphoto' | 'high-quality';

export type PhotoTargetResolution = 'original' | 'hd' | '2k' | '4k' | '8k';

export type PhotoFilterId =
  | 'original'
  | 'realphoto'
  | 'flagship-pro'
  | 'cinematic'
  | 'golden-hour'
  | 'vintage-kodak'
  | 'vivid-hdr'
  | 'editorial-matte'
  | 'pastel-soft'
  | 'cool-studio'
  | 'moody-dark'
  | 'noir-bw';

export interface NormalizedCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageColorAdjustments {
  /** Range: -100..100 (0 = neutral) */
  brightness: number;
  /** Range: -100..100 (0 = neutral) */
  contrast: number;
  /** Range: -100..100 (0 = neutral) */
  highlights: number;
  /** Range: -100..100 (0 = neutral) */
  shadows: number;
  /** Range: -100..100 (0 = neutral) */
  clarity: number;
  /** Range: 0..100 (0 = none) */
  vignette: number;
  /** Range: -100..100 (0 = neutral) */
  saturation: number;
  /** Range: -100..100 (0 = neutral) */
  vibrance: number;
  /** Range: -100..100 (negative = cool, positive = warm) */
  temperature: number;
  /** Range: -100..100 (negative = green, positive = magenta) */
  tint: number;
}

export interface ImageEditState {
  presetId: ImagePresetId;
  /** Longest edge target in pixels; null keeps original dimensions. */
  maxEdgePx: number | null;
  targetResolution: PhotoTargetResolution;
  qualityModel: PhotoQualityModel;
  outputFormat: ImageOutputFormat;
  /** Normalized quality between 0.1 and 1.0 (ignored for lossless PNG). */
  quality: number;
  /** Optional target ceiling in kilobytes (null = use quality slider directly). */
  targetSizeKB: number | null;
  /** Pre-color edge-preserving denoise level between 0 and 100. */
  denoiseAmount: number;
  /** Post-resize sharpening level between 0 and 100. */
  sharpenAmount: number;
  /** Pro Photo Studio color look (12 looks) + intensity 0..100 */
  photoFilterId: PhotoFilterId;
  photoFilterIntensity: number;
  /** Clockwise rotation in degrees. */
  rotationDeg: ImageRotation;
  /** Fine straighten angle in degrees (-15..+15), inscribed auto-cropped to avoid black corners. */
  straightenDeg: number;
  flipH: boolean;
  flipV: boolean;
  crop: NormalizedCropRect | null;
  adjustments: ImageColorAdjustments;
  colorGrade: ColorGradeState;
  enhanceSuite: EnhancementSuiteState;
  stripMetadata: boolean;
}

export interface ImageProcessRequest {
  requestId: string;
  file: File;
  sourceMetadata: ImageMetadata;
  edit: ImageEditState;
  /** Optional temporary cap during fast live slider preview. */
  previewMaxEdgePx?: number;
  /** Runtime canvas total-pixel guardrail to prevent OOM on mobile/iOS Safari. */
  maxCanvasPixels?: number;
  /** Whether 8K export is permitted on this device. */
  allow8K?: boolean;
}

export type ImageExecutionBackend = 'worker-offscreen-canvas' | 'main-thread-canvas-fallback';

export interface ImageProcessResult {
  requestId: string;
  backend: ImageExecutionBackend;
  outputBlob: Blob;
  outputFileName: string;
  outputMime: ImageOutputFormat;
  outputWidth: number;
  outputHeight: number;
  inputBytes: number;
  outputBytes: number;
  durationMs: number;
  solvedQuality?: number;
  targetSizeMet?: boolean;
  clampedByMemoryGuard?: boolean;
  appliedTargetResolution?: PhotoTargetResolution;
  activeModules?: string[];
}
