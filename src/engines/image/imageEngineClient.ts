import type { ColorGradeId, ImageProcessRequest, ImageProcessResult } from '../contracts';
import { runMainThreadImageFallback, runMainThreadThumbnailsFallback } from './imageFallback';
import type { ImageWorkerRequest, ImageWorkerResponse } from './imageProcessor.worker';
import { buildExportFileName, getActiveImageModuleLabels } from './pixelOps';

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
}

const MAX_WORKERS = 2;
const workerPool: WorkerSlot[] = [];
const waitingResolvers: Array<(slot: WorkerSlot) => void> = [];
let sequenceCounter = 0;
let cachedAvifSupport: boolean | null = null;

function createWorkerSlot(): WorkerSlot {
  const worker = new Worker(new URL('./imageProcessor.worker.ts', import.meta.url), {
    type: 'module',
  });
  return { worker, busy: false };
}

async function acquireWorkerSlot(): Promise<WorkerSlot> {
  const free = workerPool.find((slot) => !slot.busy);
  if (free) {
    free.busy = true;
    return free;
  }
  if (workerPool.length < MAX_WORKERS) {
    const slot = createWorkerSlot();
    slot.busy = true;
    workerPool.push(slot);
    return slot;
  }
  return new Promise<WorkerSlot>((resolve) => {
    waitingResolvers.push(resolve);
  });
}

function releaseWorkerSlot(slot: WorkerSlot, terminateOnFault = false): void {
  if (terminateOnFault) {
    slot.worker.terminate();
    const idx = workerPool.indexOf(slot);
    if (idx !== -1) {
      workerPool.splice(idx, 1);
    }
  } else {
    slot.busy = false;
  }

  if (waitingResolvers.length > 0) {
    const next = waitingResolvers.shift()!;
    const readySlot = workerPool.find((s) => !s.busy) ?? (() => {
      const fresh = createWorkerSlot();
      workerPool.push(fresh);
      return fresh;
    })();
    readySlot.busy = true;
    next(readySlot);
  }
}

export function disposeImageEngine(): void {
  while (waitingResolvers.length > 0) {
    waitingResolvers.pop();
  }
  while (workerPool.length > 0) {
    const slot = workerPool.pop()!;
    slot.worker.terminate();
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

export async function probeAvifEncodeSupport(): Promise<boolean> {
  if (cachedAvifSupport !== null) {
    return cachedAvifSupport;
  }
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(4, 4);
      const ctx = c.getContext('2d');
      ctx?.fillRect(0, 0, 4, 4);
      const blob = await c.convertToBlob({ type: 'image/avif', quality: 0.8 });
      cachedAvifSupport = blob.type === 'image/avif' && blob.size > 0;
      return cachedAvifSupport;
    }
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      const supported = await new Promise<boolean>((resolve) => {
        canvas.toBlob(
          (b) => resolve(Boolean(b && b.type === 'image/avif' && b.size > 0)),
          'image/avif',
          0.8
        );
      });
      cachedAvifSupport = supported;
      return supported;
    }
  } catch {
    cachedAvifSupport = false;
    return false;
  }
  cachedAvifSupport = false;
  return false;
}

export async function processImage(
  request: ImageProcessRequest
): Promise<ImageProcessResult> {
  const tStart = performance.now();
  const seq = ++sequenceCounter;

  if (typeof Worker === 'undefined') {
    return runMainThreadImageFallback(request);
  }

  const slot = await acquireWorkerSlot();
  try {
    const inputBuffer = await request.file.arrayBuffer();
    const response = await sendWorkerMessage(slot.worker, {
      type: 'process',
      seq,
      requestId: request.requestId,
      buffer: inputBuffer,
      mimeType: request.sourceMetadata.mimeType,
      edit: request.edit,
      previewMaxEdgePx: request.previewMaxEdgePx,
    });

    if (response.type !== 'process') {
      throw new Error('Respons worker tidak sesuai.');
    }
    if (!response.ok) {
      throw new Error(response.error);
    }
    if (response.fallbackRequired) {
      releaseWorkerSlot(slot);
      return await runMainThreadImageFallback(request);
    }

    const outputBlob = new Blob([response.outputBuffer], { type: response.outputMime });
    const activeModules = getActiveImageModuleLabels(request.edit);

    releaseWorkerSlot(slot);
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
      activeModules,
    };
  } catch {
    releaseWorkerSlot(slot, true);
    return runMainThreadImageFallback(request);
  }
}

export async function generateFilterThumbnails(
  file: File,
  mimeType: string
): Promise<Array<{ gradeId: ColorGradeId; blob: Blob }>> {
  const seq = ++sequenceCounter;

  if (typeof Worker === 'undefined') {
    return runMainThreadThumbnailsFallback(file);
  }

  const slot = await acquireWorkerSlot();
  try {
    const inputBuffer = await file.arrayBuffer();
    const response = await sendWorkerMessage(slot.worker, {
      type: 'thumbnails',
      seq,
      buffer: inputBuffer,
      mimeType,
    });

    if (response.type !== 'thumbnails' || !response.ok || response.fallbackRequired) {
      releaseWorkerSlot(slot);
      return await runMainThreadThumbnailsFallback(file);
    }

    releaseWorkerSlot(slot);
    return response.items.map((item) => ({
      gradeId: item.gradeId,
      blob: new Blob([item.buffer], { type: 'image/jpeg' }),
    }));
  } catch {
    releaseWorkerSlot(slot, true);
    return runMainThreadThumbnailsFallback(file);
  }
}
