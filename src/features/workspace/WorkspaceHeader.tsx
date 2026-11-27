import { FolderOpen, Moon, Plus, Sun, X } from 'lucide-react';
import { Button } from '../../design-system/components/Button';
import type { AppTheme } from '../../shared/hooks/useTheme';

export interface WorkspaceHeaderProps {
  hasMedia: boolean;
  canAddMore: boolean;
  itemCount: number;
  maxTotal: number;
  theme: AppTheme;
  onToggleTheme: () => void;
  onAddMoreClick: () => void;
  onReplaceClick: () => void;
  onClearClick: () => void;
}

export function WorkspaceHeader({
  hasMedia,
  canAddMore,
  itemCount,
  maxTotal,
  theme,
  onToggleTheme,
  onAddMoreClick,
  onReplaceClick,
  onClearClick,
}: WorkspaceHeaderProps) {
  const isDark = theme === 'dark';

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-[var(--border-hairline)] bg-[var(--surface-dock)] transition-colors">
      <div className="mx-auto flex h-full max-w-[1680px] items-center justify-between gap-2 px-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#2078CF"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="shrink-0"
          >
            <path d="M4 8V6a2 2 0 0 1 2-2h2" />
            <path d="M16 4h2a2 2 0 0 1 2 2v2" />
            <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
            <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span className="truncate text-sm font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
            Kompresor Media
          </span>
          {hasMedia && itemCount > 1 && (
            <span className="hidden rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] tabular-nums sm:inline-block">
              {itemCount}/{maxTotal} file
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {!hasMedia && (
            <span className="hidden text-xs text-[var(--text-muted)] sm:inline">
              Diproses langsung di perangkat Anda
            </span>
          )}

          {hasMedia && (
            <>
              {canAddMore && (
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="header-add-btn"
                  onClick={onAddMoreClick}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Tambah file</span>
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                data-testid="header-replace-btn"
                onClick={onReplaceClick}
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Ganti</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                data-testid="header-clear-btn"
                onClick={onClearClick}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden md:inline">Tutup</span>
              </Button>
            </>
          )}

          <button
            type="button"
            data-testid="theme-toggle-btn"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Ganti ke tema Cobalt Terang' : 'Ganti ke tema Cobalt Gelap'}
            title={isDark ? 'Cobalt Terang' : 'Cobalt Gelap'}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-all hover:border-[var(--border-active)] hover:text-[var(--text-primary)] active:scale-[0.97]"
          >
            {isDark ? (
              <>
                <Sun className="h-3.5 w-3.5 text-[var(--accent-highlight)]" aria-hidden="true" />
                <span className="hidden sm:inline">Terang</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden="true" />
                <span className="hidden sm:inline">Gelap</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
