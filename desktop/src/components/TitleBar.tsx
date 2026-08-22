import { useEffect, useRef } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  Loader2,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
  Zap,
  ZapOff,
} from 'lucide-react';
import logo from '@assets/logo.png';
import { ContainerNamesItem } from './ContainerNamesItem';
import { KernelStatusItem } from './KernelStatusItem';
import { TaskStatusItem } from './TaskStatusItem';
import { useFullScreen } from '../hooks/useFullScreen';
import { useUpdate } from '../hooks/useUpdate';
import { useUnreadChangelog } from '../store/changelogStore';
import { useUIStore } from '../store/uiStore';
import type { ConnectionState } from '../hooks/useEventStream';
import type { BuildInfo, SystemStatus } from '../types';

interface TitleBarProps {
  build: BuildInfo | null;
  system: SystemStatus | null;
  connection: ConnectionState;
  /** Whatever the agent last failed at, or null while it is behaving. */
  error: string | null;
}

/**
 * The strip the window is held by, and the one piece of chrome that spans it.
 *
 * Everything that belongs to the app rather than to any page lives along it:
 * what this is, how to reach anything by name, and the handful of things that
 * can be wrong with the machine underneath -- no kernel, names not resolving,
 * an update waiting, a scan running, the agent gone quiet.
 *
 * Those last ones used to have a strip of their own at the foot of the window.
 * It was a second piece of chrome earning its keep for about a minute a week:
 * most of the time it held a version number and a CLI version, neither of
 * which anybody was reading. They sit up here now, beside the engine light,
 * which is the other thing on screen that reports on the machine rather than
 * on the work.
 *
 * The scanner is not among them. It works through images on its own and
 * rescans anything older than three hours, so a permanent readout of it would
 * be a light that is on more often than not and tells nobody anything they
 * asked for. What it is doing is on the image it is doing it to -- the Scan
 * button there spins -- and the one moment worth interrupting for, a scan that
 * failed, arrives as a toast.
 */
export function TitleBar({ build, system, connection, error }: TitleBarProps) {
  const fullScreen = useFullScreen();
  const navigate = useUIStore((s) => s.navigate);
  const query = useUIStore((s) => s.globalQuery);
  const setQuery = useUIStore((s) => s.setGlobalQuery);
  const hasUnread = useUnreadChangelog(build?.version);
  const field = useRef<HTMLInputElement>(null);

  // ⌘K puts the cursor here, and Escape puts the app back where it was.
  //
  // ⌘K used to open a palette over the page -- a second box, in a second
  // place, searching the same things this one does. There is one search now
  // and it is always on screen, so the shortcut points at it rather than at a
  // copy of it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        field.current?.focus();
        field.current?.select();
        return;
      }

      if (event.key === 'Escape' && document.activeElement === field.current) {
        setQuery('');
        field.current?.blur();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setQuery]);

  return (
    <header className="drag flex h-13 shrink-0 items-center gap-4 border-b border-black/50 bg-chrome-bg px-4 text-chrome-text">
      {/* The traffic lights are drawn by macOS over this corner, so the row
          starts to the right of them. Fullscreen takes them away. */}
      <div
        className={`shrink-0 transition-[width] duration-200 ease-out ${
          fullScreen ? 'w-0' : 'w-15.5'
        }`}
      />

      <div className="flex shrink-0 items-center gap-2.5">
        <img src={logo} alt="" className="h-5.5 w-5.5 object-contain" />
        <span className="text-sm font-semibold tracking-[-0.1px]">Dermaga</span>
        {build?.version && (
          // The stamp doubles as the way into the notes. It is the only place
          // the version is written now, so the question it prompts -- what
          // changed? -- is answered by pressing the thing that prompted it.
          <button
            onClick={() => navigate({ name: 'changelog' })}
            title={`${buildTitle(build)}\nClick to see what changed`}
            className="no-drag relative rounded-md bg-chrome-raised px-1.5 py-0.5 font-mono text-tiny text-chrome-dim transition-colors hover:text-chrome-text"
          >
            v{build.version}
            {hasUnread && (
              <span
                className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-brand-500 ring-2 ring-chrome-bg"
                aria-hidden
              />
            )}
          </button>
        )}
      </div>

      <div className="flex min-w-0 flex-1 justify-center">
        {/* Searching from up here asks every kind of resource at once, so it
            cannot belong to a page: the answer is a page of its own, and the
            box that asked for it has to stay put while you read it. */}
        <div className="no-drag flex h-7.5 w-full max-w-105 items-center gap-2 rounded-lg border border-chrome-line bg-chrome-raised px-2.5 focus-within:border-chrome-faint">
          <Search size={13} className="shrink-0 text-chrome-faint" aria-hidden />
          <input
            ref={field}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search containers, images, volumes…"
            aria-label="Search everything"
            className="min-w-0 flex-1 bg-transparent text-small text-chrome-text outline-hidden placeholder:text-chrome-faint focus-visible:ring-0"
          />
          {!query && <span className="shrink-0 font-mono text-tiny text-chrome-faint">⌘K</span>}
          {query && (
            <button
              onClick={() => {
                setQuery('');
                field.current?.focus();
              }}
              aria-label="Clear search"
              className="shrink-0 text-chrome-faint transition-colors hover:text-chrome-text"
            >
              <X size={13} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {/* Right to left: the things that are only sometimes there, then the
          light that is always there. Ordering it the other way put the engine
          somewhere different depending on whether a scan was running. */}
      <div className="flex shrink-0 items-center gap-1">
        {error && <Problem label={error} />}
        <TaskStatusItem />
        <KernelStatusItem />
        <ContainerNamesItem />
        <UpdatePill />
        <EngineStatus system={system} connection={connection} />
      </div>
    </header>
  );
}

/**
 * Whether the thing this app is a window onto is answering.
 *
 * Three states rather than two: an engine that is running and an agent that has
 * stopped relaying what it says look identical from here if you only ask the
 * first question, and the difference is the difference between "nothing is
 * happening" and "nothing is being reported".
 */
function EngineStatus({
  system,
  connection,
}: {
  system: SystemStatus | null;
  connection: ConnectionState;
}) {
  // A different glyph for each state, not one glyph in three colours. The
  // difference that matters here -- the engine being down, which is why
  // nothing else works -- has to survive being seen quickly, at this size, by
  // someone who does not separate green from grey.
  //
  // The words go into the label and the tooltip rather than onto the bar: they
  // were the same three words nearly all of the time, and a bar that repeats
  // "Engine running" all day is a bar that stops being read.
  const state =
    connection === 'disconnected'
      ? {
          icon: TriangleAlert,
          tone: 'text-amber-500',
          label: 'Agent offline',
          title: 'Lost contact with the Dermaga agent',
        }
      : system?.running
        ? {
            icon: Zap,
            tone: 'text-emerald-500',
            label: 'Engine running',
            title: system.status,
          }
        : {
            icon: ZapOff,
            tone: 'text-chrome-faint',
            label: 'Engine stopped',
            title: system?.status ?? 'Unknown',
          };

  return (
    <div
      title={`${state.label} — ${state.title}`}
      aria-label={state.label}
      role="status"
      // no-drag, or the tooltip never appears. The bar is the window's drag
      // handle, and a draggable region swallows hover -- so a title attribute
      // on a plain div in here is a tooltip nobody can reach. It mattered
      // little while the words were on the bar; now they are the only place
      // the words exist.
      className={`no-drag flex shrink-0 cursor-default items-center pl-2 ${state.tone}`}
    >
      <state.icon size={14} aria-hidden />
    </div>
  );
}

/**
 * Whatever the agent last failed at.
 *
 * Truncated hard and carried in full by the tooltip: these are runtime errors
 * quoting image references and paths, and one of them at full length would push
 * everything else off the bar.
 */
function Problem({ label }: { label: string }) {
  return (
    <span title={label} className="flex min-w-0 items-center gap-1.5 px-1.5 text-xs text-amber-500">
      <AlertTriangle size={12} className="shrink-0" aria-hidden />
      <span className="max-w-64 truncate">{label}</span>
    </span>
  );
}

/**
 * Sits quiet until an update is not only found but downloaded and checked.
 *
 * Nothing is shown while it is being fetched. Nobody asked for it, and an app
 * that announces work it decided to do on its own is asking for attention it
 * has not earned -- the only moment worth interrupting for is the one where
 * there is something to press.
 */
function UpdatePill() {
  const { update, staged, stage, error, run } = useUpdate();

  if (stage === 'idle' || stage === 'fetching') return null;

  if (stage === 'installing') {
    return (
      <span className="flex items-center gap-1.5 px-1.5 text-xs text-chrome-muted">
        <Loader2 size={12} className="animate-spin" aria-hidden />
        Restarting…
      </span>
    );
  }

  if (stage === 'failed') {
    return (
      <button
        onClick={() => void run()}
        title={error ?? undefined}
        className="no-drag flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-amber-500 transition-colors hover:bg-chrome-raised"
      >
        <AlertTriangle size={12} aria-hidden />
        Update failed — retry
      </button>
    );
  }

  const version = staged?.version ?? update?.version;
  if (!version) return null;

  // Downloaded, but this build cannot be swapped underneath itself -- an
  // ad-hoc signature, or an app somewhere only an administrator can write.
  // The image opens and somebody drags it across, as it always did.
  if (stage === 'manual') {
    return (
      <button
        onClick={() => void run()}
        title={`Dermaga ${version} is downloaded. Opening the installer closes Dermaga; the new version has to be dragged across.`}
        className="no-drag flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-brand-400 transition-colors hover:bg-chrome-raised"
      >
        <ArrowDownToLine size={12} aria-hidden />v{version} ready to install
      </button>
    );
  }

  return (
    <button
      onClick={() => void run()}
      title={`Dermaga ${version} is downloaded and verified. Restarting takes a moment and installs it — containers keep running.`}
      className="no-drag flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-brand-400 transition-colors hover:bg-chrome-raised"
    >
      <RefreshCw size={12} aria-hidden />
      Restart to update
    </button>
  );
}

/** The full build stamp, for the version pill's tooltip. */
function buildTitle(build: BuildInfo): string {
  const parts = [`Dermaga ${build.version}`];
  if (build.commit && build.commit !== 'unknown') parts.push(`commit ${build.commit}`);
  if (build.date) parts.push(`built ${build.date}`);
  return parts.join(' · ');
}
