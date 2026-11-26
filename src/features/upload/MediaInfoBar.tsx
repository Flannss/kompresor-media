import { AlertTriangle, Film, Image as ImageIcon } from 'lucide-react';
import { Badge } from '../../design-system/components/Badge';
import type { MediaMetadata, ValidationResult } from '../../engines/contracts';
import { formatBytes } from '../../shared/utils/formatBytes';
import { formatDuration } from '../../shared/utils/formatDuration';

export interface MediaInfoBarProps {
  metadata: MediaMetadata;
  validation: Extract<ValidationResult, { valid: true }>;
}

export function MediaInfoBar({ metadata, validation }: MediaInfoBarProps) {
  const isImage = metadata.kind === 'image';

  return (
    <div
      data-testid="media-info-bar"
      className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-subtle)] text-[var(--accent-primary)]">
            {isImage ? (
              <ImageIcon className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Film className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <span
            className="truncate text-sm font-semibold text-[var(--ink-primary)]"
            title={metadata.fileName}
            data-testid="media-filename"
          >
            {metadata.fileName}
          </span>
          <Badge tone="accent">{isImage ? 'Photo' : 'Video'}</Badge>
          <Badge tone="neutral">{validation.signatureLabel}</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-[var(--ink-secondary)] tabular-nums">
          <span data-testid="media-dimensions">
            {metadata.width} × {metadata.height}
          </span>
          <span>
            {metadata.orientation} · {metadata.aspectRatio}
          </span>
          {!isImage && (
            <span data-testid="media-duration">{formatDuration(metadata.durationSec)}</span>
          )}
          <span data-testid="media-size">{formatBytes(metadata.sizeBytes)}</span>
          {!isImage && metadata.codecHint && (
            <span data-testid="media-codec-hint">{metadata.codecHint}</span>
          )}
          {isImage && metadata.hasAlpha && <span>Alpha</span>}
          {isImage && metadata.isAnimated && <span>Animated</span>}
          {isImage && metadata.exifOrientation !== null && (
            <span>EXIF #{metadata.exifOrientation}</span>
          )}
        </div>
      </div>

      {validation.warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-3 py-2 text-xs text-[var(--status-warn-ink)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>{validation.warnings.join(' ')}</p>
        </div>
      )}
    </div>
  );
}
