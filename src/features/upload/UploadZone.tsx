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
import { handleGlassPointerMove } from '../../shared/utils/glassSheen';
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
      className={`bg-slate-stage relative flex min-h-[calc(100vh-56px)] sm:min-h-[calc(100vh-62px)] w-full flex-col items-center justify-between overflow-hidden px-4 py-7 transition-colors sm:px-6 sm:py-11 lg:px-10 lg:py-14 ${
        isDragging ? 'ring-2 ring-inset ring-[var(--border-strong)]' : ''
      }`}
    >
      {/* Static Architectural Slate Mist & Geometry Layer (z-0, zero negative z-index, zero blur blobs) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        style={{
          background:
            'radial-gradient(ellipse 46% 36% at 22% 52%, rgba(148, 163, 184, 0.08), transparent 70%), radial-gradient(ellipse 44% 34% at 78% 58%, rgba(100, 116, 139, 0.08), transparent 70%)',
        }}
      >
        <svg
          viewBox="0 0 1200 460"
          fill="none"
          className="mx-auto h-[380px] w-full max-w-6xl opacity-55"
        >
          <path
            d="M 60 360 Q 380 80 680 210 T 1160 65"
            stroke="var(--border-hairline)"
            strokeWidth="1.25"
          />
          <path
            d="M 100 390 Q 430 120 730 235 T 1180 105"
            stroke="var(--border-strong)"
            strokeOpacity="0.48"
            strokeWidth="1"
            strokeDasharray="6 8"
          />
          <path
            d="M 40 420 Q 460 190 790 280 T 1190 155"
            stroke="var(--accent-slate)"
            strokeOpacity="0.22"
            strokeWidth="1"
          />
          <rect
            x="840"
            y="34"
            width="240"
            height="130"
            rx="65"
            stroke="var(--accent-slate)"
            strokeOpacity="0.14"
            strokeWidth="1"
          />
          <circle cx="210" cy="210" r="118" stroke="var(--border-strong)" strokeOpacity="0.24" strokeWidth="1" />
        </svg>
      </div>
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
          <div className="glass-sheet-modal flex items-center gap-3 rounded-2xl border-2 border-dashed border-[var(--border-strong)] px-7 py-5 text-sm font-semibold leading-snug text-[var(--text-primary)]">
            <Upload className="h-5 w-5 text-[var(--text-primary)]" aria-hidden="true" />
            <span>Lepas file di sini untuk mulai mengedit</span>
          </div>
        </div>
      )}

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-7 sm:gap-11">
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
              lineHeight: 1.18,
            }}
          >
            {isAnalyzing ? (
              'Memeriksa file Anda…'
            ) : (
              <>
                Optimalkan Foto &amp; Video{' '}
                <span
                  className="font-editorial relative inline-block bg-clip-text italic font-normal text-transparent"
                  style={{
                    backgroundImage:
                      'linear-gradient(125deg, var(--hero-sheen-start) 0%, var(--hero-sheen-mid) 54%, var(--hero-sheen-end) 100%)',
                  }}
                >
                  Tanpa Ribet
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-0 right-0 h-[1.5px] rounded-full opacity-60"
                    style={{
                      background:
                        'linear-gradient(90deg, var(--hero-sheen-start) 0%, var(--hero-sheen-end) 100%)',
                    }}
                  />
                </span>
              </>
            )}
          </h1>

          <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--text-secondary)] sm:text-[15px]">
            {isAnalyzing
              ? 'Membaca resolusi, durasi, dan kesiapan media langsung di perangkat Anda.'
              : 'Kompres, jernihkan hingga kualitas HD, dan ubah format media langsung di perangkat Anda. Cepat, tetap bening, dan file tidak pernah diunggah ke server.'}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5 text-[11px] font-medium text-[var(--text-secondary)] tabular-nums">
            <span className="glass-inner-rim rounded-full border px-3.5 py-1.5 leading-snug">
              100% Lokal di Perangkat
            </span>
            <span className="glass-inner-rim rounded-full border px-3.5 py-1.5 leading-snug">
              Hingga {queueLimits.maxTotal} File Sekaligus
            </span>
            <span className="glass-inner-rim rounded-full border px-3.5 py-1.5 leading-snug">
              Siap WhatsApp, IG, TikTok &amp; Vlog
            </span>
          </div>
        </header>

        {/* Validation Error Banner */}
        {status === 'error' && errorMessage && (
          <div
            role="alert"
            data-testid="upload-error-banner"
            className="glass-sheet-modal flex w-full max-w-xl items-start gap-3 rounded-2xl border border-[var(--status-err-border)] px-4 py-4 text-sm text-[var(--status-err-ink)]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xs font-semibold leading-snug">File tidak dapat dibuka</p>
              <p className="text-xs leading-relaxed">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Dual Elevated Interactive Studio Entry Cards */}
        <div className="grid w-full grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2">
          {/* Card 1: Studio Foto */}
          <section
            data-testid="entry-photo-card"
            aria-label="Studio Foto"
            className="glass-frosted-card group relative flex flex-col justify-between gap-5 overflow-hidden rounded-[26px] border p-6 hover:-translate-y-1 sm:gap-6 sm:p-7 md:p-8"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 120 120"
              fill="none"
              className="pointer-events-none absolute -right-5 -top-5 h-28 w-28 opacity-[0.20] transition-transform duration-300 group-hover:scale-105"
            >
              <circle cx="60" cy="60" r="46" stroke="var(--text-muted)" strokeWidth="1.2" />
              <circle cx="60" cy="60" r="28" stroke="var(--text-secondary)" strokeWidth="1" strokeDasharray="4 4" />
              <path d="M22 60 A38 38 0 0 1 60 22" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="glass-inner-rim flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border text-[var(--text-primary)]">
                  {isAnalyzing ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Camera className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  )}
                </div>

                <span className="glass-inner-rim shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[11px] font-semibold leading-snug text-[var(--text-secondary)] tabular-nums">
                  RealPhoto · 2K–8K
                </span>
              </div>

              <div className="space-y-2">
                <h2 className="font-editorial text-[22px] font-semibold leading-snug text-[var(--text-primary)]">
                  Studio Foto
                </h2>
                <p className="text-[13px] leading-relaxed text-[var(--text-secondary)] sm:text-sm">
                  Kompres presisi, jernihkan 2K–8K, 9 alat sempurnakan foto (pertajam, anti-blur,
                  hapus kabut, warnai foto), dan 12 filter warna.
                </p>
              </div>
            </div>

            <div className="space-y-3.5 border-t border-[var(--border-hairline)] pt-5">
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
              <div className="flex items-center justify-between gap-2 text-[11px] font-medium leading-snug text-[var(--text-muted)] tabular-nums">
                <span>JPG · PNG · WebP · AVIF</span>
                <span>Maks. {queueLimits.maxPhotos} foto</span>
              </div>
            </div>
          </section>

          {/* Card 2: Studio Video */}
          <section
            data-testid="entry-video-card"
            aria-label="Studio Video"
            className="glass-frosted-card group relative flex flex-col justify-between gap-5 overflow-hidden rounded-[26px] border p-6 hover:-translate-y-1 sm:gap-6 sm:p-7 md:p-8"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 120 120"
              fill="none"
              className="pointer-events-none absolute -right-5 -top-5 h-28 w-28 opacity-[0.20] transition-transform duration-300 group-hover:scale-105"
            >
              <rect x="24" y="30" width="72" height="60" rx="14" stroke="var(--text-muted)" strokeWidth="1.2" />
              <path d="M52 49 L72 60 L52 71 Z" stroke="var(--text-primary)" strokeWidth="1.2" strokeLinejoin="round" />
              <line x1="34" y1="22" x2="86" y2="22" stroke="var(--text-secondary)" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="glass-inner-rim flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border text-[var(--text-primary)]">
                  {isAnalyzing ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Film className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  )}
                </div>

                <span className="glass-inner-rim shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[11px] font-semibold leading-snug text-[var(--text-primary)] tabular-nums">
                  1080p HD · Vlog &amp; 30+ mnt
                </span>
              </div>

              <div className="space-y-2">
                <h2 className="font-editorial text-[22px] font-semibold leading-snug text-[var(--text-primary)]">
                  Studio Video
                </h2>
                <p className="text-[13px] leading-relaxed text-[var(--text-secondary)] sm:text-sm">
                  Kompres HD 1080p BT.709, Vlog HD 8,5 Mbps, mode Video Panjang 30+ mnt, 4 model
                  penjernih, color grading langsung, potong durasi, audio, &amp; subtitle.
                </p>
              </div>
            </div>

            <div className="space-y-3.5 border-t border-[var(--border-hairline)] pt-5">
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
              <div className="flex items-center justify-between gap-2 text-[11px] font-medium leading-snug text-[var(--text-muted)] tabular-nums">
                <span>MP4 · MOV · WebM · MKV</span>
                <span>Maks. {queueLimits.maxVideos} video</span>
              </div>
            </div>
          </section>
        </div>

        {/* Quiet 3-Step Flow Strip & Drag Hint */}
        <div className="flex w-full flex-col items-center gap-3.5">
          <div
            data-testid="landing-flow-strip"
            onPointerMove={handleGlassPointerMove}
            className="glass-dynamic-pill flex max-w-full flex-wrap items-center justify-center gap-x-5 gap-y-2.5 rounded-2xl px-5 py-3.5 text-xs leading-snug text-[var(--text-secondary)] tabular-nums sm:rounded-full sm:px-6"
          >
            <span className="relative z-10 flex items-center gap-2">
              <span className="font-editorial text-[13px] font-semibold text-[var(--text-primary)]">
                01
              </span>
              <span>Pilih foto atau video</span>
            </span>
            <span aria-hidden="true" className="relative z-10 text-[var(--border-strong)]">
              ·
            </span>
            <span className="relative z-10 flex items-center gap-2">
              <span className="font-editorial text-[13px] font-semibold text-[var(--text-primary)]">
                02
              </span>
              <span>Atur kualitas &amp; alat</span>
            </span>
            <span aria-hidden="true" className="relative z-10 text-[var(--border-strong)]">
              ·
            </span>
            <span className="relative z-10 flex items-center gap-2">
              <span className="font-editorial text-[13px] font-semibold text-[var(--text-primary)]">
                03
              </span>
              <span>Unduh atau kirim</span>
            </span>
          </div>

          <p className="text-center text-[11px] leading-relaxed text-[var(--text-muted)] tabular-nums">
            Atau tarik &amp; lepas file, atau tekan Ctrl+V untuk menempel gambar langsung ({queueLimits.label}).
          </p>
        </div>
      </div>

      {/* Quiet Editorial Landing Footer */}
      <footer
        data-testid="landing-footer"
        className="relative z-10 pt-8 text-center text-[11px] leading-relaxed text-[var(--text-muted)]"
      >
        Kompresor Media · BY AMDZ · Diproses 100% lokal di perangkat Anda
      </footer>
    </div>
  );
}
