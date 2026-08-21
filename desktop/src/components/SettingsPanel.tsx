import { useEffect, useState, type ReactNode } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from './Button';
import type { ServiceStatus } from '../services/ipc';
import {
  getOpenAtLogin,
  installService,
  openNotificationSettings,
  serviceStatus,
  setOpenAtLogin,
  uninstallService,
} from '../services/ipc';
import { useToastStore } from '../store/toastStore';
import { useSettingsStore, type Theme } from '../store/settingsStore';
import { SegmentedControl, type Segment } from './SegmentedControl';

const THEMES: Segment<Theme>[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function SettingsPanel() {
  const settings = useSettingsStore();
  return (
    <div className="-mr-5 min-h-0 flex-1 overflow-y-auto pr-5">
      {/* Centred and column-limited: a wide window should not leave the
          settings pinned to the left edge with an ocean of empty space. */}
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <header>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-tiny text-ink-600 dark:text-ink-400">
            Stored locally on this Mac and applied immediately.
          </p>
        </header>

        <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
          <Card title="Appearance" hint="System follows the macOS light/dark setting.">
            <SegmentedControl
              ariaLabel="Theme"
              segments={THEMES}
              value={settings.theme}
              onChange={settings.setTheme}
            />
          </Card>

          <Card title="Logs" hint="Lines of history requested when a stream opens.">
            <label className="flex items-center gap-3 text-sm">
              <input
                type="number"
                min={10}
                max={2000}
                step={10}
                value={settings.logTail}
                onChange={(e) => settings.setLogTail(Math.max(10, Number(e.target.value) || 10))}
                className="input w-28"
              />
              <span className="text-xs text-ink-600 dark:text-ink-400">lines</span>
            </label>
          </Card>

          <Card title="Startup" hint="Managed by macOS; System Settings shows it too.">
            <OpenAtLogin />
            <BackgroundService />
          </Card>

          <Card title="Behaviour">
            <Toggle
              checked={settings.showStopped}
              onChange={settings.setShowStopped}
              label="Show stopped containers in the list"
            />
            <Toggle
              checked={settings.confirmDestructive}
              onChange={settings.setConfirmDestructive}
              label="Ask before removing a container"
            />
            <Toggle
              checked={settings.notifyOnExit}
              onChange={settings.setNotifyOnExit}
              label="Notify when a container stops on its own"
            />

            {settings.notifyOnExit && (
              <p className="text-tiny leading-relaxed text-ink-600 dark:text-ink-400">
                Shown by macOS, which can refuse them.{' '}
                <button
                  onClick={() => void openNotificationSettings()}
                  className="text-brand-700 hover:underline dark:text-brand-400"
                >
                  Open notification settings
                </button>{' '}
                if they are not arriving.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Unboxed group, matching the detail pages: a ruled heading and its content. */
function Card({
  title,
  hint,
  icon: Icon,
  children,
}: {
  title: string;
  hint?: string;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2 border-b border-ink-200 pb-1 dark:border-ink-700">
        {Icon && <Icon size={12} className="text-brand-600" aria-hidden />}
        <h2 className="label-caps">{title}</h2>
      </div>
      {hint && <p className="-mt-1 text-tiny text-ink-600 dark:text-ink-400">{hint}</p>}
      {children}
    </section>
  );
}

/**
 * Whether macOS opens Dermaga at login.
 *
 * Read from macOS rather than kept in our settings file, so a change made in
 * System Settings is reflected here instead of contradicted. Opened that way,
 * Dermaga starts in the menu bar with no window: nobody logging in asked for
 * one.
 *
 * This is the setting that matters to most people. Opening at login starts the
 * agent as part of starting the app, so the containers marked to start come up
 * and notifications work -- which is why the background service below has to
 * say plainly that it is only for quitting Dermaga and keeping the agent. Two
 * toggles that sound alike are two toggles everybody switches on to be safe.
 */
function OpenAtLogin() {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void getOpenAtLogin().then((value) => {
      setEnabled(value);
      setReady(true);
    });
  }, []);

  return (
    <>
      <Toggle
        checked={enabled}
        onChange={(value) => {
          // The answer is what macOS says afterwards, not what was asked for.
          setEnabled(value);
          void setOpenAtLogin(value).then(setEnabled);
        }}
        label="Open Dermaga at login"
        disabled={!ready}
      />
      {enabled && (
        <p className="text-tiny leading-relaxed text-ink-600 dark:text-ink-400">
          It starts in the menu bar with no window, brings up the containers you marked to start
          with Dermaga, and says when one stops on its own.
        </p>
      )}
    </>
  );
}

/**
 * The agent as a launchd service.
 *
 * Without it the agent belongs to this window: close Dermaga and nothing is
 * watching your containers. With it the agent starts at login and keeps
 * watching, which is what a restart policy needs to mean anything. Opt-in,
 * because a background process nobody asked for is not a feature.
 */
function BackgroundService() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    void serviceStatus().then(setStatus);
  }, []);

  const change = async (wanted: boolean) => {
    setBusy(true);

    try {
      const next = wanted ? await installService() : await uninstallService();
      setStatus(next);
      pushToast(
        next.installed ? 'Dermaga keeps watching in the background' : 'Background service removed'
      );
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not change the service', 'error');
    } finally {
      setBusy(false);
    }
  };

  const installed = status?.installed ?? false;

  return (
    <>
      <Toggle
        checked={installed}
        onChange={(value) => void change(value)}
        label="Keep the agent running when Dermaga is quit"
        disabled={!status || busy}
      />

      {/* A service points at the copy of Dermaga that installed it. Move that
          copy, delete it, or switch between a development build and an
          installed one, and it goes on pointing where it was -- so say so,
          rather than leave a service that is switched on and serving nobody. */}
      {installed && (status?.missing || status?.stale) && (
        <div className="flex flex-col items-start gap-1.5 rounded-md border border-orange-600/40 bg-orange-600/5 p-2">
          <p className="text-tiny leading-relaxed text-ink-700 dark:text-ink-300">
            {status.missing
              ? 'The service points at a copy of Dermaga that is no longer there, so it cannot start:'
              : 'The service belongs to a different copy of Dermaga, so it is not the agent this window is talking to:'}
          </p>
          {/* On its own line and scrolling rather than wrapping. This path is
              here to be read and compared against another one, and a path
              broken across two lines -- at the hyphen in "dermaga-agent", of
              all places -- is a path that can be misread. */}
          <code className="block w-full overflow-x-auto whitespace-nowrap rounded bg-ink-500/10 px-1.5 py-1 font-mono text-tiny">
            {status.binary}
          </code>
          <Button busy={busy} busyLabel="Pointing…" onClick={() => void change(true)}>
            Point it at this copy
          </Button>
        </div>
      )}

      <p className="text-tiny leading-relaxed text-ink-600 dark:text-ink-400">
        {installed
          ? 'A small background process, started at login by macOS. It watches your containers and brings up the ones you marked, with no Dermaga running at all. Turning it off puts the agent back inside the app.'
          : 'Only matters if you quit Dermaga. Opening at login already brings your containers up and keeps watching them — this is for wanting that without the app.'}
      </p>
    </>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  /** While the real value is still being read back from macOS. */
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2.5 text-sm ${disabled ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-brand-600"
      />
      {label}
    </label>
  );
}
