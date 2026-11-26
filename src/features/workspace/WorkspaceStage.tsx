import { useState, type DragEvent } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Badge } from '../../design-system/components/Badge';
import { Panel } from '../../design-system/components/Panel';
import type { MediaMetadata, ValidationResult } from '../../engines/contracts';
import { MEDIA_PRESETS, getMediaPreset, type MediaPresetId } from '../../presets/mediaPresets';
import { formatBytes } from '../../shared/utils/formatBytes';
import { formatDurationPrecise } from '../../shared/utils/formatDuration';
import { MediaInfoBar } from '../upload/MediaInfoBar';

export interface WorkspaceStageProps {
  metadata: MediaMetadata;
  validation: Extract<ValidationResult, { valid: true }>;
  objectUrl: string;
  revokedUrlCount: number;
  selectedPresetId: MediaPresetId;
  onSelectPreset: (id: MediaPresetId) => void;
  onDropReplaceFile: (file: File) => void;
}

export function WorkspaceStage({
  metadata,
  validation,
  objectUrl,
  revokedUrlCount,
  selectedPresetId,
  onSelectPreset,
  onDropReplaceFile,
}: WorkspaceStageProps) {
  const [isDraggingOverStage, setIsDraggingOverStage] = useState(false);
  const activePreset = getMediaPreset(selectedPresetId);
  const isImage = metadata.kind === 'image';

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingOverStage) {
      setIsDraggingOverStage(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDraggingOverStage(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverStage(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onDropReplaceFile(file);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-3">
        <MediaInfoBar metadata={metadata} validation={validation} />

        <div
          data-testid="workspace-preview-stage"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative flex min-h-[300px] items-center justify-center overflow-hidden rounded-xl border bg-[var(--surface-stage)] p-3 sm:min-h-[420px] sm:p-4 ${
            isDraggingOverStage
              ? 'border-[var(--accent-primary)] ring-2 ring-[var(--accent-primary)]'
              : 'border-[var(--border-subtle)]'
          }`}
        >
          {isImage ? (
            <img
              data-testid="preview-image"
              src={objectUrl}
              alt={metadata.fileName}
              className="max-h-[65vh] w-auto max-w-full rounded object-contain"
            />
          ) : (
            <video
              data-testid="preview-video"
              src={objectUrl}
              controls
              playsInline
              className="max-h-[65vh] w-full max-w-full rounded bg-black"
            />
          )}

          {isDraggingOverStage && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0e1c22]/85 text-sm font-semibold text-[var(--ink-on-stage)]">
              Drop file to replace current media
            </div>
          )}
        </div>
      </div>

      <aside className="flex min-w-0 flex-col gap-4">
        <Panel
          title="Share Preset"
          subtitle="Locked target configuration"
          headerAction={<SlidersHorizontal className="h-4 w-4 text-[var(--ink-muted)]" />}
        >
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Target share preset">
            {MEDIA_PRESETS.map((preset) => {
              const selected = preset.id === selectedPresetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`preset-${preset.id}`}
                  onClick={() => onSelectPreset(preset.id)}
                  className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors ${
                    selected
                      ? 'border-[var(--accent-primary)] bg-[var(--accent-tint)] text-[var(--ink-primary)]'
                      : 'border-[var(--border-subtle)] bg-[var(--surface-card)] text-[var(--ink-secondary)] hover:bg-[var(--surface-subtle)]'
                  }`}
                >
                  <span className="text-xs font-semibold">{preset.shortLabel}</span>
                  <span className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
                    {preset.targetLimitLabel}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-xs leading-relaxed text-[var(--ink-secondary)]">
            {activePreset.summary}
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[var(--border-subtle)] pt-3 text-xs tabular-nums">
            {isImage ? (
              <>
                <div>
                  <dt className="text-[var(--ink-muted)]">Max Edge</dt>
                  <dd className="font-semibold text-[var(--ink-primary)]">
                    {activePreset.image.maxEdgePx} px
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--ink-muted)]">Format</dt>
                  <dd className="font-semibold text-[var(--ink-primary)]">
                    {activePreset.image.outputFormat}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--ink-muted)]">Quality</dt>
                  <dd className="font-semibold text-[var(--ink-primary)]">
                    {Math.round(activePreset.image.quality * 100)}%
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--ink-muted)]">Sharpen</dt>
                  <dd className="font-semibold text-[var(--ink-primary)]">
                    {activePreset.image.sharpenAmount.toFixed(2)}
                  </dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt className="text-[var(--ink-muted)]">Max Height</dt>
                  <dd className="font-semibold text-[var(--ink-primary)]">
                    {activePreset.video.maxHeightPx}p
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--ink-muted)]">Target Bitrate</dt>
                  <dd className="font-semibold text-[var(--ink-primary)]">
                    {(activePreset.video.targetBitrateBps / 1_000_000).toFixed(1)} Mbps
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--ink-muted)]">Trim Ceiling</dt>
                  <dd className="font-semibold text-[var(--ink-primary)]">
                    {activePreset.video.trimEndSec !== null
                      ? `${activePreset.video.trimEndSec} s`
                      : 'Full clip'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--ink-muted)]">FFmpeg CRF</dt>
                  <dd className="font-semibold text-[var(--ink-primary)]">
                    {activePreset.video.crf}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </Panel>

        <Panel title="Media Inspection" subtitle="Extracted locally from file headers">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs tabular-nums">
            <dt className="text-[var(--ink-muted)]">Detected MIME</dt>
            <dd className="text-right font-medium text-[var(--ink-primary)]">{metadata.mimeType}</dd>

            <dt className="text-[var(--ink-muted)]">Byte Size</dt>
            <dd className="text-right font-medium text-[var(--ink-primary)]">
              {formatBytes(metadata.sizeBytes)} ({metadata.sizeBytes.toLocaleString()} B)
            </dd>

            <dt className="text-[var(--ink-muted)]">Dimensions</dt>
            <dd className="text-right font-medium text-[var(--ink-primary)]">
              {metadata.width} × {metadata.height}
            </dd>

            <dt className="text-[var(--ink-muted)]">Aspect / Orient.</dt>
            <dd className="text-right font-medium text-[var(--ink-primary)]">
              {metadata.aspectRatio} ({metadata.orientation})
            </dd>

            {isImage ? (
              <>
                <dt className="text-[var(--ink-muted)]">Alpha Channel</dt>
                <dd className="text-right font-medium text-[var(--ink-primary)]">
                  {metadata.hasAlpha ? 'Present' : 'Opaque'}
                </dd>
                <dt className="text-[var(--ink-muted)]">EXIF Orient.</dt>
                <dd className="text-right font-medium text-[var(--ink-primary)]">
                  {metadata.exifOrientation ?? 'None'}
                </dd>
              </>
            ) : (
              <>
                <dt className="text-[var(--ink-muted)]">Duration</dt>
                <dd className="text-right font-medium text-[var(--ink-primary)]">
                  {formatDurationPrecise(metadata.durationSec)}
                </dd>
                <dt className="text-[var(--ink-muted)]">Codec Hint</dt>
                <dd className="text-right font-medium text-[var(--ink-primary)]">
                  {metadata.codecHint ?? 'Indeterminate'}
                </dd>
                <dt className="text-[var(--ink-muted)]">Audio Track</dt>
                <dd className="text-right font-medium text-[var(--ink-primary)]">
                  {metadata.hasAudioHint === true ? 'Detected' : 'Not detected in header'}
                </dd>
              </>
            )}

            <dt className="text-[var(--ink-muted)]">Revoked URLs</dt>
            <dd
              data-testid="revoked-url-count"
              className="text-right font-medium text-[var(--ink-primary)]"
            >
              {revokedUrlCount}
            </dd>
          </dl>
        </Panel>

        <Panel
          title="Engine Pipeline"
          headerAction={<Badge tone="neutral">{isImage ? 'Phase 4' : 'Phase 5'}</Badge>}
        >
          <p className="text-xs leading-relaxed text-[var(--ink-secondary)]">
            {isImage
              ? 'Image processing contracts are locked (OffscreenCanvas Web Worker + Canvas fallback). Export controls will connect here in Phase 4.'
              : 'Video processing contracts are locked (WebCodecs + mediabunny primary, lazy @ffmpeg/ffmpeg ST fallback). Export controls will connect here in Phase 5.'}
          </p>
        </Panel>
      </aside>
    </div>
  );
}
