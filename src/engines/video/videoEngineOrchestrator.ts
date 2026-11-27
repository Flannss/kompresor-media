import type {
  VideoExecutionBackend,
  VideoOutputMime,
  VideoProcessProgress,
  VideoProcessRequest,
  VideoProcessResult,
} from '../contracts';
import { runFfmpegVideoTranscode } from './ffmpegVideoEngine';
import { VideoCancelledError } from './videoErrors';
import {
  getActiveVideoModuleLabels,
  getVideoFormatMeta,
  isAudioMuted,
  shouldUseFfmpegBackend,
} from './videoFilterGraph';
import {
  runWebCodecsVideoTranscode,
  VideoFallbackRequiredError,
} from './webCodecsVideoEngine';

async function inspectOutputVideo(
  blob: Blob,
  fallbackWidth: number,
  fallbackHeight: number,
  fallbackDuration: number
): Promise<{ width: number; height: number; durationSec: number }> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;

  try {
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve({ width: fallbackWidth, height: fallbackHeight, durationSec: fallbackDuration });
      }, 2500);

      const onLoaded = () => {
        cleanup();
        resolve({
          width: video.videoWidth > 0 ? video.videoWidth : fallbackWidth,
          height: video.videoHeight > 0 ? video.videoHeight : fallbackHeight,
          durationSec:
            Number.isFinite(video.duration) && video.duration > 0
              ? video.duration
              : fallbackDuration,
        });
      };

      const onError = () => {
        cleanup();
        resolve({ width: fallbackWidth, height: fallbackHeight, durationSec: fallbackDuration });
      };

      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };

      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
      video.src = url;
    });
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function checkHasDecodableAudio(
  blob: Blob,
  muted: boolean,
  mime: VideoOutputMime
): Promise<boolean> {
  if (muted) {
    return false;
  }
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    return true;
  }

  const ctx = new AudioCtx();
  try {
    const buffer = await blob.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(buffer);
    return audioBuf.duration > 0 && audioBuf.numberOfChannels > 0;
  } catch {
    // MKV Opus/AAC may not always decode in Chrome AudioContext.decodeAudioData even with valid track
    return mime === 'video/x-matroska';
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function processVideo(
  request: VideoProcessRequest,
  onProgress: (progress: VideoProcessProgress) => void,
  signal?: AbortSignal
): Promise<VideoProcessResult> {
  const t0 = performance.now();
  const formatMeta = getVideoFormatMeta(request.edit.outputFormat);
  const useFfmpeg =
    request.preferredBackend === 'ffmpeg-wasm-st' ||
    (request.preferredBackend !== 'webcodecs-mediabunny' && shouldUseFfmpegBackend(request.edit));

  let backendUsed: VideoExecutionBackend = useFfmpeg
    ? 'ffmpeg-wasm-st'
    : 'webcodecs-mediabunny';

  let output: {
    outputBlob: Blob;
    outputFileName: string;
    outputWidth: number;
    outputHeight: number;
    durationSec: number;
    notice?: string;
    engineDetail?: string;
  };

  if (useFfmpeg) {
    output = await runFfmpegVideoTranscode(request, onProgress, signal);
  } else {
    try {
      output = await runWebCodecsVideoTranscode(request, onProgress, signal);
    } catch (err) {
      if (err instanceof VideoCancelledError || signal?.aborted) {
        throw new VideoCancelledError();
      }
      if (
        err instanceof VideoFallbackRequiredError ||
        request.preferredBackend === 'auto' ||
        !request.preferredBackend
      ) {
        backendUsed = 'ffmpeg-wasm-st';
        output = await runFfmpegVideoTranscode(request, onProgress, signal);
      } else {
        throw err;
      }
    }
  }

  const [verifiedVideo, hasAudio] = await Promise.all([
    inspectOutputVideo(
      output.outputBlob,
      output.outputWidth,
      output.outputHeight,
      output.durationSec
    ),
    checkHasDecodableAudio(output.outputBlob, isAudioMuted(request.edit), formatMeta.mime),
  ]);

  const result: VideoProcessResult = {
    requestId: request.requestId,
    backend: backendUsed,
    outputBlob: output.outputBlob,
    outputFileName: output.outputFileName,
    outputFormat: request.edit.outputFormat,
    outputMime: formatMeta.mime,
    outputWidth: verifiedVideo.width,
    outputHeight: verifiedVideo.height,
    durationSec: verifiedVideo.durationSec,
    hasAudio,
    inputBytes: request.file.size,
    outputBytes: output.outputBlob.size,
    durationMs: performance.now() - t0,
    activeModules: getActiveVideoModuleLabels(request.edit),
    ...(output.notice ? { notice: output.notice } : {}),
    ...(output.engineDetail ? { engineDetail: output.engineDetail } : {}),
  };

  onProgress({
    requestId: request.requestId,
    backend: backendUsed,
    stage: 'finalizing',
    ratio: 1,
    elapsedMs: result.durationMs,
  });

  return result;
}
