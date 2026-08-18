import { useEffect, useRef, useState } from 'react';
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useScannerStore } from '../store/scannerStore';
import { formatDuration } from '../utils/format';
import type { ScannerStatus } from '../types';

/**
 * The scanner's line in the status bar: quiet when there is nothing to say,
 * and a plain sentence about what is happening when there is.
 *
 * Clicking it opens the detail, which is where the one thing the user has to
 * know lives: this work belongs to the app, so closing the window abandons it.
 */
export function ScannerStatusItem() {
  const status = useScannerStore((s) => s.status);
  const scanned = useScannerStore((s) => Object.keys(s.reports).length);
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  // Clicking anywhere else dismisses it, the way a menu does.
  useEffect(() => {
    if (!open) return;

    const dismiss = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('mousedown', dismiss);
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Always present, the way a status bar item is: quiet when idle, loud while
  // working. Hiding it when idle meant the one thing the user wanted to see --
  // that scanning happens at all -- vanished the moment it finished.
  if (!status) return null;

  const busy = status.state !== 'idle' && status.state !== 'failed';
  const failed = status.state === 'failed';

  return (
    <div ref={wrapper} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title="What the vulnerability scanner is doing"
        className={`flex items-center gap-1.5 rounded px-1 hover:bg-ink-200/60 dark:hover:bg-ink-800 ${
          failed ? 'text-amber-600 dark:text-amber-500' : ''
        }`}
      >
        {failed ? (
          <ShieldAlert size={11} aria-hidden />
        ) : busy ? (
          <Loader2 size={11} className="animate-spin" aria-hidden />
        ) : (
          <ShieldCheck size={11} aria-hidden />
        )}
        <span className="max-w-56 truncate">{summarise(status, scanned)}</span>
        {status.state === 'updatingDatabase' && status.percent ? (
          <span className="tabular-nums opacity-70">{status.percent}%</span>
        ) : null}
      </button>

      {open && <Detail status={status} scanned={scanned} />}
    </div>
  );
}

function Detail({ status, scanned }: { status: ScannerStatus; scanned: number }) {
  const busy = status.state !== 'idle' && status.state !== 'failed';
  const percent = status.state === 'updatingDatabase' ? (status.percent ?? 0) : 0;

  return (
    <div
      role="dialog"
      aria-label="Vulnerability scanner"
      // Anchored to the bar it belongs to, right-aligned so it never leaves the
      // window on a narrow one.
      className="absolute bottom-6 right-0 z-40 w-80 rounded-lg border border-ink-200 bg-white p-3 text-left shadow-panel dark:border-ink-700 dark:bg-ink-900"
    >
      <p className="text-xs font-semibold">{summarise(status, scanned)}</p>

      {status.state === 'scanning' && status.total && status.total > 1 && (
        <p className="mt-0.5 text-tiny text-ink-600 dark:text-ink-400">
          Image {status.position} of {status.total} in this pass.
        </p>
      )}

      {percent > 0 && (
        <div className="mt-2 h-0.75 w-full overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
          <div
            className="h-full rounded-full bg-brand-600 transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {status.error && (
        <p className="mt-2 text-tiny leading-relaxed text-amber-700 dark:text-amber-500">
          {status.error}
        </p>
      )}

      {busy && (
        // The one thing worth interrupting for: this work dies with the window.
        <p className="mt-2 rounded-md bg-ink-100 p-2 text-tiny leading-relaxed text-ink-700 dark:bg-ink-800 dark:text-ink-300">
          Leave Dermaga open until this finishes. Closing it stops the work, and it starts again
          from the beginning next time.
        </p>
      )}

      <dl className="mt-2.5 space-y-1 border-t border-ink-200 pt-2.5 text-tiny dark:border-ink-700">
        <Fact
          label="Scanner"
          value={status.installed ? `Trivy ${status.version ?? ''}`.trim() : 'not installed yet'}
        />
        <Fact
          label="Database"
          value={
            status.databaseUpdatedAt
              ? `updated ${formatDuration(status.databaseUpdatedAt)} ago`
              : 'not downloaded yet'
          }
        />
        <Fact label="Images scanned" value={String(scanned)} />
      </dl>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-600 dark:text-ink-400">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

/** One sentence, in the words a developer would use. */
function summarise(status: ScannerStatus, scanned = 0): string {
  switch (status.state) {
    case 'installing':
      return 'Installing the vulnerability scanner…';
    case 'updating':
      return status.latestVersion
        ? `Updating scanner to ${status.latestVersion}…`
        : 'Updating the vulnerability scanner…';
    case 'updatingDatabase':
      return 'Downloading vulnerability database';
    case 'scanning': {
      // "docker.io/library/postgres:18.6" is most of the bar and none of it is
      // news; the last segment is the part worth reading.
      const name = status.target?.split('/').pop() ?? '';
      const queue = status.total && status.total > 1 ? ` (${status.position}/${status.total})` : '';
      return `Scanning ${name}${queue}`.trim();
    }
    case 'failed':
      return status.detail || 'Scanner problem';
    default:
      // Idle still says something: how much it has covered, so the feature is
      // visibly there rather than only appearing for the seconds it works.
      return scanned > 0
        ? `${scanned} image${scanned === 1 ? '' : 's'} scanned`
        : 'No images scanned yet';
  }
}
