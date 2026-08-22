import { useMemo, useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import { openExternal } from '../services/ipc';
import { useUIStore } from '../store/uiStore';

/**
 * Help, in the shape help is usually in.
 *
 * This was fourteen cards of equal weight in a two-column grid -- everything
 * the app does, in no particular order, with nothing to search and nothing to
 * say which of it mattered. That is a page of tips, not a help system: the
 * question somebody arrives with is "why is this doing that", and the answer
 * was somewhere in the middle of the wall.
 *
 * So: a field that filters, topics grouped under headings that say what kind
 * of question they answer, troubleshooting given a section of its own rather
 * than a card among equals, and the way out -- issues, docs, the changelog --
 * at the bottom where it is looked for.
 */

interface Topic {
  question: string;
  answer: string;
  /** Extra words to match on that the text does not happen to contain. */
  keywords?: string;
}

interface Section {
  title: string;
  topics: Topic[];
}

const SECTIONS: Section[] = [
  {
    title: 'Getting started',
    topics: [
      {
        question: 'What Dermaga is',
        answer:
          "A window over Apple's own container CLI, not a replacement for it. Every action shells out to that CLI, so anything you do here is visible to `container ls`, and anything you do in a terminal shows up here within seconds.",
        keywords: 'about what is docker desktop alternative',
      },
      {
        question: 'Nothing starts, and nothing explains why',
        answer:
          'Open System. Containers run inside a Linux VM, and without the background services running nothing else can work — Dermaga replaces its whole window with a button to start them. You can also read their logs there and reclaim disk space.',
        keywords: 'broken stuck services machine vm not working',
      },
      {
        question: 'Everything is live',
        answer:
          'There is no refresh button and no polling. The agent holds a stream open and pushes new state the instant anything changes, including changes you make in a terminal. Logs and pull progress arrive the same way.',
        keywords: 'refresh reload update realtime polling',
      },
      {
        question: 'Working without the mouse',
        answer:
          'Cmd+1 through Cmd+9 switch tabs on any detail page, the way they do in Safari and Finder. Inside a dialog, Return in a list of ports or volumes adds another row and puts the caret in it, Cmd+Return does what the main button does, and Escape closes without saving. Tab wraps at the end of a dialog rather than escaping to the page behind it.',
        keywords: 'keyboard shortcut tab focus accessibility dialog form',
      },
      {
        question: 'Finding anything: ⌘K',
        answer:
          'Cmd+K puts the caret in the search field at the top of the window. It finds containers, images, volumes, networks, machines and pages by name — and the things you can do to them: start, stop or restart a container or a machine, run a container from an image, attach or detach a network, or open the create, pull, build and load forms directly. Arrow keys walk the results, Return opens the one you are on.',
        keywords: 'search command palette shortcut cmd k find',
      },
    ],
  },
  {
    title: 'Containers',
    topics: [
      {
        question: 'A shell inside a container',
        answer:
          'The Terminal tab attaches `container exec` to a pty, so you get a real prompt with line editing, colours and resize. It prefers bash and falls back to sh. Run as opens it as the image’s own user, as root, or as anyone else.',
        keywords: 'exec bash sh tty console',
      },
      {
        question: 'Editing a container recreates it',
        answer:
          'Apple’s CLI has no update command, so saving the edit form stops, deletes and re-runs the container with the new spec. Named volumes survive; the container filesystem does not, and the form says so before you commit. A change that fails to start rolls back to the previous container, and what you typed is kept.',
        keywords: 'update change modify recreate rollback env',
      },
      {
        question: 'Files in and out',
        answer:
          'The Files tab browses a running container and moves things both ways: drop from Finder to copy in, drag a file out to take it. Browsing runs `ls` inside the container, so an image built FROM scratch has nothing to browse with and says so.',
        keywords: 'copy cp drag drop finder filesystem',
      },
      {
        question: 'What a container is doing',
        answer:
          'The Usage tab draws CPU, memory, network and disk as they happen — a reading every five seconds over the last two minutes. The shape is what a live number cannot show: memory that climbs and never falls is a leak; a burst of traffic every thirty seconds is a health check rather than a user.',
        keywords: 'stats cpu memory chart graph metrics',
      },
      {
        question: 'Starting a container with Dermaga',
        answer:
          'Mark one and it comes up when the agent does — when you open the app, or at login with the background service on. It is not a restart policy: nothing watches a container that dies later, because without the service there is nothing running to watch it.',
        keywords: 'autostart boot login restart policy',
      },
      {
        question: 'When a container dies',
        answer:
          'A container that stops without being asked to is reported in the window, and as a sound when the window is not what you are looking at. A stop you asked for stays quiet. macOS only delivers notifications from an app signed with a Developer ID, so on a build you made yourself they are attempted and rarely arrive.',
        keywords: 'exit crash notification alert sound',
      },
    ],
  },
  {
    title: 'Images and security',
    topics: [
      {
        question: 'Vulnerabilities are scanned in the background',
        answer:
          'Images are scanned as they appear, not when you ask, so the answer is usually waiting by the time you open one. Results are kept between launches and refreshed when the vulnerability database turns over, when the scanner is upgraded, when a tag moves to a new digest, or after twelve hours. Everything runs on this Mac; nothing about your images leaves it.',
        keywords: 'cve trivy scan security severity',
      },
      {
        question: 'Reading the Packages tab',
        answer:
          'One row per package, with a bar of five segments against it — critical, high, medium, low, unknown. Packages with findings sort to the top, worst first; the rest of the inventory follows alphabetically. Open a row to see the CVEs in that package, and open a CVE for a window of its own with the description, the CVSS vector read out in words, every vendor’s score and all the references.',
        keywords: 'packages cve severity bar strip findings',
      },
      {
        question: 'Building an image',
        answer:
          'Build on the Images page takes a context folder, a tag and the usual build arguments. Progress appears as a row in the list rather than a log window, and the builder container is started for you the first time.',
        keywords: 'dockerfile build context buildkit',
      },
      {
        question: 'Moving an image without a registry',
        answer:
          'Save writes an image out as an OCI archive, and Load reads one back in. An archive holds a single platform, so one is chosen when the image has more than one; only the variants actually pulled here can be written out.',
        keywords: 'export import oci archive tar save load',
      },
      {
        question: 'Pushing to a registry',
        answer:
          'Sign in under Registries, then push from an image’s page; it is tagged for the destination first if the name differs. Credentials go to Apple’s CLI over stdin and are never held here. A registry on this machine has no TLS, so Plain HTTP is set for you when the address is local.',
        keywords: 'push pull login credentials docker hub ghcr',
      },
      {
        question: 'Deleting an image removes every tag on it',
        answer:
          'References that share a digest are one image, and removing a single tag would leave the bytes on disk under another name. That is why tags sharing a digest are shown as one row.',
        keywords: 'remove rm tag digest',
      },
    ],
  },
  {
    title: 'Volumes, networks and machines',
    topics: [
      {
        question: 'Looking inside a volume nothing has mounted',
        answer:
          'Dermaga starts a small helper container to read it. Rather than fetch that image from a registry — which would put the network between you and your own data — it keeps a copy as an OCI archive in ~/.dermaga and loads it back when the image is gone.',
        keywords: 'volume browse helper mount offline',
      },
      {
        question: 'Seeing a network',
        answer:
          'Open one and it is drawn: the network in the middle, every container attached around the edge with the address it holds there, and the gateway as a node of its own. Attach or detach a container from the network’s page, or from search.',
        keywords: 'network topology graph attach detach ip',
      },
      {
        question: 'Machines are not containers',
        answer:
          'Containers run inside a Linux VM, called a machine. You can create, boot, stop, resize (CPU, memory, home mount) and delete them. If containers will not start at all, the machine is the first place to look after System.',
        keywords: 'vm virtual machine linux kernel resize',
      },
    ],
  },
  {
    title: 'Keeping it current',
    topics: [
      {
        question: 'Updating Dermaga',
        answer:
          'The title bar says when a newer release exists: one click downloads it, opens the installer and stands aside so it can be replaced. Click the version itself to read what changed in each release.',
        keywords: 'update upgrade version release changelog',
      },
      {
        question: 'Updating the container CLI',
        answer:
          'System shows the installed version and offers an update when Homebrew has a newer one. The check reads Homebrew’s local index rather than running brew update, so it costs nothing and never changes your Homebrew state on its own. A CLI installed from Apple’s .pkg is left alone.',
        keywords: 'homebrew brew cli apple container update',
      },
      {
        question: 'Where settings are kept',
        answer:
          'Preferences are plain JSON in ~/.dermaga/config.json, safe to edit by hand or keep in dotfiles. Scan results, templates and unfinished edits live beside it in ~/.dermaga/dermaga.db.',
        keywords: 'config settings json database bbolt dotfiles',
      },
    ],
  },
];

// Two groups, because the same key means different things in each: Return
// opens a search result and adds a row to a list, and Escape clears a query
// and closes a dialog. One flat table of that is a table nobody trusts.
const KEYS: { where: string; keys: [string, string][] }[] = [
  {
    where: 'Anywhere',
    keys: [
      ['⌘K', 'Search everything, and act on what you find'],
      ['↑ ↓', 'Move through the results'],
      ['↩', 'Open the result you are on'],
      ['⌘1…9', 'Switch tab on a detail page'],
      ['⌘,', 'Settings'],
      ['Esc', 'Clear the search'],
    ],
  },
  {
    where: 'In a dialog',
    keys: [
      ['↩', 'In a list of ports, volumes or labels: add another row and go to it'],
      ['⌘↩', 'Do what the dialog’s main button does'],
      ['⇥', 'Next field; the last one wraps back to the first'],
      ['Esc', 'Close without saving'],
    ],
  },
];

export function HelpView({ version }: { version: string }) {
  const navigate = useUIStore((s) => s.navigate);
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();

  const sections = useMemo(() => {
    if (!needle) return SECTIONS;

    return SECTIONS.map((section) => ({
      ...section,
      topics: section.topics.filter((topic) =>
        `${topic.question} ${topic.answer} ${topic.keywords ?? ''}`.toLowerCase().includes(needle)
      ),
    })).filter((section) => section.topics.length > 0);
  }, [needle]);

  const found = sections.reduce((sum, section) => sum + section.topics.length, 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
      {/* One column, and a narrow one. Help is read a sentence at a time, and
          two columns make the reader choose which side to start on. */}
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-4">
          <div>
            <h1 className="text-page font-semibold">Help</h1>
            <p className="pt-1 text-small text-ink-600 dark:text-ink-400">
              Dermaga v{version} · a window over Apple&rsquo;s{' '}
              <code className="font-mono">container</code> CLI · MIT licensed
            </p>
          </div>

          {/* The field is what makes this help rather than an article: nobody
              reads a help page from the top, they arrive with one question. */}
          <div className="relative">
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search help…"
              aria-label="Search help"
              className="input h-9 w-full rounded-lg pl-9"
            />
          </div>
        </header>

        {needle && found === 0 ? (
          <p className="py-8 text-center text-body text-ink-600 dark:text-ink-400">
            Nothing here matches “{query}”. If the answer is missing rather than hidden,{' '}
            <ExternalButton href="https://github.com/ryanbekhen/dermaga/issues/new/choose">
              ask for it
            </ExternalButton>
            .
          </p>
        ) : (
          sections.map((section) => (
            <section key={section.title} className="flex flex-col gap-3">
              <h2 className="label-mono border-b border-ink-200 pb-1.5 dark:border-ink-800">
                {section.title}
              </h2>

              <div className="flex flex-col gap-4">
                {section.topics.map((topic) => (
                  <div key={topic.question} className="flex flex-col gap-1">
                    <h3 className="text-item font-medium">{topic.question}</h3>
                    <p className="selectable text-body leading-relaxed text-ink-600 dark:text-ink-400">
                      {topic.answer}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}

        {!needle && (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="label-mono border-b border-ink-200 pb-1.5 dark:border-ink-800">
                Keyboard
              </h2>
              {KEYS.map(({ where, keys }) => (
                <div key={where} className="flex flex-col gap-1">
                  <p className="text-small font-medium">{where}</p>
                  <dl className="flex flex-col">
                    {keys.map(([combination, description]) => (
                      <div
                        key={combination}
                        className="flex items-baseline justify-between gap-4 border-b border-ink-150 py-1.5 last:border-0 dark:border-ink-800"
                      >
                        <dt className="w-16 shrink-0 font-mono text-small font-medium">
                          {combination}
                        </dt>
                        <dd className="flex-1 text-small text-ink-600 dark:text-ink-400">
                          {description}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </section>

            {/* The way out, at the bottom, which is where it is looked for. */}
            <section className="flex flex-col gap-3">
              <h2 className="label-mono border-b border-ink-200 pb-1.5 dark:border-ink-800">
                More help
              </h2>
              <ul className="flex flex-col gap-2 text-body">
                <li>
                  <button
                    onClick={() => navigate({ name: 'changelog' })}
                    className="font-medium text-brand-700 hover:underline dark:text-brand-400"
                  >
                    What changed in each release
                  </button>
                </li>
                <li>
                  <ExternalButton href="https://github.com/ryanbekhen/dermaga#readme">
                    Documentation on GitHub
                  </ExternalButton>
                </li>
                <li>
                  <ExternalButton href="https://github.com/ryanbekhen/dermaga/issues/new/choose">
                    Report a problem, or ask for something
                  </ExternalButton>
                </li>
                <li>
                  <ExternalButton href="https://github.com/ryanbekhen/dermaga/security/advisories/new">
                    Report a security problem privately
                  </ExternalButton>
                </li>
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function ExternalButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        void openExternal(href);
      }}
      className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline dark:text-brand-400"
    >
      {children}
      <ExternalLink size={12} aria-hidden />
    </a>
  );
}
