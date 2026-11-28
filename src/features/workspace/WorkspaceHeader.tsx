import { useState } from 'react';
import { FolderOpen, HelpCircle, Home, Moon, Plus, Sun } from 'lucide-react';
import { Button } from '../../design-system/components/Button';
import type { MediaKind } from '../../engines/contracts';
import type { AppTheme } from '../../shared/hooks/useTheme';
import { GuideModal } from './GuideModal';

export interface WorkspaceHeaderProps {
  hasMedia: boolean;
  activeMediaKind: MediaKind | null;
  canAddMore: boolean;
  itemCount: number;
  maxTotal: number;
  isVideoProcessing?: boolean;
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
  isVideoProcessing = false,
  theme,
  onToggleTheme,
  onAddMoreClick,
  onReplaceClick,
  onClearClick,
}: WorkspaceHeaderProps) {
  const isDark = theme === 'dark';
  const [guideOpen, setGuideOpen] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  const handleHomeClick = () => {
    if (isVideoProcessing) {
      setConfirmLeaveOpen(true);
      return;
    }
    onClearClick();
  };

  return (
    <>
      <header className="km-glass-dock sticky top-0 z-30 h-[54px] border-b transition-colors sm:h-[60px]">
        <div className="mx-auto flex h-full max-w-[1720px] items-center justify-between gap-2 px-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2.5">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-primary)"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0 sm:h-5 sm:w-5"
            >
              <path d="M4 8V6a2 2 0 0 1 2-2h2" />
              <path d="M16 4h2a2 2 0 0 1 2 2v2" />
              <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
              <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
              <circle cx="12" cy="12" r="3" />
            </svg>

            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
              <span className="truncate text-[13.5px] font-semibold tracking-[-0.02em] text-[var(--text-primary)] sm:text-[15px]">
                Kompresor Media
              </span>
              <span
                data-testid="brand-by-amdz"
                className="shrink-0 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)] sm:px-2 sm:text-[10px] sm:tracking-[0.16em]"
              >
                BY AMDZ
              </span>
            </div>

            {hasMedia && activeMediaKind && (
              <span
                data-testid="active-studio-badge"
                className={`hidden rounded-full border px-2.5 py-0.5 text-[11px] font-semibold sm:inline-block ${
                  activeMediaKind === 'image'
                    ? 'border-[var(--border-strong)] bg-[var(--bg-subtle)] text-[var(--text-primary)]'
                    : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
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

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
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
                    aria-label="Tambah file ke antrean"
                    className="h-9 w-9 px-0 sm:h-9 sm:w-auto sm:px-3"
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
                  aria-label="Ganti file aktif"
                  className="h-9 w-9 px-0 sm:h-9 sm:w-auto sm:px-3"
                >
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Ganti</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="header-clear-btn"
                  onClick={handleHomeClick}
                  aria-label="Kembali ke Beranda"
                  className="h-9 w-9 px-0 sm:h-9 sm:w-auto sm:px-3"
                >
                  <Home className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden md:inline">Beranda</span>
                </Button>
              </>
            )}

            <button
              type="button"
              data-testid="open-guide-btn"
              onClick={() => setGuideOpen(true)}
              aria-label="Buka panduan penggunaan"
              title="Panduan"
              className="inline-flex h-9 w-9 items-center justify-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-xs font-medium text-[var(--text-secondary)] shadow-[var(--glass-highlight)] transition-all duration-200 hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] active:scale-[0.97] sm:w-auto sm:px-3"
            >
              <HelpCircle className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
              <span className="hidden sm:inline">Panduan</span>
            </button>

            <button
              type="button"
              data-testid="theme-toggle-btn"
              onClick={onToggleTheme}
              aria-label={isDark ? 'Ganti ke tema Porselen Terang' : 'Ganti ke tema Slate Gelap'}
              title={isDark ? 'Porselen Terang' : 'Slate Gelap'}
              className="inline-flex h-9 w-9 items-center justify-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-xs font-medium text-[var(--text-secondary)] shadow-[var(--glass-highlight)] transition-all duration-200 hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] active:scale-[0.97] sm:w-auto sm:px-3"
            >
              {isDark ? (
                <>
                  <Moon className="h-3.5 w-3.5 text-[var(--text-primary)]" aria-hidden="true" />
                  <span className="hidden sm:inline">Slate Gelap</span>
                </>
              ) : (
                <>
                  <Sun className="h-3.5 w-3.5 text-[var(--text-primary)]" aria-hidden="true" />
                  <span className="hidden sm:inline">Porselen Terang</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <GuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />

      {confirmLeaveOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmLeaveOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            data-testid="confirm-leave-modal"
            className="km-glass-strong w-full max-w-sm rounded-[24px] border p-5 shadow-[var(--stage-shadow)]"
          >
            <h2 className="font-editorial text-base font-semibold text-[var(--text-primary)]">
              Hentikan pemrosesan video?
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
              Video sedang dirender. Kembali ke Beranda akan membatalkan proses saat ini dan
              mengosongkan antrean.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmLeaveOpen(false)}
              >
                Lanjut Proses
              </Button>
              <Button
                variant="danger"
                size="sm"
                data-testid="confirm-leave-ok-btn"
                onClick={() => {
                  setConfirmLeaveOpen(false);
                  onClearClick();
                }}
              >
                Ke Beranda
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
