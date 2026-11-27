import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  AlertCircle,
  Camera,
  Film,
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
      className={`bg-warm-stage relative flex min-h-[calc(100vh-60px)] w-full flex-col items-center justify-between px-4 py-10 transition-colors sm:px-6 lg:px-10 lg:py-14 ${
        isDragging ? 'ring-2 ring-inset ring-[var(--border-strong)]' : ''
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
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[var(--bg-app)]/78 p-4">
          <div className="km-glass-strong flex items-center gap-3 rounded-2xl border-2 border-dashed border-[var(--border-strong)] px-7 py-5 text-sm font-semibold text-[var(--text-primary)]">
            <Upload className="h-5 w-5 text-[var(--accent-gold)]" aria-hidden="true" />
            <span>Lepas file di sini untuk mulai mengedit</span>
          </div>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-8 sm:gap-10">
        {/* Editorial Hero Header */}
        <header className="flex max-w-2xl flex-col items-center text-center">
          <div className="mb-4 flex items-center gap-3">
            <span className="h-px w-7 bg-[var(--border-strong)]" aria-hidden="true" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
              STUDIO MEDIA LOKAL · BY AMDZ
            </span>
            <span className="h-px w-7 bg-[var(--border-strong)]" aria-hidden="true" />
          </div>

          <h1
            className="font-semibold tracking-[-0.03em] text-[var(--text-primary)]"
            style={{
              fontSize: 'clamp(1.85rem, 3.6vw, 2.75rem)',
              lineHeight: 1.14,
            }}
          >
            {isAnalyzing ? (
              'Memeriksa file Anda…'
            ) : (
              <>
                Optimalkan Foto &amp; Video{' '}
                <span className="font-editorial italic font-normal text-[var(--accent-primary)]">
                  Tanpa Ribet
                </span>
              </>
            )}
          </h1>

          <p className="mt-3.5 max-w-xl text-sm leading-relaxed text-[var(--text-secondary)] sm:text-[15px]">
            {isAnalyzing
              ? 'Membaca resolusi, durasi, dan kesiapan media langsung di perangkat Anda.'
              : 'Kompres, jernihkan hingga kualitas HD, dan ubah format media langsung di perangkat Anda. Cepat, tetap bening, dan file tidak pernah diunggah ke server.'}
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11px] font-medium text-[var(--text-secondary)] tabular-nums">
            <span className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 py-1">
              100% Lokal di Perangkat
            </span>
            <span className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 py-1">
              Hingga {queueLimits.maxTotal} File Sekaligus
            </span>
            <span className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 py-1">
              Siap WhatsApp, IG &amp; TikTok
            </span>
          </div>
        </header>

        {/* Validation Error Banner */}
        {status === 'error' && errorMessage && (
          <div
            role="alert"
            data-testid="upload-error-banner"
            className="flex w-full max-w-xl items-start gap-3 rounded-2xl border border-[var(--status-err-border)] bg-[var(--status-err-bg)] px-4 py-3.5 text-sm text-[var(--status-err-ink)]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">File tidak dapat dibuka</p>
              <p className="mt-0.5 text-xs leading-relaxed">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Dual Elevated Interactive Studio Entry Cards */}
        <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-2">
          {/* Card 1: Studio Foto (Muted Olive accent harmony) */}
          <section
            data-testid="entry-photo-card"
            aria-label="Studio Foto"
            className="km-glass-strong group relative flex flex-col justify-between gap-6 overflow-hidden rounded-[26px] border p-7 transition-all duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1.5 hover:border-[var(--border-strong)] md:p-8"
            style={{ boxShadow: 'var(--shadow-soft)' }}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 120 120"
              fill="none"
              className="pointer-events-none absolute -right-5 -top-5 h-28 w-28 opacity-[0.18] transition-transform duration-300 group-hover:scale-105"
            >
              <circle cx="60" cy="60" r="46" stroke="var(--accent-olive)" strokeWidth="1.2" />
              <circle cx="60" cy="60" r="28" stroke="var(--accent-gold)" strokeWidth="1" strokeDasharray="4 4" />
              <path d="M22 60 A38 38 0 0 1 60 22" stroke="var(--accent-olive)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-2xl border"
                  style={{
                    backgroundColor: 'var(--accent-olive-soft)',
                    borderColor: 'var(--status-ok-border)',
                    color: 'var(--accent-olive)',
                  }}
                >
                  {isAnalyzing ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Camera className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  )}
                </div>

                <span
                  className="rounded-full border px-3 py-1 text-[11px] font-semibold tabular-nums"
                  style={{
                    backgroundColor: 'var(--accent-gold-soft)',
                    borderColor: 'var(--border-hairline)',
                    color: 'var(--accent-gold)',
                  }}
                >
                  RealPhoto · 2K–8K
                </span>
              </div>

              <div>
                <h2 className="font-editorial text-[22px] font-semibold text-[var(--text-primary)]">
                  Studio Foto
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-secondary)] sm:text-sm">
                  Kompres presisi, jernihkan 2K–8K, 9 alat sempurnakan foto (pertajam, anti-blur,
                  hapus kabut, warnai foto), dan 12 filter warna.
                </p>
              </div>
            </div>

            <div className="space-y-3 border-t border-[var(--border-hairline)] pt-5">
              <Button
                variant="primary"
                size="lg"
                disabled={isAnalyzing}
                data-testid="choose-photo-btn"
                onClick={() => photoInputRef.current?.click()}
                className="min-h-[46px] w-full rounded-full text-sm font-semibold"
              >
                Pilih Foto
              </Button>
              <div className="flex items-center justify-between text-[11px] font-medium text-[var(--text-muted)] tabular-nums">
                <span>JPG · PNG · WebP · AVIF</span>
                <span>Maks. {queueLimits.maxPhotos} foto</span>
              </div>
            </div>
          </section>

          {/* Card 2: Studio Video (Dusty Terracotta accent harmony) */}
          <section
            data-testid="entry-video-card"
            aria-label="Studio Video"
            className="km-glass-strong group relative flex flex-col justify-between gap-6 overflow-hidden rounded-[26px] border p-7 transition-all duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1.5 hover:border-[var(--border-strong)] md:p-8"
            style={{ boxShadow: 'var(--shadow-soft)' }}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 120 120"
              fill="none"
              className="pointer-events-none absolute -right-5 -top-5 h-28 w-28 opacity-[0.18] transition-transform duration-300 group-hover:scale-105"
            >
              <rect x="24" y="30" width="72" height="60" rx="14" stroke="var(--accent-terracotta)" strokeWidth="1.2" />
              <path d="M52 49 L72 60 L52 71 Z" stroke="var(--accent-gold)" strokeWidth="1.2" strokeLinejoin="round" />
              <line x1="34" y1="22" x2="86" y2="22" stroke="var(--accent-terracotta)" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-2xl border"
                  style={{
                    backgroundColor: 'var(--accent-terracotta-soft)',
                    borderColor: 'var(--status-err-border)',
                    color: 'var(--accent-terracotta)',
                  }}
                >
                  {isAnalyzing ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Film className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  )}
                </div>

                <span
                  className="rounded-full border px-3 py-1 text-[11px] font-semibold tabular-nums"
                  style={{
                    backgroundColor: 'var(--accent-gold-soft)',
                    borderColor: 'var(--border-hairline)',
                    color: 'var(--accent-gold)',
                  }}
                >
                  1080p HD · BT.709
                </span>
              </div>

              <div>
                <h2 className="font-editorial text-[22px] font-semibold text-[var(--text-primary)]">
                  Studio Video
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-secondary)] sm:text-sm">
                  Kompres HD 1080p BT.709, 4 model penjernih video, 7 color grading langsung,
                  bandingkan sebelum–sesudah, potong durasi, audio, &amp; subtitle.
                </p>
              </div>
            </div>

            <div className="space-y-3 border-t border-[var(--border-hairline)] pt-5">
              <Button
                variant="primary"
                size="lg"
                disabled={isAnalyzing}
                data-testid="choose-video-btn"
                onClick={() => videoInputRef.current?.click()}
                className="min-h-[46px] w-full rounded-full text-sm font-semibold"
              >
                Pilih Video
              </Button>
              <div className="flex items-center justify-between text-[11px] font-medium text-[var(--text-muted)] tabular-nums">
                <span>MP4 · MOV · WebM · MKV</span>
                <span>Maks. {queueLimits.maxVideos} video</span>
              </div>
            </div>
          </section>
        </div>

        {/* Quiet 3-Step Flow Strip & Drag Hint */}
        <div className="flex w-full flex-col items-center gap-3">
          <div
            data-testid="landing-flow-strip"
            className="km-glass flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-full border px-6 py-3 text-xs text-[var(--text-secondary)] tabular-nums"
          >
            <span className="flex items-center gap-1.5">
              <span className="font-editorial text-[13px] font-semibold text-[var(--accent-gold)]">
                01
              </span>
              <span>Pilih foto atau video</span>
            </span>
            <span aria-hidden="true" className="text-[var(--border-strong)]">
              ·
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-editorial text-[13px] font-semibold text-[var(--accent-gold)]">
                02
              </span>
              <span>Atur kualitas &amp; alat</span>
            </span>
            <span aria-hidden="true" className="text-[var(--border-strong)]">
              ·
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-editorial text-[13px] font-semibold text-[var(--accent-gold)]">
                03
              </span>
              <span>Unduh atau kirim</span>
            </span>
          </div>

          <p className="text-center text-[11px] text-[var(--text-muted)] tabular-nums">
            Atau tarik &amp; lepas campuran foto dan video langsung ke layar ini ({queueLimits.label}).
          </p>
        </div>
      </div>

      {/* Quiet Editorial Landing Footer */}
      <footer
        data-testid="landing-footer"
        className="pt-8 text-center text-[11px] text-[var(--text-muted)]"
      >
        Kompresor Media · BY AMDZ · Diproses 100% lokal di perangkat Anda
      </footer>
    </div>
  );
}
