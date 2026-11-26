import type {
  DetectedSignature,
  SupportedMediaMime,
  ValidationResult,
} from '../../engines/contracts';

export const DEFAULT_MAX_IMAGE_BYTES = 50 * 1024 * 1024; // 50 MB
export const DEFAULT_MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB

export interface ValidateFileOptions {
  maxImageBytes?: number;
  maxVideoBytes?: number;
}

export interface SignatureScanResult {
  signature: DetectedSignature | null;
  unsupportedReason: string | null;
  unsupportedLabel: string | null;
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);
const MP4_BRANDS = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'mmp4', 'f4v ']);

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  const end = Math.min(bytes.length, offset + length);
  for (let i = offset; i < end; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function bytesContainAscii(bytes: Uint8Array, needle: string): boolean {
  const limit = bytes.length - needle.length;
  for (let i = 0; i <= limit; i += 1) {
    let match = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle.charCodeAt(j)) {
        match = false;
        break;
      }
    }
    if (match) {
      return true;
    }
  }
  return false;
}

export function scanMagicSignature(bytes: Uint8Array): SignatureScanResult {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return {
      signature: { kind: 'image', mimeType: 'image/jpeg', extension: 'jpg', label: 'JPEG' },
      unsupportedReason: null,
      unsupportedLabel: null,
    };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return {
      signature: { kind: 'image', mimeType: 'image/png', extension: 'png', label: 'PNG' },
      unsupportedReason: null,
      unsupportedLabel: null,
    };
  }

  // GIF: GIF87a / GIF89a
  if (bytes.length >= 6) {
    const gifSig = readAscii(bytes, 0, 6);
    if (gifSig === 'GIF87a' || gifSig === 'GIF89a') {
      return {
        signature: { kind: 'image', mimeType: 'image/gif', extension: 'gif', label: 'GIF' },
        unsupportedReason: null,
        unsupportedLabel: null,
      };
    }
  }

  // WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    readAscii(bytes, 0, 4) === 'RIFF' &&
    readAscii(bytes, 8, 4) === 'WEBP'
  ) {
    return {
      signature: { kind: 'image', mimeType: 'image/webp', extension: 'webp', label: 'WebP' },
      unsupportedReason: null,
      unsupportedLabel: null,
    };
  }

  // WebM / Matroska (EBML header: 1A 45 DF A3)
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    if (bytesContainAscii(bytes, 'webm')) {
      return {
        signature: { kind: 'video', mimeType: 'video/webm', extension: 'webm', label: 'WebM' },
        unsupportedReason: null,
        unsupportedLabel: null,
      };
    }
    if (bytesContainAscii(bytes, 'matroska')) {
      return {
        signature: null,
        unsupportedReason:
          'Format video MKV belum didukung oleh browser. Ubah atau simpan ulang ke MP4 atau WebM.',
        unsupportedLabel: 'Matroska (MKV)',
      };
    }
  }

  // ISO BMFF: [4-byte box size][ftyp][major_brand][minor_version][compatible_brands...]
  if (bytes.length >= 12 && readAscii(bytes, 4, 4) === 'ftyp') {
    const majorBrand = readAscii(bytes, 8, 4);
    const compatibleBrands: string[] = [majorBrand];
    for (let offset = 16; offset + 4 <= bytes.length; offset += 4) {
      compatibleBrands.push(readAscii(bytes, offset, 4));
    }

    if (HEIF_BRANDS.has(majorBrand)) {
      return {
        signature: null,
        unsupportedReason:
          'Foto HEIC/HEIF belum didukung langsung oleh sebagian besar browser. Ubah ke JPG atau PNG terlebih dahulu.',
        unsupportedLabel: `HEIC/HEIF (${majorBrand})`,
      };
    }

    if (majorBrand === 'avif' || majorBrand === 'avis') {
      return {
        signature: { kind: 'image', mimeType: 'image/avif', extension: 'avif', label: 'AVIF' },
        unsupportedReason: null,
        unsupportedLabel: null,
      };
    }

    if (majorBrand === 'qt  ') {
      return {
        signature: {
          kind: 'video',
          mimeType: 'video/quicktime',
          extension: 'mov',
          label: 'QuickTime MOV',
        },
        unsupportedReason: null,
        unsupportedLabel: null,
      };
    }

    if (compatibleBrands.some((b) => MP4_BRANDS.has(b))) {
      return {
        signature: { kind: 'video', mimeType: 'video/mp4', extension: 'mp4', label: 'MP4' },
        unsupportedReason: null,
        unsupportedLabel: null,
      };
    }

    if (compatibleBrands.some((b) => b === 'avif' || b === 'avis')) {
      return {
        signature: { kind: 'image', mimeType: 'image/avif', extension: 'avif', label: 'AVIF' },
        unsupportedReason: null,
        unsupportedLabel: null,
      };
    }
  }

  return {
    signature: null,
    unsupportedReason: null,
    unsupportedLabel: null,
  };
}

function normalizeDeclaredMime(mime: string): string {
  const normalized = mime.trim().toLowerCase();
  if (normalized === 'image/jpg') {
    return 'image/jpeg';
  }
  return normalized;
}

function expectedKindFromMime(declaredMime: string): 'image' | 'video' | null {
  if (declaredMime.startsWith('image/')) {
    return 'image';
  }
  if (declaredMime.startsWith('video/')) {
    return 'video';
  }
  return null;
}

function formatLimitMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export async function validateMediaFile(
  file: File,
  options: ValidateFileOptions = {}
): Promise<ValidationResult> {
  const maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const maxVideoBytes = options.maxVideoBytes ?? DEFAULT_MAX_VIDEO_BYTES;
  const declaredMime = normalizeDeclaredMime(file.type || '');

  if (file.size === 0) {
    return {
      valid: false,
      errorCode: 'EMPTY_FILE',
      reason: `File "${file.name}" kosong dan tidak memiliki isi.`,
      declaredMime,
      detectedSignatureLabel: null,
      fileName: file.name,
      sizeBytes: file.size,
    };
  }

  const headerSlice = file.slice(0, 64);
  const headerBuffer = await headerSlice.arrayBuffer();
  const headerBytes = new Uint8Array(headerBuffer);
  const scan = scanMagicSignature(headerBytes);

  if (scan.unsupportedReason) {
    return {
      valid: false,
      errorCode: 'UNSUPPORTED_TYPE',
      reason: scan.unsupportedReason,
      declaredMime,
      detectedSignatureLabel: scan.unsupportedLabel,
      fileName: file.name,
      sizeBytes: file.size,
    };
  }

  if (!scan.signature) {
    const declaredKind = expectedKindFromMime(declaredMime);
    return {
      valid: false,
      errorCode: declaredKind ? 'CORRUPT_HEADER' : 'UNSUPPORTED_TYPE',
      reason: declaredKind
        ? `File "${file.name}" rusak atau format aslinya tidak sesuai. Pilih foto atau video lain.`
        : `Format file "${file.name}" tidak didukung. Pilih foto JPG, PNG, WebP, GIF, AVIF atau video MP4, MOV, WebM.`,
      declaredMime,
      detectedSignatureLabel: null,
      fileName: file.name,
      sizeBytes: file.size,
    };
  }

  const detected: DetectedSignature = scan.signature;
  const declaredKind = expectedKindFromMime(declaredMime);
  if (declaredKind && declaredKind !== detected.kind) {
    return {
      valid: false,
      errorCode: 'SIGNATURE_MISMATCH',
      reason: `Isi file "${file.name}" tidak sesuai dengan ekstensinya (terdeteksi sebagai ${detected.label}).`,
      declaredMime,
      detectedSignatureLabel: detected.label,
      fileName: file.name,
      sizeBytes: file.size,
    };
  }

  const limitBytes = detected.kind === 'image' ? maxImageBytes : maxVideoBytes;
  if (file.size > limitBytes) {
    const kindLabel = detected.kind === 'image' ? 'foto' : 'video';
    return {
      valid: false,
      errorCode: 'FILE_TOO_LARGE',
      reason: `Ukuran file "${file.name}" melebihi batas maksimal ${formatLimitMb(limitBytes)} untuk ${kindLabel}.`,
      declaredMime,
      detectedSignatureLabel: detected.label,
      fileName: file.name,
      sizeBytes: file.size,
    };
  }

  const warnings: string[] = [];
  if (declaredMime && declaredMime !== detected.mimeType) {
    warnings.push(
      `Ekstensi file berbeda dengan isi aslinya; dibaca sebagai format ${detected.label}.`
    );
  }

  return {
    valid: true,
    kind: detected.kind,
    detectedMime: detected.mimeType as SupportedMediaMime,
    declaredMime,
    fileName: file.name,
    sizeBytes: file.size,
    signatureLabel: detected.label,
    warnings,
  };
}
