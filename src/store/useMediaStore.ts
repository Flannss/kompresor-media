import { create } from 'zustand';
import type { MediaMetadata, ValidationResult } from '../engines/contracts';
import { validateMediaFile } from '../features/upload/fileValidator';
import { readMediaMetadata } from '../features/upload/metadataReader';
import type { MediaPresetId } from '../presets/mediaPresets';

export type MediaLoadStatus = 'idle' | 'analyzing' | 'ready' | 'error';

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
  loadMediaFile: (file: File) => Promise<void>;
  setPreset: (presetId: MediaPresetId) => void;
  clearMedia: () => void;
}

function revokeIfPresent(url: string | null): number {
  if (url) {
    URL.revokeObjectURL(url);
    return 1;
  }
  return 0;
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

  loadMediaFile: async (file: File) => {
    const token = get().activeLoadToken + 1;
    const prevUrl = get().objectUrl;
    const revokedDelta = revokeIfPresent(prevUrl);

    set((state) => ({
      status: 'analyzing',
      file,
      validation: null,
      metadata: null,
      objectUrl: null,
      revokedUrlCount: state.revokedUrlCount + revokedDelta,
      errorMessage: null,
      activeLoadToken: token,
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
      set({
        status: 'ready',
        file,
        validation,
        metadata,
        objectUrl: nextUrl,
        errorMessage: null,
      });
    } catch (err) {
      if (get().activeLoadToken !== token) {
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Unexpected failure while inspecting media file.';
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
    set({ selectedPresetId: presetId });
  },

  clearMedia: () => {
    const currentUrl = get().objectUrl;
    const revokedDelta = revokeIfPresent(currentUrl);
    set((state) => ({
      status: 'idle',
      file: null,
      validation: null,
      metadata: null,
      objectUrl: null,
      revokedUrlCount: state.revokedUrlCount + revokedDelta,
      errorMessage: null,
      activeLoadToken: state.activeLoadToken + 1,
    }));
  },
}));
