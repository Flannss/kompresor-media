import { Suspense, lazy, useEffect, useRef, type ChangeEvent } from 'react';
import { disposeImageEngine } from '../engines/image/imageEngineClient';
import { UploadZone } from '../features/upload/UploadZone';
import { WorkspaceHeader } from '../features/workspace/WorkspaceHeader';
import { useTheme } from '../shared/hooks/useTheme';
import { useMediaStore } from '../store/useMediaStore';
import { ErrorBoundary } from './ErrorBoundary';

const WorkspaceStage = lazy(() =>
  import('../features/workspace/WorkspaceStage').then((m) => ({
    default: m.WorkspaceStage,
  }))
);

const ACCEPTED_MEDIA =
  'image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/quicktime,video/webm,video/x-matroska,.jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.mov,.webm,.mkv';

export function App() {
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const addMoreInputRef = useRef<HTMLInputElement | null>(null);
  const { theme, toggleTheme } = useTheme();

  const items = useMediaStore((s) => s.items);
  const activeItemId = useMediaStore((s) => s.activeItemId);
  const queueLimits = useMediaStore((s) => s.queueLimits);
  const queueLimitNotice = useMediaStore((s) => s.queueLimitNotice);
  const avifSupported = useMediaStore((s) => s.avifSupported);
  const batchRunning = useMediaStore((s) => s.batchRunning);
  const batchCompleted = useMediaStore((s) => s.batchCompleted);
  const batchTotal = useMediaStore((s) => s.batchTotal);

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

  const initCapabilities = useMediaStore((s) => s.initCapabilities);
  const addMediaFiles = useMediaStore((s) => s.addMediaFiles);
  const selectQueueItem = useMediaStore((s) => s.selectQueueItem);
  const removeQueueItem = useMediaStore((s) => s.removeQueueItem);
  const clearLimitNotice = useMediaStore((s) => s.clearLimitNotice);

  const setPreset = useMediaStore((s) => s.setPreset);
  const applySettingsToAll = useMediaStore((s) => s.applySettingsToAll);
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
  const processAllQueue = useMediaStore((s) => s.processAllQueue);
  const cancelVideoProcessing = useMediaStore((s) => s.cancelVideoProcessing);
  const clearMedia = useMediaStore((s) => s.clearMedia);

  useEffect(() => {
    void initCapabilities();
    return () => {
      useMediaStore.getState().clearMedia();
      disposeImageEngine();
    };
  }, [initCapabilities]);

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

  const handleReplaceInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      void addMediaFiles(files, { replace: true });
    }
    e.target.value = '';
  };

  const handleAddMoreInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      void addMediaFiles(files, { replace: false });
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
          canAddMore={items.length < queueLimits.maxTotal}
          itemCount={items.length}
          maxTotal={queueLimits.maxTotal}
          theme={theme}
          onToggleTheme={toggleTheme}
          onAddMoreClick={() => addMoreInputRef.current?.click()}
          onReplaceClick={() => replaceInputRef.current?.click()}
          onClearClick={clearMedia}
        />

        <input
          ref={replaceInputRef}
          data-testid="header-file-input"
          type="file"
          multiple
          accept={ACCEPTED_MEDIA}
          onChange={handleReplaceInputChange}
          className="sr-only"
          aria-label="Ganti file foto atau video"
        />

        <input
          ref={addMoreInputRef}
          data-testid="header-add-input"
          type="file"
          multiple
          accept={ACCEPTED_MEDIA}
          onChange={handleAddMoreInputChange}
          className="sr-only"
          aria-label="Tambah file foto atau video ke antrean"
        />

        <main className="flex flex-1 flex-col">
          {isReady ? (
            <Suspense
              fallback={
                <div className="bg-cobalt-stage flex flex-1 items-center justify-center text-xs text-[var(--text-secondary)]">
                  Menyiapkan studio…
                </div>
              }
            >
              <WorkspaceStage
                items={items}
                activeItemId={activeItemId}
                maxTotal={queueLimits.maxTotal}
                queueLimitNotice={queueLimitNotice}
                batchRunning={batchRunning}
                batchCompleted={batchCompleted}
                batchTotal={batchTotal}
                metadata={metadata}
                validation={validation}
                objectUrl={objectUrl}
                selectedPresetId={selectedPresetId}
                avifSupported={avifSupported}
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
                onSelectQueueItem={selectQueueItem}
                onRemoveQueueItem={removeQueueItem}
                onAddMoreClick={() => addMoreInputRef.current?.click()}
                onApplyToAll={applySettingsToAll}
                onProcessAll={() => void processAllQueue('auto')}
                onDismissNotice={clearLimitNotice}
                onDropAddFiles={(files) => void addMediaFiles(files, { replace: false })}
                onLoadSingleReplacementFile={(file) => void addMediaFiles([file], { replace: true })}
              />
            </Suspense>
          ) : (
            <UploadZone
              status={status}
              errorMessage={errorMessage}
              queueLimits={queueLimits}
              onFilesSelected={(files) => void addMediaFiles(files, { replace: true })}
            />
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}
