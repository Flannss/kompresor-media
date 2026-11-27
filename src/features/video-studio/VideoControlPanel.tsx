import { useRef, useState, type ChangeEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  Camera,
  Captions,
  Check,
  Download,
  Focus,
  ImagePlus,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { Button } from '../../design-system/components/Button';
import { SegmentedTabs } from '../../design-system/components/SegmentedTabs';
import { Slider } from '../../design-system/components/Slider';
import type {
  AudioBitrateKbps,
  EnhanceDenoiseMode,
  EnhanceIntensity,
  SubtitleCue,
  SubtitlePosition,
  SubtitleSize,
  VideoEditState,
  VideoMetadata,
  VideoOutputFormat,
  VideoProcessProgress,
  VideoProcessResult,
  VideoQualityTier,
} from '../../engines/contracts';
import { parseSubtitleText } from '../../engines/video/subtitleParser';
import { clampTrimRange } from '../../engines/video/videoPresets';
import { MEDIA_PRESETS, type MediaPresetId } from '../../presets/mediaPresets';
import { formatDuration } from '../../shared/utils/formatDuration';
import type { VideoProcessStatus } from '../../store/useMediaStore';
import type { ZipEntryInput } from '../export-share/zipExport';
import { ExportSharePanel } from '../export-share/ExportSharePanel';

type VideoTabId = 'optimasi' | 'potong' | 'audio' | 'subtitle';

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
  finishedBatchItems: ZipEntryInput[];
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
  { id: 'audio' as const, label: 'Audio' },
  { id: 'subtitle' as const, label: 'Subtitle' },
];

const VIDEO_FORMAT_OPTIONS: ReadonlyArray<{ value: VideoOutputFormat; label: string }> = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mov', label: 'MOV' },
  { value: 'webm', label: 'WebM' },
  { value: 'mkv', label: 'MKV' },
];

const RESOLUTION_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'Asli' },
  { value: 1080, label: '1080p' },
  { value: 720, label: '720p' },
  { value: 480, label: '480p' },
];

const FPS_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'Asli' },
  { value: 60, label: '60 fps' },
  { value: 30, label: '30 fps' },
  { value: 24, label: '24 fps' },
];

const QUALITY_TIER_OPTIONS: ReadonlyArray<{ value: VideoQualityTier; label: string }> = [
  { value: 'light', label: 'Ringan' },
  { value: 'balanced', label: 'Seimbang' },
  { value: 'high', label: 'Tinggi' },
];

const AUDIO_BITRATE_OPTIONS: ReadonlyArray<AudioBitrateKbps> = [96, 128, 192, 320];

function getStageLabel(progress: VideoProcessProgress | null): string {
  if (!progress) return 'Menyiapkan pemrosesan video…';
  if (progress.detail) return progress.detail;
  switch (progress.stage) {
    case 'probing':
      return 'Memeriksa dukungan video perangkat…';
    case 'loading-core':
      return 'Memuat modul pengolah video & audio…';
    case 'demuxing':
      return 'Membaca trek video…';
    case 'transcoding':
      return 'Memproses video…';
    case 'muxing':
    case 'finalizing':
      return 'Menyimpan file video hasil…';
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
  finishedBatchItems,
  onSelectPreset,
  onUpdateVideoEdit,
  onStartProcess,
  onCancelProcess,
  onSeekPreview,
  onCaptureFrame,
  onEditCapturedFrameAsPhoto,
}: VideoControlPanelProps) {
  const [activeTab, setActiveTab] = useState<VideoTabId>('optimasi');
  const [subError, setSubError] = useState<string | null>(null);
  const subFileInputRef = useRef<HTMLInputElement | null>(null);

  const isProcessing = videoProcessStatus === 'processing';
  const isLargeVideo = metadata.sizeBytes > 150 * 1024 * 1024;
  const trim = clampTrimRange(
    videoEdit.trimStartSec,
    videoEdit.trimEndSec,
    metadata.durationSec
  );
  const progressPct = videoProgress ? Math.round(videoProgress.ratio * 100) : 0;

  const handleSubtitleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSubError(null);
    const raw = await file.text();
    const parsed = parseSubtitleText(raw);
    if (parsed.length === 0) {
      setSubError(`File "${file.name}" tidak memiliki baris subtitle SRT/VTT yang valid.`);
      return;
    }
    onUpdateVideoEdit({
      subtitle: {
        ...videoEdit.subtitle,
        enabled: true,
        cues: parsed,
        sourceFileName: file.name,
      },
    });
  };

  const handleAddBlankCue = () => {
    const cues = videoEdit.subtitle.cues;
    const lastEnd = cues.length > 0 ? cues[cues.length - 1].endSec : 0;
    const nextStart = Math.min(Math.max(0, lastEnd + 0.1), Math.max(0, metadata.durationSec - 0.5));
    const nextEnd = Math.min(metadata.durationSec || nextStart + 2, nextStart + 2);
    const nextCue: SubtitleCue = {
      id: `cue-${Date.now()}-${cues.length + 1}`,
      startSec: Number(nextStart.toFixed(1)),
      endSec: Number(Math.max(nextStart + 0.5, nextEnd).toFixed(1)),
      text: 'Teks subtitle baru',
    };
    onUpdateVideoEdit({
      subtitle: {
        ...videoEdit.subtitle,
        enabled: true,
        cues: [...cues, nextCue],
      },
    });
  };

  const handleUpdateCue = (id: string, patch: Partial<SubtitleCue>) => {
    onUpdateVideoEdit({
      subtitle: {
        ...videoEdit.subtitle,
        cues: videoEdit.subtitle.cues.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      },
    });
  };

  const handleRemoveCue = (id: string) => {
    onUpdateVideoEdit({
      subtitle: {
        ...videoEdit.subtitle,
        cues: videoEdit.subtitle.cues.filter((c) => c.id !== id),
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Composable Multi-Select Tool Bar */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Modul Aktif (Bisa Digabung)
        </span>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={isProcessing}
            data-testid="toggle-video-compress-btn"
            aria-pressed={videoEdit.compressEnabled}
            onClick={() =>
              onUpdateVideoEdit({ compressEnabled: !videoEdit.compressEnabled })
            }
            className={`inline-flex min-h-[32px] items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
              videoEdit.compressEnabled
                ? 'border-[var(--border-active)] bg-[var(--bg-subtle)] text-[var(--text-primary)]'
                : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
            }`}
          >
            {videoEdit.compressEnabled && (
              <Check className="h-3 w-3 text-[var(--accent-highlight)]" aria-hidden="true" />
            )}
            <span>Kompres</span>
          </button>

          <button
            type="button"
            disabled={isProcessing}
            data-testid="toggle-video-enhance-btn"
            aria-pressed={videoEdit.enhance.enabled}
            onClick={() => {
              onUpdateVideoEdit({
                enhance: { ...videoEdit.enhance, enabled: !videoEdit.enhance.enabled },
              });
              setActiveTab('optimasi');
            }}
            className={`inline-flex min-h-[32px] items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
              videoEdit.enhance.enabled
                ? 'border-[var(--border-active)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-active)]'
            }`}
          >
            <Focus className="h-3 w-3" aria-hidden="true" />
            <span>Jernihkan HD</span>
          </button>

          <button
            type="button"
            disabled={isProcessing}
            data-testid="toggle-video-stabilize-btn"
            aria-pressed={videoEdit.stabilize.enabled}
            onClick={() => {
              onUpdateVideoEdit({
                stabilize: { ...videoEdit.stabilize, enabled: !videoEdit.stabilize.enabled },
              });
              setActiveTab('optimasi');
            }}
            className={`inline-flex min-h-[32px] items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
              videoEdit.stabilize.enabled
                ? 'border-[var(--border-active)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-active)]'
            }`}
          >
            <Activity className="h-3 w-3" aria-hidden="true" />
            <span>Stabilkan</span>
          </button>

          <button
            type="button"
            disabled={isProcessing}
            data-testid="toggle-video-audio-btn"
            aria-pressed={videoEdit.audio.enabled}
            onClick={() => {
              onUpdateVideoEdit({
                audio: { ...videoEdit.audio, enabled: !videoEdit.audio.enabled },
              });
              setActiveTab('audio');
            }}
            className={`inline-flex min-h-[32px] items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
              videoEdit.audio.enabled
                ? 'border-[var(--border-active)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-active)]'
            }`}
          >
            <Volume2 className="h-3 w-3" aria-hidden="true" />
            <span>Audio</span>
          </button>

          <button
            type="button"
            disabled={isProcessing}
            data-testid="toggle-video-subtitle-btn"
            aria-pressed={videoEdit.subtitle.enabled}
            onClick={() => {
              onUpdateVideoEdit({
                subtitle: { ...videoEdit.subtitle, enabled: !videoEdit.subtitle.enabled },
              });
              setActiveTab('subtitle');
            }}
            className={`inline-flex min-h-[32px] items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
              videoEdit.subtitle.enabled
                ? 'border-[var(--border-active)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-active)]'
            }`}
          >
            <Captions className="h-3 w-3" aria-hidden="true" />
            <span>Subtitle</span>
          </button>
        </div>
      </div>

      <SegmentedTabs
        items={VIDEO_TABS}
        value={activeTab}
        onChange={setActiveTab}
        ariaLabel="Mode pengeditan video"
      />

      {isLargeVideo && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-3 py-2 text-xs text-[var(--status-warn-ink)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="leading-relaxed">
            Video berukuran besar. Pemrosesan di browser mungkin memerlukan waktu dan memori lebih tinggi.
          </p>
        </div>
      )}

      {activeTab === 'optimasi' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-1">
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-xs font-semibold text-[var(--text-primary)]">Pilih Tujuan</h2>
              <div
                className="mt-2 grid grid-cols-2 gap-2"
                role="radiogroup"
                aria-label="Pilih tujuan video"
              >
                {MEDIA_PRESETS.map((preset) => {
                  const selected = preset.id === selectedPresetId;
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
                        selected
                          ? 'border-[var(--border-active)] bg-[var(--bg-subtle)] text-[var(--text-primary)]'
                          : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-active)]'
                      }`}
                    >
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        {preset.label}
                      </span>
                      <span className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">
                        {preset.targetLimitLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {videoEdit.enhance.enabled && (
              <div
                data-testid="video-enhance-card"
                className="flex flex-col gap-3 rounded-2xl border border-[var(--border-active)] bg-[var(--bg-subtle)] p-3.5"
              >
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  Jernihkan HD Video
                </span>

                <div>
                  <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                    Intensitas Ketajaman
                  </span>
                  <div className="mt-1 grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { value: 'light', label: 'Ringan' },
                        { value: 'balanced', label: 'Seimbang' },
                        { value: 'sharp', label: 'Tajam' },
                      ] as Array<{ value: EnhanceIntensity; label: string }>
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={isProcessing}
                        onClick={() =>
                          onUpdateVideoEdit({
                            enhance: { ...videoEdit.enhance, intensity: opt.value },
                          })
                        }
                        className={`min-h-[32px] rounded-lg border text-xs font-medium ${
                          videoEdit.enhance.intensity === opt.value
                            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                            : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                    Reduksi Noise Video
                  </span>
                  <div className="mt-1 grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { value: 'off', label: 'Mati' },
                        { value: 'subtle', label: 'Halus' },
                        { value: 'medium', label: 'Sedang' },
                      ] as Array<{ value: EnhanceDenoiseMode; label: string }>
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={isProcessing}
                        onClick={() =>
                          onUpdateVideoEdit({
                            enhance: { ...videoEdit.enhance, denoise: opt.value },
                          })
                        }
                        className={`min-h-[32px] rounded-lg border text-xs font-medium ${
                          videoEdit.enhance.denoise === opt.value
                            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                            : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <Slider
                  label="Kejernihan Kontras"
                  min={0}
                  max={100}
                  defaultValue={24}
                  disabled={isProcessing}
                  value={videoEdit.enhance.clarity}
                  onChange={(val) =>
                    onUpdateVideoEdit({
                      enhance: { ...videoEdit.enhance, clarity: val },
                    })
                  }
                />

                <div>
                  <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                    Perbesar HD (Maks 1080p)
                  </span>
                  <div className="mt-1 grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { value: 1, label: 'Asli' },
                        { value: 1.5, label: '1.5×' },
                        { value: 2, label: '2× HD' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={isProcessing}
                        onClick={() =>
                          onUpdateVideoEdit({
                            enhance: { ...videoEdit.enhance, upscaleFactor: opt.value },
                          })
                        }
                        className={`min-h-[32px] rounded-lg border text-xs font-medium tabular-nums ${
                          videoEdit.enhance.upscaleFactor === opt.value
                            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                            : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {videoEdit.stabilize.enabled && (
              <div
                data-testid="video-stabilize-card"
                className="flex flex-col gap-2.5 rounded-2xl border border-[var(--border-active)] bg-[var(--bg-subtle)] p-3.5"
              >
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  Stabilkan Video
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { value: 'light', label: 'Ringan' },
                      { value: 'medium', label: 'Sedang' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isProcessing}
                      data-testid={`stabilize-mode-${opt.value}`}
                      onClick={() =>
                        onUpdateVideoEdit({
                          stabilize: { ...videoEdit.stabilize, mode: opt.value },
                        })
                      }
                      className={`min-h-[34px] rounded-lg border text-xs font-medium ${
                        videoEdit.stabilize.mode === opt.value
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                  Mengurangi guncangan kamera secara lokal. Proses sedikit lebih lama dan tepi gambar
                  disesuaikan otomatis.
                </p>
                {metadata.durationSec > 60 && (
                  <p className="text-[11px] text-[var(--status-warn-ink)]">
                    Klip di atas 60 detik dapat memerlukan waktu proses lebih lama di perangkat seluler.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
            <div>
              <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                Format Output
              </span>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                {VIDEO_FORMAT_OPTIONS.map((opt) => {
                  const active = videoEdit.outputFormat === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isProcessing}
                      data-testid={`video-fmt-${opt.value}`}
                      aria-pressed={active}
                      onClick={() => onUpdateVideoEdit({ outputFormat: opt.value })}
                      className={`min-h-[36px] rounded-lg border text-xs font-semibold transition-all disabled:opacity-50 ${
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
                      className={`min-h-[36px] rounded-lg border text-xs font-medium tabular-nums transition-all disabled:opacity-50 ${
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
                Kualitas Kompresi
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
                      className={`min-h-[36px] rounded-lg border text-xs font-medium transition-all disabled:opacity-50 ${
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
                Kecepatan Frame (FPS)
              </span>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                {FPS_OPTIONS.map((opt) => {
                  const active = videoEdit.fpsCap === opt.value;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      disabled={isProcessing}
                      data-testid={`video-fps-${opt.value ?? 'original'}`}
                      onClick={() => onUpdateVideoEdit({ fpsCap: opt.value })}
                      className={`min-h-[34px] rounded-lg border text-[11px] font-medium tabular-nums transition-all disabled:opacity-50 ${
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
              className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-highlight)] tabular-nums"
            >
              Durasi: {trim.durationSec.toFixed(1).replace('.', ',')} dtk
            </span>
          </div>

          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--border-hairline)]">
            <div
              className="absolute inset-y-0 rounded-full bg-[var(--border-active)]"
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
            onClick={() =>
              onUpdateVideoEdit({
                muteAudio: !videoEdit.muteAudio,
                audio: { ...videoEdit.audio, muteAudio: !videoEdit.muteAudio },
              })
            }
            className={`flex min-h-[46px] items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
              videoEdit.muteAudio
                ? 'border-[var(--border-active)] bg-[var(--bg-subtle)]'
                : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)]'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {videoEdit.muteAudio ? (
                <VolumeX className="h-4 w-4 text-[var(--accent-highlight)]" aria-hidden="true" />
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

          {!videoEdit.muteAudio && (
            <div
              data-testid="audio-suite-card"
              className="flex flex-col gap-3 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5"
            >
              <Slider
                label="Volume"
                testId="slider-audio-volume"
                min={-12}
                max={12}
                step={0.5}
                defaultValue={0}
                value={videoEdit.audio.volumeDb}
                valueLabel={`${videoEdit.audio.volumeDb > 0 ? '+' : ''}${videoEdit.audio.volumeDb} dB`}
                disabled={isProcessing}
                onChange={(val) =>
                  onUpdateVideoEdit({
                    audio: { ...videoEdit.audio, enabled: true, volumeDb: val },
                  })
                }
              />

              <div className="grid grid-cols-1 gap-1.5">
                {[
                  {
                    key: 'normalize' as const,
                    testId: 'audio-normalize-toggle',
                    label: 'Normalisasi Suara',
                    desc: 'Seimbangkan bagian suara pelan & keras',
                  },
                  {
                    key: 'vocalClarity' as const,
                    testId: 'audio-vocal-toggle',
                    label: 'Kejernihan Vokal / Reduksi Bising',
                    desc: 'Kurangi dengung rendah & desis latar',
                  },
                  {
                    key: 'fadeInOut' as const,
                    testId: 'audio-fade-toggle',
                    label: 'Fade In / Fade Out',
                    desc: 'Haluskan transisi suara 0,5 detik awal & akhir',
                  },
                ].map((opt) => {
                  const active = videoEdit.audio[opt.key];
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={isProcessing}
                      data-testid={opt.testId}
                      aria-pressed={active}
                      onClick={() =>
                        onUpdateVideoEdit({
                          audio: {
                            ...videoEdit.audio,
                            enabled: true,
                            [opt.key]: !active,
                          },
                        })
                      }
                      className={`flex min-h-[40px] items-center justify-between rounded-xl border px-3 py-2 text-left transition-colors ${
                        active
                          ? 'border-[var(--border-active)] bg-[var(--bg-subtle)]'
                          : 'border-[var(--border-hairline)] bg-[var(--bg-surface)]'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="text-xs font-semibold text-[var(--text-primary)]">
                          {opt.label}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">{opt.desc}</div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          active
                            ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                            : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                        }`}
                      >
                        {active ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </button>
                  );
                })}
              </div>

              <Slider
                label="EQ Bass"
                testId="slider-audio-bass"
                min={-6}
                max={6}
                step={0.5}
                defaultValue={0}
                value={videoEdit.audio.bassDb}
                valueLabel={`${videoEdit.audio.bassDb > 0 ? '+' : ''}${videoEdit.audio.bassDb} dB`}
                disabled={isProcessing}
                onChange={(val) =>
                  onUpdateVideoEdit({
                    audio: { ...videoEdit.audio, enabled: true, bassDb: val },
                  })
                }
              />

              <Slider
                label="EQ Treble"
                testId="slider-audio-treble"
                min={-6}
                max={6}
                step={0.5}
                defaultValue={0}
                value={videoEdit.audio.trebleDb}
                valueLabel={`${videoEdit.audio.trebleDb > 0 ? '+' : ''}${videoEdit.audio.trebleDb} dB`}
                disabled={isProcessing}
                onChange={(val) =>
                  onUpdateVideoEdit({
                    audio: { ...videoEdit.audio, enabled: true, trebleDb: val },
                  })
                }
              />

              <div>
                <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                  Bitrate Audio
                </span>
                <div className="mt-1 grid grid-cols-4 gap-1.5">
                  {AUDIO_BITRATE_OPTIONS.map((br) => (
                    <button
                      key={br}
                      type="button"
                      disabled={isProcessing}
                      onClick={() =>
                        onUpdateVideoEdit({
                          audioBitrateKbps: br,
                          audio: { ...videoEdit.audio, enabled: true, bitrateKbps: br },
                        })
                      }
                      className={`min-h-[32px] rounded-lg border text-[11px] font-medium tabular-nums ${
                        videoEdit.audio.bitrateKbps === br
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                      }`}
                    >
                      {br}k
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* HD Frame Capture Card */}
          <div className="flex flex-col gap-2.5 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
            <div className="text-xs font-semibold text-[var(--text-primary)]">
              Ambil Foto dari Frame
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
              Jeda video pada momen yang diinginkan lalu tangkap menjadi foto PNG beresolusi penuh.
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
                  className="max-h-28 w-full rounded-lg bg-black object-contain"
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

      {activeTab === 'subtitle' && (
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              Subtitle (.SRT / .VTT)
            </span>
            <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
              {videoEdit.subtitle.cues.length} baris
            </span>
          </div>

          <input
            ref={subFileInputRef}
            data-testid="subtitle-file-input"
            type="file"
            accept=".srt,.vtt,text/vtt,application/x-subrip"
            onChange={(e) => void handleSubtitleUpload(e)}
            className="sr-only"
          />

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={isProcessing}
              data-testid="upload-subtitle-btn"
              onClick={() => subFileInputRef.current?.click()}
              className="min-h-[38px]"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Unggah .SRT / .VTT</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={isProcessing}
              data-testid="add-subtitle-cue-btn"
              onClick={handleAddBlankCue}
              className="min-h-[38px]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tambah Teks</span>
            </Button>
          </div>

          {subError && (
            <p className="rounded-lg border border-[var(--status-err-border)] bg-[var(--status-err-bg)] px-2.5 py-1.5 text-[11px] text-[var(--status-err-ink)]">
              {subError}
            </p>
          )}

          <div>
            <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
              Mode Subtitle
            </span>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={isProcessing}
                data-testid="sub-mode-hardsub"
                onClick={() =>
                  onUpdateVideoEdit({
                    subtitle: { ...videoEdit.subtitle, enabled: true, mode: 'hardsub' },
                  })
                }
                className={`min-h-[36px] rounded-lg border px-2 text-[11px] font-semibold ${
                  videoEdit.subtitle.mode === 'hardsub'
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                    : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                }`}
              >
                Tanam ke Video (Hardsub)
              </button>
              <button
                type="button"
                disabled={isProcessing}
                data-testid="sub-mode-softsub"
                onClick={() =>
                  onUpdateVideoEdit({
                    subtitle: { ...videoEdit.subtitle, enabled: true, mode: 'softsub' },
                  })
                }
                className={`min-h-[36px] rounded-lg border px-2 text-[11px] font-semibold ${
                  videoEdit.subtitle.mode === 'softsub'
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                    : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                }`}
              >
                Trek Subtitle (Softsub)
              </button>
            </div>
          </div>

          {videoEdit.subtitle.mode === 'hardsub' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="block text-[10px] font-medium text-[var(--text-muted)]">
                  Ukuran Teks
                </span>
                <div className="mt-1 grid grid-cols-3 gap-1">
                  {(
                    [
                      { id: 'small', label: 'Kecil' },
                      { id: 'medium', label: 'Sedang' },
                      { id: 'large', label: 'Besar' },
                    ] as Array<{ id: SubtitleSize; label: string }>
                  ).map((sz) => (
                    <button
                      key={sz.id}
                      type="button"
                      disabled={isProcessing}
                      onClick={() =>
                        onUpdateVideoEdit({
                          subtitle: { ...videoEdit.subtitle, size: sz.id },
                        })
                      }
                      className={`min-h-[30px] rounded-md border text-[10px] font-semibold ${
                        videoEdit.subtitle.size === sz.id
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                      }`}
                    >
                      {sz.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-[10px] font-medium text-[var(--text-muted)]">
                  Posisi
                </span>
                <div className="mt-1 grid grid-cols-3 gap-1">
                  {(
                    [
                      { id: 'bottom', label: 'Bawah' },
                      { id: 'center', label: 'Tengah' },
                      { id: 'top', label: 'Atas' },
                    ] as Array<{ id: SubtitlePosition; label: string }>
                  ).map((pos) => (
                    <button
                      key={pos.id}
                      type="button"
                      disabled={isProcessing}
                      onClick={() =>
                        onUpdateVideoEdit({
                          subtitle: { ...videoEdit.subtitle, position: pos.id },
                        })
                      }
                      className={`min-h-[30px] rounded-md border text-[10px] font-semibold ${
                        videoEdit.subtitle.position === pos.id
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                      }`}
                    >
                      {pos.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {videoEdit.subtitle.cues.length > 0 && (
            <div className="flex max-h-48 flex-col gap-2 overflow-y-auto pr-0.5">
              {videoEdit.subtitle.cues.map((cue, idx) => (
                <div
                  key={cue.id}
                  data-testid={`subtitle-cue-row-${idx}`}
                  className="flex flex-col gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-2"
                >
                  <div className="flex items-center justify-between gap-1.5 text-[11px] tabular-nums">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={cue.startSec}
                        aria-label={`Mulai baris ${idx + 1}`}
                        onChange={(e) =>
                          handleUpdateCue(cue.id, { startSec: Number(e.target.value) })
                        }
                        className="w-14 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
                      />
                      <span className="text-[var(--text-muted)]">–</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={cue.endSec}
                        aria-label={`Selesai baris ${idx + 1}`}
                        onChange={(e) =>
                          handleUpdateCue(cue.id, { endSec: Number(e.target.value) })
                        }
                        className="w-14 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
                      />
                      <span className="text-[10px] text-[var(--text-muted)]">dtk</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveCue(cue.id)}
                      aria-label={`Hapus subtitle ${idx + 1}`}
                      className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--status-err-ink)]"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={cue.text}
                    data-testid={`subtitle-cue-text-${idx}`}
                    aria-label={`Teks subtitle ${idx + 1}`}
                    onChange={(e) => handleUpdateCue(cue.id, { text: e.target.value })}
                    className="w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-primary)]"
                  />
                </div>
              ))}
            </div>
          )}
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

        {videoProcessResult?.notice && (
          <div className="mt-2 rounded-xl border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-3 py-2 text-xs text-[var(--status-warn-ink)]">
            {videoProcessResult.notice}
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
                className="font-semibold text-[var(--accent-highlight)] tabular-nums"
              >
                {progressPct}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border-hairline)]">
              <div
                className="h-full rounded-full bg-[var(--accent-highlight)] transition-all duration-150"
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
                finishedBatchItems={finishedBatchItems}
              />
            )}

            <Button
              variant={videoProcessResult ? 'secondary' : 'primary'}
              size="lg"
              data-testid="process-video-btn"
              onClick={onStartProcess}
              className="min-h-[44px] w-full font-semibold"
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
