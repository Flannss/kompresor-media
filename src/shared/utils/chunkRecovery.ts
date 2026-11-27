export const CHUNK_RELOAD_STORAGE_KEY = 'km_chunk_reload_ts';
export const CHUNK_RELOAD_COOLDOWN_MS = 20_000;

const STALE_CHUNK_PATTERNS = [
  'failed to fetch dynamically imported module',
  'importing a module script failed',
  'loading chunk',
  'loading css chunk',
  'unable to preload css',
];

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message || '';
  }
  if (error && typeof error === 'object') {
    const rec = error as { message?: unknown; reason?: unknown; payload?: unknown };
    if (typeof rec.message === 'string') return rec.message;
    if (rec.reason) return extractErrorMessage(rec.reason);
    if (rec.payload) return extractErrorMessage(rec.payload);
  }
  return '';
}

export function isStaleChunkError(error: unknown): boolean {
  const msg = extractErrorMessage(error).toLowerCase();
  if (!msg) return false;
  return STALE_CHUNK_PATTERNS.some((pattern) => msg.includes(pattern));
}

export interface StaleChunkRecoveryOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  reload?: () => void;
  now?: () => number;
  force?: boolean;
}

/**
 * Automatically reloads once when a stale Vite dynamic import chunk hash fails after deploy,
 * guarded by sessionStorage so infinite reload loops cannot occur.
 */
export function recoverFromStaleChunkError(
  error: unknown,
  opts?: StaleChunkRecoveryOptions
): boolean {
  if (!opts?.force && !isStaleChunkError(error)) {
    return false;
  }

  const now = opts?.now ?? (() => Date.now());
  const currentTs = now();
  const storage =
    opts?.storage !== undefined
      ? opts.storage
      : typeof window !== 'undefined'
        ? window.sessionStorage
        : null;

  try {
    if (storage) {
      const rawLast = storage.getItem(CHUNK_RELOAD_STORAGE_KEY);
      const lastTs = rawLast ? Number(rawLast) : 0;
      if (Number.isFinite(lastTs) && lastTs > 0 && currentTs - lastTs < CHUNK_RELOAD_COOLDOWN_MS) {
        return false;
      }
      storage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(currentTs));
    }
  } catch {
    // Fallback cleanly if sessionStorage is restricted (e.g. private Safari browsing)
    return false;
  }

  const reloadFn = opts?.reload ?? (() => window.location.reload());
  reloadFn();
  return true;
}
