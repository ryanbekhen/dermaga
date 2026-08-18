import { useEffect, useMemo, useState } from 'react';
import { Download, FolderOpen, Hammer, ShieldCheck, Trash2 } from 'lucide-react';
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
import { TaskRows, runTask } from '../components/TaskRows';
import { api } from '../services/api';
import { pickDirectory } from '../services/ipc';
import { useResourceStore } from '../store/resourceStore';
import { useScannerStore } from '../store/scannerStore';
import { useToastStore } from '../store/toastStore';
import { PageHeader } from '../components/PageHeader';
import { useUIStore } from '../store/uiStore';
import type { BuildSpec, Image } from '../types';
import { formatBytes, formatDuration, shortDigest } from '../utils/format';

/**
 * One physical image, however many references point at it. `redis:8.10` and
 * `redis:latest` share a digest, so they belong on one row rather than looking
 * like two separate downloads.
 */
interface ImageGroup {
  digest: string;
  names: string[];
  tags: { tag: string; reference: string }[];
  platforms: string[];
  createdAt: string;
  sizeInBytes: number;
}

function groupByDigest(images: Image[]): ImageGroup[] {
  const groups = new Map<string, ImageGroup>();

  for (const image of images) {
    // Without a digest there is nothing to merge on; keep the reference alone.
    const key = image.digest || image.reference;
    const group = groups.get(key);

    if (!group) {
      groups.set(key, {
        digest: image.digest,
        names: [image.name],
        tags: [{ tag: image.tag, reference: image.reference }],
        platforms: [...image.platforms],
        createdAt: image.createdAt,
        sizeInBytes: image.sizeInBytes,
      });
      continue;
    }

    if (!group.names.includes(image.name)) group.names.push(image.name);
    group.tags.push({ tag: image.tag, reference: image.reference });
    for (const platform of image.platforms) {
      if (!group.platforms.includes(platform)) group.platforms.push(platform);
    }
  }

  for (const group of groups.values()) {
    // "latest" first, then the rest alphabetically -- the version you reach for.
    group.tags.sort((a, b) =>
      a.tag === 'latest' ? -1 : b.tag === 'latest' ? 1 : a.tag.localeCompare(b.tag)
    );
  }

  return [...groups.values()].sort((a, b) => a.names[0].localeCompare(b.names[0]));
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Repository', width: 'minmax(160px,1.6fr)' },
  { key: 'tags', label: 'Tags', width: 'minmax(120px,1fr)' },
  { key: 'vulnerabilities', label: 'Vulnerabilities', width: '132px' },
  { key: 'digest', label: 'Digest', width: '116px' },
  { key: 'platform', label: 'Platform', width: '124px' },
  { key: 'size', label: 'Size', width: '84px', align: 'right' },
  { key: 'built', label: 'Built', width: '72px', align: 'right' },
];

export function ImagesPage() {
  const images = useResourceStore((s) => s.images);
  const containers = useResourceStore((s) => s.containers);
  const searchQuery = useUIStore((s) => s.searchQuery);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const openImage = useUIStore((s) => s.openImage);
  const pushToast = useToastStore((s) => s.push);

  const [pulling, setPulling] = useState(false);
  const [building, setBuilding] = useState(false);
  const [deleting, setDeleting] = useState<ImageGroup | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => groupByDigest(images), [images]);

  const needle = searchQuery.trim().toLowerCase();
  const visible = groups.filter(
    (group) =>
      !needle ||
      group.names.some((n) => n.toLowerCase().includes(needle)) ||
      group.tags.some((t) => t.reference.toLowerCase().includes(needle))
  );

  const totalSize = groups.reduce((sum, g) => sum + g.sizeInBytes, 0);

  const usersOf = (group: ImageGroup) =>
    containers.filter((c) => group.tags.some((t) => t.reference === c.image)).map((c) => c.name);

  const remove = async (group: ImageGroup) => {
    setDeleting(null);
    setRemoving(group.digest);

    // Every reference in the group points at the same image; removing one tag
    // would leave the others behind, so the row action removes them all.
    const failures: string[] = [];
    for (const { reference } of group.tags) {
      try {
        await api.deleteImage(reference);
      } catch {
        failures.push(reference);
      }
    }

    setRemoving(null);

    if (failures.length > 0) {
      pushToast(`Could not delete ${failures.join(', ')}`, 'error');
    } else {
      pushToast(`Deleted ${group.names[0]}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <PageHeader
        title="Images"
        subtitle={`${groups.length} image${groups.length === 1 ? '' : 's'}${
          images.length !== groups.length ? ` · ${images.length} references` : ''
        } · ${formatBytes(totalSize)}`}
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search images…' }}
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
            <>
              <button onClick={() => setBuilding(true)} className="btn-ghost">
                <Hammer size={13} aria-hidden />
                Build
              </button>
              <button onClick={() => setPulling(true)} className="btn-primary">
                <Download size={13} aria-hidden />
                Pull image
              </button>
            </>
          )
        }
      />

      <TaskRows kind="image" />

      <DataTable
        columns={COLUMNS}
        rows={visible}
        rowKey={(group) => group.digest}
        onOpen={(group) => openImage(group.tags[0].reference)}
        selection={{ selected, onChange: setSelected }}
        empty={
          images.length === 0
            ? 'No images yet. Pull one to get started.'
            : 'No images match your search.'
        }
        cells={(group) => {
          const users = usersOf(group);

          return [
            <NameCell key="name">
              <span className="truncate text-sm font-semibold">{group.names.join(', ')}</span>
              {users.length > 0 && <Badge tone="brand">in use</Badge>}
            </NameCell>,
            <div key="tags" className="flex flex-wrap items-center gap-1">
              {group.tags.map(({ tag }) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>,
            <VulnerabilityCell key="vulnerabilities" group={group} />,
            <Muted key="digest" mono>
              {shortDigest(group.digest)}
            </Muted>,
            <Muted key="platform">{group.platforms.join(', ') || '—'}</Muted>,
            <Muted key="size">{formatBytes(group.sizeInBytes)}</Muted>,
            <Muted key="built">{group.createdAt ? formatDuration(group.createdAt) : '—'}</Muted>,
          ];
        }}
        actions={(group) => (
          <IconButton
            icon={Trash2}
            busy={removing === group.digest}
            className={`border-transparent text-orange-700 dark:text-orange-500 ${
              removing === group.digest ? '' : 'opacity-0 group-hover:opacity-100'
            }`}
            title={group.tags.length > 1 ? `Delete all ${group.tags.length} references` : 'Delete'}
            aria-label={`Delete ${group.names[0]}`}
            onClick={() => setDeleting(group)}
          />
        )}
      />

      {bulkDeleting && (
        <ConfirmDialog
          title={`Delete ${selected.size} image${selected.size === 1 ? '' : 's'}?`}
          body={`Every reference to ${visible
            .filter((g) => selected.has(g.digest))
            .map((g) => g.names[0])
            .join(', ')} is removed. They have to be pulled again to use.`}
          confirmLabel="Delete"
          onConfirm={() => {
            setBulkDeleting(false);
            void (async () => {
              setBusy(true);
              const failed: string[] = [];
              for (const group of groups.filter((g) => selected.has(g.digest))) {
                for (const { reference } of group.tags) {
                  try {
                    await api.deleteImage(reference);
                  } catch {
                    failed.push(reference);
                  }
                }
              }
              setBusy(false);
              setSelected(new Set());
              pushToast(
                failed.length > 0 ? `Could not delete ${failed.join(', ')}` : 'Images deleted',
                failed.length > 0 ? 'error' : 'success'
              );
            })();
          }}
          onCancel={() => setBulkDeleting(false)}
        />
      )}

      {pulling && <PullDialog onClose={() => setPulling(false)} />}

      {building && <BuildDialog onClose={() => setBuilding(false)} />}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.names[0]}?`}
          body={[
            deleting.tags.length > 1
              ? `All ${deleting.tags.length} references share this image and will be removed: ${deleting.tags
                  .map((t) => t.reference)
                  .join(', ')}.`
              : 'The image will have to be pulled again to use it.',
            usersOf(deleting).length > 0
              ? `It is used by ${usersOf(deleting).join(', ')}, which keeps running but cannot be recreated without pulling it again.`
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
          confirmLabel="Delete"
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

// Counts at a glance, worst first. Only the severities that matter get colour:
// four coloured numbers in every row would be noise rather than a signal.
const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: 'text-brand-700 dark:text-brand-400',
  HIGH: 'text-brand-600 dark:text-brand-400',
  MEDIUM: 'text-amber-700 dark:text-amber-500',
  LOW: 'text-ink-500',
};

/**
 * The severity counts for a row, from whichever of its tags has been scanned --
 * they share a digest, so they share an answer.
 */
function VulnerabilityCell({ group }: { group: ImageGroup }) {
  const reports = useScannerStore((s) => s.reports);
  const scanning = useScannerStore((s) => s.status?.state === 'scanning');

  const report = group.tags.map((t) => reports[t.reference]).find(Boolean);

  if (!report) {
    return <Muted>{scanning ? 'scanning…' : '—'}</Muted>;
  }

  const counts = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].filter((s) => report.summary?.[s]);

  if (counts.length === 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-500">
        <ShieldCheck size={12} aria-hidden />
        clean
      </span>
    );
  }

  return (
    <span
      className="flex items-center gap-1.5 text-xs tabular-nums"
      title={counts.map((s) => `${report.summary[s]} ${s.toLowerCase()}`).join(', ')}
    >
      {counts.map((severity) => (
        <span key={severity} className={`font-semibold ${SEVERITY_TONE[severity]}`}>
          {report.summary[severity]}
          <span className="ml-px text-tiny font-normal opacity-60">{severity[0]}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Builds an image from a Dockerfile. The context directory is the only thing
 * required; everything else maps to a flag the CLI already understands.
 */
function BuildDialog({ onClose }: { onClose: () => void }) {
  const [context, setContext] = useState('');
  const [dockerfile, setDockerfile] = useState('');
  const [tag, setTag] = useState('');
  const [target, setTarget] = useState('');
  const [buildArgs, setBuildArgs] = useState('');
  const [noCache, setNoCache] = useState(false);

  // Builds run inside a buildkit container that does not exist until something
  // starts it. Knowing up front means the first build can start it rather than
  // failing with an error about a container the user never asked for.
  const [builderRunning, setBuilderRunning] = useState<boolean | null>(null);

  useEffect(() => {
    void api
      .getBuilder()
      .then((status) => setBuilderRunning(status.running))
      .catch(() => setBuilderRunning(null));
  }, []);

  const choose = async () => {
    const chosen = await pickDirectory('Choose the build context');
    if (chosen) setContext(chosen);
  };

  const build = () => {
    const folder = context.replace(/\/+$/, '').split('/').pop() || 'image';
    const name = tag.trim() || folder;

    const spec: BuildSpec = {
      context,
      dockerfile: dockerfile.trim() || undefined,
      tag: tag.trim() || undefined,
      target: target.trim() || undefined,
      buildArgs: buildArgs
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      noCache,
    };

    onClose();

    const start = () =>
      void runTask({
        id: `build:${name}`,
        kind: 'image',
        label: name,
        method: 'images.build',
        params: spec,
      });

    if (builderRunning === false) {
      // Same row, two steps: the user asked for a build, not for a lesson in
      // how the runtime builds things.
      void runTask({
        id: `build:${name}`,
        kind: 'image',
        label: name,
        method: 'images.startBuilder',
        params: undefined,
        onDone: (failed) => {
          if (!failed) start();
        },
      });
      return;
    }

    start();
  };

  return (
    <Modal
      title="Build image"
      subtitle="Progress appears in the list; you can keep working while it builds."
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button onClick={build} className="btn-primary" disabled={!context.trim()}>
            Build
          </button>
        </>
      }
    >
      <Field label="Context" hint="The folder COPY and ADD paths are resolved from.">
        <div className="flex gap-2">
          <input
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="/Users/you/projects/api"
            autoFocus
            className="input flex-1"
          />
          <button onClick={() => void choose()} className="btn-ghost shrink-0">
            <FolderOpen size={13} aria-hidden />
            Choose…
          </button>
        </div>
      </Field>

      <Field label="Tag" hint="Names the result, for example api:dev. Optional.">
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="api:dev"
          className="input"
        />
      </Field>

      <Field label="Dockerfile" hint="Relative to the context. Defaults to ./Dockerfile.">
        <input
          value={dockerfile}
          onChange={(e) => setDockerfile(e.target.value)}
          placeholder="Dockerfile"
          className="input"
        />
      </Field>

      <Field label="Target stage" hint="Stops at a named stage in a multi-stage build. Optional.">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="builder"
          className="input"
        />
      </Field>

      <Field label="Build arguments" hint="One KEY=value per line.">
        <textarea
          value={buildArgs}
          onChange={(e) => setBuildArgs(e.target.value)}
          rows={4}
          placeholder={'VERSION=1.2.3\nNODE_ENV=production'}
          className="textarea font-mono"
        />
      </Field>

      <Checkbox checked={noCache} onChange={setNoCache} label="Build without the cache" />

      {builderRunning === false && (
        <p className="text-tiny text-ink-600 dark:text-ink-400">
          The build container is not running yet. Dermaga will start it first — the first build
          takes a little longer because of it.
        </p>
      )}
    </Modal>
  );
}

/** Just the reference: the pull itself reports progress in the list. */
// A registry on this machine is almost never behind TLS, and the failure when
// it is not -- "-9836: bad protocol version" -- explains nothing at all.
function isLocalRegistry(reference: string): boolean {
  const host = reference.split('/')[0];
  return /^(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)(:\d+)?$/.test(host);
}

function PullDialog({ onClose }: { onClose: () => void }) {
  const [reference, setReference] = useState('');
  const [insecure, setInsecure] = useState(false);
  const [decided, setDecided] = useState(false);

  const plainHttp = decided ? insecure : isLocalRegistry(reference);

  const pull = () => {
    const target = reference.trim();
    onClose();
    void runTask({
      id: `pull:${target}`,
      kind: 'image',
      label: target,
      method: 'images.pull',
      params: { reference: target, scheme: plainHttp ? 'http' : undefined },
    });
  };

  return (
    <Modal
      title="Pull image"
      subtitle="Progress appears in the list; you can keep working while it downloads."
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button onClick={pull} className="btn-primary" disabled={!reference.trim()}>
            Pull
          </button>
        </>
      }
    >
      <Field label="Reference" hint="For example redis:8.10 or ghcr.io/owner/app:1.2.3">
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && reference.trim() && pull()}
          placeholder="redis:8.10"
          autoFocus
          className="input"
        />
      </Field>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={plainHttp}
          onChange={(e) => {
            setDecided(true);
            setInsecure(e.target.checked);
          }}
          className="h-4 w-4 accent-brand-600"
        />
        Plain HTTP
        {!decided && isLocalRegistry(reference) && (
          <span className="text-tiny text-ink-500">
            · set for you, this looks like a local registry
          </span>
        )}
      </label>
    </Modal>
  );
}
