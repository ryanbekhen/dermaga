import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Download, File, Folder, HardDriveDownload, Link2 } from 'lucide-react';
import { api } from '../services/api';
import { onFilesDropped, pathForFile, pickDirectory } from '../services/ipc';
import { useToastStore } from '../store/toastStore';
import { formatBytes } from '../utils/format';
import type { FileEntry } from '../types';
import { PLACEHOLDER_ROWS, PLACEHOLDER_WIDTHS, SkeletonBar } from './Skeleton';

/**
 * The container's filesystem, and a way to move things in and out of it.
 *
 * Copying with a CLI means knowing the path before you start, which is the
 * wrong way round: you look to find out what to copy. So this browses first,
 * and both directions are a drag -- in from Finder, out to it -- because that
 * is how every other file lives on a Mac.
 */
export function FileBrowser({
  container,
  running,
  /** The floor: browsing starts here and cannot go above it. */
  root = '/',
  rootLabel = '/',
  /** Where to land, when that is deeper than the floor. */
  start,
}: {
  container: string;
  running: boolean;
  root?: string;
  rootLabel?: string;
  start?: string;
}) {
  const [path, setPath] = useState(start ?? root);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  const load = useCallback(
    (target: string) => {
      setLoading(true);

      void api
        .listFiles(container, target)
        .then((found) => {
          setEntries(found);
          setError(null);
        })
        .catch((err: unknown) => {
          setEntries([]);
          setError(err instanceof Error ? err.message : 'Could not read this directory');
        })
        .finally(() => setLoading(false));
    },
    [container]
  );

  useEffect(() => {
    // The listing is fetched, not derived: the effect starts the work and the
    // state lands when it answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (running) load(path);
  }, [running, path, load]);

  const copyIn = async (paths: string[]) => {
    if (paths.length === 0) return;

    setBusy('in');

    try {
      await api.copyIntoContainer(container, paths, path);
      pushToast(`Copied ${paths.length} item${paths.length === 1 ? '' : 's'} to ${path}`);
      load(path);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not copy in', 'error');
    } finally {
      setBusy(null);
    }
  };

  // Wails catches the drag before the page sees it, so the drop arrives as an
  // event rather than as a DOM handler. It only fires for a marked target, and
  // the name says which -- this pane is the only one that answers to it.
  useEffect(() => {
    return onFilesDropped((paths, target) => {
      if (target !== 'container-files') return;

      void copyIn(paths);
    });
    // copyIn closes over the directory being shown, which is exactly the one a
    // drop should land in, so the subscription follows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, path]);

  if (!running) {
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-ink-600 dark:text-ink-400">
        Start the container to browse its files.
      </p>
    );
  }

  const saveTo = async (entry: FileEntry) => {
    const dir = await pickDirectory(`Save ${entry.name} to…`);
    if (!dir) return;

    setBusy(entry.path);

    try {
      await api.copyOutOfContainer(container, entry.path, `${dir}/${entry.name}`);
      pushToast(`Saved ${entry.name}`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not copy out', 'error');
    } finally {
      setBusy(null);
    }
  };

  // Below the root the crumbs are relative to it: browsing a volume mounted at
  // /volume should read "/ data logs", not the helper container's own tree.
  const base = root === '/' ? '' : root;
  const segments = path.slice(base.length).split('/').filter(Boolean);

  return (
    // The whole pane takes the drop, not just the rows: a directory with three
    // files in it left most of the panel inert, so the only place a drop landed
    // was the empty strip below the last row.
    <div
      // Wails catches the drag natively, so the events below never fire there.
      // This attribute is what marks the pane as a target for it, and it adds
      // `file-drop-target-active` while a file is over it -- which is why the
      // overlay is driven by CSS as well as by state.
      data-file-drop-target="container-files"
      className="drop-target relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragOver={(e) => {
        // Without this the drop never fires: the browser's default is to
        // refuse anything dragged from outside.
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDropping(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);

        const paths = Array.from(e.dataTransfer.files)
          .map((file) => pathForFile(file))
          .filter((value): value is string => Boolean(value));

        void copyIn(paths);
      }}
    >
      {/* Covers the pane so the target is unmistakable, and lets the pointer
          through so the events keep reaching the panel underneath. */}
      <div
        className={`drop-overlay pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-brand-600/50 bg-brand-600/5 ${
          dropping ? '' : 'hidden'
        }`}
      >
        <span className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold shadow-panel dark:bg-ink-900">
          Copy to {path}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 pb-2.5 dark:border-ink-700">
        <nav className="flex min-w-0 flex-wrap items-center text-xs" aria-label="Path">
          <button onClick={() => setPath(root)} className="btn-ghost px-1.5 py-0.5 font-mono">
            {rootLabel}
          </button>
          {segments.map((segment, index) => (
            <span key={`${segment}-${index}`} className="flex items-center">
              <ChevronRight size={12} className="text-ink-400" aria-hidden />
              <button
                onClick={() => setPath(`${base}/${segments.slice(0, index + 1).join('/')}`)}
                className="btn-ghost px-1.5 py-0.5 font-mono"
              >
                {segment}
              </button>
            </span>
          ))}
        </nav>
      </div>

      {error ? (
        <Empty title="Cannot browse this container" body={error} />
      ) : loading && entries.length === 0 ? (
        <ul className="min-h-0 flex-1 divide-y divide-ink-200 overflow-y-auto dark:divide-ink-800">
          {Array.from({ length: PLACEHOLDER_ROWS }, (_, at) => (
            <li key={at} aria-hidden className="flex items-center gap-3 px-2 py-1.5">
              <SkeletonBar width="14px" height="h-3.5" at={at} className="shrink-0 rounded-sm" />
              <SkeletonBar width={PLACEHOLDER_WIDTHS[at % PLACEHOLDER_WIDTHS.length]} at={at} />
            </li>
          ))}
        </ul>
      ) : entries.length === 0 ? (
        <Empty
          title="Nothing here"
          body={`${path} is empty. Drop files from Finder to put something in it.`}
        />
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-ink-200 overflow-y-auto dark:divide-ink-800">
          {entries.map((entry) => (
            <li
              key={entry.path}
              onDoubleClick={() => entry.isDir && setPath(entry.path)}
              className="group flex items-center gap-3 px-2 py-1.5 hover:bg-ink-50 dark:hover:bg-ink-900"
            >
              <span className="shrink-0 text-ink-500">
                {entry.isLink ? (
                  <Link2 size={14} aria-hidden />
                ) : entry.isDir ? (
                  <Folder size={14} className="text-brand-600 dark:text-brand-400" aria-hidden />
                ) : (
                  <File size={14} aria-hidden />
                )}
              </span>

              <button
                onClick={() => entry.isDir && setPath(entry.path)}
                className={`min-w-0 flex-1 truncate text-left text-xs ${
                  entry.isDir ? 'font-medium' : ''
                }`}
                title={entry.isLink ? `${entry.name} → ${entry.target}` : entry.name}
              >
                {entry.name}
                {entry.isLink && <span className="text-ink-500"> → {entry.target}</span>}
              </button>

              <span className="shrink-0 font-mono text-tiny text-ink-500">{entry.mode}</span>
              <span className="w-20 shrink-0 text-right text-tiny text-ink-500">
                {entry.isDir ? '—' : formatBytes(entry.size)}
              </span>
              <span className="w-28 shrink-0 text-right text-tiny text-ink-500">
                {entry.modified}
              </span>

              <button
                onClick={() => void saveTo(entry)}
                disabled={busy === entry.path}
                className="btn-icon border-transparent opacity-0 group-hover:opacity-100"
                aria-label={`Save ${entry.name} to the Mac`}
                title="Save to the Mac"
              >
                <Download size={13} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-center gap-1.5 pt-2 text-tiny text-ink-500">
        <HardDriveDownload size={11} aria-hidden />
        Drop files here to copy them in; drag a file out to Finder to take it.
      </p>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    // Stretches so the pane stays one continuous target even with nothing in it.
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-sm break-words text-xs leading-relaxed text-ink-600 dark:text-ink-400">
        {body}
      </p>
    </div>
  );
}
