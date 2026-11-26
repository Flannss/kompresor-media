import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { AlertCircle, FileUp, Loader2 } from 'lucide-react';
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-6 sm:py-10">
      <div
        data-testid="upload-dropzone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          isDragging
            ? 'border-[var(--accent-primary)] bg-[var(--accent-tint)]'
            : 'border-[var(--border-strong)] bg-[var(--surface-card)]'
        }`}
      >
        <input
          ref={inputRef}
          data-testid="media-file-input"
          type="file"
          accept={ACCEPTED_MEDIA}
          onChange={handleInputChange}
          className="sr-only"
          aria-label="Choose a photo or video file"
        />

        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] text-[var(--accent-primary)]">
          {isAnalyzing ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : (
            <FileUp className="h-5 w-5" aria-hidden="true" />
          )}
        </div>

        <h1 className="text-base font-semibold text-[var(--ink-primary)]">
          {isAnalyzing
            ? 'Inspecting file signature and metadata...'
            : 'Drop a photo or video to prepare for sharing'}
        </h1>

        <p className="mt-1.5 max-w-md text-xs text-[var(--ink-secondary)]">
          Validates magic-byte headers and extracts exact resolution, orientation, duration, and
          codec hints directly on your device.
        </p>

        <div className="mt-5">
          <Button
            variant="primary"
            size="md"
            disabled={isAnalyzing}
            data-testid="upload-choose-btn"
            onClick={() => inputRef.current?.click()}
          >
            Choose File
          </Button>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-[var(--border-subtle)] pt-4 text-[11px] text-[var(--ink-muted)] tabular-nums">
          <span>Photos: JPEG, PNG, WebP, GIF, AVIF (max 50 MB)</span>
          <span>Videos: MP4, MOV, WebM (max 500 MB)</span>
          <span>0 bytes uploaded</span>
        </div>
      </div>

      {status === 'error' && errorMessage && (
        <div
          role="alert"
          data-testid="upload-error-banner"
          className="flex items-start gap-2.5 rounded-xl border border-[var(--status-err-border)] bg-[var(--status-err-bg)] px-4 py-3 text-sm text-[var(--status-err-ink)]"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">File could not be opened</p>
            <p className="mt-0.5 text-xs leading-relaxed">{errorMessage}</p>
          </div>
        </div>
      )}
    </div>
  );
}
