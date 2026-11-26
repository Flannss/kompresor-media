import type {
  ImageColorAdjustments,
  ImageFilterId,
  ImageOutputFormat,
  ImageRotation,
  NormalizedCropRect,
} from '../contracts';

export interface Dimensions {
  width: number;
  height: number;
}

export interface PixelCropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface FilterPresetMeta {
  id: ImageFilterId;
  label: string;
}

export const FILTER_PRESETS: readonly FilterPresetMeta[] = [
  { id: 'original', label: 'Asli' },
  { id: 'crisp', label: 'Jernih' },
  { id: 'warm', label: 'Hangat' },
  { id: 'cool', label: 'Sejuk' },
  { id: 'film', label: 'Film' },
  { id: 'cinema', label: 'Sinema' },
  { id: 'mono', label: 'Monokrom' },
] as const;

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

export function computeCropPixels(
  srcWidth: number,
  srcHeight: number,
  crop: NormalizedCropRect | null
): PixelCropRect {
  if (!crop) {
    return { sx: 0, sy: 0, sw: srcWidth, sh: srcHeight };
  }
  const x0 = Math.min(1, Math.max(0, crop.x));
  const y0 = Math.min(1, Math.max(0, crop.y));
  const w0 = Math.min(1 - x0, Math.max(0.01, crop.width));
  const h0 = Math.min(1 - y0, Math.max(0.01, crop.height));

  const sx = Math.min(srcWidth - 1, Math.max(0, Math.round(x0 * srcWidth)));
  const sy = Math.min(srcHeight - 1, Math.max(0, Math.round(y0 * srcHeight)));
  const sw = Math.min(srcWidth - sx, Math.max(1, Math.round(w0 * srcWidth)));
  const sh = Math.min(srcHeight - sy, Math.max(1, Math.round(h0 * srcHeight)));
  return { sx, sy, sw, sh };
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

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Applies brightness, contrast, saturation, and color temperature (-100..100 each) in-place.
 */
export function applyColorAdjustments(
  imageData: ImageData,
  adjustments: ImageColorAdjustments
): void {
  const { brightness, contrast, saturation, temperature } = adjustments;
  if (brightness === 0 && contrast === 0 && saturation === 0 && temperature === 0) {
    return;
  }

  const data = imageData.data;
  const brightShift = (brightness / 100) * 70;
  const cVal = (contrast / 100) * 100;
  const contrastFactor = (259 * (cVal + 255)) / (255 * (259 - cVal));
  const satFactor = 1 + saturation / 100;
  const tempShift = temperature * 0.36;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] + brightShift + tempShift;
    let g = data[i + 1] + brightShift;
    let b = data[i + 2] + brightShift - tempShift;

    if (contrast !== 0) {
      r = (r - 128) * contrastFactor + 128;
      g = (g - 128) * contrastFactor + 128;
      b = (b - 128) * contrastFactor + 128;
    }

    if (saturation !== 0) {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = luma + (r - luma) * satFactor;
      g = luma + (g - luma) * satFactor;
      b = luma + (b - luma) * satFactor;
    }

    data[i] = clampByte(r);
    data[i + 1] = clampByte(g);
    data[i + 2] = clampByte(b);
  }
}

/**
 * Applies one of the 7 built-in studio color filters in-place.
 */
export function applyFilterPreset(imageData: ImageData, filterId: ImageFilterId): void {
  if (filterId === 'original') {
    return;
  }

  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    switch (filterId) {
      case 'crisp': {
        r = (r - 128) * 1.12 + 130;
        g = (g - 128) * 1.12 + 130;
        b = (b - 128) * 1.12 + 130;
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = luma + (r - luma) * 1.07;
        g = luma + (g - luma) * 1.07;
        b = luma + (b - luma) * 1.07;
        break;
      }
      case 'warm': {
        r = r * 1.07 + 7;
        g = g * 1.02 + 3;
        b = b * 0.91 - 4;
        break;
      }
      case 'cool': {
        r = r * 0.91 - 3;
        g = g * 1.01 + 2;
        b = b * 1.08 + 7;
        break;
      }
      case 'film': {
        // Lifted shadows with soft desaturated highlights
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = luma + (r - luma) * 0.86;
        g = luma + (g - luma) * 0.86;
        b = luma + (b - luma) * 0.86;
        r = r * 0.92 + 16;
        g = g * 0.9 + 14;
        b = b * 0.88 + 12;
        break;
      }
      case 'cinema': {
        // Cool teal shadow push with warmer highlights & higher contrast
        const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        r = (r - 128) * 1.15 + 128 + (luma > 0.5 ? 10 : -8);
        g = (g - 128) * 1.12 + 128 + (luma <= 0.5 ? 4 : 0);
        b = (b - 128) * 1.12 + 128 + (luma <= 0.5 ? 11 : -8);
        break;
      }
      case 'mono': {
        const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const contrasted = (gray - 128) * 1.14 + 128;
        r = contrasted;
        g = contrasted;
        b = contrasted;
        break;
      }
    }

    data[i] = clampByte(r);
    data[i + 1] = clampByte(g);
    data[i + 2] = clampByte(b);
  }
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
        data[idx + c] = clampByte(value);
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
