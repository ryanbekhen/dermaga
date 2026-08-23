import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileUp, FolderOpen, Hammer, Play, ScanSearch, Trash2 } from 'lucide-react';
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
import { ContainerForm } from '../components/ContainerForm';
import { Checkbox, Field, Modal } from '../components/form';
import { loadImage } from '../components/ImageArchive';
import { runTask } from '../services/tasks';
import { api } from '../services/api';
import { pickDirectory } from '../services/ipc';
import { useResourceStore } from '../store/resourceStore';
import { SeverityStrip } from '../components/PackagesPane';
import { useScannerStore } from '../store/scannerStore';
import { useToastStore } from '../store/toastStore';
import { PageHeader } from '../components/PageHeader';
import { useDialog } from '../hooks/useDialog';
import { useValidation } from '../hooks/useValidation';
import { absolutePath, envText, imageReference, required } from '../utils/validate';
import { DockerfileEditor } from '../components/DockerfileEditor';
import { useUIStore, type IntentTarget } from '../store/uiStore';
import type { BuildDrop, BuildSpec, Image } from '../types';
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
  const hasLoaded = useResourceStore((s) => s.hasLoaded);
  const containers = useResourceStore((s) => s.containers);
  const openImage = useUIStore((s) => s.openImage);
  const pushToast = useToastStore((s) => s.push);

  const pulling = useDialog('image.pull');
  const building = useDialog('image.build');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  const groups = useMemo(() => groupByDigest(images), [images]);

  const visible = groups;

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
                onClick={() => building.show()}
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
              <span className="truncate text-sm font-semibold">{group.names.join(', ')}</span>
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
            onClick={() => setRunning(group.tags[0].reference)}
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

      {running && <ContainerForm initial={{ image: running }} onClose={() => setRunning(null)} />}

      {pulling.open && <PullDialog onClose={() => pulling.close()} />}

      {building.open && (
        <BuildDialog
          // A second Dockerfile dropped while this is open is a different
          // dialog, not the same one with new props: the fields take their
          // values once, at mount, so without a key of its own the drop would
          // land on a form that quietly ignored it.
          key={dropKey(building.target)}
          from={building.target === 'paste' ? 'paste' : 'folder'}
          // The other shape an intent target comes in: a Dockerfile dropped on
          // the window, which is the folder and the filename already answered.
          drop={building.target && typeof building.target !== 'string' ? building.target : null}
          onClose={() => building.close()}
        />
      )}
    </div>
  );
}

/** What makes one opening of the build dialog a different one from the last. */
function dropKey(target: IntentTarget | null): string {
  if (!target || typeof target === 'string') return 'typed';

  return `${target.context}/${target.dockerfile ?? ''}`;
}

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

/**
 * Builds an image from a Dockerfile. The context directory is the only thing
 * required; everything else maps to a flag the CLI already understands.
 */
function BuildDialog({
  from: opened,
  drop,
  onClose,
}: {
  /** Which half search asked for; the toggle still moves between them. */
  from: 'folder' | 'paste';
  /** A Dockerfile dragged onto the window, which answers most of this. */
  drop?: BuildDrop | null;
  onClose: () => void;
}) {
  // Two ways in, one dialog. A pasted Dockerfile and a project folder are the
  // same act with the same options -- the tag, the build args, the builder
  // that has to be up -- and splitting them into two dialogs would mean
  // keeping two copies of all of it in step.
  const [from, setFrom] = useState<'folder' | 'paste'>(opened);
  const [text, setText] = useState('');

  // A drop arrives with two of the three answers already in it. The third is
  // only a suggestion -- the folder's own name -- and it opens selected, so
  // typing replaces it and Return accepts it.
  const [context, setContext] = useState(drop?.context ?? '');
  const [dockerfile, setDockerfile] = useState(drop?.dockerfile ?? '');
  const [tag, setTag] = useState(drop?.name ?? '');
  const [target, setTarget] = useState('');
  const [buildArgs, setBuildArgs] = useState('');
  const [noCache, setNoCache] = useState(false);

  // Builds run inside a buildkit container that does not exist until something
  // starts it. Knowing up front means the first build can start it rather than
  // failing with an error about a container the user never asked for.
  const [builderRunning, setBuilderRunning] = useState<boolean | null>(null);

  // The caret belongs in the one field a drop cannot answer. Done here rather
  // than with autoFocus because the field is only sometimes the first thing:
  // opened from the button, the folder is what somebody has come to type.
  const tagField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!drop) return;

    tagField.current?.focus();
    tagField.current?.select();
  }, [drop]);

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

  // A pasted Dockerfile that reaches for files beside it has nothing to
  // resolve them against, so the folder field appears -- rather than the build
  // failing on the line that uses them.
  const pasteNeedsContext = from === 'paste' && /^\s*(copy|add)\b/im.test(text);

  // Two modes asking for different things, so the rules move with them: a
  // folder build resolves everything against its folder, and a pasted
  // Dockerfile has none unless it reaches for one.
  const form = useValidation({
    context:
      from === 'folder' || pasteNeedsContext ? absolutePath(context, 'A folder') : null,
    text: from === 'paste' ? required(text, 'A Dockerfile') : null,
    tag: from === 'paste' ? (required(tag, 'A tag') ?? imageReference(tag)) : imageReference(tag),
    buildArgs: envText(buildArgs),
  });

  const build = () => {
    const folder = context.replace(/\/+$/, '').split('/').pop() || 'image';
    const name = from === 'paste' ? tag.trim() : tag.trim() || folder;

    const spec: BuildSpec = {
      context: from === 'paste' && !pasteNeedsContext ? '' : context,
      dockerfileText: from === 'paste' ? text : undefined,
      dockerfile: from === 'paste' ? undefined : dockerfile.trim() || undefined,
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
      subtitle="Progress appears in the title bar; you can keep working while it builds."
      onClose={onClose}
      onSubmit={() => form.attempt(build)}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          {/* No "build and run". A build takes minutes, by which time you are
              somewhere else in the app -- and finishing by navigating away
              from whatever that is, to open a form over the top of it, is the
              same interruption as a caret jumping while you type. The image
              lands in the list, and running it is a thing you do when you are
              ready to. */}
          <button onClick={() => build()} className="btn-primary" disabled={!form.valid}>
            Build
          </button>
        </>
      }
    >
      {/* Which of the two this is. First, because it decides what the rest of
          the dialog even asks for. */}
      <div className="flex gap-1 rounded-lg bg-ink-150 p-1 dark:bg-ink-800">
        {(
          [
            ['folder', 'From a folder'],
            ['paste', 'From a Dockerfile'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setFrom(value)}
            aria-pressed={from === value}
            className={`flex-1 rounded-md px-3 py-1.5 text-small transition-colors ${
              from === value
                ? 'bg-white font-medium text-ink-900 shadow-sm dark:bg-ink-950 dark:text-ink-100'
                : 'text-ink-600 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {from === 'paste' ? (
        <>
          {/* Asked first, and required. Nothing can be run without a name, and
              asking for one after somebody has typed fifty lines is asking
              after they have decided they are finished. Not guessed from the
              FROM line either: python:3.12 would suggest "python", which is
              the name of an image already in the list. */}
          <Field
            label="Tag"
            hint="Names the image this builds. Required — Run needs something to start."
            {...form.field('tag')}
          >
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="my-api:dev"
              autoFocus
              className="input"
            />
          </Field>

          <Field
            label="Dockerfile"
            hint="Written to a directory of its own for the build, and removed when it finishes."
            {...form.field('text')}
          >
            <DockerfileEditor value={text} onChange={setText} />
          </Field>

          {pasteNeedsContext && (
            <Field
              label="Context"
              hint="COPY and ADD need a folder to resolve against. A pasted Dockerfile has none of its own."
              {...form.field('context')}
            >
              <div className="flex gap-2">
                <input
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="/Users/you/projects/api"
                  className="input flex-1"
                />
                <button onClick={() => void choose()} className="btn-ghost shrink-0">
                  <FolderOpen size={13} aria-hidden />
                  Choose…
                </button>
              </div>
            </Field>
          )}
        </>
      ) : (
        <>
          <Field
            label="Context"
            hint="The folder COPY and ADD paths are resolved from."
            {...form.field('context')}
          >
            <div className="flex gap-2">
              <input
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="/Users/you/projects/api"
                autoFocus={!drop}
                className="input flex-1"
              />
              <button onClick={() => void choose()} className="btn-ghost shrink-0">
                <FolderOpen size={13} aria-hidden />
                Choose…
              </button>
            </div>
          </Field>

          <Field
            label="Tag"
            hint="Names the result, for example api:dev. Optional."
            {...form.field('tag')}
          >
            <input
              ref={tagField}
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
        </>
      )}

      <Field label="Target stage" hint="Stops at a named stage in a multi-stage build. Optional.">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="builder"
          className="input"
        />
      </Field>

      <Field label="Build arguments" hint="One KEY=value per line." {...form.field('buildArgs')}>
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
