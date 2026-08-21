import { useState } from 'react';
import { ChevronRight, LayoutGrid, Play, Plus, Square, Trash2 } from 'lucide-react';
import { ContainerForm } from '../components/ContainerForm';
import { TemplateGallery } from '../components/TemplateGallery';
import { TaskRows } from '../components/TaskRows';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable, Muted, NameCell, SelectionActions, type Column } from '../components/DataTable';
import { api } from '../services/api';
import { useToastStore } from '../store/toastStore';
import { StatusDot } from '../components/StatusBadge';
import { useResourceStore } from '../store/resourceStore';
import { useSettingsStore } from '../store/settingsStore';
import { PageHeader } from '../components/PageHeader';
import { useDialog } from '../hooks/useDialog';
import { useUIStore } from '../store/uiStore';
import type { ContainerSpec, Container } from '../types';
import { formatDuration, formatMemory, parseMebibytes, shortImage } from '../utils/format';

// Mirrors `container ls` -- name, image, platform, address, CPUs, memory,
// started -- with live usage folded into the two resource columns.
const COLUMNS: Column[] = [
  { key: 'name', label: 'Name', width: 'minmax(110px,1.1fr)' },
  { key: 'image', label: 'Image', width: 'minmax(140px,1.6fr)' },
  { key: 'platform', label: 'Platform', width: '92px' },
  { key: 'ip', label: 'IP address', width: '132px' },
  { key: 'cpu', label: 'CPU', width: '104px' },
  { key: 'memory', label: 'Memory', width: '128px' },
  { key: 'up', label: 'Up', width: '64px', align: 'right' },
];

export function ContainersPage({ runtimeMissing }: { runtimeMissing: boolean }) {
  const containers = useResourceStore((s) => s.containers);
  const hasLoaded = useResourceStore((s) => s.hasLoaded);
  const showStopped = useSettingsStore((s) => s.showStopped);
  const showBuilder = useSettingsStore((s) => s.showBuilder);
  const searchQuery = useUIStore((s) => s.searchQuery);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
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

  const needle = searchQuery.trim().toLowerCase();
  const visible = containers.filter((container) => {
    if (!showStopped && container.status !== 'running') return false;
    // Apple's builder, which `container build` makes and manages. Real enough
    // to show by default -- it holds memory like anything else -- but not
    // somebody's container, so it can be turned off.
    if (!showBuilder && container.image.startsWith('ghcr.io/apple/container-builder-shim/')) {
      return false;
    }
    if (!needle) return true;
    return (
      container.name.toLowerCase().includes(needle) ||
      container.image.toLowerCase().includes(needle) ||
      container.id.toLowerCase().includes(needle)
    );
  });

  const running = containers.filter((c) => c.status === 'running');
  const allocatedCpus = running.reduce((sum, c) => sum + (c.cpuAllocation ?? 1), 0);
  const allocatedMib = running.reduce((sum, c) => sum + parseMebibytes(c.memoryAllocation), 0);
  const usedMib = running.reduce((sum, c) => sum + parseMebibytes(c.memoryUsage), 0);

  const emptyMessage = !hasLoaded
    ? 'Connecting to the Dermaga server…'
    : runtimeMissing
      ? 'The Apple Container CLI was not found on this Mac.'
      : containers.length === 0
        ? 'No containers yet. Start from a template, or use “New container”.'
        : needle
          ? 'No containers match your search.'
          : 'No running containers. Enable “Show stopped containers” in Settings.';

  const chosen = containers.filter((c) => selected.has(c.id));
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
    <div className="flex min-h-0 flex-1 flex-col gap-3 -mb-4">
      <PageHeader
        title="Containers"
        subtitle={`${running.length} of ${containers.length} running · ${allocatedCpus} CPU · ${formatMemory(
          `${Math.round(usedMib)}m`
        )} of ${formatMemory(`${allocatedMib}m`)} memory`}
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: 'Search containers…',
        }}
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
        cells={(container) => {
          const isRunning = container.status === 'running';
          const address = container.interfaces?.[0]?.ipv4Address;
          const cpu = isRunning ? (container.cpuUsage ?? 0) : 0;
          const memory = isRunning ? (container.memoryUsagePercent ?? 0) : 0;

          return [
            <NameCell key="name">
              <StatusDot status={container.status} />
              <span className="truncate text-sm font-semibold">{container.name}</span>
            </NameCell>,
            <Muted key="image">{shortImage(container.image)}</Muted>,
            <Muted key="platform">{container.platform ?? '—'}</Muted>,
            <Muted key="ip" mono>
              {address ?? '—'}
            </Muted>,
            <MeterCell
              key="cpu"
              value={cpu}
              label={isRunning ? `${cpu.toFixed(1)}%` : `${container.cpuAllocation ?? 1} CPU`}
              sub={isRunning ? `of ${container.cpuAllocation ?? 1}` : 'idle'}
            />,
            <MeterCell
              key="memory"
              value={memory}
              label={
                isRunning && container.memoryUsage
                  ? formatMemory(container.memoryUsage)
                  : formatMemory(container.memoryAllocation)
              }
              sub={
                isRunning && container.memoryUsage
                  ? `of ${formatMemory(container.memoryAllocation)}`
                  : ''
              }
            />,
            <Muted key="up">{isRunning ? formatDuration(container.startedAt) : '—'}</Muted>,
          ];
        }}
        actions={() => <ChevronRight size={14} className="text-ink-400" aria-hidden />}
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

/** A number with a hairline usage bar underneath — readable at row height. */
function MeterCell({ value, label, sub }: { value: number; label: string; sub: string }) {
  const pct = Math.min(100, Math.max(0, value));
  const fill = pct >= 90 ? 'bg-brand-600' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-600';

  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex items-baseline gap-1">
        <span className="truncate text-xs font-semibold">{label}</span>
        {sub && <span className="truncate text-tiny text-ink-500">{sub}</span>}
      </span>
      <span className="block h-0.75 w-full overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
        <span
          className={`block h-full rounded-full transition-[width] duration-500 ${fill}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}
