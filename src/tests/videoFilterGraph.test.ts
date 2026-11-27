import { describe, expect, it } from 'vitest';
import {
  buildFfmpegArgs,
  buildFfmpegFilterGraph,
  getActiveVideoModuleLabels,
  shouldUseFfmpegBackend,
} from '../engines/video/videoFilterGraph';
import { getMediaPreset } from '../presets/mediaPresets';

describe('videoFilterGraph composable FFmpeg builder & smart routing', () => {
  it('routes simple custom/light MP4 & WebM compress without filtergraphs via fast WebCodecs path, and Social-HD presets deterministically via FFmpeg', () => {
    const simpleCustom = structuredClone(getMediaPreset('custom').video);
    expect(shouldUseFfmpegBackend(simpleCustom)).toBe(false);

    const lightPreset = structuredClone(getMediaPreset('web-light').video);
    expect(shouldUseFfmpegBackend(lightPreset)).toBe(false);

    simpleCustom.outputFormat = 'webm';
    simpleCustom.subtitle = {
      enabled: true,
      mode: 'hardsub',
      size: 'medium',
      position: 'bottom',
      sourceFileName: null,
      cues: [{ id: '1', startSec: 0, endSec: 2, text: 'Tes' }],
    };
    expect(shouldUseFfmpegBackend(simpleCustom)).toBe(false);

    for (const socialId of ['whatsapp-hd', 'whatsapp-status', 'instagram-story', 'tiktok-hd'] as const) {
      expect(shouldUseFfmpegBackend(getMediaPreset(socialId).video)).toBe(true);
    }

    const sharp1080 = structuredClone(getMediaPreset('custom').video);
    sharp1080.clarityModel = 'sharp-1080p';
    sharp1080.targetResolution = '1080p';
    expect(shouldUseFfmpegBackend(sharp1080)).toBe(true);
  });

  it('routes MOV/MKV, enhanceSuite, colorGrade, stabilizer, audio filters, and softsub via single-pass FFmpeg', () => {
    const mov = structuredClone(getMediaPreset('custom').video);
    mov.outputFormat = 'mov';
    expect(shouldUseFfmpegBackend(mov)).toBe(true);

    const enhanced = structuredClone(getMediaPreset('custom').video);
    enhanced.enhanceSuite.noise.enabled = true;
    expect(shouldUseFfmpegBackend(enhanced)).toBe(true);

    const graded = structuredClone(getMediaPreset('custom').video);
    graded.colorGrade.gradeId = 'teal-orange';
    expect(shouldUseFfmpegBackend(graded)).toBe(true);

    const stabilized = structuredClone(getMediaPreset('custom').video);
    stabilized.stabilize.enabled = true;
    expect(shouldUseFfmpegBackend(stabilized)).toBe(true);

    const eq = structuredClone(getMediaPreset('custom').video);
    eq.audio = { ...eq.audio, enabled: true, vocalClarity: true };
    expect(shouldUseFfmpegBackend(eq)).toBe(true);
  });

  it('builds single-pass -vf in strict hqdn3d -> scale -> deshake -> color -> unsharp order with anti-deadlock flags', () => {
    const edit = structuredClone(getMediaPreset('custom').video);
    edit.outputFormat = 'mkv';
    edit.targetResolution = '720p';
    edit.maxHeightPx = 720;
    edit.fpsCap = 30;
    edit.enhanceSuite = {
      noise: {
        enabled: true,
        level: 'balanced',
        grainStrength: 4,
        colorSmooth: 3,
        motionStability: 6,
      },
      sharpen: {
        enabled: true,
        strength: 1.05,
        kernelSize: 5,
        antiArtifact: true,
      },
      colorContrast: {
        enabled: true,
        contrast: 10,
        brightness: 4,
        saturation: 10,
        shadowBright: 8,
      },
      upscale1080: {
        enabled: false,
        method: 'lanczos',
        keepAspect: true,
      },
    };
    edit.colorGrade = {
      gradeId: 'teal-orange',
      intensity: 100,
      tone: { temperature: 0, tint: 0, shadows: 0, highlights: 0 },
    };
    edit.stabilize = { enabled: true, mode: 'medium' };
    edit.audio = {
      enabled: true,
      muteAudio: false,
      volumeDb: 3.5,
      normalize: true,
      vocalClarity: true,
      bassDb: 2,
      trebleDb: 1.5,
      fadeInOut: true,
      bitrateKbps: 192,
    };
    edit.subtitle = {
      enabled: true,
      mode: 'softsub',
      size: 'medium',
      position: 'bottom',
      sourceFileName: 'sub.srt',
      cues: [{ id: '1', startSec: 0, endSec: 2, text: 'Halo' }],
    };

    const fg = buildFfmpegFilterGraph({ width: 1920, height: 1080, durationSec: 8 }, edit);
    expect(fg.targetWidth).toBe(1280);
    expect(fg.targetHeight).toBe(720);
    expect(fg.vfChain).toContain('hqdn3d=4.0:3.0:6.0:4.3');
    expect(fg.vfChain).toContain('scale=1280:720:flags=lanczos,setsar=1');
    expect(fg.vfChain).toContain('deshake=rx=32:ry=32:edge=mirror');
    expect(fg.vfChain).toContain('eq=contrast=');
    expect(fg.vfChain).toContain('colorbalance=');
    expect(fg.vfChain).toContain('unsharp=5:5:1.05:3:3:0.0');
    expect(fg.vfChain).toContain('fps=30');

    // Enforce signal chain ordering: hqdn3d before scale, scale before deshake, unsharp after scale
    const idxDenoise = fg.vfChain.indexOf('hqdn3d=');
    const idxScale = fg.vfChain.indexOf('scale=');
    const idxDeshake = fg.vfChain.indexOf('deshake=');
    const idxColor = fg.vfChain.indexOf('colorbalance=');
    const idxUnsharp = fg.vfChain.indexOf('unsharp=');
    expect(idxDenoise).toBeLessThan(idxScale);
    expect(idxScale).toBeLessThan(idxDeshake);
    expect(idxDeshake).toBeLessThan(idxColor);
    expect(idxColor).toBeLessThan(idxUnsharp);

    expect(fg.afChain).toContain('highpass=f=85');
    expect(fg.afChain).toContain('afftdn=nf=-25');
    expect(fg.afChain).toContain('bass=g=2.0');
    expect(fg.afChain).toContain('treble=g=1.5');
    expect(fg.afChain).toContain('volume=3.5dB');
    expect(fg.afChain).toContain('dynaudnorm=f=150:g=15');
    expect(fg.afChain).toContain('afade=t=in:st=0:d=0.5');

    const built = buildFfmpegArgs({
      inputFileNameOnFs: 'input.mp4',
      sourceMetadata: { width: 1920, height: 1080, durationSec: 8, hasAudioHint: true },
      edit,
      subtitleInputFileName: 'subs.srt',
    });
    expect(built.args).toContain('-threads');
    expect(built.args[built.args.indexOf('-threads') + 1]).toBe('1');
    expect(built.args).toContain('-filter_threads');
    expect(built.args[built.args.indexOf('-filter_threads') + 1]).toBe('1');
    expect(built.args).toContain('matroska');
    expect(built.args).toContain('srt');
    expect(built.args).toContain('aac');
    expect(built.args).toContain('192k');
    expect(built.outputFileNameOnFs).toBe('output.mkv');
    expect(getActiveVideoModuleLabels(edit)).toEqual([
      'Kompres',
      '720p',
      'Noise',
      'Tajam',
      'Warna',
      'Filter',
      'Stabilkan',
      'Audio',
      'Subtitle',
    ]);
  });

  it('builds WebM libvpx + libopus + webvtt arguments cleanly when outputFormat is webm', () => {
    const edit = structuredClone(getMediaPreset('whatsapp-fast').video);
    edit.outputFormat = 'webm';
    edit.subtitle = {
      enabled: true,
      mode: 'softsub',
      size: 'medium',
      position: 'bottom',
      sourceFileName: 'sub.vtt',
      cues: [{ id: '1', startSec: 0, endSec: 2, text: 'Tes' }],
    };

    const built = buildFfmpegArgs({
      inputFileNameOnFs: 'input.mp4',
      sourceMetadata: { width: 1280, height: 720, durationSec: 5, hasAudioHint: true },
      edit,
      subtitleInputFileName: 'subs.vtt',
    });
    expect(built.args).toContain('libvpx');
    expect(built.args).toContain('libopus');
    expect(built.args).toContain('webvtt');
    expect(built.args).toContain('webm');
    expect(built.outputFileNameOnFs).toBe('output.webm');
  });

  it('builds distinct filtergraphs for all 4 Video Clarity Models and scales proportionally with clarityStrength', () => {
    const models = ['original', 'natural-hd', 'sharp-1080p', 'low-light'] as const;
    const vfByModel = new Map<string, string>();
    for (const model of models) {
      const edit = structuredClone(getMediaPreset('whatsapp-hd').video);
      edit.clarityModel = model;
      edit.clarityStrength = 100;
      const fg = buildFfmpegFilterGraph({ width: 640, height: 360, durationSec: 10 }, edit);
      expect(fg.targetWidth).toBe(1920);
      expect(fg.targetHeight).toBe(1080);
      expect(fg.vfChain).toContain('scale=1920:1080:flags=lanczos,setsar=1');
      vfByModel.set(model, fg.vfChain);
    }

    expect(new Set(vfByModel.values()).size).toBe(4);
    expect(vfByModel.get('original')).not.toContain('hqdn3d=');
    expect(vfByModel.get('natural-hd')).toContain('unsharp=5:5:0.45:5:5:0.0');
    expect(vfByModel.get('sharp-1080p')).toContain('unsharp=5:5:0.78:5:5:0.0');
    expect(vfByModel.get('sharp-1080p')).toContain('eq=contrast=1.040:saturation=1.050');
    expect(vfByModel.get('low-light')).toContain('hqdn3d=2.80:2.20:4.50:3.50');
    expect(vfByModel.get('low-light')).toContain('eq=gamma=1.080:contrast=1.030:saturation=1.040');

    // Scaling by clarityStrength (0% vs 50% vs 100%)
    const halfEdit = structuredClone(getMediaPreset('whatsapp-hd').video);
    halfEdit.clarityModel = 'sharp-1080p';
    halfEdit.clarityStrength = 50;
    const halfFg = buildFfmpegFilterGraph({ width: 640, height: 360, durationSec: 10 }, halfEdit);
    expect(halfFg.vfChain).toContain('unsharp=5:5:0.39:5:5:0.0');

    const zeroEdit = structuredClone(halfEdit);
    zeroEdit.clarityStrength = 0;
    const zeroFg = buildFfmpegFilterGraph({ width: 640, height: 360, durationSec: 10 }, zeroEdit);
    expect(zeroFg.vfChain).not.toContain('unsharp=');
  });

  it('calibrates all Social-HD presets with veryfast, BT.709 TV range, GOP=60, 48kHz stereo AAC, and VBV caps', () => {
    const specs: Array<[
      'whatsapp-hd' | 'whatsapp-status' | 'instagram-story' | 'tiktok-hd',
      string,
      string,
      string,
    ]> = [
      ['whatsapp-hd', '7500k', '15000k', '128k'],
      ['whatsapp-status', '4800k', '9600k', '128k'],
      ['instagram-story', '8000k', '16000k', '160k'],
      ['tiktok-hd', '8500k', '17000k', '160k'],
    ];

    for (const [presetId, maxrate, bufsize, audioBr] of specs) {
      const edit = structuredClone(getMediaPreset(presetId).video);
      const built = buildFfmpegArgs({
        inputFileNameOnFs: 'input.mp4',
        sourceMetadata: { width: 3840, height: 2160, durationSec: 15, hasAudioHint: true },
        edit,
      });

      expect(built.filterGraph.vfChain).toContain('hqdn3d=');
      expect(built.filterGraph.vfChain).toContain('scale=1920:1080:flags=lanczos,setsar=1');
      expect(built.filterGraph.vfChain).toContain('unsharp=5:5:0.36:5:5:0.0');
      expect(built.filterGraph.vfChain).toContain('fps=30');

      const args = built.args;
      expect(args[args.indexOf('-preset') + 1]).toBe('veryfast');
      expect(args).not.toContain('ultrafast');
      expect(args[args.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
      expect(args[args.indexOf('-profile:v') + 1]).toBe('high');
      expect(args[args.indexOf('-level') + 1]).toBe('4.1');
      expect(args[args.indexOf('-colorspace') + 1]).toBe('bt709');
      expect(args[args.indexOf('-color_primaries') + 1]).toBe('bt709');
      expect(args[args.indexOf('-color_trc') + 1]).toBe('bt709');
      expect(args[args.indexOf('-color_range') + 1]).toBe('tv');
      expect(args[args.indexOf('-g') + 1]).toBe('60');
      expect(args[args.indexOf('-keyint_min') + 1]).toBe('30');
      expect(args[args.indexOf('-sc_threshold') + 1]).toBe('0');
      expect(args).toContain('+faststart');
      expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
      expect(args[args.indexOf('-b:a') + 1]).toBe(audioBr);
      expect(args[args.indexOf('-ar') + 1]).toBe('48000');
      expect(args[args.indexOf('-ac') + 1]).toBe('2');
      expect(args[args.indexOf('-maxrate') + 1]).toBe(maxrate);
      expect(args[args.indexOf('-bufsize') + 1]).toBe(bufsize);
    }
  });
});
