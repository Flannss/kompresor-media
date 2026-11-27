import { FolderOpen, Moon, Plus, Sun, X } from 'lucide-react';
import { Button } from '../../design-system/components/Button';
import type { MediaKind } from '../../engines/contracts';
import type { AppTheme } from '../../shared/hooks/useTheme';

export interface WorkspaceHeaderProps {
  hasMedia: boolean;
  activeMediaKind: MediaKind | null;
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
  activeMediaKind,
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
    <header className="km-glass-strong sticky top-0 z-30 h-[60px] border-b transition-colors">
      <div className="mx-auto flex h-full max-w-[1720px] items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent-gold)"
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

          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
              Kompresor Media
            </span>
            <span
              data-testid="brand-by-amdz"
              className="shrink-0 rounded-full border border-[var(--border-hairline)] bg-[var(--accent-gold-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-gold)]"
            >
              BY AMDZ
            </span>
          </div>

          {hasMedia && activeMediaKind && (
            <span
              data-testid="active-studio-badge"
              className={`hidden rounded-full border px-2.5 py-0.5 text-[11px] font-semibold sm:inline-block ${
                activeMediaKind === 'image'
                  ? 'border-[var(--status-ok-border)] bg-[var(--accent-olive-soft)] text-[var(--accent-olive)]'
                  : 'border-[var(--status-err-border)] bg-[var(--accent-terracotta-soft)] text-[var(--accent-terracotta)]'
              }`}
            >
              {activeMediaKind === 'image' ? 'Studio Foto' : 'Studio Video'}
            </span>
          )}

          {hasMedia && itemCount > 1 && (
            <span className="hidden rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] tabular-nums md:inline-block">
              {itemCount}/{maxTotal} file
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          {!hasMedia && (
            <span className="hidden text-xs text-[var(--text-muted)] md:inline">
              100% lokal di perangkat Anda
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
            aria-label={isDark ? 'Ganti ke tema Ivory Hangat' : 'Ganti ke tema Espresso Malam'}
            title={isDark ? 'Ivory Hangat' : 'Espresso Malam'}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 text-xs font-medium text-[var(--text-secondary)] shadow-[var(--glass-highlight)] transition-all duration-200 hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] active:scale-[0.97]"
          >
            {isDark ? (
              <>
                <Sun className="h-3.5 w-3.5 text-[var(--accent-gold)]" aria-hidden="true" />
                <span className="hidden sm:inline">Espresso Malam</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden="true" />
                <span className="hidden sm:inline">Ivory Hangat</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
