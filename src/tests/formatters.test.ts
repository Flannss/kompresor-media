import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeAspectRatioLabel, parseJpegExifOrientation } from '../features/upload/metadataReader';
import { useObjectUrl } from '../shared/hooks/useObjectUrl';
import { formatByteDelta, formatBytes } from '../shared/utils/formatBytes';
import { formatDuration, formatDurationPrecise } from '../shared/utils/formatDuration';

describe('formatBytes & formatByteDelta', () => {
  it('formats byte sizes consistently', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(1_964_198)).toBe('1.87 MB');
    expect(formatBytes(105 * 1024 * 1024)).toBe('105.0 MB');
    expect(formatBytes(-1)).toBe('0 B');
  });

  it('formats byte deltas with sign', () => {
    expect(formatByteDelta(0)).toBe('0 B');
    expect(formatByteDelta(-1_239_370)).toBe('-1.18 MB');
    expect(formatByteDelta(2048)).toBe('+2.00 KB');
  });
});

describe('formatDuration & formatDurationPrecise', () => {
  it('formats mm:ss, h:mm:ss, and sub-minute precision', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(8)).toBe('0:08');
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(-5)).toBe('0:00');

    expect(formatDurationPrecise(8.0)).toBe('8.00 s');
    expect(formatDurationPrecise(75)).toBe('1:15');
  });
});

describe('metadata helpers', () => {
  it('computes readable aspect ratios', () => {
    expect(computeAspectRatioLabel(1920, 1080)).toBe('16:9');
    expect(computeAspectRatioLabel(2400, 1600)).toBe('3:2');
    expect(computeAspectRatioLabel(1080, 1080)).toBe('1:1');
    expect(computeAspectRatioLabel(1600, 1067)).toBe('1.50:1');
  });

  it('parses JPEG EXIF Orientation in little-endian and big-endian TIFF blocks', () => {
    // Minimal SOI + APP1 Exif ("II" little-endian, 1 IFD0 entry: tag 0x0112 = 6)
    const leBytes = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xe1, 0x00, 0x20, // APP1 len = 32
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // TIFF II + IFD0 offset 8
      0x01, 0x00, // entry count = 1
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, // tag 0x0112 = 6
      0xff, 0xd9, // EOI
    ]);
    expect(parseJpegExifOrientation(leBytes)).toBe(6);

    // Big-endian "MM" with orientation = 3
    const beBytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe1, 0x00, 0x20,
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
      0x00, 0x01,
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x03, 0x00, 0x00,
      0xff, 0xd9,
    ]);
    expect(parseJpegExifOrientation(beBytes)).toBe(3);
  });
});

describe('useObjectUrl lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an ObjectURL, revokes previous URL on replacement, and revokes on unmount', () => {
    let seq = 1;
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:mock-${seq++}`);
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const blobA = new Blob(['a'], { type: 'image/png' });
    const blobB = new Blob(['b'], { type: 'image/png' });

    const { result, rerender, unmount } = renderHook(
      ({ src }: { src: Blob | null }) => useObjectUrl(src),
      { initialProps: { src: blobA } }
    );

    expect(result.current).toBe('blob:mock-1');
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).not.toHaveBeenCalled();

    rerender({ src: blobB });
    expect(result.current).toBe('blob:mock-2');
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-1');

    unmount();
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-2');
    expect(revokeSpy).toHaveBeenCalledTimes(2);
  });
});
