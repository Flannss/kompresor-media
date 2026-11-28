import { VideoCancelledError } from '../../engines/video/videoErrors';

export const TECHNICAL_LEAK_RE =
  /\b(ffmpeg|terminate|errnoerror|runtimeerror|webassembly|aborted\(|arraybuffer|encodingerror|operationerror|quotaexceeded|rangeerror|typeerror|referenceerror|syntaxerror|notallowederror|notsupportederror|invalidstateerror|datacloneerror|sharedarraybuffer|wasm|importscripts|cannot read|is not defined|is not a function|failed to fetch|undefined|null)\b|\.jsx?:\d+|\.tsx?:\d+|\bat\s+\w+\s*\(/i;

const FRIENDLY_PREFIX_RE =
  /^(Video|Foto|File|Browser|Memori|Gagal|Ukuran|Format|Durasi|Subtitle|Perangkat|Ekspor|Proses|Target|Audio|Resolusi|Simulasi)\b/i;

function extractErrorInfo(err: unknown): { name: string; message: string } {
  if (typeof err === 'string') {
    return { name: '', message: err };
  }
  if (err && typeof err === 'object') {
    const rec = err as { name?: unknown; message?: unknown };
    return {
      name: typeof rec.name === 'string' ? rec.name : '',
      message: typeof rec.message === 'string' ? rec.message : '',
    };
  }
  return { name: '', message: '' };
}

/**
 * Returns true if the error represents an intentional user cancellation or worker termination.
 */
export function isCancellationError(err: unknown): boolean {
  if (err instanceof VideoCancelledError) {
    return true;
  }
  const { name, message } = extractErrorInfo(err);
  if (name === 'AbortError' || name === 'VideoCancelledError') {
    return true;
  }
  return /called\s+FFmpeg\.terminate|\bFFmpeg\.terminate\b|\bAbortError\b|\bterminated\b|dibatalkan/i.test(
    message
  );
}

/**
 * Translates any internal media/WASM/WebCodecs/browser error into clean Indonesian user guidance.
 * Guarantees zero raw English exceptions or stack traces ever leak into the UI.
 */
export function formatFriendlyMediaError(
  err: unknown,
  context: 'video' | 'photo' | 'subtitle' = 'video'
): string {
  if (isCancellationError(err)) {
    return 'Proses video dibatalkan.';
  }

  const { name, message: raw } = extractErrorInfo(err);

  if (context === 'subtitle') {
    if (
      raw.length > 0 &&
      raw.length < 220 &&
      !TECHNICAL_LEAK_RE.test(raw) &&
      FRIENDLY_PREFIX_RE.test(raw.trim())
    ) {
      return raw.trim();
    }
    return 'File subtitle tidak dapat dibaca. Pastikan formatnya .SRT atau .VTT yang valid.';
  }

  const combined = `${name} ${raw}`.trim();

  if (
    raw.length > 0 &&
    raw.length < 240 &&
    !TECHNICAL_LEAK_RE.test(combined) &&
    FRIENDLY_PREFIX_RE.test(raw.trim())
  ) {
    return raw.trim();
  }

  if (/timeout|timed out|stalled|hang|macet|habis/i.test(combined)) {
    return context === 'photo'
      ? 'Pemrosesan foto memakan waktu terlalu lama. Coba resolusi lebih ringan (2K) lalu ulangi.'
      : 'Proses memakan waktu terlalu lama dan dihentikan agar browser tidak macet. Coba turunkan resolusi ke 720p/1080p atau aktifkan Video Panjang.';
  }

  if (
    /out of memory|oom|cannot allocate|memory access out of bounds|allocation failed|rangeerror|arraybuffer|too large|terlalu besar|quota/i.test(
      combined
    )
  ) {
    return context === 'photo'
      ? 'Memori perangkat tidak cukup untuk memproses foto resolusi ini. Tutup tab lain atau pilih target 2K.'
      : 'Memori perangkat tidak cukup untuk video sebesar ini. Coba turunkan resolusi ke 720p, aktifkan mode Video Panjang (30+ mnt), atau potong durasi video.';
  }

  if (
    /wasm|webassembly|ffmpeg|sharedarraybuffer|cross-origin|worker|importscripts|aborted\(|exit code|broken pipe|errno|memfs/i.test(
      combined
    )
  ) {
    return 'Modul pengolah video gagal dimuat atau terhenti di browser. Segarkan halaman lalu coba proses ulang—jika durasi panjang, pilih mode Video Panjang (MP4 1080p).';
  }

  if (
    /encodingerror|notsupportederror|notallowederror|invalidstateerror|videodecoder|videoencoder|avc1|hevc|codec|mux|mediarecorder|pixel|frame|corrupt/i.test(
      combined
    )
  ) {
    return context === 'photo'
      ? 'Format atau data gambar tidak dapat diproses oleh browser. Coba unggah versi JPG/PNG standar.'
      : 'Format atau codec video tidak didukung penuh oleh akselerasi perangkat Anda. Coba ubah preset ke Video Panjang atau Resolusi 1080p/720p.';
  }

  return context === 'photo'
    ? 'Terjadi kendala saat memproses foto di browser Anda. Coba segarkan halaman atau gunakan target 2K.'
    : 'Terjadi kendala saat memproses video di browser Anda. Segarkan halaman atau coba resolusi 1080p/720p.';
}
