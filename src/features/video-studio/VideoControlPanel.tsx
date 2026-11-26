import { useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Download,
  ImagePlus,
  Play,
  RotateCcw,
  Scissors,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { Button } from '../../design-system/components/Button';
import { SegmentedTabs } from '../../design-system/components/SegmentedTabs';
import type {
  VideoEditState,
  VideoMetadata,
  VideoProcessProgress,
  VideoProcessResult,
  VideoQualityTier,
} from '../../engines/contracts';
import { clampTrimRange } from '../../engines/video/videoPresets';
import { MEDIA_PRESETS, type MediaPresetId } from '../../presets/mediaPresets';
import { formatDuration } from '../../shared/utils/formatDuration';
import type { VideoProcessStatus } from '../../store/useMediaStore';
import { ExportSharePanel } from '../export-share/ExportSharePanel';

type VideoTabId = 'optimasi' | 'potong' | 'audio';

export interface CapturedFrameInfo {
  file: File;
  url: string;
}

export interface VideoControlPanelProps {
  metadata: VideoMetadata;
  selectedPresetId: MediaPresetId;
  videoEdit: VideoEditState;
  videoProcessStatus: VideoProcessStatus;
  videoProgress: VideoProcessProgress | null;
  videoProcessResult: VideoProcessResult | null;
  processedVideoUrl: string | null;
  videoProcessError: string | null;
  capturedFrame: CapturedFrameInfo | null;
  onSelectPreset: (id: MediaPresetId) => void;
  onUpdateVideoEdit: (patch: Partial<VideoEditState>) => void;
  onStartProcess: () => void;
  onCancelProcess: () => void;
  onSeekPreview: (timeSec: number) => void;
  onCaptureFrame: () => void;
  onEditCapturedFrameAsPhoto: () => void;
}

const VIDEO_TABS = [
  { id: 'optimasi' as const, label: 'Optimasi' },
  { id: 'potong' as const, label: 'Potong' },
  { id: 'audio' as const, label: 'Audio & Frame' },
];

const RESOLUTION_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'Asli' },
  { value: 1080, label: '1080p' },
  { value: 720, label: '720p' },
  { value: 480, label: '480p' },
];

const QUALITY_TIER_OPTIONS: ReadonlyArray<{ value: VideoQualityTier; label: string }> = [
  { value: 'light', label: 'Ringan' },
  { value: 'balanced', label: 'Seimbang' },
  { value: 'high', label: 'Tinggi' },
];

function getStageLabel(progress: VideoProcessProgress | null): string {
  if (!progress) return 'Menyiapkan pemrosesan video…';
  if (progress.detail) return progress.detail;
  switch (progress.stage) {
    case 'probing':
      return 'Memeriksa dukungan video perangkat…';
    case 'loading-core':
      return 'Memuat modul pengolah video…';
    case 'demuxing':
      return 'Membaca trek video…';
    case 'transcoding':
      return 'Memproses video…';
    case 'muxing':
    case 'finalizing':
      return 'Menyimpan file MP4…';
  }
}

export function VideoControlPanel({
  metadata,
  selectedPresetId,
  videoEdit,
  videoProcessStatus,
  videoProgress,
  videoProcessResult,
  processedVideoUrl,
  videoProcessError,
  capturedFrame,
  onSelectPreset,
  onUpdateVideoEdit,
  onStartProcess,
  onCancelProcess,
  onSeekPreview,
  onCaptureFrame,
  onEditCapturedFrameAsPhoto,
}: VideoControlPanelProps) {
  const [activeTab, setActiveTab] = useState<VideoTabId>('optimasi');
  const isProcessing = videoProcessStatus === 'processing';
  const isLargeVideo = metadata.sizeBytes > 150 * 1024 * 1024;

  const trim = clampTrimRange(
    videoEdit.trimStartSec,
    videoEdit.trimEndSec,
    metadata.durationSec
  );

  const progressPct = videoProgress ? Math.round(videoProgress.ratio * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <SegmentedTabs
        items={VIDEO_TABS}
        value={activeTab}
        onChange={setActiveTab}
        ariaLabel="Mode pengeditan video"
      />

      {isLargeVideo && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-3 py-2.5 text-xs text-[var(--status-warn-ink)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="leading-relaxed">
            Video berukuran besar. Pemrosesan di browser mungkin memerlukan waktu lebih lama atau
            memori tinggi.
          </p>
        </div>
      )}

      {activeTab === 'optimasi' && (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-xs font-semibold text-[var(--text-primary)]">Pilih Tujuan</h2>
            <div
              className="mt-2 grid grid-cols-2 gap-2"
              role="radiogroup"
              aria-label="Pilih tujuan video"
            >
              {MEDIA_PRESETS.map((preset, idx) => {
                const selected = preset.id === selectedPresetId;
                const spanFull = idx === MEDIA_PRESETS.length - 1;
                const label = preset.id === 'web-light' ? 'Ringan' : preset.label;
                const subtitle =
                  preset.id === 'web-light'
                    ? '480p hemat kuota'
                    : preset.id === 'whatsapp-status'
                      ? 'Optimal untuk 30 dtk'
                      : preset.targetLimitLabel;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={isProcessing}
                    data-testid={`preset-${preset.id}`}
                    onClick={() => onSelectPreset(preset.id)}
                    className={`flex min-h-[54px] flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition-all active:scale-[0.985] disabled:opacity-60 ${
                      spanFull ? 'col-span-2' : ''
                    } ${
                      selected
                        ? 'border-[var(--border-active)] bg-[var(--bg-subtle)] text-[var(--text-primary)]'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
                    }`}
                  >
                    <span className="text-xs font-semibold text-[var(--text-primary)]">{label}</span>
                    <span className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">
                      {subtitle}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3.5 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
            <div>
              <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                Resolusi
              </span>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                {RESOLUTION_OPTIONS.map((opt) => {
                  const active = videoEdit.maxHeightPx === opt.value;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      disabled={isProcessing}
                      data-testid={`video-res-${opt.value ?? 'original'}`}
                      aria-pressed={active}
                      onClick={() => onUpdateVideoEdit({ maxHeightPx: opt.value })}
                      className={`min-h-[36px] rounded-lg border text-xs font-medium tabular-nums transition-all active:scale-[0.98] disabled:opacity-50 ${
                        active
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-active)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                Kualitas
              </span>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {QUALITY_TIER_OPTIONS.map((opt) => {
                  const active = videoEdit.qualityTier === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isProcessing}
                      data-testid={`video-tier-${opt.value}`}
                      aria-pressed={active}
                      onClick={() => onUpdateVideoEdit({ qualityTier: opt.value })}
                      className={`min-h-[36px] rounded-lg border text-xs font-medium transition-all active:scale-[0.98] disabled:opacity-50 ${
                        active
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-active)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'potong' && (
        <div className="flex flex-col gap-3.5 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[var(--text-primary)]">Rentang Potongan</span>
            <span
              data-testid="trim-duration-badge"
              className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-primary)] tabular-nums"
            >
              Durasi: {trim.durationSec.toFixed(1).replace('.', ',')} dtk
            </span>
          </div>

          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--border-hairline)]">
            <div
              className="absolute inset-y-0 rounded-full bg-[var(--accent-primary)]"
              style={{
                left: `${metadata.durationSec > 0 ? (trim.startSec / metadata.durationSec) * 100 : 0}%`,
                width: `${metadata.durationSec > 0 ? (trim.durationSec / metadata.durationSec) * 100 : 100}%`,
              }}
            />
          </div>

          <label className="flex flex-col gap-1 text-xs">
            <div className="flex justify-between text-[var(--text-secondary)] tabular-nums">
              <span>Mulai</span>
              <span className="font-semibold text-[var(--text-primary)]">
                {formatDuration(trim.startSec)} ({trim.startSec.toFixed(1).replace('.', ',')} dtk)
              </span>
            </div>
            <input
              data-testid="trim-start-slider"
              type="range"
              min={0}
              max={Math.max(0, metadata.durationSec - 0.5)}
              step={0.1}
              disabled={isProcessing}
              value={trim.startSec}
              onChange={(e) => {
                const nextStart = Number(e.target.value);
                const nextEnd = Math.max(nextStart + 0.5, trim.endSec);
                onUpdateVideoEdit({ trimStartSec: nextStart, trimEndSec: nextEnd });
                onSeekPreview(nextStart);
              }}
              className="km-range-input w-full bg-[var(--border-hairline)]"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <div className="flex justify-between text-[var(--text-secondary)] tabular-nums">
              <span>Selesai</span>
              <span className="font-semibold text-[var(--text-primary)]">
                {formatDuration(trim.endSec)} ({trim.endSec.toFixed(1).replace('.', ',')} dtk)
              </span>
            </div>
            <input
              data-testid="trim-end-slider"
              type="range"
              min={Math.min(metadata.durationSec, 0.5)}
              max={metadata.durationSec}
              step={0.1}
              disabled={isProcessing}
              value={trim.endSec}
              onChange={(e) => {
                const nextEnd = Number(e.target.value);
                const nextStart = Math.min(trim.startSec, Math.max(0, nextEnd - 0.5));
                onUpdateVideoEdit({ trimStartSec: nextStart, trimEndSec: nextEnd });
                onSeekPreview(nextEnd);
              }}
              className="km-range-input w-full bg-[var(--border-hairline)]"
            />
          </label>

          <div className="flex flex-wrap gap-2 pt-1">
            {metadata.durationSec > 30 && (
              <Button
                variant="secondary"
                size="sm"
                disabled={isProcessing}
                data-testid="trim-30s-btn"
                onClick={() => {
                  const nextEnd = Math.min(metadata.durationSec, trim.startSec + 30);
                  onUpdateVideoEdit({ trimStartSec: trim.startSec, trimEndSec: nextEnd });
                }}
                className="flex-1"
              >
                <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Potong ke 30 detik</span>
              </Button>
            )}

            {trim.isTrimmed && (
              <Button
                variant="ghost"
                size="sm"
                disabled={isProcessing}
                data-testid="trim-reset-btn"
                onClick={() =>
                  onUpdateVideoEdit({ trimStartSec: 0, trimEndSec: metadata.durationSec })
                }
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Reset Potongan</span>
              </Button>
            )}
          </div>
        </div>
      )}

      {activeTab === 'audio' && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled={isProcessing}
            data-testid="mute-audio-toggle"
            aria-pressed={videoEdit.muteAudio}
            onClick={() => onUpdateVideoEdit({ muteAudio: !videoEdit.muteAudio })}
            className={`flex min-h-[46px] items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
              videoEdit.muteAudio
                ? 'border-[var(--border-active)] bg-[var(--bg-subtle)]'
                : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)]'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {videoEdit.muteAudio ? (
                <VolumeX className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
              ) : (
                <Volume2 className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
              )}
              <div>
                <div className="text-xs font-semibold text-[var(--text-primary)]">Bisukan audio</div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  {videoEdit.muteAudio ? 'Video hasil tanpa suara' : 'Audio dipertahankan'}
                </div>
              </div>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                videoEdit.muteAudio
                  ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                  : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
              }`}
            >
              {videoEdit.muteAudio ? 'Aktif' : 'Nonaktif'}
            </span>
          </button>

          <div className="flex flex-col gap-2.5 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
            <div className="text-xs font-semibold text-[var(--text-primary)]">
              Ambil Foto dari Frame
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
              Jeda video pada momen yang diinginkan lalu tangkap menjadi gambar HD.
            </p>
            <Button
              variant="secondary"
              size="md"
              data-testid="capture-frame-btn"
              onClick={onCaptureFrame}
              className="min-h-[42px] w-full text-xs"
            >
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Ambil Foto dari Frame Ini</span>
            </Button>

            {capturedFrame && (
              <div
                data-testid="captured-frame-card"
                className="mt-1 flex flex-col gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-2.5"
              >
                <img
                  src={capturedFrame.url}
                  alt="Hasil tangkapan frame video"
                  className="max-h-28 w-full rounded-lg object-contain bg-black"
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <a
                    href={capturedFrame.url}
                    download={capturedFrame.file.name}
                    data-testid="download-frame-link"
                    className="inline-flex min-h-[36px] items-center justify-center gap-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2 text-[11px] font-semibold text-[var(--text-primary)] hover:border-[var(--border-active)]"
                  >
                    <Download className="h-3 w-3" aria-hidden="true" />
                    <span>Unduh PNG</span>
                  </a>
                  <button
                    type="button"
                    data-testid="edit-frame-as-photo-btn"
                    onClick={onEditCapturedFrameAsPhoto}
                    className="inline-flex min-h-[36px] items-center justify-center gap-1 rounded-lg bg-[var(--accent-primary)] px-2 text-[11px] font-semibold text-[var(--ink-on-accent)] hover:bg-[var(--accent-primary-hover)]"
                  >
                    <ImagePlus className="h-3 w-3" aria-hidden="true" />
                    <span>Edit di Studio Foto</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action / Progress / Export */}
      <div className="border-t border-[var(--border-hairline)] pt-4">
        <h2 className="text-xs font-semibold text-[var(--text-primary)]">Simpan &amp; Bagikan</h2>

        {videoProcessError && (
          <div
            role="alert"
            data-testid="video-error-alert"
            className="mt-2 rounded-xl border border-[var(--status-err-border)] bg-[var(--status-err-bg)] px-3 py-2 text-xs text-[var(--status-err-ink)]"
          >
            {videoProcessError}
          </div>
        )}

        {videoProcessStatus === 'cancelled' && (
          <p
            data-testid="video-cancelled-msg"
            className="mt-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]"
          >
            Pemrosesan video dibatalkan. Anda dapat mengubah pengaturan lalu memulai ulang.
          </p>
        )}

        {isProcessing ? (
          <div
            data-testid="video-progress-box"
            className="mt-2.5 flex flex-col gap-2.5 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-[var(--text-primary)]">
                {getStageLabel(videoProgress)}
              </span>
              <span
                data-testid="video-progress-pct"
                className="font-semibold text-[var(--accent-primary)] tabular-nums"
              >
                {progressPct}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border-hairline)]">
              <div
                className="h-full rounded-full bg-[var(--accent-primary)] transition-all duration-150"
                style={{ width: `${Math.max(4, progressPct)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] tabular-nums">
              <span>
                Waktu berjalan:{' '}
                {videoProgress ? (videoProgress.elapsedMs / 1000).toFixed(1).replace('.', ',') : '0,0'} dtk
              </span>
            </div>
            <Button
              variant="danger"
              size="md"
              data-testid="cancel-video-btn"
              onClick={onCancelProcess}
              className="min-h-[42px] w-full"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              <span>Batalkan</span>
            </Button>
          </div>
        ) : (
          <div className="mt-2.5 flex flex-col gap-2.5">
            {videoProcessResult && processedVideoUrl && (
              <ExportSharePanel
                mediaKind="video"
                readyBlob={videoProcessResult.outputBlob}
                readyUrl={processedVideoUrl}
                outputFileName={videoProcessResult.outputFileName}
                outputMime={videoProcessResult.outputMime}
              />
            )}

            <Button
              variant={videoProcessResult ? 'secondary' : 'primary'}
              size="lg"
              data-testid="process-video-btn"
              onClick={onStartProcess}
              className="min-h-[44px] w-full"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              <span>{videoProcessResult ? 'Proses Ulang Video' : 'Proses Video'}</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
