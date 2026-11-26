import { useEffect, useRef, type ChangeEvent } from 'react';
import { disposeImageEngine } from '../engines/image/imageEngineClient';
import { UploadZone } from '../features/upload/UploadZone';
import { WorkspaceHeader } from '../features/workspace/WorkspaceHeader';
import { WorkspaceStage } from '../features/workspace/WorkspaceStage';
import { useTheme } from '../shared/hooks/useTheme';
import { useMediaStore } from '../store/useMediaStore';
import { ErrorBoundary } from './ErrorBoundary';

const ACCEPTED_MEDIA =
  'image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.mov,.webm';

export function App() {
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const { theme, toggleTheme } = useTheme();

  const status = useMediaStore((s) => s.status);
  const validation = useMediaStore((s) => s.validation);
  const metadata = useMediaStore((s) => s.metadata);
  const objectUrl = useMediaStore((s) => s.objectUrl);
  const errorMessage = useMediaStore((s) => s.errorMessage);
  const selectedPresetId = useMediaStore((s) => s.selectedPresetId);

  const imageEdit = useMediaStore((s) => s.imageEdit);
  const photoHistory = useMediaStore((s) => s.photoHistory);
  const photoHistoryIndex = useMediaStore((s) => s.photoHistoryIndex);
  const imageProcessStatus = useMediaStore((s) => s.imageProcessStatus);
  const imageProcessResult = useMediaStore((s) => s.imageProcessResult);
  const processedImageUrl = useMediaStore((s) => s.processedImageUrl);
  const imageProcessError = useMediaStore((s) => s.imageProcessError);
  const filterThumbnails = useMediaStore((s) => s.filterThumbnails);

  const videoEdit = useMediaStore((s) => s.videoEdit);
  const videoProcessStatus = useMediaStore((s) => s.videoProcessStatus);
  const videoProgress = useMediaStore((s) => s.videoProgress);
  const videoProcessResult = useMediaStore((s) => s.videoProcessResult);
  const processedVideoUrl = useMediaStore((s) => s.processedVideoUrl);
  const videoProcessError = useMediaStore((s) => s.videoProcessError);

  const loadMediaFile = useMediaStore((s) => s.loadMediaFile);
  const setPreset = useMediaStore((s) => s.setPreset);
  const updateImageEdit = useMediaStore((s) => s.updateImageEdit);
  const commitCurrentPhotoSnapshot = useMediaStore((s) => s.commitCurrentPhotoSnapshot);
  const rotatePhoto90 = useMediaStore((s) => s.rotatePhoto90);
  const toggleFlipH = useMediaStore((s) => s.toggleFlipH);
  const toggleFlipV = useMediaStore((s) => s.toggleFlipV);
  const applyCrop = useMediaStore((s) => s.applyCrop);
  const selectFilter = useMediaStore((s) => s.selectFilter);
  const undoPhotoEdit = useMediaStore((s) => s.undoPhotoEdit);
  const redoPhotoEdit = useMediaStore((s) => s.redoPhotoEdit);
  const resetPhotoEdits = useMediaStore((s) => s.resetPhotoEdits);

  const updateVideoEdit = useMediaStore((s) => s.updateVideoEdit);
  const startVideoProcessing = useMediaStore((s) => s.startVideoProcessing);
  const cancelVideoProcessing = useMediaStore((s) => s.cancelVideoProcessing);
  const clearMedia = useMediaStore((s) => s.clearMedia);

  useEffect(() => {
    return () => {
      useMediaStore.getState().clearMedia();
      disposeImageEngine();
    };
  }, []);

  const isReady =
    status === 'ready' && metadata !== null && validation?.valid === true && objectUrl !== null;

  useEffect(() => {
    if (!isReady || metadata?.kind !== 'image') {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoPhotoEdit();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redoPhotoEdit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isReady, metadata?.kind, undoPhotoEdit, redoPhotoEdit]);

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

  const canUndoPhoto = photoHistoryIndex > 0;
  const canRedoPhoto = photoHistoryIndex < photoHistory.length - 1;

  return (
    <ErrorBoundary onReset={clearMedia}>
      <div className="flex min-h-screen flex-col bg-[var(--bg-app)] text-[var(--text-primary)]">
        <WorkspaceHeader
          hasMedia={isReady}
          theme={theme}
          onToggleTheme={toggleTheme}
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
              canUndoPhoto={canUndoPhoto}
              canRedoPhoto={canRedoPhoto}
              imageProcessStatus={imageProcessStatus}
              imageProcessResult={imageProcessResult}
              processedImageUrl={processedImageUrl}
              imageProcessError={imageProcessError}
              filterThumbnails={filterThumbnails}
              videoEdit={videoEdit}
              videoProcessStatus={videoProcessStatus}
              videoProgress={videoProgress}
              videoProcessResult={videoProcessResult}
              processedVideoUrl={processedVideoUrl}
              videoProcessError={videoProcessError}
              onSelectPreset={setPreset}
              onUpdateImageEdit={updateImageEdit}
              onCommitPhotoSnapshot={commitCurrentPhotoSnapshot}
              onRotatePhoto90={rotatePhoto90}
              onFlipH={toggleFlipH}
              onFlipV={toggleFlipV}
              onApplyCrop={applyCrop}
              onSelectFilter={selectFilter}
              onUndoPhoto={undoPhotoEdit}
              onRedoPhoto={redoPhotoEdit}
              onResetPhoto={resetPhotoEdits}
              onUpdateVideoEdit={updateVideoEdit}
              onStartVideoProcess={(backend) => void startVideoProcessing(backend)}
              onCancelVideoProcess={cancelVideoProcessing}
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
