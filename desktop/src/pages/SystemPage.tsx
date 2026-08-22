import { useCallback, useEffect, useState } from 'react';
import { ArrowUpCircle, Play, Square, Trash2 } from 'lucide-react';
import { Button } from '../components/Button';
import { CommandProgress, useCommandProgress } from '../components/CommandProgress';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LogPane } from '../components/LogPane';
import { Row, Section } from '../components/DetailRow';
import { StatusPill } from '../components/StatusBadge';
import { DiskBreakdown, StatTile } from '../components/StatTile';
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
  const [toolchain, setToolchain] = useState<ToolchainStatus | null>(null);
  const update = useCommandProgress('toolchain.update');
  const [pending, setPending] = useState<'start' | 'stop' | 'prune' | null>(null);
  const [installKernel, setInstallKernel] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [confirmingPrune, setConfirmingPrune] = useState(false);
  const scanner = useScannerStore((s) => s.status);
  const reports = useScannerStore((s) => s.reports);
  const scanCount = Object.keys(reports).length;
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
      setToolchain(await api.getToolchain());
    } catch {
      setToolchain(null);
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

  const run = async (
    action: 'start' | 'stop' | 'prune',
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

  const reclaimable =
    (usage?.containers.reclaimable ?? 0) +
    (usage?.images.reclaimable ?? 0) +
    (usage?.volumes.reclaimable ?? 0);

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
      badges={<StatusPill status={running ? 'running' : 'stopped'} />}
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
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatTile
                  label="Images"
                  value={bytesToLabel(usage.images.sizeInBytes)}
                  percent={share(usage.images.sizeInBytes, onDisk)}
                  note={`${usage.images.active} of ${usage.images.total} in use`}
                />
                <StatTile
                  label="Volumes"
                  value={bytesToLabel(usage.volumes.sizeInBytes)}
                  percent={share(usage.volumes.sizeInBytes, onDisk)}
                  tone="ink"
                  note={`${usage.volumes.active} of ${usage.volumes.total} in use`}
                />
                <StatTile
                  label="Containers"
                  value={bytesToLabel(usage.containers.sizeInBytes)}
                  percent={share(usage.containers.sizeInBytes, onDisk)}
                  tone="emerald"
                  note={`${usage.containers.active} of ${usage.containers.total} running`}
                />
                <StatTile
                  label="Reclaimable"
                  value={bytesToLabel(reclaimable)}
                  note={
                    reclaimable > 0 ? (
                      <span className="text-brand-700 dark:text-brand-400">
                        Unused images, stopped containers and loose volumes
                      </span>
                    ) : (
                      'Everything on disk is still in use'
                    )
                  }
                />
              </div>

              <Section
                title="Disk breakdown"
                span
                plain
                action={
                  reclaimable > 0 ? (
                    <Button
                      icon={Trash2}
                      busy={pending === 'prune'}
                      busyLabel="Reclaiming…"
                      disabled={pending !== null}
                      onClick={() => setConfirmingPrune(true)}
                    >
                      Delete unused · {bytesToLabel(reclaimable)}
                    </Button>
                  ) : null
                }
              >
                <DiskBreakdown
                  slices={[
                    { label: 'Images', bytes: usage.images.sizeInBytes, color: 'bg-brand-600' },
                    { label: 'Volumes', bytes: usage.volumes.sizeInBytes, color: 'bg-brand-400' },
                    {
                      label: 'Containers',
                      bytes: usage.containers.sizeInBytes,
                      color: 'bg-ink-800 dark:bg-ink-300',
                    },
                  ]}
                />
              </Section>
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

              {toolchain?.updateAvailable ? (
                <div className="flex flex-col items-start gap-2 pt-1">
                  <p className="text-tiny text-ink-600 dark:text-ink-400">
                    Version {toolchain.latestVersion} is available.
                  </p>
                  <Button
                    icon={ArrowUpCircle}
                    busy={update.state === 'running'}
                    busyLabel="Updating…"
                    onClick={() =>
                      void update.run((failed) => {
                        if (failed) return;
                        pushToast(`Updated to ${toolchain.latestVersion}`);
                        void loadToolchain();
                      })
                    }
                  >
                    Update to {toolchain.latestVersion}
                  </Button>
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

      {confirmingPrune && (
        <ConfirmDialog
          title={`Delete ${doomed.length} unused image${doomed.length === 1 ? '' : 's'}?`}
          body={
            doomed.length > 0
              ? `These are deleted and have to be pulled again: ${doomed.join(', ')}. Stopped containers and unused volumes and networks go too. Anything built here and never pushed cannot be recovered.`
              : 'Stopped containers and unused volumes and networks are removed. No images are affected.'
          }
          confirmLabel="Reclaim"
          onConfirm={() => {
            setConfirmingPrune(false);
            void run(
              'prune',
              async () => {
                const { freedBytes } = await api.pruneSystem();
                return freedBytes > 0
                  ? `Reclaimed ${bytesToLabel(freedBytes)}`
                  : 'Nothing to reclaim — everything on disk is still in use';
              },
              'Reclaimed unused resources'
            );
          }}
          onCancel={() => setConfirmingPrune(false)}
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
