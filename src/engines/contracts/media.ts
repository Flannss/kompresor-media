export type MediaKind = 'image' | 'video';

export type SupportedImageMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  | 'image/avif';

export type SupportedVideoMime =
  | 'video/mp4'
  | 'video/quicktime'
  | 'video/webm'
  | 'video/x-matroska';

export type SupportedMediaMime = SupportedImageMime | SupportedVideoMime;

export type Orientation = 'landscape' | 'portrait' | 'square';

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface DetectedSignature {
  kind: MediaKind;
  mimeType: SupportedMediaMime;
  extension: string;
  label: string;
}

export type ValidationErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'CORRUPT_HEADER'
  | 'SIGNATURE_MISMATCH';

export type ValidationResult =
  | {
      valid: true;
      kind: MediaKind;
      detectedMime: SupportedMediaMime;
      declaredMime: string;
      fileName: string;
      sizeBytes: number;
      signatureLabel: string;
      warnings: string[];
    }
  | {
      valid: false;
      errorCode: ValidationErrorCode;
      reason: string;
      declaredMime: string;
      detectedSignatureLabel: string | null;
      fileName: string;
      sizeBytes: number;
    };

export interface ImageMetadata {
  kind: 'image';
  fileName: string;
  mimeType: SupportedImageMime;
  sizeBytes: number;
  width: number;
  height: number;
  orientation: Orientation;
  aspectRatio: string;
  exifOrientation: ExifOrientation | null;
  hasAlpha: boolean;
  isAnimated: boolean;
}

export interface VideoMetadata {
  kind: 'video';
  fileName: string;
  mimeType: SupportedVideoMime;
  sizeBytes: number;
  width: number;
  height: number;
  orientation: Orientation;
  aspectRatio: string;
  durationSec: number;
  fpsHint?: number | null;
  codecHint: string | null;
  hasAudioHint: boolean | null;
}

export type MediaMetadata = ImageMetadata | VideoMetadata;
