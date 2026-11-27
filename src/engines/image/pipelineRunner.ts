import type { ColorGradeId, ImageEditState, ImageOutputFormat } from '../contracts';
import {
  applyColorGradeToImageData,
  COLOR_GRADE_PRESETS,
  compute1080pTargetDimensions,
  hasActiveColorGrade,
} from '../shared/colorGrades';
import {
  applyColorAdjustments,
  applyEdgePreservingDenoiseParams,
  applySharpen,
  computeCropPixels,
  computeProgressiveSteps,
  computeRotatedDimensions,
  computeTargetDimensions,
} from './pixelOps';

export interface Canvas2DContextLike {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  drawImage(
    image: CanvasImageSource,
    sxOrDx: number,
    syOrDy: number,
    swOrDw?: number,
    shOrDh?: number,
    dx?: number,
    dy?: number,
    dw?: number,
    dh?: number
  ): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
  putImageData(imageData: ImageData, dx: number, dy: number): void;
}

export interface CanvasSurfaceLike {
  width: number;
  height: number;
  getContext(type: '2d'): Canvas2DContextLike | null;
}

export interface CanvasAdapter<TCanvas extends CanvasSurfaceLike> {
  createCanvas(width: number, height: number): TCanvas;
  encodeBlob(canvas: TCanvas, format: ImageOutputFormat, quality?: number): Promise<Blob>;
}

export interface PipelineOutput {
  blob: Blob;
  width: number;
  height: number;
  solvedQuality?: number;
  targetSizeMet?: boolean;
}

export interface ThumbnailOutputItem {
  gradeId: ColorGradeId;
  blob: Blob;
}

function drawOrientedAndFlipped<TCanvas extends CanvasSurfaceLike>(
  bitmap: ImageBitmap,
  edit: Pick<ImageEditState, 'rotationDeg' | 'flipH' | 'flipV'>,
  adapter: CanvasAdapter<TCanvas>
): TCanvas {
  const rotDims = computeRotatedDimensions(bitmap.width, bitmap.height, edit.rotationDeg);
  const canvas = adapter.createCanvas(rotDims.width, rotDims.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Gagal menyiapkan kanvas untuk memproses foto.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.save();
  ctx.translate(rotDims.width / 2, rotDims.height / 2);
  if (edit.rotationDeg !== 0) {
    ctx.rotate((edit.rotationDeg * Math.PI) / 180);
  }
  if (edit.flipH || edit.flipV) {
    ctx.scale(edit.flipH ? -1 : 1, edit.flipV ? -1 : 1);
  }
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  ctx.restore();

  return canvas;
}

function resizeCanvas<TCanvas extends CanvasSurfaceLike>(
  sourceCanvas: TCanvas,
  targetWidth: number,
  targetHeight: number,
  adapter: CanvasAdapter<TCanvas>
): TCanvas {
  if (sourceCanvas.width === targetWidth && sourceCanvas.height === targetHeight) {
    return sourceCanvas;
  }

  let currentCanvas = sourceCanvas;
  const steps = computeProgressiveSteps(
    currentCanvas.width,
    currentCanvas.height,
    targetWidth,
    targetHeight
  );

  for (const step of steps) {
    if (step.width === currentCanvas.width && step.height === currentCanvas.height) {
      continue;
    }
    const nextCanvas = adapter.createCanvas(step.width, step.height);
    const nextCtx = nextCanvas.getContext('2d');
    if (!nextCtx) {
      throw new Error('Gagal mengubah ukuran foto.');
    }
    nextCtx.imageSmoothingEnabled = true;
    nextCtx.imageSmoothingQuality = 'high';
    nextCtx.drawImage(
      currentCanvas as unknown as CanvasImageSource,
      0,
      0,
      step.width,
      step.height
    );
    currentCanvas = nextCanvas;
  }

  return currentCanvas;
}

async function solveTargetSize<TCanvas extends CanvasSurfaceLike>(
  canvas: TCanvas,
  format: ImageOutputFormat,
  targetSizeKB: number,
  initialQuality: number,
  adapter: CanvasAdapter<TCanvas>
): Promise<PipelineOutput> {
  const targetBytes = Math.max(16 * 1024, Math.round(targetSizeKB * 1024));
  const clampedInitial = Math.min(1, Math.max(0.25, initialQuality));

  // Fast path: if encoding at requested quality already fits target limit, return immediately
  const firstCandidate = await adapter.encodeBlob(canvas, format, clampedInitial);
  if (firstCandidate.size <= targetBytes) {
    return {
      blob: firstCandidate,
      width: canvas.width,
      height: canvas.height,
      solvedQuality: clampedInitial,
      targetSizeMet: true,
    };
  }

  let workingCanvas = canvas;

  for (let scaleAttempt = 0; scaleAttempt < 4; scaleAttempt += 1) {
    let low = 0.25;
    let high = Math.max(0.3, clampedInitial);
    let bestFittingBlob: Blob | null = null;
    let bestFittingQuality = low;
    let smallestBlob: Blob | null = scaleAttempt === 0 ? firstCandidate : null;
    let smallestQuality = clampedInitial;

    for (let iter = 0; iter < 6; iter += 1) {
      const mid = Number(((low + high) / 2).toFixed(3));
      const candidate = await adapter.encodeBlob(workingCanvas, format, mid);

      if (!smallestBlob || candidate.size < smallestBlob.size) {
        smallestBlob = candidate;
        smallestQuality = mid;
      }

      if (candidate.size <= targetBytes) {
        bestFittingBlob = candidate;
        bestFittingQuality = mid;
        low = mid;
      } else {
        high = mid;
      }

      if (high - low < 0.04) {
        break;
      }
    }

    if (bestFittingBlob) {
      return {
        blob: bestFittingBlob,
        width: workingCanvas.width,
        height: workingCanvas.height,
        solvedQuality: bestFittingQuality,
        targetSizeMet: true,
      };
    }

    const minQualityBlob = await adapter.encodeBlob(workingCanvas, format, 0.25);
    if (minQualityBlob.size <= targetBytes) {
      return {
        blob: minQualityBlob,
        width: workingCanvas.width,
        height: workingCanvas.height,
        solvedQuality: 0.25,
        targetSizeMet: true,
      };
    }

    const longest = Math.max(workingCanvas.width, workingCanvas.height);
    if (longest <= 320 || scaleAttempt === 3) {
      const chosen = minQualityBlob.size <= (smallestBlob?.size ?? Infinity) ? minQualityBlob : smallestBlob!;
      const chosenQ = minQualityBlob.size <= (smallestBlob?.size ?? Infinity) ? 0.25 : smallestQuality;
      return {
        blob: chosen,
        width: workingCanvas.width,
        height: workingCanvas.height,
        solvedQuality: chosenQ,
        targetSizeMet: chosen.size <= targetBytes,
      };
    }

    const nextW = Math.max(1, Math.round(workingCanvas.width * 0.85));
    const nextH = Math.max(1, Math.round(workingCanvas.height * 0.85));
    workingCanvas = resizeCanvas(workingCanvas, nextW, nextH, adapter);
  }

  const fallbackBlob = await adapter.encodeBlob(workingCanvas, format, 0.25);
  return {
    blob: fallbackBlob,
    width: workingCanvas.width,
    height: workingCanvas.height,
    solvedQuality: 0.25,
    targetSizeMet: fallbackBlob.size <= targetBytes,
  };
}

function getEffectiveSharpenAmount(edit: ImageEditState): number {
  if (!edit.enhanceSuite.sharpen.enabled) {
    return edit.sharpenAmount;
  }
  const enhanceBonus = Math.round(edit.enhanceSuite.sharpen.strength * 28);
  return Math.min(100, edit.sharpenAmount + enhanceBonus);
}

export async function runImagePipeline<TCanvas extends CanvasSurfaceLike>(
  bitmap: ImageBitmap,
  edit: ImageEditState,
  adapter: CanvasAdapter<TCanvas>,
  previewMaxEdgePx?: number
): Promise<PipelineOutput> {
  let currentCanvas = drawOrientedAndFlipped(bitmap, edit, adapter);

  if (edit.crop) {
    const { sx, sy, sw, sh } = computeCropPixels(
      currentCanvas.width,
      currentCanvas.height,
      edit.crop
    );
    const croppedCanvas = adapter.createCanvas(sw, sh);
    const cropCtx = croppedCanvas.getContext('2d');
    if (!cropCtx) {
      throw new Error('Gagal memotong area foto.');
    }
    cropCtx.imageSmoothingEnabled = true;
    cropCtx.imageSmoothingQuality = 'high';
    cropCtx.drawImage(
      currentCanvas as unknown as CanvasImageSource,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      sw,
      sh
    );
    currentCanvas = croppedCanvas;
  }

  let targetDims = edit.enhanceSuite.upscale1080.enabled
    ? compute1080pTargetDimensions(
        currentCanvas.width,
        currentCanvas.height,
        edit.enhanceSuite.upscale1080.keepAspect
      )
    : computeTargetDimensions(currentCanvas.width, currentCanvas.height, edit.maxEdgePx);

  if (previewMaxEdgePx && previewMaxEdgePx > 0) {
    targetDims = computeTargetDimensions(targetDims.width, targetDims.height, previewMaxEdgePx);
  }

  currentCanvas = resizeCanvas(currentCanvas, targetDims.width, targetDims.height, adapter);

  const effectiveSharpen = getEffectiveSharpenAmount(edit);
  const needsPixelPass =
    edit.adjustments.brightness !== 0 ||
    edit.adjustments.contrast !== 0 ||
    edit.adjustments.saturation !== 0 ||
    edit.adjustments.temperature !== 0 ||
    hasActiveColorGrade(edit.colorGrade) ||
    effectiveSharpen > 0 ||
    edit.enhanceSuite.noise.enabled ||
    edit.enhanceSuite.colorContrast.enabled;

  if (needsPixelPass) {
    const ctx = currentCanvas.getContext('2d');
    if (ctx) {
      const imgData = ctx.getImageData(0, 0, currentCanvas.width, currentCanvas.height);
      if (edit.enhanceSuite.noise.enabled) {
        applyEdgePreservingDenoiseParams(
          imgData,
          edit.enhanceSuite.noise.grainStrength,
          edit.enhanceSuite.noise.colorSmooth
        );
      }
      applyColorAdjustments(imgData, edit.adjustments);
      applyColorGradeToImageData(
        imgData,
        edit.colorGrade,
        edit.enhanceSuite.colorContrast.enabled ? edit.enhanceSuite.colorContrast : undefined
      );
      applySharpen(imgData, effectiveSharpen, edit.enhanceSuite.sharpen.antiArtifact);
      ctx.putImageData(imgData, 0, 0);
    }
  }

  if (edit.targetSizeKB !== null && edit.outputFormat !== 'image/png') {
    return solveTargetSize(
      currentCanvas,
      edit.outputFormat,
      edit.targetSizeKB,
      edit.quality,
      adapter
    );
  }

  const clampedQuality = Math.min(1, Math.max(0.1, edit.quality));
  const blob = await adapter.encodeBlob(
    currentCanvas,
    edit.outputFormat,
    edit.outputFormat === 'image/png' ? undefined : clampedQuality
  );

  return {
    blob,
    width: currentCanvas.width,
    height: currentCanvas.height,
  };
}

export async function runThumbnailPipeline<TCanvas extends CanvasSurfaceLike>(
  bitmap: ImageBitmap,
  adapter: CanvasAdapter<TCanvas>
): Promise<ThumbnailOutputItem[]> {
  const thumbDims = computeTargetDimensions(bitmap.width, bitmap.height, 160);
  const baseCanvas = adapter.createCanvas(thumbDims.width, thumbDims.height);
  const baseCtx = baseCanvas.getContext('2d');
  if (!baseCtx) {
    throw new Error('Gagal membuat pratinjau filter.');
  }
  baseCtx.imageSmoothingEnabled = true;
  baseCtx.imageSmoothingQuality = 'medium';
  baseCtx.drawImage(bitmap, 0, 0, thumbDims.width, thumbDims.height);
  const basePixels = baseCtx.getImageData(0, 0, thumbDims.width, thumbDims.height);

  const items: ThumbnailOutputItem[] = [];
  for (const preset of COLOR_GRADE_PRESETS) {
    const workCanvas = adapter.createCanvas(thumbDims.width, thumbDims.height);
    const workCtx = workCanvas.getContext('2d');
    if (!workCtx) {
      continue;
    }
    const copy = new ImageData(
      new Uint8ClampedArray(basePixels.data),
      basePixels.width,
      basePixels.height
    );
    applyColorGradeToImageData(copy, {
      gradeId: preset.id,
      intensity: 100,
      tone: { temperature: 0, tint: 0, shadows: 0, highlights: 0 },
    });
    workCtx.putImageData(copy, 0, 0);
    const blob = await adapter.encodeBlob(workCanvas, 'image/jpeg', 0.8);
    items.push({ gradeId: preset.id, blob });
  }

  return items;
}
