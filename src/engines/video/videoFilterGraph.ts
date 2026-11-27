import type {
  VideoEditState,
  VideoMetadata,
  VideoOutputFormat,
  VideoOutputMime,
} from '../contracts';
import { clampTrimRange, computeEvenScaledDimensions } from './videoPresets';

export interface VideoFormatMeta {
  format: VideoOutputFormat;
  mime: VideoOutputMime;
  ext: string;
  label: string;
  ffmpegFormat: 'mp4' | 'mov' | 'matroska' | 'webm';
}

export const VIDEO_FORMAT_META: Record<VideoOutputFormat, VideoFormatMeta> = {
  mp4: { format: 'mp4', mime: 'video/mp4', ext: 'mp4', label: 'MP4', ffmpegFormat: 'mp4' },
  mov: { format: 'mov', mime: 'video/quicktime', ext: 'mov', label: 'MOV', ffmpegFormat: 'mov' },
  webm: { format: 'webm', mime: 'video/webm', ext: 'webm', label: 'WebM', ffmpegFormat: 'webm' },
  mkv: { format: 'mkv', mime: 'video/x-matroska', ext: 'mkv', label: 'MKV', ffmpegFormat: 'matroska' },
};

export function getVideoFormatMeta(format: VideoOutputFormat): VideoFormatMeta {
  return VIDEO_FORMAT_META[format] ?? VIDEO_FORMAT_META.mp4;
}

export function hasNonDefaultAudioProcessing(edit: VideoEditState): boolean {
  if (!edit.audio.enabled) {
    return false;
  }
  const a = edit.audio;
  return (
    Math.abs(a.volumeDb) >= 0.25 ||
    a.normalize ||
    a.vocalClarity ||
    Math.abs(a.bassDb) >= 0.25 ||
    Math.abs(a.trebleDb) >= 0.25 ||
    a.fadeInOut
  );
}

export function isAudioMuted(edit: VideoEditState): boolean {
  return edit.muteAudio || (edit.audio.enabled && edit.audio.muteAudio);
}

export function getEffectiveAudioBitrateKbps(edit: VideoEditState): number {
  return edit.audio.enabled ? edit.audio.bitrateKbps : edit.audioBitrateKbps;
}

export function getActiveVideoModuleLabels(edit: VideoEditState): string[] {
  const labels: string[] = [];
  if (edit.compressEnabled) labels.push('Kompres');
  if (edit.enhance.enabled) labels.push('Jernihkan HD');
  if (edit.stabilize.enabled) labels.push('Stabilkan');
  if (edit.audio.enabled || edit.muteAudio) labels.push('Audio');
  if (edit.subtitle.enabled && edit.subtitle.cues.length > 0) labels.push('Subtitle');
  if (labels.length === 0) labels.push('Salin');
  return labels;
}

/**
 * Decides whether the composable pipeline requires FFmpeg WASM filters/muxers,
 * vs running fast hardware-accelerated WebCodecs + mediabunny.
 */
export function shouldUseFfmpegBackend(edit: VideoEditState): boolean {
  if (edit.outputFormat === 'mov' || edit.outputFormat === 'mkv') {
    return true;
  }
  if (edit.enhance.enabled || edit.stabilize.enabled) {
    return true;
  }
  if (hasNonDefaultAudioProcessing(edit)) {
    return true;
  }
  if (
    edit.subtitle.enabled &&
    edit.subtitle.mode === 'softsub' &&
    edit.subtitle.cues.length > 0
  ) {
    return true;
  }
  return false;
}

export interface BuiltFfmpegFilterGraph {
  vfChain: string;
  afChain: string | null;
  targetWidth: number;
  targetHeight: number;
  trimDurationSec: number;
  trimStartSec: number;
  hasTrim: boolean;
}

/**
 * Builds verified FFmpeg -vf and -af chains compiled cleanly into @ffmpeg/core 0.12.10:
 * deshake, hqdn3d, scale (lanczos), unsharp, eq, fps, highpass, lowpass, afftdn, bass, treble, volume, dynaudnorm, afade.
 */
export function buildFfmpegFilterGraph(
  sourceMetadata: Pick<VideoMetadata, 'width' | 'height' | 'durationSec'>,
  edit: VideoEditState
): BuiltFfmpegFilterGraph {
  const trim = clampTrimRange(edit.trimStartSec, edit.trimEndSec, sourceMetadata.durationSec);
  const upscale = edit.enhance.enabled ? edit.enhance.upscaleFactor : 1;
  const dims = computeEvenScaledDimensions(
    sourceMetadata.width,
    sourceMetadata.height,
    edit.maxHeightPx,
    upscale
  );

  const vFilters: string[] = [];

  if (edit.stabilize.enabled) {
    const r = edit.stabilize.mode === 'medium' ? 32 : 16;
    vFilters.push(`deshake=rx=${r}:ry=${r}:edge=mirror`);
  }

  if (edit.enhance.enabled && edit.enhance.denoise !== 'off') {
    if (edit.enhance.denoise === 'medium') {
      vFilters.push('hqdn3d=4.0:3.0:6.0:4.5');
    } else {
      vFilters.push('hqdn3d=2.2:1.6:3.5:2.5');
    }
  }

  const needsScale =
    dims.width !== sourceMetadata.width ||
    dims.height !== sourceMetadata.height ||
    edit.enhance.enabled ||
    vFilters.length === 0;
  if (needsScale) {
    const flags = edit.enhance.enabled ? ':flags=lanczos' : '';
    vFilters.push(`scale=${dims.width}:${dims.height}${flags}`);
  }

  if (edit.enhance.enabled) {
    const lumaAmt =
      edit.enhance.intensity === 'sharp'
        ? '1.05'
        : edit.enhance.intensity === 'balanced'
          ? '0.70'
          : '0.40';
    vFilters.push(`unsharp=5:5:${lumaAmt}:3:3:0.0`);

    if (edit.enhance.clarity > 0) {
      const contrast = (1 + (edit.enhance.clarity / 100) * 0.12).toFixed(3);
      const saturation = (1 + (edit.enhance.clarity / 100) * 0.09).toFixed(3);
      vFilters.push(`eq=contrast=${contrast}:saturation=${saturation}`);
    }
  }

  if (edit.fpsCap && edit.fpsCap > 0) {
    vFilters.push(`fps=${edit.fpsCap}`);
  }

  const aFilters: string[] = [];
  if (!isAudioMuted(edit) && edit.audio.enabled) {
    const a = edit.audio;
    if (a.vocalClarity) {
      aFilters.push('highpass=f=85', 'lowpass=f=12000', 'afftdn=nf=-25');
    }
    if (Math.abs(a.bassDb) >= 0.25) {
      aFilters.push(`bass=g=${a.bassDb.toFixed(1)}`);
    }
    if (Math.abs(a.trebleDb) >= 0.25) {
      aFilters.push(`treble=g=${a.trebleDb.toFixed(1)}`);
    }
    if (Math.abs(a.volumeDb) >= 0.25) {
      aFilters.push(`volume=${a.volumeDb.toFixed(1)}dB`);
    }
    if (a.normalize) {
      aFilters.push('dynaudnorm=f=150:g=15');
    }
    if (a.fadeInOut && trim.durationSec >= 1.2) {
      const fadeOutStart = Math.max(0.5, Number((trim.durationSec - 0.5).toFixed(3)));
      aFilters.push('afade=t=in:st=0:d=0.5', `afade=t=out:st=${fadeOutStart}:d=0.5`);
    }
  }

  return {
    vfChain: vFilters.join(','),
    afChain: aFilters.length > 0 ? aFilters.join(',') : null,
    targetWidth: dims.width,
    targetHeight: dims.height,
    trimDurationSec: trim.durationSec,
    trimStartSec: trim.startSec,
    hasTrim: trim.isTrimmed,
  };
}

export interface BuiltFfmpegArgs {
  args: string[];
  outputFileNameOnFs: string;
  subtitleFileNameOnFs: string | null;
  filterGraph: BuiltFfmpegFilterGraph;
}

export function buildFfmpegArgs(params: {
  inputFileNameOnFs: string;
  sourceMetadata: Pick<VideoMetadata, 'width' | 'height' | 'durationSec' | 'hasAudioHint'>;
  edit: VideoEditState;
  subtitleInputFileName?: string | null;
  forceSoftsubFallback?: boolean;
}): BuiltFfmpegArgs {
  const { inputFileNameOnFs, sourceMetadata, edit, subtitleInputFileName, forceSoftsubFallback } =
    params;

  const formatMeta = getVideoFormatMeta(edit.outputFormat);
  const outputFileNameOnFs = `output.${formatMeta.ext}`;
  const fg = buildFfmpegFilterGraph(sourceMetadata, edit);

  const crf = edit.compressEnabled
    ? edit.enhance.enabled
      ? Math.max(18, edit.crf - 2)
      : edit.crf
    : 19;

  const args: string[] = [];

  if (fg.trimStartSec > 0.01) {
    args.push('-ss', fg.trimStartSec.toFixed(3));
  }
  args.push('-i', inputFileNameOnFs);

  const attachSoftsub =
    Boolean(subtitleInputFileName) &&
    edit.subtitle.enabled &&
    edit.subtitle.cues.length > 0 &&
    (edit.subtitle.mode === 'softsub' || Boolean(forceSoftsubFallback));

  if (attachSoftsub && subtitleInputFileName) {
    args.push('-i', subtitleInputFileName);
  }

  if (fg.hasTrim && fg.trimDurationSec > 0) {
    args.push('-t', fg.trimDurationSec.toFixed(3));
  }

  if (attachSoftsub) {
    args.push('-map', '0:v:0');
    if (!isAudioMuted(edit)) {
      args.push('-map', '0:a?');
    }
    args.push('-map', '1:0');
  } else if (isAudioMuted(edit)) {
    args.push('-map', '0:v:0');
  }

  args.push('-vf', fg.vfChain);

  if (edit.outputFormat === 'webm') {
    const kbps = Math.max(400, Math.round(edit.targetBitrateBps / 1000));
    args.push(
      '-c:v',
      'libvpx',
      '-b:v',
      `${kbps}k`,
      '-crf',
      String(Math.min(36, Math.max(15, crf))),
      '-deadline',
      'realtime',
      '-cpu-used',
      '5',
      '-pix_fmt',
      'yuv420p'
    );
  } else {
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      String(crf),
      '-maxrate',
      `${edit.maxrateKbps}k`,
      '-bufsize',
      `${edit.bufsizeKbps}k`,
      '-pix_fmt',
      'yuv420p'
    );
    if (edit.outputFormat === 'mp4' || edit.outputFormat === 'mov') {
      args.push('-movflags', '+faststart');
    }
  }

  if (isAudioMuted(edit)) {
    args.push('-an');
  } else {
    if (fg.afChain) {
      args.push('-af', fg.afChain);
    }
    const aBitrate = getEffectiveAudioBitrateKbps(edit);
    if (edit.outputFormat === 'webm') {
      args.push('-c:a', 'libopus', '-b:a', `${aBitrate}k`);
    } else {
      args.push('-c:a', 'aac', '-b:a', `${aBitrate}k`);
    }
  }

  if (attachSoftsub) {
    if (edit.outputFormat === 'mkv') {
      args.push('-c:s', 'srt');
    } else if (edit.outputFormat === 'webm') {
      args.push('-c:s', 'webvtt');
    } else {
      args.push('-c:s', 'mov_text');
    }
  }

  args.push('-f', formatMeta.ffmpegFormat, outputFileNameOnFs);

  return {
    args,
    outputFileNameOnFs,
    subtitleFileNameOnFs: attachSoftsub ? (subtitleInputFileName ?? null) : null,
    filterGraph: fg,
  };
}
