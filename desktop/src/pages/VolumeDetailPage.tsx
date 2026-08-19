import { useCallback, useEffect, useState } from 'react';
import { Boxes, FolderTree, Info, RefreshCw, Trash2, UserCog } from 'lucide-react';
import { Badge } from '../components/DataTable';
import { Button } from '../components/Button';
import { Field, Modal } from '../components/form';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DetailGrid, DetailLayout, DetailPane } from '../components/DetailLayout';
import { Row, Section } from '../components/DetailRow';
import { FileBrowser } from '../components/FileBrowser';
import { StatusDot } from '../components/StatusBadge';
import type { TabDefinition } from '../components/Tabs';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useToastStore } from '../store/toastStore';
import { useUIStore } from '../store/uiStore';
import type { Container, ContainerTab, Mount, Volume } from '../types';
import { formatBytes, formatDuration } from '../utils/format';

const TABS: TabDefinition[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'files', label: 'Files', icon: FolderTree },
];

/** Where the helper mounts the volume, and the name it runs under. */
const MOUNT = '/volume';
const helperFor = (volume: string) => `dermaga-peek-${volume}`;
/** Small, and almost certainly already here; pulled once if it is not. */
const HELPER_IMAGE = 'alpine:latest';

export function VolumeDetailPage({ volume }: { volume: Volume }) {
  const containers = useResourceStore((s) => s.containers);
  const back = useUIStore((s) => s.back);
  const openContainer = useUIStore((s) => s.openContainer);
  const pushToast = useToastStore((s) => s.push);

  const [tab, setTab] = useState('overview');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  // Every mount of this volume, with where it lands inside each container --
  // the same volume is often /data in one and /var/lib/postgresql in another.
  const mounts = containers
    .flatMap((container) =>
      container.mounts
        .filter((mount) => mount.type === 'volume' && mount.source === volume.name)
        .map((mount) => ({ container, mount }))
    )
    .sort((a, b) => a.container.name.localeCompare(b.container.name));

  const remove = async () => {
    setDeleting(false);
    setBusy(true);

    try {
      await api.deleteVolume(volume.name);
      pushToast(`Deleted ${volume.name}`);
      back();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not delete the volume', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DetailLayout
      onBack={back}
      title={volume.name}
      subtitle={`${volume.driver || 'local'} · ${volume.format || 'ext4'}`}
      tabs={TABS}
      activeTab={tab}
      onSelectTab={setTab}
      actions={
        <button
          onClick={() => setDeleting(true)}
          disabled={busy}
          className="btn-ghost text-orange-700 disabled:opacity-40 dark:text-orange-500"
          title="Delete volume"
        >
          <Trash2 size={13} aria-hidden />
          Delete
        </button>
      }
    >
      {tab === 'files' ? (
        <DetailPane>
          <VolumeFiles volume={volume.name} mounts={mounts} onOpenIn={openContainer} />
        </DetailPane>
      ) : (
        <DetailGrid>
          <Section title="Volume">
            <Row label="Driver" value={volume.driver} />
            <Row label="Format" value={volume.format} />
            {/* The cap is what it was created with -- half a terabyte, usually.
                What it costs is the blocks the image actually occupies. */}
            <Row label="On disk" value={formatBytes(volume.usedBytes ?? 0)} />
            <Row label="Maximum size" value={formatBytes(volume.sizeInBytes)} />
            <Row
              label="Created"
              value={volume.createdAt ? `${formatDuration(volume.createdAt)} ago` : '—'}
            />
            <Row label="Image" value={volume.source} mono copyable wide />
          </Section>

          <Section title="Permissions" plain>
            <VolumeOwner
              volume={volume.name}
              held={mounts.some(({ container }) => container.status === 'running')}
            />
          </Section>

          <Section title={`Mounted by (${mounts.length})`} plain>
            {mounts.length === 0 ? (
              <p className="text-xs text-ink-600 dark:text-ink-400">
                No container mounts this volume. It keeps whatever is in it either way.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {mounts.map(({ container, mount }) => (
                  <li key={`${container.id}-${mount.destination}`}>
                    <button
                      onClick={() => openContainer(container.id)}
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-ink-100 dark:hover:bg-ink-800"
                    >
                      <StatusDot status={container.status} />
                      <span className="min-w-0 shrink-0 truncate text-xs font-medium">
                        {container.name}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-right font-mono text-tiny text-ink-500">
                        {mount.destination}
                        {mount.readOnly ? ' · ro' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {Object.keys(volume.labels ?? {}).length > 0 && (
            <Section title="Labels">
              {Object.entries(volume.labels).map(([key, value]) => (
                <Row key={key} label={key} value={value} mono wide />
              ))}
            </Section>
          )}
        </DetailGrid>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${volume.name}?`}
          body={
            mounts.length > 0
              ? `${mounts.map(({ container }) => container.name).join(', ')} mount this volume. Everything in it goes with it.`
              : 'Everything in it goes with it. This cannot be undone.'
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
 * Who owns the volume, and a way to hand it to somebody else.
 *
 * This is the answer to most "permission denied" in a container that has a
 * volume: a volume is born owned by root, while the official images run as
 * somebody else -- redis as 999, postgres as 999 -- so the first thing they try
 * to write fails, with an error that never mentions the word volume.
 */
function VolumeOwner({ volume, held }: { volume: string; held: boolean }) {
  const [owner, setOwner] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'reading' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  const read = useCallback(async () => {
    setState('reading');
    setError(null);

    try {
      setOwner(await api.getVolumeOwner(volume));
      setState('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the owner');
      setState('failed');
    }
  }, [volume]);

  // Free when a running container already has the volume: the agent asks that
  // container. Otherwise it costs a helper, so it waits to be asked.
  useEffect(() => {
    // The read is a request, not a render: the effect starts it and the answer
    // lands later, which is the case this rule is not about.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (held) void read();
  }, [held, read]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-tiny text-ink-500">Owner</span>
        <span className="font-mono text-xs">
          {owner ?? (state === 'reading' ? 'reading…' : 'not checked')}
        </span>
        {owner === '0:0' && <Badge>root</Badge>}

        <span className="ml-auto flex items-center gap-2">
          {!held && (
            <Button
              icon={RefreshCw}
              busy={state === 'reading'}
              busyLabel="Checking…"
              onClick={() => void read()}
            >
              {owner ? 'Check again' : 'Check'}
            </Button>
          )}
          <Button icon={UserCog} onClick={() => setChanging(true)}>
            Set owner…
          </Button>
        </span>
      </div>

      {error && <p className="text-xs text-orange-700 dark:text-orange-500">{error}</p>}

      <p className="text-tiny leading-relaxed text-ink-600 dark:text-ink-400">
        {owner === '0:0'
          ? 'Owned by root. An image that runs as anyone else — redis and postgres both run as 999 — cannot write here, and says only “permission denied”.'
          : 'A volume starts out owned by root, while most database images run as somebody else. If one cannot write to this volume, this is usually why.'}
        {!held && ' Checking starts a small container for a moment.'}
      </p>

      {changing && (
        <SetOwnerDialog
          volume={volume}
          current={owner}
          onClose={() => setChanging(false)}
          onChanged={setOwner}
        />
      )}
    </>
  );
}

/** Hands the whole volume to a uid, recursively, and says what it cost. */
function SetOwnerDialog({
  volume,
  current,
  onClose,
  onChanged,
}: {
  volume: string;
  current: string | null;
  onClose: () => void;
  onChanged: (owner: string) => void;
}) {
  const [owner, setOwner] = useState(current && current !== '0:0' ? current : '999:999');
  const [busy, setBusy] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  // The same shape the agent will accept; catching it here saves a round trip
  // and explains itself in place.
  const valid = /^\d+(:\d+)?$/.test(owner.trim());

  const apply = async () => {
    setBusy(true);

    try {
      const applied = await api.setVolumeOwner(volume, owner.trim());
      onChanged(applied);
      pushToast(`${volume} now belongs to ${applied}`);
      onClose();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not set the owner', 'error');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Set the owner of ${volume}`}
      subtitle="Applied to everything in the volume. Run it against the user the image runs as — redis and postgres are both 999 — and the container can write again."
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost" disabled={busy}>
            Cancel
          </button>
          <Button
            variant="primary"
            busy={busy}
            busyLabel="Applying…"
            disabled={!valid}
            onClick={() => void apply()}
          >
            Set owner
          </Button>
        </>
      }
    >
      <Field
        label="Owner"
        hint={
          valid
            ? 'A user id, or user:group. Find one with: container run --rm <image> id -u <name>'
            : 'Numbers only — a uid, or uid:gid. Names are not resolvable from outside the image.'
        }
      >
        <input
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
          placeholder="999:999"
          autoFocus
          className="input font-mono"
        />
      </Field>

      {current && (
        <p className="text-tiny text-ink-600 dark:text-ink-400">
          Currently <span className="font-mono">{current}</span>.
        </p>
      )}
    </Modal>
  );
}

/**
 * What is actually inside the volume.
 *
 * A volume here is an ext4 image, not a folder on the Mac, so there is nothing
 * to open in Finder and nothing to read without a Linux kernel. The way in is
 * to mount it into a container and look from there.
 *
 * Only one running VM may hold a disk image at a time -- attaching a second
 * one, even read-only, is refused by the virtualisation framework. So when a
 * running container already has it, that container is the way in and this
 * points at it; a helper is conjured only when nothing else can see the
 * volume, and it does not outlive the tab.
 */
function VolumeFiles({
  volume,
  mounts,
  onOpenIn,
}: {
  volume: string;
  mounts: { container: Container; mount: Mount }[];
  onOpenIn: (id: string, tab: ContainerTab, path: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'starting' | 'ready' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const helper = helperFor(volume);

  // Our own helper does not count as something in the way of browsing.
  const holder = mounts.find(
    ({ container }) => container.status === 'running' && container.name !== helper
  );

  // Whatever happens, the helper does not outlive this tab.
  useEffect(() => {
    return () => {
      void api.removeContainer(helper, true).catch(() => {
        // It may never have started; nothing to tidy up then.
      });
    };
  }, [helper]);

  const open = async () => {
    setState('starting');
    setError(null);

    // A helper left behind by a crash would collide on the name, so the slate
    // is wiped first rather than trusted.
    await api.removeContainer(helper, true).catch(() => {});

    try {
      await api.runContainer({
        name: helper,
        image: HELPER_IMAGE,
        command: ['sleep', '86400'],
        mounts: [{ type: 'volume', source: volume, target: MOUNT }],
        removeOnExit: true,
      });
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the helper container');
      setState('failed');
    }
  };

  if (state === 'ready') {
    return (
      <>
        <p className="pb-2 text-tiny text-ink-600 dark:text-ink-400">
          Browsing through <span className="font-mono">{helper}</span>, a helper container holding
          the volume at <span className="font-mono">{MOUNT}</span>. It is removed when you leave.
        </p>
        <FileBrowser container={helper} running root={MOUNT} rootLabel={volume} />
      </>
    );
  }

  if (holder) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="flex max-w-md flex-col gap-1.5">
          <p className="text-sm font-semibold">{holder.container.name} has this volume open</p>
          <p className="text-xs text-ink-600 dark:text-ink-400">
            A disk image can only be attached to one running container at a time, so the way in is
            through that container — where the same files are at{' '}
            <span className="font-mono">{holder.mount.destination}</span>. Stop it if you would
            rather browse the volume on its own.
          </p>
        </div>

        <button
          onClick={() => onOpenIn(holder.container.id, 'files', holder.mount.destination)}
          className="btn-primary"
        >
          <FolderTree size={13} aria-hidden />
          Browse in {holder.container.name}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="flex max-w-md flex-col gap-1.5">
        <p className="text-sm font-semibold">Look inside this volume</p>
        <p className="text-xs text-ink-600 dark:text-ink-400">
          A volume is an ext4 disk image rather than a folder, so it can only be read from inside a
          container. Dermaga starts a small one — {HELPER_IMAGE}, mounted at {MOUNT} — and removes
          it again when you leave this tab.
        </p>
        {error && <p className="text-xs text-orange-700 dark:text-orange-500">{error}</p>}
      </div>

      <button onClick={() => void open()} className="btn-primary" disabled={state === 'starting'}>
        <Boxes size={13} aria-hidden />
        {state === 'starting' ? 'Starting…' : 'Browse'}
      </button>
    </div>
  );
}
