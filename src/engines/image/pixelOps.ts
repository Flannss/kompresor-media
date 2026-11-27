import type {
  ImageColorAdjustments,
  ImageEditState,
  ImageOutputFormat,
  ImageRotation,
  NormalizedCropRect,
} from '../contracts';
import { hasActiveColorGrade } from '../shared/colorGrades';

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
 * Fast 3x3 edge-preserving denoise smoothing noise while protecting strong edges.
 * Uses a 3-row rolling buffer (3 * width * 4 bytes) instead of duplicating the full ImageData.
 */
export function applyEdgePreservingDenoiseParams(
  imageData: ImageData,
  grainStrength: number,
  colorSmooth: number
): void {
  const { width, height, data } = imageData;
  if (width < 3 || height < 3 || grainStrength <= 0) {
    return;
  }

  const threshold = Math.min(48, 8 + grainStrength * 3.5);
  const lumaBlend = Math.min(0.75, 0.14 + (grainStrength / 10) * 0.56);
  const chromaBlend = Math.min(0.85, 0.18 + (colorSmooth / 8) * 0.62);
  const stride = width * 4;

  let prevRow = new Uint8ClampedArray(stride);
  let currRow = new Uint8ClampedArray(stride);
  let nextRow = new Uint8ClampedArray(stride);
  prevRow.set(data.subarray(0, stride));
  currRow.set(data.subarray(stride, stride * 2));
  nextRow.set(data.subarray(stride * 2, stride * 3));

  for (let y = 1; y < height - 1; y += 1) {
    const outRow = y * stride;
    for (let x = 1; x < width - 1; x += 1) {
      const col = x * 4;
      const outIdx = outRow + col;
      const cr = currRow[col];
      const cg = currRow[col + 1];
      const cb = currRow[col + 2];

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;

      const leftCol = col - 4;
      const rightCol = col + 4;
      const rows = [prevRow, currRow, nextRow];
      for (let rIdx = 0; rIdx < 3; rIdx += 1) {
        const srcRow = rows[rIdx];
        for (let cOff = leftCol; cOff <= rightCol; cOff += 4) {
          const nr = srcRow[cOff];
          const ng = srcRow[cOff + 1];
          const nb = srcRow[cOff + 2];
          const diff = (Math.abs(nr - cr) + Math.abs(ng - cg) + Math.abs(nb - cb)) / 3;
          if (diff <= threshold) {
            sumR += nr;
            sumG += ng;
            sumB += nb;
            count += 1;
          }
        }
      }

      if (count > 1) {
        const avgR = sumR / count;
        const avgG = sumG / count;
        const avgB = sumB / count;
        const origLuma = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
        const avgLuma = 0.2126 * avgR + 0.7152 * avgG + 0.0722 * avgB;

        const outLuma = origLuma + (avgLuma - origLuma) * lumaBlend;
        const dr = (avgR - avgLuma - (cr - origLuma)) * chromaBlend;
        const dg = (avgG - avgLuma - (cg - origLuma)) * chromaBlend;
        const db = (avgB - avgLuma - (cb - origLuma)) * chromaBlend;

        data[outIdx] = clampByte(outLuma + (cr - origLuma) + dr);
        data[outIdx + 1] = clampByte(outLuma + (cg - origLuma) + dg);
        data[outIdx + 2] = clampByte(outLuma + (cb - origLuma) + db);
      }
      data[outIdx + 3] = currRow[col + 3];
    }

    if (y + 1 < height - 1) {
      const recycled = prevRow;
      prevRow = currRow;
      currRow = nextRow;
      nextRow = recycled;
      const aheadOffset = (y + 2) * stride;
      nextRow.set(data.subarray(aheadOffset, aheadOffset + stride));
    }
  }
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
 * Applies 3x3 unsharp luminance convolution after resize, clamped cleanly to [0, 255].
 * Uses a 3-row rolling buffer (3 * width * 4 bytes) to protect low-RAM iOS devices.
 */
export function applySharpen(
  imageData: ImageData,
  sharpenAmount: number,
  antiArtifact = true
): void {
  const level = Math.min(100, Math.max(0, sharpenAmount));
  if (level <= 0) {
    return;
  }

  const { width, height, data } = imageData;
  if (width < 3 || height < 3) {
    return;
  }

  const alpha = (level / 100) * 0.65;
  const rowStride = width * 4;

  let prevRow = new Uint8ClampedArray(rowStride);
  let currRow = new Uint8ClampedArray(rowStride);
  let nextRow = new Uint8ClampedArray(rowStride);
  prevRow.set(data.subarray(0, rowStride));
  currRow.set(data.subarray(rowStride, rowStride * 2));
  nextRow.set(data.subarray(rowStride * 2, rowStride * 3));

  for (let y = 1; y < height - 1; y += 1) {
    const outRow = y * rowStride;
    for (let x = 1; x < width - 1; x += 1) {
      const col = x * 4;
      const outIdx = outRow + col;
      const leftCol = col - 4;
      const rightCol = col + 4;

      if (antiArtifact) {
        const lCenter =
          0.2126 * currRow[col] + 0.7152 * currRow[col + 1] + 0.0722 * currRow[col + 2];
        const lNeighbors =
          (0.2126 * (prevRow[col] + nextRow[col] + currRow[leftCol] + currRow[rightCol]) +
            0.7152 *
              (prevRow[col + 1] + nextRow[col + 1] + currRow[leftCol + 1] + currRow[rightCol + 1]) +
            0.0722 *
              (prevRow[col + 2] + nextRow[col + 2] + currRow[leftCol + 2] + currRow[rightCol + 2])) /
          4;
        const delta = (lCenter - lNeighbors) * (alpha * 2.2);
        data[outIdx] = clampByte(currRow[col] + delta);
        data[outIdx + 1] = clampByte(currRow[col + 1] + delta);
        data[outIdx + 2] = clampByte(currRow[col + 2] + delta);
      } else {
        const centerWeight = 1 + 4 * alpha;
        const sideWeight = -alpha;
        for (let c = 0; c < 3; c += 1) {
          const value =
            currRow[col + c] * centerWeight +
            (prevRow[col + c] +
              nextRow[col + c] +
              currRow[leftCol + c] +
              currRow[rightCol + c]) *
              sideWeight;
          data[outIdx + c] = clampByte(value);
        }
      }
      data[outIdx + 3] = currRow[col + 3];
    }

    if (y + 1 < height - 1) {
      const recycled = prevRow;
      prevRow = currRow;
      currRow = nextRow;
      nextRow = recycled;
      const aheadOffset = (y + 2) * rowStride;
      nextRow.set(data.subarray(aheadOffset, aheadOffset + rowStride));
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
    outputFormat === 'image/webp'
      ? 'webp'
      : outputFormat === 'image/png'
        ? 'png'
        : outputFormat === 'image/avif'
          ? 'avif'
          : 'jpg';
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
  if (mime === 'image/avif') return 'AVIF';
  return 'JPG';
}

export function getActiveImageModuleLabels(edit: ImageEditState): string[] {
  const labels = ['Kompres'];
  if (edit.enhanceSuite.noise.enabled) labels.push('Noise');
  if (edit.enhanceSuite.sharpen.enabled) labels.push('Tajam');
  if (edit.enhanceSuite.colorContrast.enabled) labels.push('Warna');
  if (edit.enhanceSuite.upscale1080.enabled) labels.push('1080p');
  if (hasActiveColorGrade(edit.colorGrade)) labels.push('Filter');
  return labels;
}
