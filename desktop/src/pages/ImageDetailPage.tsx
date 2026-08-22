import { useEffect, useState } from 'react';
import {
  FileDown,
  Layers,
  Package as PackageIcon,
  Play,
  RefreshCw,
  Tags,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ContainerForm } from '../components/ContainerForm';
import { Badge } from '../components/DataTable';
import { IconButton } from '../components/Button';
import {
  DetailBody,
  DetailLayout,
  DetailPane,
  PaneBar,
  RailRow,
  RailSection,
} from '../components/DetailLayout';
import type { TabDefinition } from '../components/Tabs';
import { PackagesPane, type Severity } from '../components/PackagesPane';
import { Button } from '../components/Button';
import { Field, Modal } from '../components/form';
import { SaveImageDialog, saveImage } from '../components/ImageArchive';
import { TaskRows, runTask } from '../components/TaskRows';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useImageScan, type ImageScan } from '../hooks/useImageScan';
import { useToastStore } from '../store/toastStore';
import { useUIStore } from '../store/uiStore';
import type { Container, ImageDetail, ImageHistory, ImageVariant } from '../types';
import { formatBytes, formatDuration, shortDigest, splitEnv } from '../utils/format';

// What an image is made of, in the order somebody asks about it: how it was
// built, what that put in it, what is wrong with any of that.
//
// The mockup has Layers and History as separate tabs. They cannot be, here:
// the runtime hands back one array, and a layer is simply an entry in it that
// wrote something to the filesystem. Two tabs off one list meant History was
// Layers with four more rows in it, and nothing on either screen said so. One
// tab shows the build in full and marks the steps that added no layer.
//
// Tags is ours rather than the mockup's -- an image here can carry several
// names, and removing one is a thing you do on this page.
const TABS: TabDefinition[] = [
  { id: 'layers', label: 'Layers', icon: Layers },
  // One tab, not two. Every finding is a fact about a package that is already
  // listed here, so the findings hang off the packages they are in rather than
  // forming a second list the reader has to match up by hand.
  { id: 'packages', label: 'Packages', icon: PackageIcon },
  { id: 'tags', label: 'Tags', icon: Tags },
];

export function ImageDetailPage({ reference }: { reference: string }) {
  // One scan feeds Layers, Packages and Vulnerabilities, so its control lives
  // here rather than inside whichever tab happens to be open.
  const scan = useImageScan(reference);
  const [detail, setDetail] = useState<ImageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variantIndex, setVariantIndex] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [tab, setTab] = useState('layers');
  // What the Packages tab is narrowed to. Held here rather than in the pane so
  // that arriving with a filter already set is the same thing as typing one.
  const [pkgQuery, setPkgQuery] = useState('');
  const [pkgOnly, setPkgOnly] = useState<Severity | null>(null);
  const [pushing, setPushing] = useState(false);
  // Bumped after a tag is removed, so the inspect runs again.
  const [reloads, setReloads] = useState(0);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const back = useUIStore((s) => s.back);
  const openContainer = useUIStore((s) => s.openContainer);
  const images = useResourceStore((s) => s.images);
  const containers = useResourceStore((s) => s.containers);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;

    void api
      .inspectImage(reference)
      .then((result) => {
        if (cancelled) return;
        setDetail(result ?? null);
        setError(result ? null : 'This image is no longer available.');
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Could not inspect the image');
      });

    return () => {
      cancelled = true;
    };
  }, [reference, reloads]);

  // Other tags pointing at the same image, so the page covers the whole thing.
  const siblings = detail
    ? images.filter((i) => i.digest === detail.digest && i.reference !== detail.reference)
    : [];
  const users = containers.filter(
    (c) => c.image === reference || siblings.some((s) => s.reference === c.image)
  );

  const remove = async () => {
    setConfirmingDelete(false);
    try {
      await api.deleteImage(reference);
      pushToast(`Deleted ${reference}`);
      back();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not delete the image', 'error');
    }
  };

  const variant: ImageVariant | undefined = detail?.variants[variantIndex];

  return (
    <DetailLayout
      onBack={back}
      backTo="Images"
      title={detail?.name ?? reference}
      badges={
        <>
          {detail && <Badge>{detail.tag}</Badge>}
          {siblings.map((s) => (
            <Badge key={s.reference}>{s.tag}</Badge>
          ))}
        </>
      }
      subtitle={detail ? shortDigest(detail.digest) : reference}
      tabs={TABS}
      activeTab={tab}
      onSelectTab={setTab}
      actions={
        <>
          <Button
            icon={RefreshCw}
            busy={scan.scanning}
            busyLabel="Scanning…"
            disabled={scan.preparing}
            title={
              scan.report
                ? `Last scanned ${formatDuration(scan.report.scannedAt)} ago. Layers, packages and vulnerabilities all come from this one pass.`
                : 'Reads the image for its layers, its packages and anything known to be wrong with them.'
            }
            onClick={() => void scan.scan()}
          >
            {scan.report ? 'Rescan' : 'Scan'}
          </Button>
          {/* The first thing anyone wants from an image, and until now the one
              thing this page could not do. */}
          <button onClick={() => setRunning(true)} className="btn-ghost">
            <Play size={13} aria-hidden />
            Run
          </button>
          <button onClick={() => setPushing(true)} className="btn-ghost">
            <Upload size={13} aria-hidden />
            Push
          </button>
          <button
            onClick={() => {
              // One platform is not a choice worth a dialog; several is.
              const platforms = detail?.variants.map((v) => v.platform) ?? [];
              if (platforms.length === 1) {
                void saveImage(reference, platforms[0], (path) => pushToast(`Saved to ${path}`));
                return;
              }

              setSaving(true);
            }}
            className="btn-ghost"
            disabled={!detail}
          >
            <FileDown size={13} aria-hidden />
            Save
          </button>
          <button
            onClick={() => setConfirmingDelete(true)}
            className="btn-ghost text-orange-700 dark:text-orange-500"
          >
            <Trash2 size={13} aria-hidden />
            Delete
          </button>
        </>
      }
    >
      {/* Push and pull progress belongs where the button was pressed, not only
          on the list the user has just navigated away from. */}
      <TaskRows kind="image" />

      <DetailBody
        rail={
          detail && variant ? (
            <ImageRail
              detail={detail}
              variant={variant}
              users={users}
              onOpenContainer={openContainer}
            />
          ) : undefined
        }
      >
        {error && !detail ? (
          <p className="flex flex-1 items-center justify-center wrap-break-word text-sm text-ink-600 dark:text-ink-400">
            {error}
          </p>
        ) : !detail || !variant ? (
          <p className="flex flex-1 items-center justify-center wrap-break-word text-sm text-ink-600 dark:text-ink-400">
            Inspecting image…
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Which build of this image every tab is about. A manifest list can
                carry fifteen, so it sits above the tabs rather than inside one:
                switching platform changes what Layers, Packages and History all
                say, and a control that reaches across tabs cannot live in one. */}
            {detail.variants.length > 1 && (
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ink-200 px-7 py-2.5 dark:border-ink-800">
                <span className="label-mono">Platform</span>
                {detail.variants.map((v, index) => (
                  <button
                    key={v.digest || v.platform}
                    aria-pressed={index === variantIndex}
                    onClick={() => setVariantIndex(index)}
                    className={`inline-flex h-7 shrink-0 items-center rounded-lg px-2.5 font-mono text-tiny transition-colors ${
                      index === variantIndex
                        ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-600/15 dark:text-brand-400'
                        : 'text-ink-600 hover:bg-ink-150 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100'
                    }`}
                  >
                    {v.platform}
                  </button>
                ))}
              </div>
            )}

            {tab === 'layers' && <LayersPane variant={variant} scan={scan} />}

            {tab === 'packages' && (
              <PackagesPane
                reference={reference}
                filter={pkgQuery}
                onFilter={setPkgQuery}
                only={pkgOnly}
                onOnly={setPkgOnly}
              />
            )}

            {tab === 'tags' && (
              <DetailPane>
                <TagList
                  reference={reference}
                  tags={[reference, ...siblings.map((s) => s.reference)]}
                  onChanged={() => setReloads((n) => n + 1)}
                />
              </DetailPane>
            )}
          </div>
        )}
      </DetailBody>

      {running && (
        <ContainerForm initial={{ image: reference }} onClose={() => setRunning(false)} />
      )}

      {pushing && <PushDialog reference={reference} onClose={() => setPushing(false)} />}

      {saving && detail && (
        <SaveImageDialog
          reference={reference}
          platforms={detail.variants.map((variant) => variant.platform)}
          onClose={() => setSaving(false)}
          onSaved={(path) => pushToast(`Saved to ${path}`)}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete ${detail?.name ?? reference}?`}
          body={
            users.length > 0
              ? `It is used by ${users.map((c) => c.name).join(', ')}, which keeps running but cannot be recreated without pulling it again.`
              : 'The image will have to be pulled again to use it.'
          }
          confirmLabel="Delete"
          onConfirm={() => void remove()}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </DetailLayout>
  );
}

/**
 * Sends an image to a registry, tagging it first when the destination differs.
 *
 * Building an image and having nowhere to send it is half a loop; this is the
 * other half. The push itself is a task row, like a pull, so a slow upload does
 * not hold a dialog open.
 */
// A registry on this machine is almost never behind TLS, and the failure when
// it is not -- "-9836: bad protocol version" -- explains nothing at all. So the
// default follows the address, and the checkbox is there to disagree with.
function isLocal(reference: string): boolean {
  const host = reference.split('/')[0];
  return /^(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)(:\d+)?$/.test(host);
}

function PushDialog({ reference, onClose }: { reference: string; onClose: () => void }) {
  const [target, setTarget] = useState(reference);
  const [insecure, setInsecure] = useState(isLocal(reference));
  // Once the box is touched, the address stops deciding for the user.
  const [decided, setDecided] = useState(false);

  const plainHttp = decided ? insecure : isLocal(target);
  const [busy, setBusy] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const push = async () => {
    const destination = target.trim();
    setBusy(true);

    try {
      // Only when it is going somewhere else: tagging an image as itself is an
      // error, not a no-op.
      if (destination !== reference) await api.tagImage(reference, destination);
    } catch (err) {
      setBusy(false);
      pushToast(err instanceof Error ? err.message : 'Could not tag the image', 'error');
      return;
    }

    setBusy(false);
    onClose();

    void runTask({
      id: `push:${destination}`,
      kind: 'image',
      label: destination,
      method: 'images.push',
      params: { reference: destination, scheme: plainHttp ? 'http' : undefined },
    });
  };

  return (
    <Modal
      title="Push image"
      subtitle="Progress appears in the image list; you can keep working."
      onClose={onClose}
      onSubmit={() => void push()}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <Button
            variant="primary"
            busy={busy}
            busyLabel="Tagging…"
            disabled={!target.trim()}
            onClick={() => void push()}
          >
            Push
          </Button>
        </>
      }
    >
      <Field
        label="Destination"
        hint="The registry is the first part: ghcr.io/you/app:1.0. Tagged for you if it differs from the name above."
      >
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="input font-mono"
          autoFocus
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
        {!decided && isLocal(target) && (
          <span className="text-tiny text-ink-500">
            · set for you, this looks like a local registry
          </span>
        )}
      </label>
    </Modal>
  );
}

/**
 * Every reference pointing at this image, and a way to drop one.
 *
 * Removing a tag removes only that name -- the image and its other names stay,
 * which is what makes it safe to tidy up after a push. Removing the last one
 * removes the image itself, and the button says so.
 */
function TagList({
  reference,
  tags,
  onChanged,
}: {
  reference: string;
  tags: string[];
  onChanged: () => void;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);
  const back = useUIStore((s) => s.navigate);

  const last = tags.length === 1;

  const remove = async (tag: string) => {
    setRemoving(null);
    setBusy(tag);

    try {
      await api.deleteImage(tag);
      pushToast(last ? `Deleted ${tag}` : `Removed the tag ${tag}`);

      // Nothing left to show once the last name is gone.
      if (last) back({ name: 'images' });
      else onChanged();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not remove the tag', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <DetailPane>
      <PaneBar>
        <span className="label-mono normal-case">
          {tags.length} name{tags.length === 1 ? '' : 's'} point at these same bytes · removing one
          leaves the others{last ? '' : ' and the image'} alone
        </span>
      </PaneBar>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
        <ul className="divide-y divide-ink-150 border-t border-ink-150 dark:divide-ink-800 dark:border-ink-800">
          {tags.map((tag) => (
            <li key={tag} className="flex items-center gap-3 py-2.5">
              <span className="selectable min-w-0 flex-1 truncate font-mono text-small">{tag}</span>
              {tag === reference && <Badge>open</Badge>}
              <IconButton
                icon={X}
                busy={busy === tag}
                className="border-transparent text-orange-700 dark:text-orange-500"
                aria-label={`Remove ${tag}`}
                onClick={() => setRemoving(tag)}
              />
            </li>
          ))}
        </ul>

        {removing && (
          <ConfirmDialog
            title={last ? `Delete ${removing}?` : `Remove the tag ${removing}?`}
            body={
              last
                ? 'This is the only name for this image, so the image itself goes with it. It has to be pulled or built again to come back.'
                : 'Only this name is removed. The image and its other names stay exactly as they are.'
            }
            confirmLabel={last ? 'Delete image' : 'Remove tag'}
            onConfirm={() => void remove(removing)}
            onCancel={() => setRemoving(null)}
          />
        )}
      </div>
    </DetailPane>
  );
}

/**
 * What this image is, kept beside whatever tab is open.
 *
 * Reference and digest are the two things somebody copies out of this page, and
 * they used to be on the Overview tab -- so reading a vulnerability report and
 * wanting the digest to paste into a ticket meant leaving the report. "Used by"
 * is here for the same reason: the containers running this image are the reason
 * a scan result matters or does not.
 */
function ImageRail({
  detail,
  variant,
  users,
  onOpenContainer,
}: {
  detail: ImageDetail;
  variant: ImageVariant;
  users: Container[];
  onOpenContainer: (id: string) => void;
}) {
  return (
    <>
      <RailSection title="Details">
        <div className="flex flex-col">
          <RailRow label="Reference" value={detail.reference} />
          <RailRow label="Digest" value={detail.digest} />
          <RailRow label="Platform" value={variant.platform} />
          <RailRow label="Size" value={formatBytes(variant.sizeInBytes)} />
          <RailRow label="Layers" value={variant.layers} />
          <RailRow
            label="Built"
            value={variant.createdAt ? `${formatDuration(variant.createdAt)} ago` : '—'}
          />
        </div>
      </RailSection>

      <RailSection title="Configuration">
        <div className="flex flex-col">
          <RailRow label="Entrypoint" value={variant.entrypoint.join(' ')} />
          <RailRow label="Command" value={variant.command.join(' ')} />
          <RailRow label="Working directory" value={variant.workingDir} />
          <RailRow label="User" value={variant.user || 'root'} />
          <RailRow label="Exposed ports" value={variant.exposedPorts.join(', ')} />
        </div>
      </RailSection>

      {variant.env.length > 0 && (
        <RailSection title={`Environment (${variant.env.length})`}>
          <div className="flex flex-col">
            {variant.env.map((entry) => {
              const [key, value] = splitEnv(entry);
              return <RailRow key={key} label={key} value={value || '—'} />;
            })}
          </div>
        </RailSection>
      )}

      {Object.keys(variant.labels).length > 0 && (
        <RailSection title="Labels">
          <div className="flex flex-col">
            {Object.entries(variant.labels).map(([key, value]) => (
              <RailRow key={key} label={key} value={value} />
            ))}
          </div>
        </RailSection>
      )}

      <RailSection title="Used by">
        {users.length === 0 ? (
          <p className="text-xs text-ink-600 dark:text-ink-400">
            No container is running this image.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {users.map((container) => (
              <li key={container.id}>
                <button
                  onClick={() => onOpenContainer(container.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-left text-xs transition-colors hover:border-ink-300 dark:border-ink-800 dark:bg-ink-900 dark:hover:border-ink-700"
                >
                  <span
                    className={`h-1.75 w-1.75 shrink-0 rounded-full ${
                      container.status === 'running' ? 'bg-emerald-600' : 'bg-ink-400'
                    }`}
                    aria-hidden
                  />
                  <span className="truncate">{container.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </RailSection>
    </>
  );
}

/**
 * The build step as the Dockerfile wrote it.
 *
 * Two things the builder adds on the way through are taken back off. `RUN`
 * lines are recorded in their shell form -- "RUN /bin/sh -c set -x && …" --
 * which is the same instruction with the shell the builder chose spelled out
 * in front of it, and every one of them says it. BuildKit stamps "# buildkit"
 * on the end of the steps it produced, which is a note about the builder
 * rather than about the image. Nothing else is touched: what is left is the
 * line somebody typed.
 */
function instruction(createdBy?: string): string {
  const text = (createdBy ?? '').replace(/\s*#\s*buildkit\s*$/, '').trim();
  if (!text) return '—';
  return text.replace(/^RUN\s+\/bin\/sh\s+-c\s+/, 'RUN ');
}

/**
 * How the image was built, step by step.
 *
 * Every step is here, not only the ones that produced a layer. The runtime
 * reports a single history array and a layer is an entry in it that wrote to
 * the filesystem -- so splitting it into a "Layers" tab and a "History" tab
 * gave two screens off one list, differing by the handful of ENV and CMD lines
 * that create nothing. Those lines are worth seeing: they are often the exact
 * thing somebody opened this tab to find. They are shown, marked, and left out
 * of the numbering, which counts layers.
 *
 * No size column, unlike the mockup. `container image inspect` reports the size
 * of the whole variant and the diff IDs of its layers -- not how the bytes
 * divide between them -- so a figure per row would be a guess dressed as a
 * measurement. The total is on the line above the list, where it is true.
 */
function LayersPane({ variant, scan }: { variant: ImageVariant; scan: ImageScan }) {
  // Numbered by layer, so the last number is the layer count rather than the
  // step count -- the metadata steps sit between them without taking one.
  // Worked out before the list is drawn rather than counted while drawing it:
  // a counter that ticks inside a render is a counter that ticks again on the
  // next one.
  const steps = variant.history.reduce<{ step: ImageHistory; layer: number | null }[]>(
    (rows, step) => {
      const previous = rows[rows.length - 1]?.layer ?? 0;
      rows.push({ step, layer: step.emptyLayer ? null : previous + 1 });
      return rows;
    },
    []
  );
  const layers = steps.filter((row) => row.layer !== null).length;

  // The manifest lists layers in build order, so the nth of these belongs to
  // the nth layer-producing step. Only paired when the counts agree: a report
  // made before the image was rebuilt describes a different set of layers, and
  // sizes lined up against the wrong commands are worse than no sizes.
  const sizes = scan.report?.layers;
  const sized = sizes?.length === layers ? sizes : undefined;

  return (
    <DetailPane>
      <PaneBar>
        <span className="label-mono normal-case">
          {steps.length} build step{steps.length === 1 ? '' : 's'} · {layers} layer
          {layers === 1 ? '' : 's'} · {formatBytes(variant.sizeInBytes)} altogether
          {!sized &&
            (scan.report
              ? ' · rescan to size each layer'
              : ' · sizes appear once this image has been scanned')}
        </span>
      </PaneBar>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
        {steps.length === 0 ? (
          <p className="text-sm text-ink-600 dark:text-ink-400">
            This image carries no build history, which is normal for one exported from another tool.
          </p>
        ) : (
          <ol className="divide-y divide-ink-150 border-t border-ink-150 dark:divide-ink-800 dark:border-ink-800">
            {steps.map(({ step, layer }, index) => (
              <li key={index} className="grid grid-cols-[32px_minmax(0,1fr)_auto] gap-3.5 py-3">
                <span className="font-mono text-tiny leading-relaxed text-ink-400">
                  {layer ?? '·'}
                </span>
                <span
                  className={`selectable min-w-0 font-mono text-code leading-relaxed wrap-break-word ${
                    layer === null ? 'text-ink-500' : 'text-ink-700 dark:text-ink-300'
                  }`}
                >
                  {instruction(step.createdBy)}
                </span>
                {/* Said in words. A step that wrote nothing to the filesystem
                  looks identical to one that wrote a gigabyte, and the
                  difference is the whole reason for numbering the list. */}
                <span className="shrink-0 whitespace-nowrap font-mono text-tiny text-ink-500">
                  {layer === null
                    ? 'no layer'
                    : sized
                      ? formatBytes(sized[layer - 1]?.size ?? 0)
                      : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </DetailPane>
  );
}
