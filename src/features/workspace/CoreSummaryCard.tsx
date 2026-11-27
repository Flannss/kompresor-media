import type {
  ImageEditState,
  ImageProcessResult,
  MediaMetadata,
  VideoEditState,
  VideoProcessResult,
} from '../../engines/contracts';
import {
  computePhotoTargetDimensions,
  computeReductionPct,
  formatOutputMimeShort,
  getActiveImageModuleLabels,
} from '../../engines/image/pixelOps';
import { getActiveVideoModuleLabels } from '../../engines/video/videoFilterGraph';
import { getMediaPreset, type MediaPresetId } from '../../presets/mediaPresets';
import type { DeviceProfile } from '../../shared/utils/deviceCapability';
import { formatBytes } from '../../shared/utils/formatBytes';

export interface CoreSummaryCardProps {
  metadata: MediaMetadata;
  deviceProfile?: DeviceProfile;
  selectedPresetId: MediaPresetId;
  imageEdit: ImageEditState;
  imageProcessResult: ImageProcessResult | null;
  needsFullResExport?: boolean;
  videoEdit: VideoEditState;
  videoProcessResult: VideoProcessResult | null;
}

export function CoreSummaryCard({
  metadata,
  deviceProfile,
  selectedPresetId,
  imageEdit,
  imageProcessResult,
  needsFullResExport = false,
  videoEdit,
  videoProcessResult,
}: CoreSummaryCardProps) {
  const isImage = metadata.kind === 'image';
  const presetSpec = getMediaPreset(selectedPresetId);

  const plannedExportDims = isImage
    ? computePhotoTargetDimensions(
        metadata.width,
        metadata.height,
        imageEdit,
        deviceProfile
          ? {
              maxCanvasPixels: deviceProfile.maxPhotoCanvasPixels,
              allow8K: deviceProfile.allow8KPhotoExport,
            }
          : undefined
      )
    : null;

  const resolutionText = isImage
    ? needsFullResExport && plannedExportDims
      ? `${metadata.width} × ${metadata.height} → ${plannedExportDims.width} × ${plannedExportDims.height} (ekspor)`
      : imageProcessResult
        ? `${metadata.width} × ${metadata.height} → ${imageProcessResult.outputWidth} × ${imageProcessResult.outputHeight}`
        : `${metadata.width} × ${metadata.height}`
    : videoProcessResult
      ? `${metadata.width} × ${metadata.height} → ${videoProcessResult.outputWidth} × ${videoProcessResult.outputHeight}`
      : `${metadata.width} × ${metadata.height}`;

  const inputBytes = metadata.sizeBytes;
  const outputBytes = isImage
    ? (imageProcessResult?.outputBytes ?? null)
    : (videoProcessResult?.outputBytes ?? null);

  let savingsBadge: string | null = null;
  let savingsPositive = false;
  if (outputBytes !== null) {
    const pct = computeReductionPct(inputBytes, outputBytes);
    const absPct = Math.round(Math.abs(pct));
    if (pct >= 1) {
      savingsBadge = `Hemat ${absPct}%`;
      savingsPositive = true;
    } else if (pct <= -1) {
      savingsBadge = `+${absPct}%`;
    } else {
      savingsBadge = 'Tetap';
    }
  }

  const outputFormatText = isImage
    ? `${formatOutputMimeShort(imageEdit.outputFormat)} · ${presetSpec.shortLabel}`
    : `${videoEdit.outputFormat.toUpperCase()} · ${presetSpec.shortLabel}`;

  const activeModules = isImage
    ? (imageProcessResult?.activeModules ?? getActiveImageModuleLabels(imageEdit))
    : (videoProcessResult?.activeModules ?? getActiveVideoModuleLabels(videoEdit));

  const elapsedSecText = isImage
    ? imageProcessResult
      ? `${(imageProcessResult.durationMs / 1000).toFixed(2).replace('.', ',')} dtk`
      : null
    : videoProcessResult
      ? `${(videoProcessResult.durationMs / 1000).toFixed(1).replace('.', ',')} dtk`
      : null;

  const clampedGuard = Boolean(
    isImage && (imageProcessResult?.clampedByMemoryGuard || plannedExportDims?.clampedByMemoryGuard)
  );

  return (
    <section
      data-testid="core-summary-card"
      aria-label="Ringkasan Inti"
      className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Ringkasan Inti
        </h2>
        {elapsedSecText && (
          <span
            data-testid="core-summary-elapsed"
            className="text-[11px] font-medium text-[var(--text-muted)] tabular-nums"
          >
            {elapsedSecText}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs tabular-nums">
        <div className="min-w-0">
          <span className="block text-[10px] text-[var(--text-muted)]">Resolusi</span>
          <span
            data-testid="core-summary-resolution"
            className="block truncate font-semibold text-[var(--text-primary)]"
            title={resolutionText}
          >
            {resolutionText}
          </span>
        </div>

        <div className="min-w-0">
          <span className="block text-[10px] text-[var(--text-muted)]">Ukuran</span>
          <div className="flex flex-wrap items-center gap-1">
            <span
              data-testid="core-summary-size"
              className="font-semibold text-[var(--text-primary)]"
            >
              {outputBytes !== null
                ? `${formatBytes(inputBytes)} → ${formatBytes(outputBytes)}`
                : `${formatBytes(inputBytes)} · Siap diproses`}
            </span>
            {savingsBadge && (
              <span
                data-testid="core-summary-savings"
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                  savingsPositive
                    ? 'bg-[var(--status-ok-bg)] text-[var(--status-ok-ink)]'
                    : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                }`}
              >
                {savingsBadge}
              </span>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <span className="block text-[10px] text-[var(--text-muted)]">Output</span>
          <span
            data-testid="core-summary-output"
            className="block truncate font-semibold text-[var(--text-primary)]"
          >
            {outputFormatText}
          </span>
        </div>

        <div className="min-w-0">
          <span className="block text-[10px] text-[var(--text-muted)]">Modul Aktif</span>
          <div
            data-testid="core-summary-modules"
            className="mt-0.5 flex flex-wrap gap-1"
          >
            {activeModules.map((mod) => (
              <span
                key={mod}
                className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]"
              >
                {mod}
              </span>
            ))}
          </div>
        </div>
      </div>

      {clampedGuard && (
        <p
          data-testid="memory-clamp-badge"
          className="mt-2 rounded-lg border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-2 py-1 text-[10px] leading-snug text-[var(--status-warn-ink)]"
        >
          Dimensi ekspor disesuaikan aman di bawah batas memori perangkat seluler.
        </p>
      )}
    </section>
  );
}
