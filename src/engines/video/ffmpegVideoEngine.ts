import type { FFmpeg } from '@ffmpeg/ffmpeg';
import type { VideoProcessProgress, VideoProcessRequest } from '../contracts';
import { VideoCancelledError } from './videoErrors';
import { getDeviceProfile } from '../../shared/utils/deviceCapability';
import { isCancellationError } from '../../shared/utils/friendlyError';
import { hasActiveColorGrade, hasActiveEnhancements } from '../shared/colorGrades';
import { adjustCuesForTrim, serializeToSrt, serializeToVtt } from './subtitleParser';
import { buildFfmpegArgs, getVideoFormatMeta, isAudioMuted } from './videoFilterGraph';
import { buildVideoExportFileName } from './videoPresets';

export { VideoCancelledError };

export const DEFAULT_FFMPEG_STALL_MS = 35_000;
export const DEFAULT_FFMPEG_LOAD_TIMEOUT_MS = 20_000;
export const WORKERFS_MOUNT_THRESHOLD_BYTES = 150 * 1024 * 1024; // 150 MB
export const MAX_MOBILE_MEMFS_BYTES = 250 * 1024 * 1024; // 250 MB safe MEMFS ceiling on mobile
export const MAX_DESKTOP_MEMFS_BYTES = 750 * 1024 * 1024; // 750 MB safe MEMFS ceiling on desktop

export interface FfmpegTranscodeOutput {
  outputBlob: Blob;
  outputFileName: string;
  outputWidth: number;
  outputHeight: number;
  durationSec: number;
  notice?: string;
  engineDetail?: string;
}

/**
 * Parses `time=HH:MM:SS.xx` emitted by FFmpeg stderr logs into elapsed media seconds
 * so progress UI continues advancing even when WASM progress hooks freeze at 0%.
 */
export function parseFfmpegTimeSeconds(logLine: string): number | null {
  if (!logLine) return null;
  const match = /time=\s*(-?\d{1,3}):(\d{2}):(\d{2}(?:\.\d+)?)/i.exec(logLine);
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  const secs = Number(match[3]);
  if (!Number.isFinite(hours) || !Number.isFinite(mins) || !Number.isFinite(secs)) {
    return null;
  }
  const total = hours * 3600 + mins * 60 + secs;
  return total >= 0 && Number.isFinite(total) ? Number(total.toFixed(3)) : null;
}

let cachedFfmpeg: FFmpeg | null = null;
let inFlightFfmpeg: FFmpeg | null = null;
let ffmpegInstanceDirty = false;
let ffmpegExecutionChain: Promise<void> = Promise.resolve();

// In-memory cached raw binaries so Run #2+ mints fresh Blob URLs immediately without re-downloading WASM
let cachedCoreBuffer: ArrayBuffer | null = null;
let cachedWasmBuffer: ArrayBuffer | null = null;
let activeBlobUrls: { coreURL: string; wasmURL: string } | null = null;

export function isFfmpegInstanceCached(): boolean {
  return cachedFfmpeg !== null && !ffmpegInstanceDirty;
}

function revokeTrackedBlobUrls(): void {
  if (!activeBlobUrls) return;
  const urls = activeBlobUrls;
  activeBlobUrls = null;
  try {
    URL.revokeObjectURL(urls.coreURL);
  } catch {
    // Ignore revoke failures
  }
  try {
    URL.revokeObjectURL(urls.wasmURL);
  } catch {
    // Ignore revoke failures
  }
}

function discardCachedFfmpeg(target?: FFmpeg | null): void {
  const seen = new Set<FFmpeg>();
  const candidates = target ? [target] : [inFlightFfmpeg, cachedFfmpeg];
  for (const inst of candidates) {
    if (!inst || seen.has(inst)) continue;
    seen.add(inst);
    try {
      inst.terminate();
    } catch {
      // Ignore worker termination failures
    }
  }
  if (!target || inFlightFfmpeg === target) {
    inFlightFfmpeg = null;
  }
  if (!target || cachedFfmpeg === target) {
    cachedFfmpeg = null;
    ffmpegInstanceDirty = false;
    revokeTrackedBlobUrls();
  }
}

/**
 * Synchronously terminates any cached or loading FFmpeg worker (used on user cancel).
 */
export function terminateActiveFfmpeg(): void {
  ffmpegInstanceDirty = true;
  discardCachedFfmpeg();
}

/**
 * Clears cached FFmpeg buffers and worker singleton cleanly between tests.
 */
export function resetFfmpegEngineForTests(): void {
  discardCachedFfmpeg();
  cachedCoreBuffer = null;
  cachedWasmBuffer = null;
  ffmpegExecutionChain = Promise.resolve();
}

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

function resolveBaseUri(): string {
  if (typeof document !== 'undefined' && document.baseURI) {
    return document.baseURI;
  }
  if (typeof self !== 'undefined' && self.location?.href) {
    return self.location.href;
  }
  return 'https://localhost/';
}

async function resolveCoreAndWasmUrls(): Promise<{ coreURL: string; wasmURL: string }> {
  const baseUri = resolveBaseUri();
  const rawCoreUrl = new URL('./ffmpeg/ffmpeg-core.js', baseUri).href;
  const rawWasmUrl = new URL('./ffmpeg/ffmpeg-core.wasm', baseUri).href;

  try {
    if (
      typeof fetch === 'function' &&
      typeof URL.createObjectURL === 'function' &&
      rawCoreUrl.startsWith('http')
    ) {
      if (!cachedCoreBuffer || !cachedWasmBuffer) {
        const [coreResp, wasmResp] = await Promise.all([
          fetch(rawCoreUrl, { cache: 'force-cache' }),
          fetch(rawWasmUrl, { cache: 'force-cache' }),
        ]);
        if (coreResp.ok && wasmResp.ok) {
          const [coreBuf, wasmBuf] = await Promise.all([
            coreResp.arrayBuffer(),
            wasmResp.arrayBuffer(),
          ]);
          if (coreBuf.byteLength > 1024 && wasmBuf.byteLength > 1024) {
            cachedCoreBuffer = coreBuf;
            cachedWasmBuffer = wasmBuf;
          }
        }
      }

      if (cachedCoreBuffer && cachedWasmBuffer) {
        revokeTrackedBlobUrls();
        const coreBlobUrl = URL.createObjectURL(
          new Blob([cachedCoreBuffer], { type: 'text/javascript' })
        );
        const wasmBlobUrl = URL.createObjectURL(
          new Blob([cachedWasmBuffer], { type: 'application/wasm' })
        );
        activeBlobUrls = { coreURL: coreBlobUrl, wasmURL: wasmBlobUrl };
        return { coreURL: coreBlobUrl, wasmURL: wasmBlobUrl };
      }
    }
  } catch {
    // Fall back cleanly to direct URLs when fetch or Blob URLs are unavailable (e.g. unit tests)
  }

  return { coreURL: rawCoreUrl, wasmURL: rawWasmUrl };
}

function runSerializedFfmpeg<T>(
  task: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new VideoCancelledError());
  }

  let releaseTurn!: () => void;
  const nextTurn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  const previousTurn = ffmpegExecutionChain;
  ffmpegExecutionChain = previousTurn.then(
    () => nextTurn,
    () => nextTurn
  );

  return (async () => {
    try {
      await previousTurn;
      if (signal?.aborted) {
        throw new VideoCancelledError();
      }
      return await task();
    } finally {
      releaseTurn();
    }
  })();
}

async function getOrLoadFfmpeg(
  requestId: string,
  startTimeMs: number,
  onProgress: (progress: VideoProcessProgress) => void,
  signal?: AbortSignal,
  loadTimeoutMs = DEFAULT_FFMPEG_LOAD_TIMEOUT_MS
): Promise<FFmpeg> {
  if (signal?.aborted) {
    throw new VideoCancelledError();
  }

  if (cachedFfmpeg && ffmpegInstanceDirty) {
    discardCachedFfmpeg(cachedFfmpeg);
  }

  if (cachedFfmpeg?.loaded) {
    onProgress({
      requestId,
      backend: 'ffmpeg-wasm-st',
      stage: 'loading-core',
      ratio: 0.05,
      elapsedMs: performance.now() - startTimeMs,
      detail: 'Menyiapkan mesin pengolah video…',
    });
    return cachedFfmpeg;
  }

  const { FFmpeg: FfmpegCtor } = await import('@ffmpeg/ffmpeg');
  if (signal?.aborted) {
    throw new VideoCancelledError();
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) {
      throw new VideoCancelledError();
    }

    onProgress({
      requestId,
      backend: 'ffmpeg-wasm-st',
      stage: 'loading-core',
      ratio: attempt === 0 ? 0.04 : 0.05,
      elapsedMs: performance.now() - startTimeMs,
      detail:
        attempt === 0
          ? 'Memuat modul pengolah video & audio…'
          : 'Menyiapkan ulang modul video di perangkat…',
    });

    const instance = new FfmpegCtor();
    inFlightFfmpeg = instance;
    ffmpegInstanceDirty = false;

    let abortedHere = Boolean(signal?.aborted);
    const onAbortWhileLoading = () => {
      abortedHere = true;
      ffmpegInstanceDirty = true;
      discardCachedFfmpeg(instance);
    };
    signal?.addEventListener('abort', onAbortWhileLoading, { once: true });

    let loadTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      const { coreURL, wasmURL } = await resolveCoreAndWasmUrls();
      if (abortedHere || signal?.aborted) {
        throw new VideoCancelledError();
      }

      await Promise.race([
        instance.load({ coreURL, wasmURL }),
        new Promise<never>((_resolve, reject) => {
          loadTimer = setTimeout(() => {
            ffmpegInstanceDirty = true;
            discardCachedFfmpeg(instance);
            reject(
              new Error(
                'Gagal memuat modul video dalam batas waktu. Mencoba ulang…'
              )
            );
          }, loadTimeoutMs);
        }),
      ]);

      if (abortedHere || signal?.aborted) {
        throw new VideoCancelledError();
      }

      // Publish singleton ONLY after worker load completes cleanly
      inFlightFfmpeg = null;
      cachedFfmpeg = instance;
      ffmpegInstanceDirty = false;
      return instance;
    } catch (err) {
      if (abortedHere || signal?.aborted || isCancellationError(err)) {
        ffmpegInstanceDirty = true;
        discardCachedFfmpeg(instance);
        throw new VideoCancelledError();
      }

      lastError = err;
      ffmpegInstanceDirty = true;
      discardCachedFfmpeg(instance);

      // Clear cached raw buffers in case they were corrupted and retry once cleanly
      if (attempt === 0) {
        cachedCoreBuffer = null;
        cachedWasmBuffer = null;
        await new Promise((r) => setTimeout(r, 40));
        continue;
      }
      throw err;
    } finally {
      if (loadTimer !== null) {
        clearTimeout(loadTimer);
      }
      signal?.removeEventListener('abort', onAbortWhileLoading);
      if (inFlightFfmpeg === instance) {
        inFlightFfmpeg = null;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Modul pengolah video gagal dimuat di browser. Coba segarkan halaman.');
}

export async function runFfmpegVideoTranscode(
  request: VideoProcessRequest,
  onProgress: (progress: VideoProcessProgress) => void,
  signal?: AbortSignal,
  options?: { stallTimeoutMs?: number; loadTimeoutMs?: number }
): Promise<FfmpegTranscodeOutput> {
  return runSerializedFfmpeg(
    () => executeFfmpegTranscode(request, onProgress, signal, options),
    signal
  );
}

async function executeFfmpegTranscode(
  request: VideoProcessRequest,
  onProgress: (progress: VideoProcessProgress) => void,
  signal?: AbortSignal,
  options?: { stallTimeoutMs?: number; loadTimeoutMs?: number }
): Promise<FfmpegTranscodeOutput> {
  const t0 = performance.now();
  const { file, sourceMetadata, edit, requestId } = request;
  const formatMeta = getVideoFormatMeta(edit.outputFormat);
  const stallTimeoutMs = options?.stallTimeoutMs ?? DEFAULT_FFMPEG_STALL_MS;
  const loadTimeoutMs = options?.loadTimeoutMs ?? DEFAULT_FFMPEG_LOAD_TIMEOUT_MS;
  const profile = getDeviceProfile();

  let aborted = Boolean(signal?.aborted);
  let activeInstance: FFmpeg | null = null;
  const onAbort = () => {
    aborted = true;
    ffmpegInstanceDirty = true;
    discardCachedFfmpeg(activeInstance);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  let execWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  let progressHandler: (({ progress }: { progress: number }) => void) | null = null;
  let logHandler: (({ message }: { message: string }) => void) | null = null;

  let mountedWorkerFsDir: string | null = null;
  let wroteMemfsInputName: string | null = null;
  let wroteSubFileName: string | null = null;
  let outputFileNameOnFs: string | null = null;

  try {
    if (aborted) {
      throw new VideoCancelledError();
    }

    const instance = await getOrLoadFfmpeg(
      requestId,
      t0,
      onProgress,
      signal,
      loadTimeoutMs
    );
    activeInstance = instance;

    if (aborted) {
      throw new VideoCancelledError();
    }

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

    const inputExt = resolveInputExt(file);
    let inputPathOnFs = `input.${inputExt}`;
    let mountedViaWorkerFs = false;

    const canMountWorkerFs =
      file.size >= WORKERFS_MOUNT_THRESHOLD_BYTES &&
      typeof instance.mount === 'function' &&
      typeof instance.createDir === 'function';

    if (canMountWorkerFs) {
      const workerDir = `/worker_in_${requestId.replace(/[^a-z0-9_-]/gi, '').slice(0, 12) || 'vid'}`;
      try {
        await instance.createDir(workerDir);
        const safeBaseName = file.name.split(/[/\\]/).pop() || `input.${inputExt}`;
        const workerFile =
          safeBaseName === file.name
            ? file
            : new File([file], safeBaseName, { type: file.type, lastModified: file.lastModified });
        const mountedOk = await instance.mount(
          'WORKERFS' as Parameters<FFmpeg['mount']>[0],
          { files: [workerFile] } as Parameters<FFmpeg['mount']>[1],
          workerDir
        );
        if (mountedOk) {
          mountedViaWorkerFs = true;
          mountedWorkerFsDir = workerDir;
          inputPathOnFs = `${workerDir}/${workerFile.name}`;
        } else {
          await instance.deleteDir?.(workerDir).catch(() => {});
        }
      } catch {
        await instance.deleteDir?.(workerDir).catch(() => {});
        mountedViaWorkerFs = false;
      }
    }

    if (!mountedViaWorkerFs) {
      const memfsCeilingBytes =
        profile.performanceTier === 'low-memory-mobile'
          ? MAX_MOBILE_MEMFS_BYTES
          : MAX_DESKTOP_MEMFS_BYTES;
      if (file.size > memfsCeilingBytes) {
        throw new Error(
          'Memori browser tidak mencukupi untuk menyalin file video ini ke mode cadangan. Gunakan profil Video Panjang (MP4 H.264 1080p) agar diproses secara streaming tanpa batas RAM.'
        );
      }
      const inputBytes = new Uint8Array(await file.arrayBuffer());
      if (aborted) {
        throw new VideoCancelledError();
      }
      await instance.writeFile(inputPathOnFs, inputBytes);
      wroteMemfsInputName = inputPathOnFs;
    }

    const needsSubtitleFile =
      edit.subtitle.enabled &&
      edit.subtitle.cues.length > 0 &&
      (edit.subtitle.mode === 'softsub' || !canBurnHardsubViaWebCodecs);
    const subExt = edit.outputFormat === 'webm' ? 'vtt' : 'srt';
    const subFileName = needsSubtitleFile ? `subs.${subExt}` : null;

    const intermediateEdit = canBurnHardsubViaWebCodecs
      ? {
          ...edit,
          outputFormat: 'mp4' as const,
          crf: Math.min(edit.crf, 20),
        }
      : edit;

    const built = buildFfmpegArgs({
      inputFileNameOnFs: inputPathOnFs,
      sourceMetadata,
      edit: intermediateEdit,
      subtitleInputFileName: subFileName,
      forceSoftsubFallback: wantsHardsub && !canBurnHardsubViaWebCodecs,
      performanceTier: profile.performanceTier,
    });
    outputFileNameOnFs = built.outputFileNameOnFs;

    let lastActivityAt = Date.now();
    let lastReportedRatio = 0.05;
    const detailText = edit.stabilize.enabled
      ? 'Menstabilkan & memproses video…'
      : hasActiveEnhancements(edit.enhanceSuite) || hasActiveColorGrade(edit.colorGrade)
        ? 'Menjernihkan warna & memproses video…'
        : 'Memproses video & audio…';

    const emitMonotonicProgress = (rawRatio: number) => {
      if (aborted) return;
      lastActivityAt = Date.now();
      const clamped = Math.min(progressScale, Math.max(lastReportedRatio, rawRatio));
      lastReportedRatio = clamped;
      onProgress({
        requestId,
        backend: 'ffmpeg-wasm-st',
        stage: 'transcoding',
        ratio: clamped,
        elapsedMs: performance.now() - t0,
        detail: detailText,
      });
    };

    progressHandler = ({ progress }: { progress: number }) => {
      if (aborted) return;
      const candidate = (Number.isFinite(progress) ? Math.max(0, progress) : 0) * progressScale;
      emitMonotonicProgress(Math.max(0.05, candidate));
    };

    logHandler = ({ message }: { message: string }) => {
      if (aborted) return;
      lastActivityAt = Date.now();
      const parsedSec = parseFfmpegTimeSeconds(message);
      if (parsedSec !== null) {
        const expectedDur = Math.max(
          0.25,
          built.filterGraph.trimDurationSec || sourceMetadata.durationSec || 1
        );
        const ratio = (parsedSec / expectedDur) * progressScale;
        emitMonotonicProgress(Math.min(progressScale, Math.max(0.05, ratio)));
      }
    };

    instance.on('progress', progressHandler);
    instance.on('log', logHandler);

    if (subFileName && built.subtitleFileNameOnFs) {
      const text =
        subExt === 'vtt'
          ? serializeToVtt(
              edit.subtitle.cues,
              built.filterGraph.trimStartSec,
              built.filterGraph.trimStartSec + built.filterGraph.trimDurationSec
            )
          : serializeToSrt(
              edit.subtitle.cues,
              built.filterGraph.trimStartSec,
              built.filterGraph.trimStartSec + built.filterGraph.trimDurationSec
            );
      await instance.writeFile(subFileName, new TextEncoder().encode(text));
      wroteSubFileName = subFileName;
    }

    onProgress({
      requestId,
      backend: 'ffmpeg-wasm-st',
      stage: 'transcoding',
      ratio: 0.06,
      elapsedMs: performance.now() - t0,
      detail: detailText,
    });

    const exitCode = await Promise.race([
      instance.exec(built.args),
      new Promise<never>((_resolve, reject) => {
        execWatchdogTimer = setInterval(() => {
          if (aborted) return;
          if (Date.now() - lastActivityAt >= stallTimeoutMs) {
            ffmpegInstanceDirty = true;
            discardCachedFfmpeg(instance);
            reject(
              new Error(
                'Proses video terhenti karena memori atau dekoder browser penuh. Klik Coba Lagi atau gunakan resolusi 720p.'
              )
            );
          }
        }, 400);
      }),
    ]);

    if (aborted) {
      throw new VideoCancelledError();
    }
    if (exitCode !== 0) {
      throw new Error('Gagal memproses video pada tahap penyandian internal. Coba resolusi 720p atau format MP4.');
    }

    const rawOut = await instance.readFile(built.outputFileNameOnFs);
    if (!(rawOut instanceof Uint8Array)) {
      throw new Error('Gagal membaca file hasil pemrosesan video.');
    }

    const cleanCopy = new Uint8Array(rawOut.byteLength);
    cleanCopy.set(rawOut);

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
            targetResolution: 'original',
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

    const presetTag = built.encoderPreset;
    const engineDetailParts = [
      `ffmpeg-wasm-st (${presetTag})`,
      mountedViaWorkerFs ? 'workerfs-zero-copy' : '',
      built.filterGraph.vfChain ? `vf=${built.filterGraph.vfChain}` : '',
      built.filterGraph.afChain ? `af=${built.filterGraph.afChain}` : '',
    ].filter(Boolean);

    return {
      outputBlob,
      outputFileName: buildVideoExportFileName(
        file.name,
        edit.outputFormat,
        edit.targetResolution
      ),
      outputWidth: finalWidth,
      outputHeight: finalHeight,
      durationSec: finalDuration,
      notice,
      engineDetail: engineDetailParts.join(' · '),
    };
  } catch (err) {
    if (aborted || signal?.aborted || isCancellationError(err)) {
      ffmpegInstanceDirty = true;
      discardCachedFfmpeg(activeInstance);
      throw new VideoCancelledError();
    }
    ffmpegInstanceDirty = true;
    discardCachedFfmpeg(activeInstance);
    throw err;
  } finally {
    if (execWatchdogTimer !== null) {
      clearInterval(execWatchdogTimer);
      execWatchdogTimer = null;
    }
    signal?.removeEventListener('abort', onAbort);
    if (activeInstance) {
      if (progressHandler) {
        activeInstance.off('progress', progressHandler);
      }
      if (logHandler) {
        activeInstance.off('log', logHandler);
      }
      if (!aborted) {
        if (mountedWorkerFsDir) {
          await activeInstance.unmount?.(mountedWorkerFsDir).catch(() => {});
          await activeInstance.deleteDir?.(mountedWorkerFsDir).catch(() => {});
        }
        if (wroteMemfsInputName) {
          await activeInstance.deleteFile(wroteMemfsInputName).catch(() => {});
        }
        if (outputFileNameOnFs) {
          await activeInstance.deleteFile(outputFileNameOnFs).catch(() => {});
        }
        if (wroteSubFileName) {
          await activeInstance.deleteFile(wroteSubFileName).catch(() => {});
        }
        if (profile.releaseFfmpegAfterExport && !ffmpegInstanceDirty) {
          discardCachedFfmpeg(activeInstance);
        }
      }
    }
  }
}
