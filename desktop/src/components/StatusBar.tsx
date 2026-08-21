import { AlertTriangle, ArrowDownToLine, Loader2, RefreshCw } from 'lucide-react';
import { useUpdate } from '../hooks/useUpdate';
import { useUIStore } from '../store/uiStore';
import { ContainerNamesItem } from './ContainerNamesItem';
import { KernelStatusItem } from './KernelStatusItem';
import { ScannerStatusItem } from './ScannerStatusItem';
import type { ConnectionState } from '../hooks/useEventStream';
import type { BuildInfo, SystemStatus } from '../types';

interface StatusBarProps {
  build: BuildInfo | null;
  system: SystemStatus | null;
  connection: ConnectionState;
  error: string | null;
}

/**
 * The one place problems are reported. Modal banners pushed the page around
 * every time the connection blinked; a fixed bar at the bottom stays out of the
 * way until something is actually wrong, then colours itself.
 */
export function StatusBar({ build, system, connection, error }: StatusBarProps) {
  const navigate = useUIStore((s) => s.navigate);

  const disconnected = connection === 'disconnected';

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between gap-4 border-t border-ink-200 bg-ink-50 px-3 text-tiny dark:border-ink-800 dark:bg-ink-900">
      {/* Only problems live here, as coloured text -- a filled block at the
          bottom of the window reads as an alarm even when nothing is wrong.
          Services being down takes over the whole page instead. */}
      <div className="flex min-w-0 items-center gap-3">
        {disconnected && (
          <Item tone="warning" icon={RefreshCw} label="Lost contact with the Dermaga agent" />
        )}
        {error && <Item tone="warning" icon={AlertTriangle} label={error} />}
      </div>

      <div className="flex shrink-0 items-center gap-3 text-ink-500">
        <ContainerNamesItem />
        <KernelStatusItem />
        <UpdatePill />
        <ScannerStatusItem />

        {system?.cliVersion && (
          <span title="Apple Container CLI">container {system.cliVersion}</span>
        )}
        {build && (
          <button
            onClick={() => navigate({ name: 'changelog' })}
            title={`${buildTitle(build)}\nClick to see what changed`}
            className="transition-colors hover:text-ink-700 dark:hover:text-ink-300"
          >
            v{build.version}
            {build.commit && build.commit !== 'unknown' && (
              <span className="ml-1.5 font-mono opacity-70">{build.commit}</span>
            )}
          </button>
        )}
      </div>
    </footer>
  );
}

/**
 * Sits quiet until an update is not only found but downloaded and checked.
 *
 * Nothing is shown while it is being fetched. Nobody asked for it, and an app
 * that announces work it decided to do on its own is asking for attention it
 * has not earned -- the only moment worth interrupting for is the one where
 * there is something to press.
 */
function UpdatePill() {
  const { update, staged, stage, error, run } = useUpdate();

  if (stage === 'idle' || stage === 'fetching') return null;

  if (stage === 'installing') {
    return (
      <span className="flex items-center gap-1.5 text-brand-600 dark:text-brand-400">
        <Loader2 size={11} className="animate-spin" aria-hidden />
        Restarting…
      </span>
    );
  }

  if (stage === 'failed') {
    return (
      <button
        onClick={() => void run()}
        title={error ?? undefined}
        className="flex items-center gap-1.5 text-amber-600 hover:underline dark:text-amber-500"
      >
        <AlertTriangle size={11} aria-hidden />
        Update failed — retry
      </button>
    );
  }

  const version = staged?.version ?? update?.version;
  if (!version) return null;

  // Downloaded, but this build cannot be swapped underneath itself -- an
  // ad-hoc signature, or an app somewhere only an administrator can write.
  // The image opens and somebody drags it across, as it always did.
  if (stage === 'manual') {
    return (
      <button
        onClick={() => void run()}
        title={`Dermaga ${version} is downloaded. Opening the installer closes Dermaga; the new version has to be dragged across.`}
        className="flex items-center gap-1.5 font-semibold text-brand-600 hover:underline dark:text-brand-400"
      >
        <ArrowDownToLine size={11} aria-hidden />v{version} ready to install
      </button>
    );
  }

  return (
    <button
      onClick={() => void run()}
      title={`Dermaga ${version} is downloaded and verified. Restarting takes a moment and installs it — containers keep running.`}
      className="flex items-center gap-1.5 font-semibold text-brand-600 hover:underline dark:text-brand-400"
    >
      <RefreshCw size={11} aria-hidden />
      Restart to update
    </button>
  );
}

/** The full build stamp, for the tooltip. */
function buildTitle(build: BuildInfo): string {
  const parts = [`Dermaga ${build.version}`];
  if (build.commit && build.commit !== 'unknown') parts.push(`commit ${build.commit}`);
  if (build.date) parts.push(`built ${build.date}`);
  return parts.join(' · ');
}

function Item({
  tone,
  icon: Icon,
  label,
}: {
  tone: 'warning' | 'danger';
  icon: typeof AlertTriangle;
  label: string;
}) {
  const tones = {
    warning: 'text-amber-600 dark:text-amber-500',
    danger: 'text-brand-600 dark:text-brand-400',
  };

  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${tones[tone]}`}>
      <Icon size={11} className="shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}
