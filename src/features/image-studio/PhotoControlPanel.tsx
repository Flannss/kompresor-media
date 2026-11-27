import { useEffect, useState } from 'react';
import {
  ChevronDown,
  Crop,
  Eye,
  FlipHorizontal2,
  FlipVertical2,
  Lock,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import { Button } from '../../design-system/components/Button';
import { SegmentedTabs } from '../../design-system/components/SegmentedTabs';
import { Slider } from '../../design-system/components/Slider';
import type {
  ColouriseToneProfile,
  ImageEditState,
  ImageOutputFormat,
  ImageProcessResult,
  PhotoFilterId,
  PhotoQualityModel,
  PhotoTargetResolution,
  ProPhotoToolId,
} from '../../engines/contracts';
import {
  getPhotoFilterCssPreview,
  PHOTO_FILTER_PRESETS,
} from '../../engines/grading/photoFilters';
import { PHOTO_QUALITY_MODEL_LABELS } from '../../engines/image/pixelOps';
import {
  COLOURISE_PROFILE_OPTIONS,
  PRO_PHOTO_TOOL_META,
} from '../../engines/image/proTools';
import {
  getMediaPreset,
  PHOTO_PRESET_IDS,
  type MediaPresetId,
} from '../../presets/mediaPresets';
import type { DeviceProfile } from '../../shared/utils/deviceCapability';

type PhotoTabId = 'utama' | 'tampilan' | 'edit';

export interface PhotoControlPanelProps {
  selectedPresetId: MediaPresetId;
  deviceProfile: DeviceProfile;
  imageEdit: ImageEditState;
  imageProcessResult: ImageProcessResult | null;
  baseThumbnailUrl: string | null;
  avifSupported: boolean;
  isCropping: boolean;
  holdOriginalActive: boolean;
  onHoldOriginalChange: (held: boolean) => void;
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
  onSelectPhotoFilter: (filterId: PhotoFilterId) => void;
  onRequestThumbnail: () => void;
  onResetPhoto?: () => void;
}

const PHOTO_TABS = [
  { id: 'utama' as const, label: '1. Tujuan' },
  { id: 'tampilan' as const, label: '2. Jernihkan & Filter', mobileLabel: '2. Jernihkan' },
  { id: 'edit' as const, label: '3. Edit & Potong', mobileLabel: '3. Edit' },
];

const QUALITY_MODELS: ReadonlyArray<{
  id: PhotoQualityModel;
  title: string;
  desc: string;
}> = [
  {
    id: 'realphoto',
    title: 'RealPhoto',
    desc: 'Natural & detail autentik',
  },
  {
    id: 'high-quality',
    title: 'High Quality',
    desc: 'Bening maksimal & tegas',
  },
  {
    id: 'ultra-detail',
    title: 'Ultra Detail',
    desc: 'Tajam maksimal & mikro-tekstur',
  },
  {
    id: 'studio-portrait',
    title: 'Studio Potret',
    desc: 'Kulit halus, mata & rambut tajam',
  },
  {
    id: 'hdr-dynamic',
    title: 'HDR Dinamis',
    desc: 'Bayangan terang & kontras hidup',
  },
];

const TARGET_RESOLUTION_OPTIONS: ReadonlyArray<{
  id: PhotoTargetResolution;
  label: string;
  sub: string;
}> = [
  { id: 'original', label: 'Asli', sub: 'Sesuai asal' },
  { id: 'hd', label: 'HD', sub: '1920 px' },
  { id: '2k', label: '2K', sub: '2560 px' },
  { id: '3k', label: '3K', sub: '3072 px' },
  { id: '4k', label: '4K', sub: '3840 px' },
  { id: '8k', label: '8K', sub: '7680 px' },
];

const MAX_EDGE_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'Asli' },
  { value: 2560, label: '2560 px' },
  { value: 1920, label: '1920 px' },
  { value: 1600, label: '1600 px' },
  { value: 1280, label: '1280 px' },
];

const TARGET_SIZE_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'Otomatis' },
  { value: 500, label: '≤ 500 KB' },
  { value: 1024, label: '≤ 1 MB' },
  { value: 2048, label: '≤ 2 MB' },
  { value: 4096, label: '≤ 4 MB' },
  { value: 8192, label: '≤ 8 MB' },
];

export function PhotoControlPanel({
  selectedPresetId,
  deviceProfile,
  imageEdit,
  imageProcessResult,
  baseThumbnailUrl,
  avifSupported,
  isCropping,
  holdOriginalActive,
  onHoldOriginalChange,
  onSelectPreset,
  onUpdateImageEdit,
  onCommitSnapshot,
  onToggleCrop,
  onRotate90,
  onFlipH,
  onFlipV,
  onSelectPhotoFilter,
  onRequestThumbnail,
  onResetPhoto,
}: PhotoControlPanelProps) {
  const [activeTab, setActiveTab] = useState<PhotoTabId>('utama');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [lightDrawerOpen, setLightDrawerOpen] = useState(true);
  const [colorDrawerOpen, setColorDrawerOpen] = useState(false);
  const [focusedToolId, setFocusedToolId] = useState<ProPhotoToolId>('sharpen');

  useEffect(() => {
    if (activeTab === 'tampilan' && !baseThumbnailUrl) {
      onRequestThumbnail();
    }
  }, [activeTab, baseThumbnailUrl, onRequestThumbnail]);

  const isLosslessPng = imageEdit.outputFormat === 'image/png';
  const hasTargetSize = !isLosslessPng && imageEdit.targetSizeKB !== null;
  const filterActive = imageEdit.photoFilterId !== 'original';
  const activeTools = imageEdit.proTools ?? [];
  const colouriseActive = activeTools.includes('colourise');
  const hasHighTarget =
    imageEdit.targetResolution === '2k' ||
    imageEdit.targetResolution === '3k' ||
    imageEdit.targetResolution === '4k' ||
    imageEdit.targetResolution === '8k';

  const toggleProTool = (toolId: ProPhotoToolId) => {
    setFocusedToolId(toolId);
    const exists = activeTools.includes(toolId);
    const nextTools = exists
      ? activeTools.filter((id) => id !== toolId)
      : [...activeTools, toolId];
    onUpdateImageEdit(
      { proTools: nextTools },
      { commitHistory: true, preservePreset: true }
    );
  };

  const hintToolId: ProPhotoToolId =
    activeTools.length > 0 && activeTools.includes(focusedToolId)
      ? focusedToolId
      : activeTools.length > 0
        ? activeTools[activeTools.length - 1]
        : focusedToolId;
  const activeHintToolMeta =
    PRO_PHOTO_TOOL_META.find((t) => t.id === hintToolId) ?? PRO_PHOTO_TOOL_META[0];

  const formatOptions: ReadonlyArray<{ value: ImageOutputFormat; label: string }> = avifSupported
    ? [
        { value: 'image/jpeg', label: 'JPG' },
        { value: 'image/webp', label: 'WebP' },
        { value: 'image/png', label: 'PNG' },
        { value: 'image/avif', label: 'AVIF' },
      ]
    : [
        { value: 'image/jpeg', label: 'JPG' },
        { value: 'image/webp', label: 'WebP' },
        { value: 'image/png', label: 'PNG' },
      ];

  const photoPresets = PHOTO_PRESET_IDS.map((id) => getMediaPreset(id));

  return (
    <div className="flex flex-col gap-3.5">
      {/* Subtle Active Pill Summary */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <button
          type="button"
          onClick={() => setActiveTab('tampilan')}
          className="rounded-full border border-[var(--border-active)] bg-[var(--bg-subtle)] px-2.5 py-0.5 font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)]"
        >
          {PHOTO_QUALITY_MODEL_LABELS[imageEdit.qualityModel] ?? 'RealPhoto'}
        </button>
        {activeTools.length > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab('tampilan')}
            className="rounded-full border border-[var(--border-active)] bg-[var(--accent-gold-soft)] px-2.5 py-0.5 font-semibold text-[var(--accent-gold)]"
          >
            {activeTools.length} Alat Foto
          </button>
        )}
        {imageEdit.targetResolution !== 'original' && (
          <button
            type="button"
            onClick={() => setActiveTab('tampilan')}
            className="rounded-full border border-[var(--border-active)] bg-[var(--accent-primary)]/18 px-2.5 py-0.5 font-semibold text-[var(--accent-highlight)]"
          >
            {imageEdit.targetResolution.toUpperCase()}
          </button>
        )}
        {filterActive && (
          <button
            type="button"
            onClick={() => setActiveTab('tampilan')}
            className="rounded-full border border-[var(--border-active)] bg-[var(--accent-primary)]/18 px-2.5 py-0.5 font-semibold text-[var(--accent-highlight)]"
          >
            Filter Aktif
          </button>
        )}
        {(imageEdit.crop !== null || imageEdit.straightenDeg !== 0 || imageEdit.rotationDeg > 0) && (
          <button
            type="button"
            onClick={() => setActiveTab('edit')}
            className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 py-0.5 font-medium text-[var(--text-secondary)]"
          >
            Bingkai Diubah
          </button>
        )}
        {(activeTools.length > 0 ||
          filterActive ||
          imageEdit.targetResolution !== 'original' ||
          imageEdit.crop !== null ||
          imageEdit.straightenDeg !== 0 ||
          imageEdit.rotationDeg > 0) && (
          <>
            <span className="rounded-full border border-[var(--status-ok-border)] bg-[var(--status-ok-bg)] px-2.5 py-0.5 font-medium text-[var(--status-ok-ink)]">
              Tersesuaikan
            </span>
            {onResetPhoto && (
              <button
                type="button"
                data-testid="photo-quick-reset-btn"
                onClick={onResetPhoto}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-0.5 font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                <span>Atur Ulang</span>
              </button>
            )}
          </>
        )}
      </div>

      {/* Strictly 3 Top-Level Tabs */}
      <SegmentedTabs
        items={PHOTO_TABS}
        value={activeTab}
        onChange={setActiveTab}
        ariaLabel="Menu studio foto"
      />

      {/* TAB 1: TUJUAN & FORMAT */}
      {activeTab === 'utama' && (
        <div className="space-y-5 sm:space-y-4">
          <div className="space-y-2.5 sm:space-y-2">
            <div>
              <h2 className="text-xs font-semibold text-[var(--text-primary)]">Pilih Tujuan</h2>
              <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-muted)]">
                Pilih aplikasi tujuan agar ukuran &amp; ketajaman langsung pas.
              </p>
            </div>
            <div
              className="no-scrollbar -mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:grid-cols-2 md:gap-2 md:overflow-visible md:px-0 md:pb-0"
              role="radiogroup"
              aria-label="Pilih tujuan penggunaan foto"
            >
              {photoPresets.map((preset) => {
                const selected = preset.id === selectedPresetId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`preset-${preset.id}`}
                    onClick={() => onSelectPreset(preset.id)}
                    className={`flex min-h-[48px] shrink-0 snap-start flex-col items-start justify-center whitespace-nowrap rounded-xl border px-3.5 py-2 text-left transition-all duration-150 active:scale-[0.985] md:min-h-[52px] md:whitespace-normal md:px-3 ${
                      selected
                        ? 'border-[var(--border-active)] bg-[var(--bg-subtle)] text-[var(--text-primary)] shadow-[var(--glass-highlight)]'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-active)]'
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

          <div className="space-y-3 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
            <div>
              <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                Format Output
              </span>
              <div
                className={`mt-1.5 grid gap-1.5 ${
                  formatOptions.length === 4 ? 'grid-cols-4' : 'grid-cols-3'
                }`}
              >
                {formatOptions.map((opt) => {
                  const active = imageEdit.outputFormat === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      data-testid={`format-${opt.label.toLowerCase()}`}
                      aria-pressed={active}
                      onClick={() => onUpdateImageEdit({ outputFormat: opt.value })}
                      className={`min-h-[38px] rounded-lg border text-xs font-medium transition-all active:scale-[0.98] ${
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

            <Slider
              label="Kualitas Kompresi"
              testId="quality-slider"
              min={30}
              max={100}
              step={1}
              defaultValue={92}
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
                  ? 'Kualitas diatur otomatis agar ukuran file tetap di bawah batas target.'
                  : isLosslessPng
                    ? 'Format PNG menyimpan gambar asli tanpa menurunkan kualitas.'
                    : undefined
              }
            />

            {/* Progressive Disclosure for Max Dimensions & Target Size */}
            <div className="border-t border-[var(--border-hairline)] pt-2.5">
              <button
                type="button"
                data-testid="photo-size-advanced-btn"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex min-h-[36px] w-full items-center justify-between text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <span>Atur Batas Ukuran</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>

              <div className={`km-accordion-grid ${advancedOpen ? 'mt-3' : ''}`} data-open={advancedOpen ? 'true' : 'false'}>
                <div className={`km-accordion-inner space-y-3 ${advancedOpen ? '' : 'pointer-events-none invisible'}`}>
                  <div>
                    <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                      Batas Sisi Panjang (saat Resolusi Asli)
                    </span>
                    <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                      {MAX_EDGE_OPTIONS.map((opt) => {
                        const active =
                          imageEdit.targetResolution === 'original' &&
                          imageEdit.maxEdgePx === opt.value;
                        return (
                          <button
                            key={opt.label}
                            type="button"
                            data-testid={`max-edge-${opt.value ?? 'original'}`}
                            aria-pressed={active}
                            onClick={() =>
                              onUpdateImageEdit({
                                targetResolution: 'original',
                                maxEdgePx: opt.value,
                              })
                            }
                            className={`min-h-[36px] rounded-full border text-xs font-medium tabular-nums transition-all ${
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
                        Batas Ukuran File
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
                              className={`min-h-[34px] rounded-full border px-2.5 text-[11px] font-medium tabular-nums transition-all ${
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
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: KUALITAS & ALAT */}
      {activeTab === 'tampilan' && (
        <div className="space-y-5 sm:space-y-4">
          {/* 9 Real Pixel-Level Pro Photo Tools */}
          <section className="space-y-3 rounded-[22px] bg-[var(--bg-surface)]/80 p-3 sm:border sm:border-[var(--border-hairline)] sm:bg-[var(--bg-elevated)] sm:p-3.5 sm:shadow-[var(--glass-highlight)]">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="font-editorial text-[14px] font-semibold text-[var(--text-primary)]">
                  Alat Sempurnakan Foto
                </h3>
                <span className="hidden text-[12px] leading-snug text-[var(--text-muted)] md:inline">
                  Perbaiki masalah foto tertentu (blur, kabut, foto lama, atau wajah).
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {activeTools.length > 0 && (
                  <button
                    type="button"
                    data-testid="reset-pro-tools-btn"
                    onClick={() =>
                      onUpdateImageEdit(
                        { proTools: [] },
                        { commitHistory: true, preservePreset: true }
                      )
                    }
                    className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 text-[10.5px] font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    <span>Reset</span>
                  </button>
                )}
                <span className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-0.5 text-[10.5px] font-semibold text-[var(--accent-gold)] tabular-nums">
                  {activeTools.length > 0 ? `${activeTools.length} aktif` : '9 alat'}
                </span>
              </div>
            </div>

            <div
              className="grid grid-cols-2 gap-2.5 sm:gap-2"
              role="group"
              aria-label="Alat sempurnakan foto"
            >
              {PRO_PHOTO_TOOL_META.map((tool, idx) => {
                const active = activeTools.includes(tool.id);
                return (
                  <button
                    key={tool.id}
                    type="button"
                    data-testid={`pro-tool-${tool.id}`}
                    aria-pressed={active}
                    title={tool.desc}
                    onClick={() => toggleProTool(tool.id)}
                    className={`flex min-h-[44px] flex-col items-start justify-center rounded-2xl border px-3 py-2 text-left transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.985] md:min-h-[50px] ${
                      idx === 8 ? 'col-span-2' : ''
                    } ${
                      active
                        ? 'border-[var(--border-active)] bg-[var(--accent-gold-soft)] text-[var(--text-primary)] ring-1 ring-[var(--border-active)]'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span
                      className={`w-full truncate whitespace-nowrap text-[11.5px] font-semibold leading-tight ${
                        active ? 'text-[var(--accent-highlight)]' : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {tool.title}
                    </span>
                    <span className="mt-0.5 hidden line-clamp-1 text-[10px] leading-snug text-[var(--text-muted)] md:block">
                      {tool.desc}
                    </span>
                  </button>
                );
              })}
            </div>

            <p
              data-testid="mobile-active-pro-tool-hint"
              className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 py-2 text-[11.5px] leading-snug text-[var(--text-secondary)] md:hidden"
            >
              <span className="font-semibold text-[var(--text-primary)]">
                {activeHintToolMeta.title}:{' '}
              </span>
              {activeHintToolMeta.desc}
            </p>

            {colouriseActive && (
              <div className="space-y-1.5 border-t border-[var(--border-hairline)] pt-2.5">
                <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                  Profil Warna (Warnai Foto)
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {COLOURISE_PROFILE_OPTIONS.map((opt) => {
                    const selected =
                      (imageEdit.colouriseProfile ?? 'warm-portrait') === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        data-testid={`colourise-profile-${opt.id}`}
                        aria-pressed={selected}
                        onClick={() =>
                          onUpdateImageEdit(
                            { colouriseProfile: opt.id as ColouriseToneProfile },
                            { commitHistory: true, preservePreset: true }
                          )
                        }
                        className={`min-h-[36px] rounded-full border px-2 text-[10.5px] font-semibold transition-all ${
                          selected
                            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                            : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTools.length > 0 && (
              <div className="border-t border-[var(--border-hairline)] pt-2.5">
                <Slider
                  label="Kekuatan Alat"
                  testId="slider-pro-tool-strength"
                  min={0}
                  max={100}
                  step={5}
                  defaultValue={80}
                  value={imageEdit.proToolStrength ?? 80}
                  valueLabel={`${imageEdit.proToolStrength ?? 80}%`}
                  onChange={(val) =>
                    onUpdateImageEdit(
                      { proToolStrength: val },
                      { commitHistory: false, preservePreset: true }
                    )
                  }
                  onCommit={() => onCommitSnapshot()}
                />
              </div>
            )}
          </section>

          {/* Quality Model Selector */}
          <section className="space-y-2.5">
            <div>
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                Model Kualitas Foto
              </h3>
              <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-muted)]">
                Atur karakter kejernihan dasar foto tanpa mengubah gaya asli.
              </p>
            </div>
            <div
              className="no-scrollbar -mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:grid-cols-2 md:gap-2 md:overflow-visible md:px-0 md:pb-0"
              role="radiogroup"
              aria-label="Model kualitas foto"
            >
              {QUALITY_MODELS.map((model, idx) => {
                const selected = imageEdit.qualityModel === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`quality-model-${model.id}`}
                    onClick={() =>
                      onUpdateImageEdit(
                        { qualityModel: model.id },
                        { commitHistory: true, preservePreset: true }
                      )
                    }
                    className={`flex min-h-[52px] min-w-[152px] shrink-0 snap-start flex-col items-start justify-center rounded-xl border px-3.5 py-2 text-left transition-all md:min-h-[56px] md:min-w-0 md:px-3 ${
                      idx === 4 ? 'md:col-span-2' : ''
                    } ${
                      selected
                        ? 'border-[var(--border-active)] bg-[var(--bg-subtle)] ring-1 ring-[var(--border-active)]'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:border-[var(--border-active)]'
                    }`}
                  >
                    <span className="whitespace-nowrap text-xs font-semibold text-[var(--text-primary)]">
                      {model.title}
                    </span>
                    <span className="mt-0.5 line-clamp-1 text-[10.5px] leading-snug text-[var(--text-muted)]">
                      {model.desc}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
              <Slider
                label="Kekuatan Model"
                testId="slider-quality-model-strength"
                min={0}
                max={100}
                defaultValue={80}
                value={imageEdit.qualityModelStrength}
                valueLabel={`${imageEdit.qualityModelStrength}%`}
                onChange={(val) =>
                  onUpdateImageEdit(
                    { qualityModelStrength: val },
                    { commitHistory: false, preservePreset: true }
                  )
                }
                onCommit={() => onCommitSnapshot()}
              />
            </div>
          </section>

          {/* Target Resolution */}
          <section className="space-y-2.5 rounded-2xl bg-[var(--bg-surface)]/80 p-3 sm:border sm:border-[var(--border-hairline)] sm:bg-[var(--bg-elevated)]">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">Target Resolusi</h3>
              <span className="text-[10px] text-[var(--text-muted)]">Perjelas bertahap</span>
            </div>

            <div className="no-scrollbar -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:grid-cols-3 md:gap-1.5 md:overflow-visible md:px-0 md:pb-0">
              {TARGET_RESOLUTION_OPTIONS.map((opt) => {
                const isLocked8k = opt.id === '8k' && !deviceProfile.allow8KPhotoExport;
                const active = imageEdit.targetResolution === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isLocked8k}
                    data-testid={`photo-target-res-${opt.id}`}
                    aria-pressed={active}
                    title={
                      isLocked8k
                        ? '8K hanya aktif di Laptop/Desktop agar memori HP tetap aman.'
                        : `${opt.label} (${opt.sub})`
                    }
                    onClick={() =>
                      onUpdateImageEdit(
                        {
                          targetResolution: opt.id,
                          ...(opt.id !== 'original' ? { targetSizeKB: null } : {}),
                        },
                        { commitHistory: true, preservePreset: true }
                      )
                    }
                    className={`flex min-h-[44px] min-w-[78px] shrink-0 snap-start flex-col items-center justify-center whitespace-nowrap rounded-xl border px-3 py-1.5 text-center transition-all tabular-nums disabled:cursor-not-allowed disabled:opacity-45 md:min-h-[46px] md:min-w-0 md:rounded-lg md:px-1.5 md:py-1 ${
                      active
                        ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-active)]'
                    }`}
                  >
                    <span className="flex items-center gap-0.5 text-[11px] font-semibold">
                      {opt.label}
                      {isLocked8k && <Lock className="h-2.5 w-2.5" aria-hidden="true" />}
                    </span>
                    <span
                      className={`text-[9px] ${
                        active ? 'text-white/85' : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {opt.sub}
                    </span>
                  </button>
                );
              })}
            </div>

            {!deviceProfile.allow8KPhotoExport && (
              <p
                data-testid="guard-8k-note"
                className="text-[10px] leading-snug text-[var(--text-muted)]"
              >
                8K hanya aktif di Laptop/Desktop agar memori HP tetap aman.
              </p>
            )}

            {hasHighTarget && (
              <p
                data-testid="upscale-preview-note"
                className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[10px] leading-relaxed text-[var(--text-secondary)]"
              >
                Pratinjau tetap ringan agar geser halus; hasil {imageEdit.targetResolution.toUpperCase()} penuh dirender saat unduh.
              </p>
            )}
          </section>

          {/* Noise & Sharpening */}
          <section className="space-y-3 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
            <Slider
              label="Redam Noise"
              testId="slider-denoise"
              min={0}
              max={100}
              defaultValue={0}
              value={imageEdit.denoiseAmount}
              onChange={(val) =>
                onUpdateImageEdit(
                  { denoiseAmount: val },
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
              defaultValue={20}
              value={imageEdit.sharpenAmount}
              onChange={(val) =>
                onUpdateImageEdit(
                  { sharpenAmount: val },
                  { commitHistory: false, preservePreset: true }
                )
              }
              onCommit={() => onCommitSnapshot()}
            />
          </section>

          {/* 12 Filter Warna */}
          <section className="space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                  Filter Warna (12 Tampilan)
                </h3>
                <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-muted)]">
                  Ubah suasana warna foto secara opsional.
                </p>
              </div>
              <button
                type="button"
                data-testid="grade-hold-original-btn"
                aria-pressed={holdOriginalActive}
                onPointerDown={() => onHoldOriginalChange(true)}
                onPointerUp={() => onHoldOriginalChange(false)}
                onPointerLeave={() => onHoldOriginalChange(false)}
                onPointerCancel={() => onHoldOriginalChange(false)}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] select-none"
              >
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Tahan: Asli</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {PHOTO_FILTER_PRESETS.map((look) => {
                const active = imageEdit.photoFilterId === look.id;
                const cssFilter = getPhotoFilterCssPreview(look.id, 100);
                return (
                  <button
                    key={look.id}
                    type="button"
                    data-testid={`photo-filter-${look.id}`}
                    aria-pressed={active}
                    onClick={() => onSelectPhotoFilter(look.id)}
                    title={look.description}
                    className={`flex flex-col overflow-hidden rounded-xl border text-left transition-all ${
                      active
                        ? 'border-[var(--border-active)] bg-[var(--bg-subtle)] ring-1 ring-[var(--border-active)]'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:border-[var(--border-active)]'
                    }`}
                  >
                    <div className="relative h-12 w-full overflow-hidden bg-[var(--bg-subtle)]">
                      {baseThumbnailUrl ? (
                        <img
                          src={baseThumbnailUrl}
                          alt={look.title}
                          style={{ filter: cssFilter === 'none' ? undefined : cssFilter }}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div
                          style={{ filter: cssFilter === 'none' ? undefined : cssFilter }}
                          className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#3B2A1F] via-[#6F4E37] to-[#B08968]/80 text-[9px] font-semibold text-[#FFF9F0]/90"
                        >
                          {look.badge}
                        </div>
                      )}
                    </div>
                    <div className="px-1.5 py-1">
                      <span className="block truncate text-[10px] font-semibold text-[var(--text-primary)]">
                        {look.title}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {filterActive && (
              <Slider
                label="Intensitas Filter"
                testId="slider-photo-filter-intensity"
                min={0}
                max={100}
                defaultValue={100}
                value={imageEdit.photoFilterIntensity}
                valueLabel={`${imageEdit.photoFilterIntensity}%`}
                onChange={(val) =>
                  onUpdateImageEdit(
                    { photoFilterIntensity: val },
                    { commitHistory: false, preservePreset: true }
                  )
                }
                onCommit={() => onCommitSnapshot()}
              />
            )}
          </section>
        </div>
      )}

      {/* TAB 3: EDIT & BINGKAI */}
      {activeTab === 'edit' && (
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={isCropping ? 'primary' : 'secondary'}
              size="md"
              data-testid="open-crop-btn"
              onClick={onToggleCrop}
              className="min-h-[44px] text-xs"
            >
              <Crop className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isCropping ? 'Tutup Potong' : 'Potong / Crop'}</span>
            </Button>
            <Button
              variant="secondary"
              size="md"
              data-testid="rotate-90-btn"
              onClick={onRotate90}
              className="min-h-[44px] text-xs"
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
              className="min-h-[44px] text-xs"
            >
              <FlipHorizontal2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Balik H</span>
            </Button>
            <Button
              variant={imageEdit.flipV ? 'primary' : 'secondary'}
              size="md"
              data-testid="flip-v-btn"
              onClick={onFlipV}
              className="min-h-[44px] text-xs"
            >
              <FlipVertical2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Balik V</span>
            </Button>
          </div>

          <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
            <Slider
              label="Luruskan"
              testId="slider-straighten"
              min={-15}
              max={15}
              step={0.5}
              defaultValue={0}
              value={imageEdit.straightenDeg}
              valueLabel={`${imageEdit.straightenDeg > 0 ? '+' : ''}${imageEdit.straightenDeg}°`}
              onChange={(val) =>
                onUpdateImageEdit(
                  { straightenDeg: val },
                  { commitHistory: false, preservePreset: true }
                )
              }
              onCommit={() => onCommitSnapshot()}
            />
          </div>

          {/* Drawer 1: Cahaya & Detail */}
          <div className="rounded-[22px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5 shadow-[var(--glass-highlight)]">
            <button
              type="button"
              data-testid="drawer-light-detail-btn"
              aria-expanded={lightDrawerOpen}
              onClick={() => setLightDrawerOpen((v) => !v)}
              className="flex min-h-[34px] w-full items-center justify-between text-xs font-semibold text-[var(--text-primary)]"
            >
              <span>Cahaya &amp; Detail</span>
              <ChevronDown
                className={`h-4 w-4 text-[var(--text-muted)] transition-transform duration-200 ${
                  lightDrawerOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            <div
              className={`km-accordion-grid ${lightDrawerOpen ? 'mt-3 border-t border-[var(--border-hairline)] pt-3' : ''}`}
              data-open={lightDrawerOpen ? 'true' : 'false'}
            >
              <div
                data-testid="drawer-light-detail"
                aria-hidden={!lightDrawerOpen}
                className={`km-accordion-inner space-y-3 ${lightDrawerOpen ? '' : 'pointer-events-none invisible'}`}
              >
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
                  label="Sorotan"
                  testId="slider-highlights"
                  min={-100}
                  max={100}
                  defaultValue={0}
                  value={imageEdit.adjustments.highlights}
                  onChange={(val) =>
                    onUpdateImageEdit(
                      { adjustments: { ...imageEdit.adjustments, highlights: val } },
                      { commitHistory: false, preservePreset: true }
                    )
                  }
                  onCommit={() => onCommitSnapshot()}
                />
                <Slider
                  label="Bayangan"
                  testId="slider-shadows"
                  min={-100}
                  max={100}
                  defaultValue={0}
                  value={imageEdit.adjustments.shadows}
                  onChange={(val) =>
                    onUpdateImageEdit(
                      { adjustments: { ...imageEdit.adjustments, shadows: val } },
                      { commitHistory: false, preservePreset: true }
                    )
                  }
                  onCommit={() => onCommitSnapshot()}
                />
                <Slider
                  label="Kejernihan"
                  testId="slider-clarity"
                  min={-100}
                  max={100}
                  defaultValue={0}
                  value={imageEdit.adjustments.clarity}
                  onChange={(val) =>
                    onUpdateImageEdit(
                      { adjustments: { ...imageEdit.adjustments, clarity: val } },
                      { commitHistory: false, preservePreset: true }
                    )
                  }
                  onCommit={() => onCommitSnapshot()}
                />
                <Slider
                  label="Vinyet Halus"
                  testId="slider-vignette"
                  min={0}
                  max={100}
                  defaultValue={0}
                  value={imageEdit.adjustments.vignette}
                  onChange={(val) =>
                    onUpdateImageEdit(
                      { adjustments: { ...imageEdit.adjustments, vignette: val } },
                      { commitHistory: false, preservePreset: true }
                    )
                  }
                  onCommit={() => onCommitSnapshot()}
                />
              </div>
            </div>
          </div>

          {/* Drawer 2: Warna */}
          <div className="rounded-[22px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5 shadow-[var(--glass-highlight)]">
            <button
              type="button"
              data-testid="drawer-color-btn"
              aria-expanded={colorDrawerOpen}
              onClick={() => setColorDrawerOpen((v) => !v)}
              className="flex min-h-[34px] w-full items-center justify-between text-xs font-semibold text-[var(--text-primary)]"
            >
              <span>Warna</span>
              <ChevronDown
                className={`h-4 w-4 text-[var(--text-muted)] transition-transform duration-200 ${
                  colorDrawerOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            <div
              className={`km-accordion-grid ${colorDrawerOpen ? 'mt-3 border-t border-[var(--border-hairline)] pt-3' : ''}`}
              data-open={colorDrawerOpen ? 'true' : 'false'}
            >
              <div
                data-testid="drawer-color"
                aria-hidden={!colorDrawerOpen}
                className={`km-accordion-inner space-y-3 ${colorDrawerOpen ? '' : 'pointer-events-none invisible'}`}
              >
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
                  label="Vibrance"
                  testId="slider-vibrance"
                  min={-100}
                  max={100}
                  defaultValue={0}
                  value={imageEdit.adjustments.vibrance}
                  onChange={(val) =>
                    onUpdateImageEdit(
                      { adjustments: { ...imageEdit.adjustments, vibrance: val } },
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
                  label="Tint"
                  testId="slider-tint"
                  min={-100}
                  max={100}
                  defaultValue={0}
                  value={imageEdit.adjustments.tint}
                  onChange={(val) =>
                    onUpdateImageEdit(
                      { adjustments: { ...imageEdit.adjustments, tint: val } },
                      { commitHistory: false, preservePreset: true }
                    )
                  }
                  onCommit={() => onCommitSnapshot()}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
