import { useState } from 'react';
import {
  CircleFadingArrowUp,
  Hammer,
  LayoutGrid,
  Play,
  Plus,
  RotateCw,
  Square,
  Trash2,
} from 'lucide-react';
import { ContainerForm } from '../components/ContainerForm';
import { TemplateGallery } from '../components/TemplateGallery';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable, Muted, NameCell, SelectionActions, type Column } from '../components/DataTable';
import { api } from '../services/api';
import { openExternal } from '../services/ipc';
import { isWeb, portNumber, reachableAt, urlFor } from '../utils/endpoint';
import { useToastStore } from '../store/toastStore';
import { recreateContainer } from '../services/tasks';
import { StatusPill } from '../components/StatusBadge';
import { useResourceStore } from '../store/resourceStore';
import { useSettingsStore } from '../store/settingsStore';
import { isBuilder } from '../utils/builder';
import { PageHeader } from '../components/PageHeader';
import { FilterToggle } from '../components/FilterToggle';
import { useDialog } from '../hooks/useDialog';
import { useUIStore } from '../store/uiStore';
import type { ContainerSpec, Container } from '../types';
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
  { key: 'status', label: 'Status', width: '112px', align: 'center' },
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
  const creating = useDialog('container.create');
  // Picked before the form opens rather than applied to it afterwards: the form
  // takes its values at mount, and filling one in from the outside would mean
  // setting a dozen pieces of state and hoping.
  // Opened from the button here, or from the palette, which navigates to this
  // page carrying the intent.
  const browsingIntent = useDialog('container.template');
  const [browsing, setBrowsing] = useState(false);
  const [fromTemplate, setFromTemplate] = useState<Partial<ContainerSpec> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  // Holds the verb of the running bulk action, so its button can spin.
  const [busy, setBusy] = useState<string | null>(null);
  // The container whose image has moved on and is being asked about, and the
  // one already on its way back.
  const [confirmingRecreate, setConfirmingRecreate] = useState<Container | null>(null);
  const [recreating, setRecreating] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);
  const confirmDestructive = useSettingsStore((s) => s.confirmDestructive);

  // What this page is about. Apple's builder is infrastructure rather than
  // somebody's container, so switching it off takes it out of the counting as
  // well as out of the list -- a summary that keeps totalling something it is
  // not showing has numbers nobody can reconcile with what is on screen. It is
  // 2 CPUs and a gigabyte and a half; the difference is not subtle.
  const mine = showBuilder ? containers : containers.filter((c) => !isBuilder(c));

  const visible = mine.filter((container) => showStopped || container.status === 'running');

  // Counted against everything in scope, listed or not -- the stopped filter
  // hides rows without changing what exists, and "3 of 4 running" is the one
  // line that says something is out of sight.
  const running = mine.filter((c) => c.status === 'running');
  const allocatedCpus = running.reduce((sum, c) => sum + (c.cpuAllocation ?? 1), 0);
  const allocatedMib = running.reduce((sum, c) => sum + parseMebibytes(c.memoryAllocation), 0);
  const usedMib = running.reduce((sum, c) => sum + parseMebibytes(c.memoryUsage), 0);

  const emptyMessage = runtimeMissing
    ? 'The Apple Container CLI was not found on this Mac.'
    : mine.length === 0
      ? 'No containers yet. Start from a template, or use “New container”.'
      : 'No running containers. Turn on the “Stopped” filter to see the rest.';

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
              {/* The two filters, beside the actions rather than on a strip of
                  their own. A whole band of chrome for two switches was a band
                  the eye had to cross on the way from the heading to the list,
                  every time, to read the same two words. */}
              <FilterToggle
                iconOnly
                checked={showStopped}
                onChange={setShowStopped}
                label="Stopped"
                icon={Square}
                title="Show containers that are not running"
              />
              <FilterToggle
                iconOnly
                checked={showBuilder}
                onChange={setShowBuilder}
                label="Builder"
                icon={Hammer}
                title="Show Apple's builder container, which `container build` makes and manages"
              />

              <button
                onClick={() => setBrowsing(true)}
                className="btn-plain"
                title="Start from a template"
                aria-label="Start from a template"
              >
                <LayoutGrid size={16} aria-hidden />
              </button>
              <button
                onClick={() => {
                  setFromTemplate(null);
                  creating.show();
                }}
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
                <span className="truncate text-body font-medium">{container.name}</span>
                <Endpoint container={container} />
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

      {/* Creating does not navigate: the new container appears in this list,
          and being thrown into its detail page interrupts what you were doing. */}
      {(browsing || browsingIntent.open) && (
        <TemplateGallery
          onPick={(spec) => {
            setFromTemplate(spec);
            setBrowsing(false);
            browsingIntent.close();
            creating.show();
          }}
          onClose={() => {
            setBrowsing(false);
            browsingIntent.close();
          }}
        />
      )}

      {creating.open && (
        <ContainerForm
          // An intent that names an image opens the form on it. The other
          // shape an intent target comes in -- a dropped Dockerfile -- belongs
          // to the build dialog and never arrives here.
          initial={
            typeof creating.target === 'string'
              ? { image: creating.target }
              : (fromTemplate ?? undefined)
          }
          onClose={() => {
            creating.close();
            setFromTemplate(null);
          }}
        />
      )}

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
 * The uptime rides under the pill rather than in a column of its own: it is
 * only ever asked about a container that is up, so a column for it is blank on
 * every row that is not -- and it answers the same question the pill does.
 */
function StatusCell({ status, since }: { status: string; since: string | null }) {
  return (
    // The group is only as wide as its widest part and sits at the column's
    // left edge; inside it, the uptime is centred under the pill. Aligned left
    // instead, "up 6h 34m" started a few pixels inside the pill's rounded end
    // and read as a second, smaller thing rather than as a note about it.
    <span className="flex w-fit min-w-0 flex-col items-center gap-1">
      <StatusPill status={status} />
      {since && <span className="truncate font-mono text-tiny text-ink-500">up {since}</span>}
    </span>
  );
}

/**
 * Where a container answers, under its name.
 *
 * One line, and the first endpoint. A row is a thing you are scanning past, and
 * the question it has to answer is "is this the one" -- not "which of its four
 * ports". The rest are on its own page, spelled out and each openable.
 *
 * Published ports are reached here on this Mac. Everything else is reached at
 * the container's own name and the port its image says it listens on, which on
 * this runtime is a real endpoint: every container has an address of its own,
 * so an unpublished nginx answers on `whoami.internal:80` exactly as it stands.
 *
 * That second half only started working when the ports stopped coming from
 * `container image inspect`, which reports a config with them left out -- so
 * every container looked like one that listens on nothing.
 */
function Endpoint({ container }: { container: Container }) {
  const endpoints = endpointsOf(container);
  const first = endpoints[0];

  // Nothing to say rather than an em dash: this line is a note under a name,
  // and a placeholder under every quiet container is a column of dashes down
  // the busiest part of the page.
  if (!first) return null;

  const rest = endpoints.length - 1;
  const label = rest > 0 ? `${first.label} +${rest}` : first.label;
  const title = endpoints.map((endpoint) => endpoint.title).join('\n');

  if (!first.url) {
    return (
      <span className="truncate font-mono text-tiny text-ink-500" title={title}>
        {label}
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
      title={`Open ${first.url}${rest > 0 ? `\n\n${title}` : ''}`}
      className="w-fit max-w-full truncate font-mono text-tiny text-brand-700 hover:underline dark:text-brand-400"
    >
      {label}
    </a>
  );
}

/**
 * What a container answers on, published or not.
 *
 * A published port is reached here, on this Mac; anything else is reached at
 * the container itself. Only while it is running: an address belongs to a
 * container that is up, and a link to a stopped one is a link to nothing.
 */
function endpointsOf(container: Container): { label: string; title: string; url: string | null }[] {
  const running = container.status === 'running';

  if (container.ports.length > 0) {
    return container.ports.map((port) => ({
      label: `${port.host} → ${port.container}`,
      title: `${port.host} → ${port.container}/${port.protocol}`,
      url:
        running && port.protocol.toLowerCase() === 'tcp' ? `http://localhost:${port.host}` : null,
    }));
  }

  const host = running ? reachableAt(container) : null;

  return (container.exposedPorts ?? []).map((port) => ({
    label: host ? `${host}:${portNumber(port)}` : port,
    title: host ? `${host}:${port}` : port,
    url: host && isWeb(port) ? urlFor(host, port) : null,
  }));
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
