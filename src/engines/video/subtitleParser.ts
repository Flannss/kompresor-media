import type { SubtitleCue, SubtitlePosition, SubtitleSize } from '../contracts';

function parseTimestampToSec(rawToken: string): number | null {
  const cleaned = rawToken.trim().replace(',', '.');
  const match = cleaned.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!match) {
    return null;
  }
  const hours = match[1] ? Number(match[1]) : 0;
  const mins = Number(match[2]);
  const secs = Number(match[3]);
  const msStr = (match[4] ?? '0').padEnd(3, '0').slice(0, 3);
  const millis = Number(msStr);

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(mins) ||
    !Number.isFinite(secs) ||
    !Number.isFinite(millis) ||
    mins >= 60 ||
    secs >= 60
  ) {
    return null;
  }

  return Number((hours * 3600 + mins * 60 + secs + millis / 1000).toFixed(3));
}

function stripSubtitleMarkup(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .trim();
}

export function parseSubtitleText(raw: string): SubtitleCue[] {
  if (!raw || !raw.trim()) {
    return [];
  }

  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  let idx = 1;

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);
    if (lines.length === 0) {
      continue;
    }

    const firstUpper = lines[0].trim().toUpperCase();
    if (firstUpper.startsWith('WEBVTT') || firstUpper.startsWith('NOTE')) {
      continue;
    }

    const timingLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingLineIdx === -1) {
      continue;
    }

    const timingLine = lines[timingLineIdx];
    const arrowParts = timingLine.split('-->');
    if (arrowParts.length < 2) {
      continue;
    }

    const startToken = arrowParts[0].trim().split(/\s+/)[0];
    const endToken = arrowParts[1].trim().split(/\s+/)[0];
    const startSec = parseTimestampToSec(startToken);
    const endSec = parseTimestampToSec(endToken);

    if (startSec === null || endSec === null || endSec <= startSec) {
      continue;
    }

    const textLines = lines.slice(timingLineIdx + 1).map(stripSubtitleMarkup).filter(Boolean);
    if (textLines.length === 0) {
      continue;
    }

    cues.push({
      id: `cue-${idx++}`,
      startSec,
      endSec,
      text: textLines.join('\n'),
    });
  }

  return cues.sort((a, b) => a.startSec - b.startSec);
}

function formatSecTimestamp(sec: number, decimalSep: ',' | '.'): string {
  const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const totalMs = Math.round(safe * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${decimalSep}${String(ms).padStart(3, '0')}`;
}

export function adjustCuesForTrim(
  cues: SubtitleCue[],
  trimStartSec: number,
  trimEndSec?: number | null
): SubtitleCue[] {
  const out: SubtitleCue[] = [];
  for (const cue of cues) {
    if (trimEndSec !== null && trimEndSec !== undefined && cue.startSec >= trimEndSec) {
      continue;
    }
    const shiftedStart = Math.max(0, cue.startSec - trimStartSec);
    const maxEnd =
      trimEndSec !== null && trimEndSec !== undefined
        ? trimEndSec - trimStartSec
        : Number.POSITIVE_INFINITY;
    const shiftedEnd = Math.min(maxEnd, cue.endSec - trimStartSec);
    if (shiftedEnd <= shiftedStart + 0.05) {
      continue;
    }
    out.push({
      ...cue,
      startSec: Number(shiftedStart.toFixed(3)),
      endSec: Number(shiftedEnd.toFixed(3)),
    });
  }
  return out;
}

export function serializeToSrt(cues: SubtitleCue[], trimStartSec = 0, trimEndSec?: number | null): string {
  const trimmed = adjustCuesForTrim(cues, trimStartSec, trimEndSec);
  return trimmed
    .map(
      (cue, idx) =>
        `${idx + 1}\n${formatSecTimestamp(cue.startSec, ',')} --> ${formatSecTimestamp(cue.endSec, ',')}\n${cue.text}`
    )
    .join('\n\n')
    .concat(trimmed.length > 0 ? '\n' : '');
}

export function serializeToVtt(cues: SubtitleCue[], trimStartSec = 0, trimEndSec?: number | null): string {
  const trimmed = adjustCuesForTrim(cues, trimStartSec, trimEndSec);
  const body = trimmed
    .map(
      (cue) =>
        `${formatSecTimestamp(cue.startSec, '.')} --> ${formatSecTimestamp(cue.endSec, '.')}\n${cue.text}`
    )
    .join('\n\n');
  return `WEBVTT\n\n${body}${body ? '\n' : ''}`;
}

export function findActiveCuesAtTime(cues: SubtitleCue[], timeSec: number): SubtitleCue[] {
  return cues.filter((cue) => timeSec >= cue.startSec && timeSec <= cue.endSec);
}

function wrapCanvasLines(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  rawText: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  for (const paragraph of rawText.split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let current = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const candidate = `${current} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

/**
 * Renders hardsub subtitle cues directly onto a 2D canvas without requiring external WASM font libraries.
 */
export function drawHardsubCuesOnCanvas(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  cues: SubtitleCue[],
  size: SubtitleSize,
  position: SubtitlePosition
): void {
  if (cues.length === 0 || width <= 0 || height <= 0) {
    return;
  }

  const sizeRatio = size === 'small' ? 0.036 : size === 'large' ? 0.056 : 0.045;
  const fontPx = Math.max(14, Math.min(54, Math.round(height * sizeRatio)));
  const lineHeight = Math.round(fontPx * 1.28);

  ctx.save();
  ctx.font = `600 ${fontPx}px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxLineWidth = Math.round(width * 0.86);
  const allLines: string[] = [];
  for (const cue of cues) {
    allLines.push(...wrapCanvasLines(ctx, cue.text, maxLineWidth));
  }
  if (allLines.length === 0) {
    ctx.restore();
    return;
  }

  const maxMeasuredWidth = Math.max(...allLines.map((l) => ctx.measureText(l).width));
  const padX = Math.round(fontPx * 0.72);
  const padY = Math.round(fontPx * 0.36);
  const boxWidth = Math.min(width - 16, Math.round(maxMeasuredWidth + padX * 2));
  const boxHeight = allLines.length * lineHeight + padY * 2;
  const centerX = width / 2;

  let boxTop: number;
  if (position === 'top') {
    boxTop = Math.round(height * 0.08);
  } else if (position === 'center') {
    boxTop = Math.round((height - boxHeight) / 2);
  } else {
    boxTop = Math.round(height * 0.9 - boxHeight);
  }
  boxTop = Math.max(10, Math.min(height - boxHeight - 10, boxTop));

  ctx.fillStyle = 'rgba(26, 18, 13, 0.78)';
  const radius = Math.min(12, Math.round(fontPx * 0.35));
  const x = centerX - boxWidth / 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, boxTop);
  ctx.lineTo(x + boxWidth - radius, boxTop);
  ctx.quadraticCurveTo(x + boxWidth, boxTop, x + boxWidth, boxTop + radius);
  ctx.lineTo(x + boxWidth, boxTop + boxHeight - radius);
  ctx.quadraticCurveTo(x + boxWidth, boxTop + boxHeight, x + boxWidth - radius, boxTop + boxHeight);
  ctx.lineTo(x + radius, boxTop + boxHeight);
  ctx.quadraticCurveTo(x, boxTop + boxHeight, x, boxTop + boxHeight - radius);
  ctx.lineTo(x, boxTop + radius);
  ctx.quadraticCurveTo(x, boxTop, x + radius, boxTop);
  ctx.closePath();
  ctx.fill();

  ctx.lineWidth = Math.max(2, Math.round(fontPx * 0.1));
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.fillStyle = '#FFFFFF';

  allLines.forEach((line, i) => {
    const ly = boxTop + padY + lineHeight * i + lineHeight / 2;
    ctx.strokeText(line, centerX, ly);
    ctx.fillText(line, centerX, ly);
  });

  ctx.restore();
}
