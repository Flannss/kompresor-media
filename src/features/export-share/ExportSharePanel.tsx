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
  exportedFps?: number | null;
  selectedPresetId?: MediaPresetId;
  targetResolution?: PhotoTargetResolution;
  finishedBatchItems?: ZipEntryInput[];
  batchStatusLabel?: string | null;
  needsFullResPreparation?: boolean;
  onPrepareFullResExport?: () => Promise<{
    blob: Blob;
    url: string;
    fileName: string;
    mimeType: string;
    width?: number;
    height?: number;
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
  exportedFps = null,
  selectedPresetId,
  targetResolution = 'original',
  finishedBatchItems = [],
  batchStatusLabel = null,
  needsFullResPreparation = false,
  onPrepareFullResExport,
  onPrepareAllZipItems,
  disabled = false,
  isProcessing = false,
}: ExportSharePanelProps) {
  const [savedSummaryMsg, setSavedSummaryMsg] = useState<string | null>(null);
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
    setSavedSummaryMsg(null);
    setActiveHelperPlatform(null);
  }, [readyUrl]);

  const canExport =
    Boolean(readyBlob && readyUrl && outputFileName && outputMime) &&
    !disabled &&
    !isProcessing &&
    !preparingFullRes;

  const formatSavedMessage = (params: {
    blob: Blob;
    width?: number | null;
    height?: number | null;
  }): string => {
    const w = params.width ?? exportedWidth;
    const h = params.height ?? exportedHeight;
    const sizeText = formatBytes(params.blob.size);
    if (mediaKind === 'video') {
      const dims = w && h ? `${w}×${h}` : 'HD';
      const fpsPart = exportedFps ? ` · ${exportedFps} fps` : '';
      return `Tersimpan · ${dims}${fpsPart} · ${sizeText}`;
    }
    const dims = w && h ? `${w}×${h} px · ` : '';
    return `Tersimpan · ${dims}${sizeText}`;
  };

  const resolveReadyExport = async (): Promise<{
    blob: Blob;
    url: string;
    fileName: string;
    mimeType: string;
    width?: number | null;
    height?: number | null;
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
      width: exportedWidth,
      height: exportedHeight,
    };
  };

  const handleDownload = async () => {
    const target = await resolveReadyExport();
    if (!target) return;
    triggerObjectUrlDownload(target.url, target.fileName);
    setSavedSummaryMsg(formatSavedMessage(target));
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
        setSavedSummaryMsg(formatSavedMessage(target));
      } else if (outcome === 'shared') {
        setSavedSummaryMsg(formatSavedMessage(target));
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
      const zipBytes = await exportQueueAsZip(zipInputs);
      setZipDoneMsg(`ZIP Tersimpan · ${zipInputs.length} file · ${formatBytes(zipBytes)}`);
    } finally {
      setZipping(false);
    }
  };

  const renderResTag =
    targetResolution === '2k' ||
    targetResolution === '3k' ||
    targetResolution === '4k' ||
    targetResolution === '8k' ||
    targetResolution === 'hd'
      ? targetResolution.toUpperCase()
      : 'HD';

  const hasHighResPhoto =
    targetResolution === 'hd' ||
    targetResolution === '2k' ||
    targetResolution === '3k' ||
    targetResolution === '4k' ||
    targetResolution === '8k';

  const downloadLabel = preparingFullRes
    ? `Merender ${renderResTag} penuh…`
    : mediaKind === 'image'
      ? isProcessing
        ? 'Memproses Foto…'
        : hasHighResPhoto || likelyMobile
          ? 'Simpan Foto HD'
          : 'Simpan Foto'
      : isProcessing
        ? 'Memproses HD…'
        : 'Simpan Video HD';

  const formatShort =
    outputMime && outputMime.startsWith('image/')
      ? formatOutputMimeShort(outputMime as 'image/jpeg' | 'image/webp' | 'image/png' | 'image/avif')
      : outputMime?.replace('video/', '').toUpperCase() ?? null;

  const helperSpec = activeHelperPlatform ? PLATFORM_SHARE_META[activeHelperPlatform] : null;

  return (
    <div className="flex flex-col gap-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:gap-2.5 lg:gap-2 sm:pb-0">
      <Button
        variant="primary"
        size="lg"
        data-testid={mediaKind === 'image' ? 'download-photo-btn' : 'download-video-btn'}
        disabled={!canExport}
        onClick={() => void handleDownload()}
        className="min-h-[48px] w-full max-w-full overflow-hidden rounded-full font-semibold sm:min-h-[46px] lg:min-h-[44px]"
      >
        <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{downloadLabel}</span>
      </Button>

      {likelyMobile ? (
        <Button
          variant="secondary"
          size="md"
          data-testid="whatsapp-share-btn"
          disabled={!canExport || sharing}
          onClick={() => void handleSharePlatform('whatsapp')}
          className="glass-inner-rim min-h-[44px] w-full max-w-full overflow-hidden rounded-full"
        >
          <Share2 className="h-4 w-4 shrink-0 text-[var(--text-primary)]" aria-hidden="true" />
          <span className="truncate">{preparingFullRes ? `Merender ${renderResTag} penuh…` : 'Bagikan'}</span>
        </Button>
      ) : (
        <div className="grid grid-cols-3 gap-2.5" role="group" aria-label="Kirim cepat ke aplikasi">
          <Button
            variant="secondary"
            size="sm"
            data-testid="whatsapp-share-btn"
            disabled={!canExport || sharing}
            onClick={() => void handleSharePlatform('whatsapp')}
            className="glass-inner-rim min-h-[42px] min-w-0 max-w-full overflow-hidden rounded-full px-2 text-[11px] font-semibold lg:min-h-[38px]"
          >
            <span className="truncate">WhatsApp</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-testid="instagram-share-btn"
            disabled={!canExport || sharing}
            onClick={() => void handleSharePlatform('instagram')}
            className="glass-inner-rim min-h-[42px] min-w-0 max-w-full overflow-hidden rounded-full px-2 text-[11px] font-semibold lg:min-h-[38px]"
          >
            <span className="truncate">Instagram</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-testid="tiktok-share-btn"
            disabled={!canExport || sharing}
            onClick={() => void handleSharePlatform('tiktok')}
            className="glass-inner-rim min-h-[42px] min-w-0 max-w-full overflow-hidden rounded-full px-2 text-[11px] font-semibold lg:min-h-[38px]"
          >
            <span className="truncate">TikTok</span>
          </Button>
        </div>
      )}

      {exportedWidth && exportedHeight && exportedBytes !== null && (
        <p
          data-testid="exported-dimensions-badge"
          className="glass-inner-rim max-w-full overflow-hidden break-words rounded-2xl border px-3.5 py-2 text-center text-[11px] font-medium leading-relaxed text-[var(--text-secondary)] tabular-nums lg:py-1.5 lg:text-[10.5px]"
        >
          {needsFullResPreparation
            ? `Pratinjau cepat (${exportedWidth}×${exportedHeight}) · Hasil penuh dirender saat simpan`
            : `Output: ${exportedWidth} × ${exportedHeight} px · ${formatBytes(exportedBytes)}${formatShort ? ` · ${formatShort}` : ''}`}
        </p>
      )}

      {likelyMobile && isWhatsAppPreset && (
        <p
          data-testid="ios-wa-hd-tip"
          className="rounded-2xl border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-3.5 py-2.5 text-[11px] leading-relaxed text-[var(--status-warn-ink)]"
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
          className="glass-inner-rim min-h-[44px] w-full rounded-full py-2 tabular-nums"
        >
          <FileArchive className="h-4 w-4 shrink-0 text-[var(--text-primary)]" aria-hidden="true" />
          <span className="truncate">
            {zipping
              ? batchStatusLabel || 'Membuat arsip ZIP…'
              : `Simpan Semua (ZIP · ${finishedBatchItems.length} file)`}
          </span>
        </Button>
      )}

      {savedSummaryMsg && (
        <p
          data-testid="download-confirmed-msg"
          className="glass-sheet-modal flex items-center justify-center gap-2 break-words rounded-2xl border border-[var(--status-ok-border)] px-4 py-2.5 text-center text-[11px] font-semibold leading-snug text-[var(--status-ok-ink)] tabular-nums"
        >
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{savedSummaryMsg}</span>
        </p>
      )}

      {zipDoneMsg && (
        <p
          data-testid="zip-confirmed-msg"
          className="glass-sheet-modal flex items-center justify-center gap-2 break-words rounded-2xl border border-[var(--status-ok-border)] px-4 py-2.5 text-center text-[11px] font-semibold leading-snug text-[var(--status-ok-ink)] tabular-nums"
        >
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{zipDoneMsg}</span>
        </p>
      )}

      {helperSpec && (
        <div
          data-testid={
            helperSpec.id === 'whatsapp' ? 'whatsapp-web-helper' : 'platform-share-helper'
          }
          data-platform={helperSpec.id}
          className="glass-inner-rim mt-1 flex flex-col gap-2.5 rounded-2xl border p-3.5 text-xs text-[var(--text-secondary)]"
        >
          <p className="leading-relaxed">{helperSpec.helperText}</p>
          <p className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-primary)]">
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
            className="glass-inner-rim inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border px-3.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-subtle)]"
          >
            <span>{helperSpec.openLabel}</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  );
}
