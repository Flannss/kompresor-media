import type {
  ExifOrientation,
  ImageMetadata,
  MediaMetadata,
  Orientation,
  SupportedImageMime,
  SupportedVideoMime,
  ValidationResult,
  VideoMetadata,
} from '../../engines/contracts';

function computeOrientation(width: number, height: number): Orientation {
  if (width === height) {
    return 'square';
  }
  return width > height ? 'landscape' : 'portrait';
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function computeAspectRatioLabel(width: number, height: number): string {
  if (width <= 0 || height <= 0) {
    return '—';
  }
  const divisor = gcd(width, height);
  const w = Math.round(width / divisor);
  const h = Math.round(height / divisor);
  if (w <= 25 && h <= 25) {
    return `${w}:${h}`;
  }
  return `${(width / height).toFixed(2)}:1`;
}

function readUint16(view: DataView, offset: number, littleEndian: boolean): number {
  return view.getUint16(offset, littleEndian);
}

function readUint32(view: DataView, offset: number, littleEndian: boolean): number {
  return view.getUint32(offset, littleEndian);
}

/**
 * Extracts EXIF Orientation (tag 0x0112) from the first 64 KB of a JPEG file.
 */
export function parseJpegExifOrientation(bytes: Uint8Array): ExifOrientation | null {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      break;
    }
    const marker = bytes[offset + 1];
    offset += 2;

    if (marker === 0xda || marker === 0xd9) {
      break;
    }
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 2 > bytes.length) {
      break;
    }
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      break;
    }

    if (
      marker === 0xe1 &&
      segmentLength >= 16 &&
      bytes[offset + 2] === 0x45 &&
      bytes[offset + 3] === 0x78 &&
      bytes[offset + 4] === 0x69 &&
      bytes[offset + 5] === 0x66 &&
      bytes[offset + 6] === 0x00 &&
      bytes[offset + 7] === 0x00
    ) {
      const tiffStart = offset + 8;
      if (tiffStart + 8 > bytes.length) {
        return null;
      }
      const byteOrder =
        bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49
          ? true
          : bytes[tiffStart] === 0x4d && bytes[tiffStart + 1] === 0x4d
            ? false
            : null;

      if (byteOrder === null) {
        return null;
      }
      if (readUint16(view, tiffStart + 2, byteOrder) !== 0x002a) {
        return null;
      }

      const ifdOffset = readUint32(view, tiffStart + 4, byteOrder);
      const ifdStart = tiffStart + ifdOffset;
      if (ifdStart + 2 > bytes.length) {
        return null;
      }

      const entryCount = readUint16(view, ifdStart, byteOrder);
      for (let i = 0; i < entryCount; i += 1) {
        const entryStart = ifdStart + 2 + i * 12;
        if (entryStart + 12 > bytes.length) {
          break;
        }
        const tag = readUint16(view, entryStart, byteOrder);
        if (tag === 0x0112) {
          const val = readUint16(view, entryStart + 8, byteOrder);
          if (val >= 1 && val <= 8) {
            return val as ExifOrientation;
          }
          return null;
        }
      }
      return null;
    }

    offset += segmentLength;
  }

  return null;
}

interface ImageHeaderHints {
  exifOrientation: ExifOrientation | null;
  hasAlpha: boolean;
  isAnimated: boolean;
}

function bytesContainSequence(bytes: Uint8Array, seq: readonly number[]): boolean {
  const limit = bytes.length - seq.length;
  for (let i = 0; i <= limit; i += 1) {
    let ok = true;
    for (let j = 0; j < seq.length; j += 1) {
      if (bytes[i + j] !== seq[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return true;
    }
  }
  return false;
}

function analyzeImageHeaderHints(
  bytes: Uint8Array,
  mimeType: SupportedImageMime
): ImageHeaderHints {
  if (mimeType === 'image/jpeg') {
    return {
      exifOrientation: parseJpegExifOrientation(bytes),
      hasAlpha: false,
      isAnimated: false,
    };
  }

  if (mimeType === 'image/png') {
    const colorType = bytes.length > 25 ? bytes[25] : 0;
    const hasAlphaChannel = colorType === 4 || colorType === 6;
    const hasTrnsChunk = bytesContainSequence(bytes, [0x74, 0x52, 0x4e, 0x53]);
    const hasAcTlChunk = bytesContainSequence(bytes, [0x61, 0x63, 0x54, 0x4c]);
    return {
      exifOrientation: null,
      hasAlpha: hasAlphaChannel || hasTrnsChunk,
      isAnimated: hasAcTlChunk,
    };
  }

  if (mimeType === 'image/webp') {
    const chunkFourCc =
      bytes.length >= 16
        ? String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
        : '';
    if (chunkFourCc === 'VP8X' && bytes.length > 20) {
      const flags = bytes[20];
      return {
        exifOrientation: null,
        hasAlpha: (flags & 0x10) !== 0,
        isAnimated: (flags & 0x02) !== 0,
      };
    }
    return {
      exifOrientation: null,
      hasAlpha: chunkFourCc === 'VP8L',
      isAnimated: false,
    };
  }

  if (mimeType === 'image/gif') {
    let gceCount = 0;
    for (let i = 0; i + 2 < bytes.length; i += 1) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) {
        gceCount += 1;
        if (gceCount >= 2) {
          break;
        }
      }
    }
    return {
      exifOrientation: null,
      hasAlpha: true,
      isAnimated: gceCount >= 2,
    };
  }

  return {
    exifOrientation: null,
    hasAlpha: bytesContainSequence(bytes, [0x61, 0x75, 0x78, 0x43]),
    isAnimated: false,
  };
}

async function decodeImageDimensions(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      try {
        if (bitmap.width > 0 && bitmap.height > 0) {
          return { width: bitmap.width, height: bitmap.height };
        }
      } finally {
        bitmap.close();
      }
    } catch {
      // Fallback to HTMLImageElement below
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
        } else {
          reject(new Error(`Tidak dapat membaca ukuran foto "${file.name}".`));
        }
      };
      img.onerror = () => {
        reject(new Error(`Foto "${file.name}" rusak atau tidak dapat dibuka oleh browser.`));
      };
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function readImageMetadata(
  file: File,
  mimeType: SupportedImageMime
): Promise<ImageMetadata> {
  const headerSlice = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  const [dims, hints] = await Promise.all([
    decodeImageDimensions(file),
    Promise.resolve(analyzeImageHeaderHints(headerSlice, mimeType)),
  ]);

  return {
    kind: 'image',
    fileName: file.name,
    mimeType,
    sizeBytes: file.size,
    width: dims.width,
    height: dims.height,
    orientation: computeOrientation(dims.width, dims.height),
    aspectRatio: computeAspectRatioLabel(dims.width, dims.height),
    exifOrientation: hints.exifOrientation,
    hasAlpha: hints.hasAlpha,
    isAnimated: hints.isAnimated,
  };
}

function scanMp4VideoFpsHint(ascii: string, bytes: Uint8Array): number | null {
  try {
    let searchFrom = 0;
    while (searchFrom < ascii.length) {
      const hdlrIdx = ascii.indexOf('hdlrvide', searchFrom);
      const videIdx = hdlrIdx !== -1 ? hdlrIdx : ascii.indexOf('vide', searchFrom);
      if (videIdx === -1) break;

      const mdiaIdx = ascii.lastIndexOf('mdia', videIdx);
      if (mdiaIdx !== -1 && videIdx - mdiaIdx < 4096) {
        const mdhdIdx = ascii.indexOf('mdhd', mdiaIdx);
        const sttsIdx = ascii.indexOf('stts', mdiaIdx);
        if (mdhdIdx !== -1 && sttsIdx !== -1 && sttsIdx - mdiaIdx < 65536) {
          const mdhdVersion = bytes[mdhdIdx + 4] ?? 0;
          const timescaleOffset = mdhdIdx + 4 + 4 + (mdhdVersion === 1 ? 16 : 8);
          if (timescaleOffset + 4 <= bytes.length && sttsIdx + 20 <= bytes.length) {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const timescale = view.getUint32(timescaleOffset, false);
            const entryCount = view.getUint32(sttsIdx + 8, false);
            const sampleDelta = entryCount >= 1 ? view.getUint32(sttsIdx + 16, false) : 0;
            if (timescale > 0 && sampleDelta > 0) {
              const fps = Math.round(timescale / sampleDelta);
              if (fps >= 10 && fps <= 240) {
                return fps;
              }
            }
          }
        }
      }
      searchFrom = videIdx + 4;
    }
  } catch {
    // Non-fatal FPS header inspection failure
  }
  return null;
}

function scanVideoCodecs(chunk: Uint8Array): {
  codecHint: string | null;
  hasAudioHint: boolean | null;
  fpsHint: number | null;
} {
  const ascii = new TextDecoder('latin1').decode(chunk);
  const videoParts: string[] = [];
  const audioParts: string[] = [];

  if (ascii.includes('avc1') || ascii.includes('avc3')) videoParts.push('H.264');
  else if (ascii.includes('hvc1') || ascii.includes('hev1')) videoParts.push('HEVC');
  else if (ascii.includes('av01')) videoParts.push('AV1');
  else if (ascii.includes('vp09') || ascii.includes('V_VP9')) videoParts.push('VP9');
  else if (ascii.includes('vp08') || ascii.includes('V_VP8')) videoParts.push('VP8');

  if (ascii.includes('mp4a')) audioParts.push('AAC');
  else if (ascii.includes('Opus') || ascii.includes('A_OPUS')) audioParts.push('Opus');
  else if (ascii.includes('A_VORBIS')) audioParts.push('Vorbis');
  else if (ascii.includes('ac-3') || ascii.includes('ec-3')) audioParts.push('Dolby');

  const combined = [...videoParts, ...audioParts];
  return {
    codecHint: combined.length > 0 ? combined.join(' + ') : null,
    hasAudioHint: audioParts.length > 0 ? true : null,
    fpsHint: scanMp4VideoFpsHint(ascii, chunk),
  };
}

async function readVideoHeaderHints(
  file: File
): Promise<{ codecHint: string | null; hasAudioHint: boolean | null; fpsHint: number | null }> {
  const headSize = Math.min(file.size, 262144);
  const headBytes = new Uint8Array(await file.slice(0, headSize).arrayBuffer());
  let merged = headBytes;

  if (file.size > headSize) {
    const tailSize = Math.min(file.size - headSize, 131072);
    const tailBytes = new Uint8Array(await file.slice(file.size - tailSize).arrayBuffer());
    merged = new Uint8Array(headBytes.length + tailBytes.length);
    merged.set(headBytes, 0);
    merged.set(tailBytes, headBytes.length);
  }

  return scanVideoCodecs(merged);
}

export async function readVideoMetadata(
  file: File,
  mimeType: SupportedVideoMime
): Promise<VideoMetadata> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;

  try {
    const [dimsAndDuration, hints] = await Promise.all([
      new Promise<{ width: number; height: number; durationSec: number }>((resolve, reject) => {
        const onLoaded = () => {
          cleanup();
          if (video.videoWidth <= 0 || video.videoHeight <= 0) {
            reject(new Error(`Tidak ditemukan trek video yang dapat diputar di "${file.name}".`));
            return;
          }
          resolve({
            width: video.videoWidth,
            height: video.videoHeight,
            durationSec: Number.isFinite(video.duration) ? video.duration : 0,
          });
        };
        const onError = () => {
          cleanup();
          reject(new Error(`Video "${file.name}" rusak atau formatnya tidak didukung browser.`));
        };
        const cleanup = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
        };

        video.addEventListener('loadedmetadata', onLoaded);
        video.addEventListener('error', onError);
        video.src = objectUrl;
      }),
      readVideoHeaderHints(file),
    ]);

    return {
      kind: 'video',
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
      width: dimsAndDuration.width,
      height: dimsAndDuration.height,
      orientation: computeOrientation(dimsAndDuration.width, dimsAndDuration.height),
      aspectRatio: computeAspectRatioLabel(dimsAndDuration.width, dimsAndDuration.height),
      durationSec: dimsAndDuration.durationSec,
      fpsHint: hints.fpsHint,
      codecHint: hints.codecHint,
      hasAudioHint: hints.hasAudioHint,
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

export async function readMediaMetadata(
  file: File,
  validation: Extract<ValidationResult, { valid: true }>
): Promise<MediaMetadata> {
  if (validation.kind === 'image') {
    return readImageMetadata(file, validation.detectedMime as SupportedImageMime);
  }
  return readVideoMetadata(file, validation.detectedMime as SupportedVideoMime);
}
