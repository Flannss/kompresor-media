import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../design-system/components/Button';
import { isStaleChunkError, recoverFromStaleChunkError } from '../shared/utils/chunkRecovery';

interface ErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  isChunkError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    isChunkError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const chunkErr = isStaleChunkError(error);
    return {
      hasError: true,
      isChunkError: chunkErr,
      message: chunkErr
        ? 'Versi baru aplikasi baru saja tersedia. Muat ulang studio untuk melanjutkan.'
        : error instanceof Error && error.message
          ? error.message
          : 'Terjadi gangguan tak terduga saat memuat studio.',
    };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    if (isStaleChunkError(error)) {
      recoverFromStaleChunkError(error);
    }
  }

  private handleReloadPage = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, isChunkError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          data-testid="error-boundary-card"
          className="bg-warm-stage flex min-h-screen w-full items-center justify-center p-4"
        >
          <div className="km-glass-strong w-full max-w-md rounded-[26px] border border-[var(--status-err-border)] p-6 shadow-[var(--stage-shadow)]">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs font-semibold tracking-tight text-[var(--text-primary)]">
                Kompresor Media
              </span>
              <span className="rounded-full border border-[var(--border-hairline)] bg-[var(--accent-gold-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-gold)]">
                BY AMDZ
              </span>
            </div>
            <h1 className="font-editorial text-lg font-semibold text-[var(--text-primary)]">
              {this.state.isChunkError
                ? 'Pembaruan studio tersedia'
                : 'Studio mengalami gangguan ringan'}
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
              {this.state.message}
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Button
                variant="primary"
                size="md"
                data-testid="error-reload-btn"
                onClick={this.handleReloadPage}
                className="min-h-[44px] rounded-full px-5"
              >
                Muat Ulang Studio
              </Button>
              <Button
                variant="secondary"
                size="md"
                data-testid="error-reset-btn"
                onClick={this.handleReset}
                className="min-h-[44px] rounded-full px-5"
              >
                Kembali ke Beranda
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
