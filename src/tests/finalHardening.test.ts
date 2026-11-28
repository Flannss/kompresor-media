import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from '../components/AppErrorBoundary';
import type {
  ColorGradeId,
  PhotoFilterId,
  PhotoQualityModel,
  VideoClarityModel,
} from '../engines/contracts';
import { COLOR_GRADE_PRESETS } from '../engines/shared/colorGrades';
import { PHOTO_FILTER_PRESETS } from '../engines/grading/photoFilters';
import * as imageEngineClient from '../engines/image/imageEngineClient';
import {
  runImagePipeline,
  type Canvas2DContextLike,
  type CanvasAdapter,
  type CanvasSurfaceLike,
} from '../engines/image/pipelineRunner';
import {
  computeCropPixels,
  computePhotoTargetDimensions,
  computePlannedPhotoDimensions,
  computeRotatedDimensions,
  computeTargetDimensions,
} from '../engines/image/pixelOps';
import { PRO_PHOTO_TOOL_IDS } from '../engines/image/proTools';
import {
  clampTrimRange,
  computeEvenScaledDimensions,
  computeVideoTargetDimensions,
} from '../engines/video/videoPresets';
import * as fileValidator from '../features/upload/fileValidator';
import * as metadataReader from '../features/upload/metadataReader';
import { getMediaPreset, MEDIA_PRESETS } from '../presets/mediaPresets';
import { useMediaStore } from '../store/useMediaStore';

interface TrackedCanvas extends CanvasSurfaceLike {
  data: Uint8ClampedArray;
}

function makeTrackedAdapter(createdCanvases: Array<{ width: number; height: number }>) {
  const adapter: CanvasAdapter<TrackedCanvas> = {
    createCanvas(width: number, height: number): TrackedCanvas {
      createdCanvases.push({ width, height });
      const data = new Uint8ClampedArray(width * height * 4);
      const canvas: TrackedCanvas = {
        width,
        height,
        data,
        getContext(): Canvas2DContextLike {
          return {
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
            save() {},
            restore() {},
            translate() {},
            rotate() {},
            scale() {},
            drawImage() {
              for (let i = 0; i < data.length; i += 4) {
                data[i] = 128;
                data[i + 1] = 124;
                data[i + 2] = 118;
                data[i + 3] = 255;
              }
            },
            getImageData(_sx: number, _sy: number, sw: number, sh: number): ImageData {
              return { width: sw, height: sh, data } as unknown as ImageData;
            },
            putImageData(imageData: ImageData) {
              data.set(imageData.data);
            },
          };
        },
      };
      return canvas;
    },
    async encodeBlob(canvas: TrackedCanvas, format) {
      return new Blob([Uint8Array.from(canvas.data.subarray(0, 64))], { type: format });
    },
  };
  return adapter;
}

describe('KM-T018 Final Hardening: ErrorBoundary, Numeric Guards, Mobile Pre-Scale & Full Store Parity', () => {
  beforeEach(() => {
    useMediaStore.getState().clearMedia();
    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', {
        value: () => `blob:mock/${Math.random()}`,
        configurable: true,
      });
    } else {
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock/${Math.random()}`);
    }
    if (!URL.revokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        value: () => {},
        configurable: true,
      });
    } else {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    }
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useMediaStore.getState().clearMedia();
  });

  it('captures runtime crashes inside AppErrorBoundary with Midnight Slate recovery and onReset reset', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;

    function CrashableChild() {
      if (shouldThrow) {
        throw new Error('Simulasi crash canvas render');
      }
      return React.createElement('div', { 'data-testid': 'recovered-studio' }, 'Studio Pulih');
    }

    const onReset = vi.fn(() => {
      shouldThrow = false;
    });

    render(
      React.createElement(AppErrorBoundary, {
        onReset,
        children: React.createElement(CrashableChild),
      })
    );

    const card = screen.getByTestId('error-boundary-card');
    expect(card.textContent).toContain('Kompresor Media');
    expect(card.textContent).toContain('BY AMDZ');
    expect(card.textContent).toContain('Simulasi crash canvas render');

    const reloadBtn = screen.getByTestId('error-reload-btn');
    const resetBtn = screen.getByTestId('error-reset-btn');
    expect(reloadBtn.textContent).toContain('Muat Ulang Studio');
    expect(resetBtn.textContent).toContain('Kembali ke Beranda');

    fireEvent.click(resetBtn);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('recovered-studio').textContent).toBe('Studio Pulih');
    errorSpy.mockRestore();
  });

  it('guards NaN, Infinity, zero, and ultra-short duration edges safely in image & video dimension helpers', () => {
    expect(computeRotatedDimensions(0, Number.NaN, 90)).toEqual({ width: 1, height: 1 });
    expect(computeRotatedDimensions(Number.POSITIVE_INFINITY, 800, 180)).toEqual({
      width: 1,
      height: 800,
    });

    expect(computeCropPixels(0, -10, null)).toEqual({ sx: 0, sy: 0, sw: 1, sh: 1 });
    expect(
      computeCropPixels(1000, 800, { x: Number.NaN, y: Number.NaN, width: 0, height: -5 })
    ).toEqual({ sx: 0, sy: 0, sw: 10, sh: 8 });

    expect(() => computeTargetDimensions(0, 0, 1600)).toThrow(/Dimensi foto tidak valid/);
    const photoEdit = structuredClone(getMediaPreset('whatsapp-hd').image);
    photoEdit.targetResolution = '2k';
    expect(() =>
      computePhotoTargetDimensions(Number.NaN, 800, photoEdit, { allow8K: true })
    ).toThrow(/Dimensi foto tidak valid/);

    photoEdit.rotationDeg = 90;
    const rotated2k = computePlannedPhotoDimensions(1200, 800, photoEdit, { allow8K: true });
    expect(rotated2k.width).toBe(1707);
    expect(rotated2k.height).toBe(2560);

    expect(() => computeVideoTargetDimensions(0, Number.NaN, '1080p', null)).toThrow(
      /Resolusi video tidak valid/
    );
    expect(() => computeEvenScaledDimensions(-100, Number.NaN, 1080)).toThrow(
      /Resolusi video tidak valid/
    );

    // Ultra-short < 0.5s & NaN duration trim invariants must never exceed clip duration or return NaN
    expect(clampTrimRange(Number.NaN, Number.POSITIVE_INFINITY, 0.3)).toEqual({
      startSec: 0,
      endSec: 0.3,
      durationSec: 0.3,
      isTrimmed: false,
    });
    expect(clampTrimRange(0.25, 0.25, 0.3)).toEqual({
      startSec: 0.1,
      endSec: 0.3,
      durationSec: 0.2,
      isTrimmed: true,
    });
    expect(clampTrimRange(0, 5, Number.NaN)).toEqual({
      startSec: 0,
      endSec: 0,
      durationSec: 0,
      isTrimmed: false,
    });
  });

  it('pre-scales oversized 48 MP bitmaps BEFORE initial draw canvas allocation when mobile maxCanvasPixels is active', async () => {
    const createdCanvases: Array<{ width: number; height: number }> = [];
    const adapter = makeTrackedAdapter(createdCanvases);
    const hugeBitmap = {
      width: 8000,
      height: 6000, // 48,000,000 px >> 15 MP iPhone guard
      close() {},
    } as unknown as ImageBitmap;

    const edit = structuredClone(getMediaPreset('whatsapp-hd').image);
    edit.targetResolution = 'hd';

    const result = await runImagePipeline(hugeBitmap, edit, adapter, undefined, {
      maxCanvasPixels: 15_000_000,
      allow8K: false,
      isMobileThermalGuard: true,
    });

    expect(createdCanvases.length).toBeGreaterThan(0);
    for (const c of createdCanvases) {
      expect(c.width * c.height).toBeLessThanOrEqual(15_000_000);
    }
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1440);
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('exercises all presets, 2K target preservation, 5 models, 9 pro tools, 12 filters, geometry history, and 4 video clarity + 7 color grades in store', async () => {
    vi.spyOn(fileValidator, 'validateMediaFile').mockImplementation(async (file) => ({
      valid: true,
      kind: file.name.endsWith('.mp4') ? 'video' : 'image',
      detectedMime: file.name.endsWith('.mp4') ? 'video/mp4' : 'image/png',
      declaredMime: file.type || (file.name.endsWith('.mp4') ? 'video/mp4' : 'image/png'),
      fileName: file.name,
      sizeBytes: Math.max(1024, file.size),
      signatureLabel: file.name.endsWith('.mp4') ? 'MP4' : 'PNG',
      warnings: [],
    }));

    vi.spyOn(metadataReader, 'readMediaMetadata').mockImplementation(async (file, validation) => {
      if (validation.kind === 'video') {
        return {
          kind: 'video',
          fileName: file.name,
          mimeType: 'video/mp4',
          sizeBytes: Math.max(1024, file.size),
          width: 1920,
          height: 1080,
          orientation: 'landscape',
          aspectRatio: '16:9',
          durationSec: 8,
          codecHint: 'H.264 + AAC',
          hasAudioHint: true,
        };
      }
      return {
        kind: 'image',
        fileName: file.name,
        mimeType: 'image/png',
        sizeBytes: Math.max(1024, file.size),
        width: 1200,
        height: 800,
        orientation: 'landscape',
        aspectRatio: '3:2',
        exifOrientation: null,
        hasAlpha: false,
        isAnimated: false,
      };
    });

    vi.spyOn(imageEngineClient, 'generateBaseThumbnail').mockResolvedValue(
      new Blob(['thumb'], { type: 'image/jpeg' })
    );
    vi.spyOn(imageEngineClient, 'processImage').mockImplementation(async (req) => ({
      requestId: req.requestId,
      backend: 'worker-offscreen-canvas',
      outputBlob: new Blob(['ok'], { type: req.edit.outputFormat }),
      outputFileName: `${req.file.name}-kompresor.jpg`,
      outputMime: req.edit.outputFormat,
      outputWidth: req.edit.targetResolution === '2k' ? 2560 : 1200,
      outputHeight: req.edit.targetResolution === '2k' ? 1707 : 800,
      inputBytes: req.file.size,
      outputBytes: 1800,
      durationMs: 5,
    }));

    const photoFile = new File([new Uint8Array([137, 80, 78, 71])], 'foto-uji.png', {
      type: 'image/png',
    });
    const videoFile = new File(
      [new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])],
      'video-uji.mp4',
      { type: 'video/mp4' }
    );

    await useMediaStore.getState().addMediaFiles([photoFile, videoFile], { replace: true });
    expect(useMediaStore.getState().items).toHaveLength(2);

    // Explicitly lock 2K and switch across every preset in MEDIA_PRESETS
    useMediaStore.getState().updateImageEdit({ targetResolution: '2k' }, { commitHistory: true });
    for (const preset of MEDIA_PRESETS) {
      if (preset.id === 'custom') continue;
      useMediaStore.getState().setPreset(preset.id);
      expect(useMediaStore.getState().imageEdit.targetResolution).toBe('2k');
    }

    // Cycle all 5 Photo quality models + all 9 Pro Photo tools + all 12 Photo filters
    const models: PhotoQualityModel[] = [
      'realphoto',
      'high-quality',
      'ultra-detail',
      'studio-portrait',
      'hdr-dynamic',
    ];
    for (const m of models) {
      useMediaStore.getState().updateImageEdit({ qualityModel: m }, { preservePreset: true });
      expect(useMediaStore.getState().imageEdit.qualityModel).toBe(m);
    }

    useMediaStore
      .getState()
      .updateImageEdit({ proTools: [...PRO_PHOTO_TOOL_IDS] }, { commitHistory: true });
    expect(useMediaStore.getState().imageEdit.proTools).toHaveLength(9);

    for (const filter of PHOTO_FILTER_PRESETS) {
      useMediaStore.getState().selectPhotoFilter(filter.id as PhotoFilterId);
      expect(useMediaStore.getState().imageEdit.photoFilterId).toBe(filter.id);
    }

    // Rotate / Flip / Crop -> Undo / Redo / Reset
    useMediaStore.getState().rotatePhoto90();
    useMediaStore.getState().toggleFlipH();
    useMediaStore.getState().toggleFlipV();
    useMediaStore.getState().applyCrop({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    expect(useMediaStore.getState().imageEdit.rotationDeg).toBe(90);
    expect(useMediaStore.getState().imageEdit.flipH).toBe(true);
    expect(useMediaStore.getState().imageEdit.flipV).toBe(true);
    expect(useMediaStore.getState().imageEdit.crop).not.toBeNull();

    useMediaStore.getState().undoPhotoEdit();
    expect(useMediaStore.getState().imageEdit.crop).toBeNull();
    useMediaStore.getState().redoPhotoEdit();
    expect(useMediaStore.getState().imageEdit.crop).not.toBeNull();

    useMediaStore.getState().resetPhotoEdits();
    expect(useMediaStore.getState().imageEdit.rotationDeg).toBe(0);
    expect(useMediaStore.getState().imageEdit.proTools).toEqual([]);
    expect(useMediaStore.getState().imageEdit.crop).toBeNull();

    // Switch to Video item & test all 4 clarity models + 7 color grades
    const videoItemId = useMediaStore.getState().items[1].id;
    useMediaStore.getState().selectQueueItem(videoItemId);

    const videoModels: VideoClarityModel[] = ['original', 'natural-hd', 'sharp-1080p', 'low-light'];
    for (const vm of videoModels) {
      useMediaStore.getState().updateVideoEdit({ clarityModel: vm });
      expect(useMediaStore.getState().videoEdit.clarityModel).toBe(vm);
    }

    for (const cg of COLOR_GRADE_PRESETS) {
      useMediaStore.getState().selectColorGrade(cg.id as ColorGradeId);
      expect(useMediaStore.getState().videoEdit.colorGrade.gradeId).toBe(cg.id);
    }

    // Remove item & clear queue cleanly
    useMediaStore.getState().removeQueueItem(videoItemId);
    expect(useMediaStore.getState().items).toHaveLength(1);
    useMediaStore.getState().clearMedia();
    expect(useMediaStore.getState().items).toHaveLength(0);
  });
});
