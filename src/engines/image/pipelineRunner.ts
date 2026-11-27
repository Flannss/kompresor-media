import type {
  ImageEditState,
  ImageOutputFormat,
  PhotoTargetResolution,
} from '../contracts';
import { applyPhotoFilterToImageData } from '../grading/photoFilters';
import {
  applyColorGradeToImageData,
  hasActiveColorGrade,
} from '../shared/colorGrades';
import {
  applyClarity,
  applyColorAdjustments,
  applyEdgePreservingDenoiseParams,
  applyQualityModelPass,
  applySharpen,
  computeCropPixels,
  computePhotoTargetDimensions,
  computeProgressiveSteps,
  computeRotatedDimensions,
  computeStraightenScale,
  computeTargetDimensions,
  type PhotoCanvasGuardrails,
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
  clampedByMemoryGuard?: boolean;
  appliedTargetResolution?: PhotoTargetResolution;
}

/** Explicitly releases backing GPU/RAM memory allocated for temporary Canvas/OffscreenCanvas buffers (critical for iOS Safari caps). */
export function releaseCanvasSurface(
  canvas: { width: number; height: number } | null | undefined
): void {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // Ignore read-only mock surfaces in unit tests
  }
}

function drawOrientedAndFlipped<TCanvas extends CanvasSurfaceLike>(
  bitmap: ImageBitmap,
  edit: Pick<ImageEditState, 'rotationDeg' | 'straightenDeg' | 'flipH' | 'flipV'>,
  adapter: CanvasAdapter<TCanvas>
): TCanvas {
  const rotDims = computeRotatedDimensions(bitmap.width, bitmap.height, edit.rotationDeg);
  const canvas = adapter.createCanvas(rotDims.width, rotDims.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    releaseCanvasSurface(canvas);
    throw new Error('Gagal menyiapkan kanvas untuk memproses foto.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const straightenDeg = edit.straightenDeg ?? 0;
  const straightenScale = computeStraightenScale(rotDims.width, rotDims.height, straightenDeg);

  ctx.save();
  ctx.translate(rotDims.width / 2, rotDims.height / 2);
  if (straightenDeg !== 0) {
    ctx.rotate((straightenDeg * Math.PI) / 180);
    ctx.scale(straightenScale, straightenScale);
  }
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
      if (currentCanvas !== sourceCanvas) {
        releaseCanvasSurface(currentCanvas);
      }
      releaseCanvasSurface(nextCanvas);
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
    const prev = currentCanvas;
    currentCanvas = nextCanvas;
    if (prev !== sourceCanvas) {
      releaseCanvasSurface(prev);
    }
  }

  return currentCanvas;
}

async function solveTargetSize<TCanvas extends CanvasSurfaceLike>(
  canvas: TCanvas,
  format: ImageOutputFormat,
  targetSizeKB: number,
  initialQuality: number,
  adapter: CanvasAdapter<TCanvas>,
  allowDimensionShrink = true
): Promise<PipelineOutput> {
  const targetBytes = Math.max(16 * 1024, Math.round(targetSizeKB * 1024));
  const clampedInitial = Math.min(1, Math.max(0.25, initialQuality));

  let workingCanvas = canvas;

  try {
    const firstCandidate = await adapter.encodeBlob(workingCanvas, format, clampedInitial);
    if (firstCandidate.size <= targetBytes) {
      return {
        blob: firstCandidate,
        width: workingCanvas.width,
        height: workingCanvas.height,
        solvedQuality: clampedInitial,
        targetSizeMet: true,
      };
    }

    const maxScaleAttempts = allowDimensionShrink ? 4 : 1;
    for (let scaleAttempt = 0; scaleAttempt < maxScaleAttempts; scaleAttempt += 1) {
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
      if (!allowDimensionShrink || longest <= 320 || scaleAttempt === maxScaleAttempts - 1) {
        const chosen =
          minQualityBlob.size <= (smallestBlob?.size ?? Infinity) ? minQualityBlob : smallestBlob!;
        const chosenQ =
          minQualityBlob.size <= (smallestBlob?.size ?? Infinity) ? 0.25 : smallestQuality;
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
      const resized = resizeCanvas(workingCanvas, nextW, nextH, adapter);
      if (resized !== workingCanvas && workingCanvas !== canvas) {
        releaseCanvasSurface(workingCanvas);
      }
      workingCanvas = resized;
    }

    const fallbackBlob = await adapter.encodeBlob(workingCanvas, format, 0.25);
    return {
      blob: fallbackBlob,
      width: workingCanvas.width,
      height: workingCanvas.height,
      solvedQuality: 0.25,
      targetSizeMet: fallbackBlob.size <= targetBytes,
    };
  } finally {
    if (workingCanvas !== canvas) {
      releaseCanvasSurface(workingCanvas);
    }
  }
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
  previewMaxEdgePx?: number,
  guard?: PhotoCanvasGuardrails
): Promise<PipelineOutput> {
  let currentCanvas = drawOrientedAndFlipped(bitmap, edit, adapter);

  try {
    if (edit.crop) {
      const { sx, sy, sw, sh } = computeCropPixels(
        currentCanvas.width,
        currentCanvas.height,
        edit.crop
      );
      const croppedCanvas = adapter.createCanvas(sw, sh);
      const cropCtx = croppedCanvas.getContext('2d');
      if (!cropCtx) {
        releaseCanvasSurface(croppedCanvas);
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
      releaseCanvasSurface(currentCanvas);
      currentCanvas = croppedCanvas;
    }

    const preResizeW = currentCanvas.width;
    const targetPlan = computePhotoTargetDimensions(
      currentCanvas.width,
      currentCanvas.height,
      edit,
      guard
    );

    const intendedUpscaleRatio = targetPlan.width / Math.max(1, preResizeW);

    let targetDims = { width: targetPlan.width, height: targetPlan.height };
    if (previewMaxEdgePx && previewMaxEdgePx > 0) {
      targetDims = computeTargetDimensions(targetDims.width, targetDims.height, previewMaxEdgePx);
    }

    const resized = resizeCanvas(currentCanvas, targetDims.width, targetDims.height, adapter);
    if (resized !== currentCanvas) {
      releaseCanvasSurface(currentCanvas);
      currentCanvas = resized;
    }

    const effectiveSharpen = getEffectiveSharpenAmount(edit);
    const hasAdjustments =
      edit.adjustments.brightness !== 0 ||
      edit.adjustments.contrast !== 0 ||
      edit.adjustments.highlights !== 0 ||
      edit.adjustments.shadows !== 0 ||
      edit.adjustments.clarity !== 0 ||
      edit.adjustments.vignette !== 0 ||
      edit.adjustments.saturation !== 0 ||
      edit.adjustments.vibrance !== 0 ||
      edit.adjustments.temperature !== 0 ||
      edit.adjustments.tint !== 0;

    const modelStrength = edit.qualityModelStrength ?? 80;
    const needsQualityModelPass =
      modelStrength > 0 ||
      intendedUpscaleRatio > 1.05 ||
      targetPlan.appliedTargetResolution !== 'original';

    const needsPixelPass =
      hasAdjustments ||
      (edit.photoFilterId !== 'original' && edit.photoFilterIntensity > 0) ||
      hasActiveColorGrade(edit.colorGrade) ||
      edit.denoiseAmount > 0 ||
      effectiveSharpen > 0 ||
      needsQualityModelPass ||
      edit.enhanceSuite.noise.enabled ||
      edit.enhanceSuite.colorContrast.enabled;

    if (needsPixelPass) {
      const ctx = currentCanvas.getContext('2d');
      if (ctx) {
        const imgData = ctx.getImageData(0, 0, currentCanvas.width, currentCanvas.height);

        if (edit.denoiseAmount > 0) {
          const grainStrength = (edit.denoiseAmount / 100) * 8;
          const colorSmooth = Math.max(2, Math.round((edit.denoiseAmount / 100) * 6));
          applyEdgePreservingDenoiseParams(imgData, grainStrength, colorSmooth);
        } else if (edit.enhanceSuite.noise.enabled) {
          applyEdgePreservingDenoiseParams(
            imgData,
            edit.enhanceSuite.noise.grainStrength,
            edit.enhanceSuite.noise.colorSmooth
          );
        }

        applyColorAdjustments(imgData, edit.adjustments);
        if (edit.adjustments.clarity !== 0) {
          applyClarity(imgData, edit.adjustments.clarity);
        }

        if (edit.photoFilterId !== 'original' && edit.photoFilterIntensity > 0) {
          applyPhotoFilterToImageData(
            imgData,
            edit.photoFilterId,
            edit.photoFilterIntensity
          );
        }

        if (hasActiveColorGrade(edit.colorGrade) || edit.enhanceSuite.colorContrast.enabled) {
          applyColorGradeToImageData(
            imgData,
            edit.colorGrade,
            edit.enhanceSuite.colorContrast.enabled ? edit.enhanceSuite.colorContrast : undefined
          );
        }

        if (needsQualityModelPass) {
          applyQualityModelPass(
            imgData,
            edit.qualityModel,
            intendedUpscaleRatio,
            modelStrength,
            targetPlan.appliedTargetResolution
          );
        }

        applySharpen(imgData, effectiveSharpen, edit.enhanceSuite.sharpen.antiArtifact);
        ctx.putImageData(imgData, 0, 0);
      }
    }

    if (edit.targetSizeKB !== null && edit.outputFormat !== 'image/png') {
      const allowShrink = targetPlan.appliedTargetResolution === 'original';
      const sizedOut = await solveTargetSize(
        currentCanvas,
        edit.outputFormat,
        edit.targetSizeKB,
        edit.quality,
        adapter,
        allowShrink
      );
      return {
        ...sizedOut,
        clampedByMemoryGuard: targetPlan.clampedByMemoryGuard,
        appliedTargetResolution: targetPlan.appliedTargetResolution,
      };
    }

    const outW = currentCanvas.width;
    const outH = currentCanvas.height;
    const clampedQuality = Math.min(1, Math.max(0.1, edit.quality));
    const blob = await adapter.encodeBlob(
      currentCanvas,
      edit.outputFormat,
      edit.outputFormat === 'image/png' ? undefined : clampedQuality
    );

    return {
      blob,
      width: outW,
      height: outH,
      clampedByMemoryGuard: targetPlan.clampedByMemoryGuard,
      appliedTargetResolution: targetPlan.appliedTargetResolution,
    };
  } finally {
    releaseCanvasSurface(currentCanvas);
  }
}

/**
 * Generates ONE tiny 96px base thumbnail Blob. All filter cards apply GPU CSS filters
 * directly on this single shared thumbnail, avoiding multiple heavy Canvas pixel loops.
 */
export async function runBaseThumbnailPipeline<TCanvas extends CanvasSurfaceLike>(
  bitmap: ImageBitmap,
  adapter: CanvasAdapter<TCanvas>
): Promise<Blob> {
  const thumbDims = computeTargetDimensions(bitmap.width, bitmap.height, 96);
  const baseCanvas = adapter.createCanvas(thumbDims.width, thumbDims.height);
  try {
    const baseCtx = baseCanvas.getContext('2d');
    if (!baseCtx) {
      throw new Error('Gagal membuat pratinjau filter.');
    }
    baseCtx.imageSmoothingEnabled = true;
    baseCtx.imageSmoothingQuality = 'medium';
    baseCtx.drawImage(bitmap, 0, 0, thumbDims.width, thumbDims.height);
    return await adapter.encodeBlob(baseCanvas, 'image/jpeg', 0.78);
  } finally {
    releaseCanvasSurface(baseCanvas);
  }
}
