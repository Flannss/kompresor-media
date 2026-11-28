import type {
  ImageEditState,
  ImageProcessResult,
  MediaMetadata,
  VideoEditState,
  VideoProcessResult,
} from '../../engines/contracts';
import {
  computePlannedPhotoDimensions,
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
  compactOnDesktop?: boolean;
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
  compactOnDesktop = false,
}: CoreSummaryCardProps) {
  const isImage = metadata.kind === 'image';
  const presetSpec = getMediaPreset(selectedPresetId);

  const plannedExportDims = isImage
    ? computePlannedPhotoDimensions(
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

  const resBadge =
    isImage && imageEdit.targetResolution !== 'original'
      ? ` · ${imageEdit.targetResolution.toUpperCase()}`
      : '';

  const dimsMismatch = Boolean(
    isImage &&
      plannedExportDims &&
      imageProcessResult &&
      (imageProcessResult.outputWidth !== plannedExportDims.width ||
        imageProcessResult.outputHeight !== plannedExportDims.height)
  );
  const isPreviewPhotoResult = Boolean(isImage && (needsFullResExport || dimsMismatch));

  const resolutionText = isImage
    ? (isPreviewPhotoResult || imageEdit.targetResolution !== 'original') && plannedExportDims
      ? `${metadata.width} × ${metadata.height} → ${plannedExportDims.width} × ${plannedExportDims.height} px${resBadge}`
      : imageProcessResult
        ? `${metadata.width} × ${metadata.height} → ${imageProcessResult.outputWidth} × ${imageProcessResult.outputHeight} px`
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
  if (outputBytes !== null && !isPreviewPhotoResult) {
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
      className={`km-glass-panel rounded-[22px] border ${
        compactOnDesktop ? 'p-3.5 lg:rounded-xl lg:px-3 lg:py-2' : 'p-3.5'
      }`}
    >
      <div
        className={`flex items-center justify-between gap-2 ${
          compactOnDesktop ? 'mb-2 lg:mb-1' : 'mb-2'
        }`}
      >
        <h2
          className={`font-semibold uppercase tracking-wider text-[var(--text-muted)] ${
            compactOnDesktop ? 'text-[11px] lg:text-[10px]' : 'text-[11px]'
          }`}
        >
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

      <div
        className={`grid grid-cols-2 text-xs tabular-nums ${
          compactOnDesktop
            ? 'gap-3 lg:grid-cols-3 lg:gap-x-2.5 lg:gap-y-1.5'
            : 'gap-3'
        }`}
      >
        <div className="min-w-0">
          <span className="block text-[10px] text-[var(--text-muted)]">Resolusi</span>
          <span
            data-testid="core-summary-resolution"
            className="block break-words text-[11.5px] font-semibold leading-snug text-[var(--text-primary)] sm:text-xs"
            title={resolutionText}
          >
            {resolutionText}
          </span>
        </div>

        <div className="min-w-0">
          <span className="block text-[10px] text-[var(--text-muted)]">Ukuran</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              data-testid="core-summary-size"
              className="break-words text-[11.5px] font-semibold leading-snug text-[var(--text-primary)] sm:text-xs"
            >
              {isPreviewPhotoResult
                ? outputBytes !== null
                  ? `Pratinjau ${formatBytes(outputBytes)} · Penuh saat unduh`
                  : `${formatBytes(inputBytes)} · Penuh saat unduh`
                : outputBytes !== null
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
            {isImage &&
              imageProcessResult?.sharpnessDeltaPct !== undefined &&
              imageProcessResult.sharpnessDeltaPct > 0 && (
                <span
                  data-testid="core-summary-sharpness"
                  className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-primary)] tabular-nums"
                >
                  Ketajaman +{imageProcessResult.sharpnessDeltaPct}%
                </span>
              )}
          </div>
        </div>

        <div className="min-w-0">
          <span className="block text-[10px] text-[var(--text-muted)]">Output</span>
          <span
            data-testid="core-summary-output"
            className="block break-words text-[11.5px] font-semibold leading-snug text-[var(--text-primary)] sm:text-xs"
          >
            {outputFormatText}
          </span>
        </div>

        <div className={`min-w-0 ${compactOnDesktop ? 'lg:col-span-3' : ''}`}>
          <div className={compactOnDesktop ? 'lg:flex lg:items-center lg:gap-2' : ''}>
            <span
              className={`block text-[10px] text-[var(--text-muted)] ${
                compactOnDesktop ? 'lg:shrink-0' : ''
              }`}
            >
              Modul Aktif
            </span>
            <div
              data-testid="core-summary-modules"
              className={`flex flex-wrap gap-1.5 ${
                compactOnDesktop ? 'mt-1 lg:mt-0 lg:gap-1' : 'mt-1'
              }`}
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
      </div>

      {!isImage && videoProcessResult && (
        <p
          data-testid="video-hd-proof-badge"
          className="mt-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1 text-[10.5px] font-semibold text-[var(--text-primary)] tabular-nums"
        >
          Hasil HD · {videoProcessResult.outputWidth}×{videoProcessResult.outputHeight}
          {videoProcessResult.appliedFps ? ` · ${videoProcessResult.appliedFps} fps` : ''}
          {videoProcessResult.colorStandard ? ` · ${videoProcessResult.colorStandard}` : ''}
          {videoProcessResult.effectiveBitrateMbps !== undefined
            ? ` · ${videoProcessResult.effectiveBitrateMbps.toFixed(1).replace('.', ',')} Mbps`
            : ''}
        </p>
      )}

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
