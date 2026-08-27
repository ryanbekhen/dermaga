import { useMemo, useState } from 'react';
import { Download, FileUp, Hammer, Play, ScanSearch, Trash2 } from 'lucide-react';
import { Button, IconButton } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  Badge,
  InUse,
  DataTable,
  Muted,
  NameCell,
  SelectionActions,
  type Column,
} from '../components/DataTable';
import { Field, Modal } from '../components/form';
import { loadImage } from '../components/ImageArchive';
import { runTask } from '../services/tasks';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useActiveProject } from '../hooks/useActiveProject';
import { builtInProject, unprefixed } from '../utils/projects';
import { SeverityStrip } from '../components/PackagesPane';
import { useScannerStore } from '../store/scannerStore';
import { useToastStore } from '../store/toastStore';
import { PageHeader } from '../components/PageHeader';
import { useDialog } from '../hooks/useDialog';
import { useValidation } from '../hooks/useValidation';
import { imageReference, required } from '../utils/validate';
import { useUIStore } from '../store/uiStore';
import type { Image } from '../types';
import { formatBytes, formatDuration, shortDigest } from '../utils/format';

/**
 * One physical image, however many references point at it. `redis:8.10` and
 * `redis:latest` share a digest, so they belong on one row rather than looking
 * like two separate downloads.
 */
interface ImageGroup {
  digest: string;
  /** The project each tag on this digest is filed under, undefined for none. */
  projects: (string | undefined)[];
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
        projects: [image.project],
        names: [image.name],
        tags: [{ tag: image.tag, reference: image.reference }],
        platforms: [...image.platforms],
        createdAt: image.createdAt,
        sizeInBytes: image.sizeInBytes,
      });
      continue;
    }

    if (!group.projects.includes(image.project)) group.projects.push(image.project);
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
  // Wide enough for all five segments of the strip, which is the same bar the
  // image's own Packages tab is headed by.
  { key: 'vulnerabilities', label: 'Vulnerabilities', width: '148px' },
  { key: 'digest', label: 'Digest', width: '116px' },
  { key: 'platform', label: 'Platform', width: '124px' },
  { key: 'size', label: 'Size', width: '84px', align: 'right' },
  { key: 'built', label: 'Built', width: '72px', align: 'right' },
];

export function ImagesPage() {
  const images = useResourceStore((s) => s.images);
  const activeProject = useActiveProject();
  const hasLoaded = useResourceStore((s) => s.hasLoaded);
  const containers = useResourceStore((s) => s.containers);
  const openImage = useUIStore((s) => s.openImage);
  // Running an image opens the form that makes a container, on its own page,
  // with the image already filled in. Leaving it comes back here.
  const newContainer = useUIStore((s) => s.newContainer);
  const pushToast = useToastStore((s) => s.push);

  const pulling = useDialog('image.pull');
  // Building is a page of its own; this button is one of the three ways to it.
  const buildImage = useUIStore((s) => s.buildImage);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  const groups = useMemo(() => groupByDigest(images), [images]);

  // Filed where it was built, so the point of view decides which builds are on
  // the page and pulled images stay in default. See builtInProject.
  const visible = useMemo(
    () => groups.filter((group) => builtInProject(group.projects, activeProject)),
    [groups, activeProject]
  );

  /**
   * Queues a scan for each selected image.
   *
   * One reference per image rather than per tag: the tags of one image share a
   * digest, so scanning two of them would export the same bytes twice and
   * arrive at the same answer.
   */
  const scanSelected = async () => {
    const chosen = groups.filter((group) => selected.has(group.digest));

    setScanning(true);
    const failed: string[] = [];

    for (const group of chosen) {
      const reference = group.tags[0]?.reference;
      if (!reference) continue;

      try {
        await api.scanImage(reference);
      } catch {
        failed.push(reference);
      }
    }

    setScanning(false);
    setSelected(new Set());

    if (failed.length > 0) {
      pushToast(`Could not queue ${failed.join(', ')}`, 'error');
    } else {
      pushToast(`${chosen.length} image${chosen.length === 1 ? '' : 's'} queued for scanning`);
    }
  };

  const totalSize = groups.reduce((sum, g) => sum + g.sizeInBytes, 0);

  const usersOf = (group: ImageGroup) =>
    containers.filter((c) => group.tags.some((t) => t.reference === c.image)).map((c) => c.name);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Images"
        subtitle={`${groups.length} image${groups.length === 1 ? '' : 's'}${
          images.length !== groups.length ? ` · ${images.length} references` : ''
        } · ${formatBytes(totalSize)}`}
        actions={
          selected.size > 0 ? (
            <SelectionActions count={selected.size} onClear={() => setSelected(new Set())}>
              {/* Asking for a scan is asking for it next, not asking for the
                  only one that will ever happen: the scanner works through
                  images on its own and rescans anything older than three
                  hours. This is for when you want an answer now. */}
              <Button
                iconOnly
                icon={ScanSearch}
                busy={scanning}
                busyLabel="Queueing…"
                onClick={() => void scanSelected()}
              >
                Scan
              </Button>
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
            <>
              {/* The seconds are icons; the one thing this page is usually
                  opened to do keeps its words. A row of three labelled buttons
                  made them all look equally likely, and on a page whose header
                  is read once and then never again, the label is worth most on
                  the one you have not decided against yet. */}
              <button
                onClick={() => void loadImage()}
                className="btn-plain"
                title="Load an image from an OCI archive"
                aria-label="Load an image from an OCI archive"
              >
                <FileUp size={16} aria-hidden />
              </button>
              <button
                onClick={() => buildImage()}
                className="btn-plain"
                title="Build an image from a Dockerfile"
                aria-label="Build an image from a Dockerfile"
              >
                <Hammer size={16} aria-hidden />
              </button>
              <button
                onClick={() => pulling.show()}
                className="btn-plain-primary"
                title="Pull an image from a registry"
                aria-label="Pull an image from a registry"
              >
                <Download size={18} aria-hidden />
              </button>
            </>
          )
        }
      />

      <DataTable
        columns={COLUMNS}
        rows={visible}
        rowKey={(group) => group.digest}
        onOpen={(group) => openImage(group.tags[0].reference)}
        selection={{ selected, onChange: setSelected }}
        empty="No images yet. Pull one to get started."
        loading={!hasLoaded}
        cells={(group) => {
          const users = usersOf(group);

          return [
            <NameCell key="name">
              <span className="truncate text-sm font-semibold">
                {group.names.map((name) => unprefixed(activeProject, name)).join(', ')}
              </span>
              <InUse by={users} />
            </NameCell>,
            // A tag is as long as whoever built the image decided -- a commit
            // SHA, a branch name, a date and a build number. Left to its own
            // width it was drawn straight across the vulnerability count
            // beside it, so the column keeps what it can and hands the rest to
            // the tooltip.
            //
            // On one line, whatever the count. Wrapping made an image with four
            // tags twice the height of the one above it, and a list whose rows
            // are all different heights cannot be scanned down a column -- the
            // eye has to find each row before it can read it.
            <div
              key="tags"
              title={group.tags.map(({ tag }) => tag).join(', ')}
              className="flex min-w-0 items-center gap-1 overflow-hidden"
            >
              {group.tags.map(({ tag }) => (
                <Badge key={tag} fit title={tag}>
                  {tag}
                </Badge>
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
            icon={Play}
            className="border-transparent opacity-0 group-hover:opacity-100"
            title="Run a container from this image"
            aria-label={`Run ${group.names[0]}`}
            onClick={() => newContainer({ image: group.tags[0].reference })}
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

      {pulling.open && <PullDialog onClose={() => pulling.close()} />}
    </div>
  );
}

/**
 * The severity counts for a row, from whichever of its tags has been scanned --
 * they share a digest, so they share an answer.
 */
function VulnerabilityCell({ group }: { group: ImageGroup }) {
  const summaries = useScannerStore((s) => s.summaries);
  const scanning = useScannerStore((s) => s.status?.state === 'scanning');

  const report = group.tags.map((t) => summaries[t.reference]).find(Boolean);

  if (!report) {
    return <Muted>{scanning ? 'scanning…' : '—'}</Muted>;
  }

  // Every scanned image gets the same five segments, clean ones included. A
  // green tick said "clean" more directly, but it made that row a different
  // shape from the row above it -- and a column of bars is read by running an
  // eye down it, which only works if every row is the same bar. All five at
  // zero is its own unmistakable shape.
  //
  // A reading, not a control: the row is what is pressed here, and the image's
  // own page is where a severity can be filtered to.
  return <SeverityStrip counts={report.summary ?? {}} />;
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

  const form = useValidation({
    reference: required(reference, 'A reference') ?? imageReference(reference),
  });

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
      subtitle="Progress appears in the title bar; you can keep working while it downloads."
      onClose={onClose}
      onSubmit={() => form.attempt(pull)}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button onClick={pull} className="btn-primary" disabled={!form.valid}>
            Pull
          </button>
        </>
      }
    >
      <Field
        label="Reference"
        hint="For example redis:8.10 or ghcr.io/owner/app:1.2.3"
        {...form.field('reference')}
      >
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
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
