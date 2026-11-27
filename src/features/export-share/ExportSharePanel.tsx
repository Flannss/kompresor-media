import { useEffect, useState } from 'react';
import { Check, Download, ExternalLink, FileArchive, Send } from 'lucide-react';
import { Button } from '../../design-system/components/Button';
import { executeWhatsAppShareFlow, triggerObjectUrlDownload } from './shareHelper';
import type { ZipEntryInput } from './zipExport';

export interface ExportSharePanelProps {
  mediaKind: 'image' | 'video';
  readyBlob: Blob | null;
  readyUrl: string | null;
  outputFileName: string | null;
  outputMime: string | null;
  finishedBatchItems?: ZipEntryInput[];
  disabled?: boolean;
  isProcessing?: boolean;
}

export function ExportSharePanel({
  mediaKind,
  readyBlob,
  readyUrl,
  outputFileName,
  outputMime,
  finishedBatchItems = [],
  disabled = false,
  isProcessing = false,
}: ExportSharePanelProps) {
  const [downloadConfirmed, setDownloadConfirmed] = useState(false);
  const [showWhatsappHelper, setShowWhatsappHelper] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [zipDoneMsg, setZipDoneMsg] = useState<string | null>(null);

  useEffect(() => {
    setDownloadConfirmed(false);
    setShowWhatsappHelper(false);
  }, [readyUrl]);

  const canExport =
    Boolean(readyBlob && readyUrl && outputFileName && outputMime) &&
    !disabled &&
    !isProcessing;

  const handleDownload = () => {
    if (!readyUrl || !outputFileName) {
      return;
    }
    triggerObjectUrlDownload(readyUrl, outputFileName);
    setDownloadConfirmed(true);
  };

  const handleWhatsApp = async () => {
    if (!readyBlob || !readyUrl || !outputFileName || !outputMime) {
      return;
    }
    setSharing(true);
    try {
      const outcome = await executeWhatsAppShareFlow({
        blob: readyBlob,
        objectUrl: readyUrl,
        fileName: outputFileName,
        mimeType: outputMime,
      });
      if (outcome === 'desktop-helper') {
        setShowWhatsappHelper(true);
        setDownloadConfirmed(true);
      }
    } finally {
      setSharing(false);
    }
  };

  const handleZipDownload = async () => {
    if (finishedBatchItems.length < 2 || zipping) return;
    setZipping(true);
    setZipDoneMsg(null);
    try {
      const { exportQueueAsZip } = await import('./zipExport');
      await exportQueueAsZip(finishedBatchItems);
      setZipDoneMsg(`Arsip ZIP (${finishedBatchItems.length} file) berhasil diunduh`);
    } finally {
      setZipping(false);
    }
  };

  const downloadLabel =
    mediaKind === 'image'
      ? isProcessing
        ? 'Memproses Foto…'
        : 'Unduh Foto'
      : 'Unduh Video';

  const downloadedText =
    mediaKind === 'image' ? 'Foto berhasil diunduh' : 'Video berhasil diunduh';

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        size="lg"
        data-testid={mediaKind === 'image' ? 'download-photo-btn' : 'download-video-btn'}
        disabled={!canExport}
        onClick={handleDownload}
        className="min-h-[44px] w-full font-semibold"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        <span>{downloadLabel}</span>
      </Button>

      <Button
        variant="secondary"
        size="lg"
        data-testid="whatsapp-share-btn"
        disabled={!canExport || sharing}
        onClick={() => void handleWhatsApp()}
        className="min-h-[44px] w-full"
      >
        <Send className="h-4 w-4 text-[var(--accent-highlight)]" aria-hidden="true" />
        <span>Kirim ke WhatsApp</span>
      </Button>

      {finishedBatchItems.length >= 2 && (
        <Button
          variant="secondary"
          size="md"
          data-testid="download-zip-btn"
          disabled={zipping}
          onClick={() => void handleZipDownload()}
          className="min-h-[44px] w-full tabular-nums"
        >
          <FileArchive className="h-4 w-4 text-[var(--accent-highlight)]" aria-hidden="true" />
          <span>
            {zipping
              ? 'Membuat arsip ZIP…'
              : `Unduh Semua (ZIP · ${finishedBatchItems.length} file)`}
          </span>
        </Button>
      )}

      {downloadConfirmed && (
        <p
          data-testid="download-confirmed-msg"
          className="flex items-center justify-center gap-1.5 pt-0.5 text-xs font-medium text-[var(--status-ok-ink)]"
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{downloadedText}</span>
        </p>
      )}

      {zipDoneMsg && (
        <p
          data-testid="zip-confirmed-msg"
          className="flex items-center justify-center gap-1.5 pt-0.5 text-xs font-medium text-[var(--status-ok-ink)]"
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{zipDoneMsg}</span>
        </p>
      )}

      {showWhatsappHelper && (
        <div
          data-testid="whatsapp-web-helper"
          className="mt-1 flex flex-col gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-secondary)]"
        >
          <p className="leading-relaxed">
            File sudah disimpan ke perangkat. Buka WhatsApp Web lalu kirim file dari folder Unduhan.
          </p>
          <p className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--text-primary)]">
            Tip: Pilih ikon <strong>HD</strong> atau kirim sebagai <strong>Dokumen</strong> di
            WhatsApp agar ketajaman tetap maksimal.
          </p>
          <a
            href="https://web.whatsapp.com/"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="open-whatsapp-web-link"
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-[var(--border-active)] bg-[var(--bg-surface)] px-3 text-xs font-semibold text-[var(--accent-highlight)] transition-colors hover:bg-[var(--bg-subtle)]"
          >
            <span>Buka WhatsApp Web</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  );
}
