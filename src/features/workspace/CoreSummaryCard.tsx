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
      className={`glass-frosted-card min-w-0 max-w-full overflow-hidden rounded-[22px] border ${
        compactOnDesktop ? 'p-4 lg:rounded-2xl lg:px-4 lg:py-3.5' : 'p-4'
      }`}
    >
      <div
        className={`flex min-w-0 items-center justify-between gap-3 ${
          compactOnDesktop ? 'mb-3 lg:mb-2.5' : 'mb-3'
        }`}
      >
        <h2
          className={`min-w-0 truncate font-semibold uppercase tracking-wider text-[var(--text-muted)] ${
            compactOnDesktop ? 'text-[11px] lg:text-[10.5px]' : 'text-[11px]'
          }`}
        >
          Ringkasan Inti
        </h2>
        {elapsedSecText && (
          <span
            data-testid="core-summary-elapsed"
            className="shrink-0 text-[11px] font-medium text-[var(--text-muted)] tabular-nums"
          >
            {elapsedSecText}
          </span>
        )}
      </div>

      <div
        className={`grid grid-cols-2 text-xs tabular-nums ${
          compactOnDesktop
            ? 'gap-3.5 lg:gap-x-4 lg:gap-y-2.5'
            : 'gap-3.5'
        }`}
      >
        <div className="min-w-0 space-y-1">
          <span className="block text-[10.5px] leading-snug text-[var(--text-muted)]">Resolusi</span>
          <span
            data-testid="core-summary-resolution"
            className="block break-words text-[11.5px] font-semibold leading-snug text-[var(--text-primary)] sm:text-xs"
            title={resolutionText}
          >
            {resolutionText}
          </span>
        </div>

        <div className="min-w-0 space-y-1">
          <span className="block text-[10.5px] leading-snug text-[var(--text-muted)]">Ukuran</span>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span
              data-testid="core-summary-size"
              className="max-w-full break-words text-[11.5px] font-semibold leading-snug text-[var(--text-primary)] sm:text-xs"
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
                className={`max-w-full rounded-md px-2 py-0.5 text-[10px] font-semibold leading-snug ${
                  savingsPositive
                    ? 'bg-[var(--status-ok-bg)] text-[var(--status-ok-ink)]'
                    : 'glass-inner-rim border text-[var(--text-secondary)]'
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
                  className="glass-inner-rim max-w-full rounded-md border px-2 py-0.5 text-[10px] font-semibold leading-snug text-[var(--text-primary)] tabular-nums"
                >
                  Ketajaman +{imageProcessResult.sharpnessDeltaPct}%
                </span>
              )}
          </div>
        </div>

        <div className="min-w-0 space-y-1">
          <span className="block text-[10.5px] leading-snug text-[var(--text-muted)]">Output</span>
          <span
            data-testid="core-summary-output"
            className="block break-words text-[11.5px] font-semibold leading-snug text-[var(--text-primary)] sm:text-xs"
          >
            {outputFormatText}
          </span>
        </div>

        <div className={`min-w-0 ${compactOnDesktop ? 'col-span-2' : ''}`}>
          <div className={compactOnDesktop ? 'lg:flex lg:items-center lg:gap-2.5' : ''}>
            <span
              className={`block text-[10.5px] leading-snug text-[var(--text-muted)] ${
                compactOnDesktop ? 'lg:shrink-0' : ''
              }`}
            >
              Modul Aktif
            </span>
            <div
              data-testid="core-summary-modules"
              className={`flex min-w-0 flex-wrap gap-1.5 ${
                compactOnDesktop ? 'mt-1.5 lg:mt-0 lg:gap-1.5' : 'mt-1.5'
              }`}
            >
              {activeModules.map((mod) => (
                <span
                  key={mod}
                  className="glass-inner-rim max-w-full truncate rounded-md border px-2 py-0.5 text-[10.5px] font-medium leading-snug text-[var(--text-secondary)]"
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
          className="glass-inner-rim mt-3 max-w-full break-words rounded-xl border px-3 py-2 text-[10.5px] font-semibold leading-snug text-[var(--text-primary)] tabular-nums"
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
          className="mt-2.5 rounded-xl border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-3 py-1.5 text-[10.5px] leading-relaxed text-[var(--status-warn-ink)]"
        >
          Dimensi ekspor disesuaikan aman di bawah batas memori perangkat seluler.
        </p>
      )}
    </section>
  );
}
