import type {
  VideoEditState,
  VideoMetadata,
  VideoOutputFormat,
  VideoOutputMime,
} from '../contracts';
import {
  buildColorGradeFfmpegFilters,
  compute1080pTargetDimensions,
  hasActiveColorGrade,
  hasActiveEnhancements,
} from '../shared/colorGrades';
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
  if (edit.enhanceSuite.noise.enabled) labels.push('Noise');
  if (edit.enhanceSuite.sharpen.enabled) labels.push('Tajam');
  if (edit.enhanceSuite.colorContrast.enabled) labels.push('Warna');
  if (edit.enhanceSuite.upscale1080.enabled) labels.push('1080p');
  if (hasActiveColorGrade(edit.colorGrade)) labels.push('Filter');
  if (edit.stabilize.enabled) labels.push('Stabilkan');
  if (edit.audio.enabled || edit.muteAudio) labels.push('Audio');
  if (edit.subtitle.enabled && edit.subtitle.cues.length > 0) labels.push('Subtitle');
  if (labels.length === 0) labels.push('Salin');
  return labels;
}

/**
 * Smart hybrid router: picks hardware WebCodecs + mediabunny for standard MP4/WebM
 * compression/trim/mute/hardsub, and switches to single-pass FFmpeg WASM whenever
 * MOV/MKV, Enhancement Suite, Color Grading/Tone, Stabilizer, Audio DSP, or Softsub are active.
 */
export function shouldUseFfmpegBackend(edit: VideoEditState): boolean {
  if (edit.outputFormat === 'mov' || edit.outputFormat === 'mkv') {
    return true;
  }
  if (hasActiveEnhancements(edit.enhanceSuite) || hasActiveColorGrade(edit.colorGrade)) {
    return true;
  }
  if (edit.stabilize.enabled) {
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
 * Optimal LUT-free single-pass FFmpeg signal pipeline:
 * 1. hqdn3d noise reduction (BEFORE scaling)
 * 2. scale (lanczos/bicubic + orientation-aware 1920x1080 / 1080x1920 when enabled)
 * 3. deshake stabilizer (if active)
 * 4. eq + colorchannelmixer + colorbalance + curves (100% LUT-free grade & tone)
 * 5. unsharp detail sharpen (AFTER scaling, chroma untouched when antiArtifact=true)
 * 6. fps cap (when selected)
 */
export function buildFfmpegFilterGraph(
  sourceMetadata: Pick<VideoMetadata, 'width' | 'height' | 'durationSec'>,
  edit: VideoEditState
): BuiltFfmpegFilterGraph {
  const trim = clampTrimRange(edit.trimStartSec, edit.trimEndSec, sourceMetadata.durationSec);
  const { noise, sharpen, colorContrast, upscale1080 } = edit.enhanceSuite;
  const isWhatsAppPreset =
    edit.presetId === 'whatsapp-hd' || edit.presetId === 'whatsapp-status';

  const dims = upscale1080.enabled
    ? compute1080pTargetDimensions(
        sourceMetadata.width,
        sourceMetadata.height,
        upscale1080.keepAspect
      )
    : computeEvenScaledDimensions(
        sourceMetadata.width,
        sourceMetadata.height,
        edit.maxHeightPx,
        1
      );

  const vFilters: string[] = [];

  // Step 1: Denoise BEFORE scaling to prevent amplifying grain (plus subtle WA anti-blur pass)
  if (noise.enabled) {
    const lumaSpatial = noise.grainStrength.toFixed(1);
    const chromaSpatial = noise.colorSmooth.toFixed(1);
    const lumaTemp = Math.max(1, noise.motionStability).toFixed(1);
    const chromaTemp = Math.max(1, Number((noise.motionStability * 0.72).toFixed(1))).toFixed(1);
    vFilters.push(`hqdn3d=${lumaSpatial}:${chromaSpatial}:${lumaTemp}:${chromaTemp}`);
  } else if (isWhatsAppPreset) {
    vFilters.push('hqdn3d=1.5:1.2:3.0:2.2');
  }

  // Step 2: Scaling (with aspect lock or clean center-fill to 16:9 / 9:16 1080p)
  const scaleFlags = upscale1080.enabled ? upscale1080.method : 'lanczos';
  const needsScale =
    upscale1080.enabled ||
    dims.width !== sourceMetadata.width ||
    dims.height !== sourceMetadata.height ||
    vFilters.length === 0;

  if (needsScale) {
    if (upscale1080.enabled && !upscale1080.keepAspect) {
      vFilters.push(
        `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase:flags=${scaleFlags}`,
        `crop=${dims.width}:${dims.height}`
      );
    } else {
      vFilters.push(`scale=${dims.width}:${dims.height}:flags=${scaleFlags}`);
    }
  }

  // Step 3: Deshake stabilizer (if active)
  if (edit.stabilize.enabled) {
    const r = edit.stabilize.mode === 'medium' ? 32 : 16;
    vFilters.push(`deshake=rx=${r}:ry=${r}:edge=mirror`);
  }

  // Step 4: Color Grading, Color/Contrast Enhancement & Manual Tone Adjustments (LUT-free)
  const colorSegments = buildColorGradeFfmpegFilters(
    edit.colorGrade,
    colorContrast.enabled ? colorContrast : undefined
  );
  vFilters.push(...colorSegments);

  // Step 5: Detail sharpening strictly AFTER scaling (pre-compensate WA second-pass softness)
  if (sharpen.enabled) {
    const k = sharpen.kernelSize;
    const strength = Math.min(2.0, Math.max(0.2, sharpen.strength)).toFixed(2);
    const chromaAmount = sharpen.antiArtifact ? '0.0' : '0.15';
    vFilters.push(`unsharp=${k}:${k}:${strength}:3:3:${chromaAmount}`);
  } else if (isWhatsAppPreset) {
    vFilters.push('unsharp=5:5:0.45:5:5:0.0');
  }

  // Step 6: FPS cap
  if (edit.fpsCap && edit.fpsCap > 0) {
    vFilters.push(`fps=${edit.fpsCap}`);
  }

  // Audio DSP filtergraph
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
    ? hasActiveEnhancements(edit.enhanceSuite)
      ? Math.max(18, edit.crf - 2)
      : edit.crf
    : 19;

  const args: string[] = [];

  if (fg.trimStartSec > 0.01) {
    args.push('-ss', fg.trimStartSec.toFixed(3));
  }
  args.push('-i', inputFileNameOnFs);

  // Strict single-thread anti-deadlock protection for mobile & desktop WASM
  args.push('-threads', '1', '-filter_threads', '1');

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
      '-profile:v',
      'high',
      '-level',
      '4.1',
      '-preset',
      'veryfast',
      '-crf',
      String(crf),
      '-maxrate',
      `${edit.maxrateKbps}k`,
      '-bufsize',
      `${edit.bufsizeKbps}k`,
      '-pix_fmt',
      'yuv420p',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709'
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
      args.push('-c:a', 'aac', '-b:a', `${aBitrate}k`, '-ar', '48000');
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
