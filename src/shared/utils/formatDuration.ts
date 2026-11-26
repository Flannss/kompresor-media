export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const totalSec = Math.round(seconds);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationPrecise(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0.00 s';
  }
  if (seconds < 60) {
    return `${seconds.toFixed(2)} s`;
  }
  return formatDuration(seconds);
}
