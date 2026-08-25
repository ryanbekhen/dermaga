import { useEffect, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { Badge } from '../components/DataTable';
import releases from '../generated/changelog.json';
import { useChangelogStore } from '../store/changelogStore';
import { openExternal } from '../services/ipc';

interface Release {
  version: string;
  date: string | null;
  summary: string;
  sections: { title: string; entries: string[] }[];
}

/**
 * What changed, in the window rather than on a website.
 *
 * The list is generated from CHANGELOG.md at build time, so the app cannot
 * describe a version differently from the repository, and a packaged build
 * carries its own history rather than fetching one.
 */
export function ChangelogPage({ version }: { version: string }) {
  const markSeen = useChangelogStore((s) => s.markSeen);
  const entries = releases as Release[];

  // Reading the notes is what makes them read; the dot in the sidebar goes.
  useEffect(() => markSeen(version), [markSeen, version]);

  // A page of its own in the sidebar, so it is laid out like the others --
  // Help, Licences -- rather than like something you arrived at from
  // somewhere and can go back from.
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <header>
          <h1 className="text-xl font-semibold">What&rsquo;s new</h1>
          <p className="text-tiny text-ink-600 dark:text-ink-400">
            Every release, newest first · you are running v{version.replace(/^v/, '')}
          </p>
        </header>

        <div className="flex flex-col gap-7 pb-4">
          {entries.map((release) => {
            const running = release.version.replace(/^v/, '') === version.replace(/^v/, '');

            return (
              <section key={release.version} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline gap-2 border-b border-ink-200 pb-1 dark:border-ink-700">
                  <h2 className="text-sm font-semibold">{release.version}</h2>
                  {release.date && <span className="text-tiny text-ink-500">{release.date}</span>}
                  {running && <Badge tone="brand">running</Badge>}
                  {/* An unreleased section is real work already merged, but not
                      yet something anyone can download; saying so beats letting
                      it read as part of the running build. */}
                  {release.version.toLowerCase() === 'unreleased' && <Badge>not shipped yet</Badge>}
                </div>

                {release.summary && (
                  <p className="text-xs leading-relaxed text-ink-700 dark:text-ink-300">
                    {inline(release.summary)}
                  </p>
                )}

                {release.sections.map((section) => (
                  <div key={section.title} className="flex flex-col gap-1.5">
                    <h3 className="label-caps">{section.title}</h3>
                    <ul className="flex flex-col gap-1.5">
                      {section.entries.map((entry, index) => (
                        <li
                          key={index}
                          className="flex gap-2 text-xs leading-relaxed text-ink-700 dark:text-ink-300"
                        >
                          <Sparkles
                            size={12}
                            className="mt-0.5 shrink-0 text-ink-400 dark:text-ink-600"
                            aria-hidden
                          />
                          <span className="selectable">{inline(entry)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * The three pieces of markdown the changelog uses: **bold** for the lead of an
 * entry, *italic* for something quoted from a log, and `code` for a flag or a
 * path. Built as elements rather than HTML, so nothing in the file can become
 * markup.
 */
export function inline(text: string): ReactNode[] {
  // `@handle` is the last alternative, and the only one that has to care what
  // comes before it: the lookbehind is what keeps an address out of it, so
  // `someone@example.com` stays a piece of text rather than becoming a link to
  // a person called example.
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|(?<![\w@.-])@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/g)
    .map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={index} className="font-semibold text-ink-900 dark:text-ink-100">
            {part.slice(2, -2)}
          </strong>
        );
      }

      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        return (
          <em key={index} className="italic">
            {part.slice(1, -1)}
          </em>
        );
      }

      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={index} className="rounded bg-ink-100 px-1 font-mono text-tiny dark:bg-ink-800">
            {part.slice(1, -1)}
          </code>
        );
      }

      // Somebody who worked on the release, as the person rather than as a
      // string. Opened outside rather than followed: this window is the app, and
      // a link that navigated it would replace Dermaga with a web page and leave
      // no way back.
      if (part.startsWith('@') && part.length > 1) {
        const url = `https://github.com/${part.slice(1)}`;

        return (
          <a
            key={index}
            href={url}
            onClick={(event) => {
              event.preventDefault();
              void openExternal(url);
            }}
            className="font-medium text-brand-700 hover:underline dark:text-brand-400"
          >
            {part}
          </a>
        );
      }

      return part;
    });
}
