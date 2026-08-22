import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import notices from '../generated/notices.json';
import { openExternal } from '../services/ipc';

interface Notice {
  name: string;
  version: string;
  licence: string;
  url?: string;
  text: string;
}

/**
 * Every open-source package inside the app, with its licence in full.
 *
 * MIT, ISC and BSD all require their notice to travel with the binary, so this
 * is a condition of shipping rather than a courtesy. The list is generated at
 * build time by scripts/notices.mjs -- a hand-written one drifts, and a drifted
 * licence list misstates what is actually inside.
 */
export function LicenceList() {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const packages = useMemo(
    () => [...(notices as Notice[])].sort((a, b) => a.name.localeCompare(b.name)),
    []
  );

  const reveal = (entry: Notice) => setOpen(open === entry.name ? null : entry.name);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return packages;

    return packages.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) || entry.licence.toLowerCase().includes(needle)
    );
  }, [packages, filter]);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold">{packages.length} packages</p>

        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter licences"
          className="input w-40"
        />
      </div>

      <p className="text-tiny leading-relaxed text-ink-600 dark:text-ink-400">
        Every licence is reproduced in full, as those licences require.
      </p>

      <ul className="divide-y divide-ink-200 border-y border-ink-200 dark:divide-ink-800 dark:border-ink-800">
        {visible.map((entry) => {
          const expanded = open === entry.name;

          return (
            <li key={entry.name}>
              <button
                onClick={() => reveal(entry)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-3 py-2 text-left hover:bg-ink-50 dark:hover:bg-ink-900"
              >
                <ChevronDown
                  size={13}
                  aria-hidden
                  className={`shrink-0 text-ink-500 transition-transform ${expanded ? '' : '-rotate-90'}`}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{entry.name}</span>
                <span className="shrink-0 font-mono text-tiny text-ink-500">{entry.version}</span>
                <span className="shrink-0 text-tiny font-semibold text-ink-600 dark:text-ink-400">
                  {entry.licence}
                </span>
              </button>

              {expanded && (
                <div className="pb-3 pl-7">
                  {entry.url && (
                    <a
                      href={entry.url}
                      onClick={(event) => {
                        event.preventDefault();
                        void openExternal(entry.url!);
                      }}
                      className="text-tiny text-brand-700 hover:underline dark:text-brand-400"
                    >
                      {entry.url}
                    </a>
                  )}

                  <pre className="selectable mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-ink-50 p-3 font-mono text-tiny leading-relaxed dark:bg-ink-950">
                    {entry.text || '(no licence file found in the published package)'}
                  </pre>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
