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
import { Field, Modal } from '../components/form';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useToastStore } from '../store/toastStore';
import { PageHeader } from '../components/PageHeader';
import { useDialog } from '../hooks/useDialog';
import { useUIStore } from '../store/uiStore';
import type { Volume } from '../types';
import { formatBytes, formatDuration } from '../utils/format';

const COLUMNS: Column[] = [
  { key: 'name', label: 'Name', width: 'minmax(160px,1.4fr)' },
  { key: 'driver', label: 'Driver', width: '96px' },
  { key: 'format', label: 'Format', width: '88px' },
  { key: 'used', label: 'Containers', width: '92px', align: 'right' },
  { key: 'disk', label: 'On disk', width: '96px', align: 'right' },
  { key: 'size', label: 'Max size', width: '96px', align: 'right' },
  { key: 'created', label: 'Created', width: '80px', align: 'right' },
];

export function VolumesPage() {
  const volumes = useResourceStore((s) => s.volumes);
  const hasLoaded = useResourceStore((s) => s.hasLoaded);
  const searchQuery = useUIStore((s) => s.searchQuery);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const openVolume = useUIStore((s) => s.openVolume);
  const pushToast = useToastStore((s) => s.push);

  const creating = useDialog('volume.create');
  const [deleting, setDeleting] = useState<Volume | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needle = searchQuery.trim().toLowerCase();
  const visible = volumes.filter((v) => !needle || v.name.toLowerCase().includes(needle));

  const remove = async (volume: Volume) => {
    setDeleting(null);
    setRemoving(volume.name);
    try {
      await api.deleteVolume(volume.name);
      pushToast(`Deleted ${volume.name}`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not delete the volume', 'error');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 -mb-4">
      <PageHeader
        title="Volumes"
        subtitle="Open one to see what is inside it"
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search volumes…' }}
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
              New volume
            </button>
          )
        }
      />

      <DataTable
        columns={COLUMNS}
        rows={visible}
        rowKey={(volume) => volume.name}
        selection={{ selected, onChange: setSelected }}
        onOpen={(volume) => openVolume(volume.name)}
        empty={volumes.length === 0 ? 'No volumes yet.' : 'No volumes match your search.'}
        loading={!hasLoaded}
        cells={(volume) => [
          <NameCell key="name">
            <span className="truncate text-sm font-semibold">{volume.name}</span>
            {volume.usedBy.length > 0 && <Badge tone="brand">in use</Badge>}
          </NameCell>,
          <Muted key="driver">{volume.driver || '—'}</Muted>,
          <Muted key="format">{volume.format || '—'}</Muted>,
          <Muted key="used">{volume.usedBy.length || '—'}</Muted>,
          <Muted key="disk">{formatBytes(volume.usedBytes ?? 0)}</Muted>,
          <Muted key="size">{formatBytes(volume.sizeInBytes)}</Muted>,
          <Muted key="created">{volume.createdAt ? formatDuration(volume.createdAt) : '—'}</Muted>,
        ]}
        actions={(volume) => (
          <IconButton
            icon={Trash2}
            busy={removing === volume.name}
            className={`border-transparent text-orange-700 dark:text-orange-500 ${
              removing === volume.name ? '' : 'opacity-0 group-hover:opacity-100'
            }`}
            title="Delete volume"
            aria-label={`Delete ${volume.name}`}
            onClick={() => setDeleting(volume)}
          />
        )}
      />

      {bulkDeleting && (
        <ConfirmDialog
          title={`Delete ${selected.size} volume${selected.size === 1 ? '' : 's'}?`}
          body={`Everything stored in ${[...selected].join(', ')} is deleted permanently.`}
          confirmLabel="Delete"
          onConfirm={() => {
            setBulkDeleting(false);
            void (async () => {
              setBusy(true);
              const failed: string[] = [];
              for (const name of selected) {
                try {
                  await api.deleteVolume(name);
                } catch {
                  failed.push(name);
                }
              }
              setBusy(false);
              setSelected(new Set());
              pushToast(
                failed.length > 0 ? `Could not delete ${failed.join(', ')}` : 'Volumes deleted',
                failed.length > 0 ? 'error' : 'success'
              );
            })();
          }}
          onCancel={() => setBulkDeleting(false)}
        />
      )}

      {creating.open && <CreateVolumeDialog onClose={() => creating.close()} />}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body={
            deleting.usedBy.length > 0
              ? `${deleting.usedBy.join(', ')} still mount this volume. Everything stored in it is deleted permanently.`
              : 'Everything stored in this volume is deleted permanently.'
          }
          confirmLabel="Delete"
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function CreateVolumeDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [size, setSize] = useState('');
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const submit = async () => {
    setSaving(true);
    try {
      await api.createVolume({ name: name.trim(), size: size.trim() || undefined });
      pushToast(`Created ${name.trim()}`);
      onClose();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not create the volume', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="New volume"
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
          placeholder="app-data"
          autoFocus
          className="input"
        />
      </Field>

      <Field label="Size" hint="Optional maximum, e.g. 512M or 10G. Defaults to the CLI's own.">
        <input
          value={size}
          onChange={(e) => setSize(e.target.value)}
          placeholder="10G"
          className="input"
        />
      </Field>
    </Modal>
  );
}
