import type { FFmpeg } from '@ffmpeg/ffmpeg';
import type { VideoProcessProgress, VideoProcessRequest } from '../contracts';
import {
  buildVideoExportFileName,
  clampTrimRange,
  computeEvenScaledDimensions,
} from './videoPresets';

export interface FfmpegTranscodeOutput {
  outputBlob: Blob;
  outputFileName: string;
  outputWidth: number;
  outputHeight: number;
  durationSec: number;
}

export class VideoCancelledError extends Error {
  constructor(message = 'Pemrosesan video dibatalkan oleh pengguna.') {
    super(message);
    this.name = 'VideoCancelledError';
  }
}

let cachedFfmpeg: FFmpeg | null = null;

function resolveInputExt(file: File): string {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.webm') || file.type === 'video/webm') {
    return 'webm';
  }
  if (lower.endsWith('.mov') || file.type === 'video/quicktime') {
    return 'mov';
  }
  return 'mp4';
}

async function getOrLoadFfmpeg(
  requestId: string,
  startTimeMs: number,
  onProgress: (progress: VideoProcessProgress) => void,
  signal?: AbortSignal
): Promise<FFmpeg> {
  if (signal?.aborted) {
    throw new VideoCancelledError();
  }

  if (cachedFfmpeg?.loaded) {
    return cachedFfmpeg;
  }

  onProgress({
    requestId,
    backend: 'ffmpeg-wasm-st',
    stage: 'loading-core',
    ratio: 0.04,
    elapsedMs: performance.now() - startTimeMs,
    detail: 'Memuat modul pengolah video…',
  });

  const { FFmpeg: FfmpegCtor } = await import('@ffmpeg/ffmpeg');
  if (signal?.aborted) {
    throw new VideoCancelledError();
  }

  const instance = new FfmpegCtor();
  cachedFfmpeg = instance;

  const coreURL = new URL('./ffmpeg/ffmpeg-core.js', document.baseURI).href;
  const wasmURL = new URL('./ffmpeg/ffmpeg-core.wasm', document.baseURI).href;

  await instance.load({ coreURL, wasmURL });
  if (signal?.aborted) {
    instance.terminate();
    cachedFfmpeg = null;
    throw new VideoCancelledError();
  }

  return instance;
}

export async function runFfmpegVideoTranscode(
  request: VideoProcessRequest,
  onProgress: (progress: VideoProcessProgress) => void,
  signal?: AbortSignal
): Promise<FfmpegTranscodeOutput> {
  const t0 = performance.now();
  const { file, sourceMetadata, edit, requestId } = request;

  const instance = await getOrLoadFfmpeg(requestId, t0, onProgress, signal);

  let aborted = Boolean(signal?.aborted);
  const onAbort = () => {
    aborted = true;
    try {
      instance.terminate();
    } catch {
      // Ignore worker termination errors
    }
    if (cachedFfmpeg === instance) {
      cachedFfmpeg = null;
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  const progressHandler = ({ progress }: { progress: number }) => {
    if (aborted) return;
    const clamped = Math.min(0.97, Math.max(0.05, Number.isFinite(progress) ? progress : 0));
    onProgress({
      requestId,
      backend: 'ffmpeg-wasm-st',
      stage: 'transcoding',
      ratio: clamped,
      elapsedMs: performance.now() - t0,
    });
  };

  instance.on('progress', progressHandler);

  const inputName = `input.${resolveInputExt(file)}`;
  const outputName = 'output.mp4';

  try {
    if (aborted) {
      throw new VideoCancelledError();
    }

    const inputBytes = new Uint8Array(await file.arrayBuffer());
    await instance.writeFile(inputName, inputBytes);

    const trim = clampTrimRange(edit.trimStartSec, edit.trimEndSec, sourceMetadata.durationSec);
    const dims = computeEvenScaledDimensions(
      sourceMetadata.width,
      sourceMetadata.height,
      edit.maxHeightPx
    );

    const args: string[] = ['-i', inputName];
    if (trim.startSec > 0.01) {
      args.push('-ss', trim.startSec.toFixed(3));
    }
    if (trim.endSec < sourceMetadata.durationSec - 0.05) {
      args.push('-t', trim.durationSec.toFixed(3));
    }

    args.push(
      '-vf',
      `scale=${dims.width}:${dims.height}`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      String(edit.crf),
      '-maxrate',
      `${edit.maxrateKbps}k`,
      '-bufsize',
      `${edit.bufsizeKbps}k`,
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart'
    );

    if (edit.muteAudio) {
      args.push('-an');
    } else {
      args.push('-c:a', 'aac', '-b:a', `${edit.audioBitrateKbps}k`);
    }
    args.push(outputName);

    const exitCode = await instance.exec(args);
    if (aborted) {
      throw new VideoCancelledError();
    }
    if (exitCode !== 0) {
      throw new Error(`FFmpeg gagal memproses video (kode ${exitCode}).`);
    }

    onProgress({
      requestId,
      backend: 'ffmpeg-wasm-st',
      stage: 'finalizing',
      ratio: 0.99,
      elapsedMs: performance.now() - t0,
    });

    const rawOut = await instance.readFile(outputName);
    if (!(rawOut instanceof Uint8Array)) {
      throw new Error('Gagal membaca file hasil pemrosesan video.');
    }

    const cleanCopy = new Uint8Array(rawOut.byteLength);
    cleanCopy.set(rawOut);
    const outputBlob = new Blob([cleanCopy], { type: 'video/mp4' });

    await instance.deleteFile(inputName).catch(() => {});
    await instance.deleteFile(outputName).catch(() => {});

    return {
      outputBlob,
      outputFileName: buildVideoExportFileName(file.name),
      outputWidth: dims.width,
      outputHeight: dims.height,
      durationSec: trim.durationSec,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (aborted || msg.includes('FFmpeg.terminate()')) {
      throw new VideoCancelledError();
    }
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    instance.off('progress', progressHandler);
  }
}
