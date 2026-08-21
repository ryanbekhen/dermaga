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
import { useToastStore } from '../store/toastStore';
import { PageHeader } from '../components/PageHeader';
import { useDialog } from '../hooks/useDialog';
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
  const hasLoaded = useResourceStore((s) => s.hasLoaded);
  const searchQuery = useUIStore((s) => s.searchQuery);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const openNetwork = useUIStore((s) => s.openNetwork);
  const pushToast = useToastStore((s) => s.push);

  const creating = useDialog('network.create');
  const [deleting, setDeleting] = useState<Network | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needle = searchQuery.trim().toLowerCase();
  const visible = networks.filter((n) => !needle || n.name.toLowerCase().includes(needle));

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
    <div className="flex min-h-0 flex-1 flex-col gap-3 -mb-4">
      <PageHeader
        title="Networks"
        subtitle="Open one to see what is attached to it"
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search networks…' }}
        actions={
          selected.size > 0 ? (
            <SelectionActions count={selected.size} onClear={() => setSelected(new Set())}>
              <Button
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
            <button onClick={() => creating.show()} className="btn-primary">
              <Plus size={13} aria-hidden />
              New network
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
        empty={networks.length === 0 ? 'No networks yet.' : 'No networks match your search.'}
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
      footer={
        <>
          <button onClick={onClose} className="btn-ghost" disabled={saving}>
            Cancel
          </button>
          <Button
            variant="primary"
            busy={saving}
            busyLabel="Creating…"
            disabled={!name.trim()}
            onClick={() => void submit()}
          >
            Create
          </Button>
        </>
      }
    >
      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="backend"
          autoFocus
          className="input"
        />
      </Field>

      <Field label="Subnet" hint="Optional, e.g. 192.168.80.0/24. The CLI picks one otherwise.">
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
