import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Columns2, Eye, Pause, Play, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
import type { ColorGradeId, SubtitleCue, VideoEditState, VideoProcessResult } from '../../engines/contracts';
import {
  applyColorGradeToImageData,
  buildSvgFilterParams,
  COLOR_GRADE_PRESETS,
  hasActiveColorGrade,
} from '../../engines/shared/colorGrades';
import { computeTargetDimensions } from '../../engines/image/pixelOps';
import { findActiveCuesAtTime } from '../../engines/video/subtitleParser';
import { formatBytes } from '../../shared/utils/formatBytes';
import { formatDuration } from '../../shared/utils/formatDuration';
import { getBackdropClasses, type StageBackdrop } from '../workspace/BeforeAfterPreview';
import { getLiveFilterCssStyle, LiveGradeSvgFilter } from '../workspace/LiveGradeSvgFilter';

export type VideoCompareViewMode = 'single' | 'side-by-side' | 'split';

export interface VideoCompareStageProps {
  itemId: string | null;
  objectUrl: string;
  processedVideoUrl: string | null;
  videoEdit: VideoEditState;
  videoProcessResult: VideoProcessResult | null;
  backdrop: StageBackdrop;
  compareViewMode: VideoCompareViewMode;
  onChangeCompareViewMode: (mode: VideoCompareViewMode) => void;
  holdOriginalActive: boolean;
  onHoldOriginalChange: (held: boolean) => void;
  hasGeneratedThumbnails: boolean;
  onVideoThumbnailsReady: (itemId: string, thumbs: Partial<Record<ColorGradeId, string>>) => void;
  seekRequestSec: { sec: number; seq: number } | null;
  onVideoTimeChange: (sec: number) => void;
  videoElementRef?: (el: HTMLVideoElement | null) => void;
}

export function VideoCompareStage({
  itemId,
  objectUrl,
  processedVideoUrl,
  videoEdit,
  videoProcessResult,
  backdrop,
  compareViewMode,
  onChangeCompareViewMode,
  holdOriginalActive,
  onHoldOriginalChange,
  hasGeneratedThumbnails,
  onVideoThumbnailsReady,
  seekRequestSec,
  onVideoTimeChange,
  videoElementRef,
}: VideoCompareStageProps) {
  const reactFilterId = useId().replace(/[^a-zA-Z0-9_-]/g, '') || 'v';
  const filterDomId = `km-video-grade-${reactFilterId}`;

  const primaryVideoRef = useRef<HTMLVideoElement | null>(null);
  const secondaryVideoRef = useRef<HTMLVideoElement | null>(null);
  const splitBoxRef = useRef<HTMLDivElement | null>(null);
  const draggingSplitRef = useRef(false);
  const generatedForKeyRef = useRef<string | null>(null);

  const [singleSourceChoice, setSingleSourceChoice] = useState<'original' | 'result'>('original');
  const [splitPct, setSplitPct] = useState(50);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<1 | 0.5>(1);
  const [previewMuted, setPreviewMuted] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [processedPreviewUnsupported, setProcessedPreviewUnsupported] = useState(false);

  const svgParams = useMemo(
    () =>
      buildSvgFilterParams(
        videoEdit.colorGrade,
        videoEdit.enhanceSuite.colorContrast.enabled
          ? videoEdit.enhanceSuite.colorContrast
          : undefined
      ),
    [videoEdit.colorGrade, videoEdit.enhanceSuite.colorContrast]
  );

  const canPlayProcessedResult = Boolean(processedVideoUrl) && !processedPreviewUnsupported;
  const trimOffsetSec = canPlayProcessedResult ? Math.max(0, videoEdit.trimStartSec) : 0;

  // Automatically show processed output when a fresh render finishes
  useEffect(() => {
    setProcessedPreviewUnsupported(false);
    if (processedVideoUrl) {
      setSingleSourceChoice('result');
    } else {
      setSingleSourceChoice('original');
    }
  }, [processedVideoUrl]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTimeSec(0);
    setProcessedPreviewUnsupported(false);
    setSingleSourceChoice(processedVideoUrl ? 'result' : 'original');
    generatedForKeyRef.current = null;
  }, [objectUrl]);

  // Apply seek requests (e.g. from subtitle cue click) cleanly
  useEffect(() => {
    if (!seekRequestSec) return;
    const target = Math.max(0, seekRequestSec.sec);
    if (primaryVideoRef.current) {
      primaryVideoRef.current.currentTime = target;
    }
    if (secondaryVideoRef.current) {
      secondaryVideoRef.current.currentTime = Math.max(0, target + trimOffsetSec);
    }
    setCurrentTimeSec(target);
    onVideoTimeChange(target);
  }, [seekRequestSec, trimOffsetSec, onVideoTimeChange]);

  // Frame-accurate RAF sync between primary and secondary (always muted) videos
  useEffect(() => {
    if (compareViewMode === 'single') {
      return;
    }
    let rafId = 0;

    const syncTick = () => {
      const pri = primaryVideoRef.current;
      const sec = secondaryVideoRef.current;
      if (pri && sec) {
        if (Math.abs(sec.playbackRate - pri.playbackRate) > 0.01) {
          sec.playbackRate = pri.playbackRate;
        }
        const expectedSecTime = canPlayProcessedResult ? pri.currentTime + trimOffsetSec : pri.currentTime;
        const maxSecDur = Number.isFinite(sec.duration) && sec.duration > 0 ? sec.duration : expectedSecTime;
        const clampedTarget = Math.min(maxSecDur, Math.max(0, expectedSecTime));
        if (Math.abs(sec.currentTime - clampedTarget) > 0.08) {
          sec.currentTime = clampedTarget;
        }
        if (!pri.paused && sec.paused) {
          void sec.play().catch(() => {});
        } else if (pri.paused && !sec.paused) {
          sec.pause();
        }
      }
      if (isPlaying) {
        rafId = requestAnimationFrame(syncTick);
      }
    };

    if (isPlaying) {
      rafId = requestAnimationFrame(syncTick);
    }

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [compareViewMode, isPlaying, canPlayProcessedResult, trimOffsetSec]);

  // Extract 7x 160px real-frame Color Grade thumbnails when the source video loads its first frame
  const handleExtractThumbnailsFromVideo = (videoEl: HTMLVideoElement) => {
    if (!itemId || hasGeneratedThumbnails) return;
    const key = `${itemId}:${objectUrl}`;
    if (generatedForKeyRef.current === key) return;
    if (videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) return;

    generatedForKeyRef.current = key;
    const dims = computeTargetDimensions(videoEl.videoWidth, videoEl.videoHeight, 160);
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = dims.width;
    baseCanvas.height = dims.height;
    const baseCtx = baseCanvas.getContext('2d');
    if (!baseCtx) return;

    try {
      baseCtx.drawImage(videoEl, 0, 0, dims.width, dims.height);
      const basePixels = baseCtx.getImageData(0, 0, dims.width, dims.height);

      void (async () => {
        const nextMap: Partial<Record<ColorGradeId, string>> = {};
        for (const preset of COLOR_GRADE_PRESETS) {
          const workCanvas = document.createElement('canvas');
          workCanvas.width = dims.width;
          workCanvas.height = dims.height;
          const workCtx = workCanvas.getContext('2d');
          if (!workCtx) continue;
          const copy = new ImageData(
            new Uint8ClampedArray(basePixels.data),
            basePixels.width,
            basePixels.height
          );
          applyColorGradeToImageData(copy, {
            gradeId: preset.id,
            intensity: 100,
            tone: { temperature: 0, tint: 0, shadows: 0, highlights: 0 },
          });
          workCtx.putImageData(copy, 0, 0);
          const blob = await new Promise<Blob | null>((resolve) =>
            workCanvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8)
          );
          if (blob) {
            nextMap[preset.id] = URL.createObjectURL(blob);
          }
        }
        onVideoThumbnailsReady(itemId, nextMap);
      })();
    } catch {
      // Security or zero-frame draw error should not break player
    }
  };

  // In Tunggal mode: choose URL & live CSS SVG filter cleanly
  const isShowingProcessedInSingle =
    singleSourceChoice === 'result' && canPlayProcessedResult && !holdOriginalActive;
  const singleSrc = isShowingProcessedInSingle && processedVideoUrl ? processedVideoUrl : objectUrl;
  const shouldApplyLiveSvgToAfter = !canPlayProcessedResult && !holdOriginalActive;
  const afterVideoSrc = canPlayProcessedResult && processedVideoUrl ? processedVideoUrl : objectUrl;
  const afterFilterStyle = shouldApplyLiveSvgToAfter
    ? getLiveFilterCssStyle(filterDomId, svgParams)
    : undefined;

  const singleFilterStyle =
    !isShowingProcessedInSingle && !holdOriginalActive
      ? getLiveFilterCssStyle(filterDomId, svgParams)
      : undefined;

  // Live synced subtitles overlay
  const showSubtitleOverlay =
    videoEdit.subtitle.enabled &&
    videoEdit.subtitle.cues.length > 0 &&
    !holdOriginalActive &&
    (!isShowingProcessedInSingle || videoEdit.subtitle.mode === 'softsub');
  const activeCues: SubtitleCue[] = showSubtitleOverlay
    ? findActiveCuesAtTime(videoEdit.subtitle.cues, currentTimeSec)
    : [];

  const bindPrimaryRef = (el: HTMLVideoElement | null) => {
    primaryVideoRef.current = el;
    videoElementRef?.(el);
  };

  const togglePlayPause = () => {
    const pri = primaryVideoRef.current;
    const sec = secondaryVideoRef.current;
    if (!pri) return;
    if (pri.paused) {
      if (sec) {
        const expected = canPlayProcessedResult ? pri.currentTime + trimOffsetSec : pri.currentTime;
        sec.currentTime = expected;
        sec.playbackRate = playbackRate;
        void sec.play().catch(() => {});
      }
      pri.playbackRate = playbackRate;
      void pri.play().catch(() => {});
    } else {
      pri.pause();
      sec?.pause();
    }
  };

  const handleSeekBarChange = (secValue: number) => {
    const pri = primaryVideoRef.current;
    const sec = secondaryVideoRef.current;
    setCurrentTimeSec(secValue);
    onVideoTimeChange(secValue);
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
    if (compareViewMode !== 'split') return;
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
      : svgParams.active || hasActiveColorGrade(videoEdit.colorGrade)
        ? 'Sesudah (Pratinjau)'
        : 'Sesudah';

  return (
    <div className="flex w-full flex-col items-center gap-2.5">
      <LiveGradeSvgFilter
        filterId={filterDomId}
        colorGrade={videoEdit.colorGrade}
        colorContrast={
          videoEdit.enhanceSuite.colorContrast.enabled
            ? videoEdit.enhanceSuite.colorContrast
            : undefined
        }
      />

      {/* Mode Switcher Bar Above Stage */}
      <div className="flex w-full max-w-[820px] flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Mode Tampilan Video"
          className="inline-flex rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-0.5 text-xs"
        >
          {(
            [
              { id: 'single', label: 'Tunggal', Icon: Play },
              { id: 'side-by-side', label: 'Sandingkan', Icon: Columns2 },
              { id: 'split', label: 'Geser Belah', Icon: SlidersHorizontal },
            ] as const
          ).map(({ id, label, Icon }) => {
            const active = compareViewMode === id;
            return (
              <button
                key={id}
                type="button"
                data-testid={`video-mode-${id}-btn`}
                aria-pressed={active}
                onClick={() => onChangeCompareViewMode(id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors ${
                  active
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

        <div className="flex items-center gap-2">
          {compareViewMode === 'single' && canPlayProcessedResult && (
            <div className="inline-flex rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-0.5 text-xs">
              <button
                type="button"
                data-testid="video-view-original-btn"
                onClick={() => setSingleSourceChoice('original')}
                className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${
                  singleSourceChoice === 'original'
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
                className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${
                  singleSourceChoice === 'result'
                    ? 'bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                Hasil
              </button>
            </div>
          )}

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
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all select-none ${
              holdOriginalActive
                ? 'border-[var(--border-active)] bg-[var(--accent-primary)] text-[var(--ink-on-accent)]'
                : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Tahan: Lihat Asli</span>
          </button>
        </div>
      </div>

      {/* Main Stage Surface */}
      <div
        className={`relative flex w-full max-w-[820px] items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-hairline)] p-1.5 transition-colors ${getBackdropClasses(backdrop)}`}
        style={{ boxShadow: 'var(--stage-shadow)' }}
      >
        {compareViewMode === 'single' && (
          <div className="relative flex w-full items-center justify-center">
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
                style={{ filter: singleFilterStyle }}
                onLoadedMetadata={(e) => {
                  if (Number.isFinite(e.currentTarget.duration)) {
                    setDurationSec(e.currentTarget.duration);
                  }
                }}
                onLoadedData={(e) => handleExtractThumbnailsFromVideo(e.currentTarget)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={(e) => {
                  setCurrentTimeSec(e.currentTarget.currentTime);
                  onVideoTimeChange(e.currentTarget.currentTime);
                }}
                onError={() => {
                  if (singleSourceChoice === 'result' && processedVideoUrl) {
                    setProcessedPreviewUnsupported(true);
                  }
                }}
                className="max-h-[52vh] w-full rounded-xl object-contain"
              />
            )}

            {(processedVideoUrl || svgParams.active || holdOriginalActive) && (
              <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-[#000521]/80 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-xs">
                {holdOriginalActive
                  ? 'Asli'
                  : isShowingProcessedInSingle
                    ? 'Hasil'
                    : svgParams.active
                      ? 'Pratinjau'
                      : 'Asli'}
              </span>
            )}
          </div>
        )}

        {compareViewMode === 'side-by-side' && (
          <div
            data-testid="video-side-by-side-stage"
            className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2"
          >
            {/* Left / Top: Asli (strictly muted=true so zero audio echo!) */}
            <div className="relative flex items-center justify-center overflow-hidden rounded-xl bg-black/40">
              <video
                ref={secondaryVideoRef}
                key={`sbs-orig-${objectUrl}`}
                data-testid="compare-secondary-video"
                src={objectUrl}
                muted
                playsInline
                preload="auto"
                className="max-h-[42vh] w-full object-contain sm:max-h-[50vh]"
              />
              <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-md bg-[#000521]/85 px-2 py-0.5 text-[11px] font-medium text-white">
                Asli
              </span>
            </div>

            {/* Right / Bottom: Sesudah (Master clock + audio) */}
            <div className="relative flex items-center justify-center overflow-hidden rounded-xl bg-black/40">
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
                  onLoadedMetadata={(e) => {
                    if (Number.isFinite(e.currentTarget.duration)) {
                      setDurationSec(e.currentTarget.duration);
                    }
                  }}
                  onLoadedData={(e) => handleExtractThumbnailsFromVideo(e.currentTarget)}
                  onPlay={() => {
                    setIsPlaying(true);
                    void secondaryVideoRef.current?.play().catch(() => {});
                  }}
                  onPause={() => {
                    setIsPlaying(false);
                    secondaryVideoRef.current?.pause();
                  }}
                  onTimeUpdate={(e) => {
                    setCurrentTimeSec(e.currentTarget.currentTime);
                    onVideoTimeChange(e.currentTarget.currentTime);
                  }}
                  onError={() => {
                    if (processedVideoUrl) {
                      setProcessedPreviewUnsupported(true);
                    }
                  }}
                  className="max-h-[42vh] w-full object-contain sm:max-h-[50vh]"
                />
              )}
              <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-md bg-[var(--accent-deep)]/95 px-2 py-0.5 text-[11px] font-medium text-white">
                {afterBadgeLabel}
              </span>
            </div>
          </div>
        )}

        {compareViewMode === 'split' && (
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
            className="relative flex w-full cursor-ew-resize touch-none select-none items-center justify-center overflow-hidden rounded-xl"
          >
            {/* Base layer: Sesudah (Master clock + audio) */}
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
                onLoadedMetadata={(e) => {
                  if (Number.isFinite(e.currentTarget.duration)) {
                    setDurationSec(e.currentTarget.duration);
                  }
                }}
                onLoadedData={(e) => handleExtractThumbnailsFromVideo(e.currentTarget)}
                onPlay={() => {
                  setIsPlaying(true);
                  void secondaryVideoRef.current?.play().catch(() => {});
                }}
                onPause={() => {
                  setIsPlaying(false);
                  secondaryVideoRef.current?.pause();
                }}
                onTimeUpdate={(e) => {
                  setCurrentTimeSec(e.currentTarget.currentTime);
                  onVideoTimeChange(e.currentTarget.currentTime);
                }}
                onError={() => {
                  if (processedVideoUrl) {
                    setProcessedPreviewUnsupported(true);
                  }
                }}
                className="max-h-[52vh] w-full object-contain"
              />
            )}

            {/* Overlay layer: Asli (strictly muted=true, clipped on the left 0..splitPct%) */}
            <video
              ref={secondaryVideoRef}
              key={`split-orig-${objectUrl}`}
              data-testid="compare-secondary-video"
              src={objectUrl}
              muted
              playsInline
              preload="auto"
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
            />

            {/* Vertical Divider Handle */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow"
              style={{ left: `${splitPct}%` }}
            >
              <div className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[10px] font-bold text-[var(--text-primary)] shadow">
                ↔
              </div>
            </div>

            <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-md bg-[#000521]/85 px-2 py-0.5 text-[11px] font-medium text-white">
              Asli
            </span>
            <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-md bg-[var(--accent-deep)]/95 px-2 py-0.5 text-[11px] font-medium text-white">
              {afterBadgeLabel}
            </span>
          </div>
        )}

        {/* Active Live Subtitle Overlay */}
        {activeCues.length > 0 && !(processedPreviewUnsupported && singleSourceChoice === 'result') && (
          <div
            data-testid="live-subtitle-overlay"
            className={`pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-lg bg-[#000521]/82 px-3 py-1.5 text-center text-xs font-semibold text-white shadow sm:text-sm ${
              videoEdit.subtitle.position === 'top'
                ? 'top-4'
                : videoEdit.subtitle.position === 'center'
                  ? 'top-1/2 -translate-y-1/2'
                  : compareViewMode === 'single'
                    ? 'bottom-12'
                    : 'bottom-4'
            }`}
          >
            {activeCues.map((c) => c.text).join('\n')}
          </div>
        )}
      </div>

      {/* Synchronized Transport + Split Slider in Dual/Split Mode */}
      {compareViewMode !== 'single' && (
        <div
          data-testid="video-sync-transport"
          className="flex w-full max-w-[820px] flex-wrap items-center gap-2 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2 text-xs tabular-nums"
        >
          <button
            type="button"
            data-testid="video-sync-play-btn"
            onClick={togglePlayPause}
            aria-label={isPlaying ? 'Jeda video' : 'Putar video'}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-primary)] text-[var(--ink-on-accent)] transition-colors hover:bg-[var(--accent-hover)]"
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>

          <input
            type="range"
            data-testid="video-sync-seek"
            min={0}
            max={Math.max(0.1, durationSec)}
            step={0.05}
            value={Math.min(Math.max(0, currentTimeSec), Math.max(0.1, durationSec))}
            onChange={(e) => handleSeekBarChange(Number(e.target.value))}
            aria-label="Posisi pemutaran video"
            className="km-range-input min-w-[120px] flex-1"
          />

          <span className="text-[11px] font-medium text-[var(--text-secondary)]">
            {formatDuration(currentTimeSec)} / {formatDuration(durationSec)}
          </span>

          <button
            type="button"
            data-testid="video-sync-rate-btn"
            onClick={handleToggleRate}
            className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] font-semibold text-[var(--text-primary)]"
          >
            {playbackRate === 1 ? '1×' : '0,5×'}
          </button>

          <button
            type="button"
            data-testid="video-sync-mute-btn"
            onClick={() => setPreviewMuted((v) => !v)}
            aria-label={previewMuted ? 'Nyalakan suara pratinjau' : 'Bisukan suara pratinjau'}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {previewMuted ? (
              <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
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
                onChange={(e) => setSplitPct(Number(e.target.value))}
                aria-label="Geser pembanding video Asli dan Sesudah"
                className="km-range-input w-24"
              />
              <span className="w-8 text-right font-semibold text-[var(--text-primary)]">
                {splitPct}%
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
