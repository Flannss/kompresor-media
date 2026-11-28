import type { PointerEvent } from 'react';

/**
 * Updates CSS `--gx` / `--gy` pointer percentages directly on the target element's style
 * with zero React re-renders so desktop liquid-glass sheen glides smoothly at 60fps.
 */
export function handleGlassPointerMove(e: PointerEvent<HTMLElement>): void {
  if (e.pointerType && e.pointerType !== 'mouse') return;
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
  const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
  el.style.setProperty('--gx', `${x.toFixed(1)}%`);
  el.style.setProperty('--gy', `${y.toFixed(1)}%`);
}
