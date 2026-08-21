/**
 * The shape of an answer that has not arrived yet.
 *
 * A list with nothing in it and a list nobody has answered for look identical,
 * and the difference matters: told "there is nothing here", somebody believes
 * it, and then the rows appear a moment later and the app looks like it was
 * guessing. Drawing the shape instead says the same thing every native list
 * says -- this is coming -- and the rows land where the bars already were, so
 * nothing jumps.
 *
 * It fades down the list rather than pulsing as one block: identical bars in
 * identical rows read as a rendering fault, not as something on its way.
 */

/** Enough rows to read as a list, few enough not to promise a length. */
export const PLACEHOLDER_ROWS = 6;

/** Uneven, because real values are. */
export const PLACEHOLDER_WIDTHS = ['62%', '84%', '48%', '71%', '55%', '78%'];

export function SkeletonBar({
  width = '100%',
  height = 'h-3',
  /** Position in the list, which is how far it fades. */
  at = 0,
  className = '',
}: {
  width?: string;
  height?: string;
  at?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`block ${height} rounded bg-ink-200 motion-safe:animate-pulse dark:bg-ink-800 ${className}`}
      style={{ width, opacity: Math.max(0.2, 1 - at * 0.13) }}
    />
  );
}
