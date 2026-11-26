import { FolderOpen, Moon, Sun, X } from 'lucide-react';
import { Button } from '../../design-system/components/Button';
import type { AppTheme } from '../../shared/hooks/useTheme';

export interface WorkspaceHeaderProps {
  hasMedia: boolean;
  theme: AppTheme;
  onToggleTheme: () => void;
  onReplaceClick: () => void;
  onClearClick: () => void;
}

export function WorkspaceHeader({
  hasMedia,
  theme,
  onToggleTheme,
  onReplaceClick,
  onClearClick,
}: WorkspaceHeaderProps) {
  const isDark = theme === 'dark';

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)]/95 backdrop-blur-sm transition-colors">
      <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent-primary)"
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
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!hasMedia && (
            <span className="hidden text-xs text-[var(--text-muted)] sm:inline">
              Diproses langsung di perangkat
            </span>
          )}

          {hasMedia && (
            <>
              <Button
                variant="secondary"
                size="sm"
                data-testid="header-replace-btn"
                onClick={onReplaceClick}
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Ganti file</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                data-testid="header-clear-btn"
                onClick={onClearClick}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Tutup</span>
              </Button>
            </>
          )}

          <button
            type="button"
            data-testid="theme-toggle-btn"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Ganti ke tema Aquatic Terang' : 'Ganti ke tema Studio Gelap'}
            title={isDark ? 'Aquatic Terang' : 'Studio Gelap'}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-all hover:border-[var(--border-active)] hover:text-[var(--text-primary)] active:scale-[0.97]"
          >
            {isDark ? (
              <>
                <Sun className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden="true" />
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
