import type { VideoProcessProgress, VideoProcessRequest } from '../contracts';
import { VideoCancelledError } from './ffmpegVideoEngine';
import {
  buildVideoExportFileName,
  clampTrimRange,
  computeEvenScaledDimensions,
} from './videoPresets';

export class VideoFallbackRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoFallbackRequiredError';
  }
}

export interface WebCodecsTranscodeOutput {
  outputBlob: Blob;
  outputFileName: string;
  outputWidth: number;
  outputHeight: number;
  durationSec: number;
}

export async function runWebCodecsVideoTranscode(
  request: VideoProcessRequest,
  onProgress: (progress: VideoProcessProgress) => void,
  signal?: AbortSignal
): Promise<WebCodecsTranscodeOutput> {
  if (signal?.aborted) {
    throw new VideoCancelledError();
  }

  if (
    typeof VideoDecoder === 'undefined' ||
    typeof VideoEncoder === 'undefined' ||
    typeof VideoFrame === 'undefined'
  ) {
    throw new VideoFallbackRequiredError('Browser tidak mendukung WebCodecs VideoDecoder/Encoder.');
  }

  const t0 = performance.now();
  const { file, sourceMetadata, edit, requestId } = request;

  onProgress({
    requestId,
    backend: 'webcodecs-mediabunny',
    stage: 'probing',
    ratio: 0.03,
    elapsedMs: 0,
    detail: 'Memeriksa akselerasi video perangkat…',
  });

  const mediabunny = await import('mediabunny');
  if (signal?.aborted) {
    throw new VideoCancelledError();
  }

  const {
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    Conversion,
    ConversionCanceledError,
    Input,
    Mp4OutputFormat,
    Output,
    Quality,
    canEncodeVideo,
    canEncodeAudio,
  } = mediabunny;

  const targetDims = computeEvenScaledDimensions(
    sourceMetadata.width,
    sourceMetadata.height,
    edit.maxHeightPx
  );

  const canAvc = await canEncodeVideo('avc', {
    width: targetDims.width,
    height: targetDims.height,
    quality: new Quality({ bitrate: edit.targetBitrateBps, bitrateMode: 'variable' }),
  });

  if (!canAvc) {
    throw new VideoFallbackRequiredError('Encoder H.264 WebCodecs tidak tersedia untuk resolusi target.');
  }

  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });

  try {
    const primaryVideo = await input.getPrimaryVideoTrack();
    if (!primaryVideo) {
      throw new VideoFallbackRequiredError('Trek video tidak terbaca oleh demuxer WebCodecs.');
    }

    const primaryAudio = await input.getPrimaryAudioTrack();
    if (!edit.muteAudio && primaryAudio) {
      const canAac = await canEncodeAudio('aac', {
        quality: new Quality({ bitrate: edit.audioBitrateKbps * 1000, bitrateMode: 'variable' }),
      });
      if (!canAac) {
        throw new VideoFallbackRequiredError('Encoder AAC WebCodecs tidak tersedia.');
      }
    }

    const trim = clampTrimRange(edit.trimStartSec, edit.trimEndSec, sourceMetadata.durationSec);
    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    });

    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      copy: false,
      showWarnings: false,
      ...(trim.isTrimmed ? { trim: { start: trim.startSec, end: trim.endSec } } : {}),
      video: {
        width: targetDims.width,
        height: targetDims.height,
        fit: 'contain',
        codec: 'avc',
        quality: new Quality({ bitrate: edit.targetBitrateBps, bitrateMode: 'variable' }),
        forceTranscode: true,
      },
      audio: edit.muteAudio
        ? { discard: true }
        : {
            codec: 'aac',
            quality: new Quality({
              bitrate: edit.audioBitrateKbps * 1000,
              bitrateMode: 'variable',
            }),
            forceTranscode: true,
          },
    });

    const unexpectedDiscard = conversion.discardedTracks.find(
      (d) => d.reason !== 'discarded_by_user'
    );
    if (!conversion.isValid || unexpectedDiscard) {
      const reason = unexpectedDiscard?.reason ?? 'konfigurasi trek tidak valid';
      throw new VideoFallbackRequiredError(`WebCodecs tidak dapat memproses trek (${reason}).`);
    }

    conversion.onProgress = (progressRatio) => {
      const clamped = Math.min(0.98, Math.max(0.05, Number.isFinite(progressRatio) ? progressRatio : 0));
      onProgress({
        requestId,
        backend: 'webcodecs-mediabunny',
        stage: 'transcoding',
        ratio: clamped,
        elapsedMs: performance.now() - t0,
      });
    };

    const onAbort = () => {
      void conversion.cancel();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      await conversion.execute();
    } catch (err) {
      if (err instanceof ConversionCanceledError || signal?.aborted) {
        throw new VideoCancelledError();
      }
      throw new VideoFallbackRequiredError(
        err instanceof Error ? err.message : 'Eksekusi WebCodecs gagal.'
      );
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }

    if (!target.buffer || target.buffer.byteLength === 0) {
      throw new VideoFallbackRequiredError('Buffer hasil WebCodecs kosong.');
    }

    onProgress({
      requestId,
      backend: 'webcodecs-mediabunny',
      stage: 'finalizing',
      ratio: 0.99,
      elapsedMs: performance.now() - t0,
    });

    return {
      outputBlob: new Blob([target.buffer], { type: 'video/mp4' }),
      outputFileName: buildVideoExportFileName(file.name),
      outputWidth: targetDims.width,
      outputHeight: targetDims.height,
      durationSec: trim.durationSec,
    };
  } finally {
    input.dispose();
  }
}
