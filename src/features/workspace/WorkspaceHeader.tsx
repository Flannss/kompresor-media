import { FolderOpen, ShieldCheck, X } from 'lucide-react';
import { Badge } from '../../design-system/components/Badge';
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
    <header className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[var(--surface-card)]">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent-primary)] text-xs font-bold text-[var(--ink-on-accent)]">
            KM
          </span>
          <span className="truncate text-sm font-semibold tracking-tight text-[var(--ink-primary)]">
            KOMPRESOR MEDIA
          </span>
          <Badge tone="ok" className="hidden sm:inline-flex">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            100% Local
          </Badge>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {hasMedia && (
            <>
              <Button
                variant="secondary"
                size="sm"
                data-testid="header-replace-btn"
                onClick={onReplaceClick}
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Replace file</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                data-testid="header-clear-btn"
                onClick={onClearClick}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Clear</span>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
