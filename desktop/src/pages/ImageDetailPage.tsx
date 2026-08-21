import { useEffect, useState } from 'react';
import {
  Boxes,
  FileDown,
  Info,
  Layers,
  Play,
  ShieldCheck,
  Tags,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ContainerForm } from '../components/ContainerForm';
import { Badge } from '../components/DataTable';
import { IconButton } from '../components/Button';
import { DetailGrid, DetailLayout, DetailPane } from '../components/DetailLayout';
import { Row, Section } from '../components/DetailRow';
import type { TabDefinition } from '../components/Tabs';
import { VulnerabilityPane } from '../components/VulnerabilityPane';
import { Button } from '../components/Button';
import { Field, Modal } from '../components/form';
import { SaveImageDialog, saveImage } from '../components/ImageArchive';
import { TaskRows, runTask } from '../components/TaskRows';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useToastStore } from '../store/toastStore';
import { useUIStore } from '../store/uiStore';
import type { ImageDetail, ImageVariant } from '../types';
import { formatBytes, formatDuration, shortDigest, splitEnv } from '../utils/format';

const TABS: TabDefinition[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'tags', label: 'Tags', icon: Tags },
  { id: 'vulnerabilities', label: 'Vulnerabilities', icon: ShieldCheck },
];

export function ImageDetailPage({ reference }: { reference: string }) {
  const [detail, setDetail] = useState<ImageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variantIndex, setVariantIndex] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [tab, setTab] = useState('overview');
  const [pushing, setPushing] = useState(false);
  // Bumped after a tag is removed, so the inspect runs again.
  const [reloads, setReloads] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
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

      {tab === 'tags' ? (
        <DetailPane>
          <TagList
            reference={reference}
            tags={[reference, ...siblings.map((s) => s.reference)]}
            onChanged={() => setReloads((n) => n + 1)}
          />
        </DetailPane>
      ) : tab === 'vulnerabilities' ? (
        <VulnerabilityPane reference={reference} />
      ) : error && !detail ? (
        <p className="flex flex-1 items-center justify-center break-words text-sm text-ink-600 dark:text-ink-400">
          {error}
        </p>
      ) : !detail || !variant ? (
        <p className="flex flex-1 items-center justify-center break-words text-sm text-ink-600 dark:text-ink-400">
          Inspecting image…
        </p>
      ) : (
        <DetailGrid>
          {detail.variants.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
              <span className="label-caps">Platform</span>
              {detail.variants.map((v, index) => (
                <button
                  key={v.digest || v.platform}
                  onClick={() => setVariantIndex(index)}
                  className={index === variantIndex ? 'btn-primary' : 'btn-ghost'}
                >
                  {v.platform}
                </button>
              ))}
            </div>
          )}

          <Section title="Image">
            <Row label="Reference" value={detail.reference} mono copyable wide />
            <Row label="Digest" value={detail.digest} mono copyable wide />
            <Row label="Platform" value={variant.platform} />
            <Row label="Size" value={formatBytes(variant.sizeInBytes)} />
            <Row label="Layers" value={variant.layers} />
            <Row
              label="Built"
              value={variant.createdAt ? `${formatDuration(variant.createdAt)} ago` : '—'}
            />
          </Section>

          <Section title="Default configuration">
            <Row label="Entrypoint" value={variant.entrypoint.join(' ')} mono wide />
            <Row label="Command" value={variant.command.join(' ')} mono wide />
            <Row label="Working directory" value={variant.workingDir} mono wide />
            <Row label="User" value={variant.user || 'root'} mono />
            <Row label="Exposed ports" value={variant.exposedPorts.join(', ')} mono wide />
          </Section>

          <Section title={`Environment (${variant.env.length})`}>
            {variant.env.map((entry) => {
              const [key, value] = splitEnv(entry);
              return <Row key={key} label={key} value={value || '—'} mono copyable wide />;
            })}
          </Section>

          <Section title="Used by" plain>
            {users.length === 0 ? (
              <p className="text-xs text-ink-600 dark:text-ink-400">
                No container is running this image.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {users.map((container) => (
                  <button
                    key={container.id}
                    onClick={() => openContainer(container.id)}
                    className="btn-ghost px-2 py-1 text-xs"
                  >
                    <Boxes size={13} aria-hidden />
                    {container.name}
                  </button>
                ))}
              </div>
            )}
          </Section>

          {Object.keys(variant.labels).length > 0 && (
            <Section title="Labels">
              {Object.entries(variant.labels).map(([key, value]) => (
                <Row key={key} label={key} value={value} wide />
              ))}
            </Section>
          )}

          <Section
            title={`Build history (${variant.history.length} steps)`}
            span={showHistory}
            plain
            action={
              <button
                onClick={() => setShowHistory((prev) => !prev)}
                className="flex items-center gap-1 text-tiny font-semibold text-brand-700 hover:underline dark:text-brand-400"
              >
                <Layers size={12} aria-hidden />
                {showHistory ? 'Hide' : 'Show'}
              </button>
            }
          >
            {showHistory ? (
              <ol className="flex flex-col gap-1.5 border-l border-ink-200 pl-3 dark:border-ink-700">
                {variant.history.map((step, index) => (
                  <li key={index} className="flex flex-col gap-0.5">
                    <p className="selectable break-all font-mono text-tiny leading-relaxed">
                      {step.createdBy || '—'}
                    </p>
                    <p className="text-tiny text-ink-500">
                      {step.createdAt ? `${formatDuration(step.createdAt)} ago` : ''}
                      {step.comment && ` · ${step.comment}`}
                      {step.emptyLayer && ' · metadata only'}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="truncate text-xs text-ink-600 dark:text-ink-400">
                {variant.history[variant.history.length - 1]?.createdBy ?? '—'}
              </p>
            )}
          </Section>
        </DetailGrid>
      )}

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
    <>
      <p className="pb-2 text-tiny text-ink-600 dark:text-ink-400">
        {tags.length} name{tags.length === 1 ? '' : 's'} point at these same bytes. Removing one
        leaves the others{last ? '' : ' and the image'} alone.
      </p>

      <ul className="divide-y divide-ink-200 border-y border-ink-200 dark:divide-ink-800 dark:border-ink-800">
        {tags.map((tag) => (
          <li key={tag} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{tag}</span>
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
    </>
  );
}
