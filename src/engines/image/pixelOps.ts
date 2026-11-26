import type { ImageOutputFormat, ImageRotation } from '../contracts';

export interface Dimensions {
  width: number;
  height: number;
}

export function computeRotatedDimensions(
  width: number,
  height: number,
  rotationDeg: ImageRotation
): Dimensions {
  if (rotationDeg === 90 || rotationDeg === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

export function computeTargetDimensions(
  srcWidth: number,
  srcHeight: number,
  maxEdgePx: number | null
): Dimensions {
  if (srcWidth <= 0 || srcHeight <= 0) {
    throw new Error(`Dimensi foto tidak valid: ${srcWidth}x${srcHeight}`);
  }
  const longest = Math.max(srcWidth, srcHeight);
  if (maxEdgePx === null || maxEdgePx <= 0 || longest <= maxEdgePx) {
    return { width: srcWidth, height: srcHeight };
  }
  const scale = maxEdgePx / longest;
  return {
    width: Math.max(1, Math.round(srcWidth * scale)),
    height: Math.max(1, Math.round(srcHeight * scale)),
  };
}

/**
 * Generates progressive halving dimensions when downscaling more than 2x to reduce aliasing.
 */
export function computeProgressiveSteps(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): Dimensions[] {
  if (srcWidth <= dstWidth && srcHeight <= dstHeight) {
    return [{ width: dstWidth, height: dstHeight }];
  }

  const steps: Dimensions[] = [];
  let currentW = srcWidth;
  let currentH = srcHeight;

  while (currentW / dstWidth > 2 || currentH / dstHeight > 2) {
    const nextW = Math.max(dstWidth, Math.round(currentW / 2));
    const nextH = Math.max(dstHeight, Math.round(currentH / 2));
    if (nextW === currentW && nextH === currentH) {
      break;
    }
    if (nextW === dstWidth && nextH === dstHeight) {
      break;
    }
    steps.push({ width: nextW, height: nextH });
    currentW = nextW;
    currentH = nextH;
  }

  steps.push({ width: dstWidth, height: dstHeight });
  return steps;
}

/**
 * Applies subtle 3x3 unsharp convolution after resize, clamped cleanly to [0, 255].
 */
export function applySharpen(imageData: ImageData, sharpenAmount: number): void {
  const level = Math.min(100, Math.max(0, sharpenAmount));
  if (level <= 0) {
    return;
  }

  const { width, height, data } = imageData;
  if (width < 3 || height < 3) {
    return;
  }

  const alpha = (level / 100) * 0.65;
  const centerWeight = 1 + 4 * alpha;
  const sideWeight = -alpha;
  const src = new Uint8ClampedArray(data);
  const rowStride = width * 4;

  for (let y = 1; y < height - 1; y += 1) {
    const rowOffset = y * rowStride;
    for (let x = 1; x < width - 1; x += 1) {
      const idx = rowOffset + x * 4;
      const top = idx - rowStride;
      const bottom = idx + rowStride;
      const left = idx - 4;
      const right = idx + 4;

      for (let c = 0; c < 3; c += 1) {
        const value =
          src[idx + c] * centerWeight +
          (src[top + c] + src[bottom + c] + src[left + c] + src[right + c]) * sideWeight;
        data[idx + c] = value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
      }
      data[idx + 3] = src[idx + 3];
    }
  }
}

export function buildExportFileName(
  originalName: string,
  outputFormat: ImageOutputFormat
): string {
  const dotIdx = originalName.lastIndexOf('.');
  const rawBase = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  const cleanBase = rawBase.trim() || 'foto';
  const ext =
    outputFormat === 'image/webp' ? 'webp' : outputFormat === 'image/png' ? 'png' : 'jpg';
  return `${cleanBase}-kompresor.${ext}`;
}

export function computeReductionPct(inputBytes: number, outputBytes: number): number {
  if (inputBytes <= 0) {
    return 0;
  }
  return ((inputBytes - outputBytes) / inputBytes) * 100;
}

export function formatOutputMimeShort(mime: ImageOutputFormat): string {
  if (mime === 'image/webp') return 'WebP';
  if (mime === 'image/png') return 'PNG';
  return 'JPG';
}
