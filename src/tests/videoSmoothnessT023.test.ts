import { describe, expect, it } from 'vitest';
import {
  buildCfrFrameSchedule,
  buildHardwareH264EncoderConfig,
  MAX_VFR_FRAME_DURATION_US,
  MIN_VFR_FRAME_DURATION_US,
  normalizeVfrFrameTimingsUs,
} from '../engines/video/webCodecsVideoEngine';
import {
  evaluateMediaRecorderSmoothness,
  MEDIARECORDER_MAX_DROP_RATIO,
  MEDIARECORDER_PROGRESS_THROTTLE_MS,
} from '../engines/video/mediaRecorderVideoEngine';
import { buildFfmpegArgs } from '../engines/video/videoFilterGraph';
import { getMediaPreset } from '../presets/mediaPresets';

describe('KM-T023: Video Frame-Smoothness & CFR Cadence Guarantees', () => {
  it('configures WebCodecs H.264 encoder with latencyMode: quality (never frame-dropping realtime)', () => {
    const cfg30 = buildHardwareH264EncoderConfig({
      codec: 'avc1.640028',
      width: 1920,
      height: 1080,
      bitrate: 8_500_000,
    });
    expect(cfg30.latencyMode).toBe('quality');
    expect(cfg30.hardwareAcceleration).toBe('prefer-hardware');
    expect(cfg30.framerate).toBe(30);
    expect(cfg30.avc).toEqual({ format: 'avc' });

    const cfg60 = buildHardwareH264EncoderConfig({
      codec: 'avc1.640028',
      width: 1920,
      height: 1080,
      bitrate: 10_000_000,
      framerate: 60,
    });
    expect(cfg60.latencyMode).toBe('quality');
    expect(cfg60.framerate).toBe(60);
  });

  it('builds uniform zero-drift CFR schedules with 2-second keyframe cadence and zero 1us glitches', () => {
    const slots30 = buildCfrFrameSchedule({ totalFrames: 125, targetFps: 30, keyframeIntervalSec: 2 });
    expect(slots30).toHaveLength(125);
    expect(slots30[0].outTimestampUs).toBe(0);
    expect(slots30[30].outTimestampUs).toBe(1_000_000);
    expect(slots30[60].outTimestampUs).toBe(2_000_000);
    expect(slots30[120].outTimestampUs).toBe(4_000_000);

    expect(slots30.filter((s) => s.isKeyFrame).map((s) => s.frameIndex)).toEqual([0, 60, 120]);
    for (let i = 0; i < slots30.length; i += 1) {
      expect(slots30[i].outDurationUs).toBeGreaterThanOrEqual(33_333);
      if (i > 0) {
        expect(slots30[i].outTimestampUs).toBeGreaterThan(slots30[i - 1].outTimestampUs);
      }
    }

    const slots60 = buildCfrFrameSchedule({ totalFrames: 125, targetFps: 60 });
    expect(slots60.filter((s) => s.isKeyFrame).map((s) => s.frameIndex)).toEqual([0, 120]);
    expect(slots60[60].outTimestampUs).toBe(1_000_000);
  });

  it('normalizes duplicate smartphone VFR timestamps within [8ms, 100ms] without 1us duration spikes', () => {
    const normalized = normalizeVfrFrameTimingsUs({
      rawTimestampsUs: [100_000, 133_333, 133_333, 133_333, 166_667, 666_667],
      fallbackFps: 30,
    });

    expect(normalized).toHaveLength(6);
    expect(normalized[0].outTimestampUs).toBe(0);
    for (let i = 0; i < normalized.length; i += 1) {
      expect(normalized[i].outDurationUs).toBeGreaterThanOrEqual(MIN_VFR_FRAME_DURATION_US);
      expect(normalized[i].outDurationUs).toBeLessThanOrEqual(MAX_VFR_FRAME_DURATION_US);
      if (i > 0) {
        expect(normalized[i].outTimestampUs - normalized[i - 1].outTimestampUs).toBeGreaterThanOrEqual(
          MIN_VFR_FRAME_DURATION_US
        );
      }
    }
  });

  it('enforces MediaRecorder throttle and >20% frame-drop FFmpeg fallback policy', () => {
    expect(MEDIARECORDER_PROGRESS_THROTTLE_MS).toBe(500);
    expect(MEDIARECORDER_MAX_DROP_RATIO).toBe(0.2);

    const droppedTooMuch = evaluateMediaRecorderSmoothness({
      capturedFrames: 50,
      durationSec: 3,
      expectedFps: 30,
    });
    expect(droppedTooMuch.dropRatio).toBeGreaterThan(0.2);
    expect(droppedTooMuch.isSmooth).toBe(false);

    const smoothRun = evaluateMediaRecorderSmoothness({
      capturedFrames: 82,
      durationSec: 3,
      expectedFps: 30,
    });
    expect(smoothRun.dropRatio).toBeLessThanOrEqual(0.2);
    expect(smoothRun.isSmooth).toBe(true);

    const ultraShortClip = evaluateMediaRecorderSmoothness({
      capturedFrames: 5,
      durationSec: 0.8,
      expectedFps: 30,
    });
    expect(ultraShortClip.isSmooth).toBe(true);
  });

  it('configures FFmpeg with -fps_mode cfr, dynamic GOP keyframes, aresample A/V sync, and no fastdecode on HD', () => {
    const vlog = structuredClone(getMediaPreset('vlog-hd').video);
    vlog.fpsCap = 30;
    const built30 = buildFfmpegArgs({
      inputFileNameOnFs: 'vlog.mov',
      sourceMetadata: { width: 1920, height: 1080, durationSec: 12, hasAudioHint: true },
      edit: vlog,
      performanceTier: 'desktop',
    });

    expect(built30.encoderPreset).toBe('veryfast');
    expect(built30.args[built30.args.indexOf('-fps_mode') + 1]).toBe('cfr');
    expect(built30.args[built30.args.indexOf('-g') + 1]).toBe('60');
    expect(built30.args[built30.args.indexOf('-keyint_min') + 1]).toBe('30');
    expect(built30.args[built30.args.indexOf('-preset') + 1]).toBe('veryfast');
    expect(built30.args).not.toContain('-tune');
    expect(built30.args[built30.args.indexOf('-af') + 1]).toContain('aresample=async=1:first_pts=0');

    vlog.fpsCap = 60;
    const built60 = buildFfmpegArgs({
      inputFileNameOnFs: 'vlog60.mov',
      sourceMetadata: { width: 1920, height: 1080, durationSec: 12, hasAudioHint: true },
      edit: vlog,
      performanceTier: 'desktop',
    });
    expect(built60.args[built60.args.indexOf('-g') + 1]).toBe('120');
    expect(built60.args[built60.args.indexOf('-keyint_min') + 1]).toBe('60');
  });
});
