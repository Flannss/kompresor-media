import { useRef, type PointerEvent } from 'react';

export type StageBackdrop = 'studio' | 'light' | 'dark' | 'checker';
export type PhotoCompareViewMode = 'single' | 'split' | 'side-by-side';
export type PhotoZoomLevel = 'fit' | '100' | '200';

const ZOOM_SCALE: Record<PhotoZoomLevel, number> = {
  fit: 1,
  '100': 1.65,
  '200': 2.4,
};

export interface BeforeAfterPreviewProps {
  originalUrl: string;
  processedUrl: string | null;
  fileName: string;
  canSplitCompare: boolean;
  viewMode: PhotoCompareViewMode;
  zoomLevel?: PhotoZoomLevel;
  splitPct: number;
  onSplitPctChange: (pct: number) => void;
  showOriginalOnly: boolean;
  backdrop: StageBackdrop;
}

export function getBackdropClasses(backdrop: StageBackdrop): string {
  if (backdrop === 'checker') {
    return 'bg-checkerboard';
  }
  if (backdrop === 'dark') {
    return 'bg-[#2A1E17]';
  }
  if (backdrop === 'light') {
    return 'bg-[#FFF9F0]';
  }
  return 'bg-[var(--bg-stage-media)]';
}

export function BeforeAfterPreview({
  originalUrl,
  processedUrl,
  fileName,
  canSplitCompare,
  viewMode,
  zoomLevel = 'fit',
  splitPct,
  onSplitPctChange,
  showOriginalOnly,
  backdrop,
}: BeforeAfterPreviewProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const draggingSplitRef = useRef(false);

  const displayUrl = showOriginalOnly || !processedUrl ? originalUrl : processedUrl;
  const isSplitActive = viewMode === 'split' && canSplitCompare && processedUrl !== null;
  const isSideBySideActive = viewMode === 'side-by-side' && processedUrl !== null;
  const zoomScale = ZOOM_SCALE[zoomLevel] ?? 1;
  const zoomStyle =
    zoomScale > 1
      ? { transform: `scale(${zoomScale})`, transformOrigin: 'center center' as const }
      : undefined;

  const updateSplitFromClientX = (clientX: number) => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = Math.round(((clientX - rect.left) / rect.width) * 100);
    onSplitPctChange(Math.min(95, Math.max(5, pct)));
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!isSplitActive) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingSplitRef.current = true;
    updateSplitFromClientX(e.clientX);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingSplitRef.current) return;
    updateSplitFromClientX(e.clientX);
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingSplitRef.current) return;
    draggingSplitRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div className="flex w-full min-w-0 flex-col items-center gap-2.5">
      <div
        data-testid="photo-stage-frame"
        data-zoom={zoomLevel}
        className={`relative flex max-h-[58vh] w-full max-w-[820px] items-center justify-center overflow-hidden rounded-2xl border border-[var(--glass-border)] transition-colors ${getBackdropClasses(backdrop)} ${
          isSideBySideActive ? 'p-2.5' : ''
        }`}
        style={{ boxShadow: 'var(--stage-shadow)' }}
      >
        {isSideBySideActive ? (
          <div
            data-testid="photo-side-by-side-stage"
            className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <div className="relative flex items-center justify-center overflow-hidden rounded-xl bg-black/5">
              <img
                data-testid="photo-sbs-original"
                src={originalUrl}
                alt={`${fileName} (Asli)`}
                style={zoomStyle}
                className="block max-h-[42vh] w-full object-contain transition-transform duration-200 sm:max-h-[52vh]"
                draggable={false}
              />
              <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-md bg-[var(--surface-badge)] px-2 py-0.5 text-[11px] font-medium text-white">
                Asli
              </span>
            </div>

            <div className="relative flex items-center justify-center overflow-hidden rounded-xl bg-black/5">
              <img
                data-testid="preview-image"
                src={showOriginalOnly ? originalUrl : processedUrl}
                alt={`${fileName} (Hasil)`}
                style={zoomStyle}
                className="block max-h-[42vh] w-full object-contain transition-transform duration-200 sm:max-h-[52vh]"
                draggable={false}
              />
              <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-md bg-[var(--accent-primary)] px-2 py-0.5 text-[11px] font-medium text-white">
                {showOriginalOnly ? 'Asli' : 'Hasil'}
              </span>
            </div>
          </div>
        ) : isSplitActive ? (
          <div
            ref={stageRef}
            data-testid="compare-split-stage"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={zoomStyle}
            className="relative cursor-ew-resize touch-none select-none transition-transform duration-200"
          >
            <img
              data-testid="preview-image"
              src={processedUrl}
              alt={`${fileName} (Hasil)`}
              className="block max-h-[58vh] w-auto max-w-full object-contain"
              draggable={false}
            />
            <img
              src={originalUrl}
              alt={`${fileName} (Asli)`}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
              draggable={false}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow"
              style={{ left: `${splitPct}%` }}
            >
              <div className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--surface-dock)] text-[10px] font-bold text-[var(--text-primary)] shadow">
                ↔
              </div>
            </div>
            <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-md bg-[var(--surface-badge)] px-2 py-0.5 text-[11px] font-medium text-white">
              Asli
            </span>
            <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-md bg-[var(--accent-primary)] px-2 py-0.5 text-[11px] font-medium text-white">
              Hasil
            </span>
          </div>
        ) : (
          <div className="relative overflow-hidden">
            <img
              data-testid="preview-image"
              src={displayUrl}
              alt={fileName}
              style={zoomStyle}
              className="block max-h-[58vh] w-auto max-w-full object-contain transition-transform duration-200"
            />
            {processedUrl && (
              <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-md bg-[var(--surface-badge)] px-2 py-0.5 text-[11px] font-medium text-white">
                {showOriginalOnly ? 'Asli' : 'Hasil'}
              </span>
            )}
          </div>
        )}
      </div>

      {isSplitActive && (
        <label className="flex items-center gap-2 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-dock)] px-3.5 py-1 text-xs text-[var(--text-secondary)] tabular-nums">
          <span>Geser belah</span>
          <input
            data-testid="compare-slider"
            type="range"
            min={5}
            max={95}
            value={splitPct}
            onChange={(e) => onSplitPctChange(Number(e.target.value))}
            aria-label="Geser pembanding foto asli dan hasil"
            className="km-range-input w-28"
            style={{
              background: `linear-gradient(to right, var(--accent-primary) ${((splitPct - 5) / 90) * 100}%, var(--border-hairline) ${((splitPct - 5) / 90) * 100}%)`,
            }}
          />
          <span className="w-8 text-right font-semibold text-[var(--text-primary)]">{splitPct}%</span>
        </label>
      )}
    </div>
  );
}
