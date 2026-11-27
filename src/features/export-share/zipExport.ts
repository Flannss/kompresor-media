import { triggerObjectUrlDownload } from './shareHelper';

export interface ZipEntryInput {
  fileName: string;
  blob: Blob;
}

function deduplicateFileName(name: string, usedNames: Set<string>): string {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }

  const dotIdx = name.lastIndexOf('.');
  const base = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const ext = dotIdx > 0 ? name.slice(dotIdx) : '';

  let counter = 2;
  while (usedNames.has(`${base} (${counter})${ext}`)) {
    counter += 1;
  }
  const unique = `${base} (${counter})${ext}`;
  usedNames.add(unique);
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
  const usedNames = new Set<string>();
  const entries: Record<string, Uint8Array> = {};

  for (const item of items) {
    const safeName = deduplicateFileName(item.fileName, usedNames);
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
  const blob = await buildZipBlob(items);
  const url = URL.createObjectURL(blob);
  triggerObjectUrlDownload(url, zipFileName);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 500);
  return blob.size;
}
