import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent-primary)] text-[var(--ink-on-accent)] border-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] hover:border-[var(--accent-primary-hover)]',
  secondary:
    'bg-[var(--surface-card)] text-[var(--ink-primary)] border-[var(--border-strong)] hover:bg-[var(--surface-subtle)]',
  ghost:
    'bg-transparent text-[var(--ink-secondary)] border-transparent hover:bg-[var(--surface-subtle)] hover:text-[var(--ink-primary)]',
  danger:
    'bg-[var(--status-err-bg)] text-[var(--status-err-ink)] border-[var(--status-err-border)] hover:brightness-95',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-lg border font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
