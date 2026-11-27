import { useRef, useState, type PointerEvent } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { Button } from '../../design-system/components/Button';
import type { CropAspectId, NormalizedCropRect } from '../../engines/contracts';
import { computeCropPixels } from '../../engines/image/pixelOps';

export interface CropOverlayProps {
  imageUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  initialCrop: NormalizedCropRect | null;
  onApply: (crop: NormalizedCropRect | null) => void;
  onCancel: () => void;
}

const ASPECT_OPTIONS: ReadonlyArray<{ id: CropAspectId; label: string; ratio: number | null }> = [
  { id: 'free', label: 'Bebas', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
];

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

const MIN_NORM = 0.08;

function clampRect(rect: NormalizedCropRect): NormalizedCropRect {
  const w = Math.min(1, Math.max(MIN_NORM, rect.width));
  const h = Math.min(1, Math.max(MIN_NORM, rect.height));
  const x = Math.min(1 - w, Math.max(0, rect.x));
  const y = Math.min(1 - h, Math.max(0, rect.y));
  return { x, y, width: w, height: h };
}

function fitCenteredAspectRect(
  aspectRatio: number,
  srcWidth: number,
  srcHeight: number
): NormalizedCropRect {
  const imgAspect = srcWidth / srcHeight;
  let normW: number;
  let normH: number;
  if (aspectRatio > imgAspect) {
    normW = 0.88;
    normH = (normW * imgAspect) / aspectRatio;
  } else {
    normH = 0.88;
    normW = (normH * aspectRatio) / imgAspect;
  }
  return clampRect({
    x: (1 - normW) / 2,
    y: (1 - normH) / 2,
    width: normW,
    height: normH,
  });
}

export function CropOverlay({
  imageUrl,
  sourceWidth,
  sourceHeight,
  initialCrop,
  onApply,
  onCancel,
}: CropOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [aspectId, setAspectId] = useState<CropAspectId>('free');
  const [rect, setRect] = useState<NormalizedCropRect>(
    initialCrop ?? { x: 0.08, y: 0.08, width: 0.84, height: 0.84 }
  );

  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    startRect: NormalizedCropRect;
    boxWidth: number;
    boxHeight: number;
  } | null>(null);

  const activeRatio = ASPECT_OPTIONS.find((a) => a.id === aspectId)?.ratio ?? null;
  const pxDims = computeCropPixels(sourceWidth, sourceHeight, rect);

  const handleSelectAspect = (opt: (typeof ASPECT_OPTIONS)[number]) => {
    setAspectId(opt.id);
    if (opt.ratio !== null) {
      setRect(fitCenteredAspectRect(opt.ratio, sourceWidth, sourceHeight));
    }
  };

  const startDrag = (mode: DragMode) => (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const box = containerRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) {
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startRect: { ...rect },
      boxWidth: box.width,
      boxHeight: box.height,
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = (e.clientX - drag.startX) / drag.boxWidth;
    const dy = (e.clientY - drag.startY) / drag.boxHeight;
    const s = drag.startRect;

    if (drag.mode === 'move') {
      setRect(
        clampRect({
          x: s.x + dx,
          y: s.y + dy,
          width: s.width,
          height: s.height,
        })
      );
      return;
    }

    let left = s.x;
    let top = s.y;
    let right = s.x + s.width;
    let bottom = s.y + s.height;

    if (drag.mode === 'nw' || drag.mode === 'sw') {
      left = Math.min(right - MIN_NORM, Math.max(0, s.x + dx));
    }
    if (drag.mode === 'ne' || drag.mode === 'se') {
      right = Math.max(left + MIN_NORM, Math.min(1, s.x + s.width + dx));
    }
    if (drag.mode === 'nw' || drag.mode === 'ne') {
      top = Math.min(bottom - MIN_NORM, Math.max(0, s.y + dy));
    }
    if (drag.mode === 'sw' || drag.mode === 'se') {
      bottom = Math.max(top + MIN_NORM, Math.min(1, s.y + s.height + dy));
    }

    let nextW = right - left;
    let nextH = bottom - top;

    if (activeRatio !== null) {
      const imgAspect = sourceWidth / sourceHeight;
      const targetNormH = (nextW * imgAspect) / activeRatio;
      if (targetNormH <= 1 && targetNormH >= MIN_NORM) {
        nextH = targetNormH;
        if (drag.mode === 'nw' || drag.mode === 'ne') {
          top = Math.max(0, bottom - nextH);
        }
      } else {
        nextH = Math.min(1 - top, Math.max(MIN_NORM, nextH));
        nextW = Math.min(1 - left, (nextH * activeRatio) / imgAspect);
      }
    }

    setRect(clampRect({ x: left, y: top, width: nextW, height: nextH }));
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <div
      data-testid="crop-editor-view"
      className="flex w-full flex-col items-center gap-3"
    >
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {ASPECT_OPTIONS.map((opt) => {
          const active = aspectId === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              data-testid={`crop-aspect-${opt.id}`}
              onClick={() => handleSelectAspect(opt)}
              className={`min-h-[32px] rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                active
                  ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                  : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-active)]'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
        <span
          data-testid="crop-pixel-readout"
          className="ml-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)] tabular-nums"
        >
          {pxDims.sw} × {pxDims.sh} px
        </span>
      </div>

      <div
        ref={containerRef}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative inline-block max-h-[54vh] max-w-full select-none overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-black/80"
      >
        <img
          src={imageUrl}
          alt="Area potong foto"
          draggable={false}
          className="block max-h-[54vh] w-auto max-w-full opacity-55"
        />

        <div
          data-testid="crop-selection-box"
          onPointerDown={startDrag('move')}
          className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(10,20,24,0.52)]"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
          }}
        >
          <div className="pointer-events-none grid h-full w-full grid-cols-3 grid-rows-3 opacity-40">
            <div className="border-b border-r border-white" />
            <div className="border-b border-r border-white" />
            <div className="border-b border-white" />
            <div className="border-b border-r border-white" />
            <div className="border-b border-r border-white" />
            <div className="border-b border-white" />
            <div className="border-r border-white" />
            <div className="border-r border-white" />
            <div />
          </div>

          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
            const posClass =
              corner === 'nw'
                ? '-left-2 -top-2 cursor-nwse-resize'
                : corner === 'ne'
                  ? '-right-2 -top-2 cursor-nesw-resize'
                  : corner === 'sw'
                    ? '-bottom-2 -left-2 cursor-nesw-resize'
                    : '-bottom-2 -right-2 cursor-nwse-resize';
            return (
              <div
                key={corner}
                onPointerDown={startDrag(corner)}
                className={`absolute h-4 w-4 rounded-full border-2 border-[var(--accent-primary)] bg-white shadow ${posClass}`}
              />
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {initialCrop && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="crop-clear-btn"
            onClick={() => onApply(null)}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Hapus Potongan</span>
          </Button>
        )}
        <Button variant="secondary" size="sm" data-testid="crop-cancel-btn" onClick={onCancel}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Batal</span>
        </Button>
        <Button
          variant="primary"
          size="sm"
          data-testid="crop-apply-btn"
          onClick={() => onApply(rect)}
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Terapkan</span>
        </Button>
      </div>
    </div>
  );
}
