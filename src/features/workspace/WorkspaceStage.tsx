import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  AlertCircle,
  Camera,
  ChevronDown,
  Columns2,
  Download,
  Eye,
  FlipHorizontal2,
  Image as ImageIcon,
  Play,
  Redo2,
  RotateCcw,
  RotateCw,
  Send,
  SlidersHorizontal,
  Undo2,
  X,
} from 'lucide-react';
import type {
  ColorGradeId,
  ImageEditState,
  ImageProcessResult,
  MediaMetadata,
  NormalizedCropRect,
  Orientation,
  PhotoFilterId,
  ValidationResult,
  VideoEditState,
  VideoExecutionBackend,
  VideoProcessProgress,
  VideoProcessResult,
} from '../../engines/contracts';
import { releaseCanvasSurface } from '../../engines/image/pipelineRunner';
import { computeRotatedDimensions } from '../../engines/image/pixelOps';
import type { MediaPresetId } from '../../presets/mediaPresets';
import type { DeviceProfile } from '../../shared/utils/deviceCapability';
import { formatBytes } from '../../shared/utils/formatBytes';
import { formatDuration } from '../../shared/utils/formatDuration';
import type { ImageProcessStatus, QueueItem, VideoProcessStatus } from '../../store/useMediaStore';
import { ExportSharePanel } from '../export-share/ExportSharePanel';
import { executeWhatsAppShareFlow, triggerObjectUrlDownload } from '../export-share/shareHelper';
import type { ZipEntryInput } from '../export-share/zipExport';
import { CropOverlay } from '../image-studio/CropOverlay';
import { PhotoControlPanel } from '../image-studio/PhotoControlPanel';
import { MediaInfoBar } from '../upload/MediaInfoBar';
import {
  VideoCompareStage,
  type VideoCompareViewMode,
} from '../video-studio/VideoCompareStage';
import { VideoControlPanel, type CapturedFrameInfo } from '../video-studio/VideoControlPanel';
import {
  BeforeAfterPreview,
  type PhotoCompareViewMode,
  type PhotoZoomLevel,
  type StageBackdrop,
} from './BeforeAfterPreview';
import { CoreSummaryCard } from './CoreSummaryCard';
import { QueuePanel } from './QueuePanel';

export interface WorkspaceStageProps {
  items: QueueItem[];
  activeItemId: string | null;
  deviceProfile: DeviceProfile;
  maxTotal: number;
  queueLimitNotice: string | null;
  batchRunning: boolean;
  batchCompleted: number;
  batchTotal: number;
  batchStatusLabel?: string | null;

  metadata: MediaMetadata;
  validation: Extract<ValidationResult, { valid: true }>;
  objectUrl: string;
  selectedPresetId: MediaPresetId;
  avifSupported: boolean;

  imageEdit: ImageEditState;
  canUndoPhoto: boolean;
  canRedoPhoto: boolean;
  imageProcessStatus: ImageProcessStatus;
  imageProcessResult: ImageProcessResult | null;
  processedImageUrl: string | null;
  imageProcessError: string | null;
  baseThumbnailUrl: string | null;

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
  onSelectPhotoFilter: (filterId: PhotoFilterId) => void;
  onSelectColorGrade: (gradeId: ColorGradeId) => void;
  onRequestPhotoThumbnail: () => void;
  onVideoThumbnailReady: (itemId: string, url: string) => void;
  onEnsureFullResExport: (itemId?: string) => Promise<{
    result: ImageProcessResult;
    url: string;
  } | null>;
  onEnsureAllPhotosFullRes: () => Promise<QueueItem[]>;
  onUndoPhoto: () => void;
  onRedoPhoto: () => void;
  onResetPhoto: () => void;

  onUpdateVideoEdit: (patch: Partial<VideoEditState>) => void;
  onStartVideoProcess: (preferredBackend?: VideoExecutionBackend | 'auto') => void;
  onCancelVideoProcess: () => void;

  onSelectQueueItem: (id: string) => void;
  onRemoveQueueItem: (id: string) => void;
  onAddMoreClick: () => void;
  onApplyToAll: () => void;
  onProcessAll: () => void;
  onDismissNotice: () => void;
  onDropAddFiles: (files: File[]) => void;
  onLoadSingleReplacementFile: (file: File) => void;
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
  items,
  activeItemId,
  deviceProfile,
  maxTotal,
  queueLimitNotice,
  batchRunning,
  batchCompleted,
  batchTotal,
  batchStatusLabel = null,
  metadata,
  validation,
  objectUrl,
  selectedPresetId,
  avifSupported,
  imageEdit,
  canUndoPhoto,
  canRedoPhoto,
  imageProcessStatus,
  imageProcessResult,
  processedImageUrl,
  imageProcessError,
  baseThumbnailUrl,
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
  onSelectPhotoFilter,
  onSelectColorGrade,
  onRequestPhotoThumbnail,
  onVideoThumbnailReady,
  onEnsureFullResExport,
  onEnsureAllPhotosFullRes,
  onUndoPhoto,
  onRedoPhoto,
  onResetPhoto,
  onUpdateVideoEdit,
  onStartVideoProcess,
  onCancelVideoProcess,
  onSelectQueueItem,
  onRemoveQueueItem,
  onAddMoreClick,
  onApplyToAll,
  onProcessAll,
  onDismissNotice,
  onDropAddFiles,
  onLoadSingleReplacementFile,
}: WorkspaceStageProps) {
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const [isDraggingOverStage, setIsDraggingOverStage] = useState(false);
  const [backdrop, setBackdrop] = useState<StageBackdrop>('studio');

  const [isCropping, setIsCropping] = useState(false);
  const [photoViewMode, setPhotoViewMode] = useState<PhotoCompareViewMode>('single');
  const [photoZoom, setPhotoZoom] = useState<PhotoZoomLevel>('fit');
  const [splitPct, setSplitPct] = useState(50);
  const [showOriginalPhoto, setShowOriginalPhoto] = useState(false);
  const [holdOriginalMedia, setHoldOriginalMedia] = useState(false);
  const [orientedCropUrl, setOrientedCropUrl] = useState<string | null>(null);
  const [mobilePreparingExport, setMobilePreparingExport] = useState(false);

  const [videoCompareViewMode, setVideoCompareViewMode] =
    useState<VideoCompareViewMode>('single');
  const [videoThumbRequested, setVideoThumbRequested] = useState(false);
  const [seekRequestSec, setSeekRequestSec] = useState<{ sec: number; seq: number } | null>(null);
  const [capturedFrame, setCapturedFrame] = useState<CapturedFrameInfo | null>(null);

  const activeQueueItem = items.find((i) => i.id === activeItemId);
  const needsFullResExport = Boolean(activeQueueItem?.needsFullResExport);
  const isImage = metadata.kind === 'image';
  const canSplitCompare =
    isImage &&
    processedImageUrl !== null &&
    imageEdit.rotationDeg === 0 &&
    imageEdit.straightenDeg === 0 &&
    !imageEdit.flipH &&
    !imageEdit.flipV &&
    imageEdit.crop === null;

  const finishedBatchItems: ZipEntryInput[] = useMemo(() => {
    const out: ZipEntryInput[] = [];
    for (const item of items) {
      if (item.imageResult) {
        out.push({
          fileName: item.imageResult.outputFileName,
          blob: item.imageResult.outputBlob,
        });
      } else if (item.videoResult) {
        out.push({
          fileName: item.videoResult.outputFileName,
          blob: item.videoResult.outputBlob,
        });
      }
    }
    return out;
  }, [items]);

  useEffect(() => {
    setIsCropping(false);
    setPhotoViewMode('single');
    setPhotoZoom('fit');
    setShowOriginalPhoto(false);
    setHoldOriginalMedia(false);
    setVideoCompareViewMode('single');
    setVideoThumbRequested(false);
    setSeekRequestSec(null);
    setCapturedFrame((prev) => {
      if (prev) {
        setTimeout(() => URL.revokeObjectURL(prev.url), 250);
      }
      return null;
    });
  }, [objectUrl]);

  useEffect(() => {
    if (!isImage && backdrop === 'checker') {
      setBackdrop('studio');
    }
  }, [isImage, backdrop]);

  useEffect(() => {
    return () => {
      setCapturedFrame((prev) => {
        if (prev) {
          setTimeout(() => URL.revokeObjectURL(prev.url), 250);
        }
        return null;
      });
    };
  }, []);

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
      const maxEdge = deviceProfile.performanceTier === 'low-memory-mobile' ? 960 : 1400;
      const scale = Math.min(1, maxEdge / Math.max(rotated.width, rotated.height));
      const canvasW = Math.max(1, Math.round(rotated.width * scale));
      const canvasH = Math.max(1, Math.round(rotated.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      try {
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
      } finally {
        releaseCanvasSurface(canvas);
      }
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
    deviceProfile.performanceTier,
  ]);

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
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) {
      onDropAddFiles(files);
    }
  };

  const handleSeekVideoPreview = (timeSec: number) => {
    if (!Number.isNaN(timeSec) && Number.isFinite(timeSec)) {
      setSeekRequestSec({ sec: Math.max(0, timeSec), seq: Date.now() });
    }
  };

  const handleCaptureFrame = () => {
    const videoEl = videoElementRef.current;
    if (!videoEl || videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) {
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      releaseCanvasSurface(canvas);
      return;
    }
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        releaseCanvasSurface(canvas);
        if (!blob) return;
        const frameFileName = buildCapturedFrameFileName(
          metadata.fileName,
          videoEl.currentTime || 0
        );
        const frameFile = new File([blob], frameFileName, { type: 'image/png' });
        const nextUrl = URL.createObjectURL(blob);
        setCapturedFrame((prev) => {
          if (prev) {
            setTimeout(() => URL.revokeObjectURL(prev.url), 250);
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
    onLoadSingleReplacementFile(capturedFrame.file);
  };

  const handlePreparePhotoFullRes = async () => {
    const res = await onEnsureFullResExport();
    if (!res) return null;
    return {
      blob: res.result.outputBlob,
      url: res.url,
      fileName: res.result.outputFileName,
      mimeType: res.result.outputMime,
      width: res.result.outputWidth,
      height: res.result.outputHeight,
    };
  };

  const handleDownloadQueueItem = async (itemId: string) => {
    const targetItem = items.find((i) => i.id === itemId);
    if (!targetItem) return;
    if (targetItem.metadata.kind === 'image') {
      const prepared = await onEnsureFullResExport(itemId);
      if (!prepared) return;
      triggerObjectUrlDownload(prepared.url, prepared.result.outputFileName);
      return;
    }
    const readyName = targetItem.videoResult?.outputFileName ?? null;
    if (targetItem.outputUrl && readyName) {
      triggerObjectUrlDownload(targetItem.outputUrl, readyName);
    }
  };

  const handlePrepareAllZipItems = async (): Promise<ZipEntryInput[]> => {
    const freshItems = await onEnsureAllPhotosFullRes();
    const out: ZipEntryInput[] = [];
    for (const item of freshItems) {
      if (item.imageResult) {
        out.push({
          fileName: item.imageResult.outputFileName,
          blob: item.imageResult.outputBlob,
        });
      } else if (item.videoResult) {
        out.push({
          fileName: item.videoResult.outputFileName,
          blob: item.videoResult.outputBlob,
        });
      }
    }
    return out;
  };

  const orientedDimensions = computeRotatedDimensions(
    metadata.width,
    metadata.height,
    imageEdit.rotationDeg
  );

  const activeExportBlob = isImage
    ? (imageProcessResult?.outputBlob ?? null)
    : (videoProcessResult?.outputBlob ?? null);
  const activeExportUrl = isImage ? processedImageUrl : processedVideoUrl;
  const activeExportName = isImage
    ? (imageProcessResult?.outputFileName ?? null)
    : (videoProcessResult?.outputFileName ?? null);
  const activeExportMime = isImage
    ? (imageProcessResult?.outputMime ?? null)
    : (videoProcessResult?.outputMime ?? null);

  return (
    <div className="flex min-h-[calc(100vh-56px)] w-full flex-col lg:flex-row">
      <QueuePanel
        items={items}
        activeItemId={activeItemId}
        maxTotal={maxTotal}
        batchRunning={batchRunning}
        batchCompleted={batchCompleted}
        batchTotal={batchTotal}
        batchStatusLabel={batchStatusLabel}
        onSelectItem={onSelectQueueItem}
        onRemoveItem={onRemoveQueueItem}
        onDownloadItem={(id) => void handleDownloadQueueItem(id)}
        onAddMoreClick={onAddMoreClick}
        onApplyToAll={onApplyToAll}
        onProcessAll={onProcessAll}
      />

      {/* Center Studio Preview Stage */}
      <section
        data-testid="workspace-preview-stage"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`bg-warm-stage relative flex min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-center gap-2.5 px-3 py-3 transition-colors sm:min-h-[50vh] sm:gap-4 sm:px-7 sm:py-6 md:min-h-[46vh] lg:min-h-[calc(100vh-60px)] lg:px-8 lg:py-7 ${
          isDraggingOverStage ? 'ring-2 ring-inset ring-[var(--border-active)]' : ''
        }`}
      >
        {queueLimitNotice && (
          <div
            data-testid="queue-limit-notice"
            className="flex max-w-xl items-center gap-2 rounded-xl border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-3 py-2 text-xs text-[var(--status-warn-ink)]"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="flex-1">{queueLimitNotice}</span>
            <button
              type="button"
              onClick={onDismissNotice}
              aria-label="Tutup pemberitahuan"
              className="rounded p-0.5 hover:opacity-80"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

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
              viewMode={photoViewMode}
              zoomLevel={photoZoom}
              splitPct={splitPct}
              onSplitPctChange={setSplitPct}
              showOriginalOnly={showOriginalPhoto || holdOriginalMedia}
              backdrop={backdrop}
            />
          )
        ) : (
          <VideoCompareStage
            itemId={activeItemId}
            sourceSizeBytes={metadata.sizeBytes}
            videoWidth={metadata.width}
            videoHeight={metadata.height}
            deviceProfile={deviceProfile}
            objectUrl={objectUrl}
            processedVideoUrl={processedVideoUrl}
            videoEdit={videoEdit}
            videoProcessResult={videoProcessResult}
            backdrop={backdrop}
            compareViewMode={videoCompareViewMode}
            onChangeCompareViewMode={setVideoCompareViewMode}
            holdOriginalActive={holdOriginalMedia}
            onHoldOriginalChange={setHoldOriginalMedia}
            thumbnailRequested={videoThumbRequested}
            baseThumbnailUrl={baseThumbnailUrl}
            onBaseThumbnailReady={onVideoThumbnailReady}
            seekRequestSec={seekRequestSec}
            videoElementRef={(el) => {
              videoElementRef.current = el;
            }}
          />
        )}

        <MediaInfoBar
          metadata={metadata}
          validation={validation}
          deviceProfile={deviceProfile}
          imageEdit={imageEdit}
          needsFullResExport={needsFullResExport}
          imageProcessStatus={imageProcessStatus}
          imageProcessResult={imageProcessResult}
          videoProcessStatus={videoProcessStatus}
          videoProcessResult={videoProcessResult}
        />

        {/* Studio Stage Dock (km-glass-lite: zero backdrop-blur over video/mobile for 60fps compositing) */}
        {!isCropping && (
          <div
            data-testid="studio-stage-dock"
            className="km-glass-lite my-0.5 flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-[22px] border px-2 py-1.5 sm:my-0 sm:rounded-full"
          >
            {isImage ? (
              <>
                <div
                  role="group"
                  aria-label="Zoom Detail"
                  className="inline-flex items-center gap-0.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-0.5 text-[11px]"
                >
                  {(
                    [
                      { id: 'fit', label: 'Fit' },
                      { id: '100', label: '100%' },
                      { id: '200', label: '200%' },
                    ] as const
                  ).map((z) => (
                    <button
                      key={z.id}
                      type="button"
                      data-testid={`photo-zoom-${z.id}-btn`}
                      aria-pressed={photoZoom === z.id}
                      onClick={() => setPhotoZoom(z.id)}
                      className={`min-h-[34px] rounded-full px-2.5 py-1 font-medium tabular-nums transition-colors ${
                        photoZoom === z.id
                          ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {z.label}
                    </button>
                  ))}
                </div>
                {processedImageUrl && (
                  <div
                    role="group"
                    aria-label="Mode Pratinjau Foto"
                    className="inline-flex items-center gap-0.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-0.5 text-[11px]"
                  >
                    <button
                      type="button"
                      data-testid="photo-mode-single-btn"
                      aria-pressed={photoViewMode === 'single'}
                      onClick={() => {
                        setShowOriginalPhoto(false);
                        setPhotoViewMode('single');
                      }}
                      className={`inline-flex min-h-[34px] items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors ${
                        photoViewMode === 'single'
                          ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <ImageIcon className="h-3 w-3" aria-hidden="true" />
                      <span>Tunggal</span>
                    </button>

                    {canSplitCompare && (
                      <button
                        type="button"
                        data-testid="compare-toggle-btn"
                        aria-pressed={photoViewMode === 'split'}
                        onClick={() => {
                          setShowOriginalPhoto(false);
                          setPhotoViewMode((v) => (v === 'split' ? 'single' : 'split'));
                        }}
                        className={`inline-flex min-h-[34px] items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors ${
                          photoViewMode === 'split'
                            ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                        <span>Geser Belah</span>
                      </button>
                    )}

                    <button
                      type="button"
                      data-testid="photo-mode-side-by-side-btn"
                      aria-pressed={photoViewMode === 'side-by-side'}
                      onClick={() => {
                        setShowOriginalPhoto(false);
                        setPhotoViewMode((v) =>
                          v === 'side-by-side' ? 'single' : 'side-by-side'
                        );
                      }}
                      className={`inline-flex min-h-[34px] items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors ${
                        photoViewMode === 'side-by-side'
                          ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <Columns2 className="h-3 w-3" aria-hidden="true" />
                      <span>Sandingkan</span>
                    </button>
                  </div>
                )}

                {processedImageUrl && !canSplitCompare && photoViewMode === 'single' && (
                  <div className="inline-flex rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-0.5 text-[11px]">
                    <button
                      type="button"
                      data-testid="view-original-btn"
                      onClick={() => setShowOriginalPhoto(true)}
                      className={`min-h-[32px] rounded-lg px-2 py-1 font-medium transition-colors ${
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
                      className={`min-h-[32px] rounded-lg px-2 py-1 font-medium transition-colors ${
                        !showOriginalPhoto
                          ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      Hasil
                    </button>
                  </div>
                )}

                {processedImageUrl && (
                  <button
                    type="button"
                    data-testid="photo-hold-original-btn"
                    onPointerDown={() => setHoldOriginalMedia(true)}
                    onPointerUp={() => setHoldOriginalMedia(false)}
                    onPointerLeave={() => setHoldOriginalMedia(false)}
                    onPointerCancel={() => setHoldOriginalMedia(false)}
                    className="inline-flex min-h-[38px] items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] select-none"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Tahan: Asli</span>
                  </button>
                )}

                <span className="h-4 w-px bg-[var(--border-hairline)]" aria-hidden="true" />

                <button
                  type="button"
                  data-testid="dock-rotate-btn"
                  onClick={onRotatePhoto90}
                  title="Putar 90°"
                  className="inline-flex min-h-[38px] items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] active:scale-[0.97]"
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
                  className={`inline-flex min-h-[38px] items-center gap-1 rounded-xl px-2.5 text-xs font-medium transition-all active:scale-[0.97] ${
                    imageEdit.flipH
                      ? 'bg-[var(--bg-subtle)] text-[var(--accent-highlight)]'
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
                  className="inline-flex min-h-[38px] items-center gap-1 rounded-xl px-2 text-xs font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
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
                  className="inline-flex min-h-[38px] items-center gap-1 rounded-xl px-2 text-xs font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
                >
                  <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden md:inline">Ulangi</span>
                </button>

                <button
                  type="button"
                  data-testid="dock-reset-btn"
                  onClick={onResetPhoto}
                  title="Atur ulang editan foto"
                  className="inline-flex min-h-[38px] items-center gap-1 rounded-xl px-2 text-xs font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] active:scale-[0.97]"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden md:inline">Atur Ulang</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                data-testid="dock-capture-frame-btn"
                onClick={handleCaptureFrame}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] active:scale-[0.97]"
              >
                <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Ambil Frame</span>
              </button>
            )}

            <span className="h-4 w-px bg-[var(--border-hairline)]" aria-hidden="true" />

            {/* Canvas Backdrop Switcher (Video never uses Transparan checkerboard) */}
            <div
              role="group"
              aria-label="Latar Kanvas"
              className="inline-flex flex-wrap items-center gap-0.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-0.5 text-[11px]"
            >
              {(isImage
                ? ([
                    { id: 'studio', label: 'Studio' },
                    { id: 'light', label: 'Terang' },
                    { id: 'dark', label: 'Gelap' },
                    { id: 'checker', label: 'Transparan' },
                  ] as const)
                : ([
                    { id: 'studio', label: 'Studio' },
                    { id: 'light', label: 'Terang' },
                    { id: 'dark', label: 'Gelap' },
                  ] as const)
              ).map((bg) => (
                <button
                  key={bg.id}
                  type="button"
                  data-testid={`backdrop-${bg.id}-btn`}
                  aria-pressed={backdrop === bg.id}
                  onClick={() => setBackdrop(bg.id)}
                  className={`min-h-[32px] rounded-full px-2.5 py-1 font-medium transition-colors ${
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

      {/* Right Inspector Panel (flattened airy stack on Mobile, 2-column balanced grid on Tablet md..lg-1, single rail on Desktop) */}
      <aside className="km-glass flex w-full shrink-0 flex-col gap-5 border-t px-3.5 py-5 pb-28 sm:p-6 md:grid md:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.9fr)] md:items-start md:gap-6 md:px-7 md:pb-8 lg:flex lg:w-[404px] xl:w-[424px] lg:flex-col lg:items-stretch lg:gap-5 lg:border-l lg:border-t-0 lg:p-6">
        <div className="min-w-0">
          {isImage ? (
            <PhotoControlPanel
              selectedPresetId={selectedPresetId}
              deviceProfile={deviceProfile}
              imageEdit={imageEdit}
              imageProcessResult={imageProcessResult}
              baseThumbnailUrl={baseThumbnailUrl}
              avifSupported={avifSupported}
              isCropping={isCropping}
              holdOriginalActive={holdOriginalMedia}
              onHoldOriginalChange={setHoldOriginalMedia}
              onSelectPreset={onSelectPreset}
              onUpdateImageEdit={onUpdateImageEdit}
              onCommitSnapshot={onCommitPhotoSnapshot}
              onToggleCrop={() => setIsCropping((v) => !v)}
              onRotate90={onRotatePhoto90}
              onFlipH={onFlipH}
              onFlipV={onFlipV}
              onSelectPhotoFilter={onSelectPhotoFilter}
              onRequestThumbnail={onRequestPhotoThumbnail}
              onResetPhoto={onResetPhoto}
            />
          ) : (
            <VideoControlPanel
              metadata={metadata}
              deviceProfile={deviceProfile}
              selectedPresetId={selectedPresetId}
              videoEdit={videoEdit}
              baseThumbnailUrl={baseThumbnailUrl}
              onRequestThumbnail={() => setVideoThumbRequested(true)}
              holdOriginalActive={holdOriginalMedia}
              onHoldOriginalChange={setHoldOriginalMedia}
              videoProcessStatus={videoProcessStatus}
              videoProgress={videoProgress}
              videoProcessResult={videoProcessResult}
              processedVideoUrl={processedVideoUrl}
              videoProcessError={videoProcessError}
              capturedFrame={capturedFrame}
              finishedBatchItems={finishedBatchItems}
              batchStatusLabel={batchStatusLabel}
              onPrepareAllZipItems={handlePrepareAllZipItems}
              onSelectPreset={onSelectPreset}
              onUpdateVideoEdit={onUpdateVideoEdit}
              onSelectColorGrade={onSelectColorGrade}
              onStartProcess={() => onStartVideoProcess('auto')}
              onCancelProcess={onCancelVideoProcess}
              onSeekPreview={handleSeekVideoPreview}
              onCaptureFrame={handleCaptureFrame}
              onEditCapturedFrameAsPhoto={handleEditCapturedFrameAsPhoto}
            />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:flex-1">
          {imageProcessError && isImage && (
            <p
              role="alert"
              className="rounded-xl border border-[var(--status-err-border)] bg-[var(--status-err-bg)] px-3 py-2 text-xs text-[var(--status-err-ink)]"
            >
              {imageProcessError}
            </p>
          )}

          <CoreSummaryCard
            metadata={metadata}
            deviceProfile={deviceProfile}
            selectedPresetId={selectedPresetId}
            imageEdit={imageEdit}
            imageProcessResult={imageProcessResult}
            needsFullResExport={needsFullResExport}
            videoEdit={videoEdit}
            videoProcessResult={videoProcessResult}
          />

          {isImage && (
            <div className="border-t border-[var(--border-hairline)] pt-3">
              <ExportSharePanel
                mediaKind="image"
                readyBlob={imageProcessResult?.outputBlob ?? null}
                readyUrl={processedImageUrl}
                outputFileName={imageProcessResult?.outputFileName ?? null}
                outputMime={imageProcessResult?.outputMime ?? null}
                exportedWidth={imageProcessResult?.outputWidth ?? null}
                exportedHeight={imageProcessResult?.outputHeight ?? null}
                exportedBytes={imageProcessResult?.outputBytes ?? null}
                selectedPresetId={selectedPresetId}
                targetResolution={imageEdit.targetResolution}
                finishedBatchItems={finishedBatchItems}
                batchStatusLabel={batchStatusLabel}
                needsFullResPreparation={needsFullResExport}
                onPrepareFullResExport={handlePreparePhotoFullRes}
                onPrepareAllZipItems={handlePrepareAllZipItems}
                isProcessing={imageProcessStatus === 'processing'}
              />
            </div>
          )}

          <details
            data-testid="file-details-accordion"
            className="group border-t border-[var(--border-hairline)] pt-3.5 lg:mt-auto"
          >
          <summary className="flex min-h-[38px] cursor-pointer list-none items-center justify-between py-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
            <span>Detail teknis</span>
            <ChevronDown
              className="h-4 w-4 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>

          <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs tabular-nums">
            <dt className="text-[var(--text-muted)]">Nama file</dt>
            <dd
              className="truncate text-right font-medium text-[var(--text-primary)]"
              title={metadata.fileName}
            >
              {metadata.fileName}
            </dd>

            <dt className="text-[var(--text-muted)]">Jenis</dt>
            <dd className="text-right font-medium text-[var(--text-primary)]">
              {isImage ? 'Foto' : 'Video'}
            </dd>

            <dt className="text-[var(--text-muted)]">Format asli</dt>
            <dd className="text-right font-medium text-[var(--text-primary)]">
              {validation.signatureLabel} ({metadata.mimeType})
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

            {isImage ? (
              imageProcessResult && (
                <>
                  <dt className="text-[var(--text-muted)]">Mesin proses</dt>
                  <dd className="text-right font-medium text-[var(--text-primary)]">
                    {imageProcessResult.backend} ({imageProcessResult.outputMime})
                  </dd>
                </>
              )
            ) : (
              <>
                <dt className="text-[var(--text-muted)]">Durasi</dt>
                <dd className="text-right font-medium text-[var(--text-primary)]">
                  {formatDuration(metadata.durationSec)}
                </dd>

                <dt className="text-[var(--text-muted)]">Audio</dt>
                <dd className="text-right font-medium text-[var(--text-primary)]">
                  {metadata.hasAudioHint === true ? 'Ada trek audio' : 'Tidak terdeteksi'}
                </dd>

                <dt className="text-[var(--text-muted)]">Parameter video</dt>
                <dd className="text-right font-medium text-[var(--text-primary)]">
                  CRF {videoEdit.crf} · Bitrate {Math.round(videoEdit.targetBitrateBps / 1000)} kbps ·
                  Audio {videoEdit.audio.bitrateKbps} kbps
                </dd>

                {videoProcessResult && (
                  <>
                    <dt className="text-[var(--text-muted)]">Mesin / Muxer</dt>
                    <dd className="text-right font-medium text-[var(--text-primary)]">
                      {videoProcessResult.backend} ({videoProcessResult.outputMime})
                    </dd>
                    {videoProcessResult.engineDetail && (
                      <>
                        <dt className="text-[var(--text-muted)]">Rantai filter</dt>
                        <dd className="break-all text-right font-mono text-[10px] text-[var(--text-secondary)]">
                          {videoProcessResult.engineDetail}
                        </dd>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </dl>
        </details>
        </div>
      </aside>

      {/* Mobile Sticky Bottom Action Bar (< 768px) with safe-area padding & km-glass-lite surface */}
      <div
        data-testid="mobile-sticky-action-bar"
        className="km-glass-lite sticky bottom-0 z-20 flex items-center gap-2 border-t px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:hidden"
      >
        {activeExportUrl && activeExportName && activeExportBlob && activeExportMime ? (
          <>
            <button
              type="button"
              data-testid="mobile-sticky-download-btn"
              disabled={mobilePreparingExport}
              onClick={() => {
                void (async () => {
                  if (isImage && needsFullResExport) {
                    setMobilePreparingExport(true);
                    let target = null;
                    try {
                      target = await handlePreparePhotoFullRes();
                    } finally {
                      setMobilePreparingExport(false);
                    }
                    if (!target) return;
                    triggerObjectUrlDownload(target.url, target.fileName);
                    return;
                  }
                  triggerObjectUrlDownload(activeExportUrl, activeExportName);
                })();
              }}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent-primary)] px-3 text-xs font-semibold text-[var(--ink-on-accent)] disabled:opacity-60"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>
                {mobilePreparingExport ? 'Merender HD…' : 'Simpan File HD'}
              </span>
            </button>
            <button
              type="button"
              data-testid="mobile-sticky-whatsapp-btn"
              disabled={mobilePreparingExport}
              onClick={() => {
                void (async () => {
                  if (isImage && needsFullResExport) {
                    setMobilePreparingExport(true);
                    let target = null;
                    try {
                      target = await handlePreparePhotoFullRes();
                    } finally {
                      setMobilePreparingExport(false);
                    }
                    if (!target) return;
                    await executeWhatsAppShareFlow({
                      blob: target.blob,
                      objectUrl: target.url,
                      fileName: target.fileName,
                      mimeType: target.mimeType,
                    });
                    return;
                  }
                  await executeWhatsAppShareFlow({
                    blob: activeExportBlob,
                    objectUrl: activeExportUrl,
                    fileName: activeExportName,
                    mimeType: activeExportMime,
                  });
                })();
              }}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--border-active)] bg-[var(--bg-elevated)] px-3.5 text-xs font-semibold text-[var(--text-primary)] disabled:opacity-60"
            >
              <Send className="h-4 w-4 text-[var(--accent-highlight)]" aria-hidden="true" />
              <span>Bagikan</span>
            </button>
          </>
        ) : isImage ? (
          <div className="flex flex-1 items-center justify-center py-2 text-xs font-medium text-[var(--text-secondary)]">
            Mengoptimalkan foto HD…
          </div>
        ) : videoProcessStatus === 'processing' ? (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
              <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[var(--accent-highlight)]" />
              <span className="truncate">Memproses Video HD…</span>
            </div>
            <button
              type="button"
              data-testid="mobile-sticky-cancel-btn"
              onClick={onCancelVideoProcess}
              className="inline-flex min-h-[42px] shrink-0 items-center justify-center rounded-xl border border-[var(--status-err-border)] bg-[var(--status-err-bg)] px-4 text-xs font-semibold text-[var(--status-err-ink)]"
            >
              Batalkan
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onStartVideoProcess('auto')}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent-primary)] px-3 text-xs font-semibold text-[var(--ink-on-accent)]"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            <span>Proses Video HD</span>
          </button>
        )}
      </div>
    </div>
  );
}
