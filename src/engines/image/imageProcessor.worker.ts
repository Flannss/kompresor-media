import type { ImageOutputFormat, ImageRotation } from '../contracts';
import {
  applySharpen,
  computeProgressiveSteps,
  computeRotatedDimensions,
  computeTargetDimensions,
} from './pixelOps';

export interface ImageWorkerRequest {
  seq: number;
  requestId: string;
  buffer: ArrayBuffer;
  mimeType: string;
  maxEdgePx: number | null;
  outputFormat: ImageOutputFormat;
  quality: number;
  sharpenAmount: number;
  rotationDeg: ImageRotation;
}

export type ImageWorkerResponse =
  | {
      seq: number;
      requestId: string;
      ok: true;
      fallbackRequired: true;
    }
  | {
      seq: number;
      requestId: string;
      ok: true;
      fallbackRequired: false;
      outputBuffer: ArrayBuffer;
      outputMime: ImageOutputFormat;
      outputWidth: number;
      outputHeight: number;
      durationMs: number;
    }
  | {
      seq: number;
      requestId: string;
      ok: false;
      error: string;
    };

interface DedicatedWorkerScopeLike {
  onmessage: ((event: MessageEvent<ImageWorkerRequest>) => void) | null;
  postMessage(message: ImageWorkerResponse, transfer?: Transferable[]): void;
}

const workerScope = self as unknown as DedicatedWorkerScopeLike;

async function decodeOrientedBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(blob);
  }
}

function drawRotatedToOffscreen(
  bitmap: ImageBitmap,
  rotationDeg: ImageRotation
): OffscreenCanvas {
  const rotDims = computeRotatedDimensions(bitmap.width, bitmap.height, rotationDeg);
  const canvas = new OffscreenCanvas(rotDims.width, rotDims.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Gagal menyiapkan kanvas worker untuk memproses foto.');
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

workerScope.onmessage = async (event: MessageEvent<ImageWorkerRequest>) => {
  const {
    seq,
    requestId,
    buffer,
    mimeType,
    maxEdgePx,
    outputFormat,
    quality,
    sharpenAmount,
    rotationDeg,
  } = event.data;

  if (typeof OffscreenCanvas === 'undefined') {
    workerScope.postMessage({
      seq,
      requestId,
      ok: true,
      fallbackRequired: true,
    });
    return;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    const t0 = performance.now();
    const inputBlob = new Blob([buffer], { type: mimeType });
    bitmap = await decodeOrientedBitmap(inputBlob);

    let currentCanvas = drawRotatedToOffscreen(bitmap, rotationDeg);
    const targetDims = computeTargetDimensions(
      currentCanvas.width,
      currentCanvas.height,
      maxEdgePx
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
      const nextCanvas = new OffscreenCanvas(step.width, step.height);
      const nextCtx = nextCanvas.getContext('2d');
      if (!nextCtx) {
        throw new Error('Gagal mengubah ukuran foto di worker.');
      }
      nextCtx.imageSmoothingEnabled = true;
      nextCtx.imageSmoothingQuality = 'high';
      nextCtx.drawImage(currentCanvas, 0, 0, step.width, step.height);
      currentCanvas = nextCanvas;
    }

    if (sharpenAmount > 0) {
      const ctx = currentCanvas.getContext('2d');
      if (ctx) {
        const imgData = ctx.getImageData(0, 0, currentCanvas.width, currentCanvas.height);
        applySharpen(imgData, sharpenAmount);
        ctx.putImageData(imgData, 0, 0);
      }
    }

    const clampedQuality = Math.min(1, Math.max(0.1, quality));
    const encodedBlob = await currentCanvas.convertToBlob({
      type: outputFormat,
      ...(outputFormat === 'image/png' ? {} : { quality: clampedQuality }),
    });

    const outputBuffer = await encodedBlob.arrayBuffer();
    const durationMs = performance.now() - t0;

    workerScope.postMessage(
      {
        seq,
        requestId,
        ok: true,
        fallbackRequired: false,
        outputBuffer,
        outputMime: outputFormat,
        outputWidth: currentCanvas.width,
        outputHeight: currentCanvas.height,
        durationMs,
      },
      [outputBuffer]
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Gagal memproses foto di worker latar belakang.';
    workerScope.postMessage({
      seq,
      requestId,
      ok: false,
      error: message,
    });
  } finally {
    if (bitmap) {
      bitmap.close();
    }
  }
};
