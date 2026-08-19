import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Badge } from '../components/DataTable';
import { DetailLayout } from '../components/DetailLayout';
import { Row, Section } from '../components/DetailRow';
import { NetworkTopology } from '../components/NetworkTopology';
import { StatusDot } from '../components/StatusBadge';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useToastStore } from '../store/toastStore';
import { useUIStore } from '../store/uiStore';
import type { Network } from '../types';
import { formatDuration } from '../utils/format';

/**
 * One network, drawn rather than listed. The graph carries the shape of the
 * thing -- hub, members, addresses -- and the column beside it carries the
 * facts a graph is bad at: subnet, driver, labels.
 */
export function NetworkDetailPage({ network }: { network: Network }) {
  const containers = useResourceStore((s) => s.containers);
  const back = useUIStore((s) => s.back);
  const openContainer = useUIStore((s) => s.openContainer);
  const pushToast = useToastStore((s) => s.push);

  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const attached = containers
    .filter((container) => container.networks?.includes(network.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const remove = async () => {
    setDeleting(false);
    setBusy(true);

    try {
      await api.deleteNetwork(network.name);
      pushToast(`Deleted ${network.name}`);
      back();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not delete the network', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DetailLayout
      onBack={back}
      title={network.name}
      badges={
        <>
          {network.builtin && <Badge>built-in</Badge>}
          {!network.ipv4Gateway && <Badge>host-only</Badge>}
        </>
      }
      subtitle={[network.mode, network.ipv4Subnet].filter(Boolean).join(' · ') || 'network'}
      actions={
        <button
          onClick={() => setDeleting(true)}
          disabled={network.builtin || busy}
          className="btn-ghost text-orange-700 disabled:opacity-40 dark:text-orange-500"
          title={network.builtin ? 'The built-in network cannot be deleted' : 'Delete network'}
        >
          <Trash2 size={13} aria-hidden />
          Delete
        </button>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <NetworkTopology
          network={network}
          containers={containers}
          onOpenContainer={openContainer}
        />

        <aside className="-mr-5 flex shrink-0 flex-col gap-5 overflow-y-auto pr-5 lg:w-80">
          <Section title="Addressing">
            <Row label="Subnet" value={network.ipv4Subnet} mono copyable />
            <Row label="Gateway" value={network.ipv4Gateway} mono copyable />
            <Row label="IPv6 subnet" value={network.ipv6Subnet} mono copyable wide />
          </Section>

          <Section title="Network">
            <Row label="Mode" value={network.mode} />
            <Row
              label="Created"
              value={network.createdAt ? `${formatDuration(network.createdAt)} ago` : undefined}
            />
            <Row label="Plugin" value={network.plugin} wide />
          </Section>

          <Section title={`Attached (${attached.length})`} plain>
            {attached.length === 0 ? (
              <p className="text-xs text-ink-600 dark:text-ink-400">
                Nothing is attached yet. Pick this network when you create a container.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {attached.map((container) => {
                  const address = container.interfaces?.find(
                    (iface) => iface.network === network.name
                  )?.ipv4Address;

                  return (
                    <li key={container.id}>
                      <button
                        onClick={() => openContainer(container.id)}
                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-ink-100 dark:hover:bg-ink-800"
                      >
                        <StatusDot status={container.status} />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {container.name}
                        </span>
                        <span className="shrink-0 font-mono text-tiny text-ink-500">
                          {address ?? '—'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {Object.keys(network.labels ?? {}).length > 0 && (
            <Section title="Labels">
              {Object.entries(network.labels).map(([key, value]) => (
                <Row key={key} label={key} value={value} mono wide />
              ))}
            </Section>
          )}
        </aside>
      </div>

      {deleting && (
        <ConfirmDialog
          title={`Delete ${network.name}?`}
          body={
            attached.length > 0
              ? `${attached.map((c) => c.name).join(', ')} are attached to this network and will lose connectivity.`
              : 'Containers can no longer be attached to this network.'
          }
          confirmLabel="Delete"
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(false)}
        />
      )}
    </DetailLayout>
  );
}
