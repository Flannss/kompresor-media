import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../design-system/components/Button';

interface ErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Terjadi gangguan pada halaman.',
    };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Error details rendered cleanly via fallback UI without external telemetry.
  }

  private handleReset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto my-12 max-w-lg rounded-2xl border border-[var(--status-err-border)] bg-[var(--bg-surface)] p-6">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">
            Halaman mengalami kendala
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
            {this.state.message}
          </p>
          <div className="mt-4">
            <Button variant="primary" size="sm" onClick={this.handleReset}>
              Muat Ulang Tampilan
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
