import { Star } from 'lucide-react';
import type { ContainerStatus } from '../types';

/**
 * A status is a colour and a word, never a colour alone.
 *
 * Each carries two: the word's own colour, and a solid one for the dot that
 * stands in for it where there is no room to write it out. The dark half of
 * every pair is lighter, because the same green legible on warm paper
 * disappears against near-black.
 */
const STATUS_STYLES: Record<ContainerStatus, { dot: string; text: string; label: string }> = {
  running: {
    dot: 'bg-emerald-600',
    text: 'text-emerald-700 dark:text-emerald-500',
    label: 'running',
  },
  stopped: {
    dot: 'bg-ink-400',
    text: 'text-ink-600 dark:text-ink-400',
    label: 'stopped',
  },
  stopping: {
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-500',
    label: 'stopping',
  },
  paused: {
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-500',
    label: 'paused',
  },
  unknown: {
    dot: 'bg-ink-400',
    text: 'text-ink-600 dark:text-ink-400',
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
 * The word, in the colour of what it says.
 *
 * Nothing around it. It was set on a rounded tint, and a tinted capsule is what
 * this window uses for things you press -- so the one part of a row that is
 * purely a reading looked like the one part you could act on. Down a column of
 * forty rows it also drew forty little boxes, which is a lot of furniture for a
 * word that is usually the same word.
 *
 * The colour does the work: green is up, amber is on its way somewhere, grey is
 * stopped. There is no dot in front either -- a dot beside "running" is the
 * same fact drawn twice.
 */
export function StatusText({ status }: { status: string }) {
  const style = styleFor(status);

  return <span className={`text-tiny font-medium ${style.text}`}>{style.label}</span>;
}

/**
 * The machine a container lands in when nothing says otherwise.
 *
 * The same filled star the detail page's button wears when it is already
 * true -- so the thing that sets it and the thing that reports it are the
 * same shape, and learning one teaches the other.
 */
export function DefaultStar() {
  return (
    <span
      title="The default machine"
      aria-label="The default machine"
      className="shrink-0 text-amber-600 dark:text-amber-500"
    >
      <Star size={13} className="fill-current" aria-hidden />
    </span>
  );
}
