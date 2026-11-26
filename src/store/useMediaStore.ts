import { create } from 'zustand';
import type {
  ImageEditState,
  ImageProcessResult,
  ImageRotation,
  MediaMetadata,
  ValidationResult,
} from '../engines/contracts';
import { processImage } from '../engines/image/imageEngineClient';
import { validateMediaFile } from '../features/upload/fileValidator';
import { readMediaMetadata } from '../features/upload/metadataReader';
import { getMediaPreset, type MediaPresetId } from '../presets/mediaPresets';

export type MediaLoadStatus = 'idle' | 'analyzing' | 'ready' | 'error';
export type ImageProcessStatus = 'idle' | 'processing' | 'ready' | 'error';

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

  // Phase 4 Photo Processing State
  imageEdit: ImageEditState;
  imageProcessStatus: ImageProcessStatus;
  imageProcessResult: ImageProcessResult | null;
  processedImageUrl: string | null;
  imageProcessError: string | null;
  activeProcessToken: number;

  loadMediaFile: (file: File) => Promise<void>;
  setPreset: (presetId: MediaPresetId) => void;
  updateImageEdit: (patch: Partial<Omit<ImageEditState, 'presetId'>>) => void;
  rotatePhoto90: () => void;
  clearMedia: () => void;
}

function revokeIfPresent(url: string | null): number {
  if (url) {
    // Defer revocation past the current React commit so mounted <img>/<video> elements detach first.
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 50);
    return 1;
  }
  return 0;
}

const DEFAULT_PRESET = getMediaPreset('whatsapp-chat');

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
      edit: imageEdit,
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

  imageEdit: { ...DEFAULT_PRESET.image },
  imageProcessStatus: 'idle',
  imageProcessResult: null,
  processedImageUrl: null,
  imageProcessError: null,
  activeProcessToken: 0,

  loadMediaFile: async (file: File) => {
    const token = get().activeLoadToken + 1;
    const prevSourceUrl = get().objectUrl;
    const prevProcessedUrl = get().processedImageUrl;
    const revokedDelta = revokeIfPresent(prevSourceUrl) + revokeIfPresent(prevProcessedUrl);

    set((state) => ({
      status: 'analyzing',
      file,
      validation: null,
      metadata: null,
      objectUrl: null,
      processedImageUrl: null,
      imageProcessStatus: 'idle',
      imageProcessResult: null,
      imageProcessError: null,
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

      set({
        status: 'ready',
        file,
        validation,
        metadata,
        objectUrl: nextUrl,
        errorMessage: null,
        imageEdit: { ...presetSpec.image, rotationDeg: 0 },
      });

      if (metadata.kind === 'image') {
        void triggerImageProcessing(get, set);
      }
    } catch (err) {
      if (get().activeLoadToken !== token) {
        return;
      }
      const message =
        err instanceof Error ? err.message : 'File tidak dapat dibaca. Pilih file foto atau video lain.';
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
    const currentRotation = get().imageEdit.rotationDeg;
    set({
      selectedPresetId: presetId,
      imageEdit: {
        ...presetSpec.image,
        rotationDeg: currentRotation,
      },
    });
    void triggerImageProcessing(get, set);
  },

  updateImageEdit: (patch: Partial<Omit<ImageEditState, 'presetId'>>) => {
    set((state) => ({
      selectedPresetId: 'custom',
      imageEdit: {
        ...state.imageEdit,
        ...patch,
        presetId: 'custom',
      },
    }));
    void triggerImageProcessing(get, set);
  },

  rotatePhoto90: () => {
    const current = get().imageEdit.rotationDeg;
    const nextRotation = (((current + 90) % 360) as ImageRotation);
    set((state) => ({
      imageEdit: {
        ...state.imageEdit,
        rotationDeg: nextRotation,
      },
    }));
    void triggerImageProcessing(get, set);
  },

  clearMedia: () => {
    const prevSourceUrl = get().objectUrl;
    const prevProcessedUrl = get().processedImageUrl;
    const revokedDelta = revokeIfPresent(prevSourceUrl) + revokeIfPresent(prevProcessedUrl);

    set((state) => ({
      status: 'idle',
      file: null,
      validation: null,
      metadata: null,
      objectUrl: null,
      processedImageUrl: null,
      imageProcessStatus: 'idle',
      imageProcessResult: null,
      imageProcessError: null,
      revokedUrlCount: state.revokedUrlCount + revokedDelta,
      errorMessage: null,
      activeLoadToken: state.activeLoadToken + 1,
      activeProcessToken: state.activeProcessToken + 1,
    }));
  },
}));
