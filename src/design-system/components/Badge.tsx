import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'error';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral:
    'bg-[var(--surface-subtle)] text-[var(--ink-secondary)] border-[var(--border-subtle)]',
  accent:
    'bg-[var(--accent-tint)] text-[var(--accent-primary)] border-[var(--accent-border)]',
  ok: 'bg-[var(--status-ok-bg)] text-[var(--status-ok-ink)] border-[var(--status-ok-border)]',
  warn: 'bg-[var(--status-warn-bg)] text-[var(--status-warn-ink)] border-[var(--status-warn-border)]',
  error: 'bg-[var(--status-err-bg)] text-[var(--status-err-ink)] border-[var(--status-err-border)]',
};

export function Badge({ tone = 'neutral', children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium leading-tight ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
