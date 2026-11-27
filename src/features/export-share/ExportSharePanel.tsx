import { useEffect, useRef, useState } from 'react';
import { Check, Download, ExternalLink, FileArchive, Share2 } from 'lucide-react';
import { Button } from '../../design-system/components/Button';
import type { PhotoTargetResolution } from '../../engines/contracts';
import { formatOutputMimeShort } from '../../engines/image/pixelOps';
import type { MediaPresetId } from '../../presets/mediaPresets';
import { formatBytes } from '../../shared/utils/formatBytes';
import {
  executePlatformShareFlow,
  isLikelyMobileDevice,
  PLATFORM_SHARE_META,
  triggerObjectUrlDownload,
  type SharePlatform,
} from './shareHelper';
import type { ZipEntryInput } from './zipExport';

export interface ExportSharePanelProps {
  mediaKind: 'image' | 'video';
  readyBlob: Blob | null;
  readyUrl: string | null;
  outputFileName: string | null;
  outputMime: string | null;
  exportedWidth?: number | null;
  exportedHeight?: number | null;
  exportedBytes?: number | null;
  selectedPresetId?: MediaPresetId;
  targetResolution?: PhotoTargetResolution;
  finishedBatchItems?: ZipEntryInput[];
  needsFullResPreparation?: boolean;
  onPrepareFullResExport?: () => Promise<{
    blob: Blob;
    url: string;
    fileName: string;
    mimeType: string;
  } | null>;
  onPrepareAllZipItems?: () => Promise<ZipEntryInput[]>;
  disabled?: boolean;
  isProcessing?: boolean;
}

export function ExportSharePanel({
  mediaKind,
  readyBlob,
  readyUrl,
  outputFileName,
  outputMime,
  exportedWidth = null,
  exportedHeight = null,
  exportedBytes = null,
  selectedPresetId,
  targetResolution = 'original',
  finishedBatchItems = [],
  needsFullResPreparation = false,
  onPrepareFullResExport,
  onPrepareAllZipItems,
  disabled = false,
  isProcessing = false,
}: ExportSharePanelProps) {
  const [downloadConfirmed, setDownloadConfirmed] = useState(false);
  const [activeHelperPlatform, setActiveHelperPlatform] = useState<SharePlatform | null>(null);
  const [preparingFullRes, setPreparingFullRes] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [zipDoneMsg, setZipDoneMsg] = useState<string | null>(null);
  const selfPreparedUrlRef = useRef<string | null>(null);

  const likelyMobile = isLikelyMobileDevice();
  const isWhatsAppPreset =
    selectedPresetId === 'whatsapp-hd' || selectedPresetId === 'whatsapp-status';

  useEffect(() => {
    if (readyUrl && selfPreparedUrlRef.current === readyUrl) {
      selfPreparedUrlRef.current = null;
      return;
    }
    setDownloadConfirmed(false);
    setActiveHelperPlatform(null);
  }, [readyUrl]);

  const canExport =
    Boolean(readyBlob && readyUrl && outputFileName && outputMime) &&
    !disabled &&
    !isProcessing &&
    !preparingFullRes;

  const resolveReadyExport = async (): Promise<{
    blob: Blob;
    url: string;
    fileName: string;
    mimeType: string;
  } | null> => {
    if (needsFullResPreparation) {
      if (!onPrepareFullResExport) {
        return null;
      }
      setPreparingFullRes(true);
      try {
        const prepared = await onPrepareFullResExport();
        if (!prepared) {
          return null;
        }
        selfPreparedUrlRef.current = prepared.url;
        return prepared;
      } finally {
        setPreparingFullRes(false);
      }
    }
    if (!readyBlob || !readyUrl || !outputFileName || !outputMime) {
      return null;
    }
    return {
      blob: readyBlob,
      url: readyUrl,
      fileName: outputFileName,
      mimeType: outputMime,
    };
  };

  const handleDownload = async () => {
    const target = await resolveReadyExport();
    if (!target) return;
    triggerObjectUrlDownload(target.url, target.fileName);
    setDownloadConfirmed(true);
  };

  const handleSharePlatform = async (platform: SharePlatform) => {
    setSharing(true);
    try {
      const target = await resolveReadyExport();
      if (!target) return;
      const outcome = await executePlatformShareFlow({
        platform,
        blob: target.blob,
        objectUrl: target.url,
        fileName: target.fileName,
        mimeType: target.mimeType,
      });
      if (outcome === 'desktop-helper') {
        setActiveHelperPlatform(platform);
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
      const zipInputs = onPrepareAllZipItems
        ? await onPrepareAllZipItems()
        : finishedBatchItems;
      if (zipInputs.length < 2) return;
      const { exportQueueAsZip } = await import('./zipExport');
      await exportQueueAsZip(zipInputs);
      setZipDoneMsg(`Arsip ZIP (${zipInputs.length} file) berhasil diunduh`);
    } finally {
      setZipping(false);
    }
  };

  const renderResTag =
    targetResolution === '2k' ||
    targetResolution === '4k' ||
    targetResolution === '8k' ||
    targetResolution === 'hd'
      ? targetResolution.toUpperCase()
      : 'HD';

  const downloadLabel = preparingFullRes
    ? `Merender ${renderResTag} penuh…`
    : likelyMobile
      ? isProcessing
        ? 'Memproses HD…'
        : 'Simpan File HD'
      : mediaKind === 'image'
        ? isProcessing
          ? 'Memproses Foto…'
          : 'Unduh Foto'
        : 'Unduh Video';

  const downloadedText =
    mediaKind === 'image' ? 'Foto HD berhasil disimpan' : 'Video HD berhasil disimpan';

  const formatShort =
    outputMime && outputMime.startsWith('image/')
      ? formatOutputMimeShort(outputMime as 'image/jpeg' | 'image/webp' | 'image/png' | 'image/avif')
      : outputMime?.replace('video/', '').toUpperCase() ?? null;

  const helperSpec = activeHelperPlatform ? PLATFORM_SHARE_META[activeHelperPlatform] : null;

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        size="lg"
        data-testid={mediaKind === 'image' ? 'download-photo-btn' : 'download-video-btn'}
        disabled={!canExport}
        onClick={() => void handleDownload()}
        className="min-h-[46px] w-full font-semibold"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        <span>{downloadLabel}</span>
      </Button>

      {likelyMobile ? (
        <Button
          variant="secondary"
          size="md"
          data-testid="whatsapp-share-btn"
          disabled={!canExport || sharing}
          onClick={() => void handleSharePlatform('whatsapp')}
          className="min-h-[44px] w-full"
        >
          <Share2 className="h-4 w-4 text-[var(--accent-highlight)]" aria-hidden="true" />
          <span>{preparingFullRes ? `Merender ${renderResTag} penuh…` : 'Bagikan'}</span>
        </Button>
      ) : (
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Kirim cepat ke aplikasi">
          <Button
            variant="secondary"
            size="sm"
            data-testid="whatsapp-share-btn"
            disabled={!canExport || sharing}
            onClick={() => void handleSharePlatform('whatsapp')}
            className="min-h-[40px] px-2 text-[11px] font-semibold"
          >
            WhatsApp
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-testid="instagram-share-btn"
            disabled={!canExport || sharing}
            onClick={() => void handleSharePlatform('instagram')}
            className="min-h-[40px] px-2 text-[11px] font-semibold"
          >
            Instagram
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-testid="tiktok-share-btn"
            disabled={!canExport || sharing}
            onClick={() => void handleSharePlatform('tiktok')}
            className="min-h-[40px] px-2 text-[11px] font-semibold"
          >
            TikTok
          </Button>
        </div>
      )}

      {exportedWidth && exportedHeight && exportedBytes !== null && (
        <p
          data-testid="exported-dimensions-badge"
          className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-center text-[11px] font-medium text-[var(--text-secondary)] tabular-nums"
        >
          {needsFullResPreparation
            ? `Pratinjau cepat (${exportedWidth}×${exportedHeight}) · Hasil penuh dirender saat simpan`
            : `Output: ${exportedWidth} × ${exportedHeight} px · ${formatBytes(exportedBytes)}${formatShort ? ` · ${formatShort}` : ''}`}
        </p>
      )}

      {likelyMobile && isWhatsAppPreset && (
        <p
          data-testid="ios-wa-hd-tip"
          className="rounded-xl border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--status-warn-ink)]"
        >
          Tip iPhone: Simpan file dulu, lalu kirim dari aplikasi WhatsApp dengan tombol HD aktif
          (hindari kirim langsung dari menu Bagikan agar tidak dikompres paksa).
        </p>
      )}

      {finishedBatchItems.length >= 2 && (
        <Button
          variant="secondary"
          size="md"
          data-testid="download-zip-btn"
          disabled={zipping || preparingFullRes}
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

      {helperSpec && (
        <div
          data-testid={
            helperSpec.id === 'whatsapp' ? 'whatsapp-web-helper' : 'platform-share-helper'
          }
          data-platform={helperSpec.id}
          className="mt-1 flex flex-col gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-secondary)]"
        >
          <p className="leading-relaxed">{helperSpec.helperText}</p>
          <p className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--text-primary)]">
            {helperSpec.tipText}
          </p>
          <a
            href={helperSpec.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={
              helperSpec.id === 'whatsapp'
                ? 'open-whatsapp-web-link'
                : `open-${helperSpec.id}-link`
            }
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-[var(--border-active)] bg-[var(--bg-surface)] px-3 text-xs font-semibold text-[var(--accent-highlight)] transition-colors hover:bg-[var(--bg-subtle)]"
          >
            <span>{helperSpec.openLabel}</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  );
}
