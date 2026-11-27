import type {
  ImageEditState,
  ImageOutputFormat,
  PhotoTargetResolution,
} from '../contracts';
import {
  runBaseThumbnailPipeline,
  runImagePipeline,
  type CanvasAdapter,
  type Canvas2DContextLike,
} from './pipelineRunner';

export type ImageWorkerRequest =
  | {
      type: 'process';
      seq: number;
      requestId: string;
      buffer: ArrayBuffer;
      mimeType: string;
      edit: ImageEditState;
      previewMaxEdgePx?: number;
      maxCanvasPixels?: number;
      allow8K?: boolean;
      isMobileThermalGuard?: boolean;
    }
  | {
      type: 'base-thumbnail';
      seq: number;
      buffer: ArrayBuffer;
      mimeType: string;
    };

export type ImageWorkerResponse =
  | {
      type: 'process';
      seq: number;
      requestId: string;
      ok: true;
      fallbackRequired: true;
    }
  | {
      type: 'process';
      seq: number;
      requestId: string;
      ok: true;
      fallbackRequired: false;
      outputBuffer: ArrayBuffer;
      outputMime: ImageOutputFormat;
      outputWidth: number;
      outputHeight: number;
      durationMs: number;
      solvedQuality?: number;
      targetSizeMet?: boolean;
      clampedByMemoryGuard?: boolean;
      appliedTargetResolution?: PhotoTargetResolution;
    }
  | {
      type: 'base-thumbnail';
      seq: number;
      ok: true;
      fallbackRequired: true;
    }
  | {
      type: 'base-thumbnail';
      seq: number;
      ok: true;
      fallbackRequired: false;
      buffer: ArrayBuffer;
    }
  | {
      type: 'process' | 'base-thumbnail';
      seq: number;
      requestId?: string;
      ok: false;
      error: string;
    };

interface DedicatedWorkerScopeLike {
  onmessage: ((event: MessageEvent<ImageWorkerRequest>) => void) | null;
  postMessage(message: ImageWorkerResponse, transfer?: Transferable[]): void;
}

const workerScope = self as unknown as DedicatedWorkerScopeLike;

const offscreenAdapter: CanvasAdapter<OffscreenCanvas> = {
  createCanvas(width, height) {
    return new OffscreenCanvas(width, height);
  },
  async encodeBlob(canvas, format, quality) {
    const blob = await canvas.convertToBlob({
      type: format,
      ...(quality === undefined ? {} : { quality }),
    });
    if (format === 'image/avif' && blob.type !== 'image/avif') {
      throw new Error('Browser tidak mendukung penyandian AVIF secara native.');
    }
    return blob;
  },
};

async function decodeOrientedBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(blob);
  }
}

workerScope.onmessage = async (event: MessageEvent<ImageWorkerRequest>) => {
  const payload = event.data;

  if (typeof OffscreenCanvas === 'undefined') {
    if (payload.type === 'process') {
      workerScope.postMessage({
        type: 'process',
        seq: payload.seq,
        requestId: payload.requestId,
        ok: true,
        fallbackRequired: true,
      });
    } else {
      workerScope.postMessage({
        type: 'base-thumbnail',
        seq: payload.seq,
        ok: true,
        fallbackRequired: true,
      });
    }
    return;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    const inputBlob = new Blob([payload.buffer], { type: payload.mimeType });
    bitmap = await decodeOrientedBitmap(inputBlob);

    if (payload.type === 'base-thumbnail') {
      const thumbBlob = await runBaseThumbnailPipeline(
        bitmap,
        offscreenAdapter as unknown as CanvasAdapter<{
          width: number;
          height: number;
          getContext(type: '2d'): Canvas2DContextLike | null;
        }>
      );
      const buffer = await thumbBlob.arrayBuffer();
      workerScope.postMessage(
        {
          type: 'base-thumbnail',
          seq: payload.seq,
          ok: true,
          fallbackRequired: false,
          buffer,
        },
        [buffer]
      );
      return;
    }

    const t0 = performance.now();
    const out = await runImagePipeline(
      bitmap,
      payload.edit,
      offscreenAdapter as unknown as CanvasAdapter<{
        width: number;
        height: number;
        getContext(type: '2d'): Canvas2DContextLike | null;
      }>,
      payload.previewMaxEdgePx,
      {
        maxCanvasPixels: payload.maxCanvasPixels,
        allow8K: payload.allow8K,
        isMobileThermalGuard: payload.isMobileThermalGuard,
      }
    );
    const outputBuffer = await out.blob.arrayBuffer();
    const durationMs = performance.now() - t0;

    workerScope.postMessage(
      {
        type: 'process',
        seq: payload.seq,
        requestId: payload.requestId,
        ok: true,
        fallbackRequired: false,
        outputBuffer,
        outputMime: payload.edit.outputFormat,
        outputWidth: out.width,
        outputHeight: out.height,
        durationMs,
        solvedQuality: out.solvedQuality,
        targetSizeMet: out.targetSizeMet,
        clampedByMemoryGuard: out.clampedByMemoryGuard,
        appliedTargetResolution: out.appliedTargetResolution,
      },
      [outputBuffer]
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Gagal memproses foto di worker latar belakang.';
    workerScope.postMessage({
      type: payload.type,
      seq: payload.seq,
      ...(payload.type === 'process' ? { requestId: payload.requestId } : {}),
      ok: false,
      error: message,
    });
  } finally {
    if (bitmap) {
      bitmap.close();
    }
  }
};
