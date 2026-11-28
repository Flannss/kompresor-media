import { useEffect, useState } from 'react';
import {
  Aperture,
  Check,
  ChevronDown,
  Crop,
  Droplets,
  Eye,
  FlipHorizontal2,
  FlipVertical2,
  Focus,
  History,
  Lock,
  Palette,
  RotateCcw,
  RotateCw,
  ScanFace,
  Sun,
  User,
  Wind,
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

export type PhotoTabId = 'utama' | 'tampilan' | 'edit';

const PRESET_BADGE_STYLE: Record<string, { dot: string; tag: string }> = {
  'whatsapp-hd': { dot: 'bg-[var(--text-primary)]', tag: 'Paling Populer' },
  'whatsapp-status': { dot: 'bg-[var(--text-secondary)]', tag: 'Rekomendasi' },
  'instagram-story': { dot: 'bg-[var(--text-muted)]', tag: 'Reels & Story' },
  'instagram-feed': { dot: 'bg-[var(--text-muted)]', tag: 'Feed IG' },
  'tiktok-hd': { dot: 'bg-[var(--accent-slate)]', tag: 'TikTok HD' },
  'web-light': { dot: 'bg-[var(--text-subtle)]', tag: 'Paling Ringan' },
  'archive-hd': { dot: 'bg-[var(--text-secondary)]', tag: 'Super Jernih' },
  custom: { dot: 'bg-[var(--text-subtle)]', tag: 'Manual' },
};

const PRO_TOOL_ICONS = {
  sharpen: Focus,
  retouch: Droplets,
  'enhance-face': User,
  deblur: Aperture,
  dehaze: Sun,
  'remove-motion-blur': Wind,
  restore: History,
  colourise: Palette,
  'face-restoration': ScanFace,
} satisfies Record<ProPhotoToolId, typeof Focus>;

export interface PhotoInspectorHeaderProps {
  imageEdit: ImageEditState;
  activeTab: PhotoTabId;
  onChangeTab: (tab: PhotoTabId) => void;
  onResetPhoto?: () => void;
}

export function PhotoInspectorHeader({
  imageEdit,
  activeTab,
  onChangeTab,
  onResetPhoto,
}: PhotoInspectorHeaderProps) {
  const activeTools = imageEdit.proTools ?? [];
  const filterActive = imageEdit.photoFilterId !== 'original';
  const hasModifications =
    activeTools.length > 0 ||
    filterActive ||
    imageEdit.targetResolution !== 'original' ||
    imageEdit.crop !== null ||
    imageEdit.straightenDeg !== 0 ||
    imageEdit.rotationDeg > 0;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <button
          type="button"
          onClick={() => onChangeTab('tampilan')}
          className="glass-inner-rim rounded-full border border-[var(--border-active)] px-3 py-1 font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)]"
        >
          {PHOTO_QUALITY_MODEL_LABELS[imageEdit.qualityModel] ?? 'RealPhoto'}
        </button>
        {activeTools.length > 0 && (
          <button
            type="button"
            onClick={() => onChangeTab('tampilan')}
            className="glass-inner-rim rounded-full border border-[var(--border-strong)] px-3 py-1 font-semibold text-[var(--text-primary)]"
          >
            {activeTools.length} Alat Foto
          </button>
        )}
        {imageEdit.targetResolution !== 'original' && (
          <button
            type="button"
            onClick={() => onChangeTab('tampilan')}
            className="glass-inner-rim rounded-full border border-[var(--border-strong)] px-3 py-1 font-semibold text-[var(--text-primary)]"
          >
            {imageEdit.targetResolution.toUpperCase()}
          </button>
        )}
        {filterActive && (
          <button
            type="button"
            onClick={() => onChangeTab('tampilan')}
            className="glass-inner-rim rounded-full border border-[var(--border-strong)] px-3 py-1 font-semibold text-[var(--text-primary)]"
          >
            Filter Aktif
          </button>
        )}
        {(imageEdit.crop !== null || imageEdit.straightenDeg !== 0 || imageEdit.rotationDeg > 0) && (
          <button
            type="button"
            onClick={() => onChangeTab('edit')}
            className="glass-inner-rim rounded-full border px-3 py-1 font-medium text-[var(--text-secondary)]"
          >
            Bingkai Diubah
          </button>
        )}
        {hasModifications && (
          <>
            <span className="glass-inner-rim rounded-full border px-3 py-1 font-medium text-[var(--text-secondary)]">
              Tersesuaikan
            </span>
            {onResetPhoto && (
              <button
                type="button"
                data-testid="photo-quick-reset-btn"
                onClick={onResetPhoto}
                className="glass-inner-rim inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                <span>Atur Ulang</span>
              </button>
            )}
          </>
        )}
      </div>

      <SegmentedTabs
        items={PHOTO_TABS}
        value={activeTab}
        onChange={onChangeTab}
        ariaLabel="Menu studio foto"
      />
    </div>
  );
}

export interface PhotoControlPanelProps {
  selectedPresetId: MediaPresetId;
  deviceProfile: DeviceProfile;
  imageEdit: ImageEditState;
  imageProcessResult: ImageProcessResult | null;
  baseThumbnailUrl: string | null;
  avifSupported: boolean;
  isCropping: boolean;
  holdOriginalActive: boolean;
  activeTab?: PhotoTabId;
  onTabChange?: (tab: PhotoTabId) => void;
  showHeader?: boolean;
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
  { id: 'tampilan' as const, label: '2. Efek & Filter', mobileLabel: '2. Efek' },
  { id: 'edit' as const, label: '3. Edit & Crop', mobileLabel: '3. Edit' },
];

const QUALITY_MODELS: ReadonlyArray<{
  id: PhotoQualityModel;
  title: string;
  desc: string;
  badge?: string;
}> = [
  {
    id: 'realphoto',
    title: 'RealPhoto',
    desc: 'Natural & detail autentik',
    badge: 'Rekomendasi',
  },
  {
    id: 'high-quality',
    title: 'High Quality',
    desc: 'Bening maksimal & tegas',
    badge: 'Bening HD',
  },
  {
    id: 'ultra-detail',
    title: 'Ultra Detail',
    desc: 'Tajam maksimal & mikro-tekstur',
    badge: 'Detail 4K',
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
  badge?: string;
}> = [
  { id: 'original', label: 'Asli', sub: 'Sesuai asal' },
  { id: 'hd', label: 'HD', sub: '1920 px' },
  { id: '2k', label: '2K', sub: '2560 px', badge: 'Seimbang' },
  { id: '3k', label: '3K', sub: '3072 px' },
  { id: '4k', label: '4K', sub: '3840 px', badge: 'Ultra Jernih' },
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
  activeTab: controlledTab,
  onTabChange,
  showHeader = true,
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
  const [internalTab, setInternalTab] = useState<PhotoTabId>('utama');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = (tab: PhotoTabId) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setInternalTab(tab);
    }
  };
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
      {showHeader && (
        <PhotoInspectorHeader
          imageEdit={imageEdit}
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          onResetPhoto={onResetPhoto}
        />
      )}

      {/* TAB 1: TUJUAN & FORMAT */}
      {activeTab === 'utama' && (
        <div key="photo-tab-utama" className="km-tab-enter space-y-6">
          <div className="space-y-3">
            <div>
              <h2 className="text-xs font-semibold text-[var(--text-primary)]">Pilih Tujuan</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
                Pilih aplikasi tujuan agar ukuran &amp; ketajaman langsung pas.
              </p>
            </div>
            <div
              className="no-scrollbar -mx-1 -my-2.5 flex snap-x gap-3 overflow-x-auto px-1 py-2.5 md:mx-0 md:my-0 md:grid md:grid-cols-2 md:gap-3 md:overflow-visible md:p-0"
              role="radiogroup"
              aria-label="Pilih tujuan penggunaan foto"
            >
              {photoPresets.map((preset) => {
                const selected = preset.id === selectedPresetId;
                const badgeMeta = PRESET_BADGE_STYLE[preset.id] ?? {
                  dot: 'bg-[var(--text-secondary)]',
                  tag: preset.shortLabel,
                };
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`preset-${preset.id}`}
                    onClick={() => onSelectPreset(preset.id)}
                    className={`glass-frosted-card flex min-h-[68px] min-w-[186px] max-w-[230px] shrink-0 snap-start flex-col items-start justify-between overflow-hidden whitespace-normal rounded-2xl border px-3.5 py-3 text-left transition-all duration-150 hover:-translate-y-0.5 active:scale-[0.985] md:min-h-[76px] md:min-w-0 md:max-w-full ${
                      selected
                        ? 'border-[var(--border-active)] [background-image:var(--accent-wash-gradient)] text-[var(--text-primary)] ring-1 ring-[var(--border-strong)]'
                        : 'text-[var(--text-secondary)] hover:border-[var(--border-active)]'
                    }`}
                  >
                    <span className="mb-1.5 flex w-full min-w-0 items-center justify-between gap-2">
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 shrink-0 rounded-full ${badgeMeta.dot}`}
                      />
                      <span className="glass-inner-rim max-w-full shrink-0 truncate rounded-md border px-2 py-0.5 text-[9.5px] font-semibold leading-tight text-[var(--text-secondary)]">
                        {badgeMeta.tag}
                      </span>
                    </span>
                    <span className="w-full min-w-0 break-words text-xs font-semibold leading-snug text-[var(--text-primary)]">
                      {preset.label}
                    </span>
                    <span className="mt-1 w-full min-w-0 break-words text-[11px] leading-snug text-[var(--text-muted)]">
                      {preset.targetLimitLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="glass-frosted-card min-w-0 max-w-full space-y-4 overflow-hidden rounded-[22px] border p-4">
            <div>
              <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                Format Output
              </span>
              <div
                className={`mt-2 grid gap-2 ${
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
                      className={`min-h-[42px] rounded-xl border text-xs font-medium transition-all active:scale-[0.98] ${
                        active
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'glass-inner-rim text-[var(--text-primary)] hover:border-[var(--border-active)]'
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
            <div className="border-t border-[var(--border-hairline)] pt-3">
              <button
                type="button"
                data-testid="photo-size-advanced-btn"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex min-h-[38px] w-full items-center justify-between text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <span>Atur Batas Ukuran</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>

              <div className={`km-accordion-grid ${advancedOpen ? 'mt-3' : ''}`} data-open={advancedOpen ? 'true' : 'false'}>
                <div className={`km-accordion-inner space-y-3.5 ${advancedOpen ? '' : 'pointer-events-none invisible'}`}>
                  <div>
                    <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                      Batas Sisi Panjang (saat Resolusi Asli)
                    </span>
                    <div className="mt-2 grid grid-cols-3 gap-2">
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
                            className={`min-h-[38px] rounded-full border px-2.5 py-1.5 text-xs font-medium tabular-nums transition-all ${
                              active
                                ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                                : 'glass-inner-rim text-[var(--text-primary)] hover:border-[var(--border-active)]'
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
                      <div className="mt-2 flex flex-wrap gap-2">
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
                              className={`min-h-[38px] rounded-full border px-3 py-1.5 text-[11px] font-medium tabular-nums transition-all ${
                                active
                                  ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                                  : 'glass-inner-rim text-[var(--text-primary)] hover:border-[var(--border-active)]'
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
        <div key="photo-tab-tampilan" className="km-tab-enter space-y-5">
          {/* 9 Real Pixel-Level Pro Photo Tools */}
          <section className="glass-frosted-card min-w-0 max-w-full space-y-4 overflow-hidden rounded-[22px] border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2.5">
              <div className="min-w-0 flex-1">
                <h3 className="font-editorial text-[14px] font-semibold leading-snug text-[var(--text-primary)]">
                  Alat Sempurnakan Foto
                </h3>
                <span className="mt-1 hidden text-[12px] leading-relaxed text-[var(--text-muted)] md:block">
                  Perbaiki masalah foto tertentu (blur, kabut, foto lama, atau wajah).
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
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
                    className="glass-inner-rim inline-flex min-h-[34px] shrink-0 items-center gap-1 rounded-full border px-3 text-[11px] font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    <span>Reset</span>
                  </button>
                )}
                <span className="glass-inner-rim shrink-0 rounded-full border border-[var(--border-strong)] px-3 py-1 text-[11px] font-semibold text-[var(--text-primary)] tabular-nums">
                  {activeTools.length > 0 ? `${activeTools.length} aktif` : '9 alat'}
                </span>
              </div>
            </div>

            <div
              className="grid grid-cols-2 gap-3"
              role="group"
              aria-label="Alat sempurnakan foto"
            >
              {PRO_PHOTO_TOOL_META.map((tool, idx) => {
                const active = activeTools.includes(tool.id);
                const ToolIcon = PRO_TOOL_ICONS[tool.id];
                return (
                  <button
                    key={tool.id}
                    type="button"
                    data-testid={`pro-tool-${tool.id}`}
                    aria-pressed={active}
                    title={tool.desc}
                    onClick={() => toggleProTool(tool.id)}
                    className={`glass-inner-rim flex min-h-[48px] min-w-0 max-w-full flex-col items-start justify-center overflow-hidden rounded-2xl border px-3.5 py-3 text-left transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 active:scale-[0.985] md:min-h-[58px] ${
                      idx === 8 ? 'col-span-2' : ''
                    } ${
                      active
                        ? 'border-[var(--border-active)] border-l-[3px] border-l-[var(--border-active)] [background-image:var(--accent-wash-gradient)] text-[var(--text-primary)] ring-1 ring-[var(--border-strong)]'
                        : 'text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span
                      className={`flex w-full min-w-0 items-center gap-2 text-[11.5px] font-semibold leading-tight ${
                        active ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)]'
                      }`}
                    >
                      <ToolIcon className="h-3.5 w-3.5 shrink-0 opacity-85" aria-hidden="true" />
                      <span className="truncate whitespace-nowrap">{tool.title}</span>
                    </span>
                    <span className="mt-1 hidden line-clamp-2 w-full min-w-0 text-[10.5px] leading-snug text-[var(--text-muted)] md:block">
                      {tool.desc}
                    </span>
                  </button>
                );
              })}
            </div>

            <p
              data-testid="mobile-active-pro-tool-hint"
              className="glass-inner-rim min-w-0 max-w-full overflow-hidden rounded-xl border px-3.5 py-2.5 text-[11.5px] leading-relaxed text-[var(--text-secondary)] md:hidden"
            >
              <span className="font-semibold text-[var(--text-primary)]">
                {activeHintToolMeta.title}:{' '}
              </span>
              {activeHintToolMeta.desc}
            </p>

            {colouriseActive && (
              <div className="space-y-2.5 border-t border-[var(--border-hairline)] pt-3">
                <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                  Profil Warna (Warnai Foto)
                </span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                        className={`min-h-[40px] rounded-full border px-3 py-1.5 text-[11px] font-semibold leading-snug transition-all ${
                          selected
                            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                            : 'glass-inner-rim text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
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
              <div className="border-t border-[var(--border-hairline)] pt-3">
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
          <section className="glass-frosted-card min-w-0 max-w-full space-y-3.5 overflow-hidden rounded-[22px] border p-4">
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                Model Kualitas Foto
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
                Atur karakter kejernihan dasar foto tanpa mengubah gaya asli.
              </p>
            </div>
            <div
              className="no-scrollbar -mx-1 -my-2.5 flex snap-x gap-3 overflow-x-auto px-1 py-2.5 md:mx-0 md:my-0 md:grid md:grid-cols-2 md:gap-3 md:overflow-visible md:p-0"
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
                    className={`glass-inner-rim flex min-h-[70px] min-w-[184px] max-w-[220px] shrink-0 snap-start flex-col items-start justify-between overflow-hidden whitespace-normal rounded-2xl border px-3.5 py-3 text-left transition-all md:min-h-[74px] md:min-w-0 md:max-w-full ${
                      idx === 4 ? 'md:col-span-2' : ''
                    } ${
                      selected
                        ? 'border-[var(--border-active)] [background-image:var(--accent-wash-gradient)] ring-1 ring-[var(--border-active)]'
                        : 'hover:border-[var(--border-active)]'
                    }`}
                  >
                    {model.badge && (
                      <span className="glass-inner-rim mb-1.5 inline-flex max-w-full shrink-0 truncate rounded-md border px-2 py-0.5 text-[9.5px] font-semibold leading-tight text-[var(--text-secondary)]">
                        {model.badge}
                      </span>
                    )}
                    <span className="w-full min-w-0 break-words text-xs font-semibold leading-snug text-[var(--text-primary)]">
                      {model.title}
                    </span>
                    <span className="mt-1 line-clamp-2 w-full min-w-0 text-[11px] leading-snug text-[var(--text-muted)]">
                      {model.desc}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="glass-inner-rim min-w-0 max-w-full overflow-hidden rounded-2xl border p-4">
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
          <section className="glass-frosted-card min-w-0 max-w-full space-y-3.5 overflow-hidden rounded-[22px] border p-4">
            <div className="flex min-w-0 items-center justify-between gap-2.5">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">Target Resolusi</h3>
              <span className="shrink-0 text-[11px] text-[var(--text-muted)]">Perjelas bertahap</span>
            </div>

            <div className="no-scrollbar -mx-1 -my-2.5 flex snap-x gap-2.5 overflow-x-auto px-1 py-2.5 md:mx-0 md:my-0 md:grid md:grid-cols-2 md:gap-2.5 md:overflow-visible md:p-0">
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
                    className={`flex min-h-[56px] min-w-[120px] max-w-full shrink-0 snap-start flex-col items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-xl border px-3 py-2.5 text-center transition-all tabular-nums disabled:cursor-not-allowed disabled:opacity-45 md:min-w-0 md:whitespace-normal ${
                      active
                        ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                        : 'glass-inner-rim text-[var(--text-primary)] hover:border-[var(--border-active)]'
                    }`}
                  >
                    <span className="flex items-center gap-1 text-[11px] font-semibold">
                      {opt.label}
                      {isLocked8k && <Lock className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />}
                    </span>
                    <span
                      className={`max-w-full break-words text-[10px] leading-snug ${
                        active ? 'text-[var(--ink-on-accent)]/85' : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {opt.badge ? `${opt.sub} · ${opt.badge}` : opt.sub}
                    </span>
                  </button>
                );
              })}
            </div>

            {!deviceProfile.allow8KPhotoExport && (
              <p
                data-testid="guard-8k-note"
                className="text-[11px] leading-relaxed text-[var(--text-muted)]"
              >
                8K hanya aktif di Laptop/Desktop agar memori HP tetap aman.
              </p>
            )}

            {hasHighTarget && (
              <p
                data-testid="upscale-preview-note"
                className="glass-inner-rim rounded-xl border px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]"
              >
                Pratinjau tetap ringan agar geser halus; hasil {imageEdit.targetResolution.toUpperCase()} penuh dirender saat unduh.
              </p>
            )}
          </section>

          {/* Noise & Sharpening */}
          <section className="glass-frosted-card space-y-4 rounded-[22px] border p-4">
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
          <section className="glass-frosted-card min-w-0 max-w-full space-y-4 overflow-hidden rounded-[22px] border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2.5">
              <div className="min-w-0 flex-1">
                <h3 className="text-xs font-semibold leading-snug text-[var(--text-primary)]">
                  Filter Warna (12 Tampilan)
                </h3>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
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
                className="glass-inner-rim inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] select-none"
              >
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Tahan: Asli</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
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
                    className={`group flex min-w-0 max-w-full flex-col overflow-hidden rounded-xl border text-left transition-all duration-150 hover:-translate-y-0.5 ${
                      active
                        ? 'glass-inner-rim border-[var(--border-active)] [background-image:var(--accent-wash-gradient)] ring-1 ring-[var(--border-active)]'
                        : 'glass-inner-rim hover:border-[var(--border-active)]'
                    }`}
                  >
                    <div className="relative h-14 w-full overflow-hidden bg-[var(--bg-subtle)]">
                      {baseThumbnailUrl ? (
                        <img
                          src={baseThumbnailUrl}
                          alt={look.title}
                          style={{ filter: cssFilter === 'none' ? undefined : cssFilter }}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div
                          style={{ background: look.swatchGradient }}
                          className="flex h-full w-full items-center justify-center text-[9px] font-semibold text-white/95"
                        >
                          {look.badge}
                        </div>
                      )}
                      {active && (
                        <span
                          aria-hidden="true"
                          className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--ink-on-accent)] shadow"
                        >
                          <Check className="h-2.5 w-2.5" />
                        </span>
                      )}
                      <span
                        aria-hidden="true"
                        style={{ background: look.swatchGradient }}
                        className="absolute inset-x-0 bottom-0 h-1 opacity-90"
                      />
                    </div>
                    <div className="w-full min-w-0 px-2.5 py-2">
                      <span className="block truncate text-[11px] font-semibold text-[var(--text-primary)]">
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
        <div key="photo-tab-edit" className="km-tab-enter flex min-w-0 max-w-full flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant={isCropping ? 'primary' : 'secondary'}
              size="md"
              data-testid="open-crop-btn"
              onClick={onToggleCrop}
              className="min-h-[44px] min-w-0 max-w-full overflow-hidden text-xs"
            >
              <Crop className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{isCropping ? 'Tutup Potong' : 'Potong / Crop'}</span>
            </Button>
            <Button
              variant="secondary"
              size="md"
              data-testid="rotate-90-btn"
              onClick={onRotate90}
              className="min-h-[44px] min-w-0 max-w-full overflow-hidden text-xs"
            >
              <RotateCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                Putar 90°{imageEdit.rotationDeg > 0 ? ` (${imageEdit.rotationDeg}°)` : ''}
              </span>
            </Button>
            <Button
              variant={imageEdit.flipH ? 'primary' : 'secondary'}
              size="md"
              data-testid="flip-h-btn"
              onClick={onFlipH}
              className="min-h-[44px] min-w-0 max-w-full overflow-hidden text-xs"
            >
              <FlipHorizontal2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Balik H</span>
            </Button>
            <Button
              variant={imageEdit.flipV ? 'primary' : 'secondary'}
              size="md"
              data-testid="flip-v-btn"
              onClick={onFlipV}
              className="min-h-[44px] min-w-0 max-w-full overflow-hidden text-xs"
            >
              <FlipVertical2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Balik V</span>
            </Button>
          </div>

          <div className="glass-frosted-card min-w-0 max-w-full overflow-hidden rounded-[22px] border p-4">
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
          <div className="glass-frosted-card rounded-[22px] border p-4">
            <button
              type="button"
              data-testid="drawer-light-detail-btn"
              aria-expanded={lightDrawerOpen}
              onClick={() => setLightDrawerOpen((v) => !v)}
              className="flex min-h-[36px] w-full items-center justify-between text-xs font-semibold text-[var(--text-primary)]"
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
              className={`km-accordion-grid ${lightDrawerOpen ? 'mt-3.5 border-t border-[var(--border-hairline)] pt-3.5' : ''}`}
              data-open={lightDrawerOpen ? 'true' : 'false'}
            >
              <div
                data-testid="drawer-light-detail"
                aria-hidden={!lightDrawerOpen}
                className={`km-accordion-inner space-y-3.5 ${lightDrawerOpen ? '' : 'pointer-events-none invisible'}`}
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
          <div className="glass-frosted-card rounded-[22px] border p-4">
            <button
              type="button"
              data-testid="drawer-color-btn"
              aria-expanded={colorDrawerOpen}
              onClick={() => setColorDrawerOpen((v) => !v)}
              className="flex min-h-[36px] w-full items-center justify-between text-xs font-semibold text-[var(--text-primary)]"
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
              className={`km-accordion-grid ${colorDrawerOpen ? 'mt-3.5 border-t border-[var(--border-hairline)] pt-3.5' : ''}`}
              data-open={colorDrawerOpen ? 'true' : 'false'}
            >
              <div
                data-testid="drawer-color"
                aria-hidden={!colorDrawerOpen}
                className={`km-accordion-inner space-y-3.5 ${colorDrawerOpen ? '' : 'pointer-events-none invisible'}`}
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
