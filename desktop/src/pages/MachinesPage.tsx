import { useState } from 'react';
import { Play, Plus, Square, Trash2 } from 'lucide-react';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CreateMachineDialog } from '../components/MachineForm';
import { DataTable, Muted, NameCell, SelectionActions, type Column } from '../components/DataTable';
import { DefaultStar, StatusText } from '../components/StatusBadge';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useToastStore } from '../store/toastStore';
import { PageHeader } from '../components/PageHeader';
import { useDialog } from '../hooks/useDialog';
import { useUIStore } from '../store/uiStore';
import type { Machine } from '../types';
import { formatBytes, formatDuration, formatMemory } from '../utils/format';

// A table, like every other list. Machines were cards because there are only
// ever one or two of them -- but that made this the one page whose rows are a
// different shape from every other page's, and a reader who has learnt to run
// an eye down a column here has to learn something else.
const COLUMNS: Column[] = [
  { key: 'name', label: 'Name', width: 'minmax(140px,1.6fr)' },
  { key: 'status', label: 'Status', width: '112px' },
  { key: 'cpus', label: 'vCPUs', width: '72px' },
  { key: 'memory', label: 'Memory', width: '104px' },
  { key: 'disk', label: 'Disk', width: '104px' },
  { key: 'address', label: 'IP address', width: 'minmax(120px,1fr)' },
];

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
                iconOnly
                icon={Play}
                busy={busy === 'started'}
                busyLabel="Starting…"
                disabled={Boolean(busy) || startable.length === 0}
                onClick={() =>
                  void applyToSelection('started', startable, (m) => api.startMachine(m.id))
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
                  void applyToSelection('stopped', stoppable, (m) => api.stopMachine(m.id))
                }
                className="text-amber-700 dark:text-amber-500"
              >
                Stop
              </Button>
              <Button
                iconOnly
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
            <button
              onClick={() => creating.show()}
              className="btn-plain-primary"
              title="New machine"
              aria-label="New machine"
            >
              <Plus size={18} aria-hidden />
            </button>
          )
        }
      />

      <DataTable
        columns={COLUMNS}
        rows={visible}
        rowKey={(machine) => machine.id}
        onOpen={(machine) => openMachine(machine.id)}
        selection={{ selected, onChange: setSelected }}
        empty={emptyMessage}
        loading={!hasLoaded}
        actions={(machine) => (
          <Button
            iconOnly
            icon={machine.status === 'running' ? Square : Play}
            className={
              machine.status === 'running'
                ? 'text-amber-700 dark:text-amber-500'
                : 'text-emerald-700 dark:text-emerald-500'
            }
            busy={working === machine.id}
            onClick={() => void toggle(machine)}
          >
            {machine.status === 'running' ? 'Stop' : 'Start'}
          </Button>
        )}
        cells={(machine) => [
          <NameCell key="name">
            <span className="truncate text-body font-medium">{machine.id}</span>
            {machine.default && <DefaultStar />}
          </NameCell>,
          <span key="status" className="flex min-w-0 flex-col items-start gap-0.5">
            <StatusText status={machine.status} />
            {machine.status === 'running' && (
              <span className="font-mono text-tiny text-ink-500">
                up {formatDuration(machine.startedAt)}
              </span>
            )}
          </span>,
          <Muted key="cpus" mono>
            {machine.cpus}
          </Muted>,
          <Muted key="memory" mono>
            {formatMemory(machine.memoryAllocation)}
          </Muted>,
          <Muted key="disk" mono>
            {formatBytes(machine.diskSizeBytes)}
          </Muted>,
          <Muted key="address" mono>
            {machine.ipAddress || '—'}
          </Muted>,
        ]}
      />

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
