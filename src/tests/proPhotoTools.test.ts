import { beforeEach, describe, expect, it } from 'vitest';
import type { ColouriseToneProfile, ProPhotoToolId } from '../engines/contracts';
import { getActiveImageModuleLabels } from '../engines/image/pixelOps';
import {
  applyProPhotoTool,
  applyProPhotoToolsPass,
  COLOURISE_PROFILE_OPTIONS,
  PRO_PHOTO_TOOL_IDS,
} from '../engines/image/proTools';
import { useMediaStore } from '../store/useMediaStore';

function makeImageData(width: number, height: number, data: Uint8ClampedArray): ImageData {
  return { width, height, data } as unknown as ImageData;
}

function cloneImageData(img: ImageData): ImageData {
  return makeImageData(img.width, img.height, new Uint8ClampedArray(img.data));
}

function computeLumaArray(img: ImageData): Float32Array {
  const n = img.width * img.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const p = i * 4;
    out[i] = 0.2126 * img.data[p] + 0.7152 * img.data[p + 1] + 0.0722 * img.data[p + 2];
  }
  return out;
}

function computeLaplacianEnergy(img: ImageData): number {
  const { width, height } = img;
  const luma = computeLumaArray(img);
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const lap =
        luma[idx - 1] +
        luma[idx + 1] +
        luma[idx - width] +
        luma[idx + width] -
        4 * luma[idx];
      sumSq += lap * lap;
      count += 1;
    }
  }
  return count > 0 ? sumSq / count : 0;
}

function computeRmsContrast(img: ImageData): number {
  const luma = computeLumaArray(img);
  let mean = 0;
  for (let i = 0; i < luma.length; i += 1) mean += luma[i];
  mean /= Math.max(1, luma.length);
  let variance = 0;
  for (let i = 0; i < luma.length; i += 1) {
    const d = luma[i] - mean;
    variance += d * d;
  }
  return Math.sqrt(variance / Math.max(1, luma.length));
}

function boxBlurImageData(img: ImageData, radius = 1, passes = 2): ImageData {
  const { width, height } = img;
  let curr = new Uint8ClampedArray(img.data);
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Uint8ClampedArray(curr.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let cnt = 0;
        for (let dy = -radius; dy <= radius; dy += 1) {
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          for (let dx = -radius; dx <= radius; dx += 1) {
            const nx = Math.min(width - 1, Math.max(0, x + dx));
            const np = (ny * width + nx) * 4;
            sr += curr[np];
            sg += curr[np + 1];
            sb += curr[np + 2];
            cnt += 1;
          }
        }
        const p = (y * width + x) * 4;
        next[p] = Math.round(sr / cnt);
        next[p + 1] = Math.round(sg / cnt);
        next[p + 2] = Math.round(sb / cnt);
        next[p + 3] = curr[p + 3];
      }
    }
    curr = next;
  }
  return makeImageData(width, height, curr);
}

function makeSoftStepTarget(w = 48, h = 48): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = (y * w + x) * 4;
      const inSquare = x >= 12 && x < 36 && y >= 12 && y < 36;
      const v = inSquare ? 205 : 65;
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return boxBlurImageData(makeImageData(w, h, data), 1, 2);
}

function makeMotionBlurredStripes(w = 48, h = 48): ImageData {
  const crisp = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = (y * w + x) * 4;
      const v = Math.floor(x / 6) % 2 === 0 ? 210 : 55;
      crisp[p] = v;
      crisp[p + 1] = v;
      crisp[p + 2] = v;
      crisp[p + 3] = 255;
    }
  }
  const blurred = new Uint8ClampedArray(crisp.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let k = -2; k <= 2; k += 1) {
        const nx = Math.min(w - 1, Math.max(0, x + k));
        sum += crisp[(y * w + nx) * 4];
      }
      const p = (y * w + x) * 4;
      const v = Math.round(sum / 5);
      blurred[p] = v;
      blurred[p + 1] = v;
      blurred[p + 2] = v;
      blurred[p + 3] = 255;
    }
  }
  return makeImageData(w, h, blurred);
}

function makePortraitComposite(w = 48, h = 48): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = (y * w + x) * 4;
      let r = 74;
      let g = 90;
      let b = 114;

      if (x >= 10 && x < 38 && y >= 8 && y < 40) {
        const grain = ((x * 13 + y * 7) % 15) - 7;
        r = 198 + grain;
        g = 152 + grain;
        b = 124 + grain;
        // Left & right dark eye feature stripes + bright sclera catchlight
        if (y >= 17 && y < 21 && ((x >= 15 && x < 21) || (x >= 27 && x < 33))) {
          r = 40;
          g = 30;
          b = 28;
        } else if (y >= 17 && y < 21 && (x === 21 || x === 26)) {
          r = 226;
          g = 216;
          b = 206;
        }
      }

      data[p] = Math.min(255, Math.max(0, r));
      data[p + 1] = Math.min(255, Math.max(0, g));
      data[p + 2] = Math.min(255, Math.max(0, b));
      data[p + 3] = 250;
    }
  }
  return makeImageData(w, h, data);
}

function makeRichTestComposite(w = 48, h = 48): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = (y * w + x) * 4;
      let r = 135;
      let g = 135;
      let b = 135;

      if (x < 24 && y < 24) {
        // Warm skin patch + eye stripe + grain
        const micro = ((x * 5 + y * 11) % 13) - 6;
        r = 196 + micro;
        g = 152 + micro;
        b = 126 + micro;
        if (y >= 9 && y < 12 && x >= 8 && x < 16) {
          r = 44;
          g = 34;
          b = 30;
        }
      } else if (x >= 24 && y < 24) {
        // Pure neutral grayscale gradient for colourise test
        const bw = 70 + Math.round(((x - 24) / 24) * 145);
        r = bw;
        g = bw;
        b = bw;
      } else if (x < 24 && y >= 24) {
        // Hazy sky / soft bar
        const base = ((x + y) % 6) < 3 ? 175 : 132;
        r = base + 8;
        g = base + 4;
        b = base;
      } else {
        // Aged sepia slightly dusty corner
        r = 166;
        g = 142;
        b = 104;
      }

      data[p] = Math.min(255, Math.max(0, r));
      data[p + 1] = Math.min(255, Math.max(0, g));
      data[p + 2] = Math.min(255, Math.max(0, b));
      data[p + 3] = 240;
    }
  }
  return makeImageData(w, h, data);
}

describe('KM-T014 Real Computational Photography Engine (9 Pro Photo Tools)', () => {
  beforeEach(() => {
    useMediaStore.getState().clearMedia();
  });

  it('increases Laplacian edge sharpness by > +15% for Pertajam Foto, Hilangkan Blur, and Kurangi Blur Gerak', () => {
    const soft = makeSoftStepTarget(48, 48);
    const lapSoftBefore = computeLaplacianEnergy(soft);

    const sharpened = cloneImageData(soft);
    applyProPhotoTool(sharpened, 'sharpen', 80);
    const lapSharpened = computeLaplacianEnergy(sharpened);
    expect(lapSharpened).toBeGreaterThan(lapSoftBefore * 1.15);

    const deblurred = cloneImageData(soft);
    applyProPhotoTool(deblurred, 'deblur', 85);
    const lapDeblurred = computeLaplacianEnergy(deblurred);
    expect(lapDeblurred).toBeGreaterThan(lapSoftBefore * 1.15);

    const motion = makeMotionBlurredStripes(48, 48);
    const lapMotionBefore = computeLaplacianEnergy(motion);
    applyProPhotoTool(motion, 'remove-motion-blur', 85);
    const lapMotionAfter = computeLaplacianEnergy(motion);
    expect(lapMotionAfter).toBeGreaterThan(lapMotionBefore * 1.15);
  });

  it('increases RMS dynamic contrast on hazy imagery via Dark Channel Prior (Hilangkan Kabut)', () => {
    const w = 48;
    const h = 48;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const p = (y * w + x) * 4;
        const crisp = (x < 24 ? 50 : 190) + ((y % 8) - 4) * 5;
        // Simulate heavy atmospheric veil: 0.42 * crisp + 0.58 * 228
        data[p] = Math.round(0.42 * crisp + 0.58 * 228);
        data[p + 1] = Math.round(0.42 * crisp + 0.58 * 228);
        data[p + 2] = Math.round(0.42 * crisp + 0.58 * 232);
        data[p + 3] = 255;
      }
    }
    const hazy = makeImageData(w, h, data);
    const rmsBefore = computeRmsContrast(hazy);
    applyProPhotoTool(hazy, 'dehaze', 85);
    const rmsAfter = computeRmsContrast(hazy);
    expect(rmsAfter).toBeGreaterThan(rmsBefore * 1.35);
  });

  it('smooths flat-region noise while preserving strong edges (Poles & Haluskan)', () => {
    const w = 48;
    const h = 48;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const p = (y * w + x) * 4;
        if (x < 24) {
          // Flat region + high-frequency grain (+-14)
          const noise = ((x * 17 + y * 31) % 29) - 14;
          const v = 140 + noise;
          data[p] = v;
          data[p + 1] = v;
          data[p + 2] = v;
        } else {
          // Crisp vertical step edge at x=36
          const v = x < 36 ? 60 : 210;
          data[p] = v;
          data[p + 1] = v;
          data[p + 2] = v;
        }
        data[p + 3] = 255;
      }
    }

    const img = makeImageData(w, h, data);
    const flatVariance = (buf: Uint8ClampedArray) => {
      let sum = 0;
      let cnt = 0;
      for (let y = 4; y < h - 4; y += 1) {
        for (let x = 4; x < 20; x += 1) {
          sum += buf[(y * w + x) * 4];
          cnt += 1;
        }
      }
      const mean = sum / cnt;
      let vSum = 0;
      for (let y = 4; y < h - 4; y += 1) {
        for (let x = 4; x < 20; x += 1) {
          const d = buf[(y * w + x) * 4] - mean;
          vSum += d * d;
        }
      }
      return vSum / cnt;
    };

    const varBefore = flatVariance(img.data);
    const edgeStepBefore = Math.abs(
      img.data[(24 * w + 37) * 4] - img.data[(24 * w + 34) * 4]
    );

    applyProPhotoTool(img, 'retouch', 85);

    const varAfter = flatVariance(img.data);
    const edgeStepAfter = Math.abs(
      img.data[(24 * w + 37) * 4] - img.data[(24 * w + 34) * 4]
    );
    expect(varAfter).toBeLessThan(varBefore * 0.65);
    expect(edgeStepAfter).toBeGreaterThan(edgeStepBefore * 0.85);
  });

  it('recovers faded dynamic range, reduces yellow/sepia cast, and cleans dust specks (Pulihkan Foto Lama)', () => {
    const w = 48;
    const h = 48;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const p = (y * w + x) * 4;
        const t = x / (w - 1);
        // Faded low-contrast sepia cast (warm R+G, weak compressed B)
        data[p] = Math.round(140 + t * 38);
        data[p + 1] = Math.round(122 + t * 34);
        data[p + 2] = Math.round(86 + t * 24);
        data[p + 3] = 255;
      }
    }
    // Single-pixel white dust impulse at (24, 24)
    const dustP = (24 * w + 24) * 4;
    const neighborR = data[(24 * w + 23) * 4];
    data[dustP] = 255;
    data[dustP + 1] = 255;
    data[dustP + 2] = 255;

    const aged = makeImageData(w, h, data);
    const stats = (buf: Uint8ClampedArray) => {
      let minL = 255;
      let maxL = 0;
      let sumR = 0;
      let sumB = 0;
      const count = w * h;
      for (let i = 0; i < count; i += 1) {
        const p = i * 4;
        const l = 0.2126 * buf[p] + 0.7152 * buf[p + 1] + 0.0722 * buf[p + 2];
        if (i !== 24 * w + 24) {
          if (l < minL) minL = l;
          if (l > maxL) maxL = l;
        }
        sumR += buf[p];
        sumB += buf[p + 2];
      }
      return {
        range: maxL - minL,
        sepiaCast: Math.abs(sumR / count - sumB / count),
        dustGap: Math.abs(buf[dustP] - buf[(24 * w + 23) * 4]),
      };
    };

    const before = stats(aged.data);
    applyProPhotoTool(aged, 'restore', 85);
    const after = stats(aged.data);

    expect(neighborR).toBeLessThan(200);
    expect(after.range).toBeGreaterThan(before.range * 1.8);
    expect(after.sepiaCast).toBeLessThan(before.sepiaCast * 0.5);
    expect(after.dustGap).toBeLessThan(before.dustGap * 0.45);
  });

  it('introduces real RGB chrominance on pure grayscale imagery across all 3 profiles (Warnai Foto)', () => {
    const w = 48;
    const h = 48;
    const bwData = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const p = (y * w + x) * 4;
        // Upper sky luma + middle portrait midtone + dark foreground
        const v = y < 16 ? 190 : y < 34 ? 142 : 55;
        bwData[p] = v;
        bwData[p + 1] = v;
        bwData[p + 2] = v;
        bwData[p + 3] = 255;
      }
    }

    const bwImg = makeImageData(w, h, bwData);
    const outputs = new Map<ColouriseToneProfile, Uint8ClampedArray>();

    for (const opt of COLOURISE_PROFILE_OPTIONS) {
      const copy = cloneImageData(bwImg);
      applyProPhotoTool(copy, 'colourise', 85, opt.id);
      let chromaSum = 0;
      for (let i = 0; i < copy.data.length; i += 4) {
        chromaSum +=
          Math.abs(copy.data[i] - copy.data[i + 1]) +
          Math.abs(copy.data[i + 1] - copy.data[i + 2]);
        expect(copy.data[i + 3]).toBe(255);
      }
      const meanChroma = chromaSum / (w * h);
      expect(meanChroma).toBeGreaterThan(8);
      outputs.set(opt.id, copy.data);
    }

    // All 3 tone profiles must differ from each other
    const pIds = COLOURISE_PROFILE_OPTIONS.map((o) => o.id);
    for (let i = 0; i < pIds.length; i += 1) {
      for (let j = i + 1; j < pIds.length; j += 1) {
        const a = outputs.get(pIds[i])!;
        const b = outputs.get(pIds[j])!;
        let diff = 0;
        for (let k = 0; k < a.length; k += 4) {
          diff += Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]);
        }
        expect(diff).toBeGreaterThan(500);
      }
    }
  });

  it('enhances & restores facial skin smoothness and eye contrast distinctly (Perjelas Wajah & Restorasi Wajah)', () => {
    const portrait = makePortraitComposite(48, 48);

    const skinMeanLuma = (buf: Uint8ClampedArray) => {
      let s = 0;
      let c = 0;
      for (let y = 10; y < 16; y += 1) {
        for (let x = 14; x < 34; x += 1) {
          const p = (y * 48 + x) * 4;
          s += 0.2126 * buf[p] + 0.7152 * buf[p + 1] + 0.0722 * buf[p + 2];
          c += 1;
        }
      }
      return s / c;
    };

    const enh = cloneImageData(portrait);
    applyProPhotoTool(enh, 'enhance-face', 85);
    expect(skinMeanLuma(enh.data)).toBeGreaterThan(skinMeanLuma(portrait.data));
    // Cool slate outer background corner remains nearly untouched
    expect(Math.abs(enh.data[0] - portrait.data[0])).toBeLessThanOrEqual(2);

    const restored = cloneImageData(portrait);
    applyProPhotoTool(restored, 'face-restoration', 85);
    expect(computeLaplacianEnergy(restored)).toBeGreaterThan(computeLaplacianEnergy(portrait));

    let pairDiff = 0;
    for (let i = 0; i < enh.data.length; i += 4) {
      pairDiff +=
        Math.abs(enh.data[i] - restored.data[i]) +
        Math.abs(enh.data[i + 1] - restored.data[i + 1]) +
        Math.abs(enh.data[i + 2] - restored.data[i + 2]);
      expect(enh.data[i + 3]).toBe(250);
      expect(restored.data[i + 3]).toBe(250);
    }
    expect(pairDiff).toBeGreaterThan(500);
  });

  it('produces 36 pairwise distinct outputs, obeys 0% identity & monotonic strength scaling, and persists store history', () => {
    expect(PRO_PHOTO_TOOL_IDS.length).toBe(9);
    const base = makeRichTestComposite(48, 48);

    const outputs = new Map<ProPhotoToolId, Uint8ClampedArray>();
    for (const toolId of PRO_PHOTO_TOOL_IDS) {
      // Strength 0% must preserve pixels verbatim
      const zeroImg = cloneImageData(base);
      applyProPhotoTool(zeroImg, toolId, 0);
      expect(Buffer.from(zeroImg.data).equals(Buffer.from(base.data))).toBe(true);

      // 50% vs 100% scaling
      const img50 = cloneImageData(base);
      const img100 = cloneImageData(base);
      applyProPhotoTool(img50, toolId, 50);
      applyProPhotoTool(img100, toolId, 100);
      let d50 = 0;
      let d100 = 0;
      for (let i = 0; i < base.data.length; i += 4) {
        d50 +=
          Math.abs(img50.data[i] - base.data[i]) +
          Math.abs(img50.data[i + 1] - base.data[i + 1]) +
          Math.abs(img50.data[i + 2] - base.data[i + 2]);
        d100 +=
          Math.abs(img100.data[i] - base.data[i]) +
          Math.abs(img100.data[i + 1] - base.data[i + 1]) +
          Math.abs(img100.data[i + 2] - base.data[i + 2]);
        expect(img100.data[i + 3]).toBe(240);
      }
      expect(d50).toBeGreaterThan(0);
      expect(d100).toBeGreaterThan(d50);

      const default80 = cloneImageData(base);
      applyProPhotoTool(default80, toolId, 80);
      outputs.set(toolId, default80.data);
    }

    // All 36 pairs across the 9 tools must differ measurably
    for (let i = 0; i < PRO_PHOTO_TOOL_IDS.length; i += 1) {
      for (let j = i + 1; j < PRO_PHOTO_TOOL_IDS.length; j += 1) {
        const a = outputs.get(PRO_PHOTO_TOOL_IDS[i])!;
        const b = outputs.get(PRO_PHOTO_TOOL_IDS[j])!;
        let pairDiff = 0;
        for (let k = 0; k < a.length; k += 4) {
          pairDiff += Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]);
        }
        expect(pairDiff).toBeGreaterThan(0);
      }
    }

    // Multi-tool composition & store history persistence
    const multi = cloneImageData(base);
    applyProPhotoToolsPass(multi, ['dehaze', 'sharpen'], 80, 'nature-sky');
    expect(Buffer.from(multi.data).equals(Buffer.from(base.data))).toBe(false);

    const store = useMediaStore.getState();
    store.updateImageEdit(
      { proTools: ['dehaze', 'sharpen'], proToolStrength: 90, colouriseProfile: 'nature-sky' },
      { commitHistory: true, preservePreset: true }
    );
    expect(useMediaStore.getState().imageEdit.proTools).toEqual(['dehaze', 'sharpen']);
    expect(getActiveImageModuleLabels(useMediaStore.getState().imageEdit)).toContain('Hilangkan Kabut');

    store.setPreset('instagram-story');
    expect(useMediaStore.getState().imageEdit.proTools).toEqual(['dehaze', 'sharpen']);

    store.undoPhotoEdit();
    expect(useMediaStore.getState().imageEdit.proTools).toEqual(['dehaze', 'sharpen']);
    store.resetPhotoEdits();
    expect(useMediaStore.getState().imageEdit.proTools).toEqual([]);
  });
});
