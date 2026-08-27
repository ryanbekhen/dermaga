import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  Badge,
  DataTable,
  Muted,
  NameCell,
  SelectionActions,
  type Column,
} from '../components/DataTable';
import { Checkbox, Field, Modal } from '../components/form';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useActiveProject } from '../hooks/useActiveProject';
import { networkInProject } from '../utils/projects';
import { useToastStore } from '../store/toastStore';
import { PageHeader } from '../components/PageHeader';
import { useDialog } from '../hooks/useDialog';
import { useValidation } from '../hooks/useValidation';
import { resourceName, subnet as subnetOf } from '../utils/validate';
import { useUIStore } from '../store/uiStore';
import type { Network } from '../types';
import { formatDuration } from '../utils/format';

const COLUMNS: Column[] = [
  { key: 'name', label: 'Name', width: 'minmax(140px,1.2fr)' },
  { key: 'mode', label: 'Mode', width: '88px' },
  { key: 'subnet', label: 'Subnet', width: '152px' },
  { key: 'gateway', label: 'Gateway', width: '140px' },
  { key: 'used', label: 'Containers', width: '92px', align: 'right' },
  { key: 'created', label: 'Created', width: '80px', align: 'right' },
];

export function NetworksPage() {
  const networks = useResourceStore((s) => s.networks);
  const containers = useResourceStore((s) => s.containers);
  const activeProject = useActiveProject();
  const hasLoaded = useResourceStore((s) => s.hasLoaded);
  const openNetwork = useUIStore((s) => s.openNetwork);
  const pushToast = useToastStore((s) => s.push);

  const creating = useDialog('network.create');
  const [deleting, setDeleting] = useState<Network | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Not read off what is attached: a network made for a project says so in a
  // label, and the built-in one belongs to no project at all. See
  // networkInProject.
  const visible = networks.filter((network) =>
    networkInProject(network, containers, activeProject)
  );

  const remove = async (network: Network) => {
    setDeleting(null);
    setRemoving(network.name);
    try {
      await api.deleteNetwork(network.name);
      pushToast(`Deleted ${network.name}`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not delete the network', 'error');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Networks"
        subtitle="Open one to see what is attached to it"
        actions={
          selected.size > 0 ? (
            <SelectionActions count={selected.size} onClear={() => setSelected(new Set())}>
              <Button
                iconOnly
                icon={Trash2}
                busy={busy}
                busyLabel="Deleting…"
                className="text-orange-700 dark:text-orange-500"
                onClick={() => setBulkDeleting(true)}
              >
                Delete
              </Button>
            </SelectionActions>
          ) : (
            <button
              onClick={() => creating.show()}
              className="btn-plain-primary"
              title="New network"
              aria-label="New network"
            >
              <Plus size={18} aria-hidden />
            </button>
          )
        }
      />

      <DataTable
        columns={COLUMNS}
        rows={visible}
        rowKey={(network) => network.name}
        selection={{ selected, onChange: setSelected }}
        onOpen={(network) => openNetwork(network.name)}
        empty="No networks yet."
        loading={!hasLoaded}
        cells={(network) => [
          <NameCell key="name">
            <span className="truncate text-sm font-semibold">{network.name}</span>
            {network.builtin && <Badge>built-in</Badge>}
          </NameCell>,
          <Muted key="mode">{network.mode || '—'}</Muted>,
          <Muted key="subnet" mono>
            {network.ipv4Subnet || '—'}
          </Muted>,
          <Muted key="gateway" mono>
            {network.ipv4Gateway || '—'}
          </Muted>,
          <Muted key="used">{network.usedBy.length || '—'}</Muted>,
          <Muted key="created">
            {network.createdAt ? formatDuration(network.createdAt) : '—'}
          </Muted>,
        ]}
        actions={(network) => (
          <IconButton
            icon={Trash2}
            busy={removing === network.name}
            disabled={network.builtin}
            className={`border-transparent text-orange-700 dark:text-orange-500 ${
              removing === network.name
                ? ''
                : 'opacity-0 disabled:opacity-0 group-hover:opacity-100 disabled:group-hover:opacity-30'
            }`}
            title={network.builtin ? 'The built-in network cannot be deleted' : 'Delete network'}
            aria-label={`Delete ${network.name}`}
            onClick={() => setDeleting(network)}
          />
        )}
      />

      {bulkDeleting && (
        <ConfirmDialog
          title={`Delete ${selected.size} network${selected.size === 1 ? '' : 's'}?`}
          body="Containers attached to them lose connectivity. Built-in networks are skipped."
          confirmLabel="Delete"
          onConfirm={() => {
            setBulkDeleting(false);
            void (async () => {
              setBusy(true);
              const failed: string[] = [];
              // The built-in network cannot be removed; skip rather than fail.
              for (const network of networks.filter((n) => selected.has(n.name) && !n.builtin)) {
                try {
                  await api.deleteNetwork(network.name);
                } catch {
                  failed.push(network.name);
                }
              }
              setBusy(false);
              setSelected(new Set());
              pushToast(
                failed.length > 0 ? `Could not delete ${failed.join(', ')}` : 'Networks deleted',
                failed.length > 0 ? 'error' : 'success'
              );
            })();
          }}
          onCancel={() => setBulkDeleting(false)}
        />
      )}

      {creating.open && <CreateNetworkDialog onClose={() => creating.close()} />}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body={
            deleting.usedBy.length > 0
              ? `${deleting.usedBy.join(', ')} are attached to this network and will lose connectivity.`
              : 'Containers can no longer be attached to this network.'
          }
          confirmLabel="Delete"
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function CreateNetworkDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [subnet, setSubnet] = useState('');
  const [internal, setInternal] = useState(false);
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const form = useValidation({
    name: resourceName(name, 'A name'),
    subnet: subnetOf(subnet),
  });

  const submit = async () => {
    setSaving(true);
    try {
      await api.createNetwork({
        name: name.trim(),
        subnet: subnet.trim() || undefined,
        internal,
      });
      pushToast(`Created ${name.trim()}`);
      onClose();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not create the network', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="New network"
      onClose={onClose}
      onSubmit={() => form.attempt(() => void submit())}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost" disabled={saving}>
            Cancel
          </button>
          <Button
            variant="primary"
            busy={saving}
            busyLabel="Creating…"
            disabled={!form.valid}
            onClick={() => void submit()}
          >
            Create
          </Button>
        </>
      }
    >
      <Field label="Name" {...form.field('name')}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="backend"
          autoFocus
          className="input"
        />
      </Field>

      <Field
        label="Subnet"
        hint="Optional, e.g. 192.168.80.0/24. The CLI picks one otherwise."
        {...form.field('subnet')}
      >
        <input
          value={subnet}
          onChange={(e) => setSubnet(e.target.value)}
          placeholder="192.168.80.0/24"
          className="input"
        />
      </Field>

      <Checkbox checked={internal} onChange={setInternal} label="Host-only — no outbound access" />
    </Modal>
  );
}
