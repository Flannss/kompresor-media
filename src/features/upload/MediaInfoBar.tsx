import { AlertTriangle } from 'lucide-react';
import type {
  ImageEditState,
  ImageMetadata,
  ImageProcessResult,
  MediaMetadata,
  ValidationResult,
  VideoMetadata,
  VideoProcessResult,
} from '../../engines/contracts';
import { computePlannedPhotoDimensions, computeReductionPct } from '../../engines/image/pixelOps';
import type { DeviceProfile } from '../../shared/utils/deviceCapability';
import type { ImageProcessStatus, VideoProcessStatus } from '../../store/useMediaStore';
import { formatBytes } from '../../shared/utils/formatBytes';
import { formatDuration } from '../../shared/utils/formatDuration';

export interface MediaInfoBarProps {
  metadata: MediaMetadata;
  validation: Extract<ValidationResult, { valid: true }>;
  deviceProfile?: DeviceProfile;
  imageEdit?: ImageEditState;
  needsFullResExport?: boolean;
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
  deviceProfile,
  imageEdit,
  needsFullResExport = false,
  imageProcessStatus,
  imageProcessResult,
  videoProcessStatus = 'idle',
  videoProcessResult = null,
}: MediaInfoBarProps) {
  const renderPhotoSummary = (imageMeta: ImageMetadata) => {
    const plannedTarget =
      imageEdit &&
      (needsFullResExport || imageEdit.targetResolution !== 'original')
        ? computePlannedPhotoDimensions(
            imageMeta.width,
            imageMeta.height,
            imageEdit,
            deviceProfile
              ? {
                  maxCanvasPixels: deviceProfile.maxPhotoCanvasPixels,
                  allow8K: deviceProfile.allow8KPhotoExport,
                }
              : undefined
          )
        : null;

    if (imageProcessResult) {
      const targetTag =
        imageEdit && imageEdit.targetResolution !== 'original'
          ? ` · ${imageEdit.targetResolution.toUpperCase()}`
          : '';
      const dimsMismatch = Boolean(
        plannedTarget &&
          (imageProcessResult.outputWidth !== plannedTarget.width ||
            imageProcessResult.outputHeight !== plannedTarget.height)
      );
      const isPreviewOnly = needsFullResExport || dimsMismatch;
      const dimsLabel =
        isPreviewOnly && plannedTarget
          ? `Target ${plannedTarget.width} × ${plannedTarget.height} px${targetTag}`
          : `${imageProcessResult.outputWidth} × ${imageProcessResult.outputHeight} px${targetTag}`;

      return (
        <div
          data-testid="media-summary-strip"
          className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs font-medium text-[var(--text-primary)] tabular-nums"
        >
          <span data-testid="media-dimensions">{dimsLabel}</span>
          <span aria-hidden="true" className="text-[var(--text-muted)]">
            ·
          </span>
          {isPreviewOnly ? (
            <>
              <span data-testid="media-size-comparison">
                Pratinjau {imageProcessResult.outputWidth}×{imageProcessResult.outputHeight} (
                {formatBytes(imageProcessResult.outputBytes)})
              </span>
              <span aria-hidden="true" className="text-[var(--text-muted)]">
                ·
              </span>
              <span data-testid="media-savings" className="text-[var(--text-secondary)]">
                Penuh saat simpan
              </span>
            </>
          ) : (
            <>
              <span data-testid="media-size-comparison">
                {formatBytes(imageProcessResult.inputBytes)} →{' '}
                {formatBytes(imageProcessResult.outputBytes)}
              </span>
              <span aria-hidden="true" className="text-[var(--text-muted)]">
                ·
              </span>
              {renderDeltaBadge(imageProcessResult.inputBytes, imageProcessResult.outputBytes)}
            </>
          )}
          {imageProcessResult.sharpnessDeltaPct !== undefined &&
            imageProcessResult.sharpnessDeltaPct > 0 && (
              <>
                <span aria-hidden="true" className="text-[var(--text-muted)]">
                  ·
                </span>
                <span
                  data-testid="media-sharpness-delta"
                  className="font-semibold text-[var(--text-primary)] tabular-nums"
                >
                  Ketajaman +{imageProcessResult.sharpnessDeltaPct}%
                </span>
              </>
            )}
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
          {videoProcessResult.effectiveBitrateMbps !== undefined && (
            <>
              <span aria-hidden="true" className="text-[var(--text-muted)]">
                ·
              </span>
              <span className="text-[var(--text-secondary)]">
                {videoProcessResult.colorStandard ?? 'H.264'} ·{' '}
                {videoProcessResult.effectiveBitrateMbps.toFixed(1).replace('.', ',')} Mbps
              </span>
            </>
          )}
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
    <div className="flex w-full max-w-full flex-col items-center gap-2">
      <div className="km-glass-lite max-w-full rounded-2xl border px-3.5 py-2 shadow-xs sm:rounded-full sm:px-4 sm:py-1.5">
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
