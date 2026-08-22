import type { ContainerStatus } from '../types';

/**
 * A status is a colour and a word, never a colour alone.
 *
 * The tint is carried as an opacity of the same hue rather than as a second
 * fixed colour: the light theme lays it on warm paper and the dark theme on
 * near-black, and a tint mixed for one of those grounds is either invisible or
 * garish on the other.
 */
const STATUS_STYLES: Record<
  ContainerStatus,
  { dot: string; text: string; tint: string; label: string }
> = {
  running: {
    dot: 'bg-emerald-600',
    text: 'text-emerald-700 dark:text-emerald-500',
    tint: 'bg-emerald-600/10',
    label: 'running',
  },
  stopped: {
    dot: 'bg-ink-400',
    text: 'text-ink-600 dark:text-ink-400',
    tint: 'bg-ink-500/10',
    label: 'stopped',
  },
  stopping: {
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-500',
    tint: 'bg-amber-500/12',
    label: 'stopping',
  },
  paused: {
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-500',
    tint: 'bg-amber-500/12',
    label: 'paused',
  },
  unknown: {
    dot: 'bg-ink-400',
    text: 'text-ink-600 dark:text-ink-400',
    tint: 'bg-ink-500/10',
    label: 'unknown',
  },
};

function styleFor(status: string) {
  return (
    STATUS_STYLES[status as ContainerStatus] ?? {
      ...STATUS_STYLES.unknown,
      label: status,
    }
  );
}

export function StatusDot({ status }: { status: string }) {
  const style = styleFor(status);

  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${style.dot}`}
      role="img"
      aria-label={style.label}
      title={style.label}
    />
  );
}

/**
 * The word on its own tint.
 *
 * The word carries the colour; there is no dot in front of it. A dot beside
 * "running" is the same fact drawn twice, and the pair read as a control --
 * something with an indicator light on it -- rather than as a label.
 *
 * Rounded to the full height so it is never mistaken for a button either: this
 * is the one thing that says what a row or a page is about, and a reader who
 * tries to press it has been told the wrong thing by the drawing.
 */
export function StatusPill({ status }: { status: string }) {
  const style = styleFor(status);

  return <span className={`pill ${style.tint} ${style.text}`}>{style.label}</span>;
}
