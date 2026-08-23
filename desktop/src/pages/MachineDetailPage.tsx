import { Suspense, lazy, useEffect, useState } from 'react';
import {
  Braces,
  Check,
  Copy,
  Info,
  ListTree,
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
import { DefaultStar, StatusText } from '../components/StatusBadge';
import {
  DetailBody,
  DetailGrid,
  DetailLayout,
  DetailPane,
  RailRow,
  RailSection,
} from '../components/DetailLayout';
import { SegmentedControl } from '../components/SegmentedControl';
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

// Inspect first, because that is where this page opens: `openMachine` lands on
// it, and it was the second tab -- so the strip's first word and the page under
// it disagreed, and ⌘1 moved you somewhere you had not been.
//
// A terminal led, on the reasoning that it is what a machine is opened for. A
// container's does lead with what you came to look at, which is why the two
// pages differ here: a machine is a thing you check on -- how much it has been
// given, where it is, whether it is up -- far more often than a thing you type
// into, and opening a shell in one is a deliberate act that can afford a click.
//
// "Overview" was this page's own word for what every other detail page calls
// Inspect; the id is unchanged, since that is what a route carries.
const TABS: TabDefinition[] = [
  { id: 'overview', label: 'Inspect', icon: Info },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
  { id: 'logs', label: 'Logs', icon: ScrollText },
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
          <StatusText status={machine.status} />
          {machine.default && <DefaultStar />}
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
              iconOnly
              icon={Square}
              className="text-amber-700 dark:text-amber-500"
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
              iconOnly
              icon={Play}
              className="text-emerald-700 dark:text-emerald-500"
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

          {/* Lit when this is the default. Disabled was the only difference
              before, and a bare icon at reduced opacity reads as "not
              available" rather than as "already true" -- which is the opposite
              of what it means here. */}
          <IconButton
            icon={Star}
            busy={pending === 'default'}
            disabled={busy || machine.default}
            className={
              machine.default
                ? 'text-amber-600 disabled:opacity-100 dark:text-amber-500'
                : undefined
            }
            iconClassName={machine.default ? 'fill-current' : undefined}
            title={machine.default ? 'This is the default machine' : 'Make this the default'}
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
      <DetailBody rail={<MachineRail machine={detail} />}>
        {tab === 'overview' && <InspectTab machine={detail} />}

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
      </DetailBody>
    </DetailLayout>
  );
}

/**
 * The Inspect tab: what the machine is, in either of the two ways it is
 * wanted.
 *
 * The same pair a container's Inspect offers -- labelled fields to read, and
 * the runtime's own JSON to paste into an issue. This page used to offer only
 * the first, which meant the one page describing the thing every container
 * runs inside was also the one page you could not copy an answer out of.
 */
function InspectTab({ machine }: { machine: Machine }) {
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const json = JSON.stringify(machine, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be denied; the text is still selectable.
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-7 pt-4">
        <SegmentedControl
          ariaLabel="How to show the configuration"
          segments={[
            { value: 'read', label: 'Read', icon: ListTree },
            { value: 'raw', label: 'Raw', icon: Braces },
          ]}
          value={raw ? 'raw' : 'read'}
          onChange={(value) => setRaw(value === 'raw')}
        />
        <div className="flex-1" />
        <Button iconOnly icon={copied ? Check : Copy} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy JSON'}
        </Button>
      </div>

      {raw ? (
        <div className="flex min-h-0 flex-1 flex-col px-7 pb-4 pt-2.5">
          <pre className="selectable min-h-0 flex-1 overflow-auto rounded-xl bg-chrome-bg p-4 font-mono text-code leading-[1.7] text-chrome-muted">
            {json}
          </pre>
        </div>
      ) : (
        <ReadView machine={machine} />
      )}
    </div>
  );
}

function ReadView({ machine }: { machine: Machine }) {
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

/**
 * The facts that say which machine this is, kept on screen whichever tab is
 * open.
 *
 * The same rail a container and an image get, and for the same reason: the
 * terminal tab fills the page, and without this the only thing naming what you
 * have a shell inside is the heading you scrolled past.
 */
function MachineRail({ machine }: { machine: Machine }) {
  const running = machine.status === 'running';

  return (
    <>
      <RailSection title="Allocation">
        <div className="flex flex-col">
          <RailRow label="vCPUs" value={machine.cpus} />
          <RailRow label="Memory" value={formatMemory(machine.memoryAllocation)} />
          <RailRow label="Disk" value={formatBytes(machine.diskSizeBytes)} />
        </div>
      </RailSection>

      <RailSection title="Configuration">
        <div className="flex flex-col">
          <RailRow label="Image" value={machine.image} />
          <RailRow
            label="Platform"
            value={
              machine.os && machine.architecture
                ? `${machine.os}/${machine.architecture}`
                : undefined
            }
          />
          <RailRow label="IP address" value={machine.ipAddress} />
          <RailRow label="User" value={machine.username} />
          <RailRow label="Home mount" value={machine.homeMount} />
          <RailRow label="Default" value={machine.default ? 'yes' : 'no'} />
          <RailRow label="Created" value={`${formatDuration(machine.createdAt)} ago`} />
          <RailRow label="Uptime" value={running ? formatDuration(machine.startedAt) : '—'} />
        </div>
      </RailSection>
    </>
  );
}
