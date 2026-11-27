import type { ImageProcessRequest, ImageProcessResult } from '../contracts';
import { getDeviceProfile } from '../../shared/utils/deviceCapability';
import {
  runMainThreadBaseThumbnailFallback,
  runMainThreadImageFallback,
} from './imageFallback';
import type { ImageWorkerRequest, ImageWorkerResponse } from './imageProcessor.worker';
import { releaseCanvasSurface } from './pipelineRunner';
import { buildExportFileName, getActiveImageModuleLabels } from './pixelOps';

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
}

const workerPool: WorkerSlot[] = [];
const waitingResolvers: Array<(slot: WorkerSlot) => void> = [];
let sequenceCounter = 0;
let cachedAvifSupport: boolean | null = null;

function getWorkerPoolLimit(): number {
  return getDeviceProfile().imageWorkerPoolSize;
}

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
  if (workerPool.length < getWorkerPoolLimit()) {
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
    const readySlot =
      workerPool.find((s) => !s.busy) ??
      (() => {
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
      try {
        const ctx = c.getContext('2d');
        ctx?.fillRect(0, 0, 4, 4);
        const blob = await c.convertToBlob({ type: 'image/avif', quality: 0.8 });
        cachedAvifSupport = blob.type === 'image/avif' && blob.size > 0;
        return cachedAvifSupport;
      } finally {
        releaseCanvasSurface(c);
      }
    }
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      try {
        const supported = await new Promise<boolean>((resolve) => {
          canvas.toBlob(
            (b) => resolve(Boolean(b && b.type === 'image/avif' && b.size > 0)),
            'image/avif',
            0.8
          );
        });
        cachedAvifSupport = supported;
        return supported;
      } finally {
        releaseCanvasSurface(canvas);
      }
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
  const profile = getDeviceProfile();
  const maxCanvasPixels = request.maxCanvasPixels ?? profile.maxPhotoCanvasPixels;
  const allow8K = request.allow8K ?? profile.allow8KPhotoExport;
  const normalizedRequest: ImageProcessRequest = {
    ...request,
    maxCanvasPixels,
    allow8K,
  };

  if (typeof Worker === 'undefined') {
    return runMainThreadImageFallback(normalizedRequest);
  }

  const slot = await acquireWorkerSlot();
  try {
    const inputBuffer = await normalizedRequest.file.arrayBuffer();
    const response = await sendWorkerMessage(slot.worker, {
      type: 'process',
      seq,
      requestId: normalizedRequest.requestId,
      buffer: inputBuffer,
      mimeType: normalizedRequest.sourceMetadata.mimeType,
      edit: normalizedRequest.edit,
      previewMaxEdgePx: normalizedRequest.previewMaxEdgePx,
      maxCanvasPixels,
      allow8K,
    });

    if (response.type !== 'process') {
      throw new Error('Respons worker tidak sesuai.');
    }
    if (!response.ok) {
      throw new Error(response.error);
    }
    if (response.fallbackRequired) {
      releaseWorkerSlot(slot);
      return await runMainThreadImageFallback(normalizedRequest);
    }

    const outputBlob = new Blob([response.outputBuffer], { type: response.outputMime });
    const activeModules = getActiveImageModuleLabels(normalizedRequest.edit);

    releaseWorkerSlot(slot);
    return {
      requestId: normalizedRequest.requestId,
      backend: 'worker-offscreen-canvas',
      outputBlob,
      outputFileName: buildExportFileName(
        normalizedRequest.file.name,
        response.outputMime,
        normalizedRequest.edit.targetResolution
      ),
      outputMime: response.outputMime,
      outputWidth: response.outputWidth,
      outputHeight: response.outputHeight,
      inputBytes: normalizedRequest.file.size,
      outputBytes: outputBlob.size,
      durationMs: performance.now() - tStart,
      solvedQuality: response.solvedQuality,
      targetSizeMet: response.targetSizeMet,
      clampedByMemoryGuard: response.clampedByMemoryGuard,
      appliedTargetResolution: response.appliedTargetResolution,
      activeModules,
    };
  } catch {
    releaseWorkerSlot(slot, true);
    return runMainThreadImageFallback(normalizedRequest);
  }
}

export async function generateBaseThumbnail(
  file: File,
  mimeType: string
): Promise<Blob> {
  const seq = ++sequenceCounter;

  if (typeof Worker === 'undefined') {
    return runMainThreadBaseThumbnailFallback(file);
  }

  const slot = await acquireWorkerSlot();
  try {
    const inputBuffer = await file.arrayBuffer();
    const response = await sendWorkerMessage(slot.worker, {
      type: 'base-thumbnail',
      seq,
      buffer: inputBuffer,
      mimeType,
    });

    if (response.type !== 'base-thumbnail' || !response.ok || response.fallbackRequired) {
      releaseWorkerSlot(slot);
      return await runMainThreadBaseThumbnailFallback(file);
    }

    releaseWorkerSlot(slot);
    return new Blob([response.buffer], { type: 'image/jpeg' });
  } catch {
    releaseWorkerSlot(slot, true);
    return runMainThreadBaseThumbnailFallback(file);
  }
}
