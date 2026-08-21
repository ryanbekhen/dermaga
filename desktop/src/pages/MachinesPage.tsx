import { useState } from 'react';
import { Play, Plus, Square, Trash2 } from 'lucide-react';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CreateMachineDialog } from '../components/MachineForm';
import { TaskRows } from '../components/TaskRows';
import {
  Badge,
  DataTable,
  Muted,
  NameCell,
  SelectionActions,
  type Column,
} from '../components/DataTable';
import { StatusDot } from '../components/StatusBadge';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useToastStore } from '../store/toastStore';
import { PageHeader } from '../components/PageHeader';
import { useDialog } from '../hooks/useDialog';
import { useUIStore } from '../store/uiStore';
import { formatBytes, formatDuration, formatMemory } from '../utils/format';

const COLUMNS: Column[] = [
  { key: 'name', label: 'Name', width: 'minmax(140px,1.2fr)' },
  { key: 'state', label: 'State', width: '96px' },
  { key: 'ip', label: 'IP address', width: '136px' },
  { key: 'cpus', label: 'CPUs', width: '72px', align: 'right' },
  { key: 'memory', label: 'Memory', width: '96px', align: 'right' },
  { key: 'disk', label: 'Disk', width: '88px', align: 'right' },
  { key: 'up', label: 'Up', width: '72px', align: 'right' },
];

export function MachinesPage({ runtimeMissing }: { runtimeMissing: boolean }) {
  const machines = useResourceStore((s) => s.machines);
  const hasLoaded = useResourceStore((s) => s.hasLoaded);
  const searchQuery = useUIStore((s) => s.searchQuery);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const openMachine = useUIStore((s) => s.openMachine);
  const creating = useDialog('machine.create');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
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
    targets: typeof machines,
    work: (machine: (typeof machines)[number]) => Promise<void>
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

  const needle = searchQuery.trim().toLowerCase();
  const visible = machines.filter(
    (machine) => !needle || machine.id.toLowerCase().includes(needle)
  );

  const emptyMessage = runtimeMissing
    ? 'The Apple Container CLI was not found on this Mac.'
    : machines.length === 0
      ? 'No container machines yet. Use “New machine” to create one.'
      : 'No machines match your search.';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 -mb-4">
      <PageHeader
        title="Machines"
        subtitle="The Linux VMs your containers run inside"
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search machines…' }}
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

      <DataTable
        columns={COLUMNS}
        rows={visible}
        rowKey={(machine) => machine.id}
        onOpen={(machine) => openMachine(machine.id)}
        selection={{ selected, onChange: setSelected }}
        empty={emptyMessage}
        loading={!hasLoaded}
        cells={(machine) => [
          <NameCell key="name">
            <StatusDot status={machine.status} />
            <span className="truncate text-sm font-semibold">{machine.id}</span>
            {machine.default && <Badge tone="brand">default</Badge>}
          </NameCell>,
          <Muted key="state">{machine.status}</Muted>,
          <Muted key="ip" mono>
            {machine.ipAddress || '—'}
          </Muted>,
          <Muted key="cpus">{machine.cpus}</Muted>,
          <Muted key="memory">{formatMemory(machine.memoryAllocation)}</Muted>,
          <Muted key="disk">{formatBytes(machine.diskSizeBytes)}</Muted>,
          <Muted key="up">
            {machine.status === 'running' ? formatDuration(machine.startedAt) : '—'}
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
