import type { ColouriseToneProfile, ProPhotoToolId } from '../contracts';

export const PRO_PHOTO_TOOL_IDS: readonly ProPhotoToolId[] = [
  'sharpen',
  'retouch',
  'enhance-face',
  'deblur',
  'dehaze',
  'remove-motion-blur',
  'restore',
  'colourise',
  'face-restoration',
] as const;

export const PRO_PHOTO_TOOL_META: ReadonlyArray<{
  id: ProPhotoToolId;
  title: string;
  desc: string;
}> = [
  {
    id: 'sharpen',
    title: 'Pertajam Foto',
    desc: 'Perjelas tepian & detail mikro tanpa halo',
  },
  {
    id: 'retouch',
    title: 'Poles & Haluskan',
    desc: 'Haluskan tekstur kulit & noise rata tanpa memburamkan garis',
  },
  {
    id: 'enhance-face',
    title: 'Perjelas Wajah',
    desc: 'Haluskan kulit wajah sambil angkat detail mata & alis',
  },
  {
    id: 'deblur',
    title: 'Hilangkan Blur',
    desc: 'Rekonstruksi fokus iteratif untuk foto agak buram',
  },
  {
    id: 'dehaze',
    title: 'Hilangkan Kabut',
    desc: 'Potong kabut & silau pudar, pulihkan kedalaman kontras',
  },
  {
    id: 'remove-motion-blur',
    title: 'Kurangi Blur Gerak',
    desc: 'Koreksi blur arah getaran tangan saat memotret',
  },
  {
    id: 'restore',
    title: 'Pulihkan Foto Lama',
    desc: 'Bersihkan bintik debu, netralkan pudar & pulihkan rentang kontras',
  },
  {
    id: 'colourise',
    title: 'Warnai Foto',
    desc: 'Beri warna alami pada foto hitam-putih atau foto usang',
  },
  {
    id: 'face-restoration',
    title: 'Restorasi Wajah',
    desc: 'Pulihkan kejernihan fitur wajah, cahaya mata & rambut',
  },
] as const;

export const PRO_PHOTO_TOOL_LABELS: Record<ProPhotoToolId, string> = {
  sharpen: 'Pertajam Foto',
  retouch: 'Poles & Haluskan',
  'enhance-face': 'Perjelas Wajah',
  deblur: 'Hilangkan Blur',
  dehaze: 'Hilangkan Kabut',
  'remove-motion-blur': 'Blur Gerak',
  restore: 'Pulihkan Foto Lama',
  colourise: 'Warnai Foto',
  'face-restoration': 'Restorasi Wajah',
};

export const COLOURISE_PROFILE_OPTIONS: ReadonlyArray<{
  id: ColouriseToneProfile;
  label: string;
}> = [
  { id: 'warm-portrait', label: 'Potret Hangat' },
  { id: 'nature-sky', label: 'Alam & Langit' },
  { id: 'classic-natural', label: 'Klasik Natural' },
] as const;

const OPTICAL_EXECUTION_ORDER: readonly ProPhotoToolId[] = [
  'restore',
  'dehaze',
  'remove-motion-blur',
  'deblur',
  'retouch',
  'colourise',
  'enhance-face',
  'face-restoration',
  'sharpen',
];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function normalizeStrength(strength: number): number {
  if (!Number.isFinite(strength)) return 0;
  return Math.min(1, Math.max(0, strength / 100));
}

function extractLuma(data: Uint8ClampedArray, count: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const p = i * 4;
    out[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  }
  return out;
}

function applyLumaDeltaPreserveChroma(
  data: Uint8ClampedArray,
  srcLuma: Float32Array,
  targetLuma: Float32Array,
  blend: number
): void {
  const count = srcLuma.length;
  for (let i = 0; i < count; i += 1) {
    const delta = (targetLuma[i] - srcLuma[i]) * blend;
    if (delta === 0) continue;
    const p = i * 4;
    data[p] = clampByte(data[p] + delta);
    data[p + 1] = clampByte(data[p + 1] + delta);
    data[p + 2] = clampByte(data[p + 2] + delta);
  }
}

/** O(W*H) separable box blur on Float32Array. */
function separableBoxBlurFloat(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  passes = 1
): Float32Array {
  const n = width * height;
  if (radius <= 0 || width < 2 || height < 2) {
    return new Float32Array(src);
  }
  let curr = new Float32Array(src);
  let temp = new Float32Array(n);
  let next = new Float32Array(n);

  for (let pass = 0; pass < passes; pass += 1) {
    // Horizontal pass with clamped sliding window
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = curr[row] * (radius + 1);
      for (let k = 1; k <= radius; k += 1) {
        sum += curr[row + Math.min(width - 1, k)];
      }
      const win = radius * 2 + 1;
      for (let x = 0; x < width; x += 1) {
        temp[row + x] = sum / win;
        const removeX = Math.max(0, x - radius);
        const addX = Math.min(width - 1, x + radius + 1);
        sum += curr[row + addX] - curr[row + removeX];
      }
    }

    // Vertical pass
    const win = radius * 2 + 1;
    for (let x = 0; x < width; x += 1) {
      let sum = temp[x] * (radius + 1);
      for (let k = 1; k <= radius; k += 1) {
        sum += temp[Math.min(height - 1, k) * width + x];
      }
      for (let y = 0; y < height; y += 1) {
        next[y * width + x] = sum / win;
        const removeY = Math.max(0, y - radius);
        const addY = Math.min(height - 1, y + radius + 1);
        sum += temp[addY * width + x] - temp[removeY * width + x];
      }
    }

    const swap = curr;
    curr = next;
    next = swap;
  }

  return curr;
}

/** O(W*H*r) separable 1D horizontal + vertical min-filter for Dark Channel Prior. */
function separableMinFilterFloat(
  src: Float32Array,
  width: number,
  height: number,
  radius: number
): Float32Array {
  const n = width * height;
  if (radius <= 0) return new Float32Array(src);
  const temp = new Float32Array(n);
  const out = new Float32Array(n);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      let m = 1e9;
      for (let k = x0; k <= x1; k += 1) {
        const v = src[row + k];
        if (v < m) m = v;
      }
      temp[row + x] = m;
    }
  }

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      let m = 1e9;
      for (let k = y0; k <= y1; k += 1) {
        const v = temp[k * width + x];
        if (v < m) m = v;
      }
      out[y * width + x] = m;
    }
  }

  return out;
}

/** 5x5 separable Gaussian PSF for realistic defocus deconvolution. */
function convolvePsf5x5(src: Float32Array, width: number, height: number): Float32Array {
  const n = width * height;
  const temp = new Float32Array(n);
  const out = new Float32Array(n);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const xm2 = x > 1 ? x - 2 : 0;
      const xm1 = x > 0 ? x - 1 : 0;
      const xp1 = x + 1 < width ? x + 1 : width - 1;
      const xp2 = x + 2 < width ? x + 2 : width - 1;
      temp[row + x] =
        0.12 * src[row + xm2] +
        0.22 * src[row + xm1] +
        0.32 * src[row + x] +
        0.22 * src[row + xp1] +
        0.12 * src[row + xp2];
    }
  }

  for (let y = 0; y < height; y += 1) {
    const ym2 = (y > 1 ? y - 2 : 0) * width;
    const ym1 = (y > 0 ? y - 1 : 0) * width;
    const yc = y * width;
    const yp1 = (y + 1 < height ? y + 1 : height - 1) * width;
    const yp2 = (y + 2 < height ? y + 2 : height - 1) * width;
    for (let x = 0; x < width; x += 1) {
      out[yc + x] =
        0.12 * temp[ym2 + x] +
        0.22 * temp[ym1 + x] +
        0.32 * temp[yc + x] +
        0.22 * temp[yp1 + x] +
        0.12 * temp[yp2 + x];
    }
  }

  return out;
}

/** Bilinear float sampler clamped to image borders. */
function sampleBilinearFloat(
  src: Float32Array,
  width: number,
  height: number,
  fx: number,
  fy: number
): number {
  const x = Math.min(width - 1, Math.max(0, fx));
  const y = Math.min(height - 1, Math.max(0, fy));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const i00 = src[y0 * width + x0];
  const i10 = src[y0 * width + x1];
  const i01 = src[y1 * width + x0];
  const i11 = src[y1 * width + x1];
  const top = i00 + (i10 - i00) * tx;
  const bot = i01 + (i11 - i01) * tx;
  return top + (bot - top) * ty;
}

/** Directional 1D PSF convolution [0.23, 0.54, 0.23] along unit blur vector (ux, uy). */
function convolveDirectionalPsf(
  src: Float32Array,
  width: number,
  height: number,
  ux: number,
  uy: number,
  stepPx = 1.25
): Float32Array {
  const out = new Float32Array(width * height);
  const dx = ux * stepPx;
  const dy = uy * stepPx;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const c = src[row + x];
      const neg = sampleBilinearFloat(src, width, height, x - dx, y - dy);
      const pos = sampleBilinearFloat(src, width, height, x + dx, y + dy);
      out[row + x] = 0.23 * neg + 0.54 * c + 0.23 * pos;
    }
  }
  return out;
}

/** Smooth YCbCr skin-tone probability in [0, 1]. */
export function computeSkinProbability(r: number, g: number, b: number): number {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (y < 32 || y > 246) return 0;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

  // Smooth trapezoidal bounds around typical skin Cr/Cb cluster
  const cbScore =
    cb < 72 || cb > 134
      ? 0
      : cb < 84
        ? (cb - 72) / 12
        : cb > 122
          ? (134 - cb) / 12
          : 1;
  const crScore =
    cr < 129 || cr > 180
      ? 0
      : cr < 138
        ? (cr - 129) / 9
        : cr > 170
          ? (180 - cr) / 10
          : 1;

  // Favor natural warm dominance R > B slightly to avoid amber wood false-positive outliers when very saturated
  const warmthGuard = r > b + 6 ? 1 : r >= b ? 0.5 : 0;
  return cbScore * crScore * warmthGuard;
}

function buildRangeWeightLut(sigmaR: number): Float32Array {
  const lut = new Float32Array(256);
  const denom = 2 * Math.max(1, sigmaR) * Math.max(1, sigmaR);
  for (let d = 0; d < 256; d += 1) {
    lut[d] = Math.exp(-(d * d) / denom);
  }
  return lut;
}

/** Edge-preserving bilateral filter on RGBA imageData (adaptive radius above 4.5 MP). */
function applyBilateralRgbFilter(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sigmaRange: number,
  blendStrength: number,
  perPixelWeight?: Float32Array
): Uint8ClampedArray {
  const n = width * height;
  const out = new Uint8ClampedArray(data);
  if (width < 3 || height < 3 || blendStrength <= 0) return out;

  const radius = n > 4_500_000 ? 1 : 2;
  const rangeLut = buildRangeWeightLut(sigmaRange);
  const sigmaSpatial = radius === 2 ? 1.8 : 1.1;
  const spatialDim = radius * 2 + 1;
  const spatialKernel = new Float32Array(spatialDim * spatialDim);
  let sk = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      spatialKernel[sk++] = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaSpatial * sigmaSpatial));
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const localMask = perPixelWeight ? perPixelWeight[idx] : 1;
      const wMix = clamp01(blendStrength * localMask);
      if (wMix <= 0.005) continue;

      const p = idx * 4;
      const cr = data[p];
      const cg = data[p + 1];
      const cb = data[p + 2];

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let wSum = 0;

      let k = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = Math.min(height - 1, Math.max(0, y + dy));
        const rowOff = ny * width;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sw = spatialKernel[k++];
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const np = (rowOff + nx) * 4;
          const nr = data[np];
          const ng = data[np + 1];
          const nb = data[np + 2];
          const diff = Math.min(
            255,
            Math.round((Math.abs(nr - cr) + Math.abs(ng - cg) + Math.abs(nb - cb)) / 3)
          );
          const weight = sw * rangeLut[diff];
          sumR += nr * weight;
          sumG += ng * weight;
          sumB += nb * weight;
          wSum += weight;
        }
      }

      if (wSum > 0) {
        const fr = sumR / wSum;
        const fg = sumG / wSum;
        const fb = sumB / wSum;
        out[p] = clampByte(cr + (fr - cr) * wMix);
        out[p + 1] = clampByte(cg + (fg - cg) * wMix);
        out[p + 2] = clampByte(cb + (fb - cb) * wMix);
      }
    }
  }

  return out;
}

/** Tool 1: Multi-scale anti-halo luminance sharpening (Pertajam Foto). */
function runProSharpen(imageData: ImageData, s: number): void {
  const { width, height, data } = imageData;
  const n = width * height;
  if (width < 3 || height < 3) return;

  const luma = extractLuma(data, n);
  const blurFine = separableBoxBlurFloat(luma, width, height, 1, 2);
  const blurMed = separableBoxBlurFloat(luma, width, height, 3, 1);
  const blurWide = separableBoxBlurFloat(luma, width, height, 6, 1);

  const gain = 2.45 * s;
  const targetLuma = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const fineDetail = luma[i] - blurFine[i];
    const medDetail = blurFine[i] - blurMed[i];
    const localPop = blurMed[i] - blurWide[i];
    const combined = (fineDetail * 1.85 + medDetail * 1.35 + localPop * 0.72) * gain;
    // Soft anti-halo compression prevents white/black edge overshoot
    const antiHalo = combined / (1 + Math.abs(combined) / 76);
    targetLuma[i] = Math.min(255, Math.max(0, luma[i] + antiHalo));
  }
  applyLumaDeltaPreserveChroma(data, luma, targetLuma, 1);
}

/** Tool 2: Edge-preserving bilateral skin/surface polish (Poles & Haluskan). */
function runProRetouch(imageData: ImageData, s: number): void {
  const { width, height, data } = imageData;
  if (width < 3 || height < 3) return;

  const sigmaRange = 14 + 14 * s;
  const smoothed = applyBilateralRgbFilter(data, width, height, sigmaRange, 0.88 * s);
  for (let i = 0; i < data.length; i += 4) {
    // Subtle velvet midtone & micro-warmth polish alongside bilateral smoothing
    const r = smoothed[i];
    const g = smoothed[i + 1];
    const b = smoothed[i + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const midLift = luma > 40 && luma < 220 ? 3.2 * s : 0;
    data[i] = clampByte(r + midLift + 1.5 * s);
    data[i + 1] = clampByte(g + midLift);
    data[i + 2] = clampByte(b + midLift - 1.5 * s);
  }
}

/** Tool 3: YCbCr skin-masked brightening & smoothness + local eye/brow detail lift (Perjelas Wajah). */
function runProEnhanceFace(imageData: ImageData, s: number): void {
  const { width, height, data } = imageData;
  const n = width * height;
  if (width < 3 || height < 3) return;

  const skinProb = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const p = i * 4;
    skinProb[i] = computeSkinProbability(data[p], data[p + 1], data[p + 2]);
  }

  const dilatedRadius = Math.max(3, Math.min(10, Math.round(Math.min(width, height) * 0.03)));
  const faceNeighborhood = separableBoxBlurFloat(skinProb, width, height, dilatedRadius, 1);

  const smoothWeights = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    smoothWeights[i] = skinProb[i];
  }
  const skinSmoothed = applyBilateralRgbFilter(
    data,
    width,
    height,
    18 + 12 * s,
    0.78 * s,
    smoothWeights
  );

  const luma = extractLuma(skinSmoothed, n);
  const blur1 = separableBoxBlurFloat(luma, width, height, 1, 2);

  for (let i = 0; i < n; i += 1) {
    const p = i * 4;
    const sp = skinProb[i];
    const faceMask = clamp01(faceNeighborhood[i] * 2.2);
    const featureWeight = faceMask * (1 - sp * 0.72);
    const detail = luma[i] - blur1[i];
    const featureBoost = detail * 2.1 * s * featureWeight;
    const skinBright = sp * 11 * s;
    const warmR = sp * 4 * s;
    const warmG = sp * 1.4 * s;
    const warmB = -sp * 2.6 * s;

    data[p] = clampByte(skinSmoothed[p] + featureBoost + skinBright + warmR);
    data[p + 1] = clampByte(skinSmoothed[p + 1] + featureBoost + skinBright + warmG);
    data[p + 2] = clampByte(skinSmoothed[p + 2] + featureBoost + skinBright + warmB);
  }
}

/** Tool 4: Iterative Richardson-Lucy luminance deconvolution with ringing envelope (Hilangkan Blur). */
function runProDeblur(imageData: ImageData, s: number): void {
  const { width, height, data } = imageData;
  const n = width * height;
  if (width < 3 || height < 3) return;

  const srcLuma = extractLuma(data, n);
  const observed = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    observed[i] = Math.max(0.008, srcLuma[i] / 255);
  }

  let estimate = new Float32Array(observed);
  const iterations = n > 2_500_000 ? 3 : 4;
  for (let iter = 0; iter < iterations; iter += 1) {
    const conv = convolvePsf5x5(estimate, width, height);
    const ratio = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      ratio[i] = observed[i] / Math.max(0.008, conv[i]);
    }
    const corr = convolvePsf5x5(ratio, width, height);
    for (let i = 0; i < n; i += 1) {
      estimate[i] = Math.min(1, Math.max(0.004, estimate[i] * corr[i]));
    }
  }

  // Ringing envelope guard against 3x3 neighborhood min/max
  const eps = 38 * s;
  const targetLuma = new Float32Array(n);
  const blend = Math.min(1, s * 1.15);
  for (let y = 0; y < height; y += 1) {
    const ym = Math.max(0, y - 1) * width;
    const yc = y * width;
    const yp = Math.min(height - 1, y + 1) * width;
    for (let x = 0; x < width; x += 1) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(width - 1, x + 1);
      const idx = yc + x;

      let localMin = 255;
      let localMax = 0;
      const rows = [ym, yc, yp];
      for (let r = 0; r < 3; r += 1) {
        const ro = rows[r];
        for (const cx of [xm, x, xp]) {
          const lv = srcLuma[ro + cx];
          if (lv < localMin) localMin = lv;
          if (lv > localMax) localMax = lv;
        }
      }

      const rawDeblurred = estimate[idx] * 255;
      const guarded = Math.min(localMax + eps, Math.max(localMin - eps, rawDeblurred));
      const residual = guarded - srcLuma[idx];
      targetLuma[idx] = Math.min(255, Math.max(0, srcLuma[idx] + residual * (1.25 + 0.65 * s)));
    }
  }

  applyLumaDeltaPreserveChroma(data, srcLuma, targetLuma, blend);
}

/** Tool 5: Real Dark Channel Prior (DCP) atmospheric-light & transmission restoration (Hilangkan Kabut). */
function runProDehaze(imageData: ImageData, s: number): void {
  const { width, height, data } = imageData;
  const n = width * height;
  if (width < 3 || height < 3) return;

  const darkRaw = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const p = i * 4;
    darkRaw[i] = Math.min(data[p], data[p + 1], data[p + 2]) / 255;
  }

  const patchRadius = Math.max(1, Math.min(6, Math.round(Math.min(width, height) * 0.015)));
  const darkPatch = separableMinFilterFloat(darkRaw, width, height, patchRadius);

  // Estimate atmospheric light A from top 0.5% brightest pixels in darkPatch
  const step = Math.max(1, Math.floor(n / 8000));
  const samples: Array<{ d: number; idx: number }> = [];
  for (let i = 0; i < n; i += step) {
    samples.push({ d: darkPatch[i], idx: i });
  }
  samples.sort((a, b) => b.d - a.d);
  const topCount = Math.max(1, Math.floor(samples.length * 0.005));

  let bestR = 0;
  let bestG = 0;
  let bestB = 0;
  let maxIntensity = -1;
  for (let k = 0; k < topCount; k += 1) {
    const p = samples[k].idx * 4;
    const inten = (data[p] + data[p + 1] + data[p + 2]) / (3 * 255);
    if (inten > maxIntensity) {
      maxIntensity = inten;
      bestR = data[p] / 255;
      bestG = data[p + 1] / 255;
      bestB = data[p + 2] / 255;
    }
  }

  const ar = Math.min(0.98, Math.max(0.75, bestR));
  const ag = Math.min(0.98, Math.max(0.75, bestG));
  const ab = Math.min(0.98, Math.max(0.75, bestB));

  const normRatio = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const p = i * 4;
    normRatio[i] = Math.min(data[p] / 255 / ar, data[p + 1] / 255 / ag, data[p + 2] / 255 / ab);
  }
  const minNormDark = separableMinFilterFloat(normRatio, width, height, patchRadius);

  const omega = 0.88 * s;
  const tMin = 0.25;
  const transRaw = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    transRaw[i] = Math.max(tMin, 1 - omega * minNormDark[i]);
  }
  const transSmooth = separableBoxBlurFloat(transRaw, width, height, 2, 1);

  const satLift = 1 + 0.16 * s;
  for (let i = 0; i < n; i += 1) {
    const p = i * 4;
    const t = Math.max(tMin, transSmooth[i]);
    const jr = ((data[p] / 255 - ar) / t + ar) * 255;
    const jg = ((data[p + 1] / 255 - ag) / t + ag) * 255;
    const jb = ((data[p + 2] / 255 - ab) / t + ab) * 255;

    // Gentle saturation revival paired with transmission recovery
    const jl = 0.2126 * jr + 0.7152 * jg + 0.0722 * jb;
    const sr = jl + (jr - jl) * satLift;
    const sg = jl + (jg - jl) * satLift;
    const sb = jl + (jb - jl) * satLift;

    data[p] = clampByte(data[p] + (sr - data[p]) * s);
    data[p + 1] = clampByte(data[p + 1] + (sg - data[p + 1]) * s);
    data[p + 2] = clampByte(data[p + 2] + (sb - data[p + 2]) * s);
  }
}

/** Tool 6: Structure-tensor motion axis detection + directional deconvolution (Kurangi Blur Gerak). */
function runProRemoveMotionBlur(imageData: ImageData, s: number): void {
  const { width, height, data } = imageData;
  const n = width * height;
  if (width < 4 || height < 4) return;

  const srcLuma = extractLuma(data, n);
  let jxx = 0;
  let jyy = 0;
  let jxy = 0;
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const idx = row + x;
      const gx = (srcLuma[idx + 1] - srcLuma[idx - 1]) * 0.5;
      const gy = (srcLuma[idx + width] - srcLuma[idx - width]) * 0.5;
      jxx += gx * gx;
      jyy += gy * gy;
      jxy += gx * gy;
    }
  }

  // Blur orientation is perpendicular to dominant gradient axis (minor eigenvector of tensor),
  // unless image energy exists exclusively along one axis (e.g. 1D vertical bars), in which case
  // deconvolving perpendicular to that axis would operate on constant pixels and produce zero change.
  const majorAngle = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
  const majUx = Math.cos(majorAngle);
  const majUy = Math.sin(majorAngle);
  const minUx = -majUy;
  const minUy = majUx;

  let energyMaj = 0;
  let energyMin = 0;
  const strideStep = Math.max(1, Math.floor(Math.min(width, height) / 24));
  for (let y = 2; y < height - 2; y += strideStep) {
    for (let x = 2; x < width - 2; x += strideStep) {
      const a = sampleBilinearFloat(srcLuma, width, height, x + majUx, y + majUy);
      const b = sampleBilinearFloat(srcLuma, width, height, x - majUx, y - majUy);
      const c = sampleBilinearFloat(srcLuma, width, height, x + minUx, y + minUy);
      const d = sampleBilinearFloat(srcLuma, width, height, x - minUx, y - minUy);
      energyMaj += Math.abs(a - b);
      energyMin += Math.abs(c - d);
    }
  }

  const useMajorAxis = energyMin < energyMaj * 0.25;
  const ux = useMajorAxis ? majUx : minUx;
  const uy = useMajorAxis ? majUy : minUy;

  const observed = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    observed[i] = Math.max(0.008, srcLuma[i] / 255);
  }

  let estimate = new Float32Array(observed);
  const iterations = n > 2_500_000 ? 3 : 5;
  for (let iter = 0; iter < iterations; iter += 1) {
    const conv = convolveDirectionalPsf(estimate, width, height, ux, uy, 1.45);
    const ratio = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      ratio[i] = observed[i] / Math.max(0.008, conv[i]);
    }
    const corr = convolveDirectionalPsf(ratio, width, height, ux, uy, 1.45);
    for (let i = 0; i < n; i += 1) {
      estimate[i] = Math.min(1, Math.max(0.004, estimate[i] * corr[i]));
    }
  }

  const eps = 28 * s;
  const targetLuma = new Float32Array(n);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const idx = row + x;
      const c = srcLuma[idx];
      const dNeg = sampleBilinearFloat(srcLuma, width, height, x - ux * 1.45, y - uy * 1.45);
      const dPos = sampleBilinearFloat(srcLuma, width, height, x + ux * 1.45, y + uy * 1.45);
      const localMin = Math.min(c, dNeg, dPos);
      const localMax = Math.max(c, dNeg, dPos);
      const raw = estimate[idx] * 255;
      const guarded = Math.min(localMax + eps, Math.max(localMin - eps, raw));
      const dirBoost = (c - (dNeg + dPos) * 0.5) * (0.65 * s);
      targetLuma[idx] = Math.min(255, Math.max(0, c + (guarded - c) * (1.1 + 0.55 * s) + dirBoost));
    }
  }

  applyLumaDeltaPreserveChroma(data, srcLuma, targetLuma, Math.min(1, s * 1.15));
}

function findPercentileFromHistogram(hist: Uint32Array, total: number, pct: number): number {
  const target = Math.floor(total * pct);
  let acc = 0;
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

/** Tool 7: Old-photo dust cleanup + 1%–99% dynamic range recovery + cast neutralization (Pulihkan Foto Lama). */
function runProRestore(imageData: ImageData, s: number): void {
  const { width, height, data } = imageData;
  const n = width * height;
  if (width < 3 || height < 3) return;

  // Stage A: Outlier-gated 3x3 impulse dust/speckle median replacement on luminance
  const srcLuma = extractLuma(data, n);
  const cleaned = new Uint8ClampedArray(data);
  const outlierThresh = Math.max(16, 36 - 16 * s);
  const window9 = new Float32Array(9);

  for (let y = 1; y < height - 1; y += 1) {
    const ym = (y - 1) * width;
    const yc = y * width;
    const yp = (y + 1) * width;
    for (let x = 1; x < width - 1; x += 1) {
      const idx = yc + x;
      const lc = srcLuma[idx];
      let k = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      for (const ro of [ym, yc, yp]) {
        for (const cx of [x - 1, x, x + 1]) {
          const ni = ro + cx;
          window9[k++] = srcLuma[ni];
          if (ni !== idx) {
            const np = ni * 4;
            sumR += data[np];
            sumG += data[np + 1];
            sumB += data[np + 2];
          }
        }
      }
      // Partial insertion sort for median (index 4)
      for (let a = 1; a < 9; a += 1) {
        const val = window9[a];
        let b = a - 1;
        while (b >= 0 && window9[b] > val) {
          window9[b + 1] = window9[b];
          b -= 1;
        }
        window9[b + 1] = val;
      }
      const medL = window9[4];
      if (Math.abs(lc - medL) > outlierThresh) {
        // Also ensure it is an isolated speckle (neighbors agree near median)
        let closeNeighbors = 0;
        for (let m = 0; m < 9; m += 1) {
          if (Math.abs(window9[m] - medL) < outlierThresh * 0.7) closeNeighbors += 1;
        }
        if (closeNeighbors >= 5) {
          const p = idx * 4;
          const avgR = sumR / 8;
          const avgG = sumG / 8;
          const avgB = sumB / 8;
          // Impulse dust specks must be replaced strongly before histogram stretching re-amplifies them
          const dustMix = Math.min(1, s * 1.45);
          cleaned[p] = clampByte(data[p] + (avgR - data[p]) * dustMix);
          cleaned[p + 1] = clampByte(data[p + 1] + (avgG - data[p + 1]) * dustMix);
          cleaned[p + 2] = clampByte(data[p + 2] + (avgB - data[p + 2]) * dustMix);
        }
      }
    }
  }

  // Stage B: Per-channel 1%-99% histogram stretch & sepia/yellow cast neutralization
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);
  for (let i = 0; i < n; i += 1) {
    const p = i * 4;
    histR[cleaned[p]] += 1;
    histG[cleaned[p + 1]] += 1;
    histB[cleaned[p + 2]] += 1;
  }

  const lowR = findPercentileFromHistogram(histR, n, 0.01);
  const highR = Math.max(lowR + 12, findPercentileFromHistogram(histR, n, 0.99));
  const lowG = findPercentileFromHistogram(histG, n, 0.01);
  const highG = Math.max(lowG + 12, findPercentileFromHistogram(histG, n, 0.99));
  const lowB = findPercentileFromHistogram(histB, n, 0.01);
  const highB = Math.max(lowB + 12, findPercentileFromHistogram(histB, n, 0.99));

  const stretchBlend = 0.85 * s;
  for (let i = 0; i < n; i += 1) {
    const p = i * 4;
    const r0 = cleaned[p];
    const g0 = cleaned[p + 1];
    const b0 = cleaned[p + 2];

    const sr = clamp01((r0 - lowR) / (highR - lowR)) * 246 + 5;
    const sg = clamp01((g0 - lowG) / (highG - lowG)) * 246 + 5;
    const sb = clamp01((b0 - lowB) / (highB - lowB)) * 246 + 5;

    data[p] = clampByte(r0 + (sr - r0) * stretchBlend);
    data[p + 1] = clampByte(g0 + (sg - g0) * stretchBlend);
    data[p + 2] = clampByte(b0 + (sb - b0) * stretchBlend);
  }

  // Stage C: Structural detail clarity lift
  const postLuma = extractLuma(data, n);
  const blur2 = separableBoxBlurFloat(postLuma, width, height, 2, 1);
  const targetLuma = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const d = (postLuma[i] - blur2[i]) * (0.65 * s);
    targetLuma[i] = Math.min(255, Math.max(0, postLuma[i] + d));
  }
  applyLumaDeltaPreserveChroma(data, postLuma, targetLuma, 1);
}

/** Tool 8: Tonal-to-color reconstruction across 3 natural tone profiles (Warnai Foto). */
function runProColourise(
  imageData: ImageData,
  s: number,
  profile: ColouriseToneProfile
): void {
  const { width, height, data } = imageData;
  const n = width * height;
  if (width < 2 || height < 2) return;

  const rawLuma = extractLuma(data, n);
  const smoothLuma = separableBoxBlurFloat(rawLuma, width, height, Math.max(1, Math.min(3, Math.floor(width / 16))), 1);
  const maxH = Math.max(1, height - 1);

  for (let y = 0; y < height; y += 1) {
    const yNorm = y / maxH;
    const skyPrior = clamp01(1 - yNorm * 1.45);
    const groundPrior = clamp01((yNorm - 0.35) / 0.65);

    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const p = idx * 4;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
      const lVal = rawLuma[idx];
      const ls = smoothLuma[idx] / 255;
      const texture = Math.min(1, Math.abs(rawLuma[idx] - smoothLuma[idx]) / 24);

      // Desired target chrominance offsets (deltaR, deltaG, deltaB around neutral luminance)
      let dr = 0;
      let dg = 0;
      let db = 0;

      if (profile === 'nature-sky') {
        if (skyPrior > 0.25 && ls > 0.42 && texture < 0.35) {
          // Cool azure upper sky tint
          const k = skyPrior * clamp01((ls - 0.35) / 0.55);
          dr = -24 * k;
          dg = 4 * k;
          db = 28 * k;
        } else if (ls >= 0.25 && ls <= 0.78) {
          // Lush foliage olive-green midtones + warm earth transition
          const folWeight = clamp01(0.45 + groundPrior * 0.55);
          dr = -8 * folWeight + 12 * (1 - folWeight);
          dg = 16 * folWeight;
          db = -18 * folWeight;
        } else if (ls < 0.25) {
          // Warm dark terracotta earth shadow
          dr = 10;
          dg = 2;
          db = -12;
        } else {
          // Sunlit warm clouds/highlights
          dr = 8;
          dg = 4;
          db = -8;
        }
      } else if (profile === 'classic-natural') {
        // Balanced archival tone palette: muted steel sky upper highlights, tasteful warm midtones
        const midBand = Math.exp(-Math.pow((ls - 0.54) / 0.26, 2));
        if (skyPrior > 0.35 && ls > 0.62) {
          dr = -12 * skyPrior;
          dg = 2 * skyPrior;
          db = 16 * skyPrior;
        } else {
          dr = 18 * midBand + 6 * (1 - ls);
          dg = 4 * midBand;
          db = -20 * midBand - 8 * (1 - ls);
        }
      } else {
        // 'warm-portrait' (Potret Hangat — default)
        // Warm skin/peach curve centered on midtones [0.35..0.82], deep espresso shadows, golden cream lights
        const portraitBand = Math.exp(-Math.pow((ls - 0.58) / 0.28, 2));
        const deepShadow = clamp01((0.32 - ls) / 0.32);
        dr = 28 * portraitBand + 10 * deepShadow + 8 * groundPrior;
        dg = 5 * portraitBand + 2 * deepShadow;
        db = -28 * portraitBand - 12 * deepShadow - 6 * groundPrior;
      }

      // Luminance-neutralizing projection so grey tones gain pure hue without blowing out brightness
      const avgShift = 0.2126 * dr + 0.7152 * dg + 0.0722 * db;
      const nr = lVal + (dr - avgShift);
      const ng = lVal + (dg - avgShift);
      const nb = lVal + (db - avgShift);

      if (sat < 0.28) {
        const bwWeight = clamp01((0.28 - sat) / 0.28) * s;
        // Preserve grayscale highlights/blacks softly at extremes while maintaining clear color in midtones
        const toneMask = ls > 0.03 && ls < 0.97 ? 1 : 0.45;
        const mix = bwWeight * toneMask;
        data[p] = clampByte(r + (nr - r) * mix);
        data[p + 1] = clampByte(g + (ng - g) * mix);
        data[p + 2] = clampByte(b + (nb - b) * mix);
      } else {
        // Revive faded colors smoothly
        const revive = 1 + 0.36 * s;
        const fr = lVal + (r - lVal) * revive;
        const fg = lVal + (g - lVal) * revive;
        const fb = lVal + (b - lVal) * revive;
        const hintMix = 0.25 * s;
        data[p] = clampByte(fr + (nr - fr) * hintMix);
        data[p + 1] = clampByte(fg + (ng - fg) * hintMix);
        data[p + 2] = clampByte(fb + (nb - fb) * hintMix);
      }
    }
  }
}

/** Tool 9: Multi-stage Face Restoration (artifact cleanup + eye/hair RL + shadow lift, distinct from enhance-face). */
function runProFaceRestoration(imageData: ImageData, s: number): void {
  const { width, height, data } = imageData;
  const n = width * height;
  if (width < 3 || height < 3) return;

  const skinProb = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const p = i * 4;
    skinProb[i] = computeSkinProbability(data[p], data[p + 1], data[p + 2]);
  }
  const faceRadius = Math.max(4, Math.min(12, Math.round(Math.min(width, height) * 0.035)));
  const faceRegion = separableBoxBlurFloat(skinProb, width, height, faceRadius, 1);

  // Stage A: Skin-masked artifact & grain bilateral polish
  const skinRestored = applyBilateralRgbFilter(
    data,
    width,
    height,
    22 + 12 * s,
    0.84 * s,
    skinProb
  );

  // Stage B: 2-pass deconvolution on non-skin facial details (eyes, brows, lips, hair)
  const luma = extractLuma(skinRestored, n);
  const obs = new Float32Array(n);
  for (let i = 0; i < n; i += 1) obs[i] = Math.max(0.008, luma[i] / 255);
  let est = new Float32Array(obs);
  for (let iter = 0; iter < 2; iter += 1) {
    const conv = convolvePsf5x5(est, width, height);
    const ratio = new Float32Array(n);
    for (let i = 0; i < n; i += 1) ratio[i] = obs[i] / Math.max(0.008, conv[i]);
    const corr = convolvePsf5x5(ratio, width, height);
    for (let i = 0; i < n; i += 1) est[i] = Math.min(1, Math.max(0.004, est[i] * corr[i]));
  }
  const blur1 = separableBoxBlurFloat(luma, width, height, 1, 1);

  for (let i = 0; i < n; i += 1) {
    const p = i * 4;
    const sp = skinProb[i];
    const fm = clamp01(faceRegion[i] * 2.4);
    const lv = luma[i];

    // Recover deep shadows under eyes/chin without flat highlights
    const shadowLift = lv < 105 ? ((105 - lv) / 105) * 18 * s * fm : 0;
    const detailMask = fm * (1 - sp * 0.65);
    const deconvDelta = (est[i] * 255 - lv) * (0.9 * s * (0.35 + 0.65 * detailMask));
    const eyeCrisp = (lv - blur1[i]) * (1.5 * s * detailMask);

    // Balanced contrast & crispness lift across facial tone
    const r = skinRestored[p] + shadowLift + deconvDelta + eyeCrisp + sp * 3 * s;
    const g = skinRestored[p + 1] + shadowLift + deconvDelta + eyeCrisp + sp * 1.5 * s;
    const b = skinRestored[p + 2] + shadowLift + deconvDelta + eyeCrisp - sp * 1.5 * s;

    data[p] = clampByte(r);
    data[p + 1] = clampByte(g);
    data[p + 2] = clampByte(b);
  }
}

export function applyProPhotoTool(
  imageData: ImageData,
  toolId: ProPhotoToolId,
  strength = 80,
  colouriseProfile: ColouriseToneProfile = 'warm-portrait'
): void {
  const s = normalizeStrength(strength);
  if (s <= 0.001) {
    return;
  }

  switch (toolId) {
    case 'sharpen':
      runProSharpen(imageData, s);
      return;
    case 'retouch':
      runProRetouch(imageData, s);
      return;
    case 'enhance-face':
      runProEnhanceFace(imageData, s);
      return;
    case 'deblur':
      runProDeblur(imageData, s);
      return;
    case 'dehaze':
      runProDehaze(imageData, s);
      return;
    case 'remove-motion-blur':
      runProRemoveMotionBlur(imageData, s);
      return;
    case 'restore':
      runProRestore(imageData, s);
      return;
    case 'colourise':
      runProColourise(imageData, s, colouriseProfile);
      return;
    case 'face-restoration':
      runProFaceRestoration(imageData, s);
  }
}

export function applyProPhotoToolsPass(
  imageData: ImageData,
  tools: readonly ProPhotoToolId[] | undefined,
  strength = 80,
  colouriseProfile: ColouriseToneProfile = 'warm-portrait'
): void {
  if (!tools || tools.length === 0) return;
  const s = normalizeStrength(strength);
  if (s <= 0.001) return;

  const activeSet = new Set(tools);
  for (const orderedTool of OPTICAL_EXECUTION_ORDER) {
    if (activeSet.has(orderedTool)) {
      applyProPhotoTool(imageData, orderedTool, strength, colouriseProfile);
    }
  }
}
