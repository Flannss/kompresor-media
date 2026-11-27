import type { PhotoFilterId } from '../contracts';

export interface PhotoFilterPresetSpec {
  id: PhotoFilterId;
  title: string;
  badge: string;
  description: string;
  css: {
    brightness: number;
    contrast: number;
    saturate: number;
    sepia?: number;
    hueRotateDeg?: number;
    grayscale?: number;
  };
}

export const PHOTO_FILTER_PRESETS: readonly PhotoFilterPresetSpec[] = [
  {
    id: 'original',
    title: 'Asli',
    badge: 'Asli',
    description: 'Warna asli foto tanpa filter.',
    css: { brightness: 1, contrast: 1, saturate: 1 },
  },
  {
    id: 'realphoto',
    title: 'RealPhoto Natural',
    badge: 'Natural',
    description: 'Warna jernih natural dengan kontras seimbang.',
    css: { brightness: 1.03, contrast: 1.06, saturate: 1.07 },
  },
  {
    id: 'flagship-pro',
    title: 'Flagship Pro',
    badge: 'Pro',
    description: 'Tegas, bersih, dan highlight terkendali.',
    css: { brightness: 1.02, contrast: 1.12, saturate: 1.1 },
  },
  {
    id: 'cinematic',
    title: 'Sinematik',
    badge: 'Film',
    description: 'Shadow sejuk kebiruan dan kulit hangat.',
    css: { brightness: 0.99, contrast: 1.14, saturate: 1.05, hueRotateDeg: -6 },
  },
  {
    id: 'golden-hour',
    title: 'Golden Hour',
    badge: 'Senja',
    description: 'Cahaya keemasan sore yang lembut.',
    css: { brightness: 1.04, contrast: 1.06, saturate: 1.16, sepia: 0.16, hueRotateDeg: -4 },
  },
  {
    id: 'vintage-kodak',
    title: 'Vintage Kodak',
    badge: 'Kodak',
    description: 'Nuansa analog film klasik yang hangat.',
    css: { brightness: 1.02, contrast: 1.04, saturate: 0.92, sepia: 0.24 },
  },
  {
    id: 'vivid-hdr',
    title: 'Vivid HDR',
    badge: 'HDR',
    description: 'Warna cerah bertenaga dan detail bayangan.',
    css: { brightness: 1.04, contrast: 1.15, saturate: 1.28 },
  },
  {
    id: 'editorial-matte',
    title: 'Editorial Matte',
    badge: 'Matte',
    description: 'Fade hitam lembut bergaya majalah.',
    css: { brightness: 1.05, contrast: 0.92, saturate: 0.9 },
  },
  {
    id: 'pastel-soft',
    title: 'Pastel Lembut',
    badge: 'Pastel',
    description: 'Terang, ringan, dan warna pastel halus.',
    css: { brightness: 1.08, contrast: 0.95, saturate: 1.08 },
  },
  {
    id: 'cool-studio',
    title: 'Studio Sejuk',
    badge: 'Sejuk',
    description: 'Netral bersih dengan nuansa studio dingin.',
    css: { brightness: 1.03, contrast: 1.08, saturate: 0.98, hueRotateDeg: 5 },
  },
  {
    id: 'moody-dark',
    title: 'Moody Gelap',
    badge: 'Moody',
    description: 'Shadow dalam dengan saturasi teredam.',
    css: { brightness: 0.92, contrast: 1.18, saturate: 0.84 },
  },
  {
    id: 'noir-bw',
    title: 'Hitam Putih Noir',
    badge: 'Noir',
    description: 'Monokrom kontras tajam dan dramatis.',
    css: { brightness: 1.0, contrast: 1.24, saturate: 0, grayscale: 1 },
  },
] as const;

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Instant lightweight GPU CSS preview string for filter thumbnail cards.
 * Operates on a single shared 96px thumbnail without allocating extra canvases.
 */
export function getPhotoFilterCssPreview(filterId: PhotoFilterId, intensity = 100): string {
  const clamped = Math.min(100, Math.max(0, intensity));
  if (filterId === 'original' || clamped <= 0) {
    return 'none';
  }
  const spec = PHOTO_FILTER_PRESETS.find((f) => f.id === filterId);
  if (!spec) return 'none';

  const t = clamped / 100;
  const b = 1 + (spec.css.brightness - 1) * t;
  const c = 1 + (spec.css.contrast - 1) * t;
  const s = 1 + (spec.css.saturate - 1) * t;
  const parts = [
    `brightness(${b.toFixed(3)})`,
    `contrast(${c.toFixed(3)})`,
    `saturate(${s.toFixed(3)})`,
  ];
  if (spec.css.sepia) {
    parts.push(`sepia(${(spec.css.sepia * t).toFixed(3)})`);
  }
  if (spec.css.hueRotateDeg) {
    parts.push(`hue-rotate(${(spec.css.hueRotateDeg * t).toFixed(1)}deg)`);
  }
  if (spec.css.grayscale) {
    parts.push(`grayscale(${(spec.css.grayscale * t).toFixed(3)})`);
  }
  return parts.join(' ');
}

/**
 * Applies any of the 12 Photo Studio color looks in-place on RGBA ImageData.
 * Linearly blends toward the graded pixel according to intensity (0..100) and preserves alpha.
 */
export function applyPhotoFilterToImageData(
  imageData: ImageData,
  filterId: PhotoFilterId,
  intensity: number
): void {
  const clamped = Math.min(100, Math.max(0, intensity));
  if (filterId === 'original' || clamped <= 0) {
    return;
  }

  const t = clamped / 100;
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    const r0 = data[i];
    const g0 = data[i + 1];
    const b0 = data[i + 2];

    let r = r0;
    let g = g0;
    let b = b0;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const normLuma = luma / 255;

    switch (filterId) {
      case 'realphoto': {
        const sCurve = (normLuma - 0.5) * 1.07 + 0.506;
        const lumaShift = (sCurve * 255 - luma) * 0.75;
        r = luma + lumaShift + (r - luma) * 1.09 + 2;
        g = luma + lumaShift + (g - luma) * 1.08 + 1;
        b = luma + lumaShift + (b - luma) * 1.07;
        break;
      }
      case 'flagship-pro': {
        r = luma + (r - luma) * 1.12;
        g = luma + (g - luma) * 1.12;
        b = luma + (b - luma) * 1.1;
        const c = 1.12;
        r = (r - 128) * c + 129;
        g = (g - 128) * c + 129;
        b = (b - 128) * c + 129;
        break;
      }
      case 'cinematic': {
        const sw = Math.max(0, 1 - normLuma * 1.6);
        const hw = Math.max(0, (normLuma - 0.35) / 0.65);
        r = (r - 128) * 1.12 + 128 - 10 * sw + 13 * hw;
        g = (g - 128) * 1.1 + 128 + 3 * sw + 4 * hw;
        b = (b - 128) * 1.12 + 128 + 16 * sw - 11 * hw;
        break;
      }
      case 'golden-hour': {
        r = (r - 128) * 1.06 + 132 + 18;
        g = (g - 128) * 1.05 + 130 + 9;
        b = (b - 128) * 1.03 + 125 - 16;
        break;
      }
      case 'vintage-kodak': {
        const liftedR = r * 0.9 + 14;
        const liftedG = g * 0.89 + 10;
        const liftedB = b * 0.85 + 7;
        const l2 = 0.2126 * liftedR + 0.7152 * liftedG + 0.0722 * liftedB;
        r = l2 + (liftedR - l2) * 0.9 + 10;
        g = l2 + (liftedG - l2) * 0.9 + 5;
        b = l2 + (liftedB - l2) * 0.85 - 9;
        break;
      }
      case 'vivid-hdr': {
        const shadowLift = Math.max(0, 0.5 - normLuma) * 28;
        r = luma + shadowLift + (r - luma) * 1.28;
        g = luma + shadowLift + (g - luma) * 1.28;
        b = luma + shadowLift + (b - luma) * 1.28;
        r = (r - 128) * 1.12 + 128;
        g = (g - 128) * 1.12 + 128;
        b = (b - 128) * 1.12 + 128;
        break;
      }
      case 'editorial-matte': {
        r = r * 0.84 + 24;
        g = g * 0.84 + 23;
        b = b * 0.82 + 25;
        const l2 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = l2 + (r - l2) * 0.86;
        g = l2 + (g - l2) * 0.86;
        b = l2 + (b - l2) * 0.88;
        break;
      }
      case 'pastel-soft': {
        r = r * 0.92 + 22;
        g = g * 0.92 + 20;
        b = b * 0.93 + 22;
        const l2 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = l2 + (r - l2) * 1.06;
        g = l2 + (g - l2) * 1.06;
        b = l2 + (b - l2) * 1.09;
        break;
      }
      case 'cool-studio': {
        r = (r - 128) * 1.08 + 129 - 9;
        g = (g - 128) * 1.08 + 129 + 1;
        b = (b - 128) * 1.08 + 129 + 15;
        break;
      }
      case 'moody-dark': {
        const l2 = luma * 0.86;
        r = (l2 + (r - luma) * 0.78 - 128) * 1.18 + 124;
        g = (l2 + (g - luma) * 0.78 - 128) * 1.18 + 123;
        b = (l2 + (b - luma) * 0.82 - 128) * 1.18 + 126;
        break;
      }
      case 'noir-bw': {
        const bw = clampByte((luma - 128) * 1.24 + 127);
        r = bw;
        g = bw;
        b = bw;
        break;
      }
    }

    data[i] = clampByte(r0 + (r - r0) * t);
    data[i + 1] = clampByte(g0 + (g - g0) * t);
    data[i + 2] = clampByte(b0 + (b - b0) * t);
  }
}
