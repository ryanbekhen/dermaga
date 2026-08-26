import { useCallback, useEffect, useState } from 'react';
import { ArrowUpCircle, Play, Square, Trash2 } from 'lucide-react';
import { Button } from '../components/Button';
import { CommandProgress, useCommandProgress } from '../components/CommandProgress';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LogPane } from '../components/LogPane';
import { Row, Section } from '../components/DetailRow';
import { StatusText } from '../components/StatusBadge';
import { StatTile } from '../components/StatTile';
import { DetailLayout, DetailPane, DetailScroll, DetailSections } from '../components/DetailLayout';
import type { TabDefinition } from '../components/Tabs';
import { Checkbox } from '../components/form';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useScannerStore } from '../store/scannerStore';
import { useToastStore } from '../store/toastStore';
import type { SystemStatus, ToolchainStatus } from '../types';
import { formatDuration, formatMemory } from '../utils/format';
import { Info, ScrollText } from 'lucide-react';

const TABS: TabDefinition[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'logs', label: 'Service logs', icon: ScrollText },
];

function bytesToLabel(bytes: number): string {
  return formatMemory(`${Math.round(bytes / (1024 * 1024))}m`);
}

/** One figure as a percentage of the total, guarding the empty-disk case. */
function share(bytes: number, total: number): number {
  return total > 0 ? (bytes / total) * 100 : 0;
}

export function SystemPage({ status }: { status: SystemStatus | null }) {
  const [tab, setTab] = useState('overview');
  // Pushed with the rest of the snapshot, recomputed by the agent whenever a
  // container, image or volume moved. Nothing here asks for it, and nothing
  // here has to be told when an action of its own has changed it.
  const usage = useResourceStore((s) => s.disk);
  // Two sources for one fact, and neither is redundant: the snapshot carries
  // it before this page is ever opened, which is what the sidebar's dot is
  // drawn from, and opening the page checks again -- because that is the
  // moment somebody has come here to act on it.
  const pushed = useResourceStore((s) => s.toolchain);
  const [checked, setChecked] = useState<ToolchainStatus | null>(null);
  const toolchain = checked ?? pushed;
  const update = useCommandProgress('toolchain.update');
  const [pending, setPending] = useState<
    'start' | 'stop' | 'clean-images' | 'clean-volumes' | 'clean-containers' | null
  >(null);
  const [installKernel, setInstallKernel] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  // Which kind is being cleaned, or null. One dialog rather than three: the
  // question is the same shape every time, only its consequences differ.
  const [cleaning, setCleaning] = useState<'images' | 'volumes' | 'containers' | null>(null);
  const scanner = useScannerStore((s) => s.status);
  const summaries = useScannerStore((s) => s.summaries);
  const scanCount = Object.keys(summaries).length;
  const [configPath, setConfigPath] = useState('~/.dermaga/config.json');
  const images = useResourceStore((s) => s.images);
  const containers = useResourceStore((s) => s.containers);

  // Results whose image has since been deleted. Those are the only ones worth
  // clearing -- the rest would just be scanned again.
  // Named in the confirmation, because "reclaim 1.4 GB" does not tell anyone
  // which of their images is about to disappear.
  const doomed = images
    .filter((image) => !containers.some((container) => container.image === image.reference))
    .map((image) => image.reference.split('/').pop() ?? image.reference);

  const pushToast = useToastStore((s) => s.push);

  const running = status?.running ?? false;

  const loadToolchain = useCallback(async () => {
    try {
      setChecked(await api.getToolchain());
    } catch {
      setChecked(null);
    }
  }, []);

  useEffect(() => {
    // The agent reports where it actually wrote the file.
    void api.getSettings().then(({ path }) => path && setConfigPath(path));
  }, []);

  useEffect(() => {
    // Checking for a newer CLI asks Homebrew what it already knows, so it is
    // cheap enough to do whenever this page opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadToolchain();
  }, [loadToolchain]);

  // The one way Dermaga can act on any of this, and it exists only where the
  // CLI came from Homebrew. Built here rather than twice below, because the
  // two cases that offer it differ in what they say, not in what they do.
  const upgradeButton =
    toolchain?.managedBy === 'homebrew' ? (
      <Button
        icon={ArrowUpCircle}
        busy={update.state === 'running'}
        busyLabel="Updating…"
        onClick={() =>
          void update.run((failed) => {
            if (failed) return;
            pushToast(
              toolchain.latestVersion ? `Updated to ${toolchain.latestVersion}` : 'CLI updated'
            );
            void loadToolchain();
          })
        }
      >
        {toolchain.latestVersion ? `Update to ${toolchain.latestVersion}` : 'Update the CLI'}
      </Button>
    ) : null;

  const run = async (
    action: 'start' | 'stop' | 'clean-images' | 'clean-volumes' | 'clean-containers',
    work: () => Promise<string | void>,
    message: string
  ) => {
    setPending(action);
    try {
      // Some actions know better than the caller what happened -- a prune can
      // free nothing at all, and saying "reclaimed" then is just wrong.
      const outcome = await work();
      pushToast(outcome || message);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : `Could not ${action}`, 'error');
    } finally {
      setPending(null);
    }
  };

  // What the runtime occupies altogether, which is what each figure is a share
  // of. Not the size of the disk: Dermaga is not told that, and a meter drawn
  // against a total it had to guess is a meter that says nothing.
  const onDisk =
    (usage?.containers.sizeInBytes ?? 0) +
    (usage?.images.sizeInBytes ?? 0) +
    (usage?.volumes.sizeInBytes ?? 0);

  return (
    <DetailLayout
      title="System"
      badges={<StatusText status={running ? 'running' : 'stopped'} />}
      subtitle={
        <>
          The launchd services behind the <code className="font-mono">container</code> CLI
        </>
      }
      tabs={TABS}
      activeTab={tab}
      onSelectTab={setTab}
      actions={
        <>
          {!running && (
            <Checkbox
              checked={installKernel}
              onChange={setInstallKernel}
              label="Install default kernel if missing"
            />
          )}
          {running ? (
            <Button
              variant="secondary"
              icon={Square}
              busy={pending === 'stop'}
              busyLabel="Stopping…"
              disabled={pending !== null}
              onClick={() => setConfirmingStop(true)}
            >
              Stop services
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={Play}
              busy={pending === 'start'}
              busyLabel="Starting…"
              disabled={pending !== null}
              onClick={() =>
                void run(
                  'start',
                  () => api.startSystem(installKernel),
                  'Container services started'
                )
              }
            >
              Start services
            </Button>
          )}
        </>
      }
    >
      {tab === 'overview' && (
        <DetailScroll>
          {/* What the page is opened to find out, before anything is read: how
              much of the disk this has taken and how much of that is waste. */}
          {running && usage && (
            <>
              {/* Three tiles, each with its own way of being cleaned. The
                  reclaimable total that used to sit in a fourth is gone: it
                  was one number standing for three different promises, and the
                  single button under it freed images, volumes and containers
                  together -- so a press meant to recover disk from images
                  could take a volume's only copy of its data with it.

                  The disk breakdown bar went with it. Three tiles already say
                  what three slices said, and the bar said it a second time
                  underneath. */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {/* "Unpacked", because this is not the number the Images page
                    shows and the two looked like they contradicted each other
                    by a factor of eighty.

                    Both are true. The Images page adds up compressed layers --
                    what was downloaded. This adds up the snapshots those
                    layers are extracted into for a container to run from, and
                    each one is an ext4 filesystem that costs about a gigabyte
                    however small the image was. */}
                <StatTile
                  label="Image snapshots"
                  value={bytesToLabel(usage.images.sizeInBytes)}
                  percent={share(usage.images.sizeInBytes, onDisk)}
                  note={`${usage.images.active} of ${usage.images.total} in use`}
                  title="Each image unpacked into a filesystem it can run from. Not the compressed download the Images page adds up, which is far smaller."
                  action={
                    <CleanButton
                      bytes={usage.images.reclaimable}
                      busy={pending === 'clean-images'}
                      disabled={pending !== null}
                      onClick={() => setCleaning('images')}
                    />
                  }
                />
                <StatTile
                  label="Volume data"
                  value={bytesToLabel(usage.volumes.sizeInBytes)}
                  title="What containers have written to the volumes you created. Nothing else keeps a copy."
                  percent={share(usage.volumes.sizeInBytes, onDisk)}
                  tone="ink"
                  note={`${usage.volumes.active} of ${usage.volumes.total} in use`}
                  action={
                    <CleanButton
                      bytes={usage.volumes.reclaimable}
                      busy={pending === 'clean-volumes'}
                      disabled={pending !== null}
                      onClick={() => setCleaning('volumes')}
                    />
                  }
                />
                <StatTile
                  label="Container filesystems"
                  value={bytesToLabel(usage.containers.sizeInBytes)}
                  title="What each container has written since it started, on top of the image it came from."
                  percent={share(usage.containers.sizeInBytes, onDisk)}
                  tone="emerald"
                  note={`${usage.containers.active} of ${usage.containers.total} running`}
                  action={
                    <CleanButton
                      bytes={usage.containers.reclaimable}
                      busy={pending === 'clean-containers'}
                      disabled={pending !== null}
                      onClick={() => setCleaning('containers')}
                    />
                  }
                />
              </div>
            </>
          )}

          <DetailSections>
            <Section title="Services">
              <Row label="State" value={status?.status ?? 'unknown'} />
              <Row label="API server" value={status?.apiServerVersion} />
              <Row label="Build" value={status?.apiServerBuild} />
              <Row label="Transport" value="JSON-RPC over stdio" />
            </Section>

            <Section title="Apple Container CLI" plain>
              <Row label="Version" value={toolchain?.version ?? status?.cliVersion} />
              <Row
                label="Installed with"
                value={toolchain?.managedBy === 'homebrew' ? 'Homebrew' : 'manually'}
              />

              {/* Three things this can say, and the colour is which one it
                  is. Red is not "there is an update", it is "this CLI is
                  older than Dermaga is written for" -- a different sentence,
                  and the reason something else is already misbehaving. Amber
                  is the offer. Everything else is grey, because it is a
                  reading rather than news. */}
              {toolchain?.belowMinimum ? (
                <div className="flex flex-col items-start gap-2 pt-1">
                  <p className="text-tiny leading-relaxed text-brand-600 dark:text-brand-400">
                    Dermaga is written for {toolchain.minimumVersion} or newer. Parts of the app may
                    not work against {toolchain.version}.
                  </p>
                  {upgradeButton}
                  <CommandProgress {...update} />
                </div>
              ) : toolchain?.updateAvailable ? (
                <div className="flex flex-col items-start gap-2 pt-1">
                  <p className="text-tiny text-amber-600 dark:text-amber-500">
                    Version {toolchain.latestVersion} is available.
                  </p>
                  {upgradeButton}
                  <CommandProgress {...update} />
                </div>
              ) : (
                <p className="pt-1 text-tiny text-ink-600 dark:text-ink-400">
                  {toolchain?.checkError
                    ? 'Could not check for updates.'
                    : toolchain?.managedBy === 'homebrew'
                      ? 'Up to date.'
                      : 'Updates are managed outside Dermaga.'}
                </p>
              )}
            </Section>

            <Section title="Paths">
              <Row label="Config file" value={configPath} mono copyable wide />
              <Row label="App root" value={status?.appRoot} mono copyable wide />
              <Row label="Install root" value={status?.installRoot} mono copyable wide />
              <Row label="Log root" value={status?.logRoot || 'macOS log facility'} mono wide />
            </Section>

            {/* No button to tidy this up with. Results for images that have
                been deleted are dropped by the sweep that already runs when
                anything changes, so by the time somebody came to this page to
                press it there was nothing left for it to do. */}
            <Section title="Vulnerability scans">
              <Row
                label="Scanner"
                value={scanner?.version ? `Trivy ${scanner.version}` : 'not installed yet'}
              />
              <Row
                label="Database"
                value={
                  scanner?.databaseUpdatedAt
                    ? `updated ${formatDuration(scanner.databaseUpdatedAt)} ago`
                    : 'not downloaded yet'
                }
              />
              <Row label="Images scanned" value={String(scanCount)} />
            </Section>

            {running && !usage && (
              <Section title="Disk usage" span plain>
                <p className="text-xs text-ink-600 dark:text-ink-400">Disk usage unavailable.</p>
              </Section>
            )}

            {!running && (
              <Section title="Disk usage" span plain>
                <p className="text-xs text-ink-600 dark:text-ink-400">
                  Start the services to read disk usage.
                </p>
              </Section>
            )}
          </DetailSections>
        </DetailScroll>
      )}

      {tab === 'logs' && (
        <DetailPane>
          <LogPane method="system.logs" params={{ last: '30m' }} />
        </DetailPane>
      )}

      {cleaning && (
        <ConfirmDialog
          title={CLEANUP[cleaning].title(doomed)}
          body={CLEANUP[cleaning].body(doomed)}
          confirmLabel={CLEANUP[cleaning].confirm}
          onConfirm={() => {
            const kind = cleaning;
            setCleaning(null);
            void run(
              `clean-${kind}`,
              async () => {
                const { freedBytes } = await api.pruneSystem(kind);
                return freedBytes > 0
                  ? `Reclaimed ${bytesToLabel(freedBytes)}`
                  : 'Nothing to reclaim — all of it is still in use';
              },
              'Reclaimed unused space'
            );
          }}
          onCancel={() => setCleaning(null)}
        />
      )}

      {confirmingStop && (
        <ConfirmDialog
          title="Stop container services?"
          body="Every running container stops with them, and Dermaga cannot manage anything until the services are started again."
          confirmLabel="Stop services"
          onConfirm={() => {
            setConfirmingStop(false);
            void run('stop', () => api.stopSystem(), 'Container services stopped');
          }}
          onCancel={() => setConfirmingStop(false)}
        />
      )}
    </DetailLayout>
  );
}

/**
 * Frees what one tile is holding, or says there is nothing to free.
 *
 * Present even at zero, and disabled: a control that appears only when there
 * is work to do is a control nobody learns is there, and its absence reads as
 * a missing feature rather than as a tidy machine.
 */
function CleanButton({
  bytes,
  busy,
  disabled,
  onClick,
}: {
  bytes: number;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  if (bytes <= 0) {
    return <p className="text-xs text-ink-500">Nothing to free</p>;
  }

  return (
    <Button
      icon={Trash2}
      busy={busy}
      busyLabel="Freeing…"
      disabled={disabled}
      className="text-orange-700 dark:text-orange-500"
      onClick={onClick}
    >
      Free {bytesToLabel(bytes)}
    </Button>
  );
}

/**
 * What each cleanup is about to do, in its own words.
 *
 * Separately worded because the consequences are not the same kind of thing.
 * An image comes back with a pull. A volume does not come back at all.
 */
const CLEANUP: Record<
  'images' | 'volumes' | 'containers',
  { title: (doomed: string[]) => string; body: (doomed: string[]) => string; confirm: string }
> = {
  images: {
    title: (doomed) => `Delete ${doomed.length} unused image${doomed.length === 1 ? '' : 's'}?`,
    body: (doomed) =>
      doomed.length > 0
        ? `These are deleted and have to be pulled again: ${doomed.join(', ')}. Anything built here and never pushed cannot be recovered.`
        : 'Every image no container is using is deleted, and has to be pulled again.',
    confirm: 'Delete images',
  },
  volumes: {
    title: () => 'Delete volumes nothing is using?',
    body: () =>
      'A volume holds the only copy of whatever was written to it, and deleting one cannot be undone — there is nowhere to pull it back from. Volumes still mounted by a container are left alone.',
    confirm: 'Delete volumes',
  },
  containers: {
    title: () => 'Remove stopped containers?',
    body: () =>
      'Containers that are not running are removed, along with anything written to their filesystems. Named volumes they mounted survive, and the images they came from are untouched.',
    confirm: 'Remove containers',
  },
};
