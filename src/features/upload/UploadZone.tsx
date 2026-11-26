import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { AlertCircle, Film, Image as ImageIcon, Loader2, Upload } from 'lucide-react';
import { Button } from '../../design-system/components/Button';
import type { MediaLoadStatus } from '../../store/useMediaStore';

export interface UploadZoneProps {
  status: MediaLoadStatus;
  errorMessage: string | null;
  onFileSelected: (file: File) => void;
}

const ACCEPTED_MEDIA =
  'image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.mov,.webm';

export function UploadZone({ status, errorMessage, onFileSelected }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const isAnalyzing = status === 'analyzing';

  const handleFileList = (files: FileList | null) => {
    const first = files?.[0];
    if (first) {
      onFileSelected(first);
    }
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
      className="flex min-h-[calc(100vh-56px)] w-full flex-col items-center justify-center px-4 py-8"
      style={{
        background: 'radial-gradient(circle at 50% 30%, var(--bg-stage-glow) 0%, var(--bg-app) 65%)',
      }}
    >
      <div className="flex w-full max-w-[520px] flex-col gap-4">
        <div
          data-testid="upload-dropzone"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`flex w-full flex-col items-center rounded-[24px] border px-6 py-10 text-center transition-all sm:px-10 sm:py-12 ${
            isDragging
              ? 'scale-[1.01] border-[var(--border-active)] bg-[var(--bg-subtle)]'
              : 'border-[var(--border-hairline)] bg-[var(--bg-surface)]'
          }`}
          style={{
            boxShadow: 'var(--stage-shadow)',
          }}
        >
          <input
            ref={inputRef}
            data-testid="media-file-input"
            type="file"
            accept={ACCEPTED_MEDIA}
            onChange={handleInputChange}
            className="sr-only"
            aria-label="Pilih foto atau video dari perangkat"
          />

          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--bg-subtle)] text-[var(--accent-primary)]">
            {isAnalyzing ? (
              <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Upload className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
            )}
          </div>

          <h1 className="text-[22px] font-semibold leading-tight text-[var(--text-primary)] sm:text-[24px]">
            {isAnalyzing ? 'Memeriksa file…' : 'Siapkan foto atau video'}
          </h1>

          <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--text-secondary)]">
            {isAnalyzing
              ? 'Membaca ukuran dan kesiapan file langsung di perangkat Anda.'
              : 'Tarik file ke sini atau pilih langsung dari perangkat untuk dikompres, dipotong, dan diedit.'}
          </p>

          <div className="mt-6">
            <Button
              variant="primary"
              size="lg"
              disabled={isAnalyzing}
              data-testid="upload-choose-btn"
              onClick={() => inputRef.current?.click()}
              className="px-6 py-3 text-sm font-medium"
            >
              Pilih Foto atau Video
            </Button>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-2 text-xs text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 py-1">
              <ImageIcon className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden="true" />
              <span>Foto · JPG, PNG, WebP</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 py-1">
              <Film className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden="true" />
              <span>Video · MP4, MOV, WebM</span>
            </span>
          </div>

          <p className="mt-3 text-[11px] text-[var(--text-muted)]">
            100% diproses di perangkat Anda — file tidak pernah diunggah ke server.
          </p>
        </div>

        {status === 'error' && errorMessage && (
          <div
            role="alert"
            data-testid="upload-error-banner"
            className="flex items-start gap-2.5 rounded-2xl border border-[var(--status-err-border)] bg-[var(--status-err-bg)] px-4 py-3 text-sm text-[var(--status-err-ink)]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">File tidak dapat dibuka</p>
              <p className="mt-0.5 text-xs leading-relaxed">{errorMessage}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
