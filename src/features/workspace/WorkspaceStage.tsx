import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  Camera,
  ChevronDown,
  Columns2,
  FlipHorizontal2,
  Redo2,
  RotateCcw,
  RotateCw,
  Undo2,
} from 'lucide-react';
import type {
  ImageEditState,
  ImageFilterId,
  ImageProcessResult,
  MediaMetadata,
  NormalizedCropRect,
  Orientation,
  ValidationResult,
  VideoEditState,
  VideoExecutionBackend,
  VideoProcessProgress,
  VideoProcessResult,
} from '../../engines/contracts';
import { computeRotatedDimensions } from '../../engines/image/pixelOps';
import type { MediaPresetId } from '../../presets/mediaPresets';
import { formatBytes } from '../../shared/utils/formatBytes';
import { formatDuration } from '../../shared/utils/formatDuration';
import type { ImageProcessStatus, VideoProcessStatus } from '../../store/useMediaStore';
import { ExportSharePanel } from '../export-share/ExportSharePanel';
import { CropOverlay } from '../image-studio/CropOverlay';
import { PhotoControlPanel } from '../image-studio/PhotoControlPanel';
import { MediaInfoBar } from '../upload/MediaInfoBar';
import { VideoControlPanel, type CapturedFrameInfo } from '../video-studio/VideoControlPanel';
import {
  BeforeAfterPreview,
  getBackdropClasses,
  type StageBackdrop,
} from './BeforeAfterPreview';

export interface WorkspaceStageProps {
  metadata: MediaMetadata;
  validation: Extract<ValidationResult, { valid: true }>;
  objectUrl: string;
  selectedPresetId: MediaPresetId;

  imageEdit: ImageEditState;
  canUndoPhoto: boolean;
  canRedoPhoto: boolean;
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

  onSelectPreset: (id: MediaPresetId) => void;
  onUpdateImageEdit: (
    patch: Partial<Omit<ImageEditState, 'presetId'>>,
    options?: { commitHistory?: boolean; preservePreset?: boolean }
  ) => void;
  onCommitPhotoSnapshot: () => void;
  onRotatePhoto90: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onApplyCrop: (crop: NormalizedCropRect | null) => void;
  onSelectFilter: (filterId: ImageFilterId) => void;
  onUndoPhoto: () => void;
  onRedoPhoto: () => void;
  onResetPhoto: () => void;

  onUpdateVideoEdit: (patch: Partial<VideoEditState>) => void;
  onStartVideoProcess: (preferredBackend?: VideoExecutionBackend | 'auto') => void;
  onCancelVideoProcess: () => void;

  onDropReplaceFile: (file: File) => void;
}

function formatOrientationId(orientation: Orientation): string {
  if (orientation === 'landscape') return 'Mendatar';
  if (orientation === 'portrait') return 'Tegak';
  return 'Persegi';
}

function buildCapturedFrameFileName(videoFileName: string, timeSec: number): string {
  const dotIdx = videoFileName.lastIndexOf('.');
  const base = dotIdx > 0 ? videoFileName.slice(0, dotIdx) : videoFileName;
  const secs = Math.max(0, Math.round(timeSec));
  return `${base || 'video'}-frame-${secs}s.png`;
}

export function WorkspaceStage({
  metadata,
  validation,
  objectUrl,
  selectedPresetId,
  imageEdit,
  canUndoPhoto,
  canRedoPhoto,
  imageProcessStatus,
  imageProcessResult,
  processedImageUrl,
  imageProcessError,
  filterThumbnails,
  videoEdit,
  videoProcessStatus,
  videoProgress,
  videoProcessResult,
  processedVideoUrl,
  videoProcessError,
  onSelectPreset,
  onUpdateImageEdit,
  onCommitPhotoSnapshot,
  onRotatePhoto90,
  onFlipH,
  onFlipV,
  onApplyCrop,
  onSelectFilter,
  onUndoPhoto,
  onRedoPhoto,
  onResetPhoto,
  onUpdateVideoEdit,
  onStartVideoProcess,
  onCancelVideoProcess,
  onDropReplaceFile,
}: WorkspaceStageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isDraggingOverStage, setIsDraggingOverStage] = useState(false);
  const [backdrop, setBackdrop] = useState<StageBackdrop>('light');

  // Photo stage controls
  const [isCropping, setIsCropping] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [splitPct, setSplitPct] = useState(50);
  const [showOriginalPhoto, setShowOriginalPhoto] = useState(false);
  const [orientedCropUrl, setOrientedCropUrl] = useState<string | null>(null);

  // Video stage controls
  const [videoViewMode, setVideoViewMode] = useState<'original' | 'result'>('original');
  const [capturedFrame, setCapturedFrame] = useState<CapturedFrameInfo | null>(null);

  const isImage = metadata.kind === 'image';
  const canSplitCompare =
    isImage &&
    processedImageUrl !== null &&
    imageEdit.rotationDeg === 0 &&
    !imageEdit.flipH &&
    !imageEdit.flipV &&
    imageEdit.crop === null;

  // Reset stage modes when active media file changes
  useEffect(() => {
    setIsCropping(false);
    setCompareMode(false);
    setShowOriginalPhoto(false);
    setVideoViewMode('original');
    setCapturedFrame((prev) => {
      if (prev) {
        setTimeout(() => URL.revokeObjectURL(prev.url), 50);
      }
      return null;
    });
  }, [objectUrl]);

  // Auto-switch video stage to Hasil whenever a new processed video finishes
  useEffect(() => {
    if (processedVideoUrl) {
      setVideoViewMode('result');
    } else {
      setVideoViewMode('original');
    }
  }, [processedVideoUrl]);

  // Revoke any remaining captured frame objectURL on unmount
  useEffect(() => {
    return () => {
      setCapturedFrame((prev) => {
        if (prev) {
          setTimeout(() => URL.revokeObjectURL(prev.url), 50);
        }
        return null;
      });
    };
  }, []);

  // Build oriented canvas preview URL when cropping a rotated/flipped image so crop matches pixel output 1:1
  useEffect(() => {
    if (!isImage || !isCropping) {
      setOrientedCropUrl(null);
      return;
    }
    if (imageEdit.rotationDeg === 0 && !imageEdit.flipH && !imageEdit.flipV) {
      setOrientedCropUrl(objectUrl);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const rotated = computeRotatedDimensions(
        img.naturalWidth || metadata.width,
        img.naturalHeight || metadata.height,
        imageEdit.rotationDeg
      );
      const maxEdge = 1400;
      const scale = Math.min(1, maxEdge / Math.max(rotated.width, rotated.height));
      const canvasW = Math.max(1, Math.round(rotated.width * scale));
      const canvasH = Math.max(1, Math.round(rotated.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setOrientedCropUrl(objectUrl);
        return;
      }

      ctx.save();
      ctx.translate(canvasW / 2, canvasH / 2);
      if (imageEdit.rotationDeg !== 0) {
        ctx.rotate((imageEdit.rotationDeg * Math.PI) / 180);
      }
      ctx.scale(imageEdit.flipH ? -1 : 1, imageEdit.flipV ? -1 : 1);
      const drawW =
        imageEdit.rotationDeg === 90 || imageEdit.rotationDeg === 270 ? canvasH : canvasW;
      const drawH =
        imageEdit.rotationDeg === 90 || imageEdit.rotationDeg === 270 ? canvasW : canvasH;
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();

      setOrientedCropUrl(canvas.toDataURL('image/png'));
    };
    img.src = objectUrl;

    return () => {
      cancelled = true;
    };
  }, [
    isImage,
    isCropping,
    objectUrl,
    imageEdit.rotationDeg,
    imageEdit.flipH,
    imageEdit.flipV,
    metadata.width,
    metadata.height,
  ]);

  // Detach video element cleanly on unmount or source switch
  const activeVideoSrc =
    !isImage && videoViewMode === 'result' && processedVideoUrl ? processedVideoUrl : objectUrl;

  useEffect(() => {
    const videoEl = videoRef.current;
    return () => {
      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
      }
    };
  }, [activeVideoSrc]);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingOverStage) {
      setIsDraggingOverStage(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDraggingOverStage(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverStage(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onDropReplaceFile(file);
    }
  };

  const handleSeekVideoPreview = (timeSec: number) => {
    setVideoViewMode('original');
    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (!Number.isNaN(timeSec) && Number.isFinite(timeSec)) {
      videoEl.currentTime = Math.max(0, timeSec);
    }
  };

  const handleCaptureFrame = () => {
    const videoEl = videoRef.current;
    if (!videoEl || videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) {
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const frameFileName = buildCapturedFrameFileName(
          metadata.fileName,
          videoEl.currentTime || 0
        );
        const frameFile = new File([blob], frameFileName, { type: 'image/png' });
        const nextUrl = URL.createObjectURL(blob);
        setCapturedFrame((prev) => {
          if (prev) {
            setTimeout(() => URL.revokeObjectURL(prev.url), 50);
          }
          return { file: frameFile, url: nextUrl };
        });
      },
      'image/png',
      1
    );
  };

  const handleEditCapturedFrameAsPhoto = () => {
    if (!capturedFrame) return;
    onDropReplaceFile(capturedFrame.file);
  };

  const orientedDimensions = computeRotatedDimensions(
    metadata.width,
    metadata.height,
    imageEdit.rotationDeg
  );

  return (
    <div className="flex min-h-[calc(100vh-56px)] w-full flex-col lg:flex-row">
      {/* Left Studio Preview Stage */}
      <section
        data-testid="workspace-preview-stage"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative flex min-h-[46vh] flex-1 flex-col items-center justify-center gap-3.5 bg-[var(--bg-stage)] px-4 py-5 transition-colors sm:min-h-[52vh] sm:px-8 sm:py-6 lg:min-h-[calc(100vh-56px)] ${
          isDraggingOverStage ? 'ring-2 ring-inset ring-[var(--accent-primary)]' : ''
        }`}
      >
        {isImage ? (
          isCropping && orientedCropUrl ? (
            <CropOverlay
              imageUrl={orientedCropUrl}
              sourceWidth={orientedDimensions.width}
              sourceHeight={orientedDimensions.height}
              initialCrop={imageEdit.crop}
              onApply={(nextCrop) => {
                onApplyCrop(nextCrop);
                setIsCropping(false);
              }}
              onCancel={() => setIsCropping(false)}
            />
          ) : (
            <BeforeAfterPreview
              originalUrl={objectUrl}
              processedUrl={processedImageUrl}
              fileName={metadata.fileName}
              canSplitCompare={canSplitCompare}
              compareMode={compareMode}
              splitPct={splitPct}
              onSplitPctChange={setSplitPct}
              showOriginalOnly={showOriginalPhoto}
              backdrop={backdrop}
            />
          )
        ) : (
          <div
            className={`relative flex max-h-[58vh] w-full max-w-[780px] items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-hairline)] p-1 transition-colors ${getBackdropClasses(backdrop)}`}
            style={{ boxShadow: 'var(--stage-shadow)' }}
          >
            <video
              ref={videoRef}
              key={activeVideoSrc}
              data-testid="preview-video"
              src={activeVideoSrc}
              controls
              playsInline
              preload="metadata"
              className="max-h-[56vh] w-full rounded-xl object-contain"
            />
            {processedVideoUrl && (
              <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
                {videoViewMode === 'result' ? 'Hasil' : 'Asli'}
              </span>
            )}
          </div>
        )}

        {/* Summary pill */}
        <MediaInfoBar
          metadata={metadata}
          validation={validation}
          imageProcessStatus={imageProcessStatus}
          imageProcessResult={imageProcessResult}
          videoProcessStatus={videoProcessStatus}
          videoProcessResult={videoProcessResult}
        />

        {/* Floating Studio Stage Dock */}
        {!isCropping && (
          <div
            data-testid="studio-stage-dock"
            className="flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/95 p-1.5 backdrop-blur-md"
            style={{ boxShadow: 'var(--dock-shadow)' }}
          >
            {isImage ? (
              <>
                {canSplitCompare ? (
                  <button
                    type="button"
                    data-testid="compare-toggle-btn"
                    aria-pressed={compareMode}
                    onClick={() => {
                      setShowOriginalPhoto(false);
                      setCompareMode((v) => !v);
                    }}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-all active:scale-[0.97] ${
                      compareMode
                        ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{compareMode ? 'Tutup Bandingkan' : 'Bandingkan'}</span>
                  </button>
                ) : (
                  processedImageUrl && (
                    <div className="inline-flex rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-0.5 text-[11px]">
                      <button
                        type="button"
                        data-testid="view-original-btn"
                        onClick={() => setShowOriginalPhoto(true)}
                        className={`rounded-lg px-2 py-1 font-medium transition-colors ${
                          showOriginalPhoto
                            ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                            : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        Asli
                      </button>
                      <button
                        type="button"
                        data-testid="view-result-btn"
                        onClick={() => setShowOriginalPhoto(false)}
                        className={`rounded-lg px-2 py-1 font-medium transition-colors ${
                          !showOriginalPhoto
                            ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                            : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        Hasil
                      </button>
                    </div>
                  )
                )}

                <span className="h-4 w-px bg-[var(--border-hairline)]" aria-hidden="true" />

                <button
                  type="button"
                  data-testid="dock-rotate-btn"
                  onClick={onRotatePhoto90}
                  title="Putar 90°"
                  className="inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] active:scale-[0.97]"
                >
                  <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Putar 90°</span>
                </button>

                <button
                  type="button"
                  data-testid="dock-flip-h-btn"
                  aria-pressed={imageEdit.flipH}
                  onClick={onFlipH}
                  title="Balik Horizontal"
                  className={`inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-medium transition-all active:scale-[0.97] ${
                    imageEdit.flipH
                      ? 'bg-[var(--bg-subtle)] text-[var(--accent-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <FlipHorizontal2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Balik H</span>
                </button>

                <span className="h-4 w-px bg-[var(--border-hairline)]" aria-hidden="true" />

                <button
                  type="button"
                  data-testid="dock-undo-btn"
                  disabled={!canUndoPhoto}
                  onClick={onUndoPhoto}
                  title="Urungkan (Ctrl+Z)"
                  className="inline-flex h-8 items-center gap-1 rounded-xl px-2 text-xs font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
                >
                  <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden md:inline">Urungkan</span>
                </button>

                <button
                  type="button"
                  data-testid="dock-redo-btn"
                  disabled={!canRedoPhoto}
                  onClick={onRedoPhoto}
                  title="Ulangi (Ctrl+Shift+Z)"
                  className="inline-flex h-8 items-center gap-1 rounded-xl px-2 text-xs font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
                >
                  <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden md:inline">Ulangi</span>
                </button>

                <button
                  type="button"
                  data-testid="dock-reset-btn"
                  onClick={onResetPhoto}
                  title="Atur ulang editan foto"
                  className="inline-flex h-8 items-center gap-1 rounded-xl px-2 text-xs font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] active:scale-[0.97]"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden md:inline">Atur Ulang</span>
                </button>
              </>
            ) : (
              <>
                {processedVideoUrl && (
                  <>
                    <div className="inline-flex rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-0.5 text-xs">
                      <button
                        type="button"
                        data-testid="video-view-original-btn"
                        onClick={() => setVideoViewMode('original')}
                        className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${
                          videoViewMode === 'original'
                            ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                            : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        Asli
                      </button>
                      <button
                        type="button"
                        data-testid="video-view-result-btn"
                        onClick={() => setVideoViewMode('result')}
                        className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${
                          videoViewMode === 'result'
                            ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                            : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        Hasil
                      </button>
                    </div>
                    <span className="h-4 w-px bg-[var(--border-hairline)]" aria-hidden="true" />
                  </>
                )}

                <button
                  type="button"
                  data-testid="dock-capture-frame-btn"
                  onClick={handleCaptureFrame}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] active:scale-[0.97]"
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Ambil Frame</span>
                </button>
              </>
            )}

            <span className="h-4 w-px bg-[var(--border-hairline)]" aria-hidden="true" />

            {/* 3-Way Canvas Backdrop Switcher */}
            <div
              role="group"
              aria-label="Latar Kanvas"
              className="inline-flex items-center gap-0.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-0.5 text-[11px]"
            >
              {(
                [
                  { id: 'light', label: 'Terang' },
                  { id: 'dark', label: 'Gelap' },
                  { id: 'checker', label: 'Transparan' },
                ] as const
              ).map((bg) => (
                <button
                  key={bg.id}
                  type="button"
                  data-testid={`backdrop-${bg.id}-btn`}
                  aria-pressed={backdrop === bg.id}
                  onClick={() => setBackdrop(bg.id)}
                  className={`rounded-lg px-2 py-1 font-medium transition-colors ${
                    backdrop === bg.id
                      ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {bg.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Right Studio Control Panel */}
      <aside className="flex w-full shrink-0 flex-col gap-5 border-t border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4 sm:p-5 lg:w-[376px] lg:border-l lg:border-t-0">
        {isImage ? (
          <>
            <PhotoControlPanel
              selectedPresetId={selectedPresetId}
              imageEdit={imageEdit}
              imageProcessResult={imageProcessResult}
              filterThumbnails={filterThumbnails}
              isCropping={isCropping}
              onSelectPreset={onSelectPreset}
              onUpdateImageEdit={onUpdateImageEdit}
              onCommitSnapshot={onCommitPhotoSnapshot}
              onToggleCrop={() => setIsCropping((v) => !v)}
              onRotate90={onRotatePhoto90}
              onFlipH={onFlipH}
              onFlipV={onFlipV}
              onSelectFilter={onSelectFilter}
            />

            {imageProcessError && (
              <p
                role="alert"
                className="rounded-xl border border-[var(--status-err-border)] bg-[var(--status-err-bg)] px-3 py-2 text-xs text-[var(--status-err-ink)]"
              >
                {imageProcessError}
              </p>
            )}

            <div className="border-t border-[var(--border-hairline)] pt-4">
              <ExportSharePanel
                mediaKind="image"
                readyBlob={imageProcessResult?.outputBlob ?? null}
                readyUrl={processedImageUrl}
                outputFileName={imageProcessResult?.outputFileName ?? null}
                outputMime={imageProcessResult?.outputMime ?? null}
                isProcessing={imageProcessStatus === 'processing'}
              />
            </div>
          </>
        ) : (
          <VideoControlPanel
            metadata={metadata}
            selectedPresetId={selectedPresetId}
            videoEdit={videoEdit}
            videoProcessStatus={videoProcessStatus}
            videoProgress={videoProgress}
            videoProcessResult={videoProcessResult}
            processedVideoUrl={processedVideoUrl}
            videoProcessError={videoProcessError}
            capturedFrame={capturedFrame}
            onSelectPreset={onSelectPreset}
            onUpdateVideoEdit={onUpdateVideoEdit}
            onStartProcess={() => onStartVideoProcess('auto')}
            onCancelProcess={onCancelVideoProcess}
            onSeekPreview={handleSeekVideoPreview}
            onCaptureFrame={handleCaptureFrame}
            onEditCapturedFrameAsPhoto={handleEditCapturedFrameAsPhoto}
          />
        )}

        {/* Collapsed Detail file Disclosure */}
        <details
          data-testid="file-details-accordion"
          className="group mt-auto border-t border-[var(--border-hairline)] pt-3.5"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
            <span>Detail file</span>
            <ChevronDown
              className="h-4 w-4 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>

          <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs tabular-nums">
            <dt className="text-[var(--text-muted)]">Nama file</dt>
            <dd className="truncate text-right font-medium text-[var(--text-primary)]" title={metadata.fileName}>
              {metadata.fileName}
            </dd>

            <dt className="text-[var(--text-muted)]">Jenis</dt>
            <dd className="text-right font-medium text-[var(--text-primary)]">
              {isImage ? 'Foto' : 'Video'}
            </dd>

            <dt className="text-[var(--text-muted)]">Format asli</dt>
            <dd className="text-right font-medium text-[var(--text-primary)]">
              {validation.signatureLabel}
            </dd>

            <dt className="text-[var(--text-muted)]">Resolusi asli</dt>
            <dd className="text-right font-medium text-[var(--text-primary)]">
              {metadata.width} × {metadata.height}
            </dd>

            <dt className="text-[var(--text-muted)]">Orientasi</dt>
            <dd className="text-right font-medium text-[var(--text-primary)]">
              {formatOrientationId(metadata.orientation)}
            </dd>

            <dt className="text-[var(--text-muted)]">Ukuran asli</dt>
            <dd className="text-right font-medium text-[var(--text-primary)]">
              {formatBytes(metadata.sizeBytes)}
            </dd>

            {!isImage && (
              <>
                <dt className="text-[var(--text-muted)]">Durasi</dt>
                <dd className="text-right font-medium text-[var(--text-primary)]">
                  {formatDuration(metadata.durationSec)}
                </dd>

                <dt className="text-[var(--text-muted)]">Audio</dt>
                <dd className="text-right font-medium text-[var(--text-primary)]">
                  {metadata.hasAudioHint === true ? 'Ada trek audio' : 'Tidak terdeteksi'}
                </dd>
              </>
            )}
          </dl>
        </details>
      </aside>
    </div>
  );
}
