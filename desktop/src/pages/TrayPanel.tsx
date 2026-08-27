import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Check,
  ChevronsUpDown,
  ExternalLink,
  FolderOpen,
  List,
  Play,
  Power,
  RefreshCw,
  Square,
} from 'lucide-react';
import { api } from '../services/api';
import {
  closePanel,
  openWindow,
  panelHeight,
  quitApp,
  startContainer,
  stopContainer,
  updates,
} from '../services/ipc';
import { useEventStream } from '../hooks/useEventStream';
import { useActiveProject } from '../hooks/useActiveProject';
import { useResourceStore } from '../store/resourceStore';
import { subscribeToSettings, useSettingsStore } from '../store/settingsStore';
import { useTheme } from '../hooks/useTheme';
import { withoutHidden } from '../utils/builder';
import { formatDuration, shortImage } from '../utils/format';
import { DEFAULT_PROJECT, EVERYTHING, inProject, projectLabel, unprefixed } from '../utils/projects';
import type { StagedUpdate } from '../services/ipc';
import type { Container } from '../types';

/** Whether this window is the menu bar panel rather than the app. */
export function isPanel(): boolean {
  return window.location.hash === '#panel';
}

/**
 * What hangs from the menu bar item.
 *
 * The same bundle and the same agent as the window, rendered instead of the app
 * at a hash that names it — the shape the finding window already established.
 * It has no sidebar, no navigation and no title bar: one list, one filter, and
 * the two actions somebody opens the app to perform before closing it again.
 *
 * Everything here is a glance. Anything that needs reading — logs, a terminal,
 * what a container is attached to — is a press away in the window, and pressing
 * it takes this down.
 */
export function TrayPanel() {
  // Rendered instead of App, so everything App does on the way up it has to do
  // for itself: the theme class, the snapshot subscription, and the ear for a
  // preference changed elsewhere — which for this window is not a nicety, since
  // the project it filters by is switched from the window next door.
  useTheme();
  useEventStream();
  useEffect(() => subscribeToSettings(), []);

  const containers = useResourceStore((s) => s.containers);
  const projects = useResourceStore((s) => s.projects);
  const system = useResourceStore((s) => s.system);
  const hasLoaded = useResourceStore((s) => s.hasLoaded);
  const showBuilder = useSettingsStore((s) => s.showBuilder);
  const active = useActiveProject();

  const [switching, setSwitching] = useState(false);
  const page = useRef<HTMLDivElement>(null);

  // Escape closes it, the way it closes every menu on this machine.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (switching) setSwitching(false);
      else closePanel();
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [switching]);

  // The window is sized to whatever this came out as. Measured after layout
  // rather than after paint, so the panel is the right height in the frame it
  // first appears in instead of growing into it.
  useLayoutEffect(() => {
    const element = page.current;
    if (!element) return;

    const report = () => panelHeight(Math.ceil(element.getBoundingClientRect().height));

    report();

    const observer = new ResizeObserver(report);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const mine = withoutHidden(containers, showBuilder).filter((c) => inProject(c, active));
  const running = mine.filter((c) => c.status === 'running');
  const stopped = mine.filter((c) => c.status !== 'running');
  const elsewhere = withoutHidden(containers, showBuilder).filter(
    (c) => c.status === 'running' && !inProject(c, active)
  );

  const servicesRunning = system?.running ?? false;

  return (
    <div
      ref={page}
      className="flex select-none flex-col bg-chrome-raised text-chrome-text"
      // The window has no frame, so the page draws the edge. Inside the same
      // radius macOS gives a frameless window, or the corners show a square of
      // panel outside the round of the window.
      style={{ borderRadius: 12 }}
    >
      <Header running={servicesRunning} shown={running.length} hidden={elsewhere.length} />

      {servicesRunning && hasLoaded && (
        <div className="relative border-b border-chrome-line px-3 py-2.5">
          <ProjectChip
            active={active}
            count={mine.length}
            open={switching}
            onToggle={() => setSwitching((was) => !was)}
          />

          {switching && (
            <ProjectMenu
              active={active}
              onChoose={(next) => {
                useSettingsStore.getState().setActiveProject(next);
                setSwitching(false);
              }}
              onDismiss={() => setSwitching(false)}
              projects={projects.map((project) => project.name)}
              containers={withoutHidden(containers, showBuilder)}
            />
          )}
        </div>
      )}

      {!servicesRunning ? (
        <ServicesStopped waiting={!hasLoaded} />
      ) : mine.length === 0 ? (
        <Empty active={active} elsewhere={elsewhere.length} loaded={hasLoaded} />
      ) : (
        // Somebody with thirty containers is exactly who this panel is for, and
        // the window it lives in stops growing well before that: past the
        // ceiling the list scrolls rather than the rest of it being cut off the
        // bottom of the screen with no way to reach it.
        <div className="flex flex-col overflow-y-auto px-2 pb-1.5 pt-2" style={{ maxHeight: 448 }}>
          {stopped.length > 0 && running.length > 0 && <Heading>Running</Heading>}
          {running.map((container) => (
            <Row key={container.id} container={container} active={active} />
          ))}

          {stopped.length > 0 && running.length > 0 && <Heading>Stopped</Heading>}
          {stopped.map((container) => (
            <Row key={container.id} container={container} active={active} />
          ))}
        </div>
      )}

      <UpdateOffer />

      <Footer />
    </div>
  );
}

/**
 * A version already downloaded, waiting for the app to close and open again.
 *
 * The one row here with a deadline on it, and the reason it is in the panel at
 * all: this window is what people look at for days without opening the app, so
 * it is the only place the offer would be seen.
 *
 * The looking and the fetching are the window's -- this asks what is already in
 * hand rather than running a second copy of any of that.
 */
function UpdateOffer() {
  const [staged, setStaged] = useState<StagedUpdate | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    void updates.pending().then(setStaged).catch(() => {});

    return updates.onStaged(setStaged);
  }, []);

  if (!staged) return null;

  const restart = async () => {
    setInstalling(true);
    try {
      await updates.install(staged.path);
    } catch {
      // The process says what went wrong; this window is about to close either
      // way, and a message on a page nobody will see is not a message.
      setInstalling(false);
    }
  };

  return (
    <button
      onClick={() => void restart()}
      disabled={installing}
      title={
        staged.restartable
          ? `Dermaga ${staged.version} is downloaded and verified. Restarting takes a moment and installs it — containers keep running.`
          : `Dermaga ${staged.version} is downloaded. Opening the installer closes Dermaga; the new version has to be dragged across.`
      }
      className="flex items-center gap-2.5 border-t border-chrome-line px-3.5 py-2.5 text-left text-body font-medium text-brand-600 transition-colors hover:bg-brand-600/10 disabled:opacity-60 dark:text-brand-400"
    >
      {staged.restartable ? (
        <RefreshCw size={15} className="shrink-0" aria-hidden />
      ) : (
        <ArrowDownToLine size={15} className="shrink-0" aria-hidden />
      )}
      <span className="flex-1">
        {installing
          ? 'Restarting…'
          : staged.restartable
            ? `Restart to update to ${staged.version}`
            : `${staged.version} ready to install`}
      </span>
    </button>
  );
}

/**
 * What the menu bar item is reporting, in a line.
 *
 * The count is of what this panel is showing, and says so when a project is
 * keeping some of it out of sight: two containers over a machine running five
 * is not a smaller number, it is a wrong one.
 */
function Header({ running, shown, hidden }: { running: boolean; shown: number; hidden: number }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-chrome-line px-3.5 py-3.5">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          running ? 'bg-emerald-600' : 'border-[1.5px] border-chrome-faint'
        }`}
        aria-hidden
      />
      <span className="flex-1 text-body font-medium">
        {running ? 'Services running' : 'Services stopped'}
      </span>
      {running && (
        <span className="font-mono text-tiny text-chrome-faint">
          {hidden > 0
            ? `${shown} of ${shown + hidden} running`
            : `${shown} ${shown === 1 ? 'container' : 'containers'}`}
        </span>
      )}
    </div>
  );
}

/** The project in force, and the way to change it. */
function ProjectChip({
  active,
  count,
  open,
  onToggle,
}: {
  active: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      aria-haspopup="menu"
      aria-expanded={open}
      className={`flex h-9.5 w-full items-center gap-2.5 rounded-lg border bg-chrome-bg px-2.5 transition-colors ${
        open ? 'border-chrome-faint' : 'border-chrome-line hover:border-chrome-faint'
      }`}
    >
      <FolderOpen size={16} className="shrink-0 text-chrome-dim" aria-hidden />
      <span className="flex-1 truncate text-left text-item font-medium">
        {projectLabel(active)}
      </span>
      <Count value={count} />
      <ChevronsUpDown size={14} className="shrink-0 text-chrome-faint" aria-hidden />
    </button>
  );
}

/**
 * The projects there are to look through.
 *
 * It switches what is listed and nothing else — the same rule the sidebar's
 * switcher holds to. Nothing starts, nothing stops. Making and removing
 * projects is not here: that is bookkeeping, and bookkeeping belongs in the
 * window.
 */
function ProjectMenu({
  active,
  projects,
  containers,
  onChoose,
  onDismiss,
}: {
  active: string;
  projects: string[];
  containers: Container[];
  onChoose: (next: string) => void;
  onDismiss: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) onDismiss();
    };

    document.addEventListener('mousedown', onDown);

    return () => document.removeEventListener('mousedown', onDown);
  }, [onDismiss]);

  const count = (project: string) =>
    containers.filter((container) => inProject(container, project)).length;

  return (
    <div
      ref={box}
      role="menu"
      className="absolute left-3 right-3 top-1 z-30 rounded-xl border border-chrome-line bg-chrome-raised p-1.5 shadow-panel"
    >
      <ProjectRow
        icon={<List size={15} aria-hidden />}
        label="All"
        count={containers.length}
        active={active === EVERYTHING}
        onClick={() => onChoose(EVERYTHING)}
      />

      <div className="my-1.5 h-px bg-chrome-line" />

      <ProjectRow
        icon={<FolderOpen size={15} aria-hidden />}
        label={DEFAULT_PROJECT}
        count={count(DEFAULT_PROJECT)}
        active={active === DEFAULT_PROJECT}
        onClick={() => onChoose(DEFAULT_PROJECT)}
      />

      {projects
        .filter((project) => project !== DEFAULT_PROJECT)
        .map((project) => (
          <ProjectRow
            key={project}
            icon={<FolderOpen size={15} aria-hidden />}
            label={project}
            count={count(project)}
            active={active === project}
            onClick={() => onChoose(project)}
          />
        ))}
    </div>
  );
}

function ProjectRow({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex h-8.5 w-full items-center gap-2.5 rounded-lg px-2.5 text-item transition-colors ${
        active
          ? 'bg-brand-600/15 font-medium text-brand-400'
          : 'text-chrome-muted hover:bg-chrome-bg hover:text-chrome-text'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <Count value={count} />
      {active ? (
        <Check size={13} className="shrink-0" aria-hidden />
      ) : (
        <span className="w-3.25 shrink-0" aria-hidden />
      )}
    </button>
  );
}

function Count({ value }: { value: number }) {
  return (
    <span className="inline-flex h-4.5 min-w-6 shrink-0 items-center justify-center rounded-full bg-white/10 px-1.5 font-mono text-tiny font-medium text-chrome-dim">
      {value}
    </span>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-2.5">
      <span className="label-mono text-chrome-faint">{children}</span>
      <span className="h-px flex-1 bg-chrome-line" aria-hidden />
    </div>
  );
}

/**
 * One container: what it is, and the one thing to do to it.
 *
 * The action is always on the row rather than appearing under the pointer. A
 * panel opened to start something that shows nothing to press until the mouse
 * wanders over the right line is a panel that looks like a list.
 */
function Row({ container, active }: { container: Container; active: string }) {
  const running = container.status === 'running';
  const [busy, setBusy] = useState(false);

  const act = async () => {
    if (busy) return;

    setBusy(true);
    try {
      if (running) await stopContainer(container.id, container.name);
      else await startContainer(container.id, container.name);
    } catch {
      // Said already, and said once. The process raises the failure the same
      // way it does for the menu bar's own rows -- a toast if the window is in
      // front, a macOS notification if it is not -- because this panel may well
      // have been dismissed by the time the answer arrives. Repeating it here
      // would be the same sentence twice on the lucky occasions it is still up.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="group flex h-11 items-center gap-2.5 rounded-lg px-1.5 transition-colors hover:bg-chrome-bg">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${running ? 'bg-emerald-600' : 'bg-ink-400'}`}
        aria-hidden
      />

      <button
        onClick={() => openWindow(container.id)}
        className="flex min-w-0 flex-1 flex-col items-start gap-px text-left"
      >
        <span
          className={`max-w-full truncate text-item font-medium ${
            running ? 'text-chrome-text' : 'text-chrome-muted'
          }`}
        >
          {unprefixed(active, container.name)}
        </span>
        <span className="max-w-full truncate font-mono text-code text-chrome-faint">
          {shortImage(container.image)}
        </span>
      </button>

      {running && (
        <span className="shrink-0 font-mono text-tiny text-chrome-dim">
          {formatDuration(container.startedAt)}
        </span>
      )}

      <button
        onClick={() => void act()}
        disabled={busy}
        title={running ? `Stop ${container.name}` : `Start ${container.name}`}
        aria-label={running ? `Stop ${container.name}` : `Start ${container.name}`}
        className={`inline-flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${
          running
            ? 'text-chrome-faint hover:bg-amber-600/15 hover:text-amber-700 dark:hover:text-amber-500'
            : 'text-chrome-faint hover:bg-emerald-600/15 hover:text-emerald-700 dark:hover:text-emerald-500'
        }`}
      >
        {running ? <Square size={15} aria-hidden /> : <Play size={15} aria-hidden />}
      </button>
    </div>
  );
}

/** Nothing in this project, which is not the same as nothing at all. */
function Empty({
  active,
  elsewhere,
  loaded,
}: {
  active: string;
  elsewhere: number;
  loaded: boolean;
}) {
  if (!loaded) {
    return <div className="px-5 py-7 text-body text-chrome-faint">Asking the agent…</div>;
  }

  return (
    <div className="flex flex-col gap-2 px-5 py-6">
      <span className="text-body font-medium text-chrome-muted">
        {active === EVERYTHING ? 'No containers.' : `Nothing in ${active} yet.`}
      </span>
      {elsewhere > 0 && (
        <span className="text-body text-chrome-faint">
          {elsewhere} {elsewhere === 1 ? 'container is' : 'containers are'} running elsewhere.
        </span>
      )}
    </div>
  );
}

/** The one thing worth offering while the runtime is down. */
function ServicesStopped({ waiting }: { waiting: boolean }) {
  const [busy, setBusy] = useState(false);

  if (waiting) {
    return <div className="px-5 py-7 text-body text-chrome-faint">Asking the agent…</div>;
  }

  const start = async () => {
    setBusy(true);
    try {
      await api.startSystem();
    } catch {
      // Said by the side that raises notifications; this panel is often the
      // only thing on screen, and it cannot be the thing reporting failures.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 px-4 py-5">
      <span className="text-body text-chrome-dim">
        Nothing can run until the background services are up. Starting them here leaves the window
        closed.
      </span>
      <div>
        <button
          onClick={() => void start()}
          disabled={busy}
          className="inline-flex h-8.5 items-center gap-2 rounded-lg bg-brand-600 px-3.5 text-body font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          <Play size={15} aria-hidden />
          {busy ? 'Starting…' : 'Start services'}
        </button>
      </div>
    </div>
  );
}

/** The way into the app, and the way out of it. */
function Footer() {
  return (
    <div className="flex items-center gap-2 border-t border-chrome-line px-2.5 pb-2.5 pt-2">
      <button
        onClick={() => openWindow()}
        className="inline-flex h-8.5 items-center gap-2 rounded-lg px-2.5 text-body font-medium text-brand-600 transition-colors hover:bg-brand-600/15 dark:text-brand-400"
      >
        <ExternalLink size={15} aria-hidden />
        Open Dermaga
      </button>
      <span className="flex-1" />
      <button
        onClick={() => quitApp()}
        title="Quit Dermaga"
        aria-label="Quit Dermaga"
        className="inline-flex h-8.5 w-8.5 items-center justify-center rounded-lg text-chrome-faint transition-colors hover:bg-chrome-bg hover:text-chrome-text"
      >
        <Power size={16} aria-hidden />
      </button>
    </div>
  );
}
