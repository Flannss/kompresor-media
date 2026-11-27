import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CopyCheck,
  Download,
  Film,
  Image as ImageIcon,
  Play,
  Plus,
  X,
} from 'lucide-react';
import type { QueueItem } from '../../store/useMediaStore';
import { formatBytes } from '../../shared/utils/formatBytes';

export interface QueuePanelProps {
  items: QueueItem[];
  activeItemId: string | null;
  maxTotal: number;
  batchRunning: boolean;
  batchCompleted: number;
  batchTotal: number;
  batchStatusLabel?: string | null;
  onSelectItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onDownloadItem: (id: string) => void;
  onAddMoreClick: () => void;
  onApplyToAll: () => void;
  onProcessAll: () => void;
}

function getStatusBadge(status: QueueItem['status']) {
  switch (status) {
    case 'done':
      return {
        label: 'Selesai',
        cls: 'bg-[var(--status-ok-bg)] text-[var(--status-ok-ink)] border-[var(--status-ok-border)]',
      };
    case 'processing':
      return {
        label: 'Memproses',
        cls: 'bg-[var(--bg-subtle)] text-[var(--accent-highlight)] border-[var(--border-active)]',
      };
    case 'cancelled':
      return {
        label: 'Batal',
        cls: 'bg-[var(--status-warn-bg)] text-[var(--status-warn-ink)] border-[var(--status-warn-border)]',
      };
    case 'error':
      return {
        label: 'Gagal',
        cls: 'bg-[var(--status-err-bg)] text-[var(--status-err-ink)] border-[var(--status-err-border)]',
      };
    default:
      return {
        label: 'Siap',
        cls: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-hairline)]',
      };
  }
}

export function QueuePanel({
  items,
  activeItemId,
  maxTotal,
  batchRunning,
  batchCompleted,
  batchTotal,
  batchStatusLabel = null,
  onSelectItem,
  onRemoveItem,
  onDownloadItem,
  onAddMoreClick,
  onApplyToAll,
  onProcessAll,
}: QueuePanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (items.length < 2) {
    return null;
  }

  const canAddMore = items.length < maxTotal;
  const activeItem = items.find((i) => i.id === activeItemId);
  const sameKindCount = activeItem
    ? items.filter((i) => i.metadata.kind === activeItem.metadata.kind).length
    : 0;

  return (
    <>
      {/* Tablet / Mobile Horizontal Scrollable Queue Strip */}
      <div
        data-testid="queue-strip-mobile"
        className="flex flex-col gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2.5 lg:hidden"
      >
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-[var(--text-primary)] tabular-nums">
            {batchRunning && batchStatusLabel ? batchStatusLabel : `Antrean (${items.length}/${maxTotal})`}
          </span>
          <div className="flex items-center gap-1.5">
            {sameKindCount >= 2 && (
              <button
                type="button"
                data-testid="queue-apply-all-mobile"
                onClick={onApplyToAll}
                className="inline-flex min-h-[34px] items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-[11px] font-medium text-[var(--text-secondary)] hover:border-[var(--border-active)] hover:text-[var(--text-primary)]"
              >
                <CopyCheck className="h-3 w-3" aria-hidden="true" />
                <span>Samakan</span>
              </button>
            )}
            <button
              type="button"
              disabled={batchRunning}
              onClick={onProcessAll}
              className="inline-flex min-h-[34px] items-center gap-1 rounded-full bg-[var(--accent-primary)] px-3 text-[11px] font-semibold text-[var(--ink-on-accent)] disabled:opacity-50"
            >
              <Play className="h-3 w-3" aria-hidden="true" />
              <span>{batchRunning ? `${batchCompleted}/${batchTotal}` : `Proses Semua`}</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {items.map((item) => {
            const active = item.id === activeItemId;
            const badge = getStatusBadge(item.status);
            const isImg = item.metadata.kind === 'image';
            const thumbSrc = isImg ? (item.baseThumbnailUrl ?? item.objectUrl) : null;
            return (
              <div
                key={item.id}
                className={`flex shrink-0 items-center gap-2 rounded-2xl border p-1.5 transition-colors ${
                  active
                    ? 'border-[var(--border-active)] bg-[var(--bg-subtle)]'
                    : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)]'
                }`}
              >
                <button
                  type="button"
                  data-testid={`queue-item-mobile-${item.id}`}
                  onClick={() => onSelectItem(item.id)}
                  className="flex min-h-[36px] items-center gap-2 text-left"
                >
                  <div className="h-9 w-9 shrink-0 overflow-hidden rounded-xl bg-[var(--bg-app)]">
                    {isImg && thumbSrc ? (
                      <img
                        src={thumbSrc}
                        alt={item.file.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[var(--accent-terracotta)]">
                        <Film className="h-4 w-4" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                  <div className="max-w-[118px]">
                    <div className="truncate text-[11px] font-medium text-[var(--text-primary)]">
                      {item.file.name}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1">
                      <span
                        className={`inline-block rounded-full border px-1.5 py-0.2 text-[9px] font-semibold ${
                          isImg
                            ? 'border-[var(--status-ok-border)] bg-[var(--accent-olive-soft)] text-[var(--accent-olive)]'
                            : 'border-[var(--status-err-border)] bg-[var(--accent-terracotta-soft)] text-[var(--accent-terracotta)]'
                        }`}
                      >
                        {isImg ? 'Foto' : 'Video'}
                      </span>
                      <span
                        className={`inline-block rounded border px-1 py-0.2 text-[9px] font-semibold ${badge.cls}`}
                      >
                        {item.status === 'processing' ? `${item.progress}%` : badge.label}
                      </span>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveItem(item.id)}
                  aria-label={`Hapus ${item.file.name}`}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            );
          })}

          {canAddMore && (
            <button
              type="button"
              onClick={onAddMoreClick}
              aria-label="Tambah file ke antrean"
              className="flex h-12 shrink-0 items-center gap-1 rounded-2xl border border-dashed border-[var(--border-hairline)] px-3 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-active)] hover:text-[var(--text-primary)]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tambah</span>
            </button>
          )}
        </div>
      </div>

      {/* Desktop Left Vertical Queue Rail */}
      <aside
        data-testid="queue-rail-desktop"
        className={`km-glass hidden shrink-0 flex-col border-r transition-all lg:flex ${
          collapsed ? 'w-[54px]' : 'w-[222px]'
        }`}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-3 py-3">
          {!collapsed && (
            <div className="min-w-0">
              <h2 className="text-xs font-semibold text-[var(--text-primary)]">Antrean File</h2>
              <p className="truncate text-[11px] text-[var(--text-muted)] tabular-nums">
                {batchRunning && batchStatusLabel
                  ? batchStatusLabel
                  : `${items.length} / ${maxTotal} kapasitas`}
              </p>
            </div>
          )}
          <button
            type="button"
            data-testid="toggle-queue-rail-btn"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Buka panel antrean' : 'Ciutkan panel antrean'}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-active)] hover:text-[var(--text-primary)]"
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>

        {!collapsed && (
          <>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2.5">
              {items.map((item) => {
                const active = item.id === activeItemId;
                const badge = getStatusBadge(item.status);
                const isImg = item.metadata.kind === 'image';
                const thumbSrc = isImg ? (item.baseThumbnailUrl ?? item.objectUrl) : null;
                const readyOutputName =
                  item.imageResult?.outputFileName ?? item.videoResult?.outputFileName ?? null;
                const outputBytes =
                  item.imageResult?.outputBytes ?? item.videoResult?.outputBytes ?? null;

                return (
                  <div
                    key={item.id}
                    data-testid={`queue-card-${item.id}`}
                    className={`group rounded-2xl border p-2 transition-colors ${
                      active
                        ? 'border-[var(--border-active)] bg-[var(--bg-subtle)]'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:border-[var(--border-active)]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectItem(item.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-app)]">
                          {isImg && thumbSrc ? (
                            <img
                              src={thumbSrc}
                              alt={item.file.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[var(--accent-terracotta)]">
                              <Film className="h-4 w-4" aria-hidden="true" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            {isImg ? (
                              <ImageIcon className="h-3 w-3 shrink-0 text-[var(--accent-olive)]" aria-hidden="true" />
                            ) : (
                              <Film className="h-3 w-3 shrink-0 text-[var(--accent-terracotta)]" aria-hidden="true" />
                            )}
                            <span
                              className="truncate text-[11px] font-semibold text-[var(--text-primary)]"
                              title={item.file.name}
                            >
                              {item.file.name}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[10px] text-[var(--text-muted)] tabular-nums">
                            {formatBytes(item.metadata.sizeBytes)}
                            {!item.needsFullResExport && outputBytes ? ` → ${formatBytes(outputBytes)}` : ''}
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        data-testid={`queue-remove-${item.id}`}
                        onClick={() => onRemoveItem(item.id)}
                        aria-label={`Hapus ${item.file.name}`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1">
                        <span
                          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9.5px] font-semibold ${
                            isImg
                              ? 'border-[var(--status-ok-border)] bg-[var(--accent-olive-soft)] text-[var(--accent-olive)]'
                              : 'border-[var(--status-err-border)] bg-[var(--accent-terracotta-soft)] text-[var(--accent-terracotta)]'
                          }`}
                        >
                          {isImg ? 'Foto' : 'Video'}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${badge.cls}`}
                        >
                          {item.status === 'processing' ? `${item.progress}%` : badge.label}
                        </span>
                      </div>

                      {item.outputUrl && readyOutputName && (
                        <button
                          type="button"
                          data-testid={`queue-dl-${item.id}`}
                          onClick={() => onDownloadItem(item.id)}
                          aria-label={`Unduh ${readyOutputName}`}
                          className="inline-flex h-6 items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2 text-[10px] font-medium text-[var(--text-primary)] hover:border-[var(--border-active)]"
                          title={`Simpan ${readyOutputName}`}
                        >
                          <Download className="h-2.5 w-2.5" aria-hidden="true" />
                          <span>Simpan</span>
                        </button>
                      )}
                    </div>

                    {item.status === 'processing' && (
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--border-hairline)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent-highlight)] transition-all"
                          style={{ width: `${Math.max(8, item.progress)}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-1.5 border-t border-[var(--border-hairline)] p-2.5">
              {canAddMore && (
                <button
                  type="button"
                  data-testid="queue-add-more-btn"
                  onClick={onAddMoreClick}
                  className="inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-full border border-dashed border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-active)] hover:text-[var(--text-primary)]"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Tambah file</span>
                </button>
              )}

              {sameKindCount >= 2 && (
                <button
                  type="button"
                  data-testid="queue-apply-all-btn"
                  onClick={onApplyToAll}
                  className="inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-active)]"
                >
                  <CopyCheck className="h-3.5 w-3.5 text-[var(--accent-highlight)]" aria-hidden="true" />
                  <span>Terapkan ke Semua</span>
                </button>
              )}

              <button
                type="button"
                data-testid="queue-process-all-btn"
                disabled={batchRunning}
                onClick={onProcessAll}
                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-full bg-[var(--accent-primary)] px-3 text-xs font-semibold text-[var(--ink-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-55 tabular-nums"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {batchRunning
                    ? `Memproses (${batchCompleted}/${batchTotal})`
                    : `Proses Semua (${items.length})`}
                </span>
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
