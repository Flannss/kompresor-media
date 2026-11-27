import type { ColorGradeState, EnhancementSuiteState } from './gradeAndEnhance';
import type { ImageMetadata } from './media';

export type ImagePresetId =
  | 'whatsapp-hd'
  | 'whatsapp-fast'
  | 'whatsapp-status'
  | 'instagram-story'
  | 'web-light'
  | 'custom';

export type ImageOutputFormat = 'image/jpeg' | 'image/webp' | 'image/png' | 'image/avif';

export type ImageRotation = 0 | 90 | 180 | 270;

export type CropAspectId = 'free' | '1:1' | '4:5' | '16:9' | '9:16';

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
  saturation: number;
  /** Range: -100..100 (negative = cool, positive = warm) */
  temperature: number;
}

export interface ImageEditState {
  presetId: ImagePresetId;
  /** Longest edge target in pixels; null keeps original dimensions. */
  maxEdgePx: number | null;
  outputFormat: ImageOutputFormat;
  /** Normalized quality between 0.1 and 1.0 (ignored for lossless PNG). */
  quality: number;
  /** Optional target ceiling in kilobytes (null = use quality slider directly). */
  targetSizeKB: number | null;
  /** Post-resize sharpening level between 0 and 100. */
  sharpenAmount: number;
  /** Clockwise rotation in degrees. */
  rotationDeg: ImageRotation;
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
  activeModules?: string[];
}
