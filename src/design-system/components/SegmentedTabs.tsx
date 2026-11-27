export interface SegmentedTabItem<T extends string> {
  id: T;
  label: string;
}

export interface SegmentedTabsProps<T extends string> {
  items: ReadonlyArray<SegmentedTabItem<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: SegmentedTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="grid gap-1 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-1"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`tab-${item.id}`}
            onClick={() => onChange(item.id)}
            className={`min-h-[38px] rounded-lg px-2 text-xs font-semibold transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] ${
              active
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--glass-highlight)] ring-1 ring-[var(--border-hairline)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
