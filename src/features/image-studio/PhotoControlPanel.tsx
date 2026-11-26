import { useState } from 'react';
import { Crop, FlipHorizontal2, FlipVertical2, RotateCw } from 'lucide-react';
import { Button } from '../../design-system/components/Button';
import { SegmentedTabs } from '../../design-system/components/SegmentedTabs';
import { Slider } from '../../design-system/components/Slider';
import type {
  ImageEditState,
  ImageFilterId,
  ImageOutputFormat,
  ImageProcessResult,
} from '../../engines/contracts';
import { FILTER_PRESETS } from '../../engines/image/pixelOps';
import { MEDIA_PRESETS, type MediaPresetId } from '../../presets/mediaPresets';

type PhotoTabId = 'optimasi' | 'edit' | 'filter';

export interface PhotoControlPanelProps {
  selectedPresetId: MediaPresetId;
  imageEdit: ImageEditState;
  imageProcessResult: ImageProcessResult | null;
  filterThumbnails: Partial<Record<ImageFilterId, string>>;
  isCropping: boolean;
  onSelectPreset: (id: MediaPresetId) => void;
  onUpdateImageEdit: (
    patch: Partial<Omit<ImageEditState, 'presetId'>>,
    options?: { commitHistory?: boolean; preservePreset?: boolean }
  ) => void;
  onCommitSnapshot: () => void;
  onToggleCrop: () => void;
  onRotate90: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onSelectFilter: (filterId: ImageFilterId) => void;
}

const PHOTO_TABS = [
  { id: 'optimasi' as const, label: 'Optimasi' },
  { id: 'edit' as const, label: 'Edit' },
  { id: 'filter' as const, label: 'Filter' },
];

const FORMAT_OPTIONS: ReadonlyArray<{ value: ImageOutputFormat; label: string }> = [
  { value: 'image/jpeg', label: 'JPG' },
  { value: 'image/webp', label: 'WebP' },
  { value: 'image/png', label: 'PNG' },
];

const MAX_EDGE_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'Asli' },
  { value: 2048, label: '2048 px' },
  { value: 1920, label: '1920 px' },
  { value: 1600, label: '1600 px' },
  { value: 1280, label: '1280 px' },
];

const TARGET_SIZE_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'Otomatis' },
  { value: 250, label: '≤ 250 KB' },
  { value: 500, label: '≤ 500 KB' },
  { value: 1024, label: '≤ 1 MB' },
  { value: 2048, label: '≤ 2 MB' },
];

export function PhotoControlPanel({
  selectedPresetId,
  imageEdit,
  imageProcessResult,
  filterThumbnails,
  isCropping,
  onSelectPreset,
  onUpdateImageEdit,
  onCommitSnapshot,
  onToggleCrop,
  onRotate90,
  onFlipH,
  onFlipV,
  onSelectFilter,
}: PhotoControlPanelProps) {
  const [activeTab, setActiveTab] = useState<PhotoTabId>('optimasi');
  const isLosslessPng = imageEdit.outputFormat === 'image/png';
  const hasTargetSize = !isLosslessPng && imageEdit.targetSizeKB !== null;

  return (
    <div className="flex flex-col gap-4">
      <SegmentedTabs
        items={PHOTO_TABS}
        value={activeTab}
        onChange={setActiveTab}
        ariaLabel="Mode pengeditan foto"
      />

      {activeTab === 'optimasi' && (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-xs font-semibold text-[var(--text-primary)]">Pilih Tujuan</h2>
            <div
              className="mt-2 grid grid-cols-2 gap-2"
              role="radiogroup"
              aria-label="Pilih tujuan penggunaan foto"
            >
              {MEDIA_PRESETS.map((preset, idx) => {
                const selected = preset.id === selectedPresetId;
                const spanFull = idx === MEDIA_PRESETS.length - 1;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`preset-${preset.id}`}
                    onClick={() => onSelectPreset(preset.id)}
                    className={`flex min-h-[54px] flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition-all duration-150 active:scale-[0.985] ${
                      spanFull ? 'col-span-2' : ''
                    } ${
                      selected
                        ? 'border-[var(--border-active)] bg-[var(--bg-subtle)] text-[var(--text-primary)]'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
                    }`}
                  >
                    <span className="text-xs font-semibold text-[var(--text-primary)]">
                      {preset.label}
                    </span>
                    <span className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">
                      {preset.targetLimitLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3.5 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
            <div>
              <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                Format
              </span>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {FORMAT_OPTIONS.map((opt) => {
                  const active = imageEdit.outputFormat === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      data-testid={`format-${opt.label.toLowerCase()}`}
                      aria-pressed={active}
                      onClick={() => onUpdateImageEdit({ outputFormat: opt.value })}
                      className={`min-h-[36px] rounded-lg border text-xs font-medium transition-all active:scale-[0.98] ${
                        active
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-active)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                Ukuran Maksimal
              </span>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {MAX_EDGE_OPTIONS.map((opt) => {
                  const active = imageEdit.maxEdgePx === opt.value;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      data-testid={`max-edge-${opt.value ?? 'original'}`}
                      aria-pressed={active}
                      onClick={() => onUpdateImageEdit({ maxEdgePx: opt.value })}
                      className={`min-h-[36px] rounded-lg border text-xs font-medium tabular-nums transition-all active:scale-[0.98] ${
                        active
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-active)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {!isLosslessPng && (
              <div>
                <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                  Batas Ukuran
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {TARGET_SIZE_OPTIONS.map((opt) => {
                    const active = imageEdit.targetSizeKB === opt.value;
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        data-testid={`target-size-${opt.value ?? 'auto'}`}
                        aria-pressed={active}
                        onClick={() =>
                          onUpdateImageEdit(
                            { targetSizeKB: opt.value },
                            { commitHistory: true, preservePreset: true }
                          )
                        }
                        className={`min-h-[34px] rounded-lg border px-2.5 text-[11px] font-medium tabular-nums transition-all active:scale-[0.98] ${
                          active
                            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                            : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-active)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <Slider
              label="Kualitas"
              testId="quality-slider"
              min={20}
              max={100}
              step={1}
              defaultValue={85}
              disabled={isLosslessPng || hasTargetSize}
              value={
                hasTargetSize && imageProcessResult?.solvedQuality !== undefined
                  ? Math.round(imageProcessResult.solvedQuality * 100)
                  : Math.round(imageEdit.quality * 100)
              }
              valueLabel={
                isLosslessPng
                  ? 'Tanpa kompresi'
                  : hasTargetSize && imageProcessResult?.solvedQuality !== undefined
                    ? `Otomatis (${Math.round(imageProcessResult.solvedQuality * 100)}%)`
                    : `${Math.round(imageEdit.quality * 100)}%`
              }
              onChange={(val) =>
                onUpdateImageEdit(
                  { quality: val / 100, targetSizeKB: null },
                  { commitHistory: false }
                )
              }
              onCommit={() => onCommitSnapshot()}
              hint={
                hasTargetSize
                  ? 'Kualitas disesuaikan otomatis agar ukuran file sesuai batas.'
                  : isLosslessPng
                    ? 'Format PNG menyimpan piksel tanpa kompresi kualitas.'
                    : undefined
              }
            />
          </div>
        </div>
      )}

      {activeTab === 'edit' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={isCropping ? 'primary' : 'secondary'}
              size="md"
              data-testid="open-crop-btn"
              onClick={onToggleCrop}
              className="min-h-[42px] text-xs"
            >
              <Crop className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isCropping ? 'Tutup Potong' : 'Potong / Crop'}</span>
            </Button>
            <Button
              variant="secondary"
              size="md"
              data-testid="rotate-90-btn"
              onClick={onRotate90}
              className="min-h-[42px] text-xs"
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                Putar 90°{imageEdit.rotationDeg > 0 ? ` (${imageEdit.rotationDeg}°)` : ''}
              </span>
            </Button>
            <Button
              variant={imageEdit.flipH ? 'primary' : 'secondary'}
              size="md"
              data-testid="flip-h-btn"
              onClick={onFlipH}
              className="min-h-[42px] text-xs"
            >
              <FlipHorizontal2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Balik H</span>
            </Button>
            <Button
              variant={imageEdit.flipV ? 'primary' : 'secondary'}
              size="md"
              data-testid="flip-v-btn"
              onClick={onFlipV}
              className="min-h-[42px] text-xs"
            >
              <FlipVertical2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Balik V</span>
            </Button>
          </div>

          <div className="flex flex-col gap-3.5 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
            <Slider
              label="Kecerahan"
              testId="slider-brightness"
              min={-100}
              max={100}
              defaultValue={0}
              value={imageEdit.adjustments.brightness}
              onChange={(val) =>
                onUpdateImageEdit(
                  { adjustments: { ...imageEdit.adjustments, brightness: val } },
                  { commitHistory: false, preservePreset: true }
                )
              }
              onCommit={() => onCommitSnapshot()}
            />
            <Slider
              label="Kontras"
              testId="slider-contrast"
              min={-100}
              max={100}
              defaultValue={0}
              value={imageEdit.adjustments.contrast}
              onChange={(val) =>
                onUpdateImageEdit(
                  { adjustments: { ...imageEdit.adjustments, contrast: val } },
                  { commitHistory: false, preservePreset: true }
                )
              }
              onCommit={() => onCommitSnapshot()}
            />
            <Slider
              label="Saturasi"
              testId="slider-saturation"
              min={-100}
              max={100}
              defaultValue={0}
              value={imageEdit.adjustments.saturation}
              onChange={(val) =>
                onUpdateImageEdit(
                  { adjustments: { ...imageEdit.adjustments, saturation: val } },
                  { commitHistory: false, preservePreset: true }
                )
              }
              onCommit={() => onCommitSnapshot()}
            />
            <Slider
              label="Suhu Warna"
              testId="slider-temperature"
              min={-100}
              max={100}
              defaultValue={0}
              value={imageEdit.adjustments.temperature}
              onChange={(val) =>
                onUpdateImageEdit(
                  { adjustments: { ...imageEdit.adjustments, temperature: val } },
                  { commitHistory: false, preservePreset: true }
                )
              }
              onCommit={() => onCommitSnapshot()}
            />
            <Slider
              label="Ketajaman"
              testId="slider-sharpen"
              min={0}
              max={100}
              defaultValue={15}
              value={imageEdit.sharpenAmount}
              onChange={(val) =>
                onUpdateImageEdit(
                  { sharpenAmount: val },
                  { commitHistory: false, preservePreset: true }
                )
              }
              onCommit={() => onCommitSnapshot()}
            />
          </div>
        </div>
      )}

      {activeTab === 'filter' && (
        <div
          data-testid="filter-grid"
          className="grid grid-cols-3 gap-2"
          role="radiogroup"
          aria-label="Pilih filter warna foto"
        >
          {FILTER_PRESETS.map((preset) => {
            const active = imageEdit.filterId === preset.id;
            const thumbUrl = filterThumbnails[preset.id];
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`filter-${preset.id}`}
                onClick={() => onSelectFilter(preset.id)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-1.5 transition-all active:scale-[0.97] ${
                  active
                    ? 'border-[var(--border-active)] bg-[var(--bg-subtle)]'
                    : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:border-[var(--border-active)]'
                }`}
              >
                <div className="h-14 w-full overflow-hidden rounded-lg bg-[var(--bg-stage)]">
                  {thumbUrl ? (
                    <img
                      src={thumbUrl}
                      alt={preset.label}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full animate-pulse bg-[var(--bg-subtle)]" />
                  )}
                </div>
                <span className="text-[11px] font-semibold text-[var(--text-primary)]">
                  {preset.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
