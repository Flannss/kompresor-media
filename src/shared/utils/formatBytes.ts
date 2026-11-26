const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = value >= 100 ? 1 : 2;
  return `${value.toFixed(decimals)} ${UNITS[unitIndex]}`;
}

export function formatByteDelta(deltaBytes: number): string {
  if (!Number.isFinite(deltaBytes) || deltaBytes === 0) {
    return '0 B';
  }
  const sign = deltaBytes > 0 ? '+' : '-';
  return `${sign}${formatBytes(Math.abs(deltaBytes))}`;
}
