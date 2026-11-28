import { useEffect } from 'react';
import { BookOpen, ShieldCheck, Sliders, Smartphone, X } from 'lucide-react';

export interface GuideModalProps {
  open: boolean;
  onClose: () => void;
}

export function GuideModal({ open, onClose }: GuideModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-modal-title"
        data-testid="guide-modal"
        className="km-glass-strong relative flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-[26px] border p-5 shadow-[var(--stage-shadow)] sm:p-6"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-hairline)] pb-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border"
              style={{
                backgroundColor: 'var(--accent-craft-soft)',
                borderColor: 'var(--accent-craft-border)',
                color: 'var(--accent-craft)',
              }}
            >
              <BookOpen className="h-4.5 w-4.5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="guide-modal-title"
                className="font-editorial text-base font-semibold leading-snug text-[var(--text-primary)] sm:text-lg"
              >
                Panduan Singkat Kompresor Media
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Ringkas, jernih, dan 100% lokal di perangkat Anda
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="close-guide-btn"
            aria-label="Tutup panduan"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 space-y-3 overflow-y-auto pr-1 text-xs leading-relaxed text-[var(--text-secondary)]">
          <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
            <h3 className="font-semibold text-[var(--text-primary)]">1. Alur 3 Langkah</h3>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>
                <strong>Impor:</strong> Pilih file dari Beranda, tarik &amp; lepas ke jendela mana
                saja, atau tekan <strong>Ctrl+V</strong> / <strong>Cmd+V</strong> untuk menempel
                gambar langsung.
              </li>
              <li>
                <strong>Atur &amp; Bandingkan:</strong> Ikuti tab berurutan{' '}
                <strong>1. Tujuan</strong> → <strong>2. Jernihkan</strong> →{' '}
                <strong>3. Edit</strong>, lalu cek hasilnya dengan{' '}
                <strong>Geser Belah</strong> atau <strong>Zoom 200%</strong>.
              </li>
              <li>
                <strong>Simpan HD:</strong> Klik <strong>Simpan Foto HD</strong>,{' '}
                <strong>Simpan Video HD</strong>, atau <strong>Simpan Semua (ZIP)</strong> untuk
                mengunduh antrean sekaligus.
              </li>
            </ol>
          </section>

          <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
              <Sliders className="h-3.5 w-3.5 text-[var(--accent-photo)]" aria-hidden="true" />
              <h3>2. Bedanya Model, Alat &amp; Filter</h3>
            </div>
            <ul className="mt-1.5 space-y-1">
              <li>
                <strong>Model Kualitas:</strong> Mengatur karakter kejernihan dasar foto/video
                tanpa mengubah gaya warna asli.
              </li>
              <li>
                <strong>Alat Sempurnakan Foto:</strong> Solusi masalah spesifik seperti{' '}
                <em>Pertajam Foto</em>, <em>Hilangkan Blur</em>, <em>Hilangkan Kabut</em>,{' '}
                <em>Pulihkan Foto Lama</em>, dan <em>Warnai Foto</em>.
              </li>
              <li>
                <strong>Filter &amp; Color Grade:</strong> Memberi sentuhan suasana warna secara
                opsional.
              </li>
            </ul>
          </section>

          <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
              <Smartphone
                className="h-3.5 w-3.5 text-[var(--accent-video)]"
                aria-hidden="true"
              />
              <h3>3. Tips Kirim HD ke WhatsApp &amp; iPhone</h3>
            </div>
            <ul className="mt-1.5 space-y-1">
              <li>
                Simpan hasil ke galeri/perangkat lebih dulu, lalu kirim lewat aplikasi WhatsApp
                dengan ikon <strong>HD</strong> aktif atau kirim sebagai <strong>Dokumen</strong>.
              </li>
              <li>
                Untuk <strong>Status WA</strong>, gunakan preset <strong>Status WA HD</strong>{' '}
                (1080p BT.709) dengan durasi maksimal <strong>30 detik</strong> agar tidak pecah
                atau buram.
              </li>
            </ul>
          </section>

          <section className="rounded-2xl border border-[var(--status-ok-border)] bg-[var(--status-ok-bg)] p-3.5 text-[var(--status-ok-ink)]">
            <div className="flex items-center gap-1.5 font-semibold">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <h3>4. Privasi 100% Lokal di Perangkat</h3>
            </div>
            <p className="mt-1">
              Seluruh kompresi, penjernihan, pemotongan, dan pengarsipan ZIP berjalan langsung di
              perangkat Anda. File Anda tidak pernah diunggah ke server mana pun.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
