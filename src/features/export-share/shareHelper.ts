export type WhatsAppShareOutcome = 'shared' | 'cancelled' | 'desktop-helper';

export function triggerObjectUrlDownload(objectUrl: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export function isLikelyMobileDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod/i.test(ua)) {
    return true;
  }
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

export function canNativeShareFile(blob: Blob, fileName: string, mimeType: string): boolean {
  if (!isLikelyMobileDevice()) {
    return false;
  }
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    const file = new File([blob], fileName, { type: mimeType });
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function executeWhatsAppShareFlow(params: {
  blob: Blob;
  objectUrl: string;
  fileName: string;
  mimeType: string;
}): Promise<WhatsAppShareOutcome> {
  const { blob, objectUrl, fileName, mimeType } = params;

  if (canNativeShareFile(blob, fileName, mimeType)) {
    try {
      const file = new File([blob], fileName, { type: mimeType });
      await navigator.share({
        files: [file],
        title: 'Kompresor Media',
      });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'cancelled';
      }
      // Fall through to desktop download + WhatsApp Web helper if Web Share fails
    }
  }

  triggerObjectUrlDownload(objectUrl, fileName);
  return 'desktop-helper';
}
