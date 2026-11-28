import type { ReactNode } from 'react';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  valueLabel?: string;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  disabled?: boolean;
  testId?: string;
  hint?: ReactNode;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  valueLabel,
  onChange,
  onCommit,
  disabled = false,
  testId,
  hint,
}: SliderProps) {
  const span = max - min;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((value - min) / span) * 100)) : 0;

  const handleReset = () => {
    if (disabled || defaultValue === undefined) {
      return;
    }
    onChange(defaultValue);
    onCommit?.(defaultValue);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span
          onDoubleClick={handleReset}
          title={defaultValue !== undefined ? 'Klik dua kali untuk mengembalikan nilai awal' : undefined}
          className="select-none font-medium leading-snug text-[var(--text-secondary)]"
        >
          {label}
        </span>
        <span className="glass-inner-rim shrink-0 rounded-lg border px-2 py-0.5 text-[11px] font-semibold leading-snug text-[var(--text-primary)] tabular-nums">
          {valueLabel ?? value}
        </span>
      </div>

      <input
        data-testid={testId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number(e.currentTarget.value))}
        onKeyUp={(e) => onCommit?.(Number(e.currentTarget.value))}
        onDoubleClick={handleReset}
        className="km-range-input w-full disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          background: `linear-gradient(to right, var(--accent-primary) ${pct}%, var(--border-hairline) ${pct}%)`,
        }}
      />

      {hint && <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-muted)]">{hint}</div>}
    </div>
  );
}
