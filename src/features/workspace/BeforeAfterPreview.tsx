import { useRef, type PointerEvent } from 'react';

export type StageBackdrop = 'light' | 'dark' | 'checker';

export interface BeforeAfterPreviewProps {
  originalUrl: string;
  processedUrl: string | null;
  fileName: string;
  canSplitCompare: boolean;
  compareMode: boolean;
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
    return 'bg-[#0A1114]';
  }
  return 'bg-[#FFFFFF]';
}

export function BeforeAfterPreview({
  originalUrl,
  processedUrl,
  fileName,
  canSplitCompare,
  compareMode,
  splitPct,
  onSplitPctChange,
  showOriginalOnly,
  backdrop,
}: BeforeAfterPreviewProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const draggingSplitRef = useRef(false);

  const displayUrl = showOriginalOnly || !processedUrl ? originalUrl : processedUrl;
  const isSplitActive = compareMode && canSplitCompare && processedUrl !== null;

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
    <div className="flex w-full flex-col items-center gap-2.5">
      <div
        className={`relative flex max-h-[58vh] max-w-full items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-hairline)] transition-colors ${getBackdropClasses(backdrop)}`}
        style={{ boxShadow: 'var(--stage-shadow)' }}
      >
        {isSplitActive ? (
          <div
            ref={stageRef}
            data-testid="compare-split-stage"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="relative cursor-ew-resize touch-none select-none"
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
              <div className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[10px] font-bold text-[var(--text-primary)] shadow">
                ↔
              </div>
            </div>
            <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-md bg-[#16303a]/85 px-2 py-0.5 text-[11px] font-medium text-white">
              Asli
            </span>
            <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-md bg-[#21697d]/90 px-2 py-0.5 text-[11px] font-medium text-white">
              Hasil
            </span>
          </div>
        ) : (
          <div className="relative">
            <img
              data-testid="preview-image"
              src={displayUrl}
              alt={fileName}
              className="block max-h-[58vh] w-auto max-w-full object-contain"
            />
            {processedUrl && (
              <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-xs">
                {showOriginalOnly ? 'Asli' : 'Hasil'}
              </span>
            )}
          </div>
        )}
      </div>

      {isSplitActive && (
        <label className="flex items-center gap-2 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-1 text-xs text-[var(--text-secondary)] tabular-nums">
          <span>Geser pembanding</span>
          <input
            data-testid="compare-slider"
            type="range"
            min={5}
            max={95}
            value={splitPct}
            onChange={(e) => onSplitPctChange(Number(e.target.value))}
            aria-label="Geser pembanding foto asli dan hasil"
            className="km-range-input w-28"
          />
          <span className="w-8 text-right font-semibold text-[var(--text-primary)]">{splitPct}%</span>
        </label>
      )}
    </div>
  );
}
