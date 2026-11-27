const UNSAFE_FILENAME_CHARS_RE = /[\\/:*?"<>|\u0000-\u001f]+/g;

/**
 * Sanitizes an exported base filename (no directory traversal, Windows/iOS/macOS reserved characters, or empty stem).
 */
export function sanitizeExportBaseName(rawBase: string, fallback = 'media'): string {
  const leaf = rawBase.split(/[\\/]/).pop() ?? rawBase;
  const cleaned = leaf
    .replace(UNSAFE_FILENAME_CHARS_RE, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
    .trim();
  return cleaned || fallback;
}

/**
 * Sanitizes a full filename (including extension) for ZIP entries or local downloads.
 */
export function sanitizeArchiveFileName(fileName: string, fallback = 'media-kompresor'): string {
  const leaf = (fileName.split(/[\\/]/).pop() ?? fileName).trim();
  const dotIdx = leaf.lastIndexOf('.');
  if (dotIdx > 0 && dotIdx < leaf.length - 1) {
    const rawBase = leaf.slice(0, dotIdx);
    const rawExt = leaf.slice(dotIdx + 1).replace(/[^a-zA-Z0-9]/g, '');
    const safeBase = sanitizeExportBaseName(rawBase, fallback);
    return rawExt ? `${safeBase}.${rawExt}` : safeBase;
  }
  return sanitizeExportBaseName(leaf, fallback);
}
