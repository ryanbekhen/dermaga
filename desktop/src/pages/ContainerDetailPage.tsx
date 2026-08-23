import { Suspense, lazy, useEffect, useState } from 'react';
import {
  Activity,
  Braces,
  Check,
  ChevronDown,
  CircleFadingArrowUp,
  ChevronRight,
  Copy,
  ExternalLink,
  ListTree,
  FolderTree,
  Info,
  Pencil,
  Play,
  RotateCw,
  ScrollText,
  Square,
  TerminalSquare,
  Zap,
  Trash2,
} from 'lucide-react';
import { FileBrowser } from '../components/FileBrowser';
import { LogPane } from '../components/LogPane';
import { LiveChart, type Trace } from '../components/LiveChart';
import { StatusPill } from '../components/StatusBadge';
import {
  DetailBody,
  DetailGrid,
  DetailLayout,
  DetailPane,
  DetailScroll,
  RailMeter,
  RailRow,
  RailSection,
} from '../components/DetailLayout';
import { SegmentedControl } from '../components/SegmentedControl';
import type { TabDefinition } from '../components/Tabs';
import { Button, IconButton } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Facts, Flags, Row, Section } from '../components/DetailRow';
import { ContainerForm } from '../components/ContainerForm';
import { api } from '../services/api';
import { recreateContainer } from '../services/tasks';
import { openExternal } from '../services/ipc';
import { isWeb, portNumber, reachableAt, urlFor } from '../utils/endpoint';
import { useLiveUsage } from '../hooks/useLiveUsage';
import { useSettingsStore } from '../store/settingsStore';
import { useToastStore } from '../store/toastStore';
import { useUIStore } from '../store/uiStore';
import type { PendingEdit, Container, ContainerSpec, ContainerTab, Port } from '../types';
import {
  formatBytes,
  formatDuration,
  formatMemory,
  formatRate,
  shortImage,
  splitEnv,
} from '../utils/format';

// xterm is a large dependency and only the Terminal tab needs it, so it stays
// out of the initial bundle.
const TerminalPane = lazy(() =>
  import('../components/TerminalPane').then((m) => ({ default: m.TerminalPane }))
);

// Named for the CLI commands behind them rather than for what the pane is.
// Somebody who has run `container inspect`, `container stats` and
// `container exec` already knows what each of these holds, and this window is
// a way of running that CLI -- so the tab that runs it should say so. The ids
// are unchanged: they are what a route carries, and nothing outside this file
// reads the labels.
//
// Logs first and open by default, because it is what a container is opened to
// look at. What it was started with does not change while you watch it; what it
// is saying does.
const TABS: TabDefinition[] = [
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'overview', label: 'Inspect', icon: Info },
  { id: 'usage', label: 'Stats', icon: Activity },
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'terminal', label: 'Exec', icon: TerminalSquare },
];

// Both need a shell inside the container. An image built FROM scratch has
// none, and a tab that can only apologise is worse than no tab.
const NEEDS_SHELL = ['files', 'terminal'];

type Action = 'start' | 'stop' | 'kill' | 'restart' | 'remove';

interface ContainerDetailPageProps {
  container: Container;
  tab: ContainerTab;
  /** A directory to open the files tab at, when something linked to one. */
  path?: string;
}

export function ContainerDetailPage({ container, tab: requested, path }: ContainerDetailPageProps) {
  const [pending, setPending] = useState<Action | null>(null);
  // Empty means whoever the image runs as; root is the other one people reach
  // for, usually to install something inside a running container.
  const [shellUser, setShellUser] = useState('');
  // undefined while unknown: the tabs stay until the answer arrives, so they
  // do not flicker away and back on every visit.
  const [hasShell, setHasShell] = useState<boolean | undefined>(undefined);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  // Offered only while the image this container was made from is no longer
  // what its tag points at.
  const [confirmingRecreate, setConfirmingRecreate] = useState(false);
  const [recreating, setRecreating] = useState(false);
  const [editing, setEditing] = useState<ContainerSpec | null>(null);
  // An edit that did not finish last time, offered back rather than retyped.
  const [resumed, setResumed] = useState<PendingEdit | null>(null);
  const [loadingSpec, setLoadingSpec] = useState(false);

  const back = useUIStore((s) => s.back);
  const setTab = useUIStore((s) => s.setTab);
  const logTail = useSettingsStore((s) => s.logTail);
  const confirmDestructive = useSettingsStore((s) => s.confirmDestructive);
  const pushToast = useToastStore((s) => s.push);

  const running = container.status === 'running';

  useEffect(() => {
    if (!running) return;

    void api
      .hasShell(container.id)
      .then(setHasShell)
      .catch(() => setHasShell(true));
  }, [container.id, running]);

  const tabs = hasShell === false ? TABS.filter((t) => !NEEDS_SHELL.includes(t.id)) : TABS;

  // Someone may be standing on a tab that has just been taken away.
  const tab = tabs.some((t) => t.id === requested) ? requested : 'overview';
  const busy = pending !== null;

  // No refetch after an action: the server pushes the new state over the event
  // stream the moment the CLI returns.
  const run = async (action: Action, work: () => Promise<void>, successMessage: string) => {
    setPending(action);
    try {
      await work();
      pushToast(successMessage);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : `Failed to ${action} container`, 'error');
    } finally {
      setPending(null);
    }
  };

  // Reported through the task strip rather than on this page: recreating
  // deletes the container, and for the second or two it takes there is no
  // container for this page to be about -- it is replaced by a spinner, and
  // anything drawn here would go with it.
  const recreate = async () => {
    setConfirmingRecreate(false);
    setRecreating(true);

    try {
      await recreateContainer(container);
    } finally {
      setRecreating(false);
    }
  };

  const remove = () => {
    setConfirmingRemove(false);
    void run(
      'remove',
      // A running container needs --force; the CLI refuses otherwise.
      () => api.removeContainer(container.id, running),
      `Removed ${container.name}`
    ).then(back);
  };

  return (
    <DetailLayout
      onBack={back}
      backTo="Containers"
      title={container.name}
      badges={
        <>
          <StatusPill status={container.status} />
          {/* The one fact about this container the runtime does not report:
              what it is made of is no longer what its name means. */}
          {container.imageMoved && (
            <span className="pill bg-amber-500/12 text-amber-600 dark:text-amber-500">
              image moved on
            </span>
          )}
        </>
      }
      subtitle={shortImage(container.image)}
      tabs={tabs}
      activeTab={tab}
      onSelectTab={setTab}
      actions={
        <>
          {running ? (
            <Button
              iconOnly
              icon={Square}
              busy={pending === 'stop'}
              busyLabel="Stopping…"
              disabled={busy}
              onClick={() =>
                void run('stop', () => api.stopContainer(container.id), `Stopped ${container.name}`)
              }
              className="text-amber-700 dark:text-amber-500"
            >
              Stop
            </Button>
          ) : null}

          {/* A container that will not stop politely has to be taken down
              abruptly -- and one whose runtime has stopped answering cannot be
              browsed, given a terminal, or stopped at all, which is exactly
              when this is the only way out. */}
          {running && (
            <Button
              iconOnly
              variant="ghost"
              icon={Zap}
              busy={pending === 'kill'}
              busyLabel="Forcing…"
              disabled={busy}
              title="Stop it abruptly, for a container that will not stop"
              onClick={() =>
                void run('kill', () => api.killContainer(container.id), `Killed ${container.name}`)
              }
              className="text-brand-700 dark:text-brand-400"
            >
              Force stop
            </Button>
          )}

          {!running && (
            <Button
              iconOnly
              icon={Play}
              className="text-emerald-700 dark:text-emerald-500"
              busy={pending === 'start'}
              busyLabel="Starting…"
              disabled={busy}
              onClick={() =>
                void run(
                  'start',
                  () => api.startContainer(container.id),
                  `Started ${container.name}`
                )
              }
            >
              Start
            </Button>
          )}

          {/* Beside Restart, and above it in the order, because when a tag has
              moved this is what somebody came here to press: a restart puts
              the same image back. */}
          {container.imageMoved && (
            <Button
              iconOnly
              icon={CircleFadingArrowUp}
              busy={recreating}
              busyLabel="Recreating…"
              disabled={busy || recreating}
              className="text-amber-700 dark:text-amber-500"
              onClick={() => (confirmDestructive ? setConfirmingRecreate(true) : void recreate())}
            >
              Recreate on the newer image
            </Button>
          )}

          <IconButton
            icon={RotateCw}
            busy={pending === 'restart'}
            disabled={busy || !running}
            title="Restart"
            aria-label="Restart"
            onClick={() =>
              void run(
                'restart',
                async () => {
                  await api.stopContainer(container.id);
                  await api.startContainer(container.id);
                },
                `Restarted ${container.name}`
              )
            }
          />

          <IconButton
            icon={Pencil}
            busy={loadingSpec}
            disabled={busy}
            title="Edit configuration"
            aria-label="Edit"
            onClick={() => {
              // The spec comes from the server so the form opens with exactly
              // what the container was created with -- unless an earlier edit
              // never finished, in which case those changes are worth more than
              // the configuration they were meant to replace.
              setLoadingSpec(true);
              void Promise.all([
                api.getContainerSpec(container.id),
                api.getPendingEdit(container.id).catch(() => null),
              ])
                .then(([spec, pending]) => {
                  setResumed(pending ?? null);
                  setEditing(pending?.spec ?? spec ?? null);
                })
                .catch(() => pushToast('Could not read this container’s configuration', 'error'))
                .finally(() => setLoadingSpec(false));
            }}
          />

          <IconButton
            icon={Trash2}
            busy={pending === 'remove'}
            disabled={busy}
            className="text-orange-700 dark:text-orange-500"
            title="Remove"
            aria-label="Remove"
            onClick={() => (confirmDestructive ? setConfirmingRemove(true) : remove())}
          />
        </>
      }
    >
      <DetailBody rail={<ContainerRail container={container} />}>
        {tab === 'overview' && <InspectTab container={container} />}

        {tab === 'usage' && <UsageTab container={container} />}

        {tab === 'logs' && (
          <DetailPane>
            <LogPane method="containers.logs" params={{ id: container.id, tail: logTail }} />
          </DetailPane>
        )}

        {tab === 'files' && (
          <DetailPane>
            <FileBrowser container={container.id} running={running} start={path} />
          </DetailPane>
        )}

        {tab === 'terminal' && (
          <DetailPane>
            <Suspense fallback={<TabPlaceholder>Loading terminal…</TabPlaceholder>}>
              <TerminalUser value={shellUser} onChange={setShellUser} />
              <TerminalPane
                target={{ kind: 'container', id: container.id }}
                disabled={!running}
                disabledMessage="Start the container to open a shell in it."
              />
            </Suspense>
          </DetailPane>
        )}
      </DetailBody>

      {editing && (
        <ContainerForm
          editing={container.id}
          initial={editing}
          resumed={resumed ?? undefined}
          onDiscardResumed={() => {
            void api.discardPendingEdit(container.id).catch(() => {
              // Nothing to tell the user: the form is closing either way, and
              // the next edit reads the container itself.
            });
            setResumed(null);
            setEditing(null);
          }}
          onClose={() => {
            setEditing(null);
            setResumed(null);
          }}
        />
      )}

      {confirmingRecreate && (
        <ConfirmDialog
          title={`Recreate ${container.name}?`}
          body={`${shortImage(container.image)} has been built again since this container started. It is stopped, deleted and run again from what that tag points at now — same name, ports, volumes and environment. Named volumes survive; anything written to the container filesystem does not.`}
          confirmLabel="Recreate"
          onConfirm={() => void recreate()}
          onCancel={() => setConfirmingRecreate(false)}
        />
      )}

      {confirmingRemove && (
        <ConfirmDialog
          title={`Remove ${container.name}?`}
          body={
            running
              ? 'This container is running. Removing it forces it to stop first. Volumes are left untouched.'
              : 'This deletes the container. Volumes are left untouched.'
          }
          confirmLabel="Remove"
          onConfirm={remove}
          onCancel={() => setConfirmingRemove(false)}
        />
      )}
    </DetailLayout>
  );
}

// Declared once rather than rebuilt on every render: the chart memoises on the
// traces it is handed, and a fresh array each time defeats that.
const CPU: Trace[] = [{ name: 'CPU', value: (point) => point.cpuPercent }];
const MEMORY: Trace[] = [{ name: 'Memory', value: (point) => point.memoryBytes }];
const NETWORK: Trace[] = [
  { name: 'Data received', value: (point) => point.networkRxPerSec },
  { name: 'Data sent', value: (point) => point.networkTxPerSec },
];
const DISK: Trace[] = [
  { name: 'Data read', value: (point) => point.blockReadPerSec },
  { name: 'Data written', value: (point) => point.blockWritePerSec },
];

const asPercent = (value: number) => `${value.toFixed(1)}%`;
const asBytes = (value: number) => formatBytes(value);
const asRate = (value: number) => formatRate(value);

/**
 * A counter since the container started. Zero is a reading, not a blank -- but
 * only while the container is running: nothing is sampled once it stops, and
 * "0 B" would say it moved nothing rather than that nobody is looking.
 */
function total(bytes?: number): string {
  return bytes && bytes > 0 ? formatBytes(bytes) : '0 B';
}

/**
 * What the container is doing, as it does it.
 *
 * The agent takes a reading every five seconds and has been keeping the last
 * few minutes of them since it started, so this opens full and carries on
 * rather than filling itself while somebody waits. Apple's runtime keeps no
 * history of its own; this window is Dermaga's, it lives in memory, and it goes
 * when the app does.
 */
function UsageTab({ container }: { container: Container }) {
  const running = container.status === 'running';
  const cores = container.cpuAllocation ?? 1;
  const points = useLiveUsage(container, running);

  if (!running) {
    return (
      <DetailScroll>
        <p className="text-sm text-ink-600 dark:text-ink-400">
          Nothing is measured while the container is stopped. Start it and the readings begin
          arriving within a few seconds.
        </p>
      </DetailScroll>
    );
  }

  return (
    <DetailScroll>
      {/* Said once, at the top, rather than on all four charts: what the window
          is, how often it moves, and that closing the tab ends it. */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-tiny text-ink-500">
        <span className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-500">
          <span
            className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse"
            aria-hidden
          />
          Live
        </span>
        <span aria-hidden>·</span>
        <span>the runtime is asked every 5 seconds; the last 2 minutes are drawn</span>
        <span aria-hidden>·</span>
        <span>kept while Dermaga runs, so closing this and coming back continues it</span>
      </p>

      {/* No group heading over each chart. Every one of these already writes
          its own name and its current reading across the top -- a chart nobody
          can read a number off is a picture, not an instrument -- so wrapping
          it in a titled group put "CPU" directly above "CPU usage". */}
      <div className="grid grid-cols-1 items-start gap-x-10 gap-y-7 lg:grid-cols-2">
        <LiveChart
          points={points}
          traces={CPU}
          format={asPercent}
          heading="CPU usage"
          reading={`${(container.cpuUsage ?? 0).toFixed(2)}% of ${cores} core${cores > 1 ? 's' : ''}`}
          floor={10}
        />

        <LiveChart
          points={points}
          traces={MEMORY}
          format={asBytes}
          heading="Memory usage"
          reading={`${formatBytes(container.memoryUsageBytes)} / ${formatMemory(container.memoryAllocation)}`}
        />

        {/* Rates on the chart, totals in the reading: the line says what is
            happening, the figure says what has happened, and a container quiet
            now that has pulled a gigabyte is a different container from one
            that has pulled nothing. */}
        <LiveChart
          points={points}
          traces={NETWORK}
          format={asRate}
          heading="Network I/O"
          reading={`${total(container.networkRxBytes)} / ${total(container.networkTxBytes)}`}
        />

        <LiveChart
          points={points}
          traces={DISK}
          format={asRate}
          heading="Disk read/write"
          reading={`${total(container.blockReadBytes)} / ${total(container.blockWriteBytes)}`}
        />
      </div>

      <p className="text-xs text-ink-600 dark:text-ink-400">
        {container.processes ?? 0} process{(container.processes ?? 0) === 1 ? '' : 'es'} running
        inside this container.
      </p>
    </DetailScroll>
  );
}

function TabPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-sm text-ink-600 dark:text-ink-400">
      {children}
    </div>
  );
}

/** Who the shell runs as. Changing it opens a fresh session as that user. */
function TerminalUser({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [custom, setCustom] = useState(false);
  // Typed separately from what is applied: every change reopens the shell, so
  // committing on each keystroke would open a session for "r", "ro", "roo"…
  const [draft, setDraft] = useState(value);

  return (
    <div className="flex items-center gap-2.5 px-7 pt-4">
      <span className="label-mono">Run as</span>

      <SegmentedControl
        ariaLabel="Run the shell as"
        value={custom ? 'custom' : value === 'root' ? 'root' : 'default'}
        onChange={(next) => {
          if (next === 'custom') {
            setCustom(true);
            setDraft(value === 'root' ? '' : value);
            return;
          }

          setCustom(false);
          setDraft('');
          onChange(next === 'root' ? 'root' : '');
        }}
        segments={[
          { value: 'default', label: 'Image default' },
          { value: 'root', label: 'root' },
          { value: 'custom', label: 'Other…' },
        ]}
      />

      {custom && (
        <>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onChange(draft.trim())}
            onBlur={() => onChange(draft.trim())}
            placeholder="name or uid:gid"
            aria-label="User to run the shell as"
            className="input w-40"
          />
          {draft.trim() !== value && (
            <span className="text-tiny text-ink-500">press ↵ to apply</span>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A published port, and a way to reach it.
 *
 * A port mapping is only interesting because something is listening behind it,
 * and the next thing anyone does with 8080 is open it. TCP only: there is
 * nothing a browser can do with a UDP port.
 */

/**
 * The strip beside every tab: what this container is spending, and what it is.
 *
 * These used to be an Overview tab of their own, which meant the port a
 * container publishes was on a different screen from the log line complaining
 * that nothing was listening on it. They are the context for the other tabs,
 * not a tab.
 */
function ContainerRail({ container }: { container: Container }) {
  const running = container.status === 'running';
  const cores = container.cpuAllocation ?? 1;
  const listening = listeningOn(container);
  const rx = container.networkRxPerSec ?? 0;
  const tx = container.networkTxPerSec ?? 0;

  return (
    <>
      {running && (
        <RailSection title="Live">
          <div className="flex flex-col gap-3.5">
            <RailMeter
              label="CPU"
              value={`${(container.cpuUsage ?? 0).toFixed(1)}%`}
              percent={container.cpuUsage ?? 0}
            />
            <RailMeter
              label="Memory"
              value={`${formatMemory(container.memoryUsage)} / ${formatMemory(
                container.memoryAllocation
              )}`}
              percent={container.memoryUsagePercent ?? 0}
              tone="rose"
            />
            {/* No meter. Throughput has no ceiling to be a share of, and a bar
                drawn against an invented one would move for no reason. */}
            <RailMeter label="Network I/O" value={`↓ ${formatRate(rx)}  ↑ ${formatRate(tx)}`} />
          </div>
        </RailSection>
      )}

      <RailSection title="Configuration">
        <div className="flex flex-col">
          <RailRow label="Image" value={container.image} />
          <RailRow label="Platform" value={container.platform} />
          <RailRow label="Command" value={commandLine(container)} />
          <RailRow label="CPUs" value={cores} />
          <RailRow label="Memory" value={formatMemory(container.memoryAllocation)} />
          <RailRow label="Network" value={container.networks?.join(', ')} />
          <RailRow label="IP address" value={container.interfaces?.[0]?.ipv4Address} />
          <RailRow
            label="Ports"
            // Publishing is not the only way to reach a container here: it has
            // an address of its own, so what its image listens on is an answer
            // to the same question. "none published" was the whole of it, and
            // it read as "nowhere to go".
            value={
              container.ports.length > 0
                ? container.ports
                    .map((port) => `${port.host}→${port.container}/${port.protocol}`)
                    .join(', ')
                : listening.length > 0
                  ? listening.map((port) => portNumber(port)).join(', ')
                  : 'none published'
            }
          />
          <RailRow label="Hostname" value={container.hostname} />
          <RailRow label="Created" value={`${formatDuration(container.createdAt)} ago`} />
          <RailRow label="Uptime" value={running ? formatDuration(container.startedAt) : '—'} />
        </div>
      </RailSection>
    </>
  );
}

/**
 * The Inspect tab: the configuration, in either of the two ways it is wanted.
 *
 * Read is the default and is what the app is for -- labelled fields, a digest
 * with a copy button beside it, a network you can press to go to. Raw is the
 * same answer as the runtime gave it, for pasting into an issue: nobody wants
 * to reconstruct JSON by hand out of a page that had it all along.
 *
 * The live readings are stripped out of the raw view. They change every few
 * seconds, and JSON that reflows under the cursor is JSON nobody can select a
 * line out of -- they are in the rail beside it, where movement belongs.
 */
function InspectTab({ container }: { container: Container }) {
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const json = JSON.stringify(withoutLiveReadings(container), null, 2);

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
        <ConfigurationView container={container} />
      )}
    </div>
  );
}

/**
 * The fields that carry a reading rather than a setting. Listed rather than
 * destructured away: a dozen throwaway bindings is a dozen things a linter is
 * right to ask about, and a list can be read against the type it came from.
 */
const LIVE_READINGS = [
  'cpuUsage',
  'memoryUsage',
  'memoryUsageBytes',
  'memoryUsagePercent',
  'networkRxPerSec',
  'networkTxPerSec',
  'blockReadPerSec',
  'blockWritePerSec',
  'networkRxBytes',
  'networkTxBytes',
  'blockReadBytes',
  'blockWriteBytes',
  'processes',
] as const satisfies readonly (keyof Container)[];

/** The container as configured, without the numbers that move while you read. */
function withoutLiveReadings(container: Container): Partial<Container> {
  return Object.fromEntries(
    Object.entries(container).filter(
      ([key]) => !LIVE_READINGS.includes(key as (typeof LIVE_READINGS)[number])
    )
  );
}

/** What the container was told to run, as one line. */
function commandLine(container: Container): string {
  const parts = [container.entrypoint, ...(container.command ?? [])].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '—';
}

/**
 * The configuration as labelled fields: a digest with a copy button beside it,
 * a network you can press to go to, environment behind a disclosure.
 *
 * What identifies the container -- image, platform, ports, addresses, uptime --
 * is in the rail, on screen whichever tab is open, so it is not repeated here.
 */
function ConfigurationView({ container }: { container: Container }) {
  const openNetwork = useUIStore((s) => s.openNetwork);
  const [showEnv, setShowEnv] = useState(false);
  const running = container.status === 'running';
  const listening = listeningOn(container);
  const dns = container.dns;
  const hasDns =
    (dns?.nameservers.length ?? 0) > 0 ||
    (dns?.searchDomains.length ?? 0) > 0 ||
    (dns?.options.length ?? 0) > 0 ||
    Boolean(dns?.domain);
  const sysctls = Object.entries(container.sysctls ?? {});
  const env = container.environmentVariables ?? [];

  return (
    <DetailGrid>
      <Section title="Resources">
        <Row
          label="CPU"
          value={`${container.cpuAllocation ?? 1} core${(container.cpuAllocation ?? 1) > 1 ? 's' : ''}`}
        />
        <Row label="Memory" value={formatMemory(container.memoryAllocation)} />
      </Section>

      <Section title="Networking" span={(container.interfaces?.length ?? 0) > 1} plain>
        {container.interfaces && container.interfaces.length > 0 ? (
          <div
            className={
              container.interfaces.length > 1 ? 'grid grid-cols-2 gap-x-8 gap-y-4' : 'contents'
            }
          >
            {container.interfaces.map((iface) => (
              <div key={`${iface.network}-${iface.macAddress}`} className="flex flex-col gap-2">
                {/* The network names itself once, at the head of its own
                    addresses, instead of again as a row among them. */}
                <button
                  onClick={() => openNetwork(iface.network)}
                  className="self-start text-xs font-semibold hover:text-brand-600 hover:underline dark:hover:text-brand-400"
                  title={`Open ${iface.network}`}
                >
                  {iface.network}
                </button>

                <Facts>
                  <Row label="IPv4" value={iface.ipv4Address} mono copyable />
                  <Row label="Gateway" value={iface.ipv4Gateway} mono copyable />
                  <Row label="IPv6" value={iface.ipv6Address} mono copyable wide />
                  <Row label="MAC" value={iface.macAddress} mono copyable />
                  <Row label="MTU" value={iface.mtu} />
                  <Row label="Hostname" value={iface.hostname} mono copyable wide />
                </Facts>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-ink-600 dark:text-ink-400">
            {running
              ? 'No network interfaces reported.'
              : `Addresses are assigned when the container starts${
                  container.networks?.length
                    ? ` · configured network: ${container.networks.join(', ')}`
                    : ''
                }.`}
          </p>
        )}
      </Section>

      {/* Only what is set. Half of these are empty on a typical container, and
          six rows of em-dashes is a panel that has taken twelve lines to say
          nothing -- the full answer, dashes and all, is under Raw. */}
      <Section title="Process">
        {container.entrypoint && <Row label="Entrypoint" value={container.entrypoint} mono wide />}
        {(container.command?.length ?? 0) > 0 && (
          <Row label="Command" value={container.command?.join(' ')} mono wide />
        )}
        {container.workingDir && (
          <Row label="Working directory" value={container.workingDir} mono wide />
        )}
        <Row label="User" value={container.user || 'root (0:0)'} mono />
        {container.stopSignal && <Row label="Stop signal" value={container.stopSignal} mono />}
        {container.runtimeHandler && <Row label="Runtime" value={container.runtimeHandler} mono />}
      </Section>

      {container.ports.length > 0 && (
        <Section title="Published ports" plain>
          {container.ports.map((port) => (
            <PortRow
              key={`${port.protocol}-${port.host}-${port.container}`}
              port={port}
              running={running}
            />
          ))}
        </Section>
      )}

      {/* What the image says it listens on and nothing published. Not a lesser
          kind of port on this runtime: the container has an address of its own,
          so these are reachable exactly as they stand. */}
      {listening.length > 0 && (
        <Section title="Listening" plain>
          {listening.map((port) => (
            <ListeningRow key={port} port={port} host={running ? reachableAt(container) : null} />
          ))}
        </Section>
      )}

      {container.mounts.length > 0 && (
        <Section title="Mounts" plain>
          {container.mounts.map((mount) => (
            <div key={mount.destination} className="flex flex-col gap-0.5">
              <p className="selectable truncate font-mono text-xs">{mount.destination}</p>
              <p className="selectable truncate text-tiny text-ink-600 dark:text-ink-400">
                {mount.source} · {mount.type}
                {mount.readOnly ? ' · read-only' : ''}
              </p>
            </div>
          ))}
        </Section>
      )}

      <Section title="Runtime options" plain>
        <Row
          label="Starts with Dermaga"
          value={container.labels['dermaga.autoboot'] === 'true' ? 'yes' : 'no'}
        />
        <Flags
          flags={[
            { label: 'init', on: Boolean(container.useInit) },
            { label: 'tty', on: Boolean(container.terminal) },
            { label: 'read-only root', on: Boolean(container.readOnlyRoot) },
            { label: 'rosetta', on: Boolean(container.rosetta) },
            { label: 'virtualization', on: Boolean(container.virtualization) },
            { label: 'ssh agent', on: Boolean(container.ssh) },
          ]}
        />
        {(container.capAdd?.length ?? 0) > 0 && (
          <Row label="Added capabilities" value={container.capAdd?.join(', ')} mono />
        )}
        {(container.capDrop?.length ?? 0) > 0 && (
          <Row label="Dropped capabilities" value={container.capDrop?.join(', ')} mono />
        )}
        {sysctls.map(([key, value]) => (
          <Row key={key} label={key} value={value} mono />
        ))}
      </Section>

      {hasDns && (
        <Section title="DNS">
          <Row label="Nameservers" value={dns?.nameservers.join(', ')} mono />
          <Row label="Search domains" value={dns?.searchDomains.join(', ')} mono />
          <Row label="Domain" value={dns?.domain} mono />
          <Row label="Options" value={dns?.options.join(', ')} mono />
        </Section>
      )}

      {env.length > 0 && (
        <Section
          title={`Environment (${env.length})`}
          span={showEnv}
          plain
          action={
            <button
              onClick={() => setShowEnv((prev) => !prev)}
              className="flex items-center gap-1 text-tiny font-semibold text-brand-700 hover:underline dark:text-brand-400"
            >
              {showEnv ? (
                <ChevronDown size={12} aria-hidden />
              ) : (
                <ChevronRight size={12} aria-hidden />
              )}
              {showEnv ? 'Hide' : 'Show'}
            </button>
          }
        >
          {showEnv ? (
            <div className="grid grid-cols-1 gap-x-8 gap-y-3 lg:grid-cols-2">
              {env.map((entry) => {
                const [key, value] = splitEnv(entry);
                return <Row key={key} label={key} value={value || '—'} mono copyable />;
              })}
            </div>
          ) : (
            <p className="truncate text-xs text-ink-600 dark:text-ink-400">
              {env.map((entry) => splitEnv(entry)[0]).join(', ')}
            </p>
          )}
        </Section>
      )}

      {Object.keys(container.labels).length > 0 && (
        <Section title="Labels">
          {Object.entries(container.labels).map(([key, value]) => (
            <Row key={key} label={key} value={value} />
          ))}
        </Section>
      )}
    </DetailGrid>
  );
}
/**
 * The ports an image declares that nothing was published for.
 *
 * A container that publishes 8080→80 is already answered for by the row above;
 * listing 80 again underneath would be the same port twice, described two ways.
 */
function listeningOn(container: Container): string[] {
  const published = new Set(container.ports.map((port) => port.container));

  return (container.exposedPorts ?? []).filter((port) => !published.has(portNumber(port)));
}

/** One port the image listens on, at the container's own address. */
function ListeningRow({ port, host }: { port: string; host: string | null }) {
  const url = host && isWeb(port) ? urlFor(host, port) : null;

  return (
    <div className="row">
      <span className="row-key">{port.split('/')[1] ?? 'tcp'}</span>
      <span className="row-value flex items-center justify-end gap-2 font-mono">
        {host ? `${host}:${portNumber(port)}` : portNumber(port)}
        {url && (
          <a
            href={url}
            onClick={(event) => {
              event.preventDefault();
              void openExternal(url);
            }}
            title={`Open ${url}`}
            className="btn-icon border-transparent"
            aria-label={`Open ${url} in your browser`}
          >
            <ExternalLink size={13} aria-hidden />
          </a>
        )}
      </span>
    </div>
  );
}

function PortRow({ port, running }: { port: Port; running: boolean }) {
  const hostPort = port.host.includes(':') ? port.host.split(':').pop() : port.host;
  const openable = running && port.protocol.toLowerCase() === 'tcp' && Boolean(hostPort);
  const url = `http://localhost:${hostPort}`;

  return (
    <div className="row">
      <span className="row-key">{port.protocol}</span>
      <span className="row-value flex items-center justify-end gap-2 font-mono">
        {port.host} → {port.container}
        {openable && (
          <a
            href={url}
            onClick={(event) => {
              event.preventDefault();
              void openExternal(url);
            }}
            title={`Open ${url}`}
            className="btn-icon border-transparent"
            aria-label={`Open ${url} in your browser`}
          >
            <ExternalLink size={13} aria-hidden />
          </a>
        )}
      </span>
    </div>
  );
}
