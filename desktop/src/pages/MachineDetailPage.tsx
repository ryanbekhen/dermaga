import { Suspense, lazy, useEffect, useState } from 'react';
import {
  Info,
  Play,
  ScrollText,
  Settings2,
  Square,
  Star,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { Button, IconButton } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { MachineSettingsDialog } from '../components/MachineForm';
import { LogPane } from '../components/LogPane';
import { StatusPill } from '../components/StatusBadge';
import { DetailGrid, DetailLayout, DetailPane } from '../components/DetailLayout';
import { Badge } from '../components/DataTable';
import type { TabDefinition } from '../components/Tabs';
import { Row, Section } from '../components/DetailRow';
import { api } from '../services/api';
import { useSettingsStore } from '../store/settingsStore';
import { useToastStore } from '../store/toastStore';
import { useUIStore } from '../store/uiStore';
import type { Machine, MachineTab } from '../types';
import { formatBytes, formatDuration, formatMemory } from '../utils/format';

// xterm only loads when a terminal is actually opened.
const TerminalPane = lazy(() =>
  import('../components/TerminalPane').then((m) => ({ default: m.TerminalPane }))
);

const TABS: TabDefinition[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
];

export function MachineDetailPage({ machine, tab }: { machine: Machine; tab: MachineTab }) {
  const [pending, setPending] = useState<string | null>(null);
  const [detail, setDetail] = useState<Machine>(machine);
  const [bootLog, setBootLog] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const back = useUIStore((s) => s.back);
  const setTab = useUIStore((s) => s.setTab);
  const logTail = useSettingsStore((s) => s.logTail);
  const pushToast = useToastStore((s) => s.push);

  // The stream carries the list view of a machine; image, platform and
  // home-mount only come from inspect, so fetch that once per machine.
  useEffect(() => {
    let cancelled = false;

    void api
      .getMachine(machine.id)
      .then((full) => {
        if (!cancelled && full) setDetail(full);
      })
      .catch(() => {
        // The list view is enough to render the page.
      });

    return () => {
      cancelled = true;
    };
  }, [machine.id, machine.status]);

  const running = machine.status === 'running';
  const busy = pending !== null;

  const run = async (action: string, work: () => Promise<void>, message: string) => {
    setPending(action);
    try {
      await work();
      pushToast(message);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : `Failed to ${action} machine`, 'error');
    } finally {
      setPending(null);
    }
  };

  return (
    <DetailLayout
      onBack={back}
      backTo="Machines"
      title={machine.id}
      badges={
        <>
          <StatusPill status={machine.status} />
          {machine.default && <Badge tone="brand">default</Badge>}
        </>
      }
      subtitle={detail.image ?? 'container machine'}
      tabs={TABS}
      activeTab={tab}
      onSelectTab={setTab}
      actions={
        <>
          {running ? (
            <Button
              variant="secondary"
              icon={Square}
              busy={pending === 'stop'}
              busyLabel="Stopping…"
              disabled={busy}
              onClick={() =>
                void run('stop', () => api.stopMachine(machine.id), `Stopped ${machine.id}`)
              }
            >
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={Play}
              busy={pending === 'start'}
              busyLabel="Booting…"
              disabled={busy}
              onClick={() =>
                void run('start', () => api.startMachine(machine.id), `Started ${machine.id}`)
              }
            >
              Start
            </Button>
          )}

          <IconButton
            icon={Settings2}
            disabled={busy}
            title="Configure CPUs, memory and home mount"
            aria-label="Configure"
            onClick={() => setConfiguring(true)}
          />

          <IconButton
            icon={Star}
            busy={pending === 'default'}
            disabled={busy || machine.default}
            title={machine.default ? 'Already the default machine' : 'Make default'}
            aria-label="Make default"
            onClick={() =>
              void run(
                'default',
                () => api.setDefaultMachine(machine.id),
                `${machine.id} is now the default`
              )
            }
          />

          <IconButton
            icon={Trash2}
            busy={pending === 'delete'}
            disabled={busy}
            className="text-orange-700 dark:text-orange-500"
            title="Delete machine"
            aria-label="Delete"
            onClick={() => setConfirmingDelete(true)}
          />
        </>
      }
    >
      {tab === 'overview' && <OverviewTab machine={detail} />}

      {tab === 'logs' && (
        <DetailPane>
          <LogPane
            method="machines.logs"
            params={{ id: machine.id, tail: logTail, boot: bootLog }}
            missingHint={
              bootLog
                ? 'This machine has not booted yet, so there is no boot log to show. Start it and the log will appear here.'
                : 'A machine only writes this log while it is running. Start the machine, or switch to the boot log, to see output.'
            }
            controls={
              <label className="flex items-center gap-2 text-xs text-ink-600 dark:text-ink-400">
                <input
                  type="checkbox"
                  checked={bootLog}
                  onChange={(e) => setBootLog(e.target.checked)}
                  className="accent-brand-600"
                />
                Boot log
              </label>
            }
          />
        </DetailPane>
      )}

      {tab === 'terminal' && (
        <DetailPane>
          <Suspense
            fallback={
              <p className="flex flex-1 items-center justify-center p-6 text-sm text-ink-600 dark:text-ink-400">
                Loading terminal…
              </p>
            }
          >
            <TerminalPane target={{ kind: 'machine', id: machine.id }} disabled={false} />
          </Suspense>
        </DetailPane>
      )}

      {configuring && (
        <MachineSettingsDialog machine={detail} onClose={() => setConfiguring(false)} />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete ${machine.id}?`}
          body="The VM and its disk are deleted permanently. Containers that ran inside it are gone with it."
          confirmLabel="Delete"
          onConfirm={() => {
            setConfirmingDelete(false);
            void run('delete', () => api.deleteMachine(machine.id), `Deleted ${machine.id}`).then(
              back
            );
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </DetailLayout>
  );
}

function OverviewTab({ machine }: { machine: Machine }) {
  const running = machine.status === 'running';

  return (
    <DetailGrid>
      <Section title="Status">
        <Row label="State" value={machine.status} />
        <Row label="Default machine" value={machine.default ? 'yes' : 'no'} />
        <Row label="Uptime" value={running ? formatDuration(machine.startedAt) : '—'} />
        <Row label="Created" value={`${formatDuration(machine.createdAt)} ago`} />
        <Row label="VM ID" value={machine.containerId} mono copyable />
      </Section>

      <Section title="Networking">
        <Row label="IP address" value={machine.ipAddress} mono copyable />
        {!running && (
          <p className="text-tiny text-ink-600 dark:text-ink-400">
            An address is assigned once the machine boots.
          </p>
        )}
      </Section>

      <Section title="Allocation">
        <Row label="CPUs" value={machine.cpus} />
        <Row label="Memory" value={formatMemory(machine.memoryAllocation)} />
        <Row label="Disk" value={formatBytes(machine.diskSizeBytes)} />
        <Row
          label="Platform"
          value={machine.os && machine.architecture ? `${machine.os}/${machine.architecture}` : '—'}
        />
      </Section>

      <Section title="Host integration">
        <Row label="Home mount" value={machine.homeMount} wide />
        <Row label="User" value={machine.username} />
        <Row label="Image" value={machine.image} mono copyable wide />
        <p className="pt-1 text-tiny text-ink-600 dark:text-ink-400">
          CPU, memory and home mount can be changed from the toolbar; they apply on restart.
        </p>
      </Section>
    </DetailGrid>
  );
}
