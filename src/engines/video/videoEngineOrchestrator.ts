import type {
  VideoExecutionBackend,
  VideoOutputMime,
  VideoProcessProgress,
  VideoProcessRequest,
  VideoProcessResult,
} from '../contracts';
import { runFfmpegVideoTranscode } from './ffmpegVideoEngine';
import {
  canUseMediaRecorderMp4,
  runMediaRecorderVideoTranscode,
} from './mediaRecorderVideoEngine';
import { VideoCancelledError } from './videoErrors';
import { isCancellationError } from '../../shared/utils/friendlyError';
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

export const DEFAULT_ORCHESTRATOR_STALL_MS = 15_000;

async function runTierWithStallWatchdog<T>(params: {
  run: (tierProgress: (p: VideoProcessProgress) => void, tierSignal: AbortSignal) => Promise<T>;
  onProgress: (p: VideoProcessProgress) => void;
  outerSignal?: AbortSignal;
  stallTimeoutMs: number;
  stallMessage: string;
}): Promise<T> {
  const { run, onProgress, outerSignal, stallTimeoutMs, stallMessage } = params;
  if (outerSignal?.aborted) {
    throw new VideoCancelledError();
  }

  const tierController = new AbortController();
  let lastProgressAt = Date.now();
  let stalled = false;
  let pollId: ReturnType<typeof setInterval> | null = null;
  let rejectWatchdog: ((reason?: unknown) => void) | null = null;

  const onOuterAbort = () => {
    tierController.abort();
    rejectWatchdog?.(new VideoCancelledError());
  };
  outerSignal?.addEventListener('abort', onOuterAbort, { once: true });

  const tierProgress = (p: VideoProcessProgress) => {
    if (tierController.signal.aborted || outerSignal?.aborted) return;
    lastProgressAt = Date.now();
    onProgress(p);
  };

  try {
    const checkIntervalMs = Math.min(500, Math.max(25, Math.floor(stallTimeoutMs / 4)));
    return await Promise.race([
      run(tierProgress, tierController.signal),
      new Promise<never>((_resolve, reject) => {
        rejectWatchdog = reject;
        pollId = setInterval(() => {
          if (outerSignal?.aborted) {
            tierController.abort();
            reject(new VideoCancelledError());
            return;
          }
          if (tierController.signal.aborted) return;
          if (Date.now() - lastProgressAt >= stallTimeoutMs) {
            stalled = true;
            tierController.abort();
            reject(new VideoFallbackRequiredError(stallMessage));
          }
        }, checkIntervalMs);
      }),
    ]);
  } catch (err) {
    if (outerSignal?.aborted) {
      throw new VideoCancelledError();
    }
    if (stalled) {
      throw err instanceof VideoFallbackRequiredError
        ? err
        : new VideoFallbackRequiredError(stallMessage);
    }
    throw err;
  } finally {
    if (pollId !== null) {
      clearInterval(pollId);
    }
    outerSignal?.removeEventListener('abort', onOuterAbort);
  }
}

export async function processVideo(
  request: VideoProcessRequest,
  onProgress: (progress: VideoProcessProgress) => void,
  signal?: AbortSignal,
  options?: { tier1StallTimeoutMs?: number; tier2StallTimeoutMs?: number }
): Promise<VideoProcessResult> {
  const t0 = performance.now();
  const formatMeta = getVideoFormatMeta(request.edit.outputFormat);
  const tier1StallMs = options?.tier1StallTimeoutMs ?? DEFAULT_ORCHESTRATOR_STALL_MS;
  const tier2StallMs = options?.tier2StallTimeoutMs ?? DEFAULT_ORCHESTRATOR_STALL_MS;
  const useFfmpeg =
    request.preferredBackend === 'ffmpeg-wasm-st' ||
    ((!request.preferredBackend || request.preferredBackend === 'auto') &&
      shouldUseFfmpegBackend(request.edit));

  const supportsMediaRecorderContainer =
    request.edit.outputFormat === 'mp4' || request.edit.outputFormat === 'mov';

  let backendUsed: VideoExecutionBackend = useFfmpeg
    ? 'ffmpeg-wasm-st'
    : request.preferredBackend === 'mediarecorder-native'
      ? 'mediarecorder-native'
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
  } else if (request.preferredBackend === 'mediarecorder-native') {
    output = await runTierWithStallWatchdog({
      run: (tp, ts) => runMediaRecorderVideoTranscode(request, tp, ts),
      onProgress,
      outerSignal: signal,
      stallTimeoutMs: tier2StallMs,
      stallMessage: 'Mode Cepat Hardware HP terlalu lama tanpa progres.',
    });
  } else {
    try {
      output = await runTierWithStallWatchdog({
        run: (tp, ts) => runWebCodecsVideoTranscode(request, tp, ts),
        onProgress,
        outerSignal: signal,
        stallTimeoutMs: tier1StallMs,
        stallMessage: 'Mode Cepat Hardware WebCodecs terlalu lama tanpa progres — beralih otomatis.',
      });
    } catch (err) {
      if ((err instanceof VideoCancelledError && signal?.aborted) || signal?.aborted || isCancellationError(err)) {
        throw new VideoCancelledError();
      }
      if (err instanceof VideoCancelledError) {
        throw err;
      }
      if (
        err instanceof VideoFallbackRequiredError ||
        request.preferredBackend === 'auto' ||
        !request.preferredBackend
      ) {
        // Tier-2 Native Hardware MediaRecorder MP4 (e.g., Safari iOS 16 4K HEVC .MOV)
        if (supportsMediaRecorderContainer && canUseMediaRecorderMp4()) {
          try {
            backendUsed = 'mediarecorder-native';
            output = await runTierWithStallWatchdog({
              run: (tp, ts) => runMediaRecorderVideoTranscode(request, tp, ts),
              onProgress,
              outerSignal: signal,
              stallTimeoutMs: tier2StallMs,
              stallMessage: 'Mode Cepat Hardware HP terlalu lama — beralih ke CPU.',
            });
          } catch (mrErr) {
            if (mrErr instanceof VideoCancelledError || signal?.aborted || isCancellationError(mrErr)) {
              throw new VideoCancelledError();
            }
            if (
              mrErr instanceof VideoFallbackRequiredError ||
              request.preferredBackend === 'auto' ||
              !request.preferredBackend
            ) {
              backendUsed = 'ffmpeg-wasm-st';
              output = await runFfmpegVideoTranscode(request, onProgress, signal);
            } else {
              throw mrErr;
            }
          }
        } else {
          // Tier-3 CPU FFmpeg.wasm fallback
          backendUsed = 'ffmpeg-wasm-st';
          output = await runFfmpegVideoTranscode(request, onProgress, signal);
        }
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

  const effectiveBitrateMbps = Number(
    ((output.outputBlob.size * 8) / Math.max(0.1, verifiedVideo.durationSec) / 1_000_000).toFixed(
      1
    )
  );
  const colorStandard =
    request.edit.outputFormat === 'webm' ? 'VP9/VP8' : 'H.264 BT.709';

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
    effectiveBitrateMbps,
    colorStandard,
    appliedFps: request.edit.fpsCap,
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
