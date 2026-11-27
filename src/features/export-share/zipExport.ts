import { sanitizeArchiveFileName } from '../../shared/utils/sanitizeFileName';
import { SAFARI_SAFE_REVOKE_DELAY_MS, triggerObjectUrlDownload } from './shareHelper';

export interface ZipEntryInput {
  fileName: string;
  blob: Blob;
}

export function sanitizeZipFileName(name: string): string {
  return sanitizeArchiveFileName(name, 'media-kompresor');
}

export function deduplicateFileName(name: string, usedLowerNames: Set<string>): string {
  const safeName = sanitizeZipFileName(name);
  if (!usedLowerNames.has(safeName.toLowerCase())) {
    usedLowerNames.add(safeName.toLowerCase());
    return safeName;
  }

  const dotIdx = safeName.lastIndexOf('.');
  const base = dotIdx > 0 ? safeName.slice(0, dotIdx) : safeName;
  const ext = dotIdx > 0 ? safeName.slice(dotIdx) : '';

  let counter = 2;
  while (usedLowerNames.has(`${base}-${counter}${ext}`.toLowerCase())) {
    counter += 1;
  }
  const unique = `${base}-${counter}${ext}`;
  usedLowerNames.add(unique.toLowerCase());
  return unique;
}

/**
 * Lazily imports fflate and bundles already-compressed media files at level 0 (store)
 * so ZIP creation finishes near-instantly without wasting CPU recompressing media.
 */
export async function buildZipBlob(items: ZipEntryInput[]): Promise<Blob> {
  if (items.length === 0) {
    throw new Error('Tidak ada file hasil untuk diarsipkan ke ZIP.');
  }

  const { zipSync } = await import('fflate');
  const usedLowerNames = new Set<string>();
  const entries: Record<string, Uint8Array> = {};

  for (const item of items) {
    const safeName = deduplicateFileName(item.fileName, usedLowerNames);
    const bytes = new Uint8Array(await item.blob.arrayBuffer());
    entries[safeName] = bytes;
  }

  const zipped = zipSync(entries, { level: 0 });
  const normalized = new Uint8Array(zipped.byteLength);
  normalized.set(zipped);
  return new Blob([normalized], { type: 'application/zip' });
}

export async function exportQueueAsZip(
  items: ZipEntryInput[],
  zipFileName = 'kompresor-media-hasil.zip'
): Promise<number> {
  const safeZipName = sanitizeZipFileName(zipFileName);
  const blob = await buildZipBlob(items);
  const url = URL.createObjectURL(blob);
  triggerObjectUrlDownload(url, safeZipName);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, SAFARI_SAFE_REVOKE_DELAY_MS);
  return blob.size;
}
