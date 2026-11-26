import type { ImageFilterId, ImageProcessRequest, ImageProcessResult } from '../contracts';
import { runMainThreadImageFallback, runMainThreadThumbnailsFallback } from './imageFallback';
import type { ImageWorkerRequest, ImageWorkerResponse } from './imageProcessor.worker';
import { buildExportFileName } from './pixelOps';

let sharedWorker: Worker | null = null;
let sequenceCounter = 0;

function getOrCreateWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('./imageProcessor.worker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return sharedWorker;
}

export function disposeImageEngine(): void {
  if (sharedWorker) {
    sharedWorker.terminate();
    sharedWorker = null;
  }
}

function sendWorkerMessage(
  worker: Worker,
  payload: ImageWorkerRequest
): Promise<ImageWorkerResponse> {
  return new Promise<ImageWorkerResponse>((resolve, reject) => {
    const onMessage = (event: MessageEvent<ImageWorkerResponse>) => {
      if (event.data.seq !== payload.seq) {
        return;
      }
      cleanup();
      resolve(event.data);
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || 'Worker foto mengalami gangguan saat memproses.'));
    };
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage(payload, [payload.buffer]);
  });
}

export async function processImage(
  request: ImageProcessRequest
): Promise<ImageProcessResult> {
  const tStart = performance.now();
  const seq = ++sequenceCounter;

  try {
    if (typeof Worker === 'undefined') {
      return await runMainThreadImageFallback(request);
    }

    const worker = getOrCreateWorker();
    const inputBuffer = await request.file.arrayBuffer();
    const response = await sendWorkerMessage(worker, {
      type: 'process',
      seq,
      requestId: request.requestId,
      buffer: inputBuffer,
      mimeType: request.sourceMetadata.mimeType,
      edit: request.edit,
    });

    if (response.type !== 'process') {
      throw new Error('Respons worker tidak sesuai.');
    }
    if (!response.ok) {
      throw new Error(response.error);
    }
    if (response.fallbackRequired) {
      return await runMainThreadImageFallback(request);
    }

    const outputBlob = new Blob([response.outputBuffer], { type: response.outputMime });
    return {
      requestId: request.requestId,
      backend: 'worker-offscreen-canvas',
      outputBlob,
      outputFileName: buildExportFileName(request.file.name, response.outputMime),
      outputMime: response.outputMime,
      outputWidth: response.outputWidth,
      outputHeight: response.outputHeight,
      inputBytes: request.file.size,
      outputBytes: outputBlob.size,
      durationMs: performance.now() - tStart,
      solvedQuality: response.solvedQuality,
      targetSizeMet: response.targetSizeMet,
    };
  } catch {
    disposeImageEngine();
    return runMainThreadImageFallback(request);
  }
}

export async function generateFilterThumbnails(
  file: File,
  mimeType: string
): Promise<Array<{ filterId: ImageFilterId; blob: Blob }>> {
  const seq = ++sequenceCounter;

  try {
    if (typeof Worker === 'undefined') {
      return await runMainThreadThumbnailsFallback(file);
    }

    const worker = getOrCreateWorker();
    const inputBuffer = await file.arrayBuffer();
    const response = await sendWorkerMessage(worker, {
      type: 'thumbnails',
      seq,
      buffer: inputBuffer,
      mimeType,
    });

    if (response.type !== 'thumbnails' || !response.ok) {
      return await runMainThreadThumbnailsFallback(file);
    }
    if (response.fallbackRequired) {
      return await runMainThreadThumbnailsFallback(file);
    }

    return response.items.map((item) => ({
      filterId: item.filterId,
      blob: new Blob([item.buffer], { type: 'image/jpeg' }),
    }));
  } catch {
    return runMainThreadThumbnailsFallback(file);
  }
}
