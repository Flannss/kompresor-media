import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent-primary)] [background-image:var(--accent-primary-gradient)] text-[var(--ink-on-accent)] border-transparent shadow-[var(--btn-primary-shadow)] hover:brightness-110',
  secondary:
    'bg-[var(--bg-elevated)] text-[var(--text-primary)] border-[var(--border-hairline)] shadow-[var(--glass-highlight)] hover:bg-[var(--bg-subtle)] hover:border-[var(--border-active)]',
  ghost:
    'bg-transparent text-[var(--text-secondary)] border-transparent hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]',
  danger:
    'bg-[var(--status-err-bg)] text-[var(--status-err-ink)] border-[var(--status-err-border)] hover:brightness-95',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 py-1.5 text-xs gap-1.5 rounded-lg leading-snug',
  md: 'min-h-10 px-4 py-2 text-sm gap-2 rounded-xl leading-snug',
  lg: 'min-h-11 px-5 py-2.5 text-sm gap-2 rounded-xl leading-snug',
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
      className={`inline-flex items-center justify-center border font-medium transition-all duration-150 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
