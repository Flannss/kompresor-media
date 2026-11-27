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
      className="grid gap-1.5 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-1.5"
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
            className={`min-h-[42px] rounded-xl px-3 py-2 text-[12.5px] font-semibold leading-tight transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] ${
              active
                ? 'bg-[var(--bg-surface-strong)] text-[var(--text-primary)] shadow-[var(--shadow-soft)] ring-1 ring-[var(--accent-gold)]/45'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/55 hover:text-[var(--text-primary)]'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
