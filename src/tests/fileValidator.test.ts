import { describe, expect, it } from 'vitest';
import { scanMagicSignature, validateMediaFile } from '../features/upload/fileValidator';

function makeBytes(parts: Array<number | string>, totalLength = 32): Uint8Array {
  const buf = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    if (typeof part === 'number') {
      buf[offset] = part;
      offset += 1;
    } else {
      for (let i = 0; i < part.length; i += 1) {
        buf[offset] = part.charCodeAt(i);
        offset += 1;
      }
    }
  }
  return buf;
}

function makeFile(bytes: Uint8Array, name: string, type: string): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type });
}

describe('scanMagicSignature & validateMediaFile', () => {
  it('accepts valid JPEG, PNG, WebP, GIF, and AVIF signatures', async () => {
    const jpeg = makeFile(makeBytes([0xff, 0xd8, 0xff, 0xe0]), 'photo.jpg', 'image/jpeg');
    const png = makeFile(
      makeBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'photo.png',
      'image/png'
    );
    const webp = makeFile(
      makeBytes(['R', 'I', 'F', 'F', 0x24, 0, 0, 0, 'W', 'E', 'B', 'P']),
      'photo.webp',
      'image/webp'
    );
    const gif = makeFile(makeBytes(['GIF89a']), 'anim.gif', 'image/gif');
    const avif = makeFile(
      makeBytes([0, 0, 0, 0x18, 'ftyp', 'avif', 0, 0, 0, 0, 'mif1', 'avif']),
      'photo.avif',
      'image/avif'
    );

    expect(await validateMediaFile(jpeg)).toMatchObject({
      valid: true,
      kind: 'image',
      detectedMime: 'image/jpeg',
    });
    expect(await validateMediaFile(png)).toMatchObject({
      valid: true,
      kind: 'image',
      detectedMime: 'image/png',
    });
    expect(await validateMediaFile(webp)).toMatchObject({
      valid: true,
      kind: 'image',
      detectedMime: 'image/webp',
    });
    expect(await validateMediaFile(gif)).toMatchObject({
      valid: true,
      kind: 'image',
      detectedMime: 'image/gif',
    });
    expect(await validateMediaFile(avif)).toMatchObject({
      valid: true,
      kind: 'image',
      detectedMime: 'image/avif',
    });
  });

  it('accepts valid MP4, QuickTime MOV, and WebM video signatures', async () => {
    const mp4 = makeFile(
      makeBytes([0, 0, 0, 0x20, 'ftyp', 'isom', 0, 0, 2, 0, 'isom', 'iso2', 'avc1']),
      'clip.mp4',
      'video/mp4'
    );
    const mov = makeFile(
      makeBytes([0, 0, 0, 0x14, 'ftyp', 'qt  ', 0, 0, 0, 0, 'qt  ']),
      'clip.mov',
      'video/quicktime'
    );
    const webm = makeFile(
      makeBytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, 'webm']),
      'clip.webm',
      'video/webm'
    );

    expect(await validateMediaFile(mp4)).toMatchObject({
      valid: true,
      kind: 'video',
      detectedMime: 'video/mp4',
    });
    expect(await validateMediaFile(mov)).toMatchObject({
      valid: true,
      kind: 'video',
      detectedMime: 'video/quicktime',
    });
    expect(await validateMediaFile(webm)).toMatchObject({
      valid: true,
      kind: 'video',
      detectedMime: 'video/webm',
    });
  });

  it('accepts valid magic bytes even when browser declared MIME is empty string', async () => {
    const webp = makeFile(
      makeBytes(['R', 'I', 'F', 'F', 0x24, 0, 0, 0, 'W', 'E', 'B', 'P']),
      'dropped.webp',
      ''
    );
    const result = await validateMediaFile(webp);
    expect(result).toMatchObject({
      valid: true,
      kind: 'image',
      detectedMime: 'image/webp',
      warnings: [],
    });
  });

  it('rejects empty files with EMPTY_FILE', async () => {
    const empty = new File([], 'empty.jpg', { type: 'image/jpeg' });
    const result = await validateMediaFile(empty);
    expect(result).toMatchObject({
      valid: false,
      errorCode: 'EMPTY_FILE',
    });
  });

  it('rejects oversized files with FILE_TOO_LARGE', async () => {
    const png = makeFile(
      makeBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 1024),
      'big.png',
      'image/png'
    );
    const result = await validateMediaFile(png, { maxImageBytes: 512 });
    expect(result).toMatchObject({
      valid: false,
      errorCode: 'FILE_TOO_LARGE',
    });
  });

  it('rejects corrupt headers claiming an image/video MIME', async () => {
    const corrupt = makeFile(new TextEncoder().encode('not-actually-a-jpeg'), 'broken.jpg', 'image/jpeg');
    const result = await validateMediaFile(corrupt);
    expect(result).toMatchObject({
      valid: false,
      errorCode: 'CORRUPT_HEADER',
    });
  });

  it('rejects HEIC/HEIF as UNSUPPORTED_TYPE and accepts Matroska MKV cleanly', async () => {
    const heic = makeFile(
      makeBytes([0, 0, 0, 0x18, 'ftyp', 'heic', 0, 0, 0, 0, 'mif1', 'heic']),
      'iphone.heic',
      'image/heic'
    );
    expect(await validateMediaFile(heic)).toMatchObject({
      valid: false,
      errorCode: 'UNSUPPORTED_TYPE',
    });

    const mkvScan = scanMagicSignature(
      makeBytes([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x88, 'matroska'])
    );
    expect(mkvScan.signature).toMatchObject({
      kind: 'video',
      mimeType: 'video/x-matroska',
      extension: 'mkv',
    });
  });

  it('rejects cross-kind signature spoofing with SIGNATURE_MISMATCH', async () => {
    const spoofed = makeFile(
      makeBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'fake-video.mp4',
      'video/mp4'
    );
    expect(await validateMediaFile(spoofed)).toMatchObject({
      valid: false,
      errorCode: 'SIGNATURE_MISMATCH',
    });
  });

  it('warns on same-kind extension/MIME mismatch and uses detected MIME', async () => {
    const mislabeledPng = makeFile(
      makeBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'actually-png.jpg',
      'image/jpeg'
    );
    const result = await validateMediaFile(mislabeledPng);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.detectedMime).toBe('image/png');
      expect(result.warnings).toHaveLength(1);
    }
  });
});
