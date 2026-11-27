import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  AlertCircle,
  Film,
  Image as ImageIcon,
  Loader2,
  Upload,
} from 'lucide-react';
import { Button } from '../../design-system/components/Button';
import type { AdaptiveQueueLimits } from '../../shared/utils/deviceCapability';
import type { MediaLoadStatus } from '../../store/useMediaStore';

export interface UploadZoneProps {
  status: MediaLoadStatus;
  errorMessage: string | null;
  queueLimits: AdaptiveQueueLimits;
  onFilesSelected: (files: File[]) => void;
}

const ACCEPTED_IMAGES =
  'image/jpeg,image/png,image/webp,image/gif,image/avif,.jpg,.jpeg,.png,.webp,.gif,.avif';
const ACCEPTED_VIDEOS =
  'video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv';
const ACCEPTED_ALL = `${ACCEPTED_IMAGES},${ACCEPTED_VIDEOS}`;

export function UploadZone({
  status,
  errorMessage,
  queueLimits,
  onFilesSelected,
}: UploadZoneProps) {
  const allInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const isAnalyzing = status === 'analyzing';

  const handleFileList = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    onFilesSelected(Array.from(fileList));
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFileList(e.target.files);
    e.target.value = '';
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (!isAnalyzing) {
      handleFileList(e.dataTransfer.files);
    }
  };

  return (
    <div
      data-testid="upload-dropzone"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`bg-liquid-stage relative flex min-h-[calc(100vh-56px)] w-full flex-col items-center justify-between px-4 py-8 transition-all sm:px-6 sm:py-12 ${
        isDragging ? 'ring-2 ring-inset ring-[var(--border-active)]' : ''
      }`}
    >
      {/* Hidden File Inputs */}
      <input
        ref={allInputRef}
        data-testid="media-file-input"
        type="file"
        multiple
        accept={ACCEPTED_ALL}
        onChange={handleInputChange}
        className="sr-only"
        aria-label="Pilih foto atau video dari perangkat"
      />
      <input
        ref={photoInputRef}
        data-testid="photo-file-input"
        type="file"
        multiple
        accept={ACCEPTED_IMAGES}
        onChange={handleInputChange}
        className="sr-only"
        aria-label="Pilih satu atau beberapa foto"
      />
      <input
        ref={videoInputRef}
        data-testid="video-file-input"
        type="file"
        multiple
        accept={ACCEPTED_VIDEOS}
        onChange={handleInputChange}
        className="sr-only"
        aria-label="Pilih satu atau beberapa video"
      />

      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[var(--bg-app)]/70">
          <div className="km-glass-strong flex items-center gap-3 rounded-2xl border px-6 py-4 text-sm font-semibold text-[var(--text-primary)]">
            <Upload className="h-5 w-5 text-[var(--accent-highlight)]" aria-hidden="true" />
            <span>Lepas foto atau video di sini untuk langsung dioptimalkan</span>
          </div>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-[880px] flex-1 flex-col items-center justify-center gap-7">
        {/* Hero Headline & Concise Explanation */}
        <div className="max-w-2xl text-center">
          <h1 className="text-[24px] font-semibold leading-tight text-[var(--text-primary)] sm:text-[32px]">
            {isAnalyzing ? 'Memeriksa file Anda…' : 'Optimalkan Foto & Video Tanpa Ribet'}
          </h1>
          <p className="mt-2.5 text-sm leading-relaxed text-[var(--text-secondary)] sm:text-[15px]">
            {isAnalyzing
              ? 'Membaca resolusi, durasi, dan format media langsung di perangkat Anda.'
              : 'Kompres hemat kuota, pertegas detail foto hingga 2K/4K/8K, koreksi warna, serta rapikan video untuk WhatsApp, Instagram, dan TikTok.'}
          </p>
        </div>

        {/* Error Banner */}
        {status === 'error' && errorMessage && (
          <div
            role="alert"
            data-testid="upload-error-banner"
            className="flex w-full max-w-xl items-start gap-2.5 rounded-2xl border border-[var(--status-err-border)] bg-[var(--status-err-bg)] px-4 py-3 text-sm text-[var(--status-err-ink)]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">File tidak dapat dibuka</p>
              <p className="mt-0.5 text-xs leading-relaxed">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Dual Interactive Liquid Glass Studio Entry Cards */}
        <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
          {/* Card 1: Studio Foto */}
          <section
            data-testid="entry-photo-card"
            aria-label="Studio Foto"
            className="km-glass group flex flex-col justify-between gap-5 rounded-[24px] border p-6 transition-colors duration-200 hover:border-[var(--border-active)] sm:p-7"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--glass-border-strong)] bg-[var(--bg-subtle)] text-[var(--accent-highlight)]">
                  {isAnalyzing ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <ImageIcon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  )}
                </div>
                <span className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                  Hingga {queueLimits.maxPhotos} foto
                </span>
              </div>

              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Studio Foto</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)] sm:text-[13px]">
                  Kompres tajam tanpa buram, model RealPhoto &amp; High Quality hingga 2K/4K/8K, 12
                  filter warna, serta potong dan koreksi lengkap.
                </p>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <Button
                variant="primary"
                size="lg"
                disabled={isAnalyzing}
                data-testid="choose-photo-btn"
                onClick={() => photoInputRef.current?.click()}
                className="min-h-[44px] w-full font-semibold"
              >
                Pilih Foto
              </Button>
              <p className="text-center text-[11px] font-medium text-[var(--text-muted)]">
                JPG · PNG · WebP · AVIF
              </p>
            </div>
          </section>

          {/* Card 2: Studio Video */}
          <section
            data-testid="entry-video-card"
            aria-label="Studio Video"
            className="km-glass group flex flex-col justify-between gap-5 rounded-[24px] border p-6 transition-colors duration-200 hover:border-[var(--border-active)] sm:p-7"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--glass-border-strong)] bg-[var(--bg-subtle)] text-[var(--accent-highlight)]">
                  {isAnalyzing ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Film className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  )}
                </div>
                <span className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                  Hingga {queueLimits.maxVideos} video
                </span>
              </div>

              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Studio Video</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)] sm:text-[13px]">
                  Kompres hemat kuota, jernihkan ke 1080p HD, 7 filter warna langsung, potong durasi,
                  stabilkan rekaman, atur audio, dan tanam subtitle.
                </p>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <Button
                variant="primary"
                size="lg"
                disabled={isAnalyzing}
                data-testid="choose-video-btn"
                onClick={() => videoInputRef.current?.click()}
                className="min-h-[44px] w-full font-semibold"
              >
                Pilih Video
              </Button>
              <p className="text-center text-[11px] font-medium text-[var(--text-muted)]">
                MP4 · MOV · WebM · MKV
              </p>
            </div>
          </section>
        </div>

        {/* Quiet 3-Step Flow Strip & Drag Hint */}
        <div className="flex w-full flex-col items-center gap-2.5">
          <div
            data-testid="landing-flow-strip"
            className="km-glass flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-2xl border px-4 py-2.5 text-xs text-[var(--text-secondary)] tabular-nums"
          >
            <span>
              <strong className="font-semibold text-[var(--text-primary)]">1.</strong> Pilih foto
              atau video
            </span>
            <span aria-hidden="true" className="text-[var(--text-muted)]">
              →
            </span>
            <span>
              <strong className="font-semibold text-[var(--text-primary)]">2.</strong> Atur kualitas
              &amp; tampilan
            </span>
            <span aria-hidden="true" className="text-[var(--text-muted)]">
              →
            </span>
            <span>
              <strong className="font-semibold text-[var(--text-primary)]">3.</strong> Unduh atau
              kirim
            </span>
          </div>

          <p className="text-center text-[11px] text-[var(--text-muted)] tabular-nums">
            Atau tarik &amp; lepas campuran foto/video ke layar ini (maksimal {queueLimits.maxTotal}{' '}
            file · {queueLimits.label}).
          </p>
        </div>
      </div>

      {/* Quiet Landing Footer */}
      <footer
        data-testid="landing-footer"
        className="pt-6 text-center text-[11px] text-[var(--text-muted)]"
      >
        Kompresor Media · BY AMDZ · Diproses 100% lokal di perangkat Anda
      </footer>
    </div>
  );
}
