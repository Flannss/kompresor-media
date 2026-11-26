import { FolderOpen, X } from 'lucide-react';
import { Button } from '../../design-system/components/Button';

export interface WorkspaceHeaderProps {
  hasMedia: boolean;
  onReplaceClick: () => void;
  onClearClick: () => void;
}

export function WorkspaceHeader({
  hasMedia,
  onReplaceClick,
  onClearClick,
}: WorkspaceHeaderProps) {
  return (
    <header className="sticky top-0 z-20 h-14 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)]">
      <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#2B7387"
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
          {hasMedia ? (
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
                <span>Tutup</span>
              </Button>
            </>
          ) : (
            <span className="text-xs text-[var(--text-muted)]">
              Diproses langsung di perangkat
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
