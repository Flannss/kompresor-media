import { describe, expect, it } from 'vitest';
import {
  buildFfmpegArgs,
  buildFfmpegFilterGraph,
  getActiveVideoModuleLabels,
  shouldUseFfmpegBackend,
} from '../engines/video/videoFilterGraph';
import { getMediaPreset } from '../presets/mediaPresets';

describe('videoFilterGraph composable FFmpeg builder & smart routing', () => {
  it('routes simple MP4/WebM compress + trim + hardsub via fast WebCodecs path', () => {
    const base = structuredClone(getMediaPreset('whatsapp-hd').video);
    expect(shouldUseFfmpegBackend(base)).toBe(false);

    base.outputFormat = 'webm';
    base.subtitle = {
      enabled: true,
      mode: 'hardsub',
      size: 'medium',
      position: 'bottom',
      sourceFileName: null,
      cues: [{ id: '1', startSec: 0, endSec: 2, text: 'Tes' }],
    };
    expect(shouldUseFfmpegBackend(base)).toBe(false);
  });

  it('routes MOV/MKV, enhance, stabilizer, audio filters, and softsub via single-pass FFmpeg', () => {
    const mov = structuredClone(getMediaPreset('whatsapp-hd').video);
    mov.outputFormat = 'mov';
    expect(shouldUseFfmpegBackend(mov)).toBe(true);

    const enhanced = structuredClone(getMediaPreset('whatsapp-hd').video);
    enhanced.enhance.enabled = true;
    expect(shouldUseFfmpegBackend(enhanced)).toBe(true);

    const stabilized = structuredClone(getMediaPreset('whatsapp-hd').video);
    stabilized.stabilize.enabled = true;
    expect(shouldUseFfmpegBackend(stabilized)).toBe(true);

    const eq = structuredClone(getMediaPreset('whatsapp-hd').video);
    eq.audio = { ...eq.audio, enabled: true, vocalClarity: true };
    expect(shouldUseFfmpegBackend(eq)).toBe(true);
  });

  it('builds verified single-pass -vf and -af filter chains when combining all modules', () => {
    const edit = structuredClone(getMediaPreset('whatsapp-hd').video);
    edit.outputFormat = 'mkv';
    edit.maxHeightPx = 720;
    edit.fpsCap = 30;
    edit.enhance = {
      enabled: true,
      intensity: 'sharp',
      denoise: 'medium',
      clarity: 50,
      upscaleFactor: 1,
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
    expect(fg.vfChain).toContain('deshake=rx=32:ry=32:edge=mirror');
    expect(fg.vfChain).toContain('hqdn3d=4.0:3.0:6.0:4.5');
    expect(fg.vfChain).toContain('scale=1280:720:flags=lanczos');
    expect(fg.vfChain).toContain('unsharp=5:5:1.05:3:3:0.0');
    expect(fg.vfChain).toContain('eq=contrast=');
    expect(fg.vfChain).toContain('fps=30');

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
    expect(built.args).toContain('matroska');
    expect(built.args).toContain('srt');
    expect(built.args).toContain('aac');
    expect(built.args).toContain('192k');
    expect(built.outputFileNameOnFs).toBe('output.mkv');
    expect(getActiveVideoModuleLabels(edit)).toEqual([
      'Kompres',
      'Jernihkan HD',
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
});
