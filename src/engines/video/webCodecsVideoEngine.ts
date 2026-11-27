import type {
  AudioCodec,
  ConversionVideoOptions,
  VideoCodec,
} from 'mediabunny';
import type { SubtitleCue, VideoProcessProgress, VideoProcessRequest } from '../contracts';
import { compute1080pTargetDimensions } from '../shared/colorGrades';
import { releaseCanvasSurface } from '../image/pipelineRunner';
import { drawHardsubCuesOnCanvas, findActiveCuesAtTime } from './subtitleParser';
import { VideoCancelledError } from './videoErrors';
import {
  getEffectiveAudioBitrateKbps,
  getVideoFormatMeta,
  isAudioMuted,
} from './videoFilterGraph';
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

function createHardsubCanvas(width: number, height: number): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx) return { canvas, ctx };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new VideoFallbackRequiredError('Kanvas 2D tidak tersedia untuk merender subtitle.');
  }
  return { canvas, ctx };
}

function buildHardsubProcessor(
  cues: SubtitleCue[],
  width: number,
  height: number,
  size: 'small' | 'medium' | 'large',
  position: 'bottom' | 'center' | 'top'
): { process: ConversionVideoOptions['process']; dispose: () => void } {
  const { canvas, ctx } = createHardsubCanvas(width, height);
  return {
    process: (sample) => {
      ctx.clearRect(0, 0, width, height);
      sample.draw(ctx, 0, 0, width, height);
      const active = findActiveCuesAtTime(cues, sample.timestamp);
      if (active.length > 0) {
        drawHardsubCuesOnCanvas(ctx, width, height, active, size, position);
      }
      return canvas;
    },
    dispose: () => {
      releaseCanvasSurface(canvas);
    },
  };
}

export async function runWebCodecsVideoTranscode(
  request: VideoProcessRequest,
  onProgress: (progress: VideoProcessProgress) => void,
  signal?: AbortSignal,
  cuesAlreadyTrimmed = false
): Promise<WebCodecsTranscodeOutput> {
  if (signal?.aborted) {
    throw new VideoCancelledError();
  }

  if (
    typeof VideoDecoder === 'undefined' ||
    typeof VideoEncoder === 'undefined' ||
    typeof VideoFrame === 'undefined'
  ) {
    throw new VideoFallbackRequiredError(
      'Browser tidak mendukung WebCodecs VideoDecoder/Encoder.'
    );
  }

  const t0 = performance.now();
  const { file, sourceMetadata, edit, requestId } = request;
  const formatMeta = getVideoFormatMeta(edit.outputFormat);

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
    MkvOutputFormat,
    MovOutputFormat,
    Mp4OutputFormat,
    Output,
    Quality,
    WebMOutputFormat,
    canEncodeAudio,
    canEncodeVideo,
  } = mediabunny;

  const targetDims = edit.enhanceSuite.upscale1080.enabled
    ? compute1080pTargetDimensions(
        sourceMetadata.width,
        sourceMetadata.height,
        edit.enhanceSuite.upscale1080.keepAspect
      )
    : computeEvenScaledDimensions(
        sourceMetadata.width,
        sourceMetadata.height,
        edit.maxHeightPx,
        1
      );

  const videoQuality = new Quality({
    bitrate: edit.targetBitrateBps,
    bitrateMode: 'variable',
  });

  let selectedVideoCodec: VideoCodec;
  let selectedAudioCodec: AudioCodec;

  if (edit.outputFormat === 'webm') {
    const canVp9 = await canEncodeVideo('vp9', {
      width: targetDims.width,
      height: targetDims.height,
      quality: videoQuality,
    });
    if (canVp9) {
      selectedVideoCodec = 'vp9';
    } else {
      const canVp8 = await canEncodeVideo('vp8', {
        width: targetDims.width,
        height: targetDims.height,
        quality: videoQuality,
      });
      if (!canVp8) {
        throw new VideoFallbackRequiredError('Encoder WebM (VP9/VP8) tidak tersedia di WebCodecs.');
      }
      selectedVideoCodec = 'vp8';
    }
    selectedAudioCodec = 'opus';
  } else {
    const canAvc = await canEncodeVideo('avc', {
      width: targetDims.width,
      height: targetDims.height,
      quality: videoQuality,
    });
    if (!canAvc) {
      throw new VideoFallbackRequiredError(
        'Encoder H.264 WebCodecs tidak tersedia untuk resolusi target.'
      );
    }
    selectedVideoCodec = 'avc';
    selectedAudioCodec = 'aac';
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

    const muted = isAudioMuted(edit);
    const audioBitrateBps = getEffectiveAudioBitrateKbps(edit) * 1000;
    const primaryAudio = await input.getPrimaryAudioTrack();
    if (!muted && primaryAudio) {
      const canAud = await canEncodeAudio(selectedAudioCodec, {
        quality: new Quality({ bitrate: audioBitrateBps, bitrateMode: 'variable' }),
      });
      if (!canAud) {
        throw new VideoFallbackRequiredError(`Encoder audio ${selectedAudioCodec.toUpperCase()} tidak tersedia.`);
      }
    }

    const trim = clampTrimRange(edit.trimStartSec, edit.trimEndSec, sourceMetadata.durationSec);
    const target = new BufferTarget();

    const outputFormatObj =
      edit.outputFormat === 'webm'
        ? new WebMOutputFormat()
        : edit.outputFormat === 'mov'
          ? new MovOutputFormat({ fastStart: 'in-memory' })
          : edit.outputFormat === 'mkv'
            ? new MkvOutputFormat()
            : new Mp4OutputFormat({ fastStart: 'in-memory' });

    const output = new Output({
      format: outputFormatObj,
      target,
    });

    const useHardsub =
      edit.subtitle.enabled &&
      edit.subtitle.mode === 'hardsub' &&
      edit.subtitle.cues.length > 0;

    let shiftedCues = edit.subtitle.cues;
    if (useHardsub && !cuesAlreadyTrimmed && trim.isTrimmed) {
      const { adjustCuesForTrim } = await import('./subtitleParser');
      shiftedCues = adjustCuesForTrim(edit.subtitle.cues, trim.startSec, trim.endSec);
    }

    const hardsubHandle =
      useHardsub && shiftedCues.length > 0
        ? buildHardsubProcessor(
            shiftedCues,
            targetDims.width,
            targetDims.height,
            edit.subtitle.size,
            edit.subtitle.position
          )
        : null;

    const videoOptions: ConversionVideoOptions = {
      width: targetDims.width,
      height: targetDims.height,
      fit: 'contain',
      codec: selectedVideoCodec,
      quality: videoQuality,
      forceTranscode: true,
      ...(edit.fpsCap ? { frameRate: edit.fpsCap } : {}),
      ...(hardsubHandle
        ? {
            process: hardsubHandle.process,
            processedWidth: targetDims.width,
            processedHeight: targetDims.height,
          }
        : {}),
    };

    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      copy: false,
      showWarnings: false,
      ...(trim.isTrimmed ? { trim: { start: trim.startSec, end: trim.endSec } } : {}),
      video: videoOptions,
      audio: muted
        ? { discard: true }
        : {
            codec: selectedAudioCodec,
            quality: new Quality({
              bitrate: audioBitrateBps,
              bitrateMode: 'variable',
            }),
            forceTranscode: edit.outputFormat === 'webm',
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
      const clamped = Math.min(
        0.98,
        Math.max(0.05, Number.isFinite(progressRatio) ? progressRatio : 0)
      );
      onProgress({
        requestId,
        backend: 'webcodecs-mediabunny',
        stage: 'transcoding',
        ratio: clamped,
        elapsedMs: performance.now() - t0,
        detail: useHardsub ? 'Memproses video & menanamkan subtitle…' : undefined,
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
      hardsubHandle?.dispose();
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
      outputBlob: new Blob([target.buffer], { type: formatMeta.mime }),
      outputFileName: buildVideoExportFileName(file.name, edit.outputFormat),
      outputWidth: targetDims.width,
      outputHeight: targetDims.height,
      durationSec: trim.durationSec,
    };
  } finally {
    input.dispose();
  }
}
