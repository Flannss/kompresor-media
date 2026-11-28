import { useState } from 'react';
import { FolderOpen, HelpCircle, Home, Moon, Plus, Sun } from 'lucide-react';
import { Button } from '../../design-system/components/Button';
import type { MediaKind } from '../../engines/contracts';
import type { AppTheme } from '../../shared/hooks/useTheme';
import { handleGlassPointerMove } from '../../shared/utils/glassSheen';
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
      <header className="sticky top-0 z-30 h-[56px] border-b border-[var(--border-hairline)] bg-[var(--bg-stage)]/92 transition-colors sm:h-[62px]">
        <div className="mx-auto flex h-full max-w-[1720px] items-center justify-between gap-2 px-2.5 sm:gap-3 sm:px-6 lg:px-8">
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

            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2.5">
              <span
                aria-label="Kompresor Media"
                className="truncate whitespace-nowrap text-[13px] font-semibold tracking-[-0.02em] text-[var(--text-primary)] sm:text-[15px]"
              >
                Kompresor
                <span className={hasMedia ? 'hidden min-[430px]:inline' : ''}> Media</span>
              </span>
              <span
                data-testid="brand-by-amdz"
                className="glass-inner-rim shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)] sm:px-2.5 sm:text-[10px] sm:tracking-[0.15em]"
              >
                BY AMDZ
              </span>
            </div>

            {hasMedia && activeMediaKind && (
              <span
                data-testid="active-studio-badge"
                className={`glass-inner-rim hidden shrink-0 whitespace-nowrap rounded-full border px-3 py-0.5 text-[11px] font-semibold md:inline-block ${
                  activeMediaKind === 'image'
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                {activeMediaKind === 'image' ? 'Studio Foto' : 'Studio Video'}
              </span>
            )}

            {hasMedia && itemCount > 1 && (
              <span className="glass-inner-rim hidden shrink-0 whitespace-nowrap rounded-full border px-3 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] tabular-nums lg:inline-block">
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

            <div
              onPointerMove={handleGlassPointerMove}
              className="glass-dynamic-pill flex shrink-0 items-center gap-1 rounded-full p-1 sm:gap-1.5 sm:px-1.5"
            >
              {hasMedia && (
                <>
                  {canAddMore && (
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid="header-add-btn"
                      onClick={onAddMoreClick}
                      aria-label="Tambah file ke antrean"
                      title="Tambah file"
                      className="glass-inner-rim relative z-10 !h-8 !min-h-0 !w-8 rounded-full !p-0 sm:!h-9 sm:!w-9 lg:!w-auto lg:!px-3"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="hidden lg:inline">Tambah file</span>
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="header-replace-btn"
                    onClick={onReplaceClick}
                    aria-label="Ganti file aktif"
                    title="Ganti"
                    className="glass-inner-rim relative z-10 !h-8 !min-h-0 !w-8 rounded-full !p-0 sm:!h-9 sm:!w-9 lg:!w-auto lg:!px-3"
                  >
                    <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden lg:inline">Ganti</span>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="header-clear-btn"
                    onClick={handleHomeClick}
                    aria-label="Kembali ke Beranda"
                    title="Beranda"
                    className="glass-inner-rim relative z-10 !h-8 !min-h-0 !w-8 rounded-full !p-0 sm:!h-9 sm:!w-9 lg:!w-auto lg:!px-3"
                  >
                    <Home className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden lg:inline">Beranda</span>
                  </Button>
                </>
              )}

              <button
                type="button"
                data-testid="open-guide-btn"
                onClick={() => setGuideOpen(true)}
                aria-label="Buka panduan penggunaan"
                title="Panduan"
                className={`glass-inner-rim relative z-10 inline-flex h-8 w-8 items-center justify-center gap-1.5 rounded-full border text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] active:scale-[0.97] sm:h-9 ${
                  hasMedia ? 'sm:w-9 lg:w-auto lg:px-3' : 'sm:w-auto sm:px-3'
                }`}
              >
                <HelpCircle className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
                <span className={hasMedia ? 'hidden lg:inline' : 'hidden sm:inline'}>Panduan</span>
              </button>

              <button
                type="button"
                data-testid="theme-toggle-btn"
                onClick={onToggleTheme}
                aria-label={isDark ? 'Ganti ke tema Porselen Terang' : 'Ganti ke tema Slate Gelap'}
                title={isDark ? 'Porselen Terang' : 'Slate Gelap'}
                className="glass-inner-rim relative z-10 inline-flex h-8 w-8 items-center justify-center gap-1.5 rounded-full border text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] active:scale-[0.97] sm:h-9 sm:w-auto sm:px-3.5"
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
        </div>
      </header>

      <GuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />

      {confirmLeaveOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmLeaveOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            data-testid="confirm-leave-modal"
            className="glass-sheet-modal w-full max-w-sm rounded-[26px] border p-6"
          >
            <h2 className="font-editorial text-base font-semibold leading-snug text-[var(--text-primary)]">
              Hentikan pemrosesan video?
            </h2>
            <p className="mt-2.5 text-xs leading-relaxed text-[var(--text-secondary)]">
              Video sedang dirender. Kembali ke Beranda akan membatalkan proses saat ini dan
              mengosongkan antrean.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2.5">
              <Button
                variant="secondary"
                size="sm"
                className="glass-inner-rim"
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
