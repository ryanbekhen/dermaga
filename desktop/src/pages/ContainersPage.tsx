import { useState } from 'react';
import { Hammer, LayoutGrid, Play, Plus, RotateCw, Square, Trash2 } from 'lucide-react';
import { ContainerForm } from '../components/ContainerForm';
import { TemplateGallery } from '../components/TemplateGallery';
import { TaskRows } from '../components/TaskRows';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable, Muted, NameCell, SelectionActions, type Column } from '../components/DataTable';
import { api } from '../services/api';
import { useToastStore } from '../store/toastStore';
import { StatusPill } from '../components/StatusBadge';
import { useResourceStore } from '../store/resourceStore';
import { useSettingsStore } from '../store/settingsStore';
import { isBuilder } from '../utils/builder';
import { PageHeader } from '../components/PageHeader';
import { FilterToggle } from '../components/FilterToggle';
import { useDialog } from '../hooks/useDialog';
import { useUIStore } from '../store/uiStore';
import type { ContainerSpec, Container, Port } from '../types';
import { formatDuration, formatMemory, parseMebibytes, shortImage } from '../utils/format';

// The six things worth knowing about a container without opening it: what it
// is, what it came from, whether it is up, what it is spending, and how to
// reach it.
//
// Platform used to have a column of its own and said "linux/arm64" on every
// row of every Mac sold since 2020 -- a column that never varies is a column
// nobody reads. It is on the detail page, where the rare machine running
// something else will say so.
const COLUMNS: Column[] = [
  { key: 'name', label: 'Name', width: 'minmax(120px,1.5fr)' },
  { key: 'image', label: 'Image', width: 'minmax(140px,1.5fr)' },
  { key: 'status', label: 'Status', width: '112px' },
  { key: 'cpu', label: 'CPU', width: '104px' },
  { key: 'memory', label: 'Memory', width: '128px' },
  { key: 'ports', label: 'Ports', width: 'minmax(130px,1.2fr)' },
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
  const pushToast = useToastStore((s) => s.push);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Containers"
        subtitle={`${running.length} of ${mine.length} running · ${allocatedCpus} CPU · ${formatMemory(
          `${Math.round(usedMib)}m`
        )} of ${formatMemory(`${allocatedMib}m`)} memory`}
        filters={
          <>
            <FilterToggle
              checked={showStopped}
              onChange={setShowStopped}
              label="Stopped"
              icon={Square}
              title="Show containers that are not running"
            />
            <FilterToggle
              checked={showBuilder}
              onChange={setShowBuilder}
              label="Builder"
              icon={Hammer}
              title="Show Apple's builder container, which `container build` makes and manages"
            />
          </>
        }
        actions={
          selected.size > 0 ? (
            <SelectionActions count={selected.size} onClear={() => setSelected(new Set())}>
              <Button
                icon={Play}
                busy={busy === 'started'}
                busyLabel="Starting…"
                disabled={Boolean(busy) || startable.length === 0}
                onClick={() =>
                  void applyToSelection('started', startable, (c) => api.startContainer(c.id))
                }
              >
                Start
              </Button>
              <Button
                icon={Square}
                busy={busy === 'stopped'}
                busyLabel="Stopping…"
                disabled={Boolean(busy) || stoppable.length === 0}
                onClick={() =>
                  void applyToSelection('stopped', stoppable, (c) => api.stopContainer(c.id))
                }
              >
                Stop
              </Button>
              {/* Stop then start, the same pair the detail page runs: the
                  runtime has no restart of its own, and doing it here rather
                  than making somebody open four containers in turn is the
                  whole point of having selected them. */}
              <Button
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
              <button onClick={() => setBrowsing(true)} className="btn">
                <LayoutGrid size={13} aria-hidden />
                From a template
              </button>
              <button
                onClick={() => {
                  setFromTemplate(null);
                  creating.show();
                }}
                className="btn-primary"
              >
                <Plus size={13} aria-hidden />
                New container
              </button>
            </>
          )
        }
      />

      <TaskRows kind="container" />

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
          const address = container.interfaces?.[0]?.ipv4Address;
          const cpu = isRunning ? (container.cpuUsage ?? 0) : 0;

          return [
            // Just the name. Apple's runtime gives a container one identifier
            // and its name is it, so the id underneath was the line above it in
            // a lighter grey -- and the dot in front of it was the Status
            // column said again, a hundred pixels to the left.
            <NameCell key="name">
              <span className="truncate text-body font-medium">{container.name}</span>
            </NameCell>,
            <Muted key="image">{shortImage(container.image)}</Muted>,
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
            <PortsCell
              key="ports"
              ports={container.ports}
              exposed={container.exposedPorts}
              address={address}
            />,
          ];
        }}
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
          initial={creating.target ? { image: creating.target } : (fromTemplate ?? undefined)}
          onClose={() => {
            creating.close();
            setFromTemplate(null);
          }}
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
 * Somewhere you can actually type into a browser.
 *
 * Published ports are shown as the mapping the runtime made. Everything else
 * gets its own address and the port its image says it listens on, which on
 * this runtime is a real endpoint: every container has an address of its own,
 * so `192.168.64.18:80` reaches an unpublished nginx exactly as it stands.
 *
 * The address alone used to be shown instead, and it answered half a question.
 * Knowing where something is without knowing what to knock on is not much use,
 * and the port was on screen nowhere at all for a container that publishes
 * nothing -- which, on a runtime that gives every container an address, is
 * most of them.
 */
function PortsCell({
  ports,
  exposed,
  address,
}: {
  ports: Port[];
  exposed?: string[];
  address?: string;
}) {
  if (ports.length === 0) {
    const listening = (exposed ?? []).map((port) => port.split('/')[0]);

    if (address && listening.length > 0) {
      return (
        <span
          className="flex min-w-0 flex-col gap-0.5"
          title={(exposed ?? []).map((port) => `${address}:${port}`).join('\n')}
        >
          {listening.slice(0, 2).map((port) => (
            <span key={port} className="truncate font-mono text-code">
              {address}:{port}
            </span>
          ))}
          {listening.length > 2 && (
            <span className="truncate text-tiny text-ink-500">and {listening.length - 2} more</span>
          )}
        </span>
      );
    }

    return <Muted mono>{address ?? '—'}</Muted>;
  }

  // More than two and the row would grow a paragraph; the rest are counted and
  // spelled out in full on the detail page.
  const shown = ports.slice(0, 2);
  const rest = ports.length - shown.length;

  return (
    <span
      className="flex min-w-0 flex-col gap-0.5"
      title={ports.map((port) => `${port.host} → ${port.container}/${port.protocol}`).join('\n')}
    >
      {shown.map((port) => (
        <span
          key={`${port.protocol}-${port.host}-${port.container}`}
          className="truncate font-mono text-code"
        >
          {port.host} → {port.container}
        </span>
      ))}
      {rest > 0 && <span className="truncate text-tiny text-ink-500">and {rest} more</span>}
    </span>
  );
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
