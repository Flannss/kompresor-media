import { useState } from 'react';
import { Columns2 } from 'lucide-react';
import type { ImageRotation } from '../../engines/contracts';

export interface BeforeAfterPreviewProps {
  originalUrl: string;
  processedUrl: string | null;
  fileName: string;
  rotationDeg: ImageRotation;
}

export function BeforeAfterPreview({
  originalUrl,
  processedUrl,
  fileName,
  rotationDeg,
}: BeforeAfterPreviewProps) {
  const [compareMode, setCompareMode] = useState(false);
  const [splitPct, setSplitPct] = useState(50);
  const [showOriginalOnly, setShowOriginalOnly] = useState(false);

  const canSplitOverlay = processedUrl !== null && rotationDeg === 0;
  const displayUrl =
    showOriginalOnly || !processedUrl ? originalUrl : processedUrl;

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="relative flex max-h-[62vh] max-w-full items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
        {compareMode && canSplitOverlay ? (
          <div className="relative select-none" data-testid="compare-split-stage">
            <img
              data-testid="preview-image"
              src={processedUrl}
              alt={`${fileName} (Hasil)`}
              className="block max-h-[62vh] w-auto max-w-full object-contain"
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
            />
            <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-md bg-[#1b3742]/80 px-2 py-0.5 text-[11px] font-medium text-white">
              Asli
            </span>
            <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-md bg-[#2b7387]/90 px-2 py-0.5 text-[11px] font-medium text-white">
              Hasil
            </span>
          </div>
        ) : (
          <img
            data-testid="preview-image"
            src={displayUrl}
            alt={fileName}
            className="block max-h-[62vh] w-auto max-w-full object-contain"
          />
        )}
      </div>

      {processedUrl && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {canSplitOverlay ? (
            <>
              <button
                type="button"
                data-testid="compare-toggle-btn"
                aria-pressed={compareMode}
                onClick={() => setCompareMode((v) => !v)}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
                  compareMode
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white'
                    : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-active)]'
                }`}
              >
                <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{compareMode ? 'Tutup Perbandingan' : 'Bandingkan: Asli | Hasil'}</span>
              </button>

              {compareMode && (
                <label className="flex items-center gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] tabular-nums">
                  <span>Geser</span>
                  <input
                    data-testid="compare-slider"
                    type="range"
                    min={5}
                    max={95}
                    value={splitPct}
                    onChange={(e) => setSplitPct(Number(e.target.value))}
                    aria-label="Geser pembanding foto asli dan hasil"
                    className="h-1.5 w-28 accent-[var(--accent-primary)]"
                  />
                  <span>{splitPct}%</span>
                </label>
              )}
            </>
          ) : (
            <div className="inline-flex rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-0.5 text-xs">
              <button
                type="button"
                data-testid="view-original-btn"
                onClick={() => setShowOriginalOnly(true)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  showOriginalOnly
                    ? 'bg-[var(--accent-primary)] text-white'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                Asli
              </button>
              <button
                type="button"
                data-testid="view-result-btn"
                onClick={() => setShowOriginalOnly(false)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  !showOriginalOnly
                    ? 'bg-[var(--accent-primary)] text-white'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                Hasil
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
