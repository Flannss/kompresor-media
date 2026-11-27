import type {
  ColorContrastEnhancementConfig,
  ColorGradeId,
  ColorGradeState,
  EnhanceRecipeId,
  EnhancementSuiteState,
  NoiseEnhancementConfig,
  NoisePresetLevel,
} from '../contracts';

export interface ColorGradeMeta {
  id: ColorGradeId;
  title: string;
  badge: string;
  description: string;
}

export const COLOR_GRADE_PRESETS: readonly ColorGradeMeta[] = [
  {
    id: 'original',
    title: 'Tanpa Filter (Original)',
    badge: 'Original',
    description: 'Pertahankan warna asli video tanpa color grading tambahan.',
  },
  {
    id: 'iphone-pro',
    title: 'iPhone 18 Pro Max Look',
    badge: 'Flagship Pro',
    description:
      'Rentang dinamis cerah, warna kulit natural, kontras bersih, highlight hangat, dan detail halus.',
  },
  {
    id: 'teal-orange',
    title: 'Cinematic Teal & Orange',
    badge: 'Cinema',
    description:
      'Tone film bioskop modern dengan bayangan teal dan highlight hangat keemasan.',
  },
  {
    id: 'golden-hour',
    title: 'Golden Hour / Warm Aesthetic',
    badge: 'Warm',
    description:
      'Nuansa sore hari yang hangat, lembut, dan estetik untuk Reels, TikTok, & Vlog.',
  },
  {
    id: 'vintage-kodak',
    title: 'Vintage Film / Kodak',
    badge: 'Retro',
    description:
      'Kontras film analog lembut dengan saturasi klasik hangat bernuansa nostalgia.',
  },
  {
    id: 'vivid-hdr',
    title: 'Vivid HDR / Jernih Cerah',
    badge: 'Vivid',
    description:
      'Warna hidup, kontras dalam, dan ketajaman ekstra untuk video buram atau kusam.',
  },
  {
    id: 'noir-bw',
    title: 'Noir B&W',
    badge: 'Mono',
    description: 'Hitam putih dramatis berkontras tinggi bergaya sinema klasik.',
  },
] as const;

export const NOISE_PRESET_VALUES: Record<
  NoisePresetLevel,
  Pick<NoiseEnhancementConfig, 'grainStrength' | 'colorSmooth' | 'motionStability'>
> = {
  subtle: { grainStrength: 2, colorSmooth: 2, motionStability: 3 },
  balanced: { grainStrength: 4, colorSmooth: 3, motionStability: 5 },
  strong: { grainStrength: 7, colorSmooth: 5, motionStability: 8 },
};

export function createDefaultEnhanceSuite(): EnhancementSuiteState {
  return {
    noise: {
      enabled: false,
      level: 'subtle',
      grainStrength: NOISE_PRESET_VALUES.subtle.grainStrength,
      colorSmooth: NOISE_PRESET_VALUES.subtle.colorSmooth,
      motionStability: NOISE_PRESET_VALUES.subtle.motionStability,
    },
    sharpen: {
      enabled: false,
      strength: 0.8,
      kernelSize: 5,
      antiArtifact: true,
    },
    colorContrast: {
      enabled: false,
      contrast: 10,
      brightness: 4,
      saturation: 10,
      shadowBright: 8,
    },
    upscale1080: {
      enabled: false,
      method: 'lanczos',
      keepAspect: true,
    },
  };
}

export function createDefaultColorGrade(): ColorGradeState {
  return {
    gradeId: 'original',
    intensity: 100,
    tone: {
      temperature: 0,
      tint: 0,
      shadows: 0,
      highlights: 0,
    },
  };
}

export function applyEnhanceRecipe(
  recipeId: EnhanceRecipeId,
  current?: EnhancementSuiteState
): EnhancementSuiteState {
  const base = current
    ? structuredClone(current)
    : createDefaultEnhanceSuite();

  switch (recipeId) {
    case 'dark-footage':
      return {
        ...base,
        noise: {
          enabled: true,
          level: 'balanced',
          grainStrength: 5,
          colorSmooth: 4,
          motionStability: 6,
        },
        colorContrast: {
          enabled: true,
          contrast: 8,
          brightness: 10,
          saturation: 6,
          shadowBright: 18,
        },
        sharpen: {
          enabled: true,
          strength: 0.6,
          kernelSize: 3,
          antiArtifact: true,
        },
      };

    case 'crisp-text':
      return {
        ...base,
        sharpen: {
          enabled: true,
          strength: 1.35,
          kernelSize: 5,
          antiArtifact: true,
        },
        upscale1080: {
          enabled: true,
          method: 'lanczos',
          keepAspect: true,
        },
        colorContrast: {
          enabled: true,
          contrast: 12,
          brightness: 2,
          saturation: 4,
          shadowBright: 0,
        },
      };

    case 'hd-balanced':
    default:
      return {
        noise: {
          enabled: true,
          level: 'subtle',
          ...NOISE_PRESET_VALUES.subtle,
        },
        sharpen: {
          enabled: true,
          strength: 0.85,
          kernelSize: 5,
          antiArtifact: true,
        },
        colorContrast: {
          enabled: true,
          contrast: 10,
          brightness: 4,
          saturation: 12,
          shadowBright: 8,
        },
        upscale1080: {
          enabled: true,
          method: 'lanczos',
          keepAspect: true,
        },
      };
  }
}

export function hasActiveEnhancements(suite: EnhancementSuiteState): boolean {
  return (
    suite.noise.enabled ||
    suite.sharpen.enabled ||
    suite.colorContrast.enabled ||
    suite.upscale1080.enabled
  );
}

export function hasActiveColorGrade(grade: ColorGradeState): boolean {
  const hasTone =
    grade.tone.temperature !== 0 ||
    grade.tone.tint !== 0 ||
    grade.tone.shadows !== 0 ||
    grade.tone.highlights !== 0;
  return (grade.gradeId !== 'original' && grade.intensity > 0) || hasTone;
}

interface ResolvedGradeCoefficients {
  contrastMul: number; // 1 = neutral
  brightnessAdd: number; // -0.5..0.5 (normalized 0..1 pixel scale)
  saturationMul: number; // 1 = neutral
  gammaExp: number; // 1 = neutral (>1 brighter midtones in FFmpeg eq)
  // Shadow, midtone, highlight RGB shifts (-0.5..0.5)
  rs: number;
  gs: number;
  bs: number;
  rm: number;
  gm: number;
  bm: number;
  rh: number;
  gh: number;
  bh: number;
  monoBlend: number; // 0..1 monochrome mix
  blackLift: number; // 0..0.06 subtle analog fade
}

function getBaseLookProfile(gradeId: ColorGradeId): ResolvedGradeCoefficients {
  switch (gradeId) {
    case 'iphone-pro':
      return {
        contrastMul: 1.07,
        brightnessAdd: 0.02,
        saturationMul: 1.12,
        gammaExp: 1.04,
        rs: 0.01,
        gs: 0,
        bs: -0.01,
        rm: 0.02,
        gm: 0.01,
        bm: -0.02,
        rh: 0.04,
        gh: 0.01,
        bh: -0.03,
        monoBlend: 0,
        blackLift: 0,
      };
    case 'teal-orange':
      return {
        contrastMul: 1.13,
        brightnessAdd: 0,
        saturationMul: 1.09,
        gammaExp: 0.99,
        rs: -0.12,
        gs: 0.04,
        bs: 0.14,
        rm: 0.02,
        gm: 0,
        bm: -0.02,
        rh: 0.14,
        gh: 0.03,
        bh: -0.12,
        monoBlend: 0,
        blackLift: 0,
      };
    case 'golden-hour':
      return {
        contrastMul: 1.04,
        brightnessAdd: 0.03,
        saturationMul: 1.14,
        gammaExp: 1.05,
        rs: 0.05,
        gs: 0.01,
        bs: -0.06,
        rm: 0.1,
        gm: 0.03,
        bm: -0.1,
        rh: 0.14,
        gh: 0.05,
        bh: -0.14,
        monoBlend: 0,
        blackLift: 0,
      };
    case 'vintage-kodak':
      return {
        contrastMul: 0.96,
        brightnessAdd: 0.02,
        saturationMul: 0.88,
        gammaExp: 1.05,
        rs: 0.04,
        gs: 0.03,
        bs: -0.02,
        rm: 0.07,
        gm: 0.02,
        bm: -0.06,
        rh: 0.06,
        gh: 0.02,
        bh: -0.08,
        monoBlend: 0,
        blackLift: 0.045,
      };
    case 'vivid-hdr':
      return {
        contrastMul: 1.17,
        brightnessAdd: 0.02,
        saturationMul: 1.26,
        gammaExp: 1.06,
        rs: -0.01,
        gs: 0,
        bs: 0.02,
        rm: 0.01,
        gm: 0.01,
        bm: 0,
        rh: 0.03,
        gh: 0.02,
        bh: 0.02,
        monoBlend: 0,
        blackLift: 0,
      };
    case 'noir-bw':
      return {
        contrastMul: 1.24,
        brightnessAdd: -0.01,
        saturationMul: 1,
        gammaExp: 0.94,
        rs: 0,
        gs: 0,
        bs: 0,
        rm: 0,
        gm: 0,
        bm: 0,
        rh: 0,
        gh: 0,
        bh: 0,
        monoBlend: 1,
        blackLift: 0,
      };
    case 'original':
    default:
      return {
        contrastMul: 1,
        brightnessAdd: 0,
        saturationMul: 1,
        gammaExp: 1,
        rs: 0,
        gs: 0,
        bs: 0,
        rm: 0,
        gm: 0,
        bm: 0,
        rh: 0,
        gh: 0,
        bh: 0,
        monoBlend: 0,
        blackLift: 0,
      };
  }
}

export function resolveGradeAndEnhanceCoefficients(
  grade: ColorGradeState,
  colorContrast?: ColorContrastEnhancementConfig
): ResolvedGradeCoefficients {
  const t = grade.gradeId === 'original' ? 0 : Math.min(1, Math.max(0, grade.intensity / 100));
  const look = getBaseLookProfile(grade.gradeId);

  let contrastMul = 1 + (look.contrastMul - 1) * t;
  let brightnessAdd = look.brightnessAdd * t;
  let saturationMul = 1 + (look.saturationMul - 1) * t;
  let gammaExp = 1 + (look.gammaExp - 1) * t;

  let rs = look.rs * t;
  let gs = look.gs * t;
  let bs = look.bs * t;
  let rm = look.rm * t;
  let gm = look.gm * t;
  let bm = look.bm * t;
  let rh = look.rh * t;
  let gh = look.gh * t;
  let bh = look.bh * t;
  const monoBlend = look.monoBlend * t;
  const blackLift = look.blackLift * t;

  if (colorContrast?.enabled) {
    contrastMul *= 1 + (colorContrast.contrast / 50) * 0.28;
    brightnessAdd += (colorContrast.brightness / 50) * 0.14;
    saturationMul *= 1 + (colorContrast.saturation / 50) * 0.35;
    gammaExp *= 1 + (colorContrast.shadowBright / 50) * 0.22;
  }

  // Layer Tone Adjustments (-50..50)
  const temp = (grade.tone.temperature / 50) * 0.12;
  const tint = (grade.tone.tint / 50) * 0.1;
  const shadows = (grade.tone.shadows / 50) * 0.14;
  const highlights = (grade.tone.highlights / 50) * 0.14;

  rm += temp;
  bm -= temp;
  rh += temp * 0.5;
  bh -= temp * 0.5;

  gm -= tint;
  rm += tint * 0.5;
  bm += tint * 0.5;

  rs += shadows;
  gs += shadows;
  bs += shadows;

  rh += highlights;
  gh += highlights;
  bh += highlights;

  return {
    contrastMul: Math.min(2, Math.max(0.4, contrastMul)),
    brightnessAdd: Math.min(0.4, Math.max(-0.4, brightnessAdd)),
    saturationMul: Math.min(2, Math.max(0, saturationMul)),
    gammaExp: Math.min(1.6, Math.max(0.5, gammaExp)),
    rs: Math.min(0.45, Math.max(-0.45, rs)),
    gs: Math.min(0.45, Math.max(-0.45, gs)),
    bs: Math.min(0.45, Math.max(-0.45, bs)),
    rm: Math.min(0.45, Math.max(-0.45, rm)),
    gm: Math.min(0.45, Math.max(-0.45, gm)),
    bm: Math.min(0.45, Math.max(-0.45, bm)),
    rh: Math.min(0.45, Math.max(-0.45, rh)),
    gh: Math.min(0.45, Math.max(-0.45, gh)),
    bh: Math.min(0.45, Math.max(-0.45, bh)),
    monoBlend,
    blackLift,
  };
}

export interface SvgFilterParams {
  active: boolean;
  matrixValues: string;
  slopeR: number;
  slopeG: number;
  slopeB: number;
  interceptR: number;
  interceptG: number;
  interceptB: number;
  gammaExponent: number;
}

/**
 * Computes calibrated SVG filter parameters (<feColorMatrix> + <feComponentTransfer>)
 * so live <video> / <img> preview matches FFmpeg & Web Worker output cleanly at 60fps.
 */
export function buildSvgFilterParams(
  grade: ColorGradeState,
  colorContrast?: ColorContrastEnhancementConfig
): SvgFilterParams {
  const c = resolveGradeAndEnhanceCoefficients(grade, colorContrast);
  const active =
    hasActiveColorGrade(grade) ||
    Boolean(colorContrast?.enabled);

  // Combine saturation and monochrome blend into a 3x3 color matrix
  const effSat = c.saturationMul * (1 - c.monoBlend);
  const lwR = 0.2126;
  const lwG = 0.7152;
  const lwB = 0.0722;
  const sr = (1 - effSat) * lwR;
  const sg = (1 - effSat) * lwG;
  const sb = (1 - effSat) * lwB;

  const midBoostR = 1 + c.rm * 0.45;
  const midBoostG = 1 + c.gm * 0.45;
  const midBoostB = 1 + c.bm * 0.45;

  const m = [
    ((sr + effSat) * midBoostR).toFixed(4),
    (sg * midBoostR).toFixed(4),
    (sb * midBoostR).toFixed(4),
    '0',
    ((c.rs + c.rh) * 0.16).toFixed(4),

    (sr * midBoostG).toFixed(4),
    ((sg + effSat) * midBoostG).toFixed(4),
    (sb * midBoostG).toFixed(4),
    '0',
    ((c.gs + c.gh) * 0.16).toFixed(4),

    (sr * midBoostB).toFixed(4),
    (sg * midBoostB).toFixed(4),
    ((sb + effSat) * midBoostB).toFixed(4),
    '0',
    ((c.bs + c.bh) * 0.16).toFixed(4),

    '0',
    '0',
    '0',
    '1',
    '0',
  ];

  const baseIntercept = 0.5 * (1 - c.contrastMul) + c.brightnessAdd + c.blackLift * 0.6;
  const slopeR = Number((c.contrastMul * (1 + c.rh * 0.14)).toFixed(4));
  const slopeG = Number((c.contrastMul * (1 + c.gh * 0.14)).toFixed(4));
  const slopeB = Number((c.contrastMul * (1 + c.bh * 0.14)).toFixed(4));

  return {
    active,
    matrixValues: m.join(' '),
    slopeR,
    slopeG,
    slopeB,
    interceptR: Number((baseIntercept + c.rs * 0.12).toFixed(4)),
    interceptG: Number((baseIntercept + c.gs * 0.12).toFixed(4)),
    interceptB: Number((baseIntercept + c.bs * 0.12).toFixed(4)),
    gammaExponent: Number((1 / Math.max(0.5, c.gammaExp)).toFixed(4)),
  };
}

/**
 * Generates verified LUT-free FFmpeg filter chain segments for Color Grading + Color Contrast.
 * Uses strictly verified compiled filters: eq, colorchannelmixer, colorbalance, curves.
 */
export function buildColorGradeFfmpegFilters(
  grade: ColorGradeState,
  colorContrast?: ColorContrastEnhancementConfig
): string[] {
  const c = resolveGradeAndEnhanceCoefficients(grade, colorContrast);
  const parts: string[] = [];

  if (c.monoBlend > 0.01) {
    const k = c.monoBlend;
    const inv = 1 - k;
    const rr = (inv + k * 0.299).toFixed(3);
    const rg = (k * 0.587).toFixed(3);
    const rb = (k * 0.114).toFixed(3);
    const gr = (k * 0.299).toFixed(3);
    const gg = (inv + k * 0.587).toFixed(3);
    const gb = (k * 0.114).toFixed(3);
    const br = (k * 0.299).toFixed(3);
    const bg = (k * 0.587).toFixed(3);
    const bb = (inv + k * 0.114).toFixed(3);
    parts.push(
      `colorchannelmixer=rr=${rr}:rg=${rg}:rb=${rb}:gr=${gr}:gg=${gg}:gb=${gb}:br=${br}:bg=${bg}:bb=${bb}`
    );
  }

  const needsEq =
    Math.abs(c.contrastMul - 1) > 0.005 ||
    Math.abs(c.brightnessAdd) > 0.005 ||
    Math.abs(c.saturationMul - 1) > 0.005 ||
    Math.abs(c.gammaExp - 1) > 0.005;

  if (needsEq) {
    parts.push(
      `eq=contrast=${c.contrastMul.toFixed(3)}:brightness=${c.brightnessAdd.toFixed(3)}:saturation=${c.saturationMul.toFixed(3)}:gamma=${c.gammaExp.toFixed(3)}`
    );
  }

  const hasColorBalance =
    Math.abs(c.rs) > 0.005 ||
    Math.abs(c.gs) > 0.005 ||
    Math.abs(c.bs) > 0.005 ||
    Math.abs(c.rm) > 0.005 ||
    Math.abs(c.gm) > 0.005 ||
    Math.abs(c.bm) > 0.005 ||
    Math.abs(c.rh) > 0.005 ||
    Math.abs(c.gh) > 0.005 ||
    Math.abs(c.bh) > 0.005;

  if (hasColorBalance) {
    const segs = [
      `rs=${c.rs.toFixed(3)}`,
      `gs=${c.gs.toFixed(3)}`,
      `bs=${c.bs.toFixed(3)}`,
      `rm=${c.rm.toFixed(3)}`,
      `gm=${c.gm.toFixed(3)}`,
      `bm=${c.bm.toFixed(3)}`,
      `rh=${c.rh.toFixed(3)}`,
      `gh=${c.gh.toFixed(3)}`,
      `bh=${c.bh.toFixed(3)}`,
    ];
    parts.push(`colorbalance=${segs.join(':')}`);
  }

  if (c.blackLift > 0.005) {
    const low = c.blackLift.toFixed(3);
    const high = (1 - c.blackLift * 0.7).toFixed(3);
    parts.push(`curves=master='0/${low} 0.5/0.5 1/${high}'`);
  }

  return parts;
}

/**
 * Computes orientation-aware 1080p HD even dimensions:
 * Landscape -> up to 1920x1080; Portrait -> up to 1080x1920.
 */
export function compute1080pTargetDimensions(
  srcWidth: number,
  srcHeight: number,
  keepAspect: boolean
): { width: number; height: number } {
  const isPortrait = srcHeight > srcWidth;
  if (!keepAspect) {
    return isPortrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  }

  if (srcWidth === srcHeight) {
    return { width: 1080, height: 1080 };
  }

  const maxW = isPortrait ? 1080 : 1920;
  const maxH = isPortrait ? 1920 : 1080;
  const scale = Math.min(maxW / srcWidth, maxH / srcHeight);
  const rawW = Math.round(srcWidth * scale);
  const rawH = Math.round(srcHeight * scale);
  return {
    width: Math.max(2, rawW - (rawW % 2)),
    height: Math.max(2, rawH - (rawH % 2)),
  };
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Mathematical pixel-level mirror of all 7 Color Grades + Tone + Color Contrast for Photo Worker & thumbnails.
 */
export function applyColorGradeToImageData(
  imageData: ImageData,
  grade: ColorGradeState,
  colorContrast?: ColorContrastEnhancementConfig
): void {
  if (!hasActiveColorGrade(grade) && !colorContrast?.enabled) {
    return;
  }

  const c = resolveGradeAndEnhanceCoefficients(grade, colorContrast);
  const data = imageData.data;
  const invGamma = 1 / Math.max(0.5, c.gammaExp);
  const bright255 = c.brightnessAdd * 255;

  // Build 256-entry gamma LUT for speed
  const gammaLut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i += 1) {
    const n = i / 255;
    const lifted = c.blackLift > 0 ? c.blackLift + n * (1 - c.blackLift * 1.4) : n;
    const gCorrected = Math.pow(Math.min(1, Math.max(0, lifted)), invGamma);
    gammaLut[i] = clampByte(gCorrected * 255);
  }

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    if (c.monoBlend > 0) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = r + (gray - r) * c.monoBlend;
      g = g + (gray - g) * c.monoBlend;
      b = b + (gray - b) * c.monoBlend;
    }

    if (Math.abs(c.saturationMul - 1) > 0.005) {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = luma + (r - luma) * c.saturationMul;
      g = luma + (g - luma) * c.saturationMul;
      b = luma + (b - luma) * c.saturationMul;
    }

    r = (r + bright255 - 128) * c.contrastMul + 128;
    g = (g + bright255 - 128) * c.contrastMul + 128;
    b = (b + bright255 - 128) * c.contrastMul + 128;

    const lumaNorm = Math.min(1, Math.max(0, (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255));
    const sw = Math.max(0, 1 - lumaNorm * 2);
    const hw = Math.max(0, lumaNorm * 2 - 1);
    const mw = 1 - Math.abs(lumaNorm * 2 - 1);

    r += (c.rs * sw + c.rm * mw + c.rh * hw) * 165;
    g += (c.gs * sw + c.gm * mw + c.gh * hw) * 165;
    b += (c.bs * sw + c.bm * mw + c.bh * hw) * 165;

    data[i] = gammaLut[clampByte(r)];
    data[i + 1] = gammaLut[clampByte(g)];
    data[i + 2] = gammaLut[clampByte(b)];
  }
}
