import type { ImageMetadata } from './media';

export type ImagePresetId = 'whatsapp-chat' | 'whatsapp-status' | 'instagram-story' | 'custom';

export type ImageOutputFormat = 'image/jpeg' | 'image/webp' | 'image/png';

export interface ImageEditState {
  presetId: ImagePresetId;
  maxEdgePx: number;
  outputFormat: ImageOutputFormat;
  /** Normalized quality between 0.1 and 1.0 (ignored for lossless PNG). */
  quality: number;
  /** Unsharp/sharpen convolution strength between 0.0 and 2.0. */
  sharpenAmount: number;
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
