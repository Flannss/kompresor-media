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
import { generateFilterThumbnails, processImage } from '../engines/image/imageEngineClient';
import { VideoCancelledError } from '../engines/video/ffmpegVideoEngine';
import { resolveCustomVideoParams } from '../engines/video/videoPresets';
import { validateMediaFile } from '../features/upload/fileValidator';
import { readMediaMetadata } from '../features/upload/metadataReader';
import { getMediaPreset, type MediaPresetId } from '../presets/mediaPresets';

export type MediaLoadStatus = 'idle' | 'analyzing' | 'ready' | 'error';
export type ImageProcessStatus = 'idle' | 'processing' | 'ready' | 'error';
export type VideoProcessStatus = 'idle' | 'processing' | 'ready' | 'cancelled' | 'error';

const MAX_HISTORY_ENTRIES = 30;

function revokeIfPresent(url: string | null): number {
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

export function cloneImageEdit(edit: ImageEditState): ImageEditState {
  return {
    ...edit,
    adjustments: { ...edit.adjustments },
    crop: edit.crop ? { ...edit.crop } : null,
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

const DEFAULT_PRESET = getMediaPreset('whatsapp-chat');

export interface MediaStoreState {
  status: MediaLoadStatus;
  file: File | null;
  validation: ValidationResult | null;
  metadata: MediaMetadata | null;
  objectUrl: string | null;
  revokedUrlCount: number;
  errorMessage: string | null;
  selectedPresetId: MediaPresetId;
  activeLoadToken: number;

  // Photo Studio State
  imageEdit: ImageEditState;
  photoHistory: ImageEditState[];
  photoHistoryIndex: number;
  imageProcessStatus: ImageProcessStatus;
  imageProcessResult: ImageProcessResult | null;
  processedImageUrl: string | null;
  imageProcessError: string | null;
  activeProcessToken: number;
  filterThumbnails: Partial<Record<ImageFilterId, string>>;

  // Video Studio State
  videoEdit: VideoEditState;
  videoProcessStatus: VideoProcessStatus;
  videoProgress: VideoProcessProgress | null;
  videoProcessResult: VideoProcessResult | null;
  processedVideoUrl: string | null;
  videoProcessError: string | null;
  videoAbortController: AbortController | null;

  loadMediaFile: (file: File) => Promise<void>;
  setPreset: (presetId: MediaPresetId) => void;
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
  cancelVideoProcessing: () => void;

  clearMedia: () => void;
}

async function triggerImageProcessing(
  get: () => MediaStoreState,
  set: (
    partial:
      | Partial<MediaStoreState>
      | ((state: MediaStoreState) => Partial<MediaStoreState>)
  ) => void
): Promise<void> {
  const { file, metadata, imageEdit, status } = get();
  if (status !== 'ready' || !file || !metadata || metadata.kind !== 'image') {
    return;
  }

  const processToken = get().activeProcessToken + 1;
  set({
    activeProcessToken: processToken,
    imageProcessStatus: 'processing',
    imageProcessError: null,
  });

  try {
    const result = await processImage({
      requestId: `img-${processToken}`,
      file,
      sourceMetadata: metadata,
      edit: cloneImageEdit(imageEdit),
    });

    if (get().activeProcessToken !== processToken || get().file !== file) {
      return;
    }

    const prevProcessedUrl = get().processedImageUrl;
    const revokedDelta = revokeIfPresent(prevProcessedUrl);
    const nextProcessedUrl = URL.createObjectURL(result.outputBlob);

    set((state) => ({
      imageProcessStatus: 'ready',
      imageProcessResult: result,
      processedImageUrl: nextProcessedUrl,
      imageProcessError: null,
      revokedUrlCount: state.revokedUrlCount + revokedDelta,
    }));
  } catch (err) {
    if (get().activeProcessToken !== processToken) {
      return;
    }
    const message =
      err instanceof Error ? err.message : 'Gagal memproses foto pada perangkat ini.';
    set({
      imageProcessStatus: 'error',
      imageProcessError: message,
    });
  }
}

export const useMediaStore = create<MediaStoreState>((set, get) => ({
  status: 'idle',
  file: null,
  validation: null,
  metadata: null,
  objectUrl: null,
  revokedUrlCount: 0,
  errorMessage: null,
  selectedPresetId: 'whatsapp-chat',
  activeLoadToken: 0,

  imageEdit: cloneImageEdit(DEFAULT_PRESET.image),
  photoHistory: [cloneImageEdit(DEFAULT_PRESET.image)],
  photoHistoryIndex: 0,
  imageProcessStatus: 'idle',
  imageProcessResult: null,
  processedImageUrl: null,
  imageProcessError: null,
  activeProcessToken: 0,
  filterThumbnails: {},

  videoEdit: { ...DEFAULT_PRESET.video },
  videoProcessStatus: 'idle',
  videoProgress: null,
  videoProcessResult: null,
  processedVideoUrl: null,
  videoProcessError: null,
  videoAbortController: null,

  loadMediaFile: async (file: File) => {
    get().videoAbortController?.abort();

    const token = get().activeLoadToken + 1;
    const prevSourceUrl = get().objectUrl;
    const prevProcessedImg = get().processedImageUrl;
    const prevProcessedVid = get().processedVideoUrl;
    const prevThumbs = get().filterThumbnails;

    const revokedDelta =
      revokeIfPresent(prevSourceUrl) +
      revokeIfPresent(prevProcessedImg) +
      revokeIfPresent(prevProcessedVid) +
      revokeThumbMap(prevThumbs);

    set((state) => ({
      status: 'analyzing',
      file,
      validation: null,
      metadata: null,
      objectUrl: null,
      processedImageUrl: null,
      processedVideoUrl: null,
      filterThumbnails: {},
      imageProcessStatus: 'idle',
      imageProcessResult: null,
      imageProcessError: null,
      videoProcessStatus: 'idle',
      videoProgress: null,
      videoProcessResult: null,
      videoProcessError: null,
      videoAbortController: null,
      revokedUrlCount: state.revokedUrlCount + revokedDelta,
      errorMessage: null,
      activeLoadToken: token,
      activeProcessToken: state.activeProcessToken + 1,
    }));

    try {
      const validation = await validateMediaFile(file);
      if (get().activeLoadToken !== token) {
        return;
      }

      if (!validation.valid) {
        set({
          status: 'error',
          file: null,
          validation,
          metadata: null,
          objectUrl: null,
          errorMessage: validation.reason,
        });
        return;
      }

      const metadata = await readMediaMetadata(file, validation);
      if (get().activeLoadToken !== token) {
        return;
      }

      const nextUrl = URL.createObjectURL(file);
      const presetSpec = getMediaPreset(get().selectedPresetId);
      const initialImageEdit = cloneImageEdit(presetSpec.image);
      const initialVideoEdit: VideoEditState = {
        ...presetSpec.video,
        trimStartSec: 0,
        trimEndSec: metadata.kind === 'video' ? metadata.durationSec : null,
      };

      set({
        status: 'ready',
        file,
        validation,
        metadata,
        objectUrl: nextUrl,
        errorMessage: null,
        imageEdit: initialImageEdit,
        photoHistory: [cloneImageEdit(initialImageEdit)],
        photoHistoryIndex: 0,
        videoEdit: initialVideoEdit,
      });

      if (metadata.kind === 'image') {
        void triggerImageProcessing(get, set);
        void generateFilterThumbnails(file, metadata.mimeType).then((items) => {
          if (get().activeLoadToken !== token || get().file !== file) {
            return;
          }
          const oldThumbs = get().filterThumbnails;
          const thumbRevoked = revokeThumbMap(oldThumbs);
          const nextThumbs: Partial<Record<ImageFilterId, string>> = {};
          for (const item of items) {
            nextThumbs[item.filterId] = URL.createObjectURL(item.blob);
          }
          set((s) => ({
            filterThumbnails: nextThumbs,
            revokedUrlCount: s.revokedUrlCount + thumbRevoked,
          }));
        });
      }
    } catch (err) {
      if (get().activeLoadToken !== token) {
        return;
      }
      const message =
        err instanceof Error
          ? err.message
          : 'File tidak dapat dibaca. Pilih file foto atau video lain.';
      set({
        status: 'error',
        file: null,
        metadata: null,
        objectUrl: null,
        errorMessage: message,
      });
    }
  },

  setPreset: (presetId: MediaPresetId) => {
    const presetSpec = getMediaPreset(presetId);
    const meta = get().metadata;

    if (meta?.kind === 'video') {
      const { trimStartSec, trimEndSec, muteAudio } = get().videoEdit;
      set({
        selectedPresetId: presetId,
        videoEdit: {
          ...presetSpec.video,
          trimStartSec,
          trimEndSec,
          muteAudio,
        },
      });
      return;
    }

    const current = get().imageEdit;
    const nextEdit: ImageEditState = {
      ...cloneImageEdit(presetSpec.image),
      rotationDeg: current.rotationDeg,
      flipH: current.flipH,
      flipV: current.flipV,
      crop: current.crop ? { ...current.crop } : null,
      adjustments: { ...current.adjustments },
      filterId: current.filterId,
    };

    const pushed = pushSnapshot(get().photoHistory, get().photoHistoryIndex, nextEdit);
    set({
      selectedPresetId: presetId,
      imageEdit: nextEdit,
      photoHistory: pushed.history,
      photoHistoryIndex: pushed.index,
    });
    void triggerImageProcessing(get, set);
  },

  updateImageEdit: (patch, options = {}) => {
    const commitHistory = options.commitHistory ?? true;
    const preservePreset = options.preservePreset ?? false;

    set((state) => {
      const nextEdit: ImageEditState = {
        ...state.imageEdit,
        ...patch,
        adjustments: patch.adjustments
          ? { ...state.imageEdit.adjustments, ...patch.adjustments }
          : { ...state.imageEdit.adjustments },
        crop: patch.crop !== undefined ? (patch.crop ? { ...patch.crop } : null) : state.imageEdit.crop,
        presetId: preservePreset ? state.imageEdit.presetId : 'custom',
      };

      const nextPresetId = preservePreset ? state.selectedPresetId : 'custom';
      if (!commitHistory) {
        return {
          selectedPresetId: nextPresetId,
          imageEdit: nextEdit,
        };
      }

      const pushed = pushSnapshot(state.photoHistory, state.photoHistoryIndex, nextEdit);
      return {
        selectedPresetId: nextPresetId,
        imageEdit: nextEdit,
        photoHistory: pushed.history,
        photoHistoryIndex: pushed.index,
      };
    });

    void triggerImageProcessing(get, set);
  },

  commitCurrentPhotoSnapshot: () => {
    set((state) => {
      const pushed = pushSnapshot(state.photoHistory, state.photoHistoryIndex, state.imageEdit);
      return {
        photoHistory: pushed.history,
        photoHistoryIndex: pushed.index,
      };
    });
  },

  rotatePhoto90: () => {
    const nextRot = (((get().imageEdit.rotationDeg + 90) % 360) as ImageRotation);
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
    const { photoHistory, photoHistoryIndex } = get();
    if (photoHistoryIndex <= 0) {
      return;
    }
    const nextIndex = photoHistoryIndex - 1;
    const snapshot = cloneImageEdit(photoHistory[nextIndex]);
    set({
      imageEdit: snapshot,
      selectedPresetId: snapshot.presetId,
      photoHistoryIndex: nextIndex,
    });
    void triggerImageProcessing(get, set);
  },

  redoPhotoEdit: () => {
    const { photoHistory, photoHistoryIndex } = get();
    if (photoHistoryIndex >= photoHistory.length - 1) {
      return;
    }
    const nextIndex = photoHistoryIndex + 1;
    const snapshot = cloneImageEdit(photoHistory[nextIndex]);
    set({
      imageEdit: snapshot,
      selectedPresetId: snapshot.presetId,
      photoHistoryIndex: nextIndex,
    });
    void triggerImageProcessing(get, set);
  },

  resetPhotoEdits: () => {
    const basePreset = getMediaPreset(
      get().selectedPresetId === 'custom' ? 'whatsapp-chat' : get().selectedPresetId
    );
    const resetEdit = cloneImageEdit(basePreset.image);
    const pushed = pushSnapshot(get().photoHistory, get().photoHistoryIndex, resetEdit);
    set({
      selectedPresetId: basePreset.id,
      imageEdit: resetEdit,
      photoHistory: pushed.history,
      photoHistoryIndex: pushed.index,
    });
    void triggerImageProcessing(get, set);
  },

  updateVideoEdit: (patch) => {
    set((state) => {
      const qualityChanged = patch.qualityTier !== undefined;
      const resolutionChanged = patch.maxHeightPx !== undefined;
      const switchedToCustom = qualityChanged || resolutionChanged;

      const qualityParams = patch.qualityTier
        ? resolveCustomVideoParams(patch.qualityTier)
        : {};

      const nextVideoEdit: VideoEditState = {
        ...state.videoEdit,
        ...patch,
        ...qualityParams,
        presetId: switchedToCustom ? 'custom' : state.videoEdit.presetId,
      };

      return {
        selectedPresetId: switchedToCustom ? 'custom' : state.selectedPresetId,
        videoEdit: nextVideoEdit,
      };
    });
  },

  startVideoProcessing: async (preferredBackend = 'auto') => {
    const { file, metadata, videoEdit, videoProcessStatus } = get();
    if (!file || !metadata || metadata.kind !== 'video' || videoProcessStatus === 'processing') {
      return;
    }

    const controller = new AbortController();
    const prevVidUrl = get().processedVideoUrl;
    const revokedDelta = revokeIfPresent(prevVidUrl);
    const requestId = `vid-${Date.now()}`;

    set((state) => ({
      videoProcessStatus: 'processing',
      videoProgress: {
        requestId,
        backend: preferredBackend === 'ffmpeg-wasm-st' ? 'ffmpeg-wasm-st' : 'webcodecs-mediabunny',
        stage: 'probing',
        ratio: 0.01,
        elapsedMs: 0,
      },
      videoProcessResult: null,
      processedVideoUrl: null,
      videoProcessError: null,
      videoAbortController: controller,
      revokedUrlCount: state.revokedUrlCount + revokedDelta,
    }));

    try {
      const { processVideo } = await import('../engines/video/videoEngineOrchestrator');
      const result = await processVideo(
        {
          requestId,
          file,
          sourceMetadata: metadata,
          edit: { ...videoEdit },
          preferredBackend,
        },
        (progress) => {
          if (get().videoAbortController === controller && !controller.signal.aborted) {
            set({ videoProgress: progress });
          }
        },
        controller.signal
      );

      if (controller.signal.aborted || get().file !== file) {
        return;
      }

      const nextUrl = URL.createObjectURL(result.outputBlob);
      set({
        videoProcessStatus: 'ready',
        videoProcessResult: result,
        processedVideoUrl: nextUrl,
        videoProcessError: null,
        videoAbortController: null,
      });
    } catch (err) {
      if (err instanceof VideoCancelledError || controller.signal.aborted) {
        set({
          videoProcessStatus: 'cancelled',
          videoProgress: null,
          videoProcessError: null,
          videoAbortController: null,
        });
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Gagal memproses video di browser.';
      set({
        videoProcessStatus: 'error',
        videoProgress: null,
        videoProcessError: message,
        videoAbortController: null,
      });
    }
  },

  cancelVideoProcessing: () => {
    const controller = get().videoAbortController;
    if (controller) {
      controller.abort();
    }
    set({
      videoProcessStatus: 'cancelled',
      videoProgress: null,
      videoAbortController: null,
    });
  },

  clearMedia: () => {
    get().videoAbortController?.abort();

    const prevSourceUrl = get().objectUrl;
    const prevProcessedImg = get().processedImageUrl;
    const prevProcessedVid = get().processedVideoUrl;
    const prevThumbs = get().filterThumbnails;

    const revokedDelta =
      revokeIfPresent(prevSourceUrl) +
      revokeIfPresent(prevProcessedImg) +
      revokeIfPresent(prevProcessedVid) +
      revokeThumbMap(prevThumbs);

    set((state) => ({
      status: 'idle',
      file: null,
      validation: null,
      metadata: null,
      objectUrl: null,
      processedImageUrl: null,
      processedVideoUrl: null,
      filterThumbnails: {},
      imageProcessStatus: 'idle',
      imageProcessResult: null,
      imageProcessError: null,
      photoHistory: [cloneImageEdit(DEFAULT_PRESET.image)],
      photoHistoryIndex: 0,
      videoProcessStatus: 'idle',
      videoProgress: null,
      videoProcessResult: null,
      videoProcessError: null,
      videoAbortController: null,
      revokedUrlCount: state.revokedUrlCount + revokedDelta,
      errorMessage: null,
      activeLoadToken: state.activeLoadToken + 1,
      activeProcessToken: state.activeProcessToken + 1,
    }));
  },
}));
