import { useState } from 'react';
import { Plus, Trash2, Unplug } from 'lucide-react';
import { Button, IconButton } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Badge } from '../components/DataTable';
import { DetailLayout } from '../components/DetailLayout';
import { Row, Section } from '../components/DetailRow';
import { Modal } from '../components/form';
import { useDialog } from '../hooks/useDialog';
import { NetworkTopology } from '../components/NetworkTopology';
import { StatusDot } from '../components/StatusBadge';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useToastStore } from '../store/toastStore';
import { useUIStore } from '../store/uiStore';
import type { Container, Network } from '../types';
import { formatDuration, shortImage } from '../utils/format';

/**
 * Apple's CLI attaches a container to a network only as it is created -- there
 * is no `network connect`. So attaching and detaching here mean recreating the
 * container from its own spec with the network list changed, which is exactly
 * what the edit form already does when anything else about it changes.
 */
async function setNetworks(id: string, networks: string[]) {
  const spec = await api.getContainerSpec(id);
  await api.updateContainer(id, { ...spec, networks });
}

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
  // Opened here, or asked for on the way in by the command palette.
  const attaching = useDialog('network.attach');
  const detachIntent = useDialog('network.detach');
  const [detaching, setDetaching] = useState<Container | null>(null);
  const [working, setWorking] = useState<string | null>(null);

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

  // The palette names the container it wants detached; the page still asks,
  // because detaching recreates it.
  const detachTarget =
    detaching ?? containers.find((container) => container.id === detachIntent.target) ?? null;

  const closeDetach = () => {
    setDetaching(null);
    detachIntent.close();
  };

  const detach = async (container: Container) => {
    closeDetach();
    setWorking(container.id);

    try {
      await setNetworks(
        container.id,
        (container.networks ?? []).filter((name) => name !== network.name)
      );
      pushToast(`Detached ${container.name} from ${network.name}`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not detach the container', 'error');
    } finally {
      setWorking(null);
    }
  };

  return (
    <DetailLayout
      onBack={back}
      backTo="Networks"
      title={network.name}
      badges={
        <>
          {network.builtin && <Badge>built-in</Badge>}
          {!network.ipv4Gateway && <Badge>host-only</Badge>}
        </>
      }
      subtitle={[network.mode, network.ipv4Subnet].filter(Boolean).join(' · ') || 'network'}
      actions={
        <>
          <button onClick={() => attaching.show()} className="btn-ghost">
            <Plus size={13} aria-hidden />
            Attach container
          </button>
          <button
            onClick={() => setDeleting(true)}
            disabled={network.builtin || busy}
            className="btn-ghost text-orange-700 disabled:opacity-40 dark:text-orange-500"
            title={network.builtin ? 'The built-in network cannot be deleted' : 'Delete network'}
          >
            <Trash2 size={13} aria-hidden />
            Delete
          </button>
        </>
      }
    >
      {/* The scroll belongs to the page below the breakpoint and to the column
          above it. Wide, the map and the facts sit side by side and the facts
          scroll on their own; narrow, they stack into one tall column -- and
          the scroll was on the aside, which by then was no longer the thing
          overflowing, so everything under the fold was simply unreachable. */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-7 py-5 lg:flex-row lg:overflow-hidden">
        <NetworkTopology
          network={network}
          containers={containers}
          onOpenContainer={openContainer}
        />

        <aside className="flex shrink-0 flex-col gap-5 lg:w-80 lg:overflow-y-auto">
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
                    <li key={container.id} className="group flex items-center gap-1">
                      <button
                        onClick={() => openContainer(container.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-ink-100 dark:hover:bg-ink-800"
                      >
                        <StatusDot status={container.status} />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {container.name}
                        </span>
                        <span className="shrink-0 font-mono text-tiny text-ink-500">
                          {address ?? '—'}
                        </span>
                      </button>
                      <IconButton
                        icon={Unplug}
                        busy={working === container.id}
                        className={`border-transparent ${
                          working === container.id
                            ? ''
                            : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                        }`}
                        title={`Detach ${container.name} from ${network.name}`}
                        aria-label={`Detach ${container.name}`}
                        onClick={() => setDetaching(container)}
                      />
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

      {attaching.open && (
        <AttachDialog
          network={network}
          candidates={containers.filter((container) => !container.networks?.includes(network.name))}
          onClose={() => attaching.close()}
        />
      )}

      {detachTarget && (
        <ConfirmDialog
          title={`Detach ${detachTarget.name}?`}
          body={`${detachTarget.name} is stopped, recreated without ${
            network.name
          } and started again${
            (detachTarget.networks ?? []).length > 1
              ? '. Its other networks are kept'
              : ', which leaves it on the built-in default network'
          }. Named volumes survive; anything written to its filesystem does not.`}
          confirmLabel="Detach"
          onConfirm={() => void detach(detachTarget)}
          onCancel={closeDetach}
        />
      )}

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
 * Picks a container to put on this network. Only containers not already on it
 * are offered, so the list is the answer to "what is missing from the picture"
 * rather than a copy of it.
 */
function AttachDialog({
  network,
  candidates,
  onClose,
}: {
  network: Network;
  candidates: Container[];
  onClose: () => void;
}) {
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const attach = async () => {
    const container = candidates.find((c) => c.id === target);
    if (!container) return;

    setBusy(true);

    try {
      await setNetworks(container.id, [...(container.networks ?? []), network.name]);
      pushToast(`Attached ${container.name} to ${network.name}`);
      onClose();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not attach the container', 'error');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Attach a container to ${network.name}`}
      subtitle="Apple’s CLI attaches networks only at creation, so the container is stopped, recreated with the same settings plus this network, and started again. Named volumes survive; anything written to its filesystem does not."
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost" disabled={busy}>
            Cancel
          </button>
          <Button
            variant="primary"
            busy={busy}
            busyLabel="Attaching…"
            disabled={!target}
            onClick={() => void attach()}
          >
            Attach
          </Button>
        </>
      }
    >
      {candidates.length === 0 ? (
        <p className="text-xs text-ink-600 dark:text-ink-400">
          Every container is already on this network.
        </p>
      ) : (
        <ul className="-mx-1 max-h-64 overflow-y-auto">
          {candidates.map((container) => (
            <li key={container.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-ink-100 dark:hover:bg-ink-800">
                <input
                  type="radio"
                  name="attach-target"
                  checked={target === container.id}
                  onChange={() => setTarget(container.id)}
                  className="h-3.5 w-3.5 accent-brand-600"
                />
                <StatusDot status={container.status} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {container.name}
                </span>
                <span className="shrink-0 truncate text-tiny text-ink-500">
                  {shortImage(container.image)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
