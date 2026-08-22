import type { ReactNode } from 'react';

/**
 * One number, big enough to read from the doorway.
 *
 * A row of these is how a page answers "is anything wrong here?" before anybody
 * scrolls. The label is small and quiet, the figure is not, and whatever sits
 * under it -- a bar, a caption -- is there to say what the figure is a share
 * of. A tile with nothing underneath is a tile whose number needs no context.
 */
export function StatTile({
  label,
  value,
  percent,
  tone = 'brand',
  note,
}: {
  label: string;
  value: string;
  /** Draws a meter under the figure, filled to this share of the whole. */
  percent?: number;
  tone?: 'brand' | 'ink' | 'emerald';
  note?: ReactNode;
}) {
  const fill = {
    brand: 'bg-brand-600',
    ink: 'bg-ink-800 dark:bg-ink-300',
    emerald: 'bg-emerald-600',
  }[tone];

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
      <p className="text-xs text-ink-600 dark:text-ink-400">{label}</p>
      <p className="pb-2.5 pt-1.5 text-figure font-semibold">{value}</p>
      {percent !== undefined && (
        <span className="block h-1.25 overflow-hidden rounded-full bg-ink-150 dark:bg-ink-800">
          <span
            className={`block h-full rounded-full transition-[width] duration-500 ${fill}`}
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </span>
      )}
      {note && <p className="text-xs text-ink-600 dark:text-ink-400">{note}</p>}
    </div>
  );
}

export interface Slice {
  label: string;
  bytes: number;
  /** A Tailwind background class; the legend swatch and the bar share it. */
  color: string;
}

/**
 * Where the space went, as one bar rather than three numbers.
 *
 * Sizes on their own do not answer the question people actually have, which is
 * about proportion: 26 GB of images means nothing until it is next to the 21 GB
 * of volumes. The legend under it carries the figures, so the bar is never the
 * only place a number is written -- widths are hard to read precisely and
 * impossible to read at all in a screenshot.
 *
 * The bar is the whole of what the runtime holds, not the whole of the disk.
 * Nothing here is told how big the disk is or how much of it is free, and a
 * bar with a "free" slice sized from a guess would be answering a question it
 * cannot answer.
 */
export function DiskBreakdown({ slices }: { slices: Slice[] }) {
  const parts = slices;
  const total = parts.reduce((sum, part) => sum + part.bytes, 0);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        {parts.map((part) => (
          <span
            key={part.label}
            className={part.color}
            style={{ width: total > 0 ? `${(part.bytes / total) * 100}%` : '0%' }}
            aria-hidden
          />
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {parts.map((part) => (
          <div key={part.label} className="flex flex-col gap-1">
            <dt className="flex items-center gap-2 text-xs text-ink-700 dark:text-ink-300">
              <span className={`h-2 w-2 shrink-0 rounded-sm ${part.color}`} aria-hidden />
              {part.label}
            </dt>
            <dd className="font-mono text-body">{formatSlice(part.bytes)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function formatSlice(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${gib.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}
