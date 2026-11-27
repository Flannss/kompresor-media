import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  Camera,
  Captions,
  Check,
  ChevronDown,
  Download,
  Focus,
  ImagePlus,
  Lock,
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
  ColorGradeId,
  SubtitleCue,
  SubtitlePosition,
  SubtitleSize,
  VideoClarityModel,
  VideoEditState,
  VideoMetadata,
  VideoOutputFormat,
  VideoProcessProgress,
  VideoProcessResult,
  VideoQualityTier,
  VideoTargetResolution,
} from '../../engines/contracts';
import {
  applyEnhanceRecipe,
  createDefaultEnhanceSuite,
  hasActiveColorGrade,
  hasActiveEnhancements,
} from '../../engines/shared/colorGrades';
import { parseSubtitleText } from '../../engines/video/subtitleParser';
import { clampTrimRange, resolveCustomVideoParams } from '../../engines/video/videoPresets';
import {
  getMediaPreset,
  VIDEO_PRESET_IDS,
  type MediaPresetId,
} from '../../presets/mediaPresets';
import type { DeviceProfile } from '../../shared/utils/deviceCapability';
import { formatDuration } from '../../shared/utils/formatDuration';
import type { VideoProcessStatus } from '../../store/useMediaStore';
import type { ZipEntryInput } from '../export-share/zipExport';
import { ExportSharePanel } from '../export-share/ExportSharePanel';
import { EnhanceAndGradePanel } from '../workspace/EnhanceAndGradePanel';

type VideoTabId = 'utama' | 'tampilan' | 'lanjutan';

export interface CapturedFrameInfo {
  file: File;
  url: string;
}

export interface VideoControlPanelProps {
  metadata: VideoMetadata;
  deviceProfile: DeviceProfile;
  selectedPresetId: MediaPresetId;
  videoEdit: VideoEditState;
  baseThumbnailUrl: string | null;
  onRequestThumbnail: () => void;
  holdOriginalActive: boolean;
  onHoldOriginalChange: (held: boolean) => void;
  videoProcessStatus: VideoProcessStatus;
  videoProgress: VideoProcessProgress | null;
  videoProcessResult: VideoProcessResult | null;
  processedVideoUrl: string | null;
  videoProcessError: string | null;
  capturedFrame: CapturedFrameInfo | null;
  finishedBatchItems: ZipEntryInput[];
  batchStatusLabel?: string | null;
  onPrepareAllZipItems?: () => Promise<ZipEntryInput[]>;
  onSelectPreset: (id: MediaPresetId) => void;
  onUpdateVideoEdit: (patch: Partial<VideoEditState>) => void;
  onSelectColorGrade: (gradeId: ColorGradeId) => void;
  onStartProcess: () => void;
  onCancelProcess: () => void;
  onSeekPreview: (timeSec: number) => void;
  onCaptureFrame: () => void;
  onEditCapturedFrameAsPhoto: () => void;
}

const VIDEO_TABS = [
  { id: 'utama' as const, label: '1. Tujuan' },
  { id: 'tampilan' as const, label: '2. Jernihkan & Warna', mobileLabel: '2. Jernihkan' },
  { id: 'lanjutan' as const, label: '3. Potong & Audio', mobileLabel: '3. Potong' },
];

const VIDEO_FORMAT_OPTIONS: ReadonlyArray<{ value: VideoOutputFormat; label: string }> = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mov', label: 'MOV' },
  { value: 'webm', label: 'WebM' },
  { value: 'mkv', label: 'MKV' },
];

const RESOLUTION_OPTIONS: ReadonlyArray<{
  value: VideoTargetResolution;
  maxHeightPx: number | null;
  label: string;
}> = [
  { value: 'original', maxHeightPx: null, label: 'Asli' },
  { value: '720p', maxHeightPx: 720, label: '720p' },
  { value: '1080p', maxHeightPx: 1080, label: '1080p HD' },
  { value: '2k', maxHeightPx: 1440, label: '2K 1440p' },
];

const VIDEO_CLARITY_MODELS: ReadonlyArray<{
  id: VideoClarityModel;
  title: string;
  desc: string;
}> = [
  {
    id: 'original',
    title: 'Asli (Hemat)',
    desc: 'Lanczos + BT.709 murni, pertahankan tekstur asli',
  },
  {
    id: 'natural-hd',
    title: 'Natural HD',
    desc: 'Bersih halus + anti-buram siap kompres WA/IG',
  },
  {
    id: 'sharp-1080p',
    title: 'Tajam 1080p',
    desc: 'Pulihkan detail teks, objek, & rekaman buram',
  },
  {
    id: 'low-light',
    title: 'Malam & Minim Cahaya',
    desc: 'Redam bintik gelap + angkat bayangan bersih',
  },
];

const FPS_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'Asli' },
  { value: 60, label: '60' },
  { value: 30, label: '30' },
  { value: 24, label: '24' },
];

const QUALITY_TIER_OPTIONS: ReadonlyArray<{ value: VideoQualityTier; label: string }> = [
  { value: 'light', label: 'Ringan' },
  { value: 'balanced', label: 'Seimbang' },
  { value: 'high', label: 'Tinggi' },
];

const AUDIO_CLARITY_OPTIONS: ReadonlyArray<{ kbps: AudioBitrateKbps; label: string }> = [
  { kbps: 128, label: '128k' },
  { kbps: 160, label: '160k' },
  { kbps: 192, label: '192k' },
  { kbps: 320, label: '320k' },
];

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

function formatVideoEngineStatus(progress: VideoProcessProgress | null, pct: number): string {
  const modeLabel =
    progress?.backend === 'ffmpeg-wasm-st'
      ? 'Mode CPU'
      : progress?.backend === 'mediarecorder-native'
        ? 'Mode Cepat Hardware HP'
        : 'Mode Cepat Hardware';
  if (
    progress &&
    progress.ratio >= 0.08 &&
    progress.ratio < 0.99 &&
    progress.elapsedMs >= 400
  ) {
    const remainingMs = (progress.elapsedMs * (1 - progress.ratio)) / progress.ratio;
    const etaSec = Math.max(1, Math.round(remainingMs / 1000));
    return `${modeLabel} · ${pct}% · ~${etaSec} dtk`;
  }
  return `${modeLabel} · ${pct}%`;
}

export function VideoControlPanel({
  metadata,
  deviceProfile,
  selectedPresetId,
  videoEdit,
  baseThumbnailUrl,
  onRequestThumbnail,
  holdOriginalActive,
  onHoldOriginalChange,
  videoProcessStatus,
  videoProgress,
  videoProcessResult,
  processedVideoUrl,
  videoProcessError,
  capturedFrame,
  finishedBatchItems,
  batchStatusLabel = null,
  onPrepareAllZipItems,
  onSelectPreset,
  onUpdateVideoEdit,
  onSelectColorGrade,
  onStartProcess,
  onCancelProcess,
  onSeekPreview,
  onCaptureFrame,
  onEditCapturedFrameAsPhoto,
}: VideoControlPanelProps) {
  const [activeTab, setActiveTab] = useState<VideoTabId>('utama');
  const [trimDrawerOpen, setTrimDrawerOpen] = useState(false);
  const [motionDrawerOpen, setMotionDrawerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState<'stabilize' | 'audio' | 'subtitle' | 'frame'>(
    'stabilize'
  );
  const [subError, setSubError] = useState<string | null>(null);
  const subFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (activeTab === 'tampilan') {
      onRequestThumbnail();
    }
  }, [activeTab, onRequestThumbnail]);

  const isProcessing = videoProcessStatus === 'processing';
  const isLargeVideo = metadata.sizeBytes > 150 * 1024 * 1024;
  const trim = clampTrimRange(
    videoEdit.trimStartSec,
    videoEdit.trimEndSec,
    metadata.durationSec
  );
  const progressPct = videoProgress ? Math.round(videoProgress.ratio * 100) : 0;

  const enhanceOrGradeActive =
    hasActiveEnhancements(videoEdit.enhanceSuite) || hasActiveColorGrade(videoEdit.colorGrade);

  const hasHeavyMobileFilters =
    deviceProfile.performanceTier === 'low-memory-mobile' &&
    (metadata.durationSec > 60 ||
      ((videoEdit.stabilize.enabled ||
        videoEdit.enhanceSuite.noise.enabled ||
        videoEdit.enhanceSuite.upscale1080.enabled) &&
        (metadata.durationSec > 25 || metadata.sizeBytes > 40 * 1024 * 1024)));

  const isMobile4kOrHighFps =
    (deviceProfile.isMobile || deviceProfile.isMobileViewport) &&
    (Math.max(metadata.width, metadata.height) >= 2560 || (metadata.fpsHint ?? 0) >= 50);

  const handleApplyMobileLightSettings = () => {
    const balancedParams = resolveCustomVideoParams('balanced');
    const defaults = createDefaultEnhanceSuite();
    onUpdateVideoEdit({
      outputFormat: 'mp4',
      targetResolution: '720p',
      maxHeightPx: 720,
      qualityTier: 'balanced',
      ...balancedParams,
      stabilize: { ...videoEdit.stabilize, enabled: false },
      enhanceSuite: {
        ...videoEdit.enhanceSuite,
        noise: defaults.noise,
        upscale1080: defaults.upscale1080,
      },
    });
  };

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
    <div className="flex flex-col gap-3.5">
      {/* Compact Composable Active Module Pills */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={isProcessing}
          data-testid="toggle-video-compress-btn"
          aria-pressed={videoEdit.compressEnabled}
          onClick={() => onUpdateVideoEdit({ compressEnabled: !videoEdit.compressEnabled })}
          className={`inline-flex min-h-[30px] items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
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
          aria-pressed={enhanceOrGradeActive}
          onClick={() => {
            if (!enhanceOrGradeActive) {
              onUpdateVideoEdit({
                enhanceSuite: applyEnhanceRecipe('hd-balanced', videoEdit.enhanceSuite),
              });
            } else if (hasActiveEnhancements(videoEdit.enhanceSuite)) {
              onUpdateVideoEdit({ enhanceSuite: createDefaultEnhanceSuite() });
            }
            setActiveTab('tampilan');
          }}
          className={`inline-flex min-h-[30px] items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
            enhanceOrGradeActive
              ? 'border-[var(--border-active)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
              : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-active)]'
          }`}
        >
          <Focus className="h-3 w-3" aria-hidden="true" />
          <span>Jernihkan</span>
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
            setActiveTab('lanjutan');
            setAdvancedOpen('stabilize');
          }}
          className={`inline-flex min-h-[30px] items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
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
          aria-pressed={videoEdit.audio.enabled || videoEdit.muteAudio}
          onClick={() => {
            onUpdateVideoEdit({
              audio: { ...videoEdit.audio, enabled: !videoEdit.audio.enabled },
            });
            setActiveTab('lanjutan');
            setAdvancedOpen('audio');
          }}
          className={`inline-flex min-h-[30px] items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
            videoEdit.audio.enabled || videoEdit.muteAudio
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
            setActiveTab('lanjutan');
            setAdvancedOpen('subtitle');
          }}
          className={`inline-flex min-h-[30px] items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
            videoEdit.subtitle.enabled
              ? 'border-[var(--border-active)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
              : 'border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-active)]'
          }`}
        >
          <Captions className="h-3 w-3" aria-hidden="true" />
          <span>Subtitle</span>
        </button>
      </div>

      {/* Strictly 3 Top-Level Studio Tabs */}
      <SegmentedTabs
        items={VIDEO_TABS}
        value={activeTab}
        onChange={setActiveTab}
        ariaLabel="Menu studio video"
      />

      {isMobile4kOrHighFps && (
        <p
          data-testid="mobile-4k60-hint"
          className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-[12px] leading-relaxed text-[var(--text-secondary)]"
        >
          Sumber 4K/60fps · otomatis diringkas ke 1080p 30fps agar cepat &amp; HP tetap adem.
          Potong durasi dulu bila perlu.
        </p>
      )}

      {isLargeVideo && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-3 py-2 text-xs text-[var(--status-warn-ink)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="leading-relaxed">
            Video berukuran besar. Pemrosesan di browser mungkin memerlukan waktu lebih lama.
          </p>
        </div>
      )}

      {hasHeavyMobileFilters && (
        <div
          data-testid="mobile-heavy-video-advisory"
          className="flex flex-col gap-2 rounded-xl border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-3 py-2.5 text-xs text-[var(--status-warn-ink)]"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="leading-relaxed">
              Video berdurasi panjang atau memakai efek berat di ponsel. Tetap pertahankan 1080p HD,
              atau aktifkan mode hemat RAM di bawah jika diperlukan.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={isProcessing}
            data-testid="apply-mobile-light-btn"
            onClick={handleApplyMobileLightSettings}
            className="min-h-[38px] self-start"
          >
            Mode Hemat RAM HP (720p)
          </Button>
        </div>
      )}

      {/* TAB 1: UTAMA */}
      {activeTab === 'utama' && (
        <div className="space-y-5 sm:space-y-4">
          <div className="space-y-2.5 sm:space-y-2">
            <div>
              <h2 className="text-xs font-semibold text-[var(--text-primary)]">Pilih Tujuan</h2>
              <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-muted)]">
                Pilih aplikasi tujuan agar ukuran &amp; ketajaman langsung pas.
              </p>
            </div>
            <div
              className="no-scrollbar -mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:grid-cols-2 md:gap-2 md:overflow-visible md:px-0 md:pb-0"
              role="radiogroup"
              aria-label="Pilih tujuan video"
            >
              {VIDEO_PRESET_IDS.map((id) => getMediaPreset(id)).map((preset) => {
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
                    className={`flex min-h-[48px] shrink-0 snap-start flex-col items-start justify-center whitespace-nowrap rounded-xl border px-3.5 py-2 text-left transition-all active:scale-[0.985] disabled:opacity-60 md:min-h-[52px] md:whitespace-normal md:px-3 ${
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

          <div className="space-y-4 rounded-2xl bg-[var(--bg-surface)]/80 p-3 sm:space-y-3 sm:border sm:border-[var(--border-hairline)] sm:bg-[var(--bg-elevated)] sm:p-3.5">
            <div>
              <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                Format Output
              </span>
              <div className="no-scrollbar -mx-1 mt-1.5 flex snap-x gap-2 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:grid-cols-4 md:gap-1.5 md:overflow-visible md:px-0 md:pb-0">
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
                      className={`min-h-[42px] min-w-[70px] shrink-0 snap-start whitespace-nowrap rounded-xl border px-3 text-xs font-semibold transition-all disabled:opacity-50 md:min-h-[36px] md:min-w-0 md:rounded-lg md:px-0 ${
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
                Resolusi Output
              </span>
              <div className="no-scrollbar -mx-1 mt-1.5 flex snap-x gap-2 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:grid-cols-4 md:gap-1.5 md:overflow-visible md:px-0 md:pb-0">
                {RESOLUTION_OPTIONS.map((opt) => {
                  const isLocked2k = opt.value === '2k' && !deviceProfile.allow2KVideoExport;
                  const active = videoEdit.targetResolution === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isProcessing || isLocked2k}
                      data-testid={`video-res-${opt.value}`}
                      aria-pressed={active}
                      title={
                        isLocked2k
                          ? 'Video 2K aktif di Laptop/Desktop agar memori HP tetap aman.'
                          : opt.label
                      }
                      onClick={() =>
                        onUpdateVideoEdit({
                          targetResolution: opt.value,
                          maxHeightPx: opt.maxHeightPx,
                        })
                      }
                      className={`inline-flex min-h-[44px] shrink-0 snap-start items-center justify-center gap-1 whitespace-nowrap rounded-xl border px-3.5 text-[11.5px] font-medium tabular-nums transition-all disabled:cursor-not-allowed disabled:opacity-45 md:min-h-[38px] md:rounded-lg md:px-1.5 md:text-[11px] ${
                        active
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-active)]'
                      }`}
                    >
                      <span>{opt.label}</span>
                      {isLocked2k && <Lock className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
              {!deviceProfile.allow2KVideoExport && (
                <p
                  data-testid="guard-2k-video-note"
                  className="mt-1.5 text-[10px] leading-snug text-[var(--text-muted)]"
                >
                  Video 2K aktif di Laptop/Desktop agar memori HP tetap aman.
                </p>
              )}
            </div>

            <div>
              <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                Kualitas Video
              </span>
              <div className="no-scrollbar -mx-1 mt-1.5 flex snap-x gap-2 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:grid-cols-3 md:gap-1.5 md:overflow-visible md:px-0 md:pb-0">
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
                      className={`min-h-[42px] min-w-[96px] shrink-0 snap-start whitespace-nowrap rounded-xl border px-3.5 text-xs font-medium transition-all disabled:opacity-50 md:min-h-[36px] md:min-w-0 md:rounded-lg md:px-0 ${
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

            {/* Expandable Kehalusan Gerak (FPS) */}
            <div className="border-t border-[var(--border-hairline)] pt-2">
              <button
                type="button"
                onClick={() => setMotionDrawerOpen((v) => !v)}
                className="flex w-full items-center justify-between text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <span>Kehalusan Gerak</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${
                    motionDrawerOpen ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
              </button>

              {motionDrawerOpen && (
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {FPS_OPTIONS.map((opt) => {
                    const active = videoEdit.fpsCap === opt.value;
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        disabled={isProcessing}
                        data-testid={`video-fps-${opt.value ?? 'original'}`}
                        onClick={() => onUpdateVideoEdit({ fpsCap: opt.value })}
                        className={`min-h-[32px] rounded-lg border text-[11px] font-medium tabular-nums transition-all disabled:opacity-50 ${
                          active
                            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                            : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                        }`}
                      >
                        {opt.value === null ? opt.label : `${opt.label} Gerak/dtk`}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Expandable Potong Durasi */}
          <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3">
            <button
              type="button"
              data-testid="video-trim-drawer-btn"
              onClick={() => setTrimDrawerOpen((v) => !v)}
              className="flex w-full items-center justify-between text-xs font-semibold text-[var(--text-primary)]"
            >
              <span className="flex items-center gap-1.5">
                <Scissors className="h-3.5 w-3.5 text-[var(--accent-highlight)]" aria-hidden="true" />
                <span>Potong Durasi</span>
              </span>
              <span className="flex items-center gap-2 text-[11px] text-[var(--accent-highlight)] tabular-nums">
                <span data-testid="trim-duration-badge">
                  {trim.durationSec.toFixed(1).replace('.', ',')} dtk
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-[var(--text-muted)] transition-transform ${
                    trimDrawerOpen ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
              </span>
            </button>

            {trimDrawerOpen && (
              <div className="mt-3 space-y-3 border-t border-[var(--border-hairline)] pt-3">
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--border-hairline)]">
                  <div
                    className="absolute inset-y-0 rounded-full bg-[var(--border-active)]"
                    style={{
                      left: `${metadata.durationSec > 0 ? (trim.startSec / metadata.durationSec) * 100 : 0}%`,
                      width: `${metadata.durationSec > 0 ? (trim.durationSec / metadata.durationSec) * 100 : 100}%`,
                    }}
                  />
                </div>

                <label className="block space-y-1 text-xs">
                  <div className="flex justify-between text-[var(--text-secondary)] tabular-nums">
                    <span>Mulai</span>
                    <span className="font-semibold text-[var(--text-primary)]">
                      {formatDuration(trim.startSec)}
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
                    className="km-range-input"
                  />
                </label>

                <label className="block space-y-1 text-xs">
                  <div className="flex justify-between text-[var(--text-secondary)] tabular-nums">
                    <span>Selesai</span>
                    <span className="font-semibold text-[var(--text-primary)]">
                      {formatDuration(trim.endSec)}
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
                    className="km-range-input"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
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
                      <span>Potong 30 detik</span>
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
          </div>
        </div>
      )}

      {/* TAB 2: TAMPILAN (Model Penjernih Video HD + 1080p HD Enhancer + 7 Live Color Grades) */}
      {activeTab === 'tampilan' && (
        <div className="space-y-4">
          <div className="space-y-3 rounded-[22px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="block text-xs font-semibold text-[var(--text-primary)]">
                  Model Penjernih Video
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-[var(--text-muted)]">
                  Pilih tingkat ketajaman agar video tetap bening setelah diunggah.
                </span>
              </div>
              <span className="shrink-0 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-highlight)]">
                {VIDEO_CLARITY_MODELS.find((m) => m.id === videoEdit.clarityModel)?.title ??
                  'Natural HD'}
              </span>
            </div>
            <div className="no-scrollbar -mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:grid-cols-2 md:gap-2 md:overflow-visible md:px-0 md:pb-0">
              {VIDEO_CLARITY_MODELS.map((model) => {
                const active = videoEdit.clarityModel === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    disabled={isProcessing}
                    data-testid={`video-clarity-model-${model.id}`}
                    aria-pressed={active}
                    onClick={() => onUpdateVideoEdit({ clarityModel: model.id })}
                    className={`flex min-h-[52px] min-w-[162px] shrink-0 snap-start flex-col items-start justify-center rounded-2xl border px-3.5 py-2 text-left transition-all md:min-w-0 md:px-3 ${
                      active
                        ? 'border-[var(--border-active)] bg-[var(--accent-gold-soft)] text-[var(--text-primary)] ring-1 ring-[var(--border-active)]'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span
                      className={`whitespace-nowrap text-xs font-semibold ${
                        active ? 'text-[var(--accent-highlight)]' : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {model.title}
                    </span>
                    <span className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-[var(--text-muted)]">
                      {model.desc}
                    </span>
                  </button>
                );
              })}
            </div>
            <Slider
              label="Kekuatan Penjernih"
              testId="slider-video-clarity-strength"
              min={0}
              max={100}
              step={5}
              defaultValue={80}
              value={videoEdit.clarityStrength}
              valueLabel={`${videoEdit.clarityStrength}%`}
              disabled={isProcessing}
              onChange={(val) => onUpdateVideoEdit({ clarityStrength: val })}
            />
          </div>

          <EnhanceAndGradePanel
            mediaKind="video"
            enhanceSuite={videoEdit.enhanceSuite}
            colorGrade={videoEdit.colorGrade}
            baseThumbnailUrl={baseThumbnailUrl}
            onRequestThumbnail={onRequestThumbnail}
            holdOriginalActive={holdOriginalActive}
            onHoldOriginalChange={onHoldOriginalChange}
            onUpdateEnhanceSuite={(nextSuite) => onUpdateVideoEdit({ enhanceSuite: nextSuite })}
            onUpdateColorGrade={(nextGrade) => onUpdateVideoEdit({ colorGrade: nextGrade })}
            onSelectColorGrade={onSelectColorGrade}
          />
        </div>
      )}

      {/* TAB 3: LANJUTAN (Stabilizer, Audio, Subtitle, Ambil Frame) */}
      {activeTab === 'lanjutan' && (
        <div className="space-y-2.5">
          {/* Card: Stabilkan Video */}
          <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  setAdvancedOpen((prev) => (prev === 'stabilize' ? 'audio' : 'stabilize'))
                }
                className="flex flex-1 items-center gap-1.5 text-left text-xs font-semibold text-[var(--text-primary)]"
              >
                <Activity className="h-3.5 w-3.5 text-[var(--accent-highlight)]" aria-hidden="true" />
                <span>Stabilkan Video</span>
              </button>
              <button
                type="button"
                role="switch"
                disabled={isProcessing}
                aria-checked={videoEdit.stabilize.enabled}
                onClick={() => {
                  onUpdateVideoEdit({
                    stabilize: { ...videoEdit.stabilize, enabled: !videoEdit.stabilize.enabled },
                  });
                  setAdvancedOpen('stabilize');
                }}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  videoEdit.stabilize.enabled
                    ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                    : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                }`}
              >
                {videoEdit.stabilize.enabled ? 'Aktif' : 'Nonaktif'}
              </button>
            </div>

            {advancedOpen === 'stabilize' && (
              <div data-testid="video-stabilize-card" className="mt-2.5 space-y-2 border-t border-[var(--border-hairline)] pt-2.5">
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
                          stabilize: { ...videoEdit.stabilize, enabled: true, mode: opt.value },
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
                <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                  Mengurangi guncangan kamera secara lokal. Tepi video disesuaikan otomatis agar
                  tetap mulus.
                </p>
              </div>
            )}
          </div>

          {/* Card: Audio & Suara */}
          <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3">
            <button
              type="button"
              onClick={() => setAdvancedOpen('audio')}
              className="flex w-full items-center justify-between text-xs font-semibold text-[var(--text-primary)]"
            >
              <span className="flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5 text-[var(--accent-highlight)]" aria-hidden="true" />
                <span>Audio &amp; Suara</span>
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-[var(--text-muted)] transition-transform ${
                  advancedOpen === 'audio' ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            {advancedOpen === 'audio' && (
              <div className="mt-2.5 space-y-3 border-t border-[var(--border-hairline)] pt-2.5">
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
                  className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition-colors ${
                    videoEdit.muteAudio
                      ? 'border-[var(--border-active)] bg-[var(--bg-subtle)]'
                      : 'border-[var(--border-hairline)] bg-[var(--bg-surface)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {videoEdit.muteAudio ? (
                      <VolumeX className="h-3.5 w-3.5 text-[var(--accent-highlight)]" aria-hidden="true" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
                    )}
                    <span className="text-xs font-medium text-[var(--text-primary)]">
                      Bisukan Suara Video
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-[var(--accent-highlight)]">
                    {videoEdit.muteAudio ? 'Ya' : 'Tidak'}
                  </span>
                </button>

                {!videoEdit.muteAudio && (
                  <div data-testid="audio-suite-card" className="space-y-2.5">
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
                          desc: 'Seimbangkan suara pelan & keras',
                        },
                        {
                          key: 'vocalClarity' as const,
                          testId: 'audio-vocal-toggle',
                          label: 'Jernihkan Vokal',
                          desc: 'Kurangi dengung & desis latar',
                        },
                        {
                          key: 'fadeInOut' as const,
                          testId: 'audio-fade-toggle',
                          label: 'Transisi Halus Awal & Akhir',
                          desc: 'Suara masuk & keluar perlahan',
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
                            className={`flex items-center justify-between rounded-xl border px-2.5 py-2 text-left transition-colors ${
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
                      label="Nada Rendah (Bass)"
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
                      label="Nada Tinggi (Treble)"
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
                        Kejernihan Audio
                      </span>
                      <div className="mt-1 grid grid-cols-4 gap-1">
                        {AUDIO_CLARITY_OPTIONS.map((opt) => (
                          <button
                            key={opt.kbps}
                            type="button"
                            disabled={isProcessing}
                            onClick={() =>
                              onUpdateVideoEdit({
                                audioBitrateKbps: opt.kbps,
                                audio: { ...videoEdit.audio, enabled: true, bitrateKbps: opt.kbps },
                              })
                            }
                            className={`min-h-[30px] rounded-lg border text-[11px] font-medium ${
                              videoEdit.audio.bitrateKbps === opt.kbps
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
              </div>
            )}
          </div>

          {/* Card: Subtitle / Teks Video */}
          <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3">
            <button
              type="button"
              onClick={() => setAdvancedOpen('subtitle')}
              className="flex w-full items-center justify-between text-xs font-semibold text-[var(--text-primary)]"
            >
              <span className="flex items-center gap-1.5">
                <Captions className="h-3.5 w-3.5 text-[var(--accent-highlight)]" aria-hidden="true" />
                <span>Subtitle / Teks Video ({videoEdit.subtitle.cues.length})</span>
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-[var(--text-muted)] transition-transform ${
                  advancedOpen === 'subtitle' ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            {advancedOpen === 'subtitle' && (
              <div className="mt-2.5 space-y-2.5 border-t border-[var(--border-hairline)] pt-2.5">
                <input
                  ref={subFileInputRef}
                  data-testid="subtitle-file-input"
                  type="file"
                  accept=".srt,.vtt,text/vtt,application/x-subrip"
                  onChange={(e) => void handleSubtitleUpload(e)}
                  className="sr-only"
                />

                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isProcessing}
                    data-testid="upload-subtitle-btn"
                    onClick={() => subFileInputRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Unggah .SRT/.VTT</span>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isProcessing}
                    data-testid="add-subtitle-cue-btn"
                    onClick={handleAddBlankCue}
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
                    Tampilan Teks
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
                      className={`min-h-[34px] rounded-lg border px-2 text-[11px] font-semibold ${
                        videoEdit.subtitle.mode === 'hardsub'
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                      }`}
                    >
                      Tanam di Video
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
                      className={`min-h-[34px] rounded-lg border px-2 text-[11px] font-semibold ${
                        videoEdit.subtitle.mode === 'softsub'
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                          : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                      }`}
                    >
                      Teks Terpisah
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
                            className={`min-h-[28px] rounded-md border text-[10px] font-semibold ${
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
                            className={`min-h-[28px] rounded-md border text-[10px] font-semibold ${
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
                  <div className="flex max-h-44 flex-col gap-1.5 overflow-y-auto pr-0.5">
                    {videoEdit.subtitle.cues.map((cue, idx) => (
                      <div
                        key={cue.id}
                        data-testid={`subtitle-cue-row-${idx}`}
                        className="flex flex-col gap-1 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-2"
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
          </div>

          {/* Card: Ambil Foto dari Frame */}
          <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3">
            <button
              type="button"
              onClick={() => setAdvancedOpen('frame')}
              className="flex w-full items-center justify-between text-xs font-semibold text-[var(--text-primary)]"
            >
              <span className="flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5 text-[var(--accent-highlight)]" aria-hidden="true" />
                <span>Ambil Foto dari Frame</span>
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-[var(--text-muted)] transition-transform ${
                  advancedOpen === 'frame' ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            {advancedOpen === 'frame' && (
              <div className="mt-2.5 space-y-2.5 border-t border-[var(--border-hairline)] pt-2.5">
                <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                  Tangkap momen yang tampil di layar menjadi foto PNG resolusi penuh.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="capture-frame-btn"
                  onClick={onCaptureFrame}
                  className="w-full"
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Ambil Foto dari Frame Ini</span>
                </Button>

                {capturedFrame && (
                  <div
                    data-testid="captured-frame-card"
                    className="flex flex-col gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-2.5"
                  >
                    <img
                      src={capturedFrame.url}
                      alt="Hasil tangkapan frame video"
                      className="max-h-24 w-full rounded-lg bg-black object-contain"
                    />
                    <div className="grid grid-cols-2 gap-1.5">
                      <a
                        href={capturedFrame.url}
                        download={capturedFrame.file.name}
                        data-testid="download-frame-link"
                        className="inline-flex min-h-[34px] items-center justify-center gap-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2 text-[11px] font-semibold text-[var(--text-primary)] hover:border-[var(--border-active)]"
                      >
                        <Download className="h-3 w-3" aria-hidden="true" />
                        <span>Unduh PNG</span>
                      </a>
                      <button
                        type="button"
                        data-testid="edit-frame-as-photo-btn"
                        onClick={onEditCapturedFrameAsPhoto}
                        className="inline-flex min-h-[34px] items-center justify-center gap-1 rounded-full bg-[var(--accent-primary)] px-2.5 text-[11px] font-semibold text-[var(--ink-on-accent)] hover:bg-[var(--accent-primary-hover)]"
                      >
                        <ImagePlus className="h-3 w-3" aria-hidden="true" />
                        <span>Edit di Studio Foto</span>
                      </button>
                    </div>
                  </div>
                )}
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
            <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)] tabular-nums">
              <span
                data-testid="video-engine-status"
                className="font-medium text-[var(--text-secondary)]"
              >
                {formatVideoEngineStatus(videoProgress, progressPct)}
              </span>
              <span>
                Waktu:{' '}
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
                exportedWidth={videoProcessResult.outputWidth}
                exportedHeight={videoProcessResult.outputHeight}
                exportedBytes={videoProcessResult.outputBytes}
                exportedFps={videoProcessResult.appliedFps ?? null}
                selectedPresetId={selectedPresetId}
                finishedBatchItems={finishedBatchItems}
                batchStatusLabel={batchStatusLabel}
                onPrepareAllZipItems={onPrepareAllZipItems}
              />
            )}

            <Button
              variant={videoProcessResult ? 'secondary' : 'primary'}
              size="lg"
              data-testid="process-video-btn"
              onClick={onStartProcess}
              className="min-h-[44px] w-full rounded-full font-semibold"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              <span>{videoProcessResult ? 'Proses Ulang Video HD' : 'Proses Video HD'}</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
