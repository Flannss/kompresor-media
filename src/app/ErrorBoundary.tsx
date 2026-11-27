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
        ? 'Versi baru aplikasi baru saja tersedia. Muat ulang halaman untuk melanjutkan.'
        : error instanceof Error && error.message
          ? error.message
          : 'Terjadi gangguan pada halaman.',
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
          className="mx-auto my-12 max-w-lg rounded-2xl border border-[var(--status-err-border)] bg-[var(--bg-surface)] p-6"
        >
          <h1 className="text-base font-semibold text-[var(--text-primary)]">
            {this.state.isChunkError
              ? 'Versi baru aplikasi tersedia'
              : 'Halaman mengalami kendala'}
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
            {this.state.message}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="md"
              data-testid="error-reload-btn"
              onClick={this.handleReloadPage}
              className="min-h-[44px]"
            >
              Muat Ulang Halaman
            </Button>
            <Button
              variant="secondary"
              size="md"
              data-testid="error-reset-btn"
              onClick={this.handleReset}
              className="min-h-[44px]"
            >
              Kembali ke Awal
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
