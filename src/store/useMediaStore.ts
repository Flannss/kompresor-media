import { create } from 'zustand';
import type {
  ImageEditState,
  ImageFilterId,
  ImageProcessResult,
  ImageRotation,
  MediaMetadata,
  NormalizedCropRect,
  ValidationResult,
  VideoEditState,
  VideoExecutionBackend,
  VideoProcessProgress,
  VideoProcessResult,
} from '../engines/contracts';
import {
  generateFilterThumbnails,
  probeAvifEncodeSupport,
  processImage,
} from '../engines/image/imageEngineClient';
import { VideoCancelledError } from '../engines/video/videoErrors';
import { resolveCustomVideoParams } from '../engines/video/videoPresets';
import { validateMediaFile } from '../features/upload/fileValidator';
import { readMediaMetadata } from '../features/upload/metadataReader';
import { getMediaPreset, type MediaPresetId } from '../presets/mediaPresets';
import {
  getAdaptiveQueueLimits,
  type AdaptiveQueueLimits,
} from '../shared/utils/deviceCapability';

export type MediaLoadStatus = 'idle' | 'analyzing' | 'ready' | 'error';
export type ImageProcessStatus = 'idle' | 'processing' | 'ready' | 'error';
export type VideoProcessStatus = 'idle' | 'processing' | 'ready' | 'cancelled' | 'error';

export interface QueueItem {
  id: string;
  file: File;
  validation: Extract<ValidationResult, { valid: true }>;
  metadata: MediaMetadata;
  objectUrl: string;
  status: 'ready' | 'processing' | 'done' | 'cancelled' | 'error';
  progress: number;
  selectedPresetId: MediaPresetId;
  imageEdit: ImageEditState;
  photoHistory: ImageEditState[];
  photoHistoryIndex: number;
  imageResult: ImageProcessResult | null;
  needsFullResExport: boolean;
  videoEdit: VideoEditState;
  videoProgress: VideoProcessProgress | null;
  videoResult: VideoProcessResult | null;
  outputUrl: string | null;
  errorMessage: string | null;
  filterThumbnails: Partial<Record<ImageFilterId, string>>;
  processSeq: number;
}

const MAX_HISTORY_ENTRIES = 30;
const PREVIEW_DEBOUNCE_MS = 75;
const PREVIEW_MAX_EDGE_PX = 1280;

let nextQueueCounter = 1;
const previewTimers = new Map<string, ReturnType<typeof setTimeout>>();
const videoAbortControllers = new Map<string, AbortController>();

function makeItemId(): string {
  return `q-${Date.now()}-${nextQueueCounter++}`;
}

function revokeIfPresent(url: string | null | undefined): number {
  if (url) {
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 50);
    return 1;
  }
  return 0;
}

function revokeThumbMap(thumbs: Partial<Record<ImageFilterId, string>>): number {
  let count = 0;
  for (const url of Object.values(thumbs)) {
    if (url) {
      count += revokeIfPresent(url);
    }
  }
  return count;
}

function clearItemTimers(itemId: string): void {
  const timer = previewTimers.get(itemId);
  if (timer) {
    clearTimeout(timer);
    previewTimers.delete(itemId);
  }
}

export function cloneImageEdit(edit: ImageEditState): ImageEditState {
  return {
    ...edit,
    adjustments: { ...edit.adjustments },
    enhance: { ...edit.enhance },
    crop: edit.crop ? { ...edit.crop } : null,
  };
}

export function cloneVideoEdit(edit: VideoEditState): VideoEditState {
  return {
    ...edit,
    enhance: { ...edit.enhance },
    stabilize: { ...edit.stabilize },
    audio: { ...edit.audio },
    subtitle: {
      ...edit.subtitle,
      cues: edit.subtitle.cues.map((c) => ({ ...c })),
    },
  };
}

function areImageEditsEqual(a: ImageEditState, b: ImageEditState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function pushSnapshot(
  history: ImageEditState[],
  index: number,
  nextEdit: ImageEditState
): { history: ImageEditState[]; index: number } {
  const current = history[index];
  if (current && areImageEditsEqual(current, nextEdit)) {
    return { history, index };
  }
  const truncated = history.slice(0, index + 1);
  truncated.push(cloneImageEdit(nextEdit));
  const bounded =
    truncated.length > MAX_HISTORY_ENTRIES
      ? truncated.slice(truncated.length - MAX_HISTORY_ENTRIES)
      : truncated;
  return {
    history: bounded,
    index: bounded.length - 1,
  };
}

const DEFAULT_PRESET = getMediaPreset('whatsapp-hd');

export interface MediaStoreState {
  // Adaptive queue & environment state
  items: QueueItem[];
  activeItemId: string | null;
  queueLimits: AdaptiveQueueLimits;
  queueLimitNotice: string | null;
  avifSupported: boolean;
  batchRunning: boolean;
  batchCompleted: number;
  batchTotal: number;
  revokedUrlCount: number;
  activeLoadToken: number;

  // Active item mirrored selectors (ergonomic + backward compatible)
  status: MediaLoadStatus;
  file: File | null;
  validation: ValidationResult | null;
  metadata: MediaMetadata | null;
  objectUrl: string | null;
  errorMessage: string | null;
  selectedPresetId: MediaPresetId;

  imageEdit: ImageEditState;
  photoHistory: ImageEditState[];
  photoHistoryIndex: number;
  imageProcessStatus: ImageProcessStatus;
  imageProcessResult: ImageProcessResult | null;
  processedImageUrl: string | null;
  imageProcessError: string | null;
  filterThumbnails: Partial<Record<ImageFilterId, string>>;

  videoEdit: VideoEditState;
  videoProcessStatus: VideoProcessStatus;
  videoProgress: VideoProcessProgress | null;
  videoProcessResult: VideoProcessResult | null;
  processedVideoUrl: string | null;
  videoProcessError: string | null;

  initCapabilities: () => Promise<void>;
  addMediaFiles: (files: File[], options?: { replace?: boolean }) => Promise<void>;
  loadMediaFile: (file: File) => Promise<void>;
  selectQueueItem: (itemId: string) => void;
  removeQueueItem: (itemId: string) => void;
  clearLimitNotice: () => void;

  setPreset: (presetId: MediaPresetId) => void;
  applySettingsToAll: () => void;
  updateImageEdit: (
    patch: Partial<Omit<ImageEditState, 'presetId'>>,
    options?: { commitHistory?: boolean; preservePreset?: boolean }
  ) => void;
  commitCurrentPhotoSnapshot: () => void;
  rotatePhoto90: () => void;
  toggleFlipH: () => void;
  toggleFlipV: () => void;
  applyCrop: (crop: NormalizedCropRect | null) => void;
  selectFilter: (filterId: ImageFilterId) => void;
  undoPhotoEdit: () => void;
  redoPhotoEdit: () => void;
  resetPhotoEdits: () => void;

  updateVideoEdit: (patch: Partial<VideoEditState>) => void;
  startVideoProcessing: (preferredBackend?: VideoExecutionBackend | 'auto') => Promise<void>;
  processAllQueue: (preferredBackend?: VideoExecutionBackend | 'auto') => Promise<void>;
  cancelVideoProcessing: () => void;
  clearMedia: () => void;
}

function deriveMirroredActiveState(
  items: QueueItem[],
  activeItemId: string | null,
  fallbackStatus: MediaLoadStatus,
  fallbackPresetId: MediaPresetId,
  fallbackImageEdit: ImageEditState,
  fallbackHistory: ImageEditState[],
  fallbackHistoryIndex: number,
  fallbackVideoEdit: VideoEditState,
  fallbackError: string | null
): Partial<MediaStoreState> {
  const active = items.find((i) => i.id === activeItemId) ?? items[0] ?? null;
  if (!active) {
    return {
      activeItemId: null,
      status: fallbackStatus === 'analyzing' || fallbackStatus === 'error' ? fallbackStatus : 'idle',
      file: null,
      validation: null,
      metadata: null,
      objectUrl: null,
      errorMessage: fallbackStatus === 'error' ? fallbackError : null,
      selectedPresetId: fallbackPresetId,
      imageEdit: fallbackImageEdit,
      photoHistory: fallbackHistory,
      photoHistoryIndex: fallbackHistoryIndex,
      imageProcessStatus: 'idle',
      imageProcessResult: null,
      processedImageUrl: null,
      imageProcessError: null,
      filterThumbnails: {},
      videoEdit: fallbackVideoEdit,
      videoProcessStatus: 'idle',
      videoProgress: null,
      videoProcessResult: null,
      processedVideoUrl: null,
      videoProcessError: null,
    };
  }

  const isImg = active.metadata.kind === 'image';
  return {
    activeItemId: active.id,
    status: 'ready',
    file: active.file,
    validation: active.validation,
    metadata: active.metadata,
    objectUrl: active.objectUrl,
    errorMessage: active.errorMessage,
    selectedPresetId: active.selectedPresetId,
    imageEdit: active.imageEdit,
    photoHistory: active.photoHistory,
    photoHistoryIndex: active.photoHistoryIndex,
    imageProcessStatus: isImg
      ? active.status === 'processing'
        ? 'processing'
        : active.status === 'error'
          ? 'error'
          : active.imageResult
            ? 'ready'
            : 'idle'
      : 'idle',
    imageProcessResult: active.imageResult,
    processedImageUrl: isImg ? active.outputUrl : null,
    imageProcessError: isImg ? active.errorMessage : null,
    filterThumbnails: active.filterThumbnails,
    videoEdit: active.videoEdit,
    videoProcessStatus: !isImg
      ? active.status === 'processing'
        ? 'processing'
        : active.status === 'cancelled'
          ? 'cancelled'
          : active.status === 'error'
            ? 'error'
            : active.videoResult
              ? 'ready'
              : 'idle'
      : 'idle',
    videoProgress: active.videoProgress,
    videoProcessResult: active.videoResult,
    processedVideoUrl: !isImg ? active.outputUrl : null,
    videoProcessError: !isImg ? active.errorMessage : null,
  };
}

function updateItemInStore(
  get: () => MediaStoreState,
  set: (
    partial: Partial<MediaStoreState> | ((s: MediaStoreState) => Partial<MediaStoreState>)
  ) => void,
  itemId: string,
  updater: (item: QueueItem) => QueueItem
): void {
  set((state) => {
    const items = state.items.map((item) => (item.id === itemId ? updater(item) : item));
    return {
      items,
      ...deriveMirroredActiveState(
        items,
        state.activeItemId,
        state.status,
        state.selectedPresetId,
        state.imageEdit,
        state.photoHistory,
        state.photoHistoryIndex,
        state.videoEdit,
        state.errorMessage
      ),
    };
  });
  void get;
}

async function processPhotoItem(
  itemId: string,
  get: () => MediaStoreState,
  set: (
    partial: Partial<MediaStoreState> | ((s: MediaStoreState) => Partial<MediaStoreState>)
  ) => void,
  previewOnly = false
): Promise<void> {
  const targetItem = get().items.find((i) => i.id === itemId);
  if (!targetItem || targetItem.metadata.kind !== 'image') {
    return;
  }

  const nextSeq = targetItem.processSeq + 1;
  updateItemInStore(get, set, itemId, (item) => ({
    ...item,
    status: 'processing',
    progress: 30,
    processSeq: nextSeq,
    errorMessage: null,
  }));

  try {
    const latest = get().items.find((i) => i.id === itemId);
    if (!latest || latest.metadata.kind !== 'image') return;

    const result = await processImage({
      requestId: `img-${itemId}-${nextSeq}`,
      file: latest.file,
      sourceMetadata: latest.metadata,
      edit: cloneImageEdit(latest.imageEdit),
      ...(previewOnly ? { previewMaxEdgePx: PREVIEW_MAX_EDGE_PX } : {}),
    });

    const currentAfter = get().items.find((i) => i.id === itemId);
    if (!currentAfter || currentAfter.processSeq !== nextSeq) {
      return;
    }

    const revokedDelta = revokeIfPresent(currentAfter.outputUrl);
    const nextUrl = URL.createObjectURL(result.outputBlob);

    set((state) => {
      const items = state.items.map((it) =>
        it.id === itemId
          ? {
              ...it,
              status: 'done' as const,
              progress: 100,
              imageResult: result,
              outputUrl: nextUrl,
              errorMessage: null,
              needsFullResExport: previewOnly,
            }
          : it
      );
      return {
        items,
        revokedUrlCount: state.revokedUrlCount + revokedDelta,
        ...deriveMirroredActiveState(
          items,
          state.activeItemId,
          state.status,
          state.selectedPresetId,
          state.imageEdit,
          state.photoHistory,
          state.photoHistoryIndex,
          state.videoEdit,
          state.errorMessage
        ),
      };
    });
  } catch (err) {
    const currentAfter = get().items.find((i) => i.id === itemId);
    if (!currentAfter || currentAfter.processSeq !== nextSeq) {
      return;
    }
    const message =
      err instanceof Error ? err.message : 'Gagal memproses foto di browser.';
    updateItemInStore(get, set, itemId, (item) => ({
      ...item,
      status: 'error',
      progress: 0,
      errorMessage: message,
    }));
  }
}

async function processVideoItem(
  itemId: string,
  preferredBackend: VideoExecutionBackend | 'auto',
  get: () => MediaStoreState,
  set: (
    partial: Partial<MediaStoreState> | ((s: MediaStoreState) => Partial<MediaStoreState>)
  ) => void
): Promise<void> {
  const item = get().items.find((i) => i.id === itemId);
  if (!item || item.metadata.kind !== 'video') {
    return;
  }

  videoAbortControllers.get(itemId)?.abort();
  const controller = new AbortController();
  videoAbortControllers.set(itemId, controller);

  const prevUrl = item.outputUrl;
  const revokedDelta = revokeIfPresent(prevUrl);
  const seq = item.processSeq + 1;

  set((state) => {
    const items = state.items.map((it) =>
      it.id === itemId
        ? {
            ...it,
            status: 'processing' as const,
            progress: 2,
            videoProgress: {
              requestId: `vid-${itemId}-${seq}`,
              backend:
                preferredBackend === 'ffmpeg-wasm-st'
                  ? ('ffmpeg-wasm-st' as const)
                  : ('webcodecs-mediabunny' as const),
              stage: 'probing' as const,
              ratio: 0.02,
              elapsedMs: 0,
              detail: 'Menyiapkan pemrosesan video…',
            },
            videoResult: null,
            outputUrl: null,
            errorMessage: null,
            processSeq: seq,
          }
        : it
    );
    return {
      items,
      revokedUrlCount: state.revokedUrlCount + revokedDelta,
      ...deriveMirroredActiveState(
        items,
        state.activeItemId,
        state.status,
        state.selectedPresetId,
        state.imageEdit,
        state.photoHistory,
        state.photoHistoryIndex,
        state.videoEdit,
        state.errorMessage
      ),
    };
  });

  try {
    const { processVideo } = await import('../engines/video/videoEngineOrchestrator');
    const latest = get().items.find((i) => i.id === itemId);
    if (!latest || latest.metadata.kind !== 'video' || controller.signal.aborted) {
      throw new VideoCancelledError();
    }

    const result = await processVideo(
      {
        requestId: `vid-${itemId}-${seq}`,
        file: latest.file,
        sourceMetadata: latest.metadata,
        edit: cloneVideoEdit(latest.videoEdit),
        preferredBackend,
      },
      (progress) => {
        if (controller.signal.aborted) return;
        const pct = Math.min(99, Math.max(1, Math.round(progress.ratio * 100)));
        set((state) => {
          const items = state.items.map((it) =>
            it.id === itemId && it.processSeq === seq
              ? { ...it, progress: pct, videoProgress: progress }
              : it
          );
          return {
            items,
            ...(state.activeItemId === itemId ? { videoProgress: progress } : {}),
          };
        });
      },
      controller.signal
    );

    if (controller.signal.aborted) {
      return;
    }

    const stillExists = get().items.find((i) => i.id === itemId && i.processSeq === seq);
    if (!stillExists) {
      return;
    }

    const nextUrl = URL.createObjectURL(result.outputBlob);
    updateItemInStore(get, set, itemId, (it) => ({
      ...it,
      status: 'done',
      progress: 100,
      videoResult: result,
      outputUrl: nextUrl,
      errorMessage: null,
    }));
  } catch (err) {
    if (err instanceof VideoCancelledError || controller.signal.aborted) {
      updateItemInStore(get, set, itemId, (it) => ({
        ...it,
        status: 'cancelled',
        progress: 0,
        videoProgress: null,
        errorMessage: null,
      }));
      return;
    }
    const message =
      err instanceof Error ? err.message : 'Gagal memproses video di browser.';
    updateItemInStore(get, set, itemId, (it) => ({
      ...it,
      status: 'error',
      progress: 0,
      videoProgress: null,
      errorMessage: message,
    }));
  } finally {
    if (videoAbortControllers.get(itemId) === controller) {
      videoAbortControllers.delete(itemId);
    }
  }
}

function revokeAllItemsUrls(items: QueueItem[]): number {
  let count = 0;
  for (const item of items) {
    clearItemTimers(item.id);
    videoAbortControllers.get(item.id)?.abort();
    videoAbortControllers.delete(item.id);
    count += revokeIfPresent(item.objectUrl);
    count += revokeIfPresent(item.outputUrl);
    count += revokeThumbMap(item.filterThumbnails);
  }
  return count;
}

export const useMediaStore = create<MediaStoreState>((set, get) => ({
  items: [],
  activeItemId: null,
  queueLimits: getAdaptiveQueueLimits(),
  queueLimitNotice: null,
  avifSupported: false,
  batchRunning: false,
  batchCompleted: 0,
  batchTotal: 0,
  revokedUrlCount: 0,
  activeLoadToken: 0,

  status: 'idle',
  file: null,
  validation: null,
  metadata: null,
  objectUrl: null,
  errorMessage: null,
  selectedPresetId: DEFAULT_PRESET.id,

  imageEdit: cloneImageEdit(DEFAULT_PRESET.image),
  photoHistory: [cloneImageEdit(DEFAULT_PRESET.image)],
  photoHistoryIndex: 0,
  imageProcessStatus: 'idle',
  imageProcessResult: null,
  processedImageUrl: null,
  imageProcessError: null,
  filterThumbnails: {},

  videoEdit: cloneVideoEdit(DEFAULT_PRESET.video),
  videoProcessStatus: 'idle',
  videoProgress: null,
  videoProcessResult: null,
  processedVideoUrl: null,
  videoProcessError: null,

  initCapabilities: async () => {
    const limits = getAdaptiveQueueLimits();
    const avifSupported = await probeAvifEncodeSupport();
    set({ queueLimits: limits, avifSupported });
  },

  clearLimitNotice: () => {
    set({ queueLimitNotice: null });
  },

  addMediaFiles: async (rawFiles, options = {}) => {
    if (!rawFiles || rawFiles.length === 0) {
      return;
    }

    const replace = options.replace ?? get().items.length === 0;
    const limits = getAdaptiveQueueLimits();
    const token = get().activeLoadToken + 1;

    if (replace) {
      const revoked = revokeAllItemsUrls(get().items);
      set((state) => ({
        items: [],
        activeItemId: null,
        status: 'analyzing',
        errorMessage: null,
        queueLimitNotice: null,
        queueLimits: limits,
        revokedUrlCount: state.revokedUrlCount + revoked,
        activeLoadToken: token,
        file: null,
        validation: null,
        metadata: null,
        objectUrl: null,
        processedImageUrl: null,
        processedVideoUrl: null,
        imageProcessResult: null,
        videoProcessResult: null,
        imageProcessStatus: 'idle',
        videoProcessStatus: 'idle',
        filterThumbnails: {},
      }));
    } else {
      set({ queueLimits: limits, queueLimitNotice: null, activeLoadToken: token });
    }

    const existingItems = replace ? [] : get().items;
    let photoCount = existingItems.filter((i) => i.metadata.kind === 'image').length;
    let videoCount = existingItems.filter((i) => i.metadata.kind === 'video').length;
    let totalCount = existingItems.length;

    const addedItems: QueueItem[] = [];
    let skippedByLimit = 0;
    let firstErrorReason: string | null = null;

    for (const file of rawFiles) {
      if (totalCount >= limits.maxTotal) {
        skippedByLimit += 1;
        continue;
      }

      const validation = await validateMediaFile(file);
      if (get().activeLoadToken !== token) {
        return;
      }
      if (!validation.valid) {
        if (!firstErrorReason) {
          firstErrorReason = validation.reason;
        }
        continue;
      }

      if (validation.kind === 'image') {
        if (photoCount >= limits.maxPhotos) {
          skippedByLimit += 1;
          continue;
        }
      } else if (videoCount >= limits.maxVideos) {
        skippedByLimit += 1;
        continue;
      }

      try {
        const metadata = await readMediaMetadata(file, validation);
        if (get().activeLoadToken !== token) {
          return;
        }

        const itemId = makeItemId();
        const objectUrl = URL.createObjectURL(file);
        const presetId = get().selectedPresetId;
        const presetSpec = getMediaPreset(presetId);

        const initialImg = cloneImageEdit(presetSpec.image);
        const initialVid = cloneVideoEdit(presetSpec.video);
        initialVid.trimStartSec = 0;
        initialVid.trimEndSec = metadata.kind === 'video' ? metadata.durationSec : null;

        addedItems.push({
          id: itemId,
          file,
          validation,
          metadata,
          objectUrl,
          status: 'ready',
          progress: 0,
          selectedPresetId: presetId,
          imageEdit: initialImg,
          photoHistory: [cloneImageEdit(initialImg)],
          photoHistoryIndex: 0,
          imageResult: null,
          needsFullResExport: false,
          videoEdit: initialVid,
          videoProgress: null,
          videoResult: null,
          outputUrl: null,
          errorMessage: null,
          filterThumbnails: {},
          processSeq: 0,
        });

        totalCount += 1;
        if (metadata.kind === 'image') {
          photoCount += 1;
        } else {
          videoCount += 1;
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : `File "${file.name}" tidak dapat dibaca.`;
        if (!firstErrorReason) {
          firstErrorReason = msg;
        }
      }
    }

    if (get().activeLoadToken !== token) {
      revokeAllItemsUrls(addedItems);
      return;
    }

    const nextItems = [...(replace ? [] : get().items), ...addedItems];
    if (nextItems.length === 0) {
      set({
        items: [],
        activeItemId: null,
        status: 'error',
        file: null,
        validation: null,
        metadata: null,
        objectUrl: null,
        errorMessage:
          firstErrorReason ??
          'Tidak ada file foto atau video yang valid untuk dibuka.',
      });
      return;
    }

    let notice: string | null = null;
    if (skippedByLimit > 0) {
      notice = `Maksimal ${limits.maxTotal} file (${limits.maxPhotos} foto / ${limits.maxVideos} video) dipilih sesuai kapasitas ${limits.label.toLowerCase()} Anda. ${skippedByLimit} file selebihnya tidak ditambahkan.`;
    } else if (firstErrorReason && addedItems.length > 0) {
      notice = firstErrorReason;
    }

    const nextActiveId =
      addedItems.length > 0
        ? addedItems[0].id
        : get().activeItemId ?? nextItems[0].id;

    set((state) => ({
      items: nextItems,
      activeItemId: nextActiveId,
      queueLimitNotice: notice,
      status: 'ready',
      errorMessage: null,
      ...deriveMirroredActiveState(
        nextItems,
        nextActiveId,
        'ready',
        state.selectedPresetId,
        state.imageEdit,
        state.photoHistory,
        state.photoHistoryIndex,
        state.videoEdit,
        null
      ),
    }));

    // Auto-optimize newly imported image items (2-worker pool handles concurrent execution)
    const imageAdded = addedItems.filter((it) => it.metadata.kind === 'image');
    for (const imgItem of imageAdded) {
      void processPhotoItem(imgItem.id, get, set, false);
    }

    // Generate filter thumbnails for newly selected active image item
    const activeAfter = get().items.find((i) => i.id === nextActiveId);
    if (activeAfter && activeAfter.metadata.kind === 'image') {
      void generateFilterThumbnails(activeAfter.file, activeAfter.metadata.mimeType).then(
        (thumbList) => {
          const exists = get().items.find((i) => i.id === activeAfter.id);
          if (!exists) return;
          const revoked = revokeThumbMap(exists.filterThumbnails);
          const nextMap: Partial<Record<ImageFilterId, string>> = {};
          for (const entry of thumbList) {
            nextMap[entry.filterId] = URL.createObjectURL(entry.blob);
          }
          set((state) => {
            const items = state.items.map((it) =>
              it.id === activeAfter.id ? { ...it, filterThumbnails: nextMap } : it
            );
            return {
              items,
              revokedUrlCount: state.revokedUrlCount + revoked,
              ...(state.activeItemId === activeAfter.id ? { filterThumbnails: nextMap } : {}),
            };
          });
        }
      );
    }
  },

  loadMediaFile: async (file: File) => {
    await get().addMediaFiles([file], { replace: true });
  },

  selectQueueItem: (itemId: string) => {
    const target = get().items.find((i) => i.id === itemId);
    if (!target) {
      return;
    }

    set((state) => ({
      activeItemId: itemId,
      ...deriveMirroredActiveState(
        state.items,
        itemId,
        state.status,
        state.selectedPresetId,
        state.imageEdit,
        state.photoHistory,
        state.photoHistoryIndex,
        state.videoEdit,
        state.errorMessage
      ),
    }));

    if (
      target.metadata.kind === 'image' &&
      Object.keys(target.filterThumbnails).length === 0
    ) {
      void generateFilterThumbnails(target.file, target.metadata.mimeType).then((thumbList) => {
        const exists = get().items.find((i) => i.id === target.id);
        if (!exists) return;
        const nextMap: Partial<Record<ImageFilterId, string>> = {};
        for (const entry of thumbList) {
          nextMap[entry.filterId] = URL.createObjectURL(entry.blob);
        }
        set((state) => {
          const items = state.items.map((it) =>
            it.id === target.id ? { ...it, filterThumbnails: nextMap } : it
          );
          return {
            items,
            ...(state.activeItemId === target.id ? { filterThumbnails: nextMap } : {}),
          };
        });
      });
    }
  },

  removeQueueItem: (itemId: string) => {
    const target = get().items.find((i) => i.id === itemId);
    if (!target) {
      return;
    }

    const revoked = revokeAllItemsUrls([target]);
    const remaining = get().items.filter((i) => i.id !== itemId);
    const nextActiveId =
      get().activeItemId === itemId ? (remaining[0]?.id ?? null) : get().activeItemId;

    if (remaining.length === 0) {
      set((state) => ({
        items: [],
        activeItemId: null,
        revokedUrlCount: state.revokedUrlCount + revoked,
        status: 'idle',
        queueLimitNotice: null,
        ...deriveMirroredActiveState(
          [],
          null,
          'idle',
          DEFAULT_PRESET.id,
          cloneImageEdit(DEFAULT_PRESET.image),
          [cloneImageEdit(DEFAULT_PRESET.image)],
          0,
          cloneVideoEdit(DEFAULT_PRESET.video),
          null
        ),
      }));
      return;
    }

    set((state) => ({
      items: remaining,
      activeItemId: nextActiveId,
      revokedUrlCount: state.revokedUrlCount + revoked,
      ...deriveMirroredActiveState(
        remaining,
        nextActiveId,
        'ready',
        state.selectedPresetId,
        state.imageEdit,
        state.photoHistory,
        state.photoHistoryIndex,
        state.videoEdit,
        state.errorMessage
      ),
    }));
  },

  setPreset: (presetId: MediaPresetId) => {
    const presetSpec = getMediaPreset(presetId);
    const active = get().items.find((i) => i.id === get().activeItemId);

    if (!active) {
      const nextImg = cloneImageEdit(presetSpec.image);
      const nextVid = cloneVideoEdit(presetSpec.video);
      set((state) => {
        const pushed = pushSnapshot(state.photoHistory, state.photoHistoryIndex, nextImg);
        return {
          selectedPresetId: presetId,
          imageEdit: nextImg,
          photoHistory: pushed.history,
          photoHistoryIndex: pushed.index,
          videoEdit: nextVid,
        };
      });
      return;
    }

    if (active.metadata.kind === 'video') {
      const cur = active.videoEdit;
      const nextVideo = cloneVideoEdit(presetSpec.video);
      nextVideo.trimStartSec = cur.trimStartSec;
      nextVideo.trimEndSec = cur.trimEndSec;
      nextVideo.muteAudio = cur.muteAudio;
      nextVideo.enhance = { ...cur.enhance };
      nextVideo.stabilize = { ...cur.stabilize };
      nextVideo.audio = { ...cur.audio };
      nextVideo.subtitle = {
        ...cur.subtitle,
        cues: cur.subtitle.cues.map((c) => ({ ...c })),
      };

      updateItemInStore(get, set, active.id, (it) => ({
        ...it,
        selectedPresetId: presetId,
        videoEdit: nextVideo,
      }));
      return;
    }

    const curImg = active.imageEdit;
    const nextEdit: ImageEditState = {
      ...cloneImageEdit(presetSpec.image),
      rotationDeg: curImg.rotationDeg,
      flipH: curImg.flipH,
      flipV: curImg.flipV,
      crop: curImg.crop ? { ...curImg.crop } : null,
      adjustments: { ...curImg.adjustments },
      filterId: curImg.filterId,
      enhance: { ...curImg.enhance },
    };

    const pushed = pushSnapshot(active.photoHistory, active.photoHistoryIndex, nextEdit);
    clearItemTimers(active.id);
    updateItemInStore(get, set, active.id, (it) => ({
      ...it,
      selectedPresetId: presetId,
      imageEdit: nextEdit,
      photoHistory: pushed.history,
      photoHistoryIndex: pushed.index,
    }));
    void processPhotoItem(active.id, get, set, false);
  },

  applySettingsToAll: () => {
    const active = get().items.find((i) => i.id === get().activeItemId);
    if (!active) return;

    const sameKindTargets = get().items.filter(
      (i) => i.id !== active.id && i.metadata.kind === active.metadata.kind
    );
    if (sameKindTargets.length === 0) return;

    if (active.metadata.kind === 'image') {
      const template = cloneImageEdit(active.imageEdit);
      set((state) => {
        const items = state.items.map((it) => {
          if (it.id === active.id || it.metadata.kind !== 'image') {
            return it;
          }
          const cloned = cloneImageEdit(template);
          const pushed = pushSnapshot(it.photoHistory, it.photoHistoryIndex, cloned);
          return {
            ...it,
            selectedPresetId: active.selectedPresetId,
            imageEdit: cloned,
            photoHistory: pushed.history,
            photoHistoryIndex: pushed.index,
          };
        });
        return {
          items,
          queueLimitNotice: `Pengaturan foto (${sameKindTargets.length + 1} file) berhasil disamakan.`,
        };
      });
      for (const peer of sameKindTargets) {
        void processPhotoItem(peer.id, get, set, false);
      }
      return;
    }

    const videoTemplate = cloneVideoEdit(active.videoEdit);
    set((state) => {
      const items = state.items.map((it) => {
        if (it.id === active.id || it.metadata.kind !== 'video') {
          return it;
        }
        const cloned = cloneVideoEdit(videoTemplate);
        cloned.trimStartSec = it.videoEdit.trimStartSec;
        cloned.trimEndSec = it.videoEdit.trimEndSec;
        return {
          ...it,
          selectedPresetId: active.selectedPresetId,
          videoEdit: cloned,
          status: it.videoResult ? ('ready' as const) : it.status,
        };
      });
      return {
        items,
        queueLimitNotice: `Pengaturan video (${sameKindTargets.length + 1} file) disamakan. Klik Proses Semua untuk merender ulang.`,
      };
    });
  },

  updateImageEdit: (patch, options = {}) => {
    const commitHistory = options.commitHistory ?? true;
    const preservePreset = options.preservePreset ?? false;
    const active = get().items.find((i) => i.id === get().activeItemId);

    const buildNextEdit = (cur: ImageEditState, curPresetId: MediaPresetId) => {
      const nextPreset = preservePreset ? curPresetId : 'custom';
      const nextEdit: ImageEditState = {
        ...cur,
        ...patch,
        adjustments: patch.adjustments
          ? { ...cur.adjustments, ...patch.adjustments }
          : { ...cur.adjustments },
        enhance: patch.enhance ? { ...cur.enhance, ...patch.enhance } : { ...cur.enhance },
        crop: patch.crop !== undefined ? (patch.crop ? { ...patch.crop } : null) : cur.crop,
        presetId: nextPreset,
      };
      return { nextEdit, nextPreset };
    };

    if (!active) {
      set((state) => {
        const { nextEdit, nextPreset } = buildNextEdit(state.imageEdit, state.selectedPresetId);
        if (!commitHistory) {
          return { selectedPresetId: nextPreset, imageEdit: nextEdit };
        }
        const pushed = pushSnapshot(state.photoHistory, state.photoHistoryIndex, nextEdit);
        return {
          selectedPresetId: nextPreset,
          imageEdit: nextEdit,
          photoHistory: pushed.history,
          photoHistoryIndex: pushed.index,
        };
      });
      return;
    }

    const { nextEdit, nextPreset } = buildNextEdit(active.imageEdit, active.selectedPresetId);
    updateItemInStore(get, set, active.id, (it) => {
      if (!commitHistory) {
        return { ...it, selectedPresetId: nextPreset, imageEdit: nextEdit };
      }
      const pushed = pushSnapshot(it.photoHistory, it.photoHistoryIndex, nextEdit);
      return {
        ...it,
        selectedPresetId: nextPreset,
        imageEdit: nextEdit,
        photoHistory: pushed.history,
        photoHistoryIndex: pushed.index,
      };
    });

    clearItemTimers(active.id);
    if (!commitHistory) {
      const timer = setTimeout(() => {
        previewTimers.delete(active.id);
        void processPhotoItem(active.id, get, set, true);
      }, PREVIEW_DEBOUNCE_MS);
      previewTimers.set(active.id, timer);
    } else {
      void processPhotoItem(active.id, get, set, false);
    }
  },

  commitCurrentPhotoSnapshot: () => {
    const active = get().items.find((i) => i.id === get().activeItemId);
    if (!active) {
      set((state) => {
        const pushed = pushSnapshot(state.photoHistory, state.photoHistoryIndex, state.imageEdit);
        return {
          photoHistory: pushed.history,
          photoHistoryIndex: pushed.index,
        };
      });
      return;
    }

    clearItemTimers(active.id);
    updateItemInStore(get, set, active.id, (it) => {
      const pushed = pushSnapshot(it.photoHistory, it.photoHistoryIndex, it.imageEdit);
      return {
        ...it,
        photoHistory: pushed.history,
        photoHistoryIndex: pushed.index,
      };
    });

    // Re-render at full HD quality right after interactive slider release
    void processPhotoItem(active.id, get, set, false);
  },

  rotatePhoto90: () => {
    const nextRot = ((get().imageEdit.rotationDeg + 90) % 360) as ImageRotation;
    get().updateImageEdit(
      { rotationDeg: nextRot, crop: null },
      { commitHistory: true, preservePreset: true }
    );
  },

  toggleFlipH: () => {
    get().updateImageEdit(
      { flipH: !get().imageEdit.flipH },
      { commitHistory: true, preservePreset: true }
    );
  },

  toggleFlipV: () => {
    get().updateImageEdit(
      { flipV: !get().imageEdit.flipV },
      { commitHistory: true, preservePreset: true }
    );
  },

  applyCrop: (crop) => {
    get().updateImageEdit({ crop }, { commitHistory: true, preservePreset: true });
  },

  selectFilter: (filterId) => {
    get().updateImageEdit({ filterId }, { commitHistory: true, preservePreset: true });
  },

  undoPhotoEdit: () => {
    const active = get().items.find((i) => i.id === get().activeItemId);
    if (!active) {
      const { photoHistory, photoHistoryIndex } = get();
      if (photoHistoryIndex <= 0) return;
      const nextIndex = photoHistoryIndex - 1;
      const snapshot = cloneImageEdit(photoHistory[nextIndex]);
      set({
        imageEdit: snapshot,
        selectedPresetId: snapshot.presetId,
        photoHistoryIndex: nextIndex,
      });
      return;
    }

    if (active.photoHistoryIndex <= 0) return;
    const nextIndex = active.photoHistoryIndex - 1;
    const snapshot = cloneImageEdit(active.photoHistory[nextIndex]);
    clearItemTimers(active.id);
    updateItemInStore(get, set, active.id, (it) => ({
      ...it,
      imageEdit: snapshot,
      selectedPresetId: snapshot.presetId,
      photoHistoryIndex: nextIndex,
    }));
    void processPhotoItem(active.id, get, set, false);
  },

  redoPhotoEdit: () => {
    const active = get().items.find((i) => i.id === get().activeItemId);
    if (!active) {
      const { photoHistory, photoHistoryIndex } = get();
      if (photoHistoryIndex >= photoHistory.length - 1) return;
      const nextIndex = photoHistoryIndex + 1;
      const snapshot = cloneImageEdit(photoHistory[nextIndex]);
      set({
        imageEdit: snapshot,
        selectedPresetId: snapshot.presetId,
        photoHistoryIndex: nextIndex,
      });
      return;
    }

    if (active.photoHistoryIndex >= active.photoHistory.length - 1) return;
    const nextIndex = active.photoHistoryIndex + 1;
    const snapshot = cloneImageEdit(active.photoHistory[nextIndex]);
    clearItemTimers(active.id);
    updateItemInStore(get, set, active.id, (it) => ({
      ...it,
      imageEdit: snapshot,
      selectedPresetId: snapshot.presetId,
      photoHistoryIndex: nextIndex,
    }));
    void processPhotoItem(active.id, get, set, false);
  },

  resetPhotoEdits: () => {
    const active = get().items.find((i) => i.id === get().activeItemId);
    const currentPresetId = active ? active.selectedPresetId : get().selectedPresetId;
    const basePreset = getMediaPreset(
      currentPresetId === 'custom' ? 'whatsapp-hd' : currentPresetId
    );
    const resetEdit = cloneImageEdit(basePreset.image);

    if (!active) {
      set((state) => {
        const pushed = pushSnapshot(state.photoHistory, state.photoHistoryIndex, resetEdit);
        return {
          selectedPresetId: basePreset.id,
          imageEdit: resetEdit,
          photoHistory: pushed.history,
          photoHistoryIndex: pushed.index,
        };
      });
      return;
    }

    clearItemTimers(active.id);
    const pushed = pushSnapshot(active.photoHistory, active.photoHistoryIndex, resetEdit);
    updateItemInStore(get, set, active.id, (it) => ({
      ...it,
      selectedPresetId: basePreset.id,
      imageEdit: resetEdit,
      photoHistory: pushed.history,
      photoHistoryIndex: pushed.index,
    }));
    void processPhotoItem(active.id, get, set, false);
  },

  updateVideoEdit: (patch) => {
    const active = get().items.find((i) => i.id === get().activeItemId);
    if (!active || active.metadata.kind !== 'video') {
      return;
    }

    const switchedToCustom =
      patch.qualityTier !== undefined ||
      patch.maxHeightPx !== undefined ||
      patch.outputFormat !== undefined ||
      patch.fpsCap !== undefined;

    const qualityParams = patch.qualityTier
      ? resolveCustomVideoParams(patch.qualityTier)
      : {};

    const cur = active.videoEdit;
    const nextVideoEdit: VideoEditState = {
      ...cur,
      ...patch,
      ...qualityParams,
      enhance: patch.enhance ? { ...cur.enhance, ...patch.enhance } : { ...cur.enhance },
      stabilize: patch.stabilize
        ? { ...cur.stabilize, ...patch.stabilize }
        : { ...cur.stabilize },
      audio: patch.audio
        ? { ...cur.audio, ...patch.audio }
        : { ...cur.audio },
      subtitle: patch.subtitle
        ? {
            ...cur.subtitle,
            ...patch.subtitle,
            cues: patch.subtitle.cues
              ? patch.subtitle.cues.map((c) => ({ ...c }))
              : cur.subtitle.cues.map((c) => ({ ...c })),
          }
        : { ...cur.subtitle, cues: cur.subtitle.cues.map((c) => ({ ...c })) },
      muteAudio:
        patch.muteAudio !== undefined
          ? patch.muteAudio
          : patch.audio?.muteAudio !== undefined
            ? patch.audio.muteAudio
            : cur.muteAudio,
      presetId: switchedToCustom ? 'custom' : cur.presetId,
    };

    const nextPresetId = switchedToCustom ? 'custom' : active.selectedPresetId;

    updateItemInStore(get, set, active.id, (it) => ({
      ...it,
      selectedPresetId: nextPresetId,
      videoEdit: nextVideoEdit,
    }));
  },

  startVideoProcessing: async (preferredBackend = 'auto') => {
    const active = get().items.find((i) => i.id === get().activeItemId);
    if (!active || active.metadata.kind !== 'video') {
      return;
    }
    await processVideoItem(active.id, preferredBackend, get, set);
  },

  processAllQueue: async (preferredBackend = 'auto') => {
    const snapshotItems = [...get().items];
    if (snapshotItems.length === 0 || get().batchRunning) {
      return;
    }

    const photosToProcess = snapshotItems.filter(
      (i) => i.metadata.kind === 'image' && (!i.imageResult || i.needsFullResExport)
    );
    const videosToProcess = snapshotItems.filter((i) => i.metadata.kind === 'video');
    const total = photosToProcess.length + videosToProcess.length;

    if (total === 0) {
      return;
    }

    set({ batchRunning: true, batchCompleted: 0, batchTotal: total });

    try {
      // Photos run at safe worker pool concurrency = 2
      for (let i = 0; i < photosToProcess.length; i += 2) {
        if (!get().batchRunning) break;
        const pair = photosToProcess.slice(i, i + 2);
        await Promise.all(pair.map((p) => processPhotoItem(p.id, get, set, false)));
        set((s) => ({ batchCompleted: Math.min(total, s.batchCompleted + pair.length) }));
      }

      // Videos run strictly sequentially (concurrency = 1) to protect memory
      for (const vid of videosToProcess) {
        if (!get().batchRunning) break;
        await processVideoItem(vid.id, preferredBackend, get, set);
        set((s) => ({ batchCompleted: Math.min(total, s.batchCompleted + 1) }));
      }
    } finally {
      set({ batchRunning: false });
    }
  },

  cancelVideoProcessing: () => {
    const active = get().items.find((i) => i.id === get().activeItemId);
    for (const [id, ctrl] of videoAbortControllers.entries()) {
      if (!active || id === active.id || get().batchRunning) {
        ctrl.abort();
      }
    }
    set({ batchRunning: false });
    if (active && active.metadata.kind === 'video') {
      updateItemInStore(get, set, active.id, (it) => ({
        ...it,
        status: 'cancelled',
        progress: 0,
        videoProgress: null,
      }));
    }
  },

  clearMedia: () => {
    const revokedDelta = revokeAllItemsUrls(get().items);
    const resetImg = cloneImageEdit(DEFAULT_PRESET.image);
    const resetVid = cloneVideoEdit(DEFAULT_PRESET.video);

    set((state) => ({
      items: [],
      activeItemId: null,
      queueLimitNotice: null,
      batchRunning: false,
      batchCompleted: 0,
      batchTotal: 0,
      revokedUrlCount: state.revokedUrlCount + revokedDelta,
      activeLoadToken: state.activeLoadToken + 1,
      status: 'idle',
      file: null,
      validation: null,
      metadata: null,
      objectUrl: null,
      errorMessage: null,
      selectedPresetId: DEFAULT_PRESET.id,
      imageEdit: resetImg,
      photoHistory: [cloneImageEdit(resetImg)],
      photoHistoryIndex: 0,
      imageProcessStatus: 'idle',
      imageProcessResult: null,
      processedImageUrl: null,
      imageProcessError: null,
      filterThumbnails: {},
      videoEdit: resetVid,
      videoProcessStatus: 'idle',
      videoProgress: null,
      videoProcessResult: null,
      processedVideoUrl: null,
      videoProcessError: null,
    }));
  },
}));
