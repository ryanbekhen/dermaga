import { useState } from 'react';
import { Play, Plus, Square, Trash2 } from 'lucide-react';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CreateMachineDialog } from '../components/MachineForm';
import { TaskRows } from '../components/TaskRows';
import { SelectionActions } from '../components/DataTable';
import { StatusDot, StatusPill } from '../components/StatusBadge';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useToastStore } from '../store/toastStore';
import { PageHeader } from '../components/PageHeader';
import { SkeletonBar } from '../components/Skeleton';
import { useDialog } from '../hooks/useDialog';
import { useUIStore } from '../store/uiStore';
import type { Machine } from '../types';
import { formatBytes, formatDuration, formatMemory } from '../utils/format';

export function MachinesPage({ runtimeMissing }: { runtimeMissing: boolean }) {
  const machines = useResourceStore((s) => s.machines);
  const hasLoaded = useResourceStore((s) => s.hasLoaded);
  const openMachine = useUIStore((s) => s.openMachine);
  const creating = useDialog('machine.create');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  // Which single machine's own button is spinning, as opposed to a bulk run.
  const [working, setWorking] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const chosen = machines.filter((machine) => selected.has(machine.id));
  const startable = chosen.filter((machine) => machine.status !== 'running');
  const stoppable = chosen.filter((machine) => machine.status === 'running');
  // A running machine cannot be deleted, and the default one is what every
  // container falls back to, so neither is offered.
  const deletable = chosen.filter((machine) => machine.status !== 'running' && !machine.default);

  const applyToSelection = async (
    verb: string,
    targets: Machine[],
    work: (machine: Machine) => Promise<void>
  ) => {
    setBusy(verb);
    const failed: string[] = [];

    for (const machine of targets) {
      try {
        await work(machine);
      } catch {
        failed.push(machine.id);
      }
    }

    setBusy(null);
    setSelected(new Set());

    if (failed.length > 0)
      pushToast(`Could not ${verb.replace(/ed$/, '')} ${failed.join(', ')}`, 'error');
    else pushToast(`${targets.length} machine${targets.length === 1 ? '' : 's'} ${verb}`);
  };

  const toggle = async (machine: Machine) => {
    const running = machine.status === 'running';
    setWorking(machine.id);

    try {
      await (running ? api.stopMachine(machine.id) : api.startMachine(machine.id));
      pushToast(`${machine.id} ${running ? 'stopped' : 'started'}`);
    } catch (err) {
      pushToast(
        err instanceof Error
          ? err.message
          : `Could not ${running ? 'stop' : 'start'} ${machine.id}`,
        'error'
      );
    } finally {
      setWorking(null);
    }
  };

  const select = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const visible = machines;

  const emptyMessage = runtimeMissing
    ? 'The Apple Container CLI was not found on this Mac.'
    : 'No container machines yet. Use “New machine” to create one.';

  const running = machines.filter((machine) => machine.status === 'running').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Machines"
        subtitle={
          machines.length > 0
            ? `${running} of ${machines.length} running · the Linux VMs your containers run inside`
            : 'The Linux VMs your containers run inside'
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
                  void applyToSelection('started', startable, (m) => api.startMachine(m.id))
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
                  void applyToSelection('stopped', stoppable, (m) => api.stopMachine(m.id))
                }
              >
                Stop
              </Button>
              <Button
                icon={Trash2}
                busy={busy === 'deleted'}
                busyLabel="Deleting…"
                disabled={Boolean(busy) || deletable.length === 0}
                className="text-orange-700 dark:text-orange-500"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            </SelectionActions>
          ) : (
            <button onClick={() => creating.show()} className="btn-primary">
              <Plus size={13} aria-hidden />
              New machine
            </button>
          )
        }
      />

      <TaskRows kind="machine" />

      {/* Cards, not rows. There are one or two of these on most Macs and never
          many, and a machine is not a line in a list -- it is a box with a size
          and a state, and the seven columns it used to be spread across were
          mostly empty air on a wide window. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
        {!hasLoaded && visible.length === 0 && (
          <ul className="flex flex-col gap-3" aria-busy>
            {[0, 1, 2].map((at) => (
              <li key={at} className="card flex flex-col gap-3 p-5" aria-hidden>
                <SkeletonBar width="30%" height="h-4" at={at} />
                <SkeletonBar width="70%" at={at} />
              </li>
            ))}
          </ul>
        )}

        {hasLoaded && visible.length === 0 && (
          <div className="flex items-center justify-center pt-16">
            <div className="max-w-md rounded-xl border border-dashed border-ink-300 bg-white/60 px-6 py-10 text-center text-sm text-ink-600 dark:border-ink-700 dark:bg-ink-900/40 dark:text-ink-400">
              {emptyMessage}
            </div>
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {visible.map((machine) => (
            <MachineCard
              key={machine.id}
              machine={machine}
              selected={selected.has(machine.id)}
              onSelect={(on) => select(machine.id, on)}
              onOpen={() => openMachine(machine.id)}
              onToggle={() => void toggle(machine)}
              busy={working === machine.id}
            />
          ))}
        </ul>
      </div>

      {creating.open && <CreateMachineDialog onClose={() => creating.close()} />}

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete ${deletable.length} machine${deletable.length === 1 ? '' : 's'}?`}
          body="Everything inside them goes with them. Running machines and the default machine are left alone."
          confirmLabel="Delete"
          onConfirm={() => {
            setConfirmingDelete(false);
            void applyToSelection('deleted', deletable, (m) => api.deleteMachine(m.id));
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}

function MachineCard({
  machine,
  selected,
  onSelect,
  onOpen,
  onToggle,
  busy,
}: {
  machine: Machine;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onOpen: () => void;
  onToggle: () => void;
  busy: boolean;
}) {
  const running = machine.status === 'running';

  return (
    <li
      onClick={onOpen}
      // Two lines, always: what it is on the first, what it has on the second.
      //
      // It was one row, which meant a narrow window took its space out of the
      // four figures in the middle -- "vCPUs" became "V…" over "2…". Then it
      // was four stacked blocks, which fixed that by making one machine as
      // tall as a paragraph. Neither is what the card is: a name with a few
      // measurements under it.
      className={`flex flex-col gap-3 rounded-xl border px-4 py-3.5 transition-colors ${
        selected
          ? 'border-brand-600/40 bg-brand-50 dark:border-brand-600/40 dark:bg-brand-600/10'
          : 'border-ink-200 bg-white hover:border-ink-300 dark:border-ink-800 dark:bg-ink-900 dark:hover:border-ink-700'
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Picking a machine is not opening it. */}
        <span onClick={(event) => event.stopPropagation()} className="flex shrink-0 items-center">
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelect(event.target.checked)}
            aria-label={`Select ${machine.id}`}
            className="h-3.5 w-3.5 accent-brand-600"
          />
        </span>

        <StatusDot status={machine.status} />
        <span className="truncate text-sm font-semibold">{machine.id}</span>
        {machine.default && (
          <span className="pill bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-400">
            default
          </span>
        )}
        <StatusPill status={machine.status} />
        {running && (
          <span className="truncate font-mono text-tiny text-ink-500">
            up {formatDuration(machine.startedAt)}
          </span>
        )}

        <div className="flex-1" />

        <div onClick={(event) => event.stopPropagation()} className="shrink-0">
          <Button
            icon={running ? Square : Play}
            busy={busy}
            busyLabel={running ? 'Stopping…' : 'Starting…'}
            onClick={onToggle}
          >
            {running ? 'Stop' : 'Start'}
          </Button>
        </div>
      </div>

      {/* Wraps onto another line rather than shrinking: a measurement squeezed
          past the point of being readable has stopped being a measurement. */}
      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5 pl-6.5 text-body">
        <Fact label="vCPUs" value={String(machine.cpus)} />
        <Fact label="Memory" value={formatMemory(machine.memoryAllocation)} />
        <Fact label="Disk" value={formatBytes(machine.diskSizeBytes)} />
        <Fact label="IP address" value={machine.ipAddress || '—'} />
      </dl>
    </li>
  );
}

// Label and value on one line, so four of them are one line rather than four.
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex shrink-0 items-baseline gap-2">
      <dt className="label-mono">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
