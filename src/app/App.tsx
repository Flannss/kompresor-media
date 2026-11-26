import { useEffect, useRef, type ChangeEvent } from 'react';
import { disposeImageEngine } from '../engines/image/imageEngineClient';
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
  const errorMessage = useMediaStore((s) => s.errorMessage);
  const selectedPresetId = useMediaStore((s) => s.selectedPresetId);
  const imageEdit = useMediaStore((s) => s.imageEdit);
  const imageProcessStatus = useMediaStore((s) => s.imageProcessStatus);
  const imageProcessResult = useMediaStore((s) => s.imageProcessResult);
  const processedImageUrl = useMediaStore((s) => s.processedImageUrl);
  const imageProcessError = useMediaStore((s) => s.imageProcessError);
  const loadMediaFile = useMediaStore((s) => s.loadMediaFile);
  const setPreset = useMediaStore((s) => s.setPreset);
  const updateImageEdit = useMediaStore((s) => s.updateImageEdit);
  const rotatePhoto90 = useMediaStore((s) => s.rotatePhoto90);
  const clearMedia = useMediaStore((s) => s.clearMedia);

  useEffect(() => {
    return () => {
      useMediaStore.getState().clearMedia();
      disposeImageEngine();
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

  const isReady =
    status === 'ready' && metadata !== null && validation?.valid === true && objectUrl !== null;

  return (
    <ErrorBoundary onReset={clearMedia}>
      <div className="flex min-h-screen flex-col bg-[var(--bg-app)] text-[var(--text-primary)]">
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
          aria-label="Ganti file foto atau video"
        />

        <main className="flex flex-1 flex-col">
          {isReady ? (
            <WorkspaceStage
              metadata={metadata}
              validation={validation}
              objectUrl={objectUrl}
              selectedPresetId={selectedPresetId}
              imageEdit={imageEdit}
              imageProcessStatus={imageProcessStatus}
              imageProcessResult={imageProcessResult}
              processedImageUrl={processedImageUrl}
              imageProcessError={imageProcessError}
              onSelectPreset={setPreset}
              onUpdateImageEdit={updateImageEdit}
              onRotatePhoto90={rotatePhoto90}
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
