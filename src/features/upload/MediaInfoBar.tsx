import { AlertTriangle } from 'lucide-react';
import type { ImageProcessResult, MediaMetadata, ValidationResult } from '../../engines/contracts';
import { computeReductionPct } from '../../engines/image/pixelOps';
import type { ImageProcessStatus } from '../../store/useMediaStore';
import { formatBytes } from '../../shared/utils/formatBytes';
import { formatDuration } from '../../shared/utils/formatDuration';

export interface MediaInfoBarProps {
  metadata: MediaMetadata;
  validation: Extract<ValidationResult, { valid: true }>;
  imageProcessStatus: ImageProcessStatus;
  imageProcessResult: ImageProcessResult | null;
}

export function MediaInfoBar({
  metadata,
  validation,
  imageProcessStatus,
  imageProcessResult,
}: MediaInfoBarProps) {
  const isImage = metadata.kind === 'image';

  const renderPhotoSummary = () => {
    if (imageProcessResult) {
      const reduction = computeReductionPct(
        imageProcessResult.inputBytes,
        imageProcessResult.outputBytes
      );
      const roundedPct = Math.round(Math.abs(reduction));
      const deltaLabel =
        reduction >= 1
          ? `Hemat ${roundedPct}%`
          : reduction <= -1
            ? `Naik ${roundedPct}%`
            : 'Ukuran tetap';

      return (
        <div
          data-testid="media-summary-strip"
          className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs font-medium text-[var(--text-primary)] tabular-nums"
        >
          <span data-testid="media-dimensions">
            {imageProcessResult.outputWidth} × {imageProcessResult.outputHeight}
          </span>
          <span aria-hidden="true" className="text-[var(--text-muted)]">
            ·
          </span>
          <span data-testid="media-size-comparison">
            {formatBytes(imageProcessResult.inputBytes)} →{' '}
            {formatBytes(imageProcessResult.outputBytes)}
          </span>
          <span aria-hidden="true" className="text-[var(--text-muted)]">
            ·
          </span>
          <span
            data-testid="media-savings"
            className={
              reduction >= 1
                ? 'font-semibold text-[var(--accent-primary)]'
                : 'text-[var(--text-secondary)]'
            }
          >
            {deltaLabel}
          </span>
          {imageProcessStatus === 'processing' && (
            <>
              <span aria-hidden="true" className="text-[var(--text-muted)]">
                ·
              </span>
              <span className="text-[var(--text-muted)]">Memperbarui…</span>
            </>
          )}
        </div>
      );
    }

    return (
      <div
        data-testid="media-summary-strip"
        className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs font-medium text-[var(--text-primary)] tabular-nums"
      >
        <span data-testid="media-dimensions">
          {metadata.width} × {metadata.height}
        </span>
        <span aria-hidden="true" className="text-[var(--text-muted)]">
          ·
        </span>
        <span>{formatBytes(metadata.sizeBytes)}</span>
        <span aria-hidden="true" className="text-[var(--text-muted)]">
          ·
        </span>
        <span className="text-[var(--text-muted)]">Mengoptimalkan foto…</span>
      </div>
    );
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="max-w-full rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-4 py-1.5">
        {isImage ? (
          renderPhotoSummary()
        ) : (
          <div
            data-testid="media-summary-strip"
            className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs font-medium text-[var(--text-primary)] tabular-nums"
          >
            <span className="max-w-[200px] truncate" title={metadata.fileName}>
              {metadata.fileName}
            </span>
            <span aria-hidden="true" className="text-[var(--text-muted)]">
              ·
            </span>
            <span data-testid="media-dimensions">
              {metadata.width} × {metadata.height}
            </span>
            <span aria-hidden="true" className="text-[var(--text-muted)]">
              ·
            </span>
            <span data-testid="media-duration">{formatDuration(metadata.durationSec)}</span>
            <span aria-hidden="true" className="text-[var(--text-muted)]">
              ·
            </span>
            <span data-testid="media-size">{formatBytes(metadata.sizeBytes)}</span>
          </div>
        )}
      </div>

      {validation.warnings.length > 0 && (
        <div className="flex items-center gap-1.5 rounded-lg border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-3 py-1.5 text-xs text-[var(--status-warn-ink)]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{validation.warnings.join(' ')}</span>
        </div>
      )}
    </div>
  );
}
