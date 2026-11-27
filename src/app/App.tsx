import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Upload } from 'lucide-react';
import { disposeImageEngine } from '../engines/image/imageEngineClient';
import { UploadZone } from '../features/upload/UploadZone';
import { WorkspaceHeader } from '../features/workspace/WorkspaceHeader';
import { WorkspaceStage } from '../features/workspace/WorkspaceStage';
import { useTheme } from '../shared/hooks/useTheme';
import { useMediaStore } from '../store/useMediaStore';
import { ErrorBoundary } from './ErrorBoundary';

const ACCEPTED_MEDIA =
  'image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/quicktime,video/webm,video/x-matroska,.jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.mov,.webm,.mkv';

export function App() {
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const addMoreInputRef = useRef<HTMLInputElement | null>(null);
  const [isGlobalFileDrag, setIsGlobalFileDrag] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const items = useMediaStore((s) => s.items);
  const activeItemId = useMediaStore((s) => s.activeItemId);
  const deviceProfile = useMediaStore((s) => s.deviceProfile);
  const queueLimits = useMediaStore((s) => s.queueLimits);
  const queueLimitNotice = useMediaStore((s) => s.queueLimitNotice);
  const avifSupported = useMediaStore((s) => s.avifSupported);
  const batchRunning = useMediaStore((s) => s.batchRunning);
  const batchCompleted = useMediaStore((s) => s.batchCompleted);
  const batchTotal = useMediaStore((s) => s.batchTotal);
  const batchStatusLabel = useMediaStore((s) => s.batchStatusLabel);

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
  const baseThumbnailUrl = useMediaStore((s) => s.baseThumbnailUrl);

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
  const selectPhotoFilter = useMediaStore((s) => s.selectPhotoFilter);
  const selectColorGrade = useMediaStore((s) => s.selectColorGrade);
  const requestBaseThumbnail = useMediaStore((s) => s.requestBaseThumbnail);
  const setBaseThumbnail = useMediaStore((s) => s.setBaseThumbnail);
  const ensureFullResPhotoExport = useMediaStore((s) => s.ensureFullResPhotoExport);
  const ensureAllPhotosFullRes = useMediaStore((s) => s.ensureAllPhotosFullRes);
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
    document.documentElement.dataset.glassLite = deviceProfile.useGlassLite ? 'true' : 'false';
  }, [deviceProfile.useGlassLite]);

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

  // Global Ctrl+V / Cmd+V clipboard image paste support across landing and studio
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const clipItems = Array.from(e.clipboardData?.items || []);
      const pastedFiles: File[] = [];
      let idx = 1;
      for (const item of clipItems) {
        if (item.kind === 'file') {
          const rawFile = item.getAsFile();
          if (rawFile) {
            const hasName = rawFile.name && rawFile.name.trim().length > 0 && rawFile.name !== 'image.png';
            const namedFile = hasName
              ? rawFile
              : new File([rawFile], `tempel-foto-${Date.now()}-${idx}.png`, {
                  type: rawFile.type || 'image/png',
                });
            pastedFiles.push(namedFile);
            idx += 1;
          }
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        void addMediaFiles(pastedFiles, { replace: !isReady });
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isReady, addMediaFiles]);

  const handleGlobalDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    if (!isGlobalFileDrag) {
      setIsGlobalFileDrag(true);
    }
  };

  const handleGlobalDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsGlobalFileDrag(false);
    }
  };

  const handleGlobalDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) {
      setIsGlobalFileDrag(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setIsGlobalFileDrag(false);
    const files = Array.from(e.dataTransfer.files);
    void addMediaFiles(files, { replace: !isReady });
  };

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
      <div
        onDragOver={handleGlobalDragOver}
        onDragLeave={handleGlobalDragLeave}
        onDrop={handleGlobalDrop}
        className="relative flex min-h-screen flex-col bg-[var(--bg-app)] text-[var(--text-primary)]"
      >
        {isGlobalFileDrag && isReady && (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-app)]/78 p-4">
            <div className="km-glass-strong flex items-center gap-3 rounded-2xl border-2 border-dashed border-[var(--border-strong)] px-7 py-5 text-sm font-semibold text-[var(--text-primary)]">
              <Upload className="h-5 w-5 text-[var(--accent-gold)]" aria-hidden="true" />
              <span>Lepas file untuk ditambahkan ke antrean</span>
            </div>
          </div>
        )}
        <WorkspaceHeader
          hasMedia={isReady}
          activeMediaKind={isReady && metadata ? metadata.kind : null}
          canAddMore={items.length < queueLimits.maxTotal}
          itemCount={items.length}
          maxTotal={queueLimits.maxTotal}
          isVideoProcessing={videoProcessStatus === 'processing'}
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
            <WorkspaceStage
              items={items}
              activeItemId={activeItemId}
              deviceProfile={deviceProfile}
              maxTotal={queueLimits.maxTotal}
              queueLimitNotice={queueLimitNotice}
              batchRunning={batchRunning}
              batchCompleted={batchCompleted}
              batchTotal={batchTotal}
              batchStatusLabel={batchStatusLabel}
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
              baseThumbnailUrl={baseThumbnailUrl}
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
              onSelectPhotoFilter={selectPhotoFilter}
              onSelectColorGrade={selectColorGrade}
              onRequestPhotoThumbnail={() => void requestBaseThumbnail()}
              onVideoThumbnailReady={setBaseThumbnail}
              onEnsureFullResExport={ensureFullResPhotoExport}
              onEnsureAllPhotosFullRes={ensureAllPhotosFullRes}
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
