import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  InUse,
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
import { useValidation } from '../hooks/useValidation';
import { resourceName, size as sizeOf } from '../utils/validate';
import { useUIStore } from '../store/uiStore';
import type { Volume } from '../types';
import { formatBytes } from '../utils/format';

// Where it lives is the column this list was missing. Format and Created had
// one each: the first says "ext4" on every row ever shown, and the second is a
// number nobody sorts a volume list by. Both are in the rail on the volume's
// own page, next to everything else about it.
const COLUMNS: Column[] = [
  { key: 'name', label: 'Name', width: 'minmax(150px,1.3fr)' },
  { key: 'driver', label: 'Driver', width: '92px' },
  { key: 'size', label: 'Size', width: '132px' },
  { key: 'source', label: 'Mountpoint', width: 'minmax(160px,1.5fr)' },
  { key: 'used', label: 'Used by', width: 'minmax(110px,0.9fr)' },
];

export function VolumesPage() {
  const volumes = useResourceStore((s) => s.volumes);
  const hasLoaded = useResourceStore((s) => s.hasLoaded);
  const openVolume = useUIStore((s) => s.openVolume);
  const pushToast = useToastStore((s) => s.push);

  const creating = useDialog('volume.create');
  const [deleting, setDeleting] = useState<Volume | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = volumes;

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
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Volumes"
        subtitle="Open one to see what is inside it"
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
            <button
              onClick={() => creating.show()}
              className="btn-plain-primary"
              title="New volume"
              aria-label="New volume"
            >
              <Plus size={18} aria-hidden />
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
        empty="No volumes yet."
        loading={!hasLoaded}
        cells={(volume) => [
          <NameCell key="name">
            <span className="truncate text-sm font-semibold">{volume.name}</span>
            <InUse by={volume.usedBy} />
          </NameCell>,
          <Muted key="driver">{volume.driver || '—'}</Muted>,
          // What it costs over what it may grow to. A volume is sparse, so the
          // cap on its own has frightened people into deleting a 512 GB volume
          // holding four megabytes.
          <span key="size" className="flex min-w-0 items-baseline gap-1.5 font-mono">
            <span className="truncate text-small">{formatBytes(volume.usedBytes ?? 0)}</span>
            <span className="truncate text-tiny text-ink-500">
              of {formatBytes(volume.sizeInBytes)}
            </span>
          </span>,
          <Muted key="source" mono>
            {volume.source || '—'}
          </Muted>,
          <Muted key="used">
            {volume.usedBy.length > 0 ? volume.usedBy.join(', ') : 'nothing'}
          </Muted>,
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

  const form = useValidation({
    name: resourceName(name, 'A name'),
    size: sizeOf(size, 'A size'),
  });

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
          placeholder="app-data"
          autoFocus
          className="input"
        />
      </Field>

      <Field
        label="Size"
        hint="Optional maximum, e.g. 512M or 10G. Defaults to the CLI's own."
        {...form.field('size')}
      >
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
