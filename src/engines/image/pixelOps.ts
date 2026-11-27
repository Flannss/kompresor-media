import type {
  ImageColorAdjustments,
  ImageEditState,
  ImageOutputFormat,
  ImageRotation,
  NormalizedCropRect,
  PhotoQualityModel,
  PhotoTargetResolution,
} from '../contracts';
import { applyPhotoFilterToImageData } from '../grading/photoFilters';
import { compute1080pTargetDimensions, hasActiveColorGrade } from '../shared/colorGrades';
import { sanitizeExportBaseName } from '../../shared/utils/sanitizeFileName';
import { PRO_PHOTO_TOOL_LABELS } from './proTools';

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

export interface PhotoCanvasGuardrails {
  maxCanvasPixels?: number;
  allow8K?: boolean;
  isMobileThermalGuard?: boolean;
}

export interface PhotoTargetResolutionResult extends Dimensions {
  clampedByMemoryGuard: boolean;
  appliedTargetResolution: PhotoTargetResolution;
}

export const PHOTO_TARGET_LONG_EDGE: Record<PhotoTargetResolution, number | null> = {
  original: null,
  hd: 1920,
  '2k': 2560,
  '3k': 3072,
  '4k': 3840,
  '8k': 7680,
};

export const PHOTO_QUALITY_MODEL_LABELS: Record<PhotoQualityModel, string> = {
  realphoto: 'RealPhoto',
  'high-quality': 'High Quality',
  'ultra-detail': 'Ultra Detail',
  'studio-portrait': 'Studio Potret',
  'hdr-dynamic': 'HDR Dinamis',
};

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

/**
 * Exact inscribed-rectangle scale factor when straightening by small angles (-15..+15 deg)
 * so rotated frames fill the canvas edge-to-edge with zero black triangles.
 */
export function computeStraightenScale(
  width: number,
  height: number,
  degrees: number
): number {
  const clamped = Math.min(45, Math.max(-45, degrees));
  if (clamped === 0 || width <= 0 || height <= 0) {
    return 1;
  }
  const rad = (Math.abs(clamped) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const aspectMax = Math.max(height / width, width / height);
  return cos + aspectMax * sin;
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
 * Resolves exact export dimensions honoring HD/2K/4K/8K targets and hardware canvas memory caps.
 */
export function computePhotoTargetDimensions(
  srcWidth: number,
  srcHeight: number,
  edit: Pick<ImageEditState, 'maxEdgePx' | 'targetResolution' | 'enhanceSuite'>,
  guard?: PhotoCanvasGuardrails
): PhotoTargetResolutionResult {
  if (srcWidth <= 0 || srcHeight <= 0) {
    throw new Error(`Dimensi foto tidak valid: ${srcWidth}x${srcHeight}`);
  }

  let appliedTargetResolution: PhotoTargetResolution = edit.targetResolution ?? 'original';
  if (appliedTargetResolution === '8k' && guard?.allow8K === false) {
    appliedTargetResolution = '4k';
  }

  let dims: Dimensions;
  const targetEdge = PHOTO_TARGET_LONG_EDGE[appliedTargetResolution];
  if (targetEdge !== null) {
    const scale = targetEdge / Math.max(srcWidth, srcHeight);
    dims = {
      width: Math.max(1, Math.round(srcWidth * scale)),
      height: Math.max(1, Math.round(srcHeight * scale)),
    };
  } else if (edit.enhanceSuite.upscale1080.enabled) {
    dims = compute1080pTargetDimensions(
      srcWidth,
      srcHeight,
      edit.enhanceSuite.upscale1080.keepAspect
    );
  } else {
    dims = computeTargetDimensions(srcWidth, srcHeight, edit.maxEdgePx);
  }

  let clampedByMemoryGuard = false;
  const maxPixels = guard?.maxCanvasPixels;
  if (maxPixels && maxPixels > 0 && dims.width * dims.height > maxPixels) {
    const clampScale = Math.sqrt(maxPixels / (dims.width * dims.height));
    dims = {
      width: Math.max(1, Math.floor(dims.width * clampScale)),
      height: Math.max(1, Math.floor(dims.height * clampScale)),
    };
    clampedByMemoryGuard = true;
  }

  return {
    width: dims.width,
    height: dims.height,
    clampedByMemoryGuard,
    appliedTargetResolution,
  };
}

/**
 * Generates stepped upscaling dimensions (max 1.5x per intermediate step) to preserve
 * edge continuity when rendering HD/2K/4K/8K outputs without single-jump softness.
 */
export function computeProgressiveUpscaleSteps(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): Dimensions[] {
  if (dstWidth <= srcWidth && dstHeight <= srcHeight) {
    return [{ width: dstWidth, height: dstHeight }];
  }

  const steps: Dimensions[] = [];
  let currentW = srcWidth;
  let currentH = srcHeight;

  while (dstWidth / currentW > 1.5 || dstHeight / currentH > 1.5) {
    const nextW = Math.min(dstWidth, Math.max(currentW + 1, Math.round(currentW * 1.5)));
    const nextH = Math.min(dstHeight, Math.max(currentH + 1, Math.round(currentH * 1.5)));
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
 * Generates progressive halving dimensions when downscaling more than 2x,
 * or 1.5x stepped passes when upscaling toward HD/2K/4K/8K.
 */
export function computeProgressiveSteps(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): Dimensions[] {
  if (dstWidth > srcWidth || dstHeight > srcHeight) {
    return computeProgressiveUpscaleSteps(srcWidth, srcHeight, dstWidth, dstHeight);
  }

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
 * Applies exposure/tone/color/vignette adjustments (-100..100, vignette 0..100) in-place.
 */
export function applyColorAdjustments(
  imageData: ImageData,
  adjustments: Partial<ImageColorAdjustments>
): void {
  const brightness = adjustments.brightness ?? 0;
  const contrast = adjustments.contrast ?? 0;
  const highlights = adjustments.highlights ?? 0;
  const shadows = adjustments.shadows ?? 0;
  const vignette = adjustments.vignette ?? 0;
  const saturation = adjustments.saturation ?? 0;
  const vibrance = adjustments.vibrance ?? 0;
  const temperature = adjustments.temperature ?? 0;
  const tint = adjustments.tint ?? 0;

  if (
    brightness === 0 &&
    contrast === 0 &&
    highlights === 0 &&
    shadows === 0 &&
    vignette === 0 &&
    saturation === 0 &&
    vibrance === 0 &&
    temperature === 0 &&
    tint === 0
  ) {
    return;
  }

  const { width, height, data } = imageData;
  const brightShift = (brightness / 100) * 70;
  const cVal = (contrast / 100) * 100;
  const contrastFactor = (259 * (cVal + 255)) / (255 * (259 - cVal));
  const satFactor = 1 + saturation / 100;
  const vibNorm = vibrance / 100;
  const tempShift = temperature * 0.36;
  const tintShift = tint * 0.3;
  const vigStrength = Math.min(100, Math.max(0, vignette)) / 100;
  const halfW = Math.max(1, width / 2);
  const halfH = Math.max(1, height / 2);

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] + brightShift + tempShift + tintShift * 0.45;
    let g = data[i + 1] + brightShift - tintShift * 0.85;
    let b = data[i + 2] + brightShift - tempShift + tintShift * 0.45;

    if (highlights !== 0 || shadows !== 0) {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const norm = Math.min(1, Math.max(0, luma / 255));
      const sw = Math.pow(Math.max(0, 1 - norm * 1.35), 1.4);
      const hw = Math.pow(Math.max(0, (norm - 0.26) / 0.74), 1.4);
      const toneDelta = shadows * 0.55 * sw + highlights * 0.55 * hw;
      r += toneDelta;
      g += toneDelta;
      b += toneDelta;
    }

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

    if (vibrance !== 0) {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const chroma = Math.min(1, Math.max(0, (maxC - minC) / 255));
      // Gently protect skin-like warm orange hues while boosting muted greens/blues
      const isWarmSkin = r > g && g > b && r - b > 20;
      const skinWeight = isWarmSkin ? 0.65 : 1;
      const vibFactor = 1 + vibNorm * (1 - chroma) * skinWeight * 0.95;
      r = luma + (r - luma) * vibFactor;
      g = luma + (g - luma) * vibFactor;
      b = luma + (b - luma) * vibFactor;
    }

    if (vigStrength > 0 && width > 1 && height > 1) {
      const px = i / 4;
      const x = px % width;
      const y = (px - x) / width;
      const nx = (x - halfW) / halfW;
      const ny = (y - halfH) / halfH;
      const distSq = nx * nx + ny * ny;
      const falloff = 1 - vigStrength * 0.52 * Math.min(1.35, distSq);
      r *= falloff;
      g *= falloff;
      b *= falloff;
    }

    data[i] = clampByte(r);
    data[i + 1] = clampByte(g);
    data[i + 2] = clampByte(b);
  }
}

/**
 * Local midtone micro-contrast (Clarity -100..100) using a 3-row rolling luminance buffer.
 */
export function applyClarity(imageData: ImageData, clarity: number): void {
  const clamped = Math.min(100, Math.max(-100, clarity));
  if (clamped === 0) {
    return;
  }

  const { width, height, data } = imageData;
  if (width < 3 || height < 3) {
    return;
  }

  const strength = (clamped / 100) * 0.75;
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
      const lc = col - 4;
      const rc = col + 4;

      const lCenter =
        0.2126 * currRow[col] + 0.7152 * currRow[col + 1] + 0.0722 * currRow[col + 2];

      let avgL = 0;
      const rows = [prevRow, currRow, nextRow];
      for (let rIdx = 0; rIdx < 3; rIdx += 1) {
        const sr = rows[rIdx];
        for (let cOff = lc; cOff <= rc; cOff += 4) {
          avgL += 0.2126 * sr[cOff] + 0.7152 * sr[cOff + 1] + 0.0722 * sr[cOff + 2];
        }
      }
      avgL /= 9;

      // Weight strongest in midtones (bell curve centered around luma = 128)
      const midWeight = 1 - Math.abs(lCenter / 255 - 0.5) * 1.25;
      const delta = (lCenter - avgL) * strength * Math.max(0.25, midWeight);

      data[outIdx] = clampByte(currRow[col] + delta);
      data[outIdx + 1] = clampByte(currRow[col + 1] + delta);
      data[outIdx + 2] = clampByte(currRow[col + 2] + delta);
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

/**
 * Selective skin-tone smoothing + eye/hair anti-halo micro-crispness using 3-row rolling buffers.
 */
function applyStudioPortraitPass(
  imageData: ImageData,
  strength: number,
  resBoost: number
): void {
  const { width, height, data } = imageData;
  if (width < 3 || height < 3 || (strength <= 0 && resBoost <= 0)) {
    return;
  }

  const rowStride = width * 4;
  let prevRow = new Uint8ClampedArray(rowStride);
  let currRow = new Uint8ClampedArray(rowStride);
  let nextRow = new Uint8ClampedArray(rowStride);
  prevRow.set(data.subarray(0, rowStride));
  currRow.set(data.subarray(rowStride, rowStride * 2));
  nextRow.set(data.subarray(rowStride * 2, rowStride * 3));

  const lumaBlend = Math.min(0.45, 0.36 * strength);
  const chromaBlend = Math.min(0.6, 0.52 * strength);
  const crispGain = (((24 + resBoost * 18) * strength) / 100) * 1.35;

  for (let y = 1; y < height - 1; y += 1) {
    const outRow = y * rowStride;
    for (let x = 1; x < width - 1; x += 1) {
      const col = x * 4;
      const outIdx = outRow + col;
      const cr = currRow[col];
      const cg = currRow[col + 1];
      const cb = currRow[col + 2];
      const lCenter = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;

      const leftCol = col - 4;
      const rightCol = col + 4;
      const lNeighbors =
        (0.2126 * (prevRow[col] + nextRow[col] + currRow[leftCol] + currRow[rightCol]) +
          0.7152 *
            (prevRow[col + 1] + nextRow[col + 1] + currRow[leftCol + 1] + currRow[rightCol + 1]) +
          0.0722 *
            (prevRow[col + 2] + nextRow[col + 2] + currRow[leftCol + 2] + currRow[rightCol + 2])) /
        4;
      const edgeDiff = Math.abs(lCenter - lNeighbors);
      const isWarmSkin = cr > cg && cg > cb && cr - cb > 14 && lCenter > 65 && lCenter < 230;

      if (isWarmSkin && edgeDiff <= 14) {
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let count = 0;
        const rows = [prevRow, currRow, nextRow];
        for (let rIdx = 0; rIdx < 3; rIdx += 1) {
          const srcRow = rows[rIdx];
          for (let cOff = leftCol; cOff <= rightCol; cOff += 4) {
            const nr = srcRow[cOff];
            const ng = srcRow[cOff + 1];
            const nb = srcRow[cOff + 2];
            const diff = (Math.abs(nr - cr) + Math.abs(ng - cg) + Math.abs(nb - cb)) / 3;
            if (diff <= 26) {
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
          const avgLuma = 0.2126 * avgR + 0.7152 * avgG + 0.0722 * avgB;
          const outLuma = lCenter + (avgLuma - lCenter) * lumaBlend;
          const dr = (avgR - avgLuma - (cr - lCenter)) * chromaBlend;
          const dg = (avgG - avgLuma - (cg - lCenter)) * chromaBlend;
          const db = (avgB - avgLuma - (cb - lCenter)) * chromaBlend;
          data[outIdx] = clampByte(outLuma + (cr - lCenter) + dr);
          data[outIdx + 1] = clampByte(outLuma + (cg - lCenter) + dg);
          data[outIdx + 2] = clampByte(outLuma + (cb - lCenter) + db);
        }
      } else if (edgeDiff > 10 && crispGain > 0) {
        const delta = (lCenter - lNeighbors) * crispGain;
        data[outIdx] = clampByte(cr + delta);
        data[outIdx + 1] = clampByte(cg + delta);
        data[outIdx + 2] = clampByte(cb + delta);
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

/**
 * 5 distinct, style-preserving Photo Quality Models + resolution-scaled clarity recovery.
 */
export function applyQualityModelPass(
  imageData: ImageData,
  qualityModel: PhotoQualityModel,
  upscaleRatio: number,
  modelStrength = 80,
  targetResolution: PhotoTargetResolution = 'original',
  options?: { skipDenoise?: boolean }
): void {
  const s = Math.min(1, Math.max(0, modelStrength / 100));
  const tierBonus =
    targetResolution === '8k'
      ? 0.72
      : targetResolution === '4k'
        ? 0.56
        : targetResolution === '3k'
          ? 0.42
          : targetResolution === '2k'
            ? 0.28
            : targetResolution === 'hd'
              ? 0.14
              : 0;
  const resBoost = tierBonus + Math.max(0, Math.min(0.6, (upscaleRatio - 1) * 0.35));

  if (s <= 0.001) {
    if (resBoost > 0.01) {
      applySharpen(imageData, Math.round(resBoost * 18), true);
    }
    return;
  }

  switch (qualityModel) {
    case 'high-quality': {
      if (!options?.skipDenoise) {
        applyEdgePreservingDenoiseParams(
          imageData,
          Math.max(1.2, (2.2 + resBoost * 1.4) * s),
          Math.max(2, Math.round(3.5 * s))
        );
      }
      applyColorAdjustments(imageData, {
        contrast: Math.round(6 * s),
        vibrance: Math.round(5 * s),
      });
      applyClarity(imageData, Math.round((22 + resBoost * 12) * s));
      applySharpen(imageData, Math.round((32 + resBoost * 20) * s), true);
      return;
    }
    case 'ultra-detail': {
      if (!options?.skipDenoise) {
        applyEdgePreservingDenoiseParams(
          imageData,
          Math.min(2.4, (1.4 + resBoost) * s),
          2
        );
      }
      applyColorAdjustments(imageData, { contrast: Math.round(9 * s) });
      applyClarity(imageData, Math.round((34 + resBoost * 18) * s));
      applySharpen(imageData, Math.min(100, Math.round((66 + resBoost * 32) * s)), true);
      return;
    }
    case 'studio-portrait': {
      applyStudioPortraitPass(imageData, s, resBoost);
      applyColorAdjustments(imageData, {
        highlights: Math.round(-10 * s),
        shadows: Math.round(10 * s),
        temperature: Math.round(4 * s),
      });
      return;
    }
    case 'hdr-dynamic': {
      applyColorAdjustments(imageData, {
        shadows: Math.round(28 * s),
        highlights: Math.round(-22 * s),
        contrast: Math.round(10 * s),
        vibrance: Math.round(18 * s),
      });
      applyClarity(imageData, Math.round((26 + resBoost * 12) * s));
      applySharpen(imageData, Math.round((20 + resBoost * 16) * s), true);
      return;
    }
    case 'realphoto':
    default: {
      applyColorAdjustments(imageData, {
        shadows: Math.round(6 * s),
        highlights: Math.round(-4 * s),
        contrast: Math.round(3 * s),
      });
      applyClarity(imageData, Math.round((12 + resBoost * 8) * s));
      applySharpen(imageData, Math.round((10 + resBoost * 16) * s), true);
    }
  }
}

export { applyPhotoFilterToImageData };

export function buildExportFileName(
  originalName: string,
  outputFormat: ImageOutputFormat,
  targetResolution?: PhotoTargetResolution
): string {
  const leaf = originalName.split(/[\\/]/).pop() ?? originalName;
  const dotIdx = leaf.lastIndexOf('.');
  const rawBase = dotIdx > 0 ? leaf.slice(0, dotIdx) : leaf;
  const cleanBase = sanitizeExportBaseName(rawBase, 'foto');
  const ext =
    outputFormat === 'image/webp'
      ? 'webp'
      : outputFormat === 'image/png'
        ? 'png'
        : outputFormat === 'image/avif'
          ? 'avif'
          : 'jpg';
  const suffix =
    targetResolution && targetResolution !== 'original' ? targetResolution : 'kompresor';
  return `${cleanBase}-${suffix}.${ext}`;
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
  const labels = ['Kompres', PHOTO_QUALITY_MODEL_LABELS[edit.qualityModel] ?? 'RealPhoto'];
  if (edit.proTools?.length && (edit.proToolStrength ?? 80) > 0) {
    for (const toolId of edit.proTools) {
      labels.push(PRO_PHOTO_TOOL_LABELS[toolId] ?? toolId);
    }
  }
  if (edit.targetResolution !== 'original') {
    labels.push(edit.targetResolution.toUpperCase());
  }
  if (edit.denoiseAmount > 0 || edit.enhanceSuite.noise.enabled) {
    labels.push('Redam Noise');
  }
  if (edit.photoFilterId !== 'original' || hasActiveColorGrade(edit.colorGrade)) {
    labels.push('Filter');
  }
  if (edit.straightenDeg !== 0 || edit.crop !== null || edit.rotationDeg !== 0) {
    labels.push('Bingkai');
  }
  return labels;
}
