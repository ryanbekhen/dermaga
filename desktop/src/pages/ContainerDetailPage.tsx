import { Suspense, lazy, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderTree,
  Info,
  Pencil,
  Play,
  RotateCw,
  ScrollText,
  Square,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { FileBrowser } from '../components/FileBrowser';
import { LogPane } from '../components/LogPane';
import { Meter } from '../components/Meter';
import { UsageChart, asBytes, asPercent } from '../components/UsageChart';
import { StatusBadge } from '../components/StatusBadge';
import { DetailGrid, DetailLayout, DetailPane } from '../components/DetailLayout';
import { SegmentedControl } from '../components/SegmentedControl';
import type { TabDefinition } from '../components/Tabs';
import { Button, IconButton } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Flags, Row, Section } from '../components/DetailRow';
import { ContainerForm } from '../components/ContainerForm';
import { api } from '../services/api';
import { useSettingsStore } from '../store/settingsStore';
import { useToastStore } from '../store/toastStore';
import { useUIStore } from '../store/uiStore';
import type { Container, ContainerSpec, ContainerTab, Port, UsagePoint } from '../types';
import { formatDuration, formatMemory, shortImage, splitEnv } from '../utils/format';

// xterm is a large dependency and only the Terminal tab needs it, so it stays
// out of the initial bundle.
const TerminalPane = lazy(() =>
  import('../components/TerminalPane').then((m) => ({ default: m.TerminalPane }))
);

const TABS: TabDefinition[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
];

// Both need a shell inside the container. An image built FROM scratch has
// none, and a tab that can only apologise is worse than no tab.
const NEEDS_SHELL = ['files', 'terminal'];

type Action = 'start' | 'stop' | 'restart' | 'remove';

interface ContainerDetailPageProps {
  container: Container;
  tab: ContainerTab;
}

export function ContainerDetailPage({ container, tab: requested }: ContainerDetailPageProps) {
  const [pending, setPending] = useState<Action | null>(null);
  // Empty means whoever the image runs as; root is the other one people reach
  // for, usually to install something inside a running container.
  const [shellUser, setShellUser] = useState('');
  // undefined while unknown: the tabs stay until the answer arrives, so they
  // do not flicker away and back on every visit.
  const [hasShell, setHasShell] = useState<boolean | undefined>(undefined);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [editing, setEditing] = useState<ContainerSpec | null>(null);
  const [loadingSpec, setLoadingSpec] = useState(false);

  const back = useUIStore((s) => s.back);
  const setTab = useUIStore((s) => s.setTab);
  const logTail = useSettingsStore((s) => s.logTail);
  const confirmDestructive = useSettingsStore((s) => s.confirmDestructive);
  const pushToast = useToastStore((s) => s.push);

  const running = container.status === 'running';

  useEffect(() => {
    if (!running) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      title={container.name}
      badges={<StatusBadge status={container.status} />}
      subtitle={shortImage(container.image)}
      tabs={tabs}
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
                void run('stop', () => api.stopContainer(container.id), `Stopped ${container.name}`)
              }
            >
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={Play}
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
              // what the container was created with.
              setLoadingSpec(true);
              void api
                .getContainerSpec(container.id)
                .then((spec) => setEditing(spec ?? null))
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
      {tab === 'overview' && <OverviewTab container={container} />}

      {tab === 'logs' && (
        <DetailPane>
          <LogPane method="containers.logs" params={{ id: container.id, tail: logTail }} />
        </DetailPane>
      )}

      {tab === 'files' && (
        <DetailPane>
          <FileBrowser container={container.id} running={running} />
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

      {editing && (
        <ContainerForm editing={container.id} initial={editing} onClose={() => setEditing(null)} />
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

function TabPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-sm text-ink-600 dark:text-ink-400">
      {children}
    </div>
  );
}

/**
 * The last half hour of samples for one container.
 *
 * Refetched whenever a new sample lands rather than on a timer: the container
 * in props is replaced by the pushed snapshot, so its usage changing is exactly
 * the signal that there is one more point to draw.
 */
function useUsageHistory(id: string, tick: number | undefined, enabled: boolean) {
  // Keyed by container so a half-finished fetch from the one just navigated
  // away from can never draw itself under the new name.
  const [state, setState] = useState<{ id: string; points: UsagePoint[] }>({ id, points: [] });

  useEffect(() => {
    if (!enabled) return;

    let live = true;
    api
      .getContainerHistory(id)
      .then((points) => {
        if (live) setState({ id, points });
      })
      .catch(() => {
        // A container that went away mid-request has no history to show.
      });

    return () => {
      live = false;
    };
  }, [id, tick, enabled]);

  return enabled && state.id === id ? state.points : [];
}

function OverviewTab({ container }: { container: Container }) {
  const [showEnv, setShowEnv] = useState(false);
  const running = container.status === 'running';
  const dns = container.dns;
  const hasDns =
    (dns?.nameservers.length ?? 0) > 0 ||
    (dns?.searchDomains.length ?? 0) > 0 ||
    (dns?.options.length ?? 0) > 0 ||
    Boolean(dns?.domain);
  const sysctls = Object.entries(container.sysctls ?? {});
  const history = useUsageHistory(container.id, container.cpuUsage, running);
  const env = container.environmentVariables ?? [];

  return (
    <DetailGrid>
      <Section title="Status">
        <Row label="State" value={container.status} />
        <Row label="Uptime" value={running ? formatDuration(container.startedAt) : '—'} />
        <Row label="Created" value={`${formatDuration(container.createdAt)} ago`} />
        <Row label="ID" value={container.id} mono copyable />
        <Row label="Image" value={container.image} mono copyable />
        <Row label="Platform" value={container.platform} />
      </Section>

      <Section title="Resources">
        <Meter
          value={running ? (container.cpuUsage ?? 0) : 0}
          label={`CPU · ${container.cpuAllocation ?? 1} core${(container.cpuAllocation ?? 1) > 1 ? 's' : ''}`}
          detail={running ? `${(container.cpuUsage ?? 0).toFixed(1)}%` : 'idle'}
        />
        <Meter
          value={running ? (container.memoryUsagePercent ?? 0) : 0}
          label="Memory"
          detail={
            running && container.memoryUsage
              ? `${formatMemory(container.memoryUsage)} / ${formatMemory(container.memoryAllocation)}`
              : formatMemory(container.memoryAllocation)
          }
        />
      </Section>

      {running && (
        <Section title="Last 30 minutes">
          <UsageChart
            points={history}
            label="CPU"
            value={(point) => point.cpuPercent}
            ceiling={100}
            format={asPercent}
          />
          <UsageChart
            points={history}
            label="Memory"
            value={(point) => point.memoryBytes}
            format={asBytes}
          />
        </Section>
      )}

      <Section title="Networking" span={(container.interfaces?.length ?? 0) > 1}>
        {container.interfaces && container.interfaces.length > 0 ? (
          <div
            className={
              container.interfaces.length > 1 ? 'grid grid-cols-2 gap-x-8 gap-y-3' : 'contents'
            }
          >
            {container.interfaces.map((iface) => (
              <div key={`${iface.network}-${iface.macAddress}`} className="flex flex-col gap-1.5">
                {container.interfaces!.length > 1 && (
                  <p className="text-xs font-semibold">{iface.network}</p>
                )}
                <Row label="Network" value={iface.network} />
                <Row label="Hostname" value={iface.hostname} mono copyable />
                <Row label="IPv4" value={iface.ipv4Address} mono copyable />
                <Row label="Gateway" value={iface.ipv4Gateway} mono copyable />
                <Row label="IPv6" value={iface.ipv6Address} mono copyable />
                <Row label="MAC" value={iface.macAddress} mono copyable />
                <Row label="MTU" value={iface.mtu} />
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

      <Section title="Process">
        <Row label="Entrypoint" value={container.entrypoint} mono />
        <Row label="Command" value={container.command?.join(' ')} mono />
        <Row label="Working directory" value={container.workingDir} mono />
        <Row label="User" value={container.user || 'root (0:0)'} mono />
        <Row label="Stop signal" value={container.stopSignal} mono />
        <Row label="Runtime" value={container.runtimeHandler} mono />
      </Section>

      {container.ports.length > 0 && (
        <Section title="Published ports">
          {container.ports.map((port) => (
            <PortRow
              key={`${port.protocol}-${port.host}-${port.container}`}
              port={port}
              running={running}
            />
          ))}
        </Section>
      )}

      {container.mounts.length > 0 && (
        <Section title="Mounts">
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

      <Section title="Runtime options">
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
            <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
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

/** Who the shell runs as. Changing it opens a fresh session as that user. */
function TerminalUser({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [custom, setCustom] = useState(false);
  // Typed separately from what is applied: every change reopens the shell, so
  // committing on each keystroke would open a session for "r", "ro", "roo"…
  const [draft, setDraft] = useState(value);

  return (
    <div className="flex items-center gap-2 pb-2">
      <span className="label-caps">Run as</span>

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
            target="_blank"
            rel="noreferrer"
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
