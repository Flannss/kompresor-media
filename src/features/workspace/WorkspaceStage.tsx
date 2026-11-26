import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  Check,
  ChevronDown,
  Download,
  RotateCw,
  Share2,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '../../design-system/components/Button';
import type {
  ImageEditState,
  ImageOutputFormat,
  ImageProcessResult,
  MediaMetadata,
  Orientation,
  ValidationResult,
} from '../../engines/contracts';
import { MEDIA_PRESETS, type MediaPresetId } from '../../presets/mediaPresets';
import { formatBytes } from '../../shared/utils/formatBytes';
import { formatDuration } from '../../shared/utils/formatDuration';
import type { ImageProcessStatus } from '../../store/useMediaStore';
import { MediaInfoBar } from '../upload/MediaInfoBar';
import { BeforeAfterPreview } from './BeforeAfterPreview';

export interface WorkspaceStageProps {
  metadata: MediaMetadata;
  validation: Extract<ValidationResult, { valid: true }>;
  objectUrl: string;
  selectedPresetId: MediaPresetId;
  imageEdit: ImageEditState;
  imageProcessStatus: ImageProcessStatus;
  imageProcessResult: ImageProcessResult | null;
  processedImageUrl: string | null;
  imageProcessError: string | null;
  onSelectPreset: (id: MediaPresetId) => void;
  onUpdateImageEdit: (patch: Partial<Omit<ImageEditState, 'presetId'>>) => void;
  onRotatePhoto90: () => void;
  onDropReplaceFile: (file: File) => void;
}

const FORMAT_OPTIONS: ReadonlyArray<{ value: ImageOutputFormat; label: string }> = [
  { value: 'image/jpeg', label: 'JPG' },
  { value: 'image/webp', label: 'WebP' },
  { value: 'image/png', label: 'PNG' },
];

const MAX_EDGE_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'Asli' },
  { value: 1920, label: '1920 px' },
  { value: 1600, label: '1600 px' },
  { value: 1280, label: '1280 px' },
];

function formatOrientationId(orientation: Orientation): string {
  if (orientation === 'landscape') return 'Mendatar';
  if (orientation === 'portrait') return 'Tegak';
  return 'Persegi';
}

function canShareFileBlob(blob: Blob, fileName: string, mime: string): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return false;
  }
  if (typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    const file = new File([blob], fileName, { type: mime });
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function WorkspaceStage({
  metadata,
  validation,
  objectUrl,
  selectedPresetId,
  imageEdit,
  imageProcessStatus,
  imageProcessResult,
  processedImageUrl,
  imageProcessError,
  onSelectPreset,
  onUpdateImageEdit,
  onRotatePhoto90,
  onDropReplaceFile,
}: WorkspaceStageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isDraggingOverStage, setIsDraggingOverStage] = useState(false);
  const [showPresetManualControls, setShowPresetManualControls] = useState(false);
  const [downloadConfirmed, setDownloadConfirmed] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  const isImage = metadata.kind === 'image';
  const showManualControls = selectedPresetId === 'custom' || showPresetManualControls;

  useEffect(() => {
    setDownloadConfirmed(false);
    setShareFeedback(null);
  }, [processedImageUrl]);

  useEffect(() => {
    const videoEl = videoRef.current;
    return () => {
      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
      }
    };
  }, [objectUrl]);

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

  const handleDownloadPhoto = () => {
    if (!processedImageUrl || !imageProcessResult) {
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = processedImageUrl;
    anchor.download = imageProcessResult.outputFileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setDownloadConfirmed(true);
  };

  const canShare =
    isImage &&
    imageProcessResult !== null &&
    canShareFileBlob(
      imageProcessResult.outputBlob,
      imageProcessResult.outputFileName,
      imageProcessResult.outputMime
    );

  const handleSharePhoto = async () => {
    if (!imageProcessResult || !canShare) {
      return;
    }
    setShareFeedback(null);
    try {
      const file = new File(
        [imageProcessResult.outputBlob],
        imageProcessResult.outputFileName,
        { type: imageProcessResult.outputMime }
      );
      await navigator.share({
        files: [file],
        title: imageProcessResult.outputFileName,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setShareFeedback('Gagal membuka menu bagikan perangkat.');
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-56px)] w-full flex-col lg:flex-row">
      {/* Left Preview Stage */}
      <section
        data-testid="workspace-preview-stage"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative flex min-h-[46vh] flex-1 flex-col items-center justify-center gap-4 bg-[var(--bg-stage)] px-4 py-5 sm:min-h-[52vh] sm:px-8 sm:py-6 lg:min-h-[calc(100vh-56px)] ${
          isDraggingOverStage ? 'ring-2 ring-inset ring-[var(--accent-primary)]' : ''
        }`}
      >
        {isImage ? (
          <BeforeAfterPreview
            originalUrl={objectUrl}
            processedUrl={processedImageUrl}
            fileName={metadata.fileName}
            rotationDeg={imageEdit.rotationDeg}
          />
        ) : (
          <div className="flex w-full max-w-4xl items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-hairline)] bg-black">
            <video
              ref={videoRef}
              data-testid="preview-video"
              src={objectUrl}
              controls
              playsInline
              className="max-h-[62vh] w-full"
            />
          </div>
        )}

        <MediaInfoBar
          metadata={metadata}
          validation={validation}
          imageProcessStatus={imageProcessStatus}
          imageProcessResult={imageProcessResult}
        />

        {isDraggingOverStage && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#1b3742]/75 text-sm font-semibold text-white">
            Lepas file untuk mengganti media saat ini
          </div>
        )}
      </section>

      {/* Right Control Panel */}
      <aside className="flex w-full shrink-0 flex-col gap-5 border-t border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4 sm:p-5 lg:w-[350px] lg:border-l lg:border-t-0">
        {/* Step 1: Pilih Tujuan */}
        <div>
          <h2 className="text-xs font-semibold text-[var(--text-primary)]">Pilih Tujuan</h2>
          <div
            className="mt-2.5 grid grid-cols-2 gap-2"
            role="radiogroup"
            aria-label="Pilih tujuan penggunaan"
          >
            {MEDIA_PRESETS.map((preset) => {
              const selected = preset.id === selectedPresetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`preset-${preset.id}`}
                  onClick={() => onSelectPreset(preset.id)}
                  className={`flex min-h-[56px] flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition-colors ${
                    selected
                      ? 'border-[var(--border-active)] bg-[var(--bg-subtle)] text-[var(--text-primary)]'
                      : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-app)]'
                  }`}
                >
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    {preset.label}
                  </span>
                  <span className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">
                    {preset.targetLimitLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2: Pengaturan (Foto) */}
        {isImage && (
          <div className="border-t border-[var(--border-hairline)] pt-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold text-[var(--text-primary)]">Pengaturan</h2>
              {selectedPresetId !== 'custom' && (
                <button
                  type="button"
                  data-testid="toggle-manual-settings"
                  aria-expanded={showPresetManualControls}
                  onClick={() => setShowPresetManualControls((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline"
                >
                  <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                  <span>{showPresetManualControls ? 'Sembunyikan' : 'Ubah pengaturan'}</span>
                </button>
              )}
            </div>

            <div className="mt-2.5 flex items-center gap-2">
              <Button
                variant="secondary"
                size="md"
                data-testid="rotate-90-btn"
                onClick={onRotatePhoto90}
                className="min-h-[44px] w-full justify-center text-xs"
              >
                <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  Putar 90°
                  {imageEdit.rotationDeg > 0 ? ` (${imageEdit.rotationDeg}°)` : ''}
                </span>
              </Button>
            </div>

            {showManualControls && (
              <div className="mt-3.5 flex flex-col gap-3.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-app)] p-3.5">
                <div>
                  <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                    Format
                  </span>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                    {FORMAT_OPTIONS.map((opt) => {
                      const active = imageEdit.outputFormat === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          data-testid={`format-${opt.label.toLowerCase()}`}
                          aria-pressed={active}
                          onClick={() => onUpdateImageEdit({ outputFormat: opt.value })}
                          className={`min-h-[38px] rounded-lg border text-xs font-medium transition-colors ${
                            active
                              ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white'
                              : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-active)]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                    Ukuran Maksimal
                  </span>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    {MAX_EDGE_OPTIONS.map((opt) => {
                      const active = imageEdit.maxEdgePx === opt.value;
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          data-testid={`max-edge-${opt.value ?? 'original'}`}
                          aria-pressed={active}
                          onClick={() => onUpdateImageEdit({ maxEdgePx: opt.value })}
                          className={`min-h-[38px] rounded-lg border text-xs font-medium tabular-nums transition-colors ${
                            active
                              ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white'
                              : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-active)]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-[var(--text-secondary)]">Kualitas</span>
                    <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                      {imageEdit.outputFormat === 'image/png'
                        ? 'Tanpa kompresi'
                        : `${Math.round(imageEdit.quality * 100)}%`}
                    </span>
                  </div>
                  {imageEdit.outputFormat === 'image/png' ? (
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      Format PNG menjaga piksel asli tanpa pengurangan kualitas.
                    </p>
                  ) : (
                    <input
                      data-testid="quality-slider"
                      type="range"
                      min={20}
                      max={100}
                      step={1}
                      value={Math.round(imageEdit.quality * 100)}
                      onChange={(e) =>
                        onUpdateImageEdit({ quality: Number(e.target.value) / 100 })
                      }
                      aria-label="Atur kualitas foto"
                      className="mt-2 h-1.5 w-full accent-[var(--accent-primary)]"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Simpan & Bagikan */}
        <div className="border-t border-[var(--border-hairline)] pt-4">
          <h2 className="text-xs font-semibold text-[var(--text-primary)]">Simpan &amp; Bagikan</h2>

          {isImage ? (
            <div className="mt-2.5 flex flex-col gap-2">
              {imageProcessError && (
                <p
                  role="alert"
                  className="rounded-xl border border-[var(--status-err-border)] bg-[var(--status-err-bg)] px-3 py-2 text-xs text-[var(--status-err-ink)]"
                >
                  {imageProcessError}
                </p>
              )}

              <Button
                variant="primary"
                size="lg"
                data-testid="download-photo-btn"
                disabled={!processedImageUrl || imageProcessStatus === 'processing'}
                onClick={handleDownloadPhoto}
                className="min-h-[44px] w-full"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span>
                  {imageProcessStatus === 'processing' ? 'Memproses Foto…' : 'Unduh Foto'}
                </span>
              </Button>

              {canShare && (
                <Button
                  variant="secondary"
                  size="lg"
                  data-testid="share-photo-btn"
                  disabled={!imageProcessResult || imageProcessStatus === 'processing'}
                  onClick={() => void handleSharePhoto()}
                  className="min-h-[44px] w-full"
                >
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                  <span>Bagikan</span>
                </Button>
              )}

              {downloadConfirmed && (
                <p
                  data-testid="download-confirmed-msg"
                  className="flex items-center justify-center gap-1.5 pt-1 text-xs font-medium text-[var(--status-ok-ink)]"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Foto berhasil diunduh</span>
                </p>
              )}

              {shareFeedback && (
                <p className="text-center text-xs text-[var(--status-err-ink)]">{shareFeedback}</p>
              )}
            </div>
          ) : (
            <div
              data-testid="video-phase5-notice"
              className="mt-2.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-app)] p-3.5 text-xs leading-relaxed text-[var(--text-secondary)]"
            >
              Kompresi &amp; potong video akan hadir di pembaruan berikutnya. Saat ini Anda sudah
              dapat memutar dan memeriksa detail video.
            </div>
          )}
        </div>

        {/* Step 4: Collapsed Detail file Disclosure */}
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
            <dt className="text-[var(--text-muted)]">Jenis</dt>
            <dd className="text-right font-medium text-[var(--text-primary)]">
              {isImage ? 'Foto' : 'Video'}
            </dd>

            <dt className="text-[var(--text-muted)]">Format</dt>
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
