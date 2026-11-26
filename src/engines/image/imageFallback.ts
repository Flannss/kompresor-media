import type { ImageProcessRequest, ImageProcessResult, ImageRotation } from '../contracts';
import {
  applySharpen,
  buildExportFileName,
  computeProgressiveSteps,
  computeRotatedDimensions,
  computeTargetDimensions,
} from './pixelOps';

async function decodeOrientedBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(file);
  }
}

function drawRotatedToCanvas(bitmap: ImageBitmap, rotationDeg: ImageRotation): HTMLCanvasElement {
  const rotDims = computeRotatedDimensions(bitmap.width, bitmap.height, rotationDeg);
  const canvas = document.createElement('canvas');
  canvas.width = rotDims.width;
  canvas.height = rotDims.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser gagal menyiapkan kanvas untuk memproses foto.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (rotationDeg === 0) {
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  }

  ctx.save();
  if (rotationDeg === 90) {
    ctx.translate(rotDims.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rotationDeg === 180) {
    ctx.translate(rotDims.width, rotDims.height);
    ctx.rotate(Math.PI);
  } else if (rotationDeg === 270) {
    ctx.translate(0, rotDims.height);
    ctx.rotate((3 * Math.PI) / 2);
  }
  ctx.drawImage(bitmap, 0, 0);
  ctx.restore();
  return canvas;
}

export async function runMainThreadImageFallback(
  request: ImageProcessRequest
): Promise<ImageProcessResult> {
  const t0 = performance.now();
  const bitmap = await decodeOrientedBitmap(request.file);

  try {
    let currentCanvas = drawRotatedToCanvas(bitmap, request.edit.rotationDeg);
    const targetDims = computeTargetDimensions(
      currentCanvas.width,
      currentCanvas.height,
      request.edit.maxEdgePx
    );

    const steps = computeProgressiveSteps(
      currentCanvas.width,
      currentCanvas.height,
      targetDims.width,
      targetDims.height
    );

    for (const step of steps) {
      if (step.width === currentCanvas.width && step.height === currentCanvas.height) {
        continue;
      }
      const nextCanvas = document.createElement('canvas');
      nextCanvas.width = step.width;
      nextCanvas.height = step.height;
      const nextCtx = nextCanvas.getContext('2d');
      if (!nextCtx) {
        throw new Error('Gagal mengubah ukuran foto pada mode cadangan.');
      }
      nextCtx.imageSmoothingEnabled = true;
      nextCtx.imageSmoothingQuality = 'high';
      nextCtx.drawImage(currentCanvas, 0, 0, step.width, step.height);
      currentCanvas = nextCanvas;
    }

    if (request.edit.sharpenAmount > 0) {
      const ctx = currentCanvas.getContext('2d');
      if (ctx) {
        const imgData = ctx.getImageData(0, 0, currentCanvas.width, currentCanvas.height);
        applySharpen(imgData, request.edit.sharpenAmount);
        ctx.putImageData(imgData, 0, 0);
      }
    }

    const clampedQuality = Math.min(1, Math.max(0.1, request.edit.quality));
    const outputBlob = await new Promise<Blob>((resolve, reject) => {
      currentCanvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Browser gagal menyimpan hasil konversi foto.'));
            return;
          }
          resolve(blob);
        },
        request.edit.outputFormat,
        request.edit.outputFormat === 'image/png' ? undefined : clampedQuality
      );
    });

    return {
      requestId: request.requestId,
      backend: 'main-thread-canvas-fallback',
      outputBlob,
      outputFileName: buildExportFileName(request.file.name, request.edit.outputFormat),
      outputMime: request.edit.outputFormat,
      outputWidth: currentCanvas.width,
      outputHeight: currentCanvas.height,
      inputBytes: request.file.size,
      outputBytes: outputBlob.size,
      durationMs: performance.now() - t0,
    };
  } finally {
    bitmap.close();
  }
}
