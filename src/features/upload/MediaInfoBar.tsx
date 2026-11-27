import { AlertTriangle } from 'lucide-react';
import type {
  ImageMetadata,
  ImageProcessResult,
  MediaMetadata,
  ValidationResult,
  VideoMetadata,
  VideoProcessResult,
} from '../../engines/contracts';
import { computeReductionPct } from '../../engines/image/pixelOps';
import type { ImageProcessStatus, VideoProcessStatus } from '../../store/useMediaStore';
import { formatBytes } from '../../shared/utils/formatBytes';
import { formatDuration } from '../../shared/utils/formatDuration';

export interface MediaInfoBarProps {
  metadata: MediaMetadata;
  validation: Extract<ValidationResult, { valid: true }>;
  imageProcessStatus: ImageProcessStatus;
  imageProcessResult: ImageProcessResult | null;
  videoProcessStatus?: VideoProcessStatus;
  videoProcessResult?: VideoProcessResult | null;
}

function renderDeltaBadge(inputBytes: number, outputBytes: number) {
  const reduction = computeReductionPct(inputBytes, outputBytes);
  const roundedPct = Math.round(Math.abs(reduction));
  const deltaLabel =
    reduction >= 1
      ? `Hemat ${roundedPct}%`
      : reduction <= -1
        ? `Naik ${roundedPct}%`
        : 'Ukuran tetap';

  return (
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
  );
}

export function MediaInfoBar({
  metadata,
  validation,
  imageProcessStatus,
  imageProcessResult,
  videoProcessStatus = 'idle',
  videoProcessResult = null,
}: MediaInfoBarProps) {
  const renderPhotoSummary = (imageMeta: ImageMetadata) => {
    if (imageProcessResult) {
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
          {renderDeltaBadge(imageProcessResult.inputBytes, imageProcessResult.outputBytes)}
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
          {imageMeta.width} × {imageMeta.height}
        </span>
        <span aria-hidden="true" className="text-[var(--text-muted)]">
          ·
        </span>
        <span>{formatBytes(imageMeta.sizeBytes)}</span>
        <span aria-hidden="true" className="text-[var(--text-muted)]">
          ·
        </span>
        <span className="text-[var(--text-muted)]">Mengoptimalkan foto…</span>
      </div>
    );
  };

  const renderVideoSummary = (videoMeta: VideoMetadata) => {
    if (videoProcessResult) {
      return (
        <div
          data-testid="media-summary-strip"
          className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs font-medium text-[var(--text-primary)] tabular-nums"
        >
          <span data-testid="media-dimensions">
            {videoProcessResult.outputWidth} × {videoProcessResult.outputHeight}
          </span>
          <span aria-hidden="true" className="text-[var(--text-muted)]">
            ·
          </span>
          <span data-testid="media-duration">
            {formatDuration(videoProcessResult.durationSec)}
          </span>
          <span aria-hidden="true" className="text-[var(--text-muted)]">
            ·
          </span>
          <span data-testid="media-size-comparison">
            {formatBytes(videoProcessResult.inputBytes)} →{' '}
            {formatBytes(videoProcessResult.outputBytes)}
          </span>
          <span aria-hidden="true" className="text-[var(--text-muted)]">
            ·
          </span>
          {renderDeltaBadge(videoProcessResult.inputBytes, videoProcessResult.outputBytes)}
        </div>
      );
    }

    return (
      <div
        data-testid="media-summary-strip"
        className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs font-medium text-[var(--text-primary)] tabular-nums"
      >
        <span className="max-w-[180px] truncate" title={videoMeta.fileName}>
          {videoMeta.fileName}
        </span>
        <span aria-hidden="true" className="text-[var(--text-muted)]">
          ·
        </span>
        <span data-testid="media-dimensions">
          {videoMeta.width} × {videoMeta.height}
        </span>
        <span aria-hidden="true" className="text-[var(--text-muted)]">
          ·
        </span>
        <span data-testid="media-duration">{formatDuration(videoMeta.durationSec)}</span>
        <span aria-hidden="true" className="text-[var(--text-muted)]">
          ·
        </span>
        <span data-testid="media-size">{formatBytes(videoMeta.sizeBytes)}</span>
        {videoProcessStatus === 'processing' && (
          <>
            <span aria-hidden="true" className="text-[var(--text-muted)]">
              ·
            </span>
            <span className="text-[var(--accent-primary)]">Memproses…</span>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex max-w-full flex-col items-center gap-2">
      <div className="km-glass-lite max-w-full rounded-full border px-4 py-1.5 shadow-xs">
        {metadata.kind === 'image' ? renderPhotoSummary(metadata) : renderVideoSummary(metadata)}
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
