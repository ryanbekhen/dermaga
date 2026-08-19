import { useMemo } from 'react';
import type { UsagePoint } from '../types';
import { formatBytes } from '../utils/format';

/**
 * Half an hour of one measurement, drawn as an area.
 *
 * A live number cannot show a shape, and the shape is the diagnosis: memory
 * that climbs and never falls is a leak; CPU pinned against the allocation is
 * a container being starved. Drawn as inline SVG rather than with a charting
 * library, because two sparklines do not justify a dependency.
 */
export function UsageChart({
  points,
  label,
  value,
  ceiling,
  format,
}: {
  points: UsagePoint[];
  label: string;
  value: (point: UsagePoint) => number;
  /** Fixes the top of the scale, so the line means the same thing over time. */
  ceiling?: number;
  format: (value: number) => string;
}) {
  const width = 320;
  const height = 56;

  const { area, line, latest, peak } = useMemo(() => {
    const values = points.map(value);
    const highest = Math.max(ceiling ?? 0, ...values, 1);

    // Fewer than two points is a dot, not a line: nothing to draw yet.
    if (points.length < 2) {
      return { area: '', line: '', latest: values[values.length - 1] ?? 0, peak: highest };
    }

    const step = width / (points.length - 1);
    const y = (v: number) => height - (v / highest) * (height - 4) - 2;

    const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * step},${y(v)}`).join(' ');

    return {
      line: path,
      area: `${path} L${width},${height} L0,${height} Z`,
      latest: values[values.length - 1] ?? 0,
      peak: highest,
    };
  }, [points, value, ceiling]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-caps">{label}</span>
        <span className="font-mono text-xs">{format(latest)}</span>
      </div>

      {line ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-14 w-full"
          role="img"
          aria-label={`${label}: ${format(latest)}, peak ${format(peak)}`}
        >
          <path d={area} className="fill-brand-600/10" />
          <path
            d={line}
            className="stroke-brand-600 dark:stroke-brand-400"
            fill="none"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : (
        <p className="flex h-14 items-center text-tiny text-ink-500">
          Collecting… the first minute has nothing to draw yet.
        </p>
      )}

      <p className="text-tiny text-ink-500">
        {points.length > 1
          ? `last ${Math.round(((points[points.length - 1]?.at ?? 0) - (points[0]?.at ?? 0)) / 60000)} min · peak ${format(peak)}`
          : 'no history yet'}
      </p>
    </div>
  );
}

/** Memory is read in bytes and shown the way the rest of the app shows sizes. */
export const asBytes = (value: number) => formatBytes(value);
export const asPercent = (value: number) => `${value.toFixed(1)}%`;
