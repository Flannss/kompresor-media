import { useEffect, useRef, type ChangeEvent } from 'react';
import { UploadZone } from '../features/upload/UploadZone';
import { WorkspaceHeader } from '../features/workspace/WorkspaceHeader';
import { WorkspaceStage } from '../features/workspace/WorkspaceStage';
import { useMediaStore } from '../store/useMediaStore';
import { ErrorBoundary } from './ErrorBoundary';

const ACCEPTED_MEDIA =
  'image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.mov,.webm';

export function App() {
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const status = useMediaStore((s) => s.status);
  const validation = useMediaStore((s) => s.validation);
  const metadata = useMediaStore((s) => s.metadata);
  const objectUrl = useMediaStore((s) => s.objectUrl);
  const revokedUrlCount = useMediaStore((s) => s.revokedUrlCount);
  const errorMessage = useMediaStore((s) => s.errorMessage);
  const selectedPresetId = useMediaStore((s) => s.selectedPresetId);
  const loadMediaFile = useMediaStore((s) => s.loadMediaFile);
  const setPreset = useMediaStore((s) => s.setPreset);
  const clearMedia = useMediaStore((s) => s.clearMedia);

  useEffect(() => {
    return () => {
      useMediaStore.getState().clearMedia();
    };
  }, []);

  const handleFileSelected = (file: File) => {
    void loadMediaFile(file);
  };

  const handleReplaceInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
    e.target.value = '';
  };

  const isReady = status === 'ready' && metadata !== null && validation?.valid === true && objectUrl !== null;

  return (
    <ErrorBoundary onReset={clearMedia}>
      <div className="flex min-h-screen flex-col bg-[var(--surface-canvas)] text-[var(--ink-primary)]">
        <WorkspaceHeader
          hasMedia={isReady}
          onReplaceClick={() => replaceInputRef.current?.click()}
          onClearClick={clearMedia}
        />

        <input
          ref={replaceInputRef}
          data-testid="header-file-input"
          type="file"
          accept={ACCEPTED_MEDIA}
          onChange={handleReplaceInputChange}
          className="sr-only"
          aria-label="Replace active photo or video file"
        />

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4 sm:px-6 sm:py-6">
          {isReady ? (
            <WorkspaceStage
              metadata={metadata}
              validation={validation}
              objectUrl={objectUrl}
              revokedUrlCount={revokedUrlCount}
              selectedPresetId={selectedPresetId}
              onSelectPreset={setPreset}
              onDropReplaceFile={handleFileSelected}
            />
          ) : (
            <UploadZone
              status={status}
              errorMessage={errorMessage}
              onFileSelected={handleFileSelected}
            />
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}

export default App;
