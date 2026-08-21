/** Parses the API's "2048m" memory strings back into mebibytes. */
export function parseMebibytes(value?: string): number {
  if (!value) return 0;
  const match = /^(\d+(?:\.\d+)?)\s*([kmgt])?/i.exec(value.trim());
  if (!match) return 0;

  const amount = Number(match[1]);
  switch (match[2]?.toLowerCase()) {
    case 'k':
      return amount / 1024;
    case 'g':
      return amount * 1024;
    case 't':
      return amount * 1024 * 1024;
    default:
      return amount;
  }
}

/** Renders "2048m" as "2 GB" and "512m" as "512 MB". */
export function formatMemory(value?: string): string {
  const mib = parseMebibytes(value);
  if (mib <= 0) return '—';
  if (mib < 1024) return `${Math.round(mib)} MB`;

  const gib = mib / 1024;
  return `${gib % 1 === 0 ? gib : gib.toFixed(1)} GB`;
}

/** Compact "3d", "4h", "12m" style age, counted from an ISO timestamp. */
export function formatDuration(iso?: string, now: number = Date.now()): string {
  if (!iso) return '—';

  const started = Date.parse(iso);
  if (Number.isNaN(started)) return '—';

  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Strips the registry prefix so cards read "postgres:18.6", not the full ref. */
export function shortImage(image?: string): string {
  if (!image) return '—';
  return image.replace(/^docker\.io\/library\//, '').replace(/^docker\.io\//, '');
}

/** Splits "KEY=value" env entries, tolerating values that contain "=". */
export function splitEnv(entry: string): [string, string] {
  const index = entry.indexOf('=');
  if (index === -1) return [entry, ''];
  return [entry.slice(0, index), entry.slice(index + 1)];
}

/** Digests are stored in full so they can key a group; 12 chars is plenty on screen. */
export function shortDigest(digest?: string): string {
  if (!digest) return '';
  const bare = digest.replace(/^sha256:/, '');
  return bare.length > 12 ? bare.slice(0, 12) : bare;
}

/** Byte counts from the CLI, rendered the way a developer expects to read them. */
export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** A rate, for the counters that only mean something as a speed. */
export function formatRate(bytesPerSecond?: number): string {
  // Not formatBytes' em dash: nothing moving is a reading in its own right,
  // and a chart whose axis reads "—/s" at rest tells nobody anything.
  if (!bytesPerSecond || bytesPerSecond <= 0) return '0 B/s';

  return `${formatBytes(bytesPerSecond)}/s`;
}
