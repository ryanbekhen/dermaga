import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatMemory,
  formatRate,
  parseMebibytes,
  shortImage,
  splitEnv,
} from './format';

describe('parseMebibytes', () => {
  it('reads the API memory format', () => {
    expect(parseMebibytes('2048m')).toBe(2048);
    expect(parseMebibytes('2g')).toBe(2048);
    expect(parseMebibytes('1024k')).toBe(1);
  });

  it('returns 0 for missing or unparseable values', () => {
    expect(parseMebibytes(undefined)).toBe(0);
    expect(parseMebibytes('')).toBe(0);
    expect(parseMebibytes('unlimited')).toBe(0);
  });
});

describe('formatMemory', () => {
  it('scales to GB past 1024 MiB', () => {
    expect(formatMemory('512m')).toBe('512 MB');
    expect(formatMemory('2048m')).toBe('2 GB');
    expect(formatMemory('1536m')).toBe('1.5 GB');
  });

  it('falls back to a dash', () => {
    expect(formatMemory(undefined)).toBe('—');
  });
});

describe('formatDuration', () => {
  const now = Date.parse('2026-08-17T12:00:00Z');

  it('picks a unit that fits', () => {
    expect(formatDuration('2026-08-17T11:59:30Z', now)).toBe('30s');
    expect(formatDuration('2026-08-17T11:30:00Z', now)).toBe('30m');
    expect(formatDuration('2026-08-17T09:30:00Z', now)).toBe('2h 30m');
    expect(formatDuration('2026-08-15T09:00:00Z', now)).toBe('2d 3h');
  });

  it('handles missing and invalid timestamps', () => {
    expect(formatDuration(undefined, now)).toBe('—');
    expect(formatDuration('not-a-date', now)).toBe('—');
  });
});

describe('shortImage', () => {
  it('drops the default registry prefix', () => {
    expect(shortImage('docker.io/library/postgres:18.6')).toBe('postgres:18.6');
    expect(shortImage('docker.io/bitnami/redis:8')).toBe('bitnami/redis:8');
    expect(shortImage('ghcr.io/owner/app:1')).toBe('ghcr.io/owner/app:1');
  });
});

describe('splitEnv', () => {
  it('splits on the first equals sign only', () => {
    expect(splitEnv('PATH=/usr/bin:/bin')).toEqual(['PATH', '/usr/bin:/bin']);
    expect(splitEnv('DSN=postgres://u:p@h/db?x=1')).toEqual(['DSN', 'postgres://u:p@h/db?x=1']);
    expect(splitEnv('FLAG')).toEqual(['FLAG', '']);
  });
});

describe('formatRate', () => {
  it('reads as a speed', () => {
    expect(formatRate(1024)).toBe('1.0 KB/s');
    expect(formatRate(5 * 1024 * 1024)).toBe('5.0 MB/s');
    expect(formatRate(512)).toBe('512 B/s');
  });

  // A chart at rest still has an axis, and "—/s" on it tells nobody anything.
  it('says nothing is moving rather than nothing is known', () => {
    expect(formatRate(0)).toBe('0 B/s');
    expect(formatRate(undefined)).toBe('0 B/s');
  });
});
