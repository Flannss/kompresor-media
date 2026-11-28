import type { VideoProcessProgress, VideoProcessRequest } from '../contracts';
import { getDeviceProfile } from '../../shared/utils/deviceCapability';
import { compute1080pTargetDimensions } from '../shared/colorGrades';
import { VideoCancelledError } from './videoErrors';
import {
  getEffectiveAudioBitrateKbps,
  getVideoFormatMeta,
  isAudioMuted,
} from './videoFilterGraph';
import {
  buildVideoExportFileName,
  clampTrimRange,
  computeVideoTargetDimensions,
} from './videoPresets';
import {
  computeDrawRect,
  resolveGpuVisualParams,
  resolveHardwareVideoBitrateBps,
  VideoFallbackRequiredError,
} from './webCodecsVideoEngine';

export interface MediaRecorderTranscodeOutput {
  outputBlob: Blob;
  outputFileName: string;
  outputWidth: number;
  outputHeight: number;
  durationSec: number;
  notice?: string;
  engineDetail?: string;
}

const MP4_MEDIA_RECORDER_MIMES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.4D002A,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
] as const;

/**
 * Probes native browser hardware MediaRecorder MP4 (H.264/AAC) encoding support.
 */
export function pickSupportedMp4RecorderMime(): string | null {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof MediaRecorder.isTypeSupported !== 'function'
  ) {
    return null;
  }

  for (const mime of MP4_MEDIA_RECORDER_MIMES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    } catch {
      // Ignore strict MIME parser throws
    }
  }
  return null;
}

export function canUseMediaRecorderMp4(): boolean {
  return pickSupportedMp4RecorderMime() !== null;
}

export const MEDIARECORDER_PROGRESS_THROTTLE_MS = 500;
export const MEDIARECORDER_MAX_DROP_RATIO = 0.2;

export function evaluateMediaRecorderSmoothness(params: {
  capturedFrames: number;
  durationSec: number;
  expectedFps: number;
}): { expectedFrames: number; dropRatio: number; isSmooth: boolean } {
  const { capturedFrames, durationSec, expectedFps } = params;
  if (
    !Number.isFinite(durationSec) ||
    durationSec < 1.5 ||
    !Number.isFinite(expectedFps) ||
    expectedFps <= 0
  ) {
    return { expectedFrames: 0, dropRatio: 0, isSmooth: true };
  }
  const expectedFrames = Math.max(1, Math.floor(durationSec * expectedFps));
  const safeCaptured = Number.isFinite(capturedFrames) ? Math.max(0, capturedFrames) : 0;
  const dropRatio = Math.max(0, Number((1 - safeCaptured / expectedFrames).toFixed(4)));
  return {
    expectedFrames,
    dropRatio,
    isSmooth: dropRatio <= MEDIARECORDER_MAX_DROP_RATIO,
  };
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: DOMHighResTimeStamp, metadata: { mediaTime: number; presentedFrames: number }) => void
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Tier-2 Native Hardware Video Engine (<video playsInline> + <canvas> + MediaRecorder MP4).
 * Ideal for iPhone Safari 4K 60fps HEVC .MOV where hardware decode & hardware H.264 MediaRecorder
 * run via GPU media pipeline at ~1x speed instead of multi-minute CPU FFmpeg.wasm fallback.
 */
export async function runMediaRecorderVideoTranscode(
  request: VideoProcessRequest,
  onProgress: (progress: VideoProcessProgress) => void,
  signal?: AbortSignal
): Promise<MediaRecorderTranscodeOutput> {
  if (signal?.aborted) {
    throw new VideoCancelledError();
  }

  const { edit, file, sourceMetadata, requestId } = request;
  if (edit.outputFormat === 'webm' || edit.outputFormat === 'mkv') {
    throw new VideoFallbackRequiredError(
      'Mode Hardware MediaRecorder hanya untuk kontainer MP4/MOV.'
    );
  }

  const mimeType = pickSupportedMp4RecorderMime();
  if (!mimeType || typeof document === 'undefined') {
    throw new VideoFallbackRequiredError(
      'MediaRecorder MP4 tidak didukung di browser ini — beralih ke mode CPU.'
    );
  }

  const t0 = performance.now();
  const formatMeta = getVideoFormatMeta(edit.outputFormat);
  let trim = clampTrimRange(edit.trimStartSec, edit.trimEndSec, sourceMetadata.durationSec);
  const dims = edit.enhanceSuite.upscale1080.enabled
    ? compute1080pTargetDimensions(
        sourceMetadata.width,
        sourceMetadata.height,
        edit.enhanceSuite.upscale1080.keepAspect
      )
    : computeVideoTargetDimensions(
        sourceMetadata.width,
        sourceMetadata.height,
        edit.targetResolution ?? 'original',
        edit.maxHeightPx
      );

  const targetFps = edit.fpsCap && edit.fpsCap > 0 ? Math.min(60, edit.fpsCap) : 30;
  const visual = resolveGpuVisualParams(edit);
  const coverFit =
    edit.enhanceSuite.upscale1080.enabled && !edit.enhanceSuite.upscale1080.keepAspect;

  onProgress({
    requestId,
    backend: 'mediarecorder-native',
    stage: 'probing',
    ratio: 0.04,
    elapsedMs: 0,
    detail: 'Menyiapkan akselerasi hardware kamera HP…',
  });

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video') as VideoWithRvfc;
  video.playsInline = true;
  video.preload = 'auto';
  video.disableRemotePlayback = true;

  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    URL.revokeObjectURL(objectUrl);
    throw new VideoFallbackRequiredError('Kanvas 2D hardware tidak tersedia.');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  let audioCtx: AudioContext | null = null;
  let canvasStream: MediaStream | null = null;
  let combinedStream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let rvfcId: number | null = null;
  let rafId: number | null = null;
  let cancelled = false;

  const stopTracks = (stream: MediaStream | null) => {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // Ignore already-ended track cleanup
      }
    }
  };

  const cleanupMedia = () => {
    if (rvfcId !== null && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(rvfcId);
      rvfcId = null;
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    try {
      video.pause();
    } catch {
      // Ignore pause errors
    }
    video.removeAttribute('src');
    video.load();
    stopTracks(combinedStream);
    stopTracks(canvasStream);
    combinedStream = null;
    canvasStream = null;
    if (audioCtx) {
      void audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    canvas.width = 0;
    canvas.height = 0;
    URL.revokeObjectURL(objectUrl);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        detach();
        reject(new VideoFallbackRequiredError('Video terlalu lama memuat metadata hardware.'));
      }, 10_000);

      const onCanPlay = () => {
        detach();
        resolve();
      };
      const onError = () => {
        detach();
        reject(new VideoFallbackRequiredError('Dekoder hardware HP tidak dapat membaca format video ini.'));
      };
      const onAbortLoad = () => {
        cancelled = true;
        detach();
        reject(new VideoCancelledError());
      };
      const detach = () => {
        clearTimeout(timeout);
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('loadeddata', onCanPlay);
        video.removeEventListener('error', onError);
        signal?.removeEventListener('abort', onAbortLoad);
      };

      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('loadeddata', onCanPlay);
      video.addEventListener('error', onError);
      signal?.addEventListener('abort', onAbortLoad, { once: true });
      video.src = objectUrl;
      video.load();
    });

    if (signal?.aborted) {
      throw new VideoCancelledError();
    }

    // Backfill trim end range if source metadata originally reported 0/unknown duration
    if (trim.durationSec <= 0 && Number.isFinite(video.duration) && video.duration > 0) {
      trim = clampTrimRange(edit.trimStartSec, edit.trimEndSec, video.duration);
    }

    if (trim.startSec > 0.05) {
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked, { once: true });
        video.currentTime = trim.startSec;
        setTimeout(() => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        }, 1200);
      });
    }

    const muted = isAudioMuted(edit);
    canvasStream = canvas.captureStream(targetFps);
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

    if (!muted && sourceMetadata.hasAudioHint !== false) {
      try {
        const AudioCtxCtor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtxCtor) {
          audioCtx = new AudioCtxCtor();
          if (audioCtx.state === 'suspended') {
            await audioCtx.resume().catch(() => {});
          }
          const sourceNode = audioCtx.createMediaElementSource(video);
          const streamDest = audioCtx.createMediaStreamDestination();
          sourceNode.connect(streamDest);
          // Connect only to MediaStreamDestination so speakers remain quiet while capturing audio
          tracks.push(...streamDest.stream.getAudioTracks());
          video.muted = false;
          video.volume = 1;
        } else {
          video.muted = true;
        }
      } catch {
        video.muted = true;
      }
    } else {
      video.muted = true;
    }

    combinedStream = new MediaStream(tracks);
    const videoBitsPerSecond = resolveHardwareVideoBitrateBps(edit);
    const audioBitsPerSecond = Math.min(
      160_000,
      Math.max(96_000, getEffectiveAudioBitrateKbps(edit) * 1000)
    );

    try {
      recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond,
        audioBitsPerSecond,
      });
    } catch {
      throw new VideoFallbackRequiredError(
        'Konfigurasi bitrate hardware MP4 ditolak perangkat — beralih ke mode CPU.'
      );
    }

    const isMobileDevice = getDeviceProfile().performanceTier !== 'desktop';
    let capturedFrames = 0;
    let consecutiveSlowFilterFrames = 0;
    let disableSoftwareFilter = false;

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        chunks.push(ev.data);
      }
    };

    const drawFrame = (): number => {
      const drawStart = performance.now();
      const srcW = Math.max(1, video.videoWidth || sourceMetadata.width);
      const srcH = Math.max(1, video.videoHeight || sourceMetadata.height);
      const rect = computeDrawRect(srcW, srcH, dims.width, dims.height, coverFit);
      ctx.save();
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, dims.width, dims.height);
      const applyFilter = !disableSoftwareFilter && visual.cssFilter !== 'none';
      if ('filter' in ctx && applyFilter) {
        ctx.filter = visual.cssFilter;
      }
      ctx.drawImage(video, rect.dx, rect.dy, rect.dw, rect.dh);
      ctx.restore();
      const drawElapsedMs = performance.now() - drawStart;
      if (isMobileDevice && applyFilter) {
        if (drawElapsedMs > 16) {
          consecutiveSlowFilterFrames += 1;
          if (consecutiveSlowFilterFrames >= 3) {
            disableSoftwareFilter = true;
          }
        } else {
          consecutiveSlowFilterFrames = 0;
        }
      }
      return drawElapsedMs;
    };

    const stopPromise = new Promise<void>((resolve, reject) => {
      if (!recorder) {
        resolve();
        return;
      }
      let finished = false;
      let lastDrawAt = -1000;
      let lastProgressEmitAt = -MEDIARECORDER_PROGRESS_THROTTLE_MS;
      let lastPresentedMediaTime = -1;
      const frameIntervalMs = 1000 / targetFps;
      const playStartedAt = Date.now();
      let lastAdvanceAt = playStartedAt;
      let lastObservedTime = video.currentTime;
      const maxWallMs = Math.max(15_000, Math.round(trim.durationSec * 1000 * 2.5 + 10_000));
      let pollId: ReturnType<typeof setInterval> | null = null;
      let waitingTimerId: ReturnType<typeof setTimeout> | null = null;

      const detachListeners = () => {
        if (pollId !== null) {
          clearInterval(pollId);
          pollId = null;
        }
        if (waitingTimerId !== null) {
          clearTimeout(waitingTimerId);
          waitingTimerId = null;
        }
        signal?.removeEventListener('abort', onAbort);
        video.removeEventListener('ended', onVideoEnded);
        video.removeEventListener('error', onVideoError);
        video.removeEventListener('stalled', onVideoStalledOrWaiting);
        video.removeEventListener('waiting', onVideoStalledOrWaiting);
      };

      const finish = () => {
        if (finished) return;
        finished = true;
        detachListeners();
        if (cancelled || signal?.aborted) {
          reject(new VideoCancelledError());
        } else {
          resolve();
        }
      };

      const failWithFallback = (message: string) => {
        if (finished) return;
        finished = true;
        detachListeners();
        try {
          if (recorder && recorder.state !== 'inactive') {
            recorder.onstop = null;
            recorder.stop();
          }
        } catch {
          // Ignore stop errors after stall
        }
        reject(new VideoFallbackRequiredError(message));
      };

      const stopRecorderOnce = () => {
        if (recorder && recorder.state !== 'inactive') {
          try {
            recorder.stop();
          } catch {
            finish();
          }
        } else {
          finish();
        }
      };

      const onVideoEnded = () => {
        drawFrame();
        stopRecorderOnce();
      };

      const onVideoError = () => {
        failWithFallback('Pemutar hardware HP mengalami galat — beralih ke mode CPU.');
      };

      const onVideoStalledOrWaiting = () => {
        if (finished || cancelled || waitingTimerId !== null) return;
        waitingTimerId = setTimeout(() => {
          waitingTimerId = null;
          if (!finished && !cancelled && video.paused) {
            void video.play().catch(() => {});
          }
        }, 1200);
      };

      const onAbort = () => {
        cancelled = true;
        stopRecorderOnce();
        // Force reject if MediaRecorder fails to emit onstop promptly on WebKit/mobile
        setTimeout(() => finish(), 350);
      };

      recorder.onstop = finish;
      recorder.onerror = () => {
        failWithFallback('Perekam hardware MP4 berhenti tiba-tiba.');
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      video.addEventListener('ended', onVideoEnded, { once: true });
      video.addEventListener('error', onVideoError);
      video.addEventListener('stalled', onVideoStalledOrWaiting);
      video.addEventListener('waiting', onVideoStalledOrWaiting);

      pollId = setInterval(() => {
        if (finished || cancelled || signal?.aborted) return;
        const nowMs = Date.now();
        const curTime = video.currentTime;
        if (Math.abs(curTime - lastObservedTime) >= 0.01) {
          lastObservedTime = curTime;
          lastAdvanceAt = nowMs;
        }
        if (curTime >= trim.endSec - 0.04 || video.ended) {
          drawFrame();
          stopRecorderOnce();
          return;
        }
        if (nowMs - lastAdvanceAt >= 10_000) {
          failWithFallback(
            'Pemutaran hardware HP terhenti tanpa progres (10 dtk) — beralih ke mode CPU.'
          );
          return;
        }
        if (nowMs - playStartedAt >= maxWallMs) {
          failWithFallback(
            'Batas waktu mode cepat hardware HP terlampaui — beralih ke mode CPU.'
          );
        }
      }, 400);

      const tick = (now: number, frameMeta?: { mediaTime: number }) => {
        if (finished || cancelled || signal?.aborted) {
          return;
        }
        const curTime = frameMeta?.mediaTime ?? video.currentTime;
        if (Math.abs(curTime - lastObservedTime) >= 0.01) {
          lastObservedTime = curTime;
          lastAdvanceAt = Date.now();
        }
        if (curTime >= trim.endSec - 0.04 || video.ended) {
          drawFrame();
          stopRecorderOnce();
          return;
        }

        const isNewDecodedFrame =
          !frameMeta ||
          lastPresentedMediaTime < 0 ||
          frameMeta.mediaTime > lastPresentedMediaTime + 1e-4;

        if (isNewDecodedFrame && now - lastDrawAt >= frameIntervalMs * 0.85) {
          if (frameMeta) {
            lastPresentedMediaTime = frameMeta.mediaTime;
          }
          lastDrawAt = now;
          drawFrame();
          capturedFrames += 1;

          if (now - lastProgressEmitAt >= MEDIARECORDER_PROGRESS_THROTTLE_MS) {
            lastProgressEmitAt = now;
            const ratio = Math.min(
              0.97,
              Math.max(
                0.08,
                (curTime - trim.startSec) / Math.max(0.1, trim.durationSec)
              )
            );
            onProgress({
              requestId,
              backend: 'mediarecorder-native',
              stage: 'transcoding',
              ratio,
              elapsedMs: performance.now() - t0,
              detail: 'Menyandikan MP4 dengan Mode Cepat Hardware HP…',
            });
          }
        }

        if (typeof video.requestVideoFrameCallback === 'function') {
          rvfcId = video.requestVideoFrameCallback((cbNow, meta) => tick(cbNow, meta));
        } else {
          rafId = requestAnimationFrame((ts) => tick(ts));
        }
      };

      // Paint first frame before starting recorder so output never starts black
      drawFrame();
      recorder.start(1000);

      video.play().then(
        () => {
          tick(performance.now());
        },
        () => {
          failWithFallback(
            'Pemutaran latar belakang hardware tidak diizinkan browser — beralih ke mode CPU.'
          );
        }
      );
    });

    await stopPromise;

    if (signal?.aborted || cancelled) {
      throw new VideoCancelledError();
    }

    const expectedFps = Math.min(
      targetFps,
      sourceMetadata.fpsHint && sourceMetadata.fpsHint > 0 ? sourceMetadata.fpsHint : targetFps
    );
    const smoothness = evaluateMediaRecorderSmoothness({
      capturedFrames,
      durationSec: trim.durationSec,
      expectedFps,
    });
    if (!smoothness.isSmooth) {
      throw new VideoFallbackRequiredError(
        `Mode cepat hardware HP melewatkan ${Math.round(smoothness.dropRatio * 100)}% frame — beralih otomatis agar gerakan tetap mulus.`
      );
    }

    const outputBlob = new Blob(chunks, {
      type: edit.outputFormat === 'mov' ? formatMeta.mime : 'video/mp4',
    });
    if (outputBlob.size < 1024) {
      throw new VideoFallbackRequiredError('Output MediaRecorder MP4 kosong.');
    }

    onProgress({
      requestId,
      backend: 'mediarecorder-native',
      stage: 'finalizing',
      ratio: 0.99,
      elapsedMs: performance.now() - t0,
    });

    return {
      outputBlob,
      outputFileName: buildVideoExportFileName(
        file.name,
        edit.outputFormat,
        edit.targetResolution
      ),
      outputWidth: dims.width,
      outputHeight: dims.height,
      durationSec: trim.durationSec,
      engineDetail: `Hardware HP (MediaRecorder MP4 · ${mimeType})`,
      notice: 'Dirender dengan Mode Cepat Hardware HP (1080p MP4).',
    };
  } finally {
    cleanupMedia();
  }
}
