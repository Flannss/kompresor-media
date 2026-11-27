import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import * as imageEngineClient from '../engines/image/imageEngineClient';
import { buildExportFileName } from '../engines/image/pixelOps';
import { buildVideoExportFileName } from '../engines/video/videoPresets';
import {
  buildZipBlob,
  deduplicateFileName,
  sanitizeZipFileName,
} from '../features/export-share/zipExport';
import { validateMediaFile } from '../features/upload/fileValidator';
import * as metadataReader from '../features/upload/metadataReader';
import { getMediaPreset } from '../presets/mediaPresets';
import { sanitizeExportBaseName } from '../shared/utils/sanitizeFileName';
import { useMediaStore } from '../store/useMediaStore';

function makePngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]);
}

function makeMp4Bytes(): Uint8Array {
  const txt = 'ftypisom';
  const buf = new Uint8Array(24);
  buf[3] = 0x18;
  for (let i = 0; i < txt.length; i += 1) {
    buf[4 + i] = txt.charCodeAt(i);
  }
  return buf;
}

describe('KM-T015 End-to-End Import-to-Export Pipeline, Validation, ZIP Dedup & Race Guard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useMediaStore.getState().clearMedia();
  });

  it('rejects unsupported extensions, 0-byte files, and shows dismissible Indonesian warning when queue cap exceeded or invalid file dropped inside studio', async () => {
    const emptyFile = new File([], 'kosong.jpg', { type: 'image/jpeg' });
    const txtFile = new File(['hello'], 'dokumen.txt', { type: 'text/plain' });
    const pdfFile = new File(['%PDF-1.7'], 'berkas.pdf', { type: 'application/pdf' });

    expect(await validateMediaFile(emptyFile)).toMatchObject({
      valid: false,
      errorCode: 'EMPTY_FILE',
    });
    expect(await validateMediaFile(txtFile)).toMatchObject({
      valid: false,
      errorCode: 'UNSUPPORTED_TYPE',
    });
    expect(await validateMediaFile(pdfFile)).toMatchObject({
      valid: false,
      errorCode: 'UNSUPPORTED_TYPE',
    });

    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', {
        value: () => 'blob:mock/item',
        configurable: true,
      });
    }
    if (!URL.revokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        value: () => {},
        configurable: true,
      });
    }

    vi.spyOn(metadataReader, 'readMediaMetadata').mockImplementation(async (file, validation) => {
      if (validation.kind === 'video') {
        return {
          kind: 'video',
          fileName: file.name,
          mimeType: 'video/mp4',
          sizeBytes: file.size,
          width: 1280,
          height: 720,
          orientation: 'landscape',
          aspectRatio: '16:9',
          durationSec: 5,
          codecHint: 'H.264 + AAC',
          hasAudioHint: true,
        };
      }
      return {
        kind: 'image',
        fileName: file.name,
        mimeType: 'image/png',
        sizeBytes: file.size,
        width: 1200,
        height: 800,
        orientation: 'landscape',
        aspectRatio: '3:2',
        exifOrientation: null,
        hasAlpha: false,
        isAnimated: false,
      };
    });

    vi.spyOn(imageEngineClient, 'processImage').mockImplementation(async (req) => ({
      requestId: req.requestId,
      backend: 'worker-offscreen-canvas',
      outputBlob: new Blob(['out'], { type: req.edit.outputFormat }),
      outputFileName: buildExportFileName(
        req.file.name,
        req.edit.outputFormat,
        req.edit.targetResolution
      ),
      outputMime: req.edit.outputFormat,
      outputWidth: 1200,
      outputHeight: 800,
      inputBytes: req.file.size,
      outputBytes: 120,
      durationMs: 4,
    }));
    vi.spyOn(imageEngineClient, 'generateBaseThumbnail').mockResolvedValue(
      new Blob(['thumb'], { type: 'image/jpeg' })
    );

    const pngBytes = makePngBytes();
    const copyBuf = (b: Uint8Array) => Uint8Array.from(b);
    // Attempt importing 11 photos on desktop (max 9)
    const elevenFiles = Array.from({ length: 11 }, (_, idx) =>
      new File([copyBuf(pngBytes)], `foto-${idx + 1}.png`, { type: 'image/png' })
    );

    await useMediaStore.getState().addMediaFiles(elevenFiles, { replace: true });
    let state = useMediaStore.getState();
    expect(state.items).toHaveLength(9);
    expect(state.queueLimitNotice).toContain('Maksimal 9 file');

    // Dropping an invalid .txt inside an active studio MUST display notice without wiping existing items
    useMediaStore.getState().clearLimitNotice();
    await useMediaStore.getState().addMediaFiles([txtFile], { replace: false });
    state = useMediaStore.getState();
    expect(state.items).toHaveLength(9);
    expect(state.queueLimitNotice).toContain('tidak didukung');
  });

  it('sanitizes filenames, builds descriptive 2K/1080p names, and deduplicates identical ZIP filenames case-insensitively', async () => {
    expect(sanitizeExportBaseName('../foto:*?"<>|liburan  pantai..')).toBe('foto-liburan pantai');
    expect(buildExportFileName('liburan.png', 'image/jpeg')).toBe('liburan-kompresor.jpg');
    expect(buildExportFileName('liburan.png', 'image/jpeg', '2k')).toBe('liburan-2k.jpg');
    expect(buildExportFileName('potret.png', 'image/webp', '4k')).toBe('potret-4k.webp');
    expect(buildVideoExportFileName('klip.mov', 'mp4')).toBe('klip-kompresor.mp4');
    expect(buildVideoExportFileName('klip.mov', 'mp4', '1080p')).toBe('klip-hd-1080p.mp4');

    expect(sanitizeZipFileName('../../folder\\sub/foto:raya?.jpg')).toBe('foto-raya.jpg');

    const used = new Set<string>();
    expect(deduplicateFileName('foto.jpg', used)).toBe('foto.jpg');
    expect(deduplicateFileName('foto.jpg', used)).toBe('foto-2.jpg');
    expect(deduplicateFileName('FOTO.JPG', used)).toBe('FOTO-3.JPG');

    const zipBlob = await buildZipBlob([
      { fileName: 'liburan-2k.jpg', blob: new Blob(['first-image']) },
      { fileName: 'liburan-2k.jpg', blob: new Blob(['second-image']) },
      { fileName: 'klip-hd-1080p.mp4', blob: new Blob(['video-data']) },
    ]);
    const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
    expect(zipBytes[0]).toBe(0x50); // 'P'
    expect(zipBytes[1]).toBe(0x4b); // 'K'

    const unpacked = unzipSync(zipBytes);
    expect(Object.keys(unpacked).sort()).toEqual([
      'klip-hd-1080p.mp4',
      'liburan-2k-2.jpg',
      'liburan-2k.jpg',
    ]);
    expect(new TextDecoder().decode(unpacked['liburan-2k.jpg'])).toBe('first-image');
    expect(new TextDecoder().decode(unpacked['liburan-2k-2.jpg'])).toBe('second-image');
  });

  it('guards stale debounced renders cleanly across rapid mutations and mixed Photo + Video queues', async () => {
    let urlCounter = 1;
    Object.defineProperty(URL, 'createObjectURL', {
      value: () => `blob:mock/${urlCounter++}`,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: () => {},
      configurable: true,
    });

    vi.spyOn(metadataReader, 'readMediaMetadata').mockImplementation(async (file, validation) => {
      if (validation.kind === 'video') {
        return {
          kind: 'video',
          fileName: file.name,
          mimeType: 'video/mp4',
          sizeBytes: file.size,
          width: 1920,
          height: 1080,
          orientation: 'landscape',
          aspectRatio: '16:9',
          durationSec: 6,
          codecHint: 'H.264 + AAC',
          hasAudioHint: true,
        };
      }
      return {
        kind: 'image',
        fileName: file.name,
        mimeType: 'image/png',
        sizeBytes: file.size,
        width: 1200,
        height: 800,
        orientation: 'landscape',
        aspectRatio: '3:2',
        exifOrientation: null,
        hasAlpha: false,
        isAnimated: false,
      };
    });

    let resolveSlowFirstRender!: (val: Awaited<ReturnType<typeof imageEngineClient.processImage>>) => void;
    let callCount = 0;
    const seenPreviewMaxEdges: Array<number | undefined> = [];
    vi.spyOn(imageEngineClient, 'processImage').mockImplementation(async (req) => {
      callCount += 1;
      seenPreviewMaxEdges.push(req.previewMaxEdgePx);
      if (callCount === 1) {
        return new Promise((resolve) => {
          resolveSlowFirstRender = resolve;
        });
      }
      return {
        requestId: req.requestId,
        backend: 'worker-offscreen-canvas',
        outputBlob: new Blob([req.previewMaxEdgePx ? 'preview-blob' : 'fullres-blob'], {
          type: req.edit.outputFormat,
        }),
        outputFileName: buildExportFileName(req.file.name, req.edit.outputFormat, req.edit.targetResolution),
        outputMime: req.edit.outputFormat,
        outputWidth: 2560,
        outputHeight: 1707,
        inputBytes: req.file.size,
        outputBytes: 999,
        durationMs: 12,
      };
    });
    vi.spyOn(imageEngineClient, 'generateBaseThumbnail').mockResolvedValue(
      new Blob(['thumb'], { type: 'image/jpeg' })
    );

    const photoFile = new File([makePngBytes().slice()], 'liburan.png', { type: 'image/png' });
    const videoFile = new File([makeMp4Bytes().slice()], 'klip.mp4', { type: 'video/mp4' });

    await useMediaStore.getState().addMediaFiles([photoFile, videoFile], { replace: true });
    let state = useMediaStore.getState();
    expect(state.items).toHaveLength(2);
    expect(state.metadata?.kind).toBe('image');

    // Trigger newer mutation while initial render #1 is still pending
    useMediaStore.getState().updateImageEdit(
      { targetResolution: '2k', proTools: ['dehaze'] },
      { commitHistory: true, preservePreset: true }
    );
    await new Promise((r) => setTimeout(r, 20));

    // Resolve slow stale render #1 AFTER render #2 finished — stale render MUST NOT overwrite outputWidth 2560!
    resolveSlowFirstRender({
      requestId: 'stale-req-1',
      backend: 'worker-offscreen-canvas',
      outputBlob: new Blob(['stale']),
      outputFileName: 'liburan-kompresor.jpg',
      outputMime: 'image/jpeg',
      outputWidth: 999,
      outputHeight: 666,
      inputBytes: photoFile.size,
      outputBytes: 111,
      durationMs: 50,
    });
    await new Promise((r) => setTimeout(r, 20));

    state = useMediaStore.getState();
    expect(state.imageProcessResult?.outputWidth).toBe(2560);
    expect(state.imageEdit.proTools).toEqual(['dehaze']);

    // Switch cleanly between Photo Studio & Video Studio in mixed queue
    const vidItemId = state.items[1].id;
    useMediaStore.getState().selectQueueItem(vidItemId);
    expect(useMediaStore.getState().metadata?.kind).toBe('video');

    const imgItemId = state.items[0].id;
    useMediaStore.getState().selectQueueItem(imgItemId);
    expect(useMediaStore.getState().metadata?.kind).toBe('image');
    expect(useMediaStore.getState().imageEdit.proTools).toEqual(['dehaze']);

    // Quick reset cleanly restores default preset without breaking Undo
    useMediaStore.getState().resetPhotoEdits();
    expect(useMediaStore.getState().imageEdit.proTools).toEqual([]);
    expect(useMediaStore.getState().imageEdit.targetResolution).toBe(
      getMediaPreset('whatsapp-hd').image.targetResolution
    );
    useMediaStore.getState().undoPhotoEdit();
    expect(useMediaStore.getState().imageEdit.proTools).toEqual(['dehaze']);
    await new Promise((r) => setTimeout(r, 20));
    expect(useMediaStore.getState().items[0].needsFullResExport).toBe(true);

    // Batch ZIP full-res preparation MUST return fresh upgraded items rather than stale preview blobs
    const freshItems = await useMediaStore.getState().ensureAllPhotosFullRes();
    expect(freshItems[0].needsFullResExport).toBe(false);
    expect(seenPreviewMaxEdges[seenPreviewMaxEdges.length - 1]).toBeUndefined();
    expect(await freshItems[0].imageResult!.outputBlob.text()).toBe('fullres-blob');
  });
});
