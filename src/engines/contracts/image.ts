import type { ImageMetadata } from './media';

export type ImagePresetId = 'whatsapp-chat' | 'whatsapp-status' | 'instagram-story' | 'custom';

export type ImageOutputFormat = 'image/jpeg' | 'image/webp' | 'image/png';

export type ImageRotation = 0 | 90 | 180 | 270;

export interface ImageEditState {
  presetId: ImagePresetId;
  /** Longest edge target in pixels; null keeps original dimensions. */
  maxEdgePx: number | null;
  outputFormat: ImageOutputFormat;
  /** Normalized quality between 0.1 and 1.0 (ignored for lossless PNG). */
  quality: number;
  /** Post-resize sharpening level between 0 and 100. */
  sharpenAmount: number;
  /** Clockwise rotation in degrees. */
  rotationDeg: ImageRotation;
  stripMetadata: boolean;
}

export interface ImageProcessRequest {
  requestId: string;
  file: File;
  sourceMetadata: ImageMetadata;
  edit: ImageEditState;
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
}
