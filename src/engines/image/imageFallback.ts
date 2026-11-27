import type { ImageProcessRequest, ImageProcessResult } from '../contracts';
import {
  releaseCanvasSurface,
  runBaseThumbnailPipeline,
  runImagePipeline,
  type Canvas2DContextLike,
  type CanvasAdapter,
} from './pipelineRunner';
import { buildExportFileName, getActiveImageModuleLabels } from './pixelOps';

const htmlCanvasAdapter: CanvasAdapter<HTMLCanvasElement> = {
  createCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  encodeBlob(canvas, format, quality) {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Browser gagal menyimpan hasil konversi foto.'));
            return;
          }
          if (format === 'image/avif' && blob.type !== 'image/avif') {
            reject(new Error('Browser tidak mendukung penyandian AVIF secara native.'));
            return;
          }
          resolve(blob);
        },
        format,
        quality
      );
    });
  },
};

async function decodeOrientedBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(file);
  }
}

export async function runMainThreadImageFallback(
  request: ImageProcessRequest
): Promise<ImageProcessResult> {
  const t0 = performance.now();
  const bitmap = await decodeOrientedBitmap(request.file);

  try {
    const out = await runImagePipeline(
      bitmap,
      request.edit,
      htmlCanvasAdapter as unknown as CanvasAdapter<{
        width: number;
        height: number;
        getContext(type: '2d'): Canvas2DContextLike | null;
      }>,
      request.previewMaxEdgePx,
      {
        maxCanvasPixels: request.maxCanvasPixels,
        allow8K: request.allow8K,
        isMobileThermalGuard: request.isMobileThermalGuard,
      }
    );

    const activeModules = getActiveImageModuleLabels(request.edit);

    return {
      requestId: request.requestId,
      backend: 'main-thread-canvas-fallback',
      outputBlob: out.blob,
      outputFileName: buildExportFileName(
        request.file.name,
        request.edit.outputFormat,
        request.edit.targetResolution
      ),
      outputMime: request.edit.outputFormat,
      outputWidth: out.width,
      outputHeight: out.height,
      inputBytes: request.file.size,
      outputBytes: out.blob.size,
      durationMs: performance.now() - t0,
      solvedQuality: out.solvedQuality,
      targetSizeMet: out.targetSizeMet,
      clampedByMemoryGuard: out.clampedByMemoryGuard,
      appliedTargetResolution: out.appliedTargetResolution,
      activeModules,
    };
  } finally {
    bitmap.close();
    void releaseCanvasSurface;
  }
}

export async function runMainThreadBaseThumbnailFallback(file: File): Promise<Blob> {
  const bitmap = await decodeOrientedBitmap(file);
  try {
    return await runBaseThumbnailPipeline(
      bitmap,
      htmlCanvasAdapter as unknown as CanvasAdapter<{
        width: number;
        height: number;
        getContext(type: '2d'): Canvas2DContextLike | null;
      }>
    );
  } finally {
    bitmap.close();
  }
}
