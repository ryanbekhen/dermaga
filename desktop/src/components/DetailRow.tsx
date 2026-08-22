import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * A titled group of label/value rows. Deliberately unboxed: a detail page is
 * one flat sheet, ruled off by the same mono caps the list columns use.
 *
 * Boxing them was tried and it turned the page into a quilt. Panels of very
 * different heights cannot be made to line up -- two facts beside twelve
 * leaves a hand's width of nothing under the short one, and every border on
 * the page draws attention to it. Without the borders the raggedness is simply
 * not visible, because there is no edge for the eye to measure it against.
 *
 * Its rows sit in a two-column grid by default, so a group of facts has the
 * same shape on every page without each one asking for it. Groups holding
 * something other than rows -- charts, meters, a list of containers -- pass
 * `plain` and lay themselves out.
 */
export function Section({
  title,
  action,
  children,
  span = false,
  plain = false,
}: {
  title: string;
  /** Optional control beside the heading, e.g. a show/hide toggle. */
  action?: ReactNode;
  children: ReactNode;
  span?: boolean;
  /** The group brings its own layout rather than a grid of rows. */
  plain?: boolean;
}) {
  return (
    <section className={`flex flex-col gap-2.5 ${span ? 'lg:col-span-2' : ''}`}>
      <div className="flex items-center justify-between gap-3 border-b border-ink-200 pb-1.5 dark:border-ink-800">
        <h2 className="label-mono">{title}</h2>
        {action}
      </div>
      {plain ? <div className="flex flex-col gap-2">{children}</div> : <Facts>{children}</Facts>}
    </section>
  );
}

/**
 * The grid a group of rows sits in, exported for the few places that need one
 * inside a `plain` section -- a container's addresses, one grid per interface.
 */
export function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-5 gap-y-3.5">{children}</dl>;
}

interface RowProps {
  label: string;
  value?: string | number | null;
  mono?: boolean;
  /** Adds a click-to-copy button — for addresses, IDs and digests. */
  copyable?: boolean;
  /** Spans both columns — for the values no half-width column can hold. */
  wide?: boolean;
}

/**
 * One fact: its label above, its value below.
 *
 * The label used to sit left of a right-aligned value, which reads well only
 * when the values are all about the same size. They never are -- an IPv6
 * prefix beside an MTU, a digest beside a port -- so the eye zigzagged down a
 * ragged edge, and whatever did not fit was truncated, which for an address or
 * a digest is worse than showing nothing at all. Stacked, everything lands on
 * one left edge and long values wrap instead of disappearing.
 */
export function Row({ label, value, mono = false, copyable = false, wide = false }: RowProps) {
  const [copied, setCopied] = useState(false);
  const text = value === undefined || value === null || value === '' ? '—' : String(value);
  const canCopy = copyable && text !== '—';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard access can be denied; the value is still selectable.
    }
  };

  return (
    <div className={`group flex min-w-0 flex-col gap-0.5 ${wide ? 'col-span-2' : ''}`}>
      <dt className="label-mono truncate" title={label}>
        {label}
      </dt>
      <dd className="flex items-start gap-1">
        <span
          className={`selectable min-w-0 break-all leading-snug text-ink-800 dark:text-ink-100 ${
            mono ? 'font-mono text-small' : 'text-body'
          }`}
        >
          {text}
        </span>
        {canCopy && (
          <button
            onClick={() => void copy()}
            className="mt-0.5 shrink-0 text-ink-400 opacity-0 transition-opacity hover:text-brand-600 focus-visible:opacity-100 group-hover:opacity-100"
            title={`Copy ${label}`}
            aria-label={`Copy ${label}`}
          >
            {copied ? (
              <Check size={12} className="text-emerald-600" aria-hidden />
            ) : (
              <Copy size={12} aria-hidden />
            )}
          </button>
        )}
      </dd>
    </div>
  );
}

/** A short on/off marker for the handful of boolean runtime settings. */
export function Flags({ flags }: { flags: { label: string; on: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {flags.map(({ label, on }) => (
        <span
          key={label}
          className={`rounded-md px-2 py-0.5 font-mono text-tiny ${
            on
              ? 'bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-400'
              : 'bg-ink-150 text-ink-500 dark:bg-ink-800 dark:text-ink-400'
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}
