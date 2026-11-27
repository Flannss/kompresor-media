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
import {
  applyPostUpscaleProSharpen,
  applyPreUpscaleProToolsPass,
} from './proTools';

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
  adapter: CanvasAdapter<TCanvas>,
  maxCanvasPixels?: number
): TCanvas {
  if (!Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height) || bitmap.width <= 0 || bitmap.height <= 0) {
    throw new Error('Dimensi gambar sumber tidak valid.');
  }
  const rotDims = computeRotatedDimensions(bitmap.width, bitmap.height, edit.rotationDeg);
  let targetW = rotDims.width;
  let targetH = rotDims.height;
  // Cap oversized initial decode canvas (e.g., 48MP+ camera photos) inside hardware RAM bounds
  if (maxCanvasPixels && maxCanvasPixels > 0 && targetW * targetH > maxCanvasPixels) {
    const preScale = Math.sqrt(maxCanvasPixels / (targetW * targetH));
    targetW = Math.max(1, Math.floor(targetW * preScale));
    targetH = Math.max(1, Math.floor(targetH * preScale));
  }

  const canvas = adapter.createCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    releaseCanvasSurface(canvas);
    throw new Error('Gagal menyiapkan kanvas untuk memproses foto.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const straightenDeg = edit.straightenDeg ?? 0;
  const straightenScale = computeStraightenScale(targetW, targetH, straightenDeg);
  const drawScaleX = targetW / rotDims.width;
  const drawScaleY = targetH / rotDims.height;

  ctx.save();
  ctx.translate(targetW / 2, targetH / 2);
  if (straightenDeg !== 0) {
    ctx.rotate((straightenDeg * Math.PI) / 180);
    ctx.scale(straightenScale, straightenScale);
  }
  ctx.scale(drawScaleX, drawScaleY);
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
  let currentCanvas = drawOrientedAndFlipped(bitmap, edit, adapter, guard?.maxCanvasPixels);

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
    const preResizeH = currentCanvas.height;
    const targetPlan = computePhotoTargetDimensions(
      preResizeW,
      preResizeH,
      edit,
      guard
    );

    const intendedUpscaleRatio = targetPlan.width / Math.max(1, preResizeW);

    let targetDims = { width: targetPlan.width, height: targetPlan.height };
    if (previewMaxEdgePx && previewMaxEdgePx > 0) {
      targetDims = computeTargetDimensions(targetDims.width, targetDims.height, previewMaxEdgePx);
    }

    const proToolStrength = edit.proToolStrength ?? 80;
    const activeProTools = edit.proTools ?? [];
    const preUpscaleTools = activeProTools.filter((t) => t !== 'sharpen');
    const hasPreUpscaleTools = preUpscaleTools.length > 0 && proToolStrength > 0;
    const hasPostProSharpen = activeProTools.includes('sharpen') && proToolStrength > 0;

    const modelStrength = edit.qualityModelStrength ?? 80;
    const wantsQualityModelDenoise =
      (edit.qualityModel === 'high-quality' || edit.qualityModel === 'ultra-detail') &&
      modelStrength > 0;
    const hasManualDenoise = edit.denoiseAmount > 0 || edit.enhanceSuite.noise.enabled;
    const needsPreUpscalePass = hasManualDenoise || hasPreUpscaleTools || wantsQualityModelDenoise;

    // 1. Optical Pre-Upscale Stage: run heavy O(N) restoration, dehaze, deblur, retouch,
    //    colourise, face recovery, and noise reduction BEFORE upscaling to 2K/3K/4K/8K.
    let ranPreDenoise = false;
    if (needsPreUpscalePass) {
      const isDownscaleOrSame =
        targetDims.width <= preResizeW && targetDims.height <= preResizeH;
      const preCapEdge = guard?.isMobileThermalGuard ? 2048 : 2560;
      const workingDims = isDownscaleOrSame
        ? targetDims
        : computeTargetDimensions(preResizeW, preResizeH, preCapEdge);

      if (workingDims.width !== currentCanvas.width || workingDims.height !== currentCanvas.height) {
        const preSized = resizeCanvas(currentCanvas, workingDims.width, workingDims.height, adapter);
        if (preSized !== currentCanvas) {
          releaseCanvasSurface(currentCanvas);
          currentCanvas = preSized;
        }
      }

      const preCtx = currentCanvas.getContext('2d');
      if (preCtx) {
        const preImgData = preCtx.getImageData(0, 0, currentCanvas.width, currentCanvas.height);

        if (edit.denoiseAmount > 0) {
          const grainStrength = (edit.denoiseAmount / 100) * 8;
          const colorSmooth = Math.max(2, Math.round((edit.denoiseAmount / 100) * 6));
          applyEdgePreservingDenoiseParams(preImgData, grainStrength, colorSmooth);
          ranPreDenoise = true;
        } else if (edit.enhanceSuite.noise.enabled) {
          applyEdgePreservingDenoiseParams(
            preImgData,
            edit.enhanceSuite.noise.grainStrength,
            edit.enhanceSuite.noise.colorSmooth
          );
          ranPreDenoise = true;
        } else if (wantsQualityModelDenoise) {
          const s = Math.min(1, Math.max(0, modelStrength / 100));
          const tierBonus =
            targetPlan.appliedTargetResolution === '8k'
              ? 0.72
              : targetPlan.appliedTargetResolution === '4k'
                ? 0.56
                : targetPlan.appliedTargetResolution === '3k'
                  ? 0.42
                  : targetPlan.appliedTargetResolution === '2k'
                    ? 0.28
                    : targetPlan.appliedTargetResolution === 'hd'
                      ? 0.14
                      : 0;
          const resBoost =
            tierBonus + Math.max(0, Math.min(0.6, (intendedUpscaleRatio - 1) * 0.35));
          if (edit.qualityModel === 'high-quality') {
            applyEdgePreservingDenoiseParams(
              preImgData,
              Math.max(1.2, (2.2 + resBoost * 1.4) * s),
              Math.max(2, Math.round(3.5 * s))
            );
          } else {
            applyEdgePreservingDenoiseParams(
              preImgData,
              Math.min(2.4, (1.4 + resBoost) * s),
              2
            );
          }
          ranPreDenoise = true;
        }

        if (hasPreUpscaleTools) {
          applyPreUpscaleProToolsPass(
            preImgData,
            preUpscaleTools,
            proToolStrength,
            edit.colouriseProfile ?? 'warm-portrait',
            Boolean(guard?.isMobileThermalGuard)
          );
        }

        preCtx.putImageData(preImgData, 0, 0);
      }
    }

    // 2. Stepped high-quality scaling (<= 1.5x per pass) to final target resolution (HD/2K/3K/4K/8K)
    if (currentCanvas.width !== targetDims.width || currentCanvas.height !== targetDims.height) {
      const resized = resizeCanvas(currentCanvas, targetDims.width, targetDims.height, adapter);
      if (resized !== currentCanvas) {
        releaseCanvasSurface(currentCanvas);
        currentCanvas = resized;
      }
    }

    // 3. Single-Pass Fused Post-Upscale Buffer: ONE getImageData -> adjustments, clarity,
    //    filter/grade, quality-model edge acutance & Pro sharpen -> ONE putImageData
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

    const needsQualityModelPass =
      modelStrength > 0 ||
      intendedUpscaleRatio > 1.05 ||
      targetPlan.appliedTargetResolution !== 'original';

    const needsPostPixelPass =
      hasAdjustments ||
      hasPostProSharpen ||
      (edit.photoFilterId !== 'original' && edit.photoFilterIntensity > 0) ||
      hasActiveColorGrade(edit.colorGrade) ||
      edit.enhanceSuite.colorContrast.enabled ||
      needsQualityModelPass ||
      effectiveSharpen > 0;

    if (needsPostPixelPass) {
      const ctx = currentCanvas.getContext('2d');
      if (ctx) {
        const imgData = ctx.getImageData(0, 0, currentCanvas.width, currentCanvas.height);

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
            targetPlan.appliedTargetResolution,
            { skipDenoise: ranPreDenoise }
          );
        }

        if (hasPostProSharpen) {
          applyPostUpscaleProSharpen(imgData, activeProTools, proToolStrength);
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
    if (!blob || blob.size === 0) {
      throw new Error('Hasil konversi foto kosong. Silakan coba format lain.');
    }

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
 * Generates ONE lightweight <= 160px base thumbnail Blob shared by filter swatches
 * and QueuePanel thumbnails, avoiding full-resolution decode duplication in RAM.
 */
export async function runBaseThumbnailPipeline<TCanvas extends CanvasSurfaceLike>(
  bitmap: ImageBitmap,
  adapter: CanvasAdapter<TCanvas>
): Promise<Blob> {
  const thumbDims = computeTargetDimensions(bitmap.width, bitmap.height, 160);
  const baseCanvas = adapter.createCanvas(thumbDims.width, thumbDims.height);
  try {
    const baseCtx = baseCanvas.getContext('2d');
    if (!baseCtx) {
      throw new Error('Gagal membuat pratinjau filter.');
    }
    baseCtx.imageSmoothingEnabled = true;
    baseCtx.imageSmoothingQuality = 'medium';
    baseCtx.drawImage(bitmap, 0, 0, thumbDims.width, thumbDims.height);
    return await adapter.encodeBlob(baseCanvas, 'image/jpeg', 0.8);
  } finally {
    releaseCanvasSurface(baseCanvas);
  }
}
