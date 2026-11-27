export type SharePlatform = 'whatsapp' | 'instagram' | 'tiktok';
export type WhatsAppShareOutcome = 'shared' | 'cancelled' | 'desktop-helper';

export interface PlatformShareSpec {
  id: SharePlatform;
  label: string;
  helperText: string;
  tipText: string;
  openLabel: string;
  url: string;
}

export const PLATFORM_SHARE_META: Record<SharePlatform, PlatformShareSpec> = {
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    helperText:
      'File sudah disimpan ke folder Unduhan. Buka WhatsApp Web lalu kirim file dari folder Unduhan.',
    tipText:
      'Tip iPhone: Simpan file dulu, lalu kirim dari aplikasi WhatsApp dengan tombol HD aktif (hindari kirim langsung dari menu Bagikan agar tidak dikompres paksa).',
    openLabel: 'Buka WhatsApp Web',
    url: 'https://web.whatsapp.com/',
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    helperText:
      'File sudah diunduh dengan ukuran optimal. Buka Instagram Web untuk membuat postingan atau unggah dari galeri.',
    tipText:
      'Tip: Untuk Feed gunakan 1440 px, dan untuk Story/Reels aktifkan unggah kualitas tertinggi di setelan IG.',
    openLabel: 'Buka Instagram',
    url: 'https://www.instagram.com/',
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    helperText:
      'File sudah disimpan ke perangkat. Buka halaman unggah TikTok lalu pilih file dari folder Unduhan.',
    tipText:
      'Tip: Untuk hasil paling jernih di TikTok, gunakan format MP4 1080p dengan kecepatan 30 atau 60 gerak/detik.',
    openLabel: 'Buka Unggah TikTok',
    url: 'https://www.tiktok.com/upload',
  },
};

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

export async function executePlatformShareFlow(params: {
  platform: SharePlatform;
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
      // Fall through to download + platform helper card
    }
  }

  triggerObjectUrlDownload(objectUrl, fileName);
  return 'desktop-helper';
}

export async function executeWhatsAppShareFlow(params: {
  blob: Blob;
  objectUrl: string;
  fileName: string;
  mimeType: string;
}): Promise<WhatsAppShareOutcome> {
  return executePlatformShareFlow({ ...params, platform: 'whatsapp' });
}
