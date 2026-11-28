import type { PerformanceTier } from '../../shared/utils/deviceCapability';
import type {
  VideoEditState,
  VideoMetadata,
  VideoOutputFormat,
  VideoOutputMime,
  VideoPresetId,
} from '../contracts';
import {
  buildColorGradeFfmpegFilters,
  compute1080pTargetDimensions,
  hasActiveColorGrade,
  hasActiveEnhancements,
} from '../shared/colorGrades';
import {
  clampTrimRange,
  computeVideoTargetDimensions,
  VIDEO_CLARITY_MODEL_LABELS,
} from './videoPresets';

export const SOCIAL_HD_PRESET_IDS: ReadonlySet<VideoPresetId> = new Set([
  'whatsapp-hd',
  'whatsapp-status',
  'instagram-story',
  'tiktok-hd',
]);

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
  if (edit.clarityModel && edit.clarityModel !== 'original') {
    labels.push(VIDEO_CLARITY_MODEL_LABELS[edit.clarityModel]);
  }
  if (edit.targetResolution === '2k') {
    labels.push('2K');
  } else if (edit.targetResolution === '1080p' || edit.enhanceSuite.upscale1080.enabled) {
    labels.push('1080p');
  } else if (edit.targetResolution === '720p') {
    labels.push('720p');
  }
  if (edit.enhanceSuite.noise.enabled) labels.push('Noise');
  if (edit.enhanceSuite.sharpen.enabled) labels.push('Tajam');
  if (edit.enhanceSuite.colorContrast.enabled) labels.push('Warna');
  if (hasActiveColorGrade(edit.colorGrade)) labels.push('Filter');
  if (edit.stabilize.enabled) labels.push('Stabilkan');
  if (edit.audio.enabled || edit.muteAudio) labels.push('Audio');
  if (edit.subtitle.enabled && edit.subtitle.cues.length > 0) labels.push('Subtitle');
  if (labels.length === 0) labels.push('Salin');
  return labels;
}

/**
 * KM-T016 Hardware-First Video Router:
 * Routes standard MP4/MOV exports (including Social-HD presets, 1080p/2K scaling, clarity
 * enhancement, and color grading) through Hardware WebCodecs + GPU shader FIRST for
 * desktop/mobile speed & cool thermals. Reserves CPU FFmpeg.wasm strictly for exclusive
 * features (WebM/MKV containers, deshake stabilizer, hardsub/softsub burn, custom audio DSP,
 * or manual temporal hqdn3d noise reduction).
 */
export function shouldUseFfmpegBackend(edit: VideoEditState): boolean {
  if (edit.outputFormat === 'webm' || edit.outputFormat === 'mkv') {
    return true;
  }
  if (edit.stabilize.enabled) {
    return true;
  }
  if (edit.subtitle.enabled && edit.subtitle.cues.length > 0) {
    return true;
  }
  if (hasNonDefaultAudioProcessing(edit)) {
    return true;
  }
  if (edit.enhanceSuite.noise.enabled) {
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
 * 0. fps cap FIRST (drops redundant 60fps frames before 4K scaling/denoise)
 * 1. hqdn3d noise reduction (BEFORE scaling)
 * 2. scale (fast_bilinear/bicubic for 4K downscale, lanczos for upscaling/1080p + setsar=1)
 * 3. deshake stabilizer (if active)
 * 4. eq + colorchannelmixer + colorbalance + curves (100% LUT-free grade & clarity tone)
 * 5. unsharp luminance detail sharpen (AFTER scaling, chroma untouched)
 */
export function buildFfmpegFilterGraph(
  sourceMetadata: Pick<VideoMetadata, 'width' | 'height' | 'durationSec'>,
  edit: VideoEditState,
  performanceTier: PerformanceTier = 'desktop'
): BuiltFfmpegFilterGraph {
  const isMobileTier =
    performanceTier === 'low-memory-mobile' || performanceTier === 'standard-mobile';
  const trim = clampTrimRange(edit.trimStartSec, edit.trimEndSec, sourceMetadata.durationSec);
  const { noise, sharpen, colorContrast, upscale1080 } = edit.enhanceSuite;
  const targetRes = edit.targetResolution ?? 'original';
  const clarityModel = edit.clarityModel ?? 'original';
  const clarityScale = Math.min(1, Math.max(0, (edit.clarityStrength ?? 80) / 100));

  const dims = upscale1080.enabled
    ? compute1080pTargetDimensions(
      sourceMetadata.width,
      sourceMetadata.height,
      upscale1080.keepAspect
    )
    : computeVideoTargetDimensions(
      sourceMetadata.width,
      sourceMetadata.height,
      targetRes,
      edit.maxHeightPx
    );

  const sourceLongEdge = Math.max(sourceMetadata.width, sourceMetadata.height);
  const targetLongEdge = Math.max(dims.width, dims.height);
  const is4kDownscale = sourceLongEdge >= 2560 && targetLongEdge <= 1920;

  const vFilters: string[] = [];

  // Step 0: Place fps cap at VERY START of -vf so excess 60fps frames drop before 4K scaling
  if (edit.fpsCap && edit.fpsCap > 0) {
    vFilters.push(`fps=${edit.fpsCap}`);
  }

  // Step 1: Temporal denoise BEFORE scaling. On mobile CPU fallback, omit heavy 3D hqdn3d for
  // Natural HD & Tajam 1080p (3x-4x cooler/faster while retaining sharpness),
  // reserving hqdn3d for Malam & Minim Cahaya, explicit noise toggle, or Desktop fallback.
  if (noise.enabled) {
    const lumaSpatial = noise.grainStrength.toFixed(1);
    const chromaSpatial = noise.colorSmooth.toFixed(1);
    const lumaTemp = Math.max(1, noise.motionStability).toFixed(1);
    const chromaTemp = Math.max(1, Number((noise.motionStability * 0.72).toFixed(1))).toFixed(1);
    vFilters.push(`hqdn3d=${lumaSpatial}:${chromaSpatial}:${lumaTemp}:${chromaTemp}`);
  } else if (clarityScale > 0.01) {
    if (clarityModel === 'natural-hd' && !isMobileTier) {
      vFilters.push(
        `hqdn3d=${(1.2 * clarityScale).toFixed(2)}:${(1.0 * clarityScale).toFixed(2)}:${(2.5 * clarityScale).toFixed(2)}:${(2.0 * clarityScale).toFixed(2)}`
      );
    } else if (clarityModel === 'sharp-1080p' && !isMobileTier) {
      vFilters.push(
        `hqdn3d=${(1.4 * clarityScale).toFixed(2)}:${(1.1 * clarityScale).toFixed(2)}:${(3.0 * clarityScale).toFixed(2)}:${(2.4 * clarityScale).toFixed(2)}`
      );
    } else if (clarityModel === 'low-light') {
      vFilters.push(
        `hqdn3d=${(2.8 * clarityScale).toFixed(2)}:${(2.2 * clarityScale).toFixed(2)}:${(4.5 * clarityScale).toFixed(2)}:${(3.5 * clarityScale).toFixed(2)}`
      );
    }
  }

  // Step 2: Scaling — use fast_bilinear/bicubic when downscaling >=4K to <=1080p for 3x speed & low RAM
  const scaleFlags = upscale1080.enabled
    ? upscale1080.method
    : is4kDownscale
      ? performanceTier === 'low-memory-mobile'
        ? 'fast_bilinear'
        : 'bicubic'
      : 'lanczos';
  const wantsExplicitResize =
    upscale1080.enabled ||
    targetRes === '1080p' ||
    targetRes === '2k' ||
    dims.width !== sourceMetadata.width ||
    dims.height !== sourceMetadata.height;

  if (upscale1080.enabled && !upscale1080.keepAspect) {
    vFilters.push(
      `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase:flags=${scaleFlags}`,
      `crop=${dims.width}:${dims.height}`,
      'setsar=1'
    );
  } else if (wantsExplicitResize) {
    vFilters.push(`scale=${dims.width}:${dims.height}:flags=${scaleFlags}`, 'setsar=1');
  } else {
    vFilters.push(`scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=${scaleFlags}`, 'setsar=1');
  }

  // Step 3: Deshake stabilizer (if active)
  if (edit.stabilize.enabled) {
    const r = edit.stabilize.mode === 'medium' ? 32 : 16;
    vFilters.push(`deshake=rx=${r}:ry=${r}:edge=mirror`);
  }

  // Step 4: Color Grading, Color/Contrast Enhancement, Clarity Tone & Manual Adjustments
  const colorSegments = buildColorGradeFfmpegFilters(
    edit.colorGrade,
    colorContrast.enabled ? colorContrast : undefined
  );
  vFilters.push(...colorSegments);

  if (clarityScale > 0.01) {
    if (clarityModel === 'sharp-1080p') {
      vFilters.push(
        `eq=contrast=${(1 + 0.04 * clarityScale).toFixed(3)}:saturation=${(1 + 0.05 * clarityScale).toFixed(3)}`
      );
    } else if (clarityModel === 'low-light') {
      vFilters.push(
        `eq=gamma=${(1 + 0.08 * clarityScale).toFixed(3)}:contrast=${(1 + 0.03 * clarityScale).toFixed(3)}:saturation=${(1 + 0.04 * clarityScale).toFixed(3)}`
      );
    }
  }

  // Step 5: Detail sharpening strictly AFTER scaling (chroma untouched)
  if (sharpen.enabled) {
    const k = sharpen.kernelSize;
    const strength = Math.min(2.0, Math.max(0.2, sharpen.strength)).toFixed(2);
    const chromaAmount = sharpen.antiArtifact ? '0.0' : '0.15';
    vFilters.push(`unsharp=${k}:${k}:${strength}:3:3:${chromaAmount}`);
  } else if (clarityScale > 0.01) {
    if (is4kDownscale && isMobileTier) {
      // 4K -> 1080p supersampling on mobile is already crisp; skip heavy unsharp on natural-hd
      if (clarityModel === 'sharp-1080p') {
        vFilters.push(`unsharp=5:5:${(0.25 * clarityScale).toFixed(2)}:5:5:0.0`);
      } else if (clarityModel === 'low-light') {
        vFilters.push(`unsharp=5:5:${(0.25 * clarityScale).toFixed(2)}:5:5:0.0`);
      }
    } else if (clarityModel === 'natural-hd') {
      vFilters.push(`unsharp=5:5:${(0.45 * clarityScale).toFixed(2)}:5:5:0.0`);
    } else if (clarityModel === 'sharp-1080p') {
      vFilters.push(`unsharp=5:5:${(0.78 * clarityScale).toFixed(2)}:5:5:0.0`);
    } else if (clarityModel === 'low-light') {
      vFilters.push(`unsharp=5:5:${(0.35 * clarityScale).toFixed(2)}:5:5:0.0`);
    }
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
  performanceTier?: PerformanceTier;
}): BuiltFfmpegArgs {
  const {
    inputFileNameOnFs,
    sourceMetadata,
    edit,
    subtitleInputFileName,
    forceSoftsubFallback,
    performanceTier = 'desktop',
  } = params;

  const isMobileTier =
    performanceTier === 'low-memory-mobile' || performanceTier === 'standard-mobile';
  const formatMeta = getVideoFormatMeta(edit.outputFormat);
  const outputFileNameOnFs = `output.${formatMeta.ext}`;
  const fg = buildFfmpegFilterGraph(sourceMetadata, edit, performanceTier);

  const crf = edit.compressEnabled
    ? hasActiveEnhancements(edit.enhanceSuite)
      ? Math.max(18, edit.crf - 2)
      : edit.crf
    : 19;

  const args: string[] = [];

  // Generate missing PTS on VFR phone clips (.MOV/.MP4) to prevent demuxer/muxer stalls
  args.push('-fflags', '+genpts');

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
      isMobileTier ? 'superfast' : 'veryfast',
      ...(isMobileTier ? ['-tune', 'fastdecode'] : []),
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
      'bt709',
      '-color_range',
      'tv',
      '-g',
      '60',
      '-keyint_min',
      '30',
      '-sc_threshold',
      '0'
    );
    if (edit.outputFormat === 'mp4' || edit.outputFormat === 'mov') {
      args.push('-movflags', '+faststart');
    }
  }

  if (isAudioMuted(edit) || sourceMetadata.hasAudioHint === false) {
    args.push('-an');
  } else {
    if (fg.afChain) {
      args.push('-af', fg.afChain);
    }
    const aBitrate = getEffectiveAudioBitrateKbps(edit);
    if (edit.outputFormat === 'webm') {
      args.push('-c:a', 'libopus', '-b:a', `${aBitrate}k`);
    } else {
      args.push('-c:a', 'aac', '-b:a', `${aBitrate}k`, '-ar', '48000', '-ac', '2');
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

  args.push('-max_muxing_queue_size', '1024', '-f', formatMeta.ffmpegFormat, outputFileNameOnFs);

  return {
    args,
    outputFileNameOnFs,
    subtitleFileNameOnFs: attachSoftsub ? (subtitleInputFileName ?? null) : null,
    filterGraph: fg,
  };
}
