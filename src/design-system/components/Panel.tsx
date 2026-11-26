import type { ReactNode } from 'react';

export interface PanelProps {
  title?: string;
  subtitle?: string;
  headerAction?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({
  title,
  subtitle,
  headerAction,
  children,
  className = '',
}: PanelProps) {
  return (
    <section
      className={`rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] ${className}`}
    >
      {(title || headerAction) && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border-hairline)] px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</p>
            )}
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
