import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRight,
  CircleFadingArrowUp,
  LayoutGrid,
  Play,
  Plus,
  RotateCw,
  Square,
  Trash2,
} from 'lucide-react';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable, Muted, NameCell, SelectionActions, type Column } from '../components/DataTable';
import { api } from '../services/api';
import { openExternal } from '../services/ipc';
import { isWeb, portNumber, reachableAt, urlFor } from '../utils/endpoint';
import { useToastStore } from '../store/toastStore';
import { recreateContainer } from '../services/tasks';
import { StatusText } from '../components/StatusBadge';
import { useResourceStore } from '../store/resourceStore';
import { useSettingsStore } from '../store/settingsStore';
import { useActiveProject } from '../hooks/useActiveProject';
import { isBuilder } from '../utils/builder';
import { EVERYTHING, inProject, unprefixed } from '../utils/projects';
import { PageHeader } from '../components/PageHeader';
import { FilterMenu } from '../components/FilterMenu';
import { FilterToggle } from '../components/FilterToggle';
import { useUIStore } from '../store/uiStore';
import type { Container } from '../types';
import { formatDuration, formatMemory, parseMebibytes, shortImage } from '../utils/format';

// What is worth knowing about a container without opening it: what it is and
// where it answers, what it came from, whether it is up, and what it is
// spending.
//
// Where it answers used to be a column of its own, and it was the wrong shape
// for one: an address is not a measurement to be scanned down a column, it is
// part of what the thing *is* -- the second half of its name. Under the name is
// also where the eye already is when it has found the row it wanted, which is
// the moment somebody wants to click through to it.
//
// Platform used to have a column too, and said "linux/arm64" on every row of
// every Mac sold since 2020 -- a column that never varies is a column nobody
// reads. It is on the detail page, where the rare machine running something
// else will say so.
const COLUMNS: Column[] = [
  { key: 'name', label: 'Name', width: 'minmax(160px,2fr)' },
  { key: 'image', label: 'Image', width: 'minmax(140px,1.5fr)' },
  { key: 'status', label: 'Status', width: '112px' },
  { key: 'cpu', label: 'CPU', width: '104px' },
  { key: 'memory', label: 'Memory', width: '128px' },
];

export function ContainersPage({ runtimeMissing }: { runtimeMissing: boolean }) {
  const containers = useResourceStore((s) => s.containers);
  const hasLoaded = useResourceStore((s) => s.hasLoaded);
  const showStopped = useSettingsStore((s) => s.showStopped);
  const setShowStopped = useSettingsStore((s) => s.setShowStopped);
  const showBuilder = useSettingsStore((s) => s.showBuilder);
  const setShowBuilder = useSettingsStore((s) => s.setShowBuilder);
  const openContainer = useUIStore((s) => s.openContainer);
  // Creating is a page of its own, and a template is what that page opens
  // with: the form takes its values at mount, so what it starts from travels
  // with the navigation rather than being set into it afterwards.
  const newContainer = useUIStore((s) => s.newContainer);
  const browseTemplates = useUIStore((s) => s.browseTemplates);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  // Holds the verb of the running bulk action, so its button can spin.
  const [busy, setBusy] = useState<string | null>(null);
  // The container whose image has moved on and is being asked about, and the
  // one already on its way back.
  const [confirmingRecreate, setConfirmingRecreate] = useState<Container | null>(null);
  const [recreating, setRecreating] = useState<string | null>(null);
  // The row whose addresses are showing, and where its trigger was when it was
  // pressed. By id rather than by container, so what the menu lists is read
  // from the live list every render -- the addresses keep arriving while it is
  // open, and a container that goes takes its menu with it.
  const [portsMenu, setPortsMenu] = useState<{ id: string; at: DOMRect } | null>(null);
  const closePortsMenu = useCallback(() => setPortsMenu(null), []);
  const pushToast = useToastStore((s) => s.push);
  const confirmDestructive = useSettingsStore((s) => s.confirmDestructive);
  const activeProject = useActiveProject();

  // What this page is about. Apple's builder is infrastructure rather than
  // somebody's container, so switching it off takes it out of the counting as
  // well as out of the list -- a summary that keeps totalling something it is
  // not showing has numbers nobody can reconcile with what is on screen. It is
  // 2 CPUs and a gigabyte and a half; the difference is not subtle.
  const everything = showBuilder ? containers : containers.filter((c) => !isBuilder(c));

  // Narrowed to the project in force. Everything below counts against this
  // rather than against the whole list -- a summary that totals what is not on
  // screen is a summary nobody can reconcile with what they are looking at,
  // which is the same reason the builder filter takes rows out of the counting
  // as well as out of the list.
  const mine = everything.filter((c) => inProject(c, activeProject));


  const visible = mine.filter((container) => showStopped || container.status === 'running');

  // What the two switches are holding back, and only them. Counted against
  // everything the project holds rather than against `everything`, which has
  // already had the builder taken out of it -- measuring the difference after
  // one of the two filters has run would report that filter as hiding nothing.
  // The project's own narrowing is not counted either: it is not what this
  // button controls, and a number that moves when a switch is not touched is a
  // number nobody can act on.
  const inScope = containers.filter((container) => inProject(container, activeProject));
  const filteredOut = inScope.length - visible.length;

  // Counted against everything in scope, listed or not -- the stopped filter
  // hides rows without changing what exists, and "3 of 4 running" is the one
  // line that says something is out of sight.
  const running = mine.filter((c) => c.status === 'running');
  const allocatedCpus = running.reduce((sum, c) => sum + (c.cpuAllocation ?? 1), 0);
  const allocatedMib = running.reduce((sum, c) => sum + parseMebibytes(c.memoryAllocation), 0);
  const usedMib = running.reduce((sum, c) => sum + parseMebibytes(c.memoryUsage), 0);

  const emptyMessage = runtimeMissing
    ? 'The Apple Container CLI was not found on this Mac.'
    : mine.length === 0 && activeProject !== EVERYTHING
      ? `Nothing in ${activeProject} yet. Anything you create while it is open is filed under it.`
      : mine.length === 0
        ? 'No containers yet. Start from a template, or use “New container”.'
        : // Named by where it is rather than by what it is called: the filters
          // are behind an unlabelled button now, and telling somebody to turn
          // on a switch without saying where it lives is how an empty list
          // stays empty.
          'No running containers. The stopped ones are hidden — the filters button, beside “New container”, brings them back.';

  const chosen = mine.filter((c) => selected.has(c.id));
  const startable = chosen.filter((c) => c.status !== 'running');
  const stoppable = chosen.filter((c) => c.status === 'running');

  // Bulk actions run one at a time and report once, so a single failure does
  // not bury the rest in a stack of toasts.
  const applyToSelection = async (
    verb: string,
    targets: Container[],
    work: (container: Container) => Promise<void>
  ) => {
    setBusy(verb);
    const failed: string[] = [];

    for (const container of targets) {
      try {
        await work(container);
      } catch {
        failed.push(container.name);
      }
    }

    setBusy(null);
    setSelected(new Set());

    if (failed.length > 0) {
      pushToast(`Could not ${verb} ${failed.join(', ')}`, 'error');
    } else {
      pushToast(`${targets.length} container${targets.length === 1 ? '' : 's'} ${verb}`);
    }
  };

  // Reported through the task strip, not through this row: recreating deletes
  // the container and makes another, so the row it was started from is off
  // screen for a second or two and a spinner drawn on it would go with it.
  const recreate = async (container: Container) => {
    setConfirmingRecreate(null);
    setRecreating(container.id);

    try {
      await recreateContainer(container);
    } finally {
      setRecreating(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Containers"
        subtitle={`${running.length} of ${mine.length} running · ${allocatedCpus} CPU · ${formatMemory(
          `${Math.round(usedMib)}m`
        )} of ${formatMemory(`${allocatedMib}m`)} memory`}
        actions={
          selected.size > 0 ? (
            <SelectionActions count={selected.size} onClear={() => setSelected(new Set())}>
              <Button
                iconOnly
                icon={Play}
                busy={busy === 'started'}
                busyLabel="Starting…"
                disabled={Boolean(busy) || startable.length === 0}
                onClick={() =>
                  void applyToSelection('started', startable, (c) => api.startContainer(c.id))
                }
                className="text-emerald-700 dark:text-emerald-500"
              >
                Start
              </Button>
              <Button
                iconOnly
                icon={Square}
                busy={busy === 'stopped'}
                busyLabel="Stopping…"
                disabled={Boolean(busy) || stoppable.length === 0}
                onClick={() =>
                  void applyToSelection('stopped', stoppable, (c) => api.stopContainer(c.id))
                }
                className="text-amber-700 dark:text-amber-500"
              >
                Stop
              </Button>
              {/* Stop then start, the same pair the detail page runs: the
                  runtime has no restart of its own, and doing it here rather
                  than making somebody open four containers in turn is the
                  whole point of having selected them. */}
              <Button
                iconOnly
                icon={RotateCw}
                busy={busy === 'restarted'}
                busyLabel="Restarting…"
                disabled={Boolean(busy) || stoppable.length === 0}
                onClick={() =>
                  void applyToSelection('restarted', stoppable, async (c) => {
                    await api.stopContainer(c.id);
                    await api.startContainer(c.id);
                  })
                }
              >
                Restart
              </Button>
              <Button
                iconOnly
                icon={Trash2}
                busy={busy === 'removed'}
                busyLabel="Removing…"
                disabled={Boolean(busy)}
                className="text-orange-700 dark:text-orange-500"
                onClick={() => setConfirmingRemove(true)}
              >
                Remove
              </Button>
            </SelectionActions>
          ) : (
            <>
              {/* Behind one button rather than beside the actions. As words
                  they crowded the row the page is opened to press, and as
                  glyphs one of them was mistaken for the Stop button next to
                  it. The button counts what they are holding back, so folding
                  them away does not hide the fact that something is. */}
              <FilterMenu hidden={filteredOut}>
                <FilterToggle
                  checked={showStopped}
                  onChange={setShowStopped}
                  label="Show containers that are not running"
                />
                <FilterToggle
                  checked={showBuilder}
                  onChange={setShowBuilder}
                  label="Show Apple's builder container"
                />
              </FilterMenu>

              <button
                onClick={browseTemplates}
                className="btn-plain"
                title="Start from a template"
                aria-label="Start from a template"
              >
                <LayoutGrid size={16} aria-hidden />
              </button>
              <button
                onClick={() => newContainer()}
                className="btn-plain-primary"
                title="New container"
                aria-label="New container"
              >
                <Plus size={18} aria-hidden />
              </button>
            </>
          )
        }
      />

      <DataTable
        columns={COLUMNS}
        rows={visible}
        rowKey={(container) => container.id}
        onOpen={(container) => openContainer(container.id)}
        selection={{ selected, onChange: setSelected }}
        empty={emptyMessage}
        loading={!hasLoaded}
        cells={(container) => {
          const isRunning = container.status === 'running';
          const cpu = isRunning ? (container.cpuUsage ?? 0) : 0;

          return [
            // The name, and under it somewhere to go. The id is not repeated:
            // Apple's runtime gives a container one identifier and its name is
            // it, so the line underneath was the line above it in a lighter
            // grey -- and the dot in front of it was the Status column said
            // again, a hundred pixels to the left.
            <NameCell key="name">
              <span className="flex min-w-0 flex-col gap-0.5">
                {/* Short inside the project that named it. The prefix is what
                    lets two projects hold a `dashboard`; repeating it on every
                    row of the one project that already says it is noise. */}
                <span className="truncate text-body font-medium">
                  {unprefixed(activeProject, container.name)}
                </span>
                <Endpoint
                  container={container}
                  expanded={portsMenu?.id === container.id}
                  onOpenMenu={(at) =>
                    setPortsMenu((open) =>
                      open?.id === container.id ? null : { id: container.id, at }
                    )
                  }
                />
              </span>
            </NameCell>,
            <ImageCell key="image" container={container} />,
            <StatusCell
              key="status"
              status={container.status}
              since={isRunning ? formatDuration(container.startedAt) : null}
            />,
            <Measure
              key="cpu"
              value={isRunning ? `${cpu.toFixed(1)}%` : '—'}
              of={`${container.cpuAllocation ?? 1} CPU`}
            />,
            <Measure
              key="memory"
              value={isRunning && container.memoryUsage ? formatMemory(container.memoryUsage) : '—'}
              of={formatMemory(container.memoryAllocation)}
            />,
          ];
        }}
        // Only on the rows that need it, and there without being hovered for:
        // this is the answer to something the row has just said out loud, and
        // an answer nobody can see until they wave at it is not offered.
        actions={(container) =>
          container.imageMoved ? (
            <Button
              iconOnly
              icon={CircleFadingArrowUp}
              busy={recreating === container.id}
              busyLabel="Recreating…"
              disabled={Boolean(busy) || recreating !== null}
              className="text-amber-700 dark:text-amber-500"
              onClick={() =>
                confirmDestructive ? setConfirmingRecreate(container) : void recreate(container)
              }
            >
              Recreate on the newer image
            </Button>
          ) : null
        }
      />

      {portsMenu &&
        (() => {
          const container = visible.find((c) => c.id === portsMenu.id);

          return container ? (
            <PortMenu container={container} at={portsMenu.at} onClose={closePortsMenu} />
          ) : null;
        })()}

      {confirmingRecreate && (
        <ConfirmDialog
          title={`Recreate ${confirmingRecreate.name}?`}
          body={`${shortImage(confirmingRecreate.image)} has been built again since this container started. It is stopped, deleted and run again from what that tag points at now — same name, ports, volumes and environment. Named volumes survive; anything written to the container filesystem does not.`}
          confirmLabel="Recreate"
          onConfirm={() => void recreate(confirmingRecreate)}
          onCancel={() => setConfirmingRecreate(null)}
        />
      )}

      {confirmingRemove && (
        <ConfirmDialog
          title={`Remove ${chosen.length} container${chosen.length === 1 ? '' : 's'}?`}
          body={`${chosen.map((c) => c.name).join(', ')} will be deleted. Running ones are forced to stop first; volumes are left untouched.`}
          confirmLabel="Remove"
          onConfirm={() => {
            setConfirmingRemove(false);
            void applyToSelection('removed', chosen, (c) =>
              api.removeContainer(c.id, c.status === 'running')
            );
          }}
          onCancel={() => setConfirmingRemove(false)}
        />
      )}
    </div>
  );
}

/**
 * What the container is made of, and whether that is still what its name means.
 *
 * The second line appears only once the tag has been built again since this
 * container started -- which, on an edit, build, run loop, is most of the day.
 * It waits on the row rather than announcing itself: a build takes minutes, and
 * something that opens itself over whatever you moved on to is the same
 * interruption as a caret jumping while you type.
 */
function ImageCell({ container }: { container: Container }) {
  if (!container.imageMoved) return <Muted>{shortImage(container.image)}</Muted>;

  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="block truncate text-small text-ink-600 dark:text-ink-400">
        {shortImage(container.image)}
      </span>
      {/* Amber rather than red: nothing here is broken, and nothing is
          waiting on an answer. It is only out of date. */}
      <span className="truncate text-tiny font-medium text-amber-600 dark:text-amber-500">
        image moved on
      </span>
    </span>
  );
}

/**
 * What the container is doing, and for how long.
 *
 * The uptime rides under the status rather than in a column of its own: it is
 * only ever asked about a container that is up, so a column for it is blank on
 * every row that is not -- and it answers the same question the status does.
 */
function StatusCell({ status, since }: { status: string; since: string | null }) {
  return (
    // Both lines start at the column's left edge, under the heading, like every
    // other column here. The uptime used to be centred under the status, which
    // was worth doing while the status was a rounded capsule -- text aligned to
    // its left edge started a few pixels inside the curve and read as a second,
    // separate thing. A word has no curve, so the two simply stack.
    <span className="flex min-w-0 flex-col items-start gap-1">
      <StatusText status={status} />
      {since && <span className="truncate font-mono text-tiny text-ink-500">up {since}</span>}
    </span>
  );
}

/**
 * Where a container answers, under its name.
 *
 * One of them is a link: it is the whole address, it fits, and clicking it is
 * the thing somebody wants. Several are not. A row is scanned past, and four
 * addresses stacked in it turn the busiest column of the page into a paragraph
 * -- and the one that happened to be first became the one you could click,
 * which is an arbitrary thing to make easy.
 *
 * So several is a count, and opening it is a separate act.
 */
function Endpoint({
  container,
  expanded,
  onOpenMenu,
}: {
  container: Container;
  expanded: boolean;
  onOpenMenu: (at: DOMRect) => void;
}) {
  const { host, items } = endpointsOf(container);
  const first = items[0];

  // Nothing to say rather than an em dash: this line is a note under a name,
  // and a placeholder under every quiet container is a column of dashes down
  // the busiest part of the page.
  if (!first) return null;

  if (items.length === 1) {
    if (!first.url) {
      return (
        <span className="truncate font-mono text-tiny text-ink-500" title={first.title}>
          {first.label}
        </span>
      );
    }

    return (
      <a
        href={first.url}
        // The row underneath opens the container; this leaves the app.
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void openExternal(first.url as string);
        }}
        title={`Open ${first.url}`}
        className="w-fit max-w-full truncate font-mono text-tiny text-brand-700 hover:underline dark:text-brand-400"
      >
        {first.label}
      </a>
    );
  }

  return (
    <button
      // Marked so the handler that closes the menu on any click elsewhere can
      // tell this one apart: without it, pressing the trigger again would close
      // the menu on mousedown and reopen it on click, and it would never shut.
      data-port-trigger=""
      onClick={(event) => {
        event.stopPropagation();
        onOpenMenu(event.currentTarget.getBoundingClientRect());
      }}
      title={items.map((item) => item.title).join('\n')}
      aria-expanded={expanded}
      aria-haspopup="menu"
      className="flex w-fit max-w-full items-center gap-1 truncate font-mono text-tiny text-brand-700 hover:underline dark:text-brand-400"
    >
      <ChevronRight
        size={11}
        aria-hidden
        className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
      />
      <span className="truncate">{host ?? 'not running'}</span>
      <span className="shrink-0">· {items.length} ports</span>
    </button>
  );
}

/**
 * The addresses themselves, over the table rather than in it.
 *
 * In a portal and positioned in the viewport, because the list it hangs off
 * scrolls: anything drawn inside that scrolling box is cut off by its edge, and
 * a menu on the last row would be a menu nobody can read. It flips above the
 * row when there is no room below, and closes on anything that would move it --
 * a scroll, a resize, Escape, a click anywhere else.
 */
function PortMenu({
  container,
  at,
  onClose,
}: {
  container: Container;
  at: DOMRect;
  onClose: () => void;
}) {
  const { items } = endpointsOf(container);

  useEffect(() => {
    const away = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      // The trigger closes it itself, by toggling.
      if (target?.closest('[data-port-menu]') || target?.closest('[data-port-trigger]')) return;

      onClose();
    };

    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key);
    // Captured, because what scrolls is the list inside the page rather than
    // the page itself, and a scroll event there does not bubble to the window.
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);

    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // Enough for the four or five a container has; more than that scrolls inside
  // the menu rather than off the bottom of the screen.
  const maxHeight = 240;
  const below = window.innerHeight - at.bottom > maxHeight + 16;

  return createPortal(
    <div
      data-port-menu=""
      role="menu"
      style={{
        position: 'fixed',
        left: at.left,
        ...(below ? { top: at.bottom + 4 } : { bottom: window.innerHeight - at.top + 4 }),
        maxHeight,
      }}
      className="z-50 min-w-56 overflow-y-auto overscroll-contain rounded-xl border border-ink-200 bg-white p-1 shadow-panel dark:border-ink-700 dark:bg-ink-900"
    >
      {items.map((item) =>
        item.url ? (
          <button
            key={item.label}
            role="menuitem"
            onClick={() => {
              void openExternal(item.url as string);
              onClose();
            }}
            title={`Open ${item.url}`}
            className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left font-mono text-code text-ink-800 transition-colors hover:bg-ink-100 hover:text-ink-900 dark:text-ink-200 dark:hover:bg-ink-800 dark:hover:text-ink-100"
          >
            {item.label}
          </button>
        ) : (
          <span
            key={item.label}
            title={item.title}
            className="block truncate px-2.5 py-1.5 font-mono text-code text-ink-500"
          >
            {item.label}
          </span>
        )
      )}
    </div>,
    document.body
  );
}

/**
 * What a container answers on, published or not.
 *
 * A published port is reached here, on this Mac; anything else is reached at
 * the container itself. Only while it is running: an address belongs to a
 * container that is up, and a link to a stopped one is a link to nothing.
 *
 * The host comes back beside them because it is the same for all of them, which
 * is what lets a row of four say where they are without listing them.
 */
function endpointsOf(container: Container): {
  host: string | null;
  items: { label: string; title: string; url: string | null }[];
} {
  const running = container.status === 'running';

  if (container.ports.length > 0) {
    return {
      host: running ? 'localhost' : null,
      items: container.ports.map((port) => ({
        label: `${port.host} → ${port.container}`,
        title: `${port.host} → ${port.container}/${port.protocol}`,
        url:
          running && port.protocol.toLowerCase() === 'tcp' ? `http://localhost:${port.host}` : null,
      })),
    };
  }

  const host = running ? reachableAt(container) : null;

  return {
    host,
    items: (container.exposedPorts ?? []).map((port) => ({
      label: host ? `${host}:${portNumber(port)}` : port,
      title: host ? `${host}:${port}` : port,
      url: host && isWeb(port) ? urlFor(host, port) : null,
    })),
  };
}

/**
 * A reading and the ceiling it is measured against, both as figures.
 *
 * There was a hairline bar under each of these. It was drawn from the same
 * number written beside it, which is what makes it decoration rather than
 * information -- and four of them stacked down a column read as a chart nobody
 * had asked for. Set in mono, the figures line up under each other and the
 * column can be scanned for the big one, which is the only thing anybody was
 * using the bars for.
 */
function Measure({ value, of }: { value: string; of: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 font-mono">
      <span className="truncate text-small">{value}</span>
      <span className="truncate text-tiny text-ink-500">of {of}</span>
    </span>
  );
}
