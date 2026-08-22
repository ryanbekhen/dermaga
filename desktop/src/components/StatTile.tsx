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
  title,
  action,
}: {
  label: string;
  value: string;
  /** Draws a meter under the figure, filled to this share of the whole. */
  percent?: number;
  tone?: 'brand' | 'ink' | 'emerald';
  note?: ReactNode;
  /** The sentence behind the figure, for one that needs explaining. */
  title?: string;
  /**
   * What frees the space this tile counts.
   *
   * On the tile rather than under the page: one button that cleared images,
   * volumes and containers together made a single press stand for three very
   * different promises -- and a volume is the only copy of what was written
   * to it.
   */
  action?: ReactNode;
}) {
  const fill = {
    brand: 'bg-brand-600',
    ink: 'bg-ink-800 dark:bg-ink-300',
    emerald: 'bg-emerald-600',
  }[tone];

  return (
    <div
      title={title}
      className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900"
    >
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
      {action && <div className="pt-3">{action}</div>}
    </div>
  );
}

export interface Slice {
  label: string;
  bytes: number;
  /** A Tailwind background class; the legend swatch and the bar share it. */
  color: string;
}
