import { useState, type ReactNode } from 'react';
import { Check, Copy, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Badge } from '../components/DataTable';
import { DetailLayout } from '../components/DetailLayout';
import { Section } from '../components/DetailRow';
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
            <Facts>
              <Fact label="Subnet" value={network.ipv4Subnet} mono copyable />
              <Fact label="Gateway" value={network.ipv4Gateway} mono copyable />
              <Fact label="IPv6 subnet" value={network.ipv6Subnet} mono copyable wide />
            </Facts>
          </Section>

          <Section title="Network">
            <Facts>
              <Fact label="Mode" value={network.mode} />
              <Fact
                label="Created"
                value={network.createdAt ? `${formatDuration(network.createdAt)} ago` : undefined}
              />
              <Fact label="Plugin" value={network.plugin} wide />
            </Facts>
          </Section>

          <Section title={`Attached (${attached.length})`}>
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
              <Facts>
                {Object.entries(network.labels).map(([key, value]) => (
                  <Fact key={key} label={key} value={value} mono wide />
                ))}
              </Facts>
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

/**
 * Facts in this column are addresses, and an address that has been cut short is
 * worse than no address at all -- it looks like a value rather than reading as
 * one. So the label sits above its value and the value wraps rather than
 * truncating: every column is the same width, everything aligns on one left
 * edge, and an IPv6 prefix is shown whole.
 */
function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</dl>;
}

function Fact({
  label,
  value,
  mono = false,
  copyable = false,
  /** Spans both columns -- for the values no half-width column can hold. */
  wide = false,
}: {
  label: string;
  value?: string | number | null;
  mono?: boolean;
  copyable?: boolean;
  wide?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const text = value === undefined || value === null || value === '' ? '—' : String(value);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard access can be denied; the value is still selectable.
    }
  };

  return (
    <div className={`group flex min-w-0 flex-col gap-0.5 ${wide ? 'col-span-2' : ''}`}>
      <dt className="truncate text-tiny text-ink-500" title={label}>
        {label}
      </dt>
      <dd className="flex items-start gap-1">
        <span
          className={`selectable min-w-0 break-all leading-snug text-ink-800 dark:text-ink-100 ${
            mono ? 'font-mono text-xs' : 'text-xs'
          }`}
        >
          {text}
        </span>
        {copyable && text !== '—' && (
          <button
            onClick={() => void copy()}
            className="mt-0.5 shrink-0 text-ink-400 opacity-0 transition-opacity hover:text-brand-600 focus-visible:opacity-100 group-hover:opacity-100"
            title={`Copy ${label}`}
            aria-label={`Copy ${label}`}
          >
            {copied ? (
              <Check size={12} className="text-emerald-600" aria-hidden />
            ) : (
              <Copy size={12} aria-hidden />
            )}
          </button>
        )}
      </dd>
    </div>
  );
}
