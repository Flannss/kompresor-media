import type { FFmpeg } from '@ffmpeg/ffmpeg';
import type { VideoProcessProgress, VideoProcessRequest } from '../contracts';
import { VideoCancelledError } from './videoErrors';
import { hasActiveColorGrade, hasActiveEnhancements } from '../shared/colorGrades';
import { adjustCuesForTrim, serializeToSrt, serializeToVtt } from './subtitleParser';
import { buildFfmpegArgs, getVideoFormatMeta, isAudioMuted } from './videoFilterGraph';
import { buildVideoExportFileName } from './videoPresets';

export { VideoCancelledError };

export interface FfmpegTranscodeOutput {
  outputBlob: Blob;
  outputFileName: string;
  outputWidth: number;
  outputHeight: number;
  durationSec: number;
  notice?: string;
  engineDetail?: string;
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
  if (lower.endsWith('.mkv') || file.type === 'video/x-matroska') {
    return 'mkv';
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
    detail: 'Memuat modul pengolah video & audio…',
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
  const formatMeta = getVideoFormatMeta(edit.outputFormat);

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

  const wantsHardsub =
    edit.subtitle.enabled &&
    edit.subtitle.mode === 'hardsub' &&
    edit.subtitle.cues.length > 0;
  const canBurnHardsubViaWebCodecs =
    wantsHardsub &&
    typeof VideoDecoder !== 'undefined' &&
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined';

  const progressScale = canBurnHardsubViaWebCodecs ? 0.78 : 0.96;

  const progressHandler = ({ progress }: { progress: number }) => {
    if (aborted) return;
    const clamped = Math.min(
      progressScale,
      Math.max(0.05, (Number.isFinite(progress) ? progress : 0) * progressScale)
    );
    onProgress({
      requestId,
      backend: 'ffmpeg-wasm-st',
      stage: 'transcoding',
      ratio: clamped,
      elapsedMs: performance.now() - t0,
      detail: edit.stabilize.enabled
        ? 'Menstabilkan & memproses video…'
        : hasActiveEnhancements(edit.enhanceSuite) || hasActiveColorGrade(edit.colorGrade)
          ? 'Menjernihkan warna & memproses video…'
          : 'Memproses video & audio…',
    });
  };

  instance.on('progress', progressHandler);

  const inputName = `input.${resolveInputExt(file)}`;
  const needsSubtitleFile =
    edit.subtitle.enabled &&
    edit.subtitle.cues.length > 0 &&
    (edit.subtitle.mode === 'softsub' || !canBurnHardsubViaWebCodecs);
  const subExt = edit.outputFormat === 'webm' ? 'vtt' : 'srt';
  const subFileName = needsSubtitleFile ? `subs.${subExt}` : null;

  // If Hardsub burn follows FFmpeg filters, write clean intermediate MP4 for WebCodecs Hardsub stage
  const intermediateEdit = canBurnHardsubViaWebCodecs
    ? {
        ...edit,
        outputFormat: 'mp4' as const,
        crf: Math.min(edit.crf, 20),
      }
    : edit;

  const built = buildFfmpegArgs({
    inputFileNameOnFs: inputName,
    sourceMetadata,
    edit: intermediateEdit,
    subtitleInputFileName: subFileName,
    forceSoftsubFallback: wantsHardsub && !canBurnHardsubViaWebCodecs,
  });

  try {
    if (aborted) {
      throw new VideoCancelledError();
    }

    const inputBytes = new Uint8Array(await file.arrayBuffer());
    await instance.writeFile(inputName, inputBytes);

    if (subFileName && built.subtitleFileNameOnFs) {
      const text =
        subExt === 'vtt'
          ? serializeToVtt(edit.subtitle.cues, built.filterGraph.trimStartSec, built.filterGraph.trimStartSec + built.filterGraph.trimDurationSec)
          : serializeToSrt(edit.subtitle.cues, built.filterGraph.trimStartSec, built.filterGraph.trimStartSec + built.filterGraph.trimDurationSec);
      await instance.writeFile(subFileName, new TextEncoder().encode(text));
    }

    const exitCode = await instance.exec(built.args);
    if (aborted) {
      throw new VideoCancelledError();
    }
    if (exitCode !== 0) {
      throw new Error(`FFmpeg gagal memproses video (kode ${exitCode}).`);
    }

    const rawOut = await instance.readFile(built.outputFileNameOnFs);
    if (!(rawOut instanceof Uint8Array)) {
      throw new Error('Gagal membaca file hasil pemrosesan video.');
    }

    const cleanCopy = new Uint8Array(rawOut.byteLength);
    cleanCopy.set(rawOut);

    await instance.deleteFile(inputName).catch(() => {});
    await instance.deleteFile(built.outputFileNameOnFs).catch(() => {});
    if (subFileName) {
      await instance.deleteFile(subFileName).catch(() => {});
    }

    let outputBlob = new Blob([cleanCopy], {
      type: canBurnHardsubViaWebCodecs ? 'video/mp4' : formatMeta.mime,
    });
    let finalWidth = built.filterGraph.targetWidth;
    let finalHeight = built.filterGraph.targetHeight;
    let finalDuration = built.filterGraph.trimDurationSec;
    let notice: string | undefined;

    if (canBurnHardsubViaWebCodecs) {
      onProgress({
        requestId,
        backend: 'ffmpeg-wasm-st',
        stage: 'muxing',
        ratio: 0.82,
        elapsedMs: performance.now() - t0,
        detail: 'Menanamkan subtitle ke video…',
      });

      const { runWebCodecsVideoTranscode } = await import('./webCodecsVideoEngine');
      const shiftedCues = adjustCuesForTrim(
        edit.subtitle.cues,
        built.filterGraph.trimStartSec,
        built.filterGraph.trimStartSec + built.filterGraph.trimDurationSec
      );
      const intermediateFile = new File([outputBlob], 'filtered.mp4', { type: 'video/mp4' });
      const burned = await runWebCodecsVideoTranscode(
        {
          requestId,
          file: intermediateFile,
          sourceMetadata: {
            ...sourceMetadata,
            mimeType: 'video/mp4',
            width: built.filterGraph.targetWidth,
            height: built.filterGraph.targetHeight,
            durationSec: built.filterGraph.trimDurationSec,
            hasAudioHint: isAudioMuted(edit) ? false : sourceMetadata.hasAudioHint,
          },
          edit: {
            ...edit,
            maxHeightPx: built.filterGraph.targetHeight,
            trimStartSec: 0,
            trimEndSec: null,
            muteAudio: isAudioMuted(edit),
            audio: { ...edit.audio, enabled: false },
            enhanceSuite: {
              ...edit.enhanceSuite,
              noise: { ...edit.enhanceSuite.noise, enabled: false },
              sharpen: { ...edit.enhanceSuite.sharpen, enabled: false },
              colorContrast: { ...edit.enhanceSuite.colorContrast, enabled: false },
              upscale1080: { ...edit.enhanceSuite.upscale1080, enabled: false },
            },
            colorGrade: {
              ...edit.colorGrade,
              gradeId: 'original',
              tone: { temperature: 0, tint: 0, shadows: 0, highlights: 0 },
            },
            stabilize: { ...edit.stabilize, enabled: false },
            subtitle: { ...edit.subtitle, cues: shiftedCues },
          },
        },
        (subProg) => {
          onProgress({
            requestId,
            backend: 'ffmpeg-wasm-st',
            stage: 'muxing',
            ratio: Math.min(0.98, 0.8 + subProg.ratio * 0.18),
            elapsedMs: performance.now() - t0,
            detail: 'Menanamkan subtitle ke video…',
          });
        },
        signal,
        true
      );
      outputBlob = burned.outputBlob;
      finalWidth = burned.outputWidth;
      finalHeight = burned.outputHeight;
      finalDuration = burned.durationSec;
    } else if (wantsHardsub && !canBurnHardsubViaWebCodecs) {
      notice =
        'Subtitle disertakan sebagai trek teks terpisah karena penyandian cepat tidak aktif di perangkat ini.';
    }

    onProgress({
      requestId,
      backend: 'ffmpeg-wasm-st',
      stage: 'finalizing',
      ratio: 0.99,
      elapsedMs: performance.now() - t0,
    });

    const engineDetailParts = [
      built.filterGraph.vfChain ? `vf=${built.filterGraph.vfChain}` : '',
      built.filterGraph.afChain ? `af=${built.filterGraph.afChain}` : '',
    ].filter(Boolean);

    return {
      outputBlob,
      outputFileName: buildVideoExportFileName(file.name, edit.outputFormat),
      outputWidth: finalWidth,
      outputHeight: finalHeight,
      durationSec: finalDuration,
      notice,
      engineDetail: engineDetailParts.length > 0 ? engineDetailParts.join(' · ') : 'ffmpeg-wasm-st (1-pass)',
    };
  } catch (err) {
    await instance.deleteFile(inputName).catch(() => {});
    await instance.deleteFile(built.outputFileNameOnFs).catch(() => {});
    if (subFileName) {
      await instance.deleteFile(subFileName).catch(() => {});
    }
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
