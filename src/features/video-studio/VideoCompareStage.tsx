import { memo, useCallback, useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Columns2, Eye, Pause, Play, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
import type { SubtitleCue, VideoEditState, VideoProcessResult } from '../../engines/contracts';
import { hasActiveColorGrade } from '../../engines/shared/colorGrades';
import { computeTargetDimensions } from '../../engines/image/pixelOps';
import { releaseCanvasSurface } from '../../engines/image/pipelineRunner';
import { findActiveCuesAtTime } from '../../engines/video/subtitleParser';
import type { DeviceProfile } from '../../shared/utils/deviceCapability';
import { formatBytes } from '../../shared/utils/formatBytes';
import { formatDuration } from '../../shared/utils/formatDuration';
import { getBackdropClasses, type StageBackdrop } from '../workspace/BeforeAfterPreview';
import { LiveGradeSvgFilter, resolvePreviewFilterStyle } from '../workspace/LiveGradeSvgFilter';

export type VideoCompareViewMode = 'single' | 'side-by-side' | 'split';

export interface VideoCompareStageProps {
  itemId: string | null;
  sourceSizeBytes: number;
  videoWidth?: number;
  videoHeight?: number;
  deviceProfile: DeviceProfile;
  objectUrl: string;
  processedVideoUrl: string | null;
  videoEdit: VideoEditState;
  videoProcessResult: VideoProcessResult | null;
  backdrop: StageBackdrop;
  compareViewMode: VideoCompareViewMode;
  onChangeCompareViewMode: (mode: VideoCompareViewMode) => void;
  holdOriginalActive: boolean;
  onHoldOriginalChange: (held: boolean) => void;
  thumbnailRequested: boolean;
  baseThumbnailUrl: string | null;
  onBaseThumbnailReady: (itemId: string, url: string) => void;
  seekRequestSec: { sec: number; seq: number } | null;
  videoElementRef?: (el: HTMLVideoElement | null) => void;
}

const LiveSubtitleOverlay = memo(function LiveSubtitleOverlay({
  videoEl,
  cues,
  enabled,
  position,
  isSingleMode,
}: {
  videoEl: HTMLVideoElement | null;
  cues: SubtitleCue[];
  enabled: boolean;
  position: VideoEditState['subtitle']['position'];
  isSingleMode: boolean;
}) {
  const [activeCues, setActiveCues] = useState<SubtitleCue[]>([]);

  useEffect(() => {
    if (!videoEl || !enabled || cues.length === 0) {
      setActiveCues([]);
      return;
    }
    const update = () => {
      const next = findActiveCuesAtTime(cues, videoEl.currentTime || 0);
      setActiveCues((prev) => {
        if (prev.length === next.length && prev.every((c, idx) => c.id === next[idx]?.id)) {
          return prev;
        }
        return next;
      });
    };
    update();
    videoEl.addEventListener('timeupdate', update);
    videoEl.addEventListener('seeked', update);
    return () => {
      videoEl.removeEventListener('timeupdate', update);
      videoEl.removeEventListener('seeked', update);
    };
  }, [videoEl, cues, enabled]);

  if (!enabled || activeCues.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="live-subtitle-overlay"
      className={`pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-lg bg-[var(--surface-badge)] px-3 py-1.5 text-center text-xs font-semibold text-white shadow sm:text-sm ${position === 'top'
        ? 'top-4'
        : position === 'center'
          ? 'top-1/2 -translate-y-1/2'
          : isSingleMode
            ? 'bottom-12'
            : 'bottom-4'
        }`}
    >
      {activeCues.map((c) => c.text).join('\n')}
    </div>
  );
});

const VideoSyncTransportBar = memo(function VideoSyncTransportBar({
  primaryVideoEl,
  isPlaying,
  playbackRate,
  previewMuted,
  compareViewMode,
  splitPct,
  onTogglePlay,
  onSeekChange,
  onToggleRate,
  onToggleMute,
  onSplitPctChange,
}: {
  primaryVideoEl: HTMLVideoElement | null;
  isPlaying: boolean;
  playbackRate: 1 | 0.5;
  previewMuted: boolean;
  compareViewMode: VideoCompareViewMode;
  splitPct: number;
  onTogglePlay: () => void;
  onSeekChange: (sec: number) => void;
  onToggleRate: () => void;
  onToggleMute: () => void;
  onSplitPctChange: (pct: number) => void;
}) {
  const [timeSec, setTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);

  useEffect(() => {
    if (!primaryVideoEl) {
      setTimeSec(0);
      setDurationSec(0);
      return;
    }
    const syncMeta = () => {
      if (Number.isFinite(primaryVideoEl.duration)) {
        setDurationSec(primaryVideoEl.duration);
      }
      setTimeSec(primaryVideoEl.currentTime || 0);
    };
    const syncTime = () => {
      setTimeSec(primaryVideoEl.currentTime || 0);
    };
    syncMeta();
    primaryVideoEl.addEventListener('loadedmetadata', syncMeta);
    primaryVideoEl.addEventListener('durationchange', syncMeta);
    primaryVideoEl.addEventListener('timeupdate', syncTime);
    primaryVideoEl.addEventListener('seeked', syncTime);
    return () => {
      primaryVideoEl.removeEventListener('loadedmetadata', syncMeta);
      primaryVideoEl.removeEventListener('durationchange', syncMeta);
      primaryVideoEl.removeEventListener('timeupdate', syncTime);
      primaryVideoEl.removeEventListener('seeked', syncTime);
    };
  }, [primaryVideoEl]);

  const maxSeek = Math.max(0.1, durationSec);
  const clampedTime = Math.min(Math.max(0, timeSec), maxSeek);
  const seekPct = Math.min(100, Math.max(0, (clampedTime / maxSeek) * 100));

  return (
    <div
      data-testid="video-sync-transport"
      className="km-glass-lite flex w-full max-w-[820px] min-w-0 flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 text-xs tabular-nums"
    >
      <button
        type="button"
        data-testid="video-sync-play-btn"
        onClick={onTogglePlay}
        aria-label={isPlaying ? 'Jeda video' : 'Putar video'}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-primary)] text-[var(--ink-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)]"
      >
        {isPlaying ? (
          <Pause className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Play className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      <input
        type="range"
        data-testid="video-sync-seek"
        min={0}
        max={maxSeek}
        step={0.05}
        value={clampedTime}
        onChange={(e) => onSeekChange(Number(e.target.value))}
        aria-label="Posisi pemutaran video"
        className="km-range-input min-w-[110px] flex-1"
        style={{
          background: `linear-gradient(to right, var(--accent-primary) ${seekPct}%, var(--border-hairline) ${seekPct}%)`,
        }}
      />

      <span className="text-[11px] font-medium text-[var(--text-secondary)]">
        {formatDuration(timeSec)} / {formatDuration(durationSec)}
      </span>

      <button
        type="button"
        data-testid="video-sync-rate-btn"
        onClick={onToggleRate}
        className="min-h-[36px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 text-[11px] font-semibold text-[var(--text-primary)]"
      >
        {playbackRate === 1 ? '1×' : '0,5×'}
      </button>

      <button
        type="button"
        data-testid="video-sync-mute-btn"
        onClick={onToggleMute}
        aria-label={previewMuted ? 'Nyalakan suara pratinjau' : 'Bisukan suara pratinjau'}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        {previewMuted ? (
          <VolumeX className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Volume2 className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      {compareViewMode === 'split' && (
        <label className="ml-auto flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
          <span>Garis belah</span>
          <input
            data-testid="video-compare-slider"
            type="range"
            min={5}
            max={95}
            value={splitPct}
            onChange={(e) => onSplitPctChange(Number(e.target.value))}
            aria-label="Geser pembanding video Asli dan Sesudah"
            className="km-range-input w-24"
            style={{
              background: `linear-gradient(to right, var(--accent-primary) ${((splitPct - 5) / 90) * 100}%, var(--border-hairline) ${((splitPct - 5) / 90) * 100}%)`,
            }}
          />
          <span className="w-8 text-right font-semibold text-[var(--text-primary)]">
            {splitPct}%
          </span>
        </label>
      )}
    </div>
  );
});

function releaseDetachedVideoElement(vid: HTMLVideoElement): void {
  try {
    vid.pause();
    vid.removeAttribute('src');
    vid.load();
  } catch {
    // Ignore detached DOM cleanup errors
  }
}

export function VideoCompareStage({
  itemId,
  sourceSizeBytes,
  videoWidth,
  videoHeight,
  deviceProfile,
  objectUrl,
  processedVideoUrl,
  videoEdit,
  videoProcessResult,
  backdrop,
  compareViewMode,
  onChangeCompareViewMode,
  holdOriginalActive,
  onHoldOriginalChange,
  thumbnailRequested,
  baseThumbnailUrl,
  onBaseThumbnailReady,
  seekRequestSec,
  videoElementRef,
}: VideoCompareStageProps) {
  const reactFilterId = useId().replace(/[^a-zA-Z0-9_-]/g, '') || 'v';
  const filterDomId = `km-video-grade-${reactFilterId}`;

  const primaryVideoRef = useRef<HTMLVideoElement | null>(null);
  const secondaryVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoElementRefLatest = useRef(videoElementRef);
  videoElementRefLatest.current = videoElementRef;

  const splitBoxRef = useRef<HTMLDivElement | null>(null);
  const draggingSplitRef = useRef(false);
  const extractedKeyRef = useRef<string | null>(null);
  const lastTimeRef = useRef(0.05);

  const [primaryElState, setPrimaryElState] = useState<HTMLVideoElement | null>(null);
  const [singleSourceChoice, setSingleSourceChoice] = useState<'original' | 'result'>('original');
  const [splitPct, setSplitPct] = useState(50);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<1 | 0.5>(1);
  const [previewMuted, setPreviewMuted] = useState(false);
  const [processedPreviewUnsupported, setProcessedPreviewUnsupported] = useState(false);
  const [dualBlockedNotice, setDualBlockedNotice] = useState(false);

  const dualBlockedByMemory =
    deviceProfile.performanceTier === 'low-memory-mobile' &&
    sourceSizeBytes > deviceProfile.maxDualVideoBytes;

  const effectiveViewMode: VideoCompareViewMode =
    dualBlockedByMemory && compareViewMode !== 'single' ? 'single' : compareViewMode;

  const canPlayProcessedResult = Boolean(processedVideoUrl) && !processedPreviewUnsupported;
  const trimOffsetSec = canPlayProcessedResult ? Math.max(0, videoEdit.trimStartSec) : 0;

  const rawAspect =
    videoWidth && videoHeight && videoWidth > 0 && videoHeight > 0
      ? videoWidth / videoHeight
      : 16 / 9;
  const clampedAspect = Math.min(2.35, Math.max(0.45, rawAspect));
  const safeBackdrop: StageBackdrop = backdrop === 'checker' ? 'studio' : backdrop;

  useEffect(() => {
    if (dualBlockedByMemory && compareViewMode !== 'single') {
      setDualBlockedNotice(true);
      onChangeCompareViewMode('single');
    } else if (!dualBlockedByMemory) {
      setDualBlockedNotice(false);
    }
  }, [dualBlockedByMemory, compareViewMode, onChangeCompareViewMode]);

  useEffect(() => {
    setProcessedPreviewUnsupported(false);
    setSingleSourceChoice(processedVideoUrl ? 'result' : 'original');
  }, [processedVideoUrl]);

  useEffect(() => {
    setIsPlaying(false);
    setProcessedPreviewUnsupported(false);
    setSingleSourceChoice(processedVideoUrl ? 'result' : 'original');
    extractedKeyRef.current = null;
    lastTimeRef.current = 0.05;
  }, [objectUrl]);

  // Ref callbacks cleanly detach ONLY previously unmounted video elements (never newly mounted nodes)
  const bindPrimaryRef = useCallback((el: HTMLVideoElement | null) => {
    const prev = primaryVideoRef.current;
    if (prev && prev !== el) {
      releaseDetachedVideoElement(prev);
    }
    primaryVideoRef.current = el;
    setPrimaryElState(el);
    videoElementRefLatest.current?.(el);
  }, []);

  const bindSecondaryRef = useCallback((el: HTMLVideoElement | null) => {
    const prev = secondaryVideoRef.current;
    if (prev && prev !== el) {
      releaseDetachedVideoElement(prev);
    }
    if (el) {
      el.muted = true;
    }
    secondaryVideoRef.current = el;
  }, []);

  useEffect(() => {
    if (!seekRequestSec) return;
    const target = Math.max(0, seekRequestSec.sec);
    lastTimeRef.current = target;
    if (primaryVideoRef.current) {
      primaryVideoRef.current.currentTime = target;
    }
    if (secondaryVideoRef.current) {
      secondaryVideoRef.current.currentTime = Math.max(0, target + trimOffsetSec);
    }
  }, [seekRequestSec, trimOffsetSec]);

  // Throttled 180ms drift sync ONLY while actively playing in dual/split mode (zero idle RAF loops)
  useEffect(() => {
    if (effectiveViewMode === 'single' || !isPlaying) {
      return;
    }
    const timer = setInterval(() => {
      const pri = primaryVideoRef.current;
      const sec = secondaryVideoRef.current;
      if (!pri || !sec) return;
      if (Math.abs(sec.playbackRate - pri.playbackRate) > 0.01) {
        sec.playbackRate = pri.playbackRate;
      }
      const expectedSecTime = canPlayProcessedResult
        ? pri.currentTime + trimOffsetSec
        : pri.currentTime;
      const maxSecDur =
        Number.isFinite(sec.duration) && sec.duration > 0 ? sec.duration : expectedSecTime;
      const clampedTarget = Math.min(maxSecDur, Math.max(0, expectedSecTime));
      if (Math.abs(sec.currentTime - clampedTarget) > 0.12) {
        sec.currentTime = clampedTarget;
      }
      if (!pri.paused && sec.paused) {
        void sec.play().catch(() => { });
      } else if (pri.paused && !sec.paused) {
        sec.pause();
      }
    }, 180);

    return () => clearInterval(timer);
  }, [effectiveViewMode, isPlaying, canPlayProcessedResult, trimOffsetSec]);

  // Lazy single 96px thumbnail extraction ONLY when user opens the Jernihkan & Warna tab
  const tryExtractSingleThumbnail = (videoEl: HTMLVideoElement | null) => {
    if (!thumbnailRequested || !itemId || baseThumbnailUrl || !videoEl) return;
    const key = `${itemId}:${objectUrl}`;
    if (extractedKeyRef.current === key) return;
    if (videoEl.readyState < 2 || videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) return;

    extractedKeyRef.current = key;
    const dims = computeTargetDimensions(videoEl.videoWidth, videoEl.videoHeight, 96);
    const canvas = document.createElement('canvas');
    canvas.width = dims.width;
    canvas.height = dims.height;

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        releaseCanvasSurface(canvas);
        return;
      }
      ctx.drawImage(videoEl, 0, 0, dims.width, dims.height);
      canvas.toBlob(
        (blob) => {
          releaseCanvasSurface(canvas);
          if (blob) {
            onBaseThumbnailReady(itemId, URL.createObjectURL(blob));
          }
        },
        'image/jpeg',
        0.78
      );
    } catch {
      releaseCanvasSurface(canvas);
    }
  };

  useEffect(() => {
    if (thumbnailRequested && !baseThumbnailUrl && primaryVideoRef.current) {
      tryExtractSingleThumbnail(primaryVideoRef.current);
    }
  }, [thumbnailRequested, baseThumbnailUrl, objectUrl]);

  const activeColorContrast = videoEdit.enhanceSuite.colorContrast.enabled
    ? videoEdit.enhanceSuite.colorContrast
    : undefined;

  const basePreviewFilter = resolvePreviewFilterStyle({
    filterId: filterDomId,
    colorGrade: videoEdit.colorGrade,
    colorContrast: activeColorContrast,
    useLightweightCss: deviceProfile.useLightweightCssPreview,
  });

  const clarityStrengthNorm = Math.min(1, Math.max(0, (videoEdit.clarityStrength ?? 80) / 100));
  let clarityCssSuffix = '';
  if (clarityStrengthNorm > 0.01) {
    if (videoEdit.clarityModel === 'sharp-1080p') {
      clarityCssSuffix = `contrast(${(1 + 0.04 * clarityStrengthNorm).toFixed(3)}) saturate(${(1 + 0.05 * clarityStrengthNorm).toFixed(3)})`;
    } else if (videoEdit.clarityModel === 'low-light') {
      clarityCssSuffix = `brightness(${(1 + 0.06 * clarityStrengthNorm).toFixed(3)}) contrast(${(1 + 0.03 * clarityStrengthNorm).toFixed(3)}) saturate(${(1 + 0.04 * clarityStrengthNorm).toFixed(3)})`;
    }
  }
  const livePreviewCssOrSvg =
    [basePreviewFilter, clarityCssSuffix].filter(Boolean).join(' ').trim() || undefined;

  const isShowingProcessedInSingle =
    singleSourceChoice === 'result' && canPlayProcessedResult && !holdOriginalActive;
  const singleSrc = isShowingProcessedInSingle && processedVideoUrl ? processedVideoUrl : objectUrl;
  const shouldApplyLiveFilterToAfter = !canPlayProcessedResult && !holdOriginalActive;
  const afterVideoSrc = canPlayProcessedResult && processedVideoUrl ? processedVideoUrl : objectUrl;
  const afterFilterStyle = shouldApplyLiveFilterToAfter ? livePreviewCssOrSvg : undefined;
  const singleFilterStyle =
    !isShowingProcessedInSingle && !holdOriginalActive ? livePreviewCssOrSvg : undefined;

  // Guard newly mounted video elements so source loads and paints immediately
  useEffect(() => {
    for (const vid of [primaryVideoRef.current, secondaryVideoRef.current]) {
      if (!vid) continue;
      if (vid.readyState === 0 && vid.getAttribute('src')) {
        vid.load();
      }
    }
  }, [effectiveViewMode, singleSrc, afterVideoSrc, objectUrl]);

  const handleVideoLoadedMetadata = (vid: HTMLVideoElement, extraOffsetSec = 0) => {
    try {
      vid.playbackRate = playbackRate;
      const dur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 0;
      const desired = Math.max(lastTimeRef.current, 0.05) + extraOffsetSec;
      const clamped = dur > 0 ? Math.min(Math.max(0.01, dur - 0.04), desired) : desired;
      if (Math.abs(vid.currentTime - clamped) > 0.02) {
        vid.currentTime = clamped;
      }
    } catch {
      // Ignore metadata seek errors
    }
  };

  const showSubOverlay =
    videoEdit.subtitle.enabled &&
    videoEdit.subtitle.cues.length > 0 &&
    !holdOriginalActive &&
    (!isShowingProcessedInSingle || videoEdit.subtitle.mode === 'softsub');

  const togglePlayPause = () => {
    const pri = primaryVideoRef.current;
    const sec = secondaryVideoRef.current;
    if (!pri) return;
    if (pri.paused) {
      if (sec) {
        sec.currentTime = canPlayProcessedResult ? pri.currentTime + trimOffsetSec : pri.currentTime;
        sec.playbackRate = playbackRate;
        void sec.play().catch(() => { });
      }
      pri.playbackRate = playbackRate;
      void pri.play().catch(() => { });
    } else {
      pri.pause();
      sec?.pause();
    }
  };

  const handleSeekBarChange = (secValue: number) => {
    lastTimeRef.current = secValue;
    const pri = primaryVideoRef.current;
    const sec = secondaryVideoRef.current;
    if (pri) pri.currentTime = secValue;
    if (sec) sec.currentTime = canPlayProcessedResult ? secValue + trimOffsetSec : secValue;
  };

  const handleToggleRate = () => {
    const nextRate: 1 | 0.5 = playbackRate === 1 ? 0.5 : 1;
    setPlaybackRate(nextRate);
    if (primaryVideoRef.current) primaryVideoRef.current.playbackRate = nextRate;
    if (secondaryVideoRef.current) secondaryVideoRef.current.playbackRate = nextRate;
  };

  const updateSplitFromClientX = (clientX: number) => {
    const el = splitBoxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = Math.round(((clientX - rect.left) / rect.width) * 100);
    setSplitPct(Math.min(95, Math.max(5, pct)));
  };

  const handleSplitPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (effectiveViewMode !== 'split') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingSplitRef.current = true;
    updateSplitFromClientX(e.clientX);
  };

  const handleSplitPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingSplitRef.current) return;
    updateSplitFromClientX(e.clientX);
  };

  const handleSplitPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingSplitRef.current) return;
    draggingSplitRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const renderFallbackBox = () => (
    <div
      data-testid="video-preview-fallback-box"
      className="flex min-h-[180px] flex-col items-center justify-center gap-2 px-5 py-8 text-center text-xs text-[var(--text-secondary)]"
    >
      <p className="font-semibold text-[var(--text-primary)]">
        File {videoEdit.outputFormat.toUpperCase()} selesai diproses (
        {formatBytes(videoProcessResult?.outputBytes ?? 0)})
      </p>
      <p>
        Pemutar browser belum mendukung format {videoEdit.outputFormat.toUpperCase()} langsung,
        namun file siap diunduh dan diputar di pemutar media perangkat.
      </p>
    </div>
  );

  const afterBadgeLabel = holdOriginalActive
    ? 'Asli'
    : canPlayProcessedResult
      ? 'Hasil'
      : livePreviewCssOrSvg || hasActiveColorGrade(videoEdit.colorGrade)
        ? 'Sesudah (Pratinjau)'
        : 'Sesudah';

  return (
    <div className="flex w-full min-w-0 flex-col items-center gap-3">
      <LiveGradeSvgFilter
        filterId={filterDomId}
        colorGrade={videoEdit.colorGrade}
        colorContrast={activeColorContrast}
        disabled={deviceProfile.useLightweightCssPreview}
      />

      {/* Compare Mode Toolbar (docked cleanly below video stage on mobile, top on sm+) */}
      <div
        data-testid="video-stage-toolbar"
        className="order-2 my-0.5 flex w-full max-w-[820px] min-w-0 flex-wrap items-center justify-between gap-2 sm:order-1 sm:my-0"
      >
        <div
          role="group"
          aria-label="Mode Tampilan Video"
          className="km-glass-lite inline-flex max-w-full flex-wrap rounded-xl border p-0.5 text-xs"
        >
          {(
            [
              { id: 'single', label: 'Tunggal', Icon: Play },
              { id: 'side-by-side', label: 'Sandingkan', Icon: Columns2 },
              { id: 'split', label: 'Geser Belah', Icon: SlidersHorizontal },
            ] as const
          ).map(({ id, label, Icon }) => {
            const active = effectiveViewMode === id;
            const disabledByRam = dualBlockedByMemory && id !== 'single';
            return (
              <button
                key={id}
                type="button"
                data-testid={`video-mode-${id}-btn`}
                aria-pressed={active}
                disabled={disabledByRam}
                onClick={() => {
                  if (disabledByRam) {
                    setDualBlockedNotice(true);
                    return;
                  }
                  setIsPlaying(false);
                  onChangeCompareViewMode(id);
                }}
                className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors disabled:opacity-45 ${active
                  ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {effectiveViewMode === 'single' && canPlayProcessedResult && (
            <div className="km-glass-lite inline-flex rounded-xl border p-0.5 text-xs">
              <button
                type="button"
                data-testid="video-view-original-btn"
                onClick={() => setSingleSourceChoice('original')}
                className={`min-h-[36px] rounded-lg px-2.5 py-1 font-medium transition-colors ${singleSourceChoice === 'original'
                  ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                  : 'text-[var(--text-secondary)]'
                  }`}
              >
                Asli
              </button>
              <button
                type="button"
                data-testid="video-view-result-btn"
                onClick={() => setSingleSourceChoice('result')}
                className={`min-h-[36px] rounded-lg px-2.5 py-1 font-medium transition-colors ${singleSourceChoice === 'result'
                  ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                  : 'text-[var(--text-secondary)]'
                  }`}
              >
                Hasil
              </button>
            </div>
          )}

          {effectiveViewMode !== 'side-by-side' && (
            <button
              type="button"
              data-testid="video-hold-original-btn"
              aria-pressed={holdOriginalActive}
              onPointerDown={() => onHoldOriginalChange(true)}
              onPointerUp={() => onHoldOriginalChange(false)}
              onPointerLeave={() => onHoldOriginalChange(false)}
              onPointerCancel={() => onHoldOriginalChange(false)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  onHoldOriginalChange(true);
                }
              }}
              onKeyUp={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  onHoldOriginalChange(false);
                }
              }}
              className={`km-glass-lite inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all select-none ${holdOriginalActive
                ? 'border-[var(--border-active)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tahan: Lihat Asli</span>
            </button>
          )}
        </div>
      </div>

      {(dualBlockedByMemory || dualBlockedNotice) && (
        <p
          data-testid="video-dual-memory-advisory"
          className="w-full max-w-[820px] rounded-xl border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-3 py-2 text-[11px] leading-relaxed text-[var(--status-warn-ink)]"
        >
          Video cukup besar untuk mode 2 pemutar di perangkat ini. Gunakan &quot;Tahan: Lihat Asli&quot; agar tetap lancar.
        </p>
      )}

      {/* Main Stage Surface (clean studio matte, never checkerboard) */}
      <div
        data-testid="video-stage-surface"
        className={`order-1 relative flex w-full max-w-[820px] min-w-0 items-center justify-center overflow-hidden rounded-[22px] border border-[var(--border-hairline)] p-1.5 transition-colors sm:order-2 sm:p-2 ${getBackdropClasses(safeBackdrop)}`}
        style={{ boxShadow: 'var(--stage-shadow)' }}
      >
        {effectiveViewMode === 'single' && (
          <div className="relative flex min-h-[180px] w-full items-center justify-center overflow-hidden rounded-xl sm:min-h-[300px]">
            {processedPreviewUnsupported && singleSourceChoice === 'result' ? (
              renderFallbackBox()
            ) : (
              <video
                ref={bindPrimaryRef}
                key={singleSrc}
                data-testid="preview-video"
                src={singleSrc}
                controls
                playsInline
                preload="auto"
                muted={previewMuted}
                style={{
                  filter: singleFilterStyle,
                  aspectRatio: String(clampedAspect),
                }}
                onLoadedMetadata={(e) => handleVideoLoadedMetadata(e.currentTarget)}
                onLoadedData={(e) => tryExtractSingleThumbnail(e.currentTarget)}
                onTimeUpdate={(e) => {
                  if (e.currentTarget.readyState >= 2) {
                    lastTimeRef.current = e.currentTarget.currentTime;
                  }
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onError={() => {
                  if (singleSourceChoice === 'result' && processedVideoUrl) {
                    setProcessedPreviewUnsupported(true);
                  }
                }}
                className="block max-h-[235px] min-h-[175px] w-full rounded-xl object-contain sm:max-h-[56vh] sm:min-h-[280px] lg:min-h-[220px] lg:max-h-[calc(100dvh-290px)]"
              />
            )}

            {(processedVideoUrl || livePreviewCssOrSvg || holdOriginalActive) && (
              <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-[var(--surface-badge)] px-2 py-0.5 text-[11px] font-medium text-white">
                {holdOriginalActive
                  ? 'Asli'
                  : isShowingProcessedInSingle
                    ? 'Hasil'
                    : livePreviewCssOrSvg
                      ? 'Pratinjau'
                      : 'Asli'}
              </span>
            )}
          </div>
        )}

        {effectiveViewMode === 'side-by-side' && (
          <div
            data-testid="video-side-by-side-stage"
            className="grid w-full grid-cols-2 gap-2 sm:gap-3"
          >
            <div className="relative aspect-video min-h-[140px] max-h-[220px] w-full overflow-hidden rounded-xl bg-[var(--bg-stage-media)] sm:min-h-[240px] sm:max-h-[50vh] lg:min-h-[200px] lg:max-h-[calc(100dvh-310px)]">
              <video
                ref={bindSecondaryRef}
                key={`sbs-orig-${objectUrl}`}
                data-testid="compare-secondary-video"
                src={objectUrl}
                muted
                playsInline
                preload="auto"
                onLoadedMetadata={(e) => handleVideoLoadedMetadata(e.currentTarget)}
                className="block h-full w-full object-contain"
              />
              <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-md bg-[var(--surface-badge)] px-2 py-0.5 text-[11px] font-medium text-white">
                Asli
              </span>
            </div>

            <div className="relative aspect-video min-h-[140px] max-h-[220px] w-full overflow-hidden rounded-xl bg-[var(--bg-stage-media)] sm:min-h-[240px] sm:max-h-[50vh] lg:min-h-[200px] lg:max-h-[calc(100dvh-310px)]">
              {processedPreviewUnsupported && processedVideoUrl ? (
                renderFallbackBox()
              ) : (
                <video
                  ref={bindPrimaryRef}
                  key={`sbs-after-${afterVideoSrc}`}
                  data-testid="preview-video"
                  src={afterVideoSrc}
                  playsInline
                  preload="auto"
                  muted={previewMuted}
                  style={{ filter: afterFilterStyle }}
                  onLoadedMetadata={(e) =>
                    handleVideoLoadedMetadata(e.currentTarget, canPlayProcessedResult ? trimOffsetSec : 0)
                  }
                  onLoadedData={(e) => tryExtractSingleThumbnail(e.currentTarget)}
                  onTimeUpdate={(e) => {
                    if (e.currentTarget.readyState >= 2) {
                      lastTimeRef.current = e.currentTarget.currentTime;
                    }
                  }}
                  onPlay={() => {
                    setIsPlaying(true);
                    void secondaryVideoRef.current?.play().catch(() => { });
                  }}
                  onPause={() => {
                    setIsPlaying(false);
                    secondaryVideoRef.current?.pause();
                  }}
                  onEnded={() => setIsPlaying(false)}
                  onError={() => {
                    if (processedVideoUrl) {
                      setProcessedPreviewUnsupported(true);
                    }
                  }}
                  className="block h-full w-full object-contain"
                />
              )}
              <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-md bg-[var(--accent-primary)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ink-on-accent)] shadow-sm">
                {afterBadgeLabel}
              </span>
            </div>
          </div>
        )}

        {effectiveViewMode === 'split' && (
          <div
            ref={splitBoxRef}
            data-testid="video-split-stage"
            role="slider"
            tabIndex={0}
            aria-label="Geser pembanding video Asli dan Sesudah"
            aria-valuemin={5}
            aria-valuemax={95}
            aria-valuenow={splitPct}
            onPointerDown={handleSplitPointerDown}
            onPointerMove={handleSplitPointerMove}
            onPointerUp={handleSplitPointerUp}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setSplitPct((v) => Math.max(5, v - 5));
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setSplitPct((v) => Math.min(95, v + 5));
              }
            }}
            style={{ aspectRatio: String(clampedAspect) }}
            className="relative mx-auto max-h-[235px] min-h-[180px] w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-xl bg-[var(--bg-stage-media)] sm:max-h-[56vh] sm:min-h-[300px] lg:min-h-[220px] lg:max-h-[calc(100dvh-310px)]"
          >
            {processedPreviewUnsupported && processedVideoUrl ? (
              renderFallbackBox()
            ) : (
              <video
                ref={bindPrimaryRef}
                key={`split-after-${afterVideoSrc}`}
                data-testid="preview-video"
                src={afterVideoSrc}
                playsInline
                preload="auto"
                muted={previewMuted}
                style={{ filter: afterFilterStyle }}
                onLoadedMetadata={(e) =>
                  handleVideoLoadedMetadata(e.currentTarget, canPlayProcessedResult ? trimOffsetSec : 0)
                }
                onLoadedData={(e) => tryExtractSingleThumbnail(e.currentTarget)}
                onTimeUpdate={(e) => {
                  if (e.currentTarget.readyState >= 2) {
                    lastTimeRef.current = e.currentTarget.currentTime;
                  }
                }}
                onPlay={() => {
                  setIsPlaying(true);
                  void secondaryVideoRef.current?.play().catch(() => { });
                }}
                onPause={() => {
                  setIsPlaying(false);
                  secondaryVideoRef.current?.pause();
                }}
                onEnded={() => setIsPlaying(false)}
                onError={() => {
                  if (processedVideoUrl) {
                    setProcessedPreviewUnsupported(true);
                  }
                }}
                className="absolute inset-0 block h-full w-full object-contain"
              />
            )}

            <video
              ref={bindSecondaryRef}
              key={`split-orig-${objectUrl}`}
              data-testid="compare-secondary-video"
              src={objectUrl}
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={(e) => handleVideoLoadedMetadata(e.currentTarget)}
              className="pointer-events-none absolute inset-0 block h-full w-full object-contain"
              style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
            />

            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white shadow"
              style={{ left: `${splitPct}%` }}
            >
              <div className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--surface-dock)] text-[10px] font-bold text-[var(--text-primary)] shadow">
                ↔
              </div>
            </div>

            <span className="pointer-events-none absolute left-2.5 top-2.5 z-10 rounded-md bg-[var(--surface-badge)] px-2 py-0.5 text-[11px] font-medium text-white">
              Asli
            </span>
            <span className="pointer-events-none absolute right-2.5 top-2.5 z-10 rounded-md bg-[var(--accent-primary)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ink-on-accent)] shadow-sm">
              {afterBadgeLabel}
            </span>
          </div>
        )}

        <LiveSubtitleOverlay
          videoEl={primaryElState}
          cues={videoEdit.subtitle.cues}
          enabled={showSubOverlay && !(processedPreviewUnsupported && singleSourceChoice === 'result')}
          position={videoEdit.subtitle.position}
          isSingleMode={effectiveViewMode === 'single'}
        />
      </div>

      {effectiveViewMode !== 'single' && (
        <div className="order-3 w-full max-w-[820px]">
          <VideoSyncTransportBar
            primaryVideoEl={primaryElState}
            isPlaying={isPlaying}
            playbackRate={playbackRate}
            previewMuted={previewMuted}
            compareViewMode={effectiveViewMode}
            splitPct={splitPct}
            onTogglePlay={togglePlayPause}
            onSeekChange={handleSeekBarChange}
            onToggleRate={handleToggleRate}
            onToggleMute={() => setPreviewMuted((v) => !v)}
            onSplitPctChange={setSplitPct}
          />
        </div>
      )}
    </div>
  );
}
