export interface SegmentedTabItem<T extends string> {
  id: T;
  label: string;
  mobileLabel?: string;
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
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === value)
  );

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="relative grid rounded-full border border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-1 shadow-[inset_0_1px_2px_rgba(2,6,23,0.14)]"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-1 left-1 rounded-full bg-[var(--accent-primary)] [background-image:var(--accent-primary-gradient)] shadow-[var(--shadow-soft)] ring-1 ring-[var(--border-strong)] transition-transform duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{
          width: `calc((100% - 8px) / ${items.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />

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
            className={`relative z-10 flex min-h-[44px] sm:min-h-[40px] items-center justify-center overflow-hidden whitespace-nowrap rounded-full px-1.5 sm:px-2.5 py-1.5 text-[11px] sm:text-[11.5px] font-semibold leading-tight transition-colors duration-200 active:scale-[0.985] ${
              active
                ? 'text-[var(--ink-on-accent)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {item.mobileLabel ? (
              <>
                <span className="sm:hidden">{item.mobileLabel}</span>
                <span className="hidden sm:inline">{item.label}</span>
              </>
            ) : (
              item.label
            )}
          </button>
        );
      })}
    </div>
  );
}
