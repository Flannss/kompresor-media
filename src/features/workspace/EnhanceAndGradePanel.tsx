import { useEffect, useState } from 'react';
import { Check, ChevronDown, Eye } from 'lucide-react';
import type {
  ColorGradeId,
  ColorGradeState,
  EnhanceRecipeId,
  EnhancementSuiteState,
  NoisePresetLevel,
} from '../../engines/contracts';
import {
  applyEnhanceRecipe,
  COLOR_GRADE_PRESETS,
  createDefaultColorGrade,
  createDefaultEnhanceSuite,
  getCssPreviewFilter,
  hasActiveEnhancements,
  NOISE_PRESET_VALUES,
} from '../../engines/shared/colorGrades';

export interface EnhanceAndGradePanelProps {
  mediaKind: 'image' | 'video';
  enhanceSuite: EnhancementSuiteState;
  colorGrade: ColorGradeState;
  baseThumbnailUrl: string | null;
  onRequestThumbnail?: () => void;
  holdOriginalActive: boolean;
  onHoldOriginalChange: (held: boolean) => void;
  onUpdateEnhanceSuite: (next: EnhancementSuiteState) => void;
  onUpdateColorGrade: (next: ColorGradeState, commitHistory?: boolean) => void;
  onSelectColorGrade: (gradeId: ColorGradeId) => void;
  onCommitSliderSnapshot?: () => void;
}

const ENHANCE_RECIPES: ReadonlyArray<{ id: EnhanceRecipeId; label: string }> = [
  { id: 'dark-footage', label: 'Rekaman Gelap' },
  { id: 'crisp-text', label: 'Objek & Teks Tajam' },
  { id: 'hd-balanced', label: 'HD Seimbang' },
];

const NOISE_LEVELS: ReadonlyArray<{ id: NoisePresetLevel; label: string }> = [
  { id: 'subtle', label: 'Halus' },
  { id: 'balanced', label: 'Seimbang' },
  { id: 'strong', label: 'Kuat' },
];

const NEUTRAL_TONE = { temperature: 0, tint: 0, shadows: 0, highlights: 0 };

function rangeTrackBg(value: number, min: number, max: number): string {
  const span = max - min;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((value - min) / span) * 100)) : 0;
  return `linear-gradient(to right, var(--accent-primary) ${pct}%, var(--border-hairline) ${pct}%)`;
}

export function EnhanceAndGradePanel({
  mediaKind,
  enhanceSuite,
  colorGrade,
  baseThumbnailUrl,
  onRequestThumbnail,
  holdOriginalActive,
  onHoldOriginalChange,
  onUpdateEnhanceSuite,
  onUpdateColorGrade,
  onSelectColorGrade,
  onCommitSliderSnapshot,
}: EnhanceAndGradePanelProps) {
  const [expandedCard, setExpandedCard] = useState<
    'noise' | 'sharpen' | 'colorContrast' | 'upscale1080' | null
  >(null);
  const [toneOpen, setToneOpen] = useState(false);

  useEffect(() => {
    if (!baseThumbnailUrl) {
      onRequestThumbnail?.();
    }
  }, [baseThumbnailUrl, onRequestThumbnail]);

  const enhanceActive = hasActiveEnhancements(enhanceSuite);

  const toggleCardEnabled = (key: 'noise' | 'sharpen' | 'colorContrast' | 'upscale1080') => {
    const nextEnabled = !enhanceSuite[key].enabled;
    const next: EnhancementSuiteState = {
      ...enhanceSuite,
      [key]: {
        ...enhanceSuite[key],
        enabled: nextEnabled,
      },
    };
    onUpdateEnhanceSuite(next);
    if (nextEnabled) {
      setExpandedCard(key);
    }
  };

  const hasNonZeroTone =
    colorGrade.tone.temperature !== 0 ||
    colorGrade.tone.tint !== 0 ||
    colorGrade.tone.shadows !== 0 ||
    colorGrade.tone.highlights !== 0;

  return (
    <div className="space-y-4">
      {/* SECTION 1: Penjernihan & Upscale 1080p HD */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">
            Penjernihan &amp; Upscale 1080p HD
          </h3>
          {enhanceActive && (
            <button
              type="button"
              data-testid="enhance-reset-all-btn"
              onClick={() => onUpdateEnhanceSuite(createDefaultEnhanceSuite())}
              className="text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Matikan Semua
            </button>
          )}
        </div>

        {/* Quick 1-tap recipes */}
        <div className="flex flex-wrap gap-2">
          {ENHANCE_RECIPES.map((rec) => (
            <button
              key={rec.id}
              type="button"
              data-testid={`enhance-recipe-${rec.id}`}
              onClick={() => onUpdateEnhanceSuite(applyEnhanceRecipe(rec.id, enhanceSuite))}
              className="min-h-[38px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] font-medium leading-tight text-[var(--text-secondary)] transition-colors hover:border-[var(--border-active)] hover:text-[var(--text-primary)]"
            >
              {rec.label}
            </button>
          ))}
        </div>

        {/* 4 Clean Expandable Module Cards */}
        <div className="space-y-2">
          {/* Card 1: Kurangi Noise */}
          <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setExpandedCard((prev) => (prev === 'noise' ? null : 'noise'))}
                className="flex min-h-[34px] flex-1 items-center gap-1.5 text-left text-xs font-semibold text-[var(--text-primary)]"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 text-[var(--text-muted)] transition-transform ${
                    expandedCard === 'noise' ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
                <span>Kurangi Noise</span>
              </button>
              <button
                type="button"
                role="switch"
                data-testid="enhance-noise-toggle"
                aria-checked={enhanceSuite.noise.enabled}
                onClick={() => toggleCardEnabled('noise')}
                className={`min-h-[30px] rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                  enhanceSuite.noise.enabled
                    ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                    : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                }`}
              >
                {enhanceSuite.noise.enabled ? 'Aktif' : 'Nonaktif'}
              </button>
            </div>

            {expandedCard === 'noise' && (
              <div className="mt-2.5 space-y-2.5 border-t border-[var(--border-hairline)] pt-2.5 text-xs">
                <div className="grid grid-cols-3 gap-2">
                  {NOISE_LEVELS.map((lv) => {
                    const active = enhanceSuite.noise.level === lv.id;
                    return (
                      <button
                        key={lv.id}
                        type="button"
                        data-testid={`noise-preset-${lv.id}`}
                        onClick={() =>
                          onUpdateEnhanceSuite({
                            ...enhanceSuite,
                            noise: {
                              ...enhanceSuite.noise,
                              enabled: true,
                              level: lv.id,
                              ...NOISE_PRESET_VALUES[lv.id],
                            },
                          })
                        }
                        className={`min-h-[36px] rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                          active
                            ? 'border-[var(--border-active)] bg-[var(--accent-deep)] text-white'
                            : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {lv.label}
                      </button>
                    );
                  })}
                </div>

                <label className="block space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[var(--text-secondary)]">Redam Bintik</span>
                    <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                      {enhanceSuite.noise.grainStrength}/10
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={enhanceSuite.noise.grainStrength}
                    onChange={(e) =>
                      onUpdateEnhanceSuite({
                        ...enhanceSuite,
                        noise: {
                          ...enhanceSuite.noise,
                          enabled: true,
                          grainStrength: Number(e.target.value),
                        },
                      })
                    }
                    onPointerUp={onCommitSliderSnapshot}
                    className="km-range-input w-full"
                    style={{ background: rangeTrackBg(enhanceSuite.noise.grainStrength, 1, 10) }}
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[var(--text-secondary)]">Haluskan Warna</span>
                    <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                      {enhanceSuite.noise.colorSmooth}/8
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={8}
                    value={enhanceSuite.noise.colorSmooth}
                    onChange={(e) =>
                      onUpdateEnhanceSuite({
                        ...enhanceSuite,
                        noise: {
                          ...enhanceSuite.noise,
                          enabled: true,
                          colorSmooth: Number(e.target.value),
                        },
                      })
                    }
                    onPointerUp={onCommitSliderSnapshot}
                    className="km-range-input w-full"
                    style={{ background: rangeTrackBg(enhanceSuite.noise.colorSmooth, 1, 8) }}
                  />
                </label>

                {mediaKind === 'video' && (
                  <label className="block space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--text-secondary)]">Jaga Gerakan</span>
                      <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                        {enhanceSuite.noise.motionStability}/10
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={enhanceSuite.noise.motionStability}
                      onChange={(e) =>
                        onUpdateEnhanceSuite({
                          ...enhanceSuite,
                          noise: {
                            ...enhanceSuite.noise,
                            enabled: true,
                            motionStability: Number(e.target.value),
                          },
                        })
                      }
                      className="km-range-input w-full"
                      style={{ background: rangeTrackBg(enhanceSuite.noise.motionStability, 1, 10) }}
                    />
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Card 2: Pertajam Detail */}
          <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setExpandedCard((prev) => (prev === 'sharpen' ? null : 'sharpen'))}
                className="flex min-h-[34px] flex-1 items-center gap-1.5 text-left text-xs font-semibold text-[var(--text-primary)]"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 text-[var(--text-muted)] transition-transform ${
                    expandedCard === 'sharpen' ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
                <span>Pertajam Detail</span>
              </button>
              <button
                type="button"
                role="switch"
                data-testid="enhance-sharpen-toggle"
                aria-checked={enhanceSuite.sharpen.enabled}
                onClick={() => toggleCardEnabled('sharpen')}
                className={`min-h-[30px] rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                  enhanceSuite.sharpen.enabled
                    ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                    : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                }`}
              >
                {enhanceSuite.sharpen.enabled ? 'Aktif' : 'Nonaktif'}
              </button>
            </div>

            {expandedCard === 'sharpen' && (
              <div className="mt-2.5 space-y-2.5 border-t border-[var(--border-hairline)] pt-2.5 text-xs">
                <label className="block space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[var(--text-secondary)]">Kekuatan Detail</span>
                    <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                      {Math.round(enhanceSuite.sharpen.strength * 50)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.2}
                    max={2.0}
                    step={0.05}
                    value={enhanceSuite.sharpen.strength}
                    onChange={(e) =>
                      onUpdateEnhanceSuite({
                        ...enhanceSuite,
                        sharpen: {
                          ...enhanceSuite.sharpen,
                          enabled: true,
                          strength: Number(e.target.value),
                        },
                      })
                    }
                    onPointerUp={onCommitSliderSnapshot}
                    style={{ background: rangeTrackBg(enhanceSuite.sharpen.strength, 0.2, 2.0) }}
                    className="km-range-input w-full"
                  />
                </label>

                <div className="space-y-1">
                  <span className="block text-[11px] text-[var(--text-secondary)]">
                    Radius Deteksi
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { size: 3, label: 'Halus' },
                        { size: 5, label: 'Standar' },
                        { size: 7, label: 'Lebar' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.size}
                        type="button"
                        onClick={() =>
                          onUpdateEnhanceSuite({
                            ...enhanceSuite,
                            sharpen: {
                              ...enhanceSuite.sharpen,
                              enabled: true,
                              kernelSize: opt.size,
                            },
                          })
                        }
                        className={`min-h-[38px] rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                          enhanceSuite.sharpen.kernelSize === opt.size
                            ? 'border-[var(--border-active)] bg-[var(--accent-deep)] text-white'
                            : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex min-h-[32px] cursor-pointer items-center justify-between text-[11px] text-[var(--text-secondary)]">
                  <span>Jaga Warna Alami</span>
                  <input
                    type="checkbox"
                    checked={enhanceSuite.sharpen.antiArtifact}
                    onChange={(e) =>
                      onUpdateEnhanceSuite({
                        ...enhanceSuite,
                        sharpen: {
                          ...enhanceSuite.sharpen,
                          enabled: true,
                          antiArtifact: e.target.checked,
                        },
                      })
                    }
                    className="h-4 w-4 accent-[var(--accent-primary)]"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Card 3: Perbaiki Warna & Kontras */}
          <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  setExpandedCard((prev) => (prev === 'colorContrast' ? null : 'colorContrast'))
                }
                className="flex min-h-[34px] flex-1 items-center gap-1.5 text-left text-xs font-semibold text-[var(--text-primary)]"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 text-[var(--text-muted)] transition-transform ${
                    expandedCard === 'colorContrast' ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
                <span>Perbaiki Warna &amp; Kontras</span>
              </button>
              <button
                type="button"
                role="switch"
                data-testid="enhance-color-toggle"
                aria-checked={enhanceSuite.colorContrast.enabled}
                onClick={() => toggleCardEnabled('colorContrast')}
                className={`min-h-[30px] rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                  enhanceSuite.colorContrast.enabled
                    ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                    : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                }`}
              >
                {enhanceSuite.colorContrast.enabled ? 'Aktif' : 'Nonaktif'}
              </button>
            </div>

            {expandedCard === 'colorContrast' && (
              <div className="mt-2.5 space-y-2 border-t border-[var(--border-hairline)] pt-2.5 text-xs">
                {(
                  [
                    { key: 'contrast', label: 'Kontras' },
                    { key: 'brightness', label: 'Kecerahan' },
                    { key: 'saturation', label: 'Saturasi' },
                    { key: 'shadowBright', label: 'Bayangan & Terang' },
                  ] as const
                ).map(({ key, label }) => {
                  const val = enhanceSuite.colorContrast[key];
                  return (
                    <label key={key} className="block space-y-0.5">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-[var(--text-secondary)]">{label}</span>
                        <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                          {val > 0 ? `+${val}` : val}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-50}
                        max={50}
                        value={val}
                        onChange={(e) =>
                          onUpdateEnhanceSuite({
                            ...enhanceSuite,
                            colorContrast: {
                              ...enhanceSuite.colorContrast,
                              enabled: true,
                              [key]: Number(e.target.value),
                            },
                          })
                        }
                        onPointerUp={onCommitSliderSnapshot}
                        style={{ background: rangeTrackBg(val, -50, 50) }}
                        className="km-range-input w-full"
                      />
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Card 4: Upscale ke 1080p HD */}
          <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  setExpandedCard((prev) => (prev === 'upscale1080' ? null : 'upscale1080'))
                }
                className="flex min-h-[34px] flex-1 items-center gap-1.5 text-left text-xs font-semibold text-[var(--text-primary)]"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 text-[var(--text-muted)] transition-transform ${
                    expandedCard === 'upscale1080' ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
                <span>Upscale ke 1080p HD</span>
              </button>
              <button
                type="button"
                role="switch"
                data-testid="enhance-upscale1080-toggle"
                aria-checked={enhanceSuite.upscale1080.enabled}
                onClick={() => toggleCardEnabled('upscale1080')}
                className={`min-h-[30px] rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                  enhanceSuite.upscale1080.enabled
                    ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                    : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                }`}
              >
                {enhanceSuite.upscale1080.enabled ? 'Aktif' : 'Nonaktif'}
              </button>
            </div>

            {expandedCard === 'upscale1080' && (
              <div className="mt-2.5 space-y-2 border-t border-[var(--border-hairline)] pt-2.5 text-xs">
                <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                  Meningkatkan ukuran ke 1920×1080 (mendatar) atau 1080×1920 (tegak) agar tampilan
                  tajam di layar besar.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: 'lanczos', label: 'Detail Maksimal' },
                      { id: 'bicubic', label: 'Halus Alami' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        onUpdateEnhanceSuite({
                          ...enhanceSuite,
                          upscale1080: {
                            ...enhanceSuite.upscale1080,
                            enabled: true,
                            method: opt.id,
                          },
                        })
                      }
                      className={`min-h-[38px] rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                        enhanceSuite.upscale1080.method === opt.id
                          ? 'border-[var(--border-active)] bg-[var(--accent-deep)] text-white'
                          : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <label className="flex min-h-[32px] cursor-pointer items-center justify-between text-[11px] text-[var(--text-secondary)]">
                  <span>Pertahankan Proporsi</span>
                  <input
                    type="checkbox"
                    checked={enhanceSuite.upscale1080.keepAspect}
                    onChange={(e) =>
                      onUpdateEnhanceSuite({
                        ...enhanceSuite,
                        upscale1080: {
                          ...enhanceSuite.upscale1080,
                          enabled: true,
                          keepAspect: e.target.checked,
                        },
                      })
                    }
                    className="h-4 w-4 accent-[var(--accent-primary)]"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* SECTION 2: Filter & Color Grading (Shared 96px thumbnail + instant CSS filters) */}
      <section className="space-y-2.5 border-t border-[var(--border-hairline)] pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">
            Filter &amp; Color Grading
          </h3>
          <button
            type="button"
            data-testid="grade-hold-original-btn"
            aria-pressed={holdOriginalActive}
            onPointerDown={() => onHoldOriginalChange(true)}
            onPointerUp={() => onHoldOriginalChange(false)}
            onPointerLeave={() => onHoldOriginalChange(false)}
            onPointerCancel={() => onHoldOriginalChange(false)}
            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] select-none"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Tahan: Asli</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {COLOR_GRADE_PRESETS.map((look) => {
            const active = colorGrade.gradeId === look.id;
            const cssFilter = getCssPreviewFilter({
              gradeId: look.id,
              intensity: 100,
              tone: NEUTRAL_TONE,
            });
            return (
              <button
                key={look.id}
                type="button"
                data-testid={`grade-preset-${look.id}`}
                aria-pressed={active}
                onClick={() => onSelectColorGrade(look.id)}
                title={look.description}
                className={`group flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-150 hover:-translate-y-0.5 ${
                  active
                    ? 'border-[var(--border-active)] bg-[var(--accent-deep)]/25 ring-1 ring-[var(--border-active)]'
                    : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:border-[var(--border-active)]'
                }`}
              >
                <div className="relative h-16 w-full overflow-hidden bg-[var(--bg-subtle)]">
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
                      className="flex h-full w-full items-end justify-start p-2 text-[10px] font-semibold text-white/95"
                    >
                      <span className="rounded bg-black/35 px-1.5 py-0.5">{look.badge}</span>
                    </div>
                  )}
                  <span className="absolute right-1.5 top-1.5 rounded-md bg-[var(--surface-badge)] px-1.5 py-0.5 text-[9px] font-semibold text-white">
                    {look.badge}
                  </span>
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--ink-on-accent)] shadow"
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                  <span
                    aria-hidden="true"
                    style={{ background: look.swatchGradient }}
                    className="absolute inset-x-0 bottom-0 h-1 opacity-90"
                  />
                </div>
                <div className="px-2 py-1.5">
                  <span className="block truncate text-[11px] font-semibold text-[var(--text-primary)]">
                    {look.title}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {colorGrade.gradeId !== 'original' && (
          <label className="block space-y-1 pt-1">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-[var(--text-secondary)]">Intensitas Filter</span>
              <span
                data-testid="grade-intensity-value"
                className="font-semibold text-[var(--text-primary)] tabular-nums"
              >
                {colorGrade.intensity}%
              </span>
            </div>
            <input
              type="range"
              data-testid="grade-intensity-slider"
              min={0}
              max={100}
              value={colorGrade.intensity}
              onChange={(e) =>
                onUpdateColorGrade(
                  {
                    ...colorGrade,
                    intensity: Number(e.target.value),
                  },
                  false
                )
              }
              onPointerUp={onCommitSliderSnapshot}
              className="km-range-input w-full"
              style={{ background: rangeTrackBg(colorGrade.intensity, 0, 100) }}
            />
          </label>
        )}

        <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-2.5">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              data-testid="tone-accordion-btn"
              onClick={() => setToneOpen((v) => !v)}
              className="flex min-h-[34px] flex-1 items-center gap-1.5 text-left text-xs font-semibold text-[var(--text-primary)]"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 text-[var(--text-muted)] transition-transform ${
                  toneOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
              <span>Sesuaikan Tone</span>
            </button>
            {hasNonZeroTone && (
              <button
                type="button"
                data-testid="reset-tone-btn"
                onClick={() =>
                  onUpdateColorGrade(
                    {
                      ...colorGrade,
                      tone: createDefaultColorGrade().tone,
                    },
                    true
                  )
                }
                className="text-[11px] font-medium text-[var(--accent-highlight)] hover:underline"
              >
                Reset
              </button>
            )}
          </div>

          {toneOpen && (
            <div className="mt-2.5 space-y-2 border-t border-[var(--border-hairline)] pt-2.5 text-xs">
              {(
                [
                  { key: 'temperature', label: 'Suhu Warna' },
                  { key: 'tint', label: 'Tint' },
                  { key: 'shadows', label: 'Bayangan' },
                  { key: 'highlights', label: 'Sorotan' },
                ] as const
              ).map(({ key, label }) => {
                const val = colorGrade.tone[key];
                return (
                  <label key={key} className="block space-y-0.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--text-secondary)]">{label}</span>
                      <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                        {val > 0 ? `+${val}` : val}
                      </span>
                    </div>
                    <input
                      type="range"
                      data-testid={`tone-slider-${key}`}
                      min={-50}
                      max={50}
                      value={val}
                      onChange={(e) =>
                        onUpdateColorGrade(
                          {
                            ...colorGrade,
                            tone: {
                              ...colorGrade.tone,
                              [key]: Number(e.target.value),
                            },
                          },
                          false
                        )
                      }
                      onPointerUp={onCommitSliderSnapshot}
                      className="km-range-input w-full"
                      style={{ background: rangeTrackBg(val, -50, 50) }}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
