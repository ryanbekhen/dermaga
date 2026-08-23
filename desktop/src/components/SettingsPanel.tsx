import { useEffect, useState, type ReactNode } from 'react';
import { LayoutGrid, Monitor, Moon, Power, ScrollText, Sliders, Sun } from 'lucide-react';
import { Button } from './Button';
import { PageHeader } from './PageHeader';
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
import { Tabs, type TabDefinition } from './Tabs';

const THEMES: Segment<Theme>[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

// Tabs, not a rail. A column of destinations down the left of the content is
// what the window already has one of, and a second one three inches from the
// first read as a sidebar inside a sidebar -- two lists of places, at two
// depths, drawn the same way. Every other page that shows one thing several
// ways uses these, so Settings does too.
const TABS: TabDefinition[] = [
  { id: 'general', label: 'General', icon: Sliders },
  { id: 'startup', label: 'Startup', icon: Power },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'templates', label: 'Templates', icon: LayoutGrid },
];

export function SettingsPanel() {
  const settings = useSettingsStore();
  const [pane, setPane] = useState('general');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* No Apply button, and nothing to revert: every setting here takes
          effect as it is changed and is written to ~/.dermaga/config.json.
          A pair of buttons that had nothing to commit would be an invitation
          to wonder whether the change had taken. */}
      <PageHeader
        title="Settings"
        subtitle="Stored on this Mac, in ~/.dermaga/config.json, and applied as you change them"
      />

      <div className="shrink-0 border-b border-ink-200 bg-ink-50 dark:border-ink-800 dark:bg-ink-900/50">
        <Tabs tabs={TABS} active={pane} onSelect={setPane} />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          <div className="flex max-w-2xl flex-col gap-6">
            {pane === 'general' && (
              <>
                <Group label="Appearance">
                  <Setting
                    label="Theme"
                    hint="System follows the macOS light and dark setting."
                    control={
                      <SegmentedControl
                        iconOnly
                        ariaLabel="Theme"
                        segments={THEMES}
                        value={settings.theme}
                        onChange={settings.setTheme}
                      />
                    }
                  />
                </Group>

                <Group label="Behaviour">
                  <Setting
                    label="Ask before removing a container"
                    hint="A removed container cannot be brought back."
                    control={
                      <Switch
                        checked={settings.confirmDestructive}
                        onChange={settings.setConfirmDestructive}
                        label="Ask before removing a container"
                      />
                    }
                  />
                  <Setting
                    label="Notify when a container stops on its own"
                    hint={
                      settings.notifyOnExit ? (
                        <>
                          Shown by macOS, which can refuse them.{' '}
                          <button
                            onClick={() => void openNotificationSettings()}
                            className="text-brand-700 hover:underline dark:text-brand-400"
                          >
                            Open notification settings
                          </button>{' '}
                          if they are not arriving.
                        </>
                      ) : (
                        'Something that exits without being asked to is worth knowing about.'
                      )
                    }
                    control={
                      <Switch
                        checked={settings.notifyOnExit}
                        onChange={settings.setNotifyOnExit}
                        label="Notify when a container stops on its own"
                      />
                    }
                  />
                  {/* The other half, and deliberately its own switch: one is
                      something going wrong while nobody watched, the other is
                      something asked for being done. Somebody can reasonably
                      want either without the other. */}
                  <Setting
                    label="Notify when something finishes"
                    hint="An image built or pulled, a container or a machine made — and whether it worked. A build takes minutes, which is long enough to have gone somewhere else."
                    control={
                      <Switch
                        checked={settings.notifyOnFinish}
                        onChange={settings.setNotifyOnFinish}
                        label="Notify when something finishes"
                      />
                    }
                  />
                </Group>
              </>
            )}

            {pane === 'startup' && (
              <Group
                label="Startup"
                hint="Managed by macOS; System Settings shows both of these too."
              >
                <OpenAtLogin />
                <BackgroundService />
              </Group>
            )}

            {pane === 'logs' && (
              <Group label="Logs">
                <Setting
                  label="History on open"
                  hint="Lines requested when a log or terminal stream starts."
                  control={
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="number"
                        min={10}
                        max={2000}
                        step={10}
                        value={settings.logTail}
                        onChange={(e) =>
                          settings.setLogTail(Math.max(10, Number(e.target.value) || 10))
                        }
                        aria-label="Lines of history"
                        className="input h-7.5 w-24 rounded-lg text-right font-mono"
                      />
                      <span className="text-xs text-ink-600 dark:text-ink-400">lines</span>
                    </label>
                  }
                />
              </Group>
            )}

            {pane === 'templates' && (
              <Group
                label="Templates"
                hint="Where the starting points in the create form come from."
              >
                <div className="flex flex-col gap-2 px-5 py-4">
                  <label className="label-mono" htmlFor="templates-url">
                    Catalogue address
                  </label>
                  <input
                    id="templates-url"
                    value={settings.templatesUrl ?? ''}
                    onChange={(event) => settings.setTemplatesUrl(event.target.value)}
                    placeholder="https://ryanbekhen.github.io/dermaga-templates/index.json"
                    spellCheck={false}
                    className="input h-7.5 w-full rounded-lg font-mono text-tiny"
                  />
                  <p className="wrap-break-word text-tiny leading-relaxed text-ink-600 dark:text-ink-400">
                    Leave it empty for Dermaga&rsquo;s own. A catalogue is a static JSON file, so a
                    team with its own images can publish one and point at it here.
                  </p>
                </div>
              </Group>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A mono-caps label with a panel of settings under it.
 *
 * The label sits outside the panel rather than inside it: what is written
 * there is the name of a group, not the title of a card, and a heading printed
 * on the same surface as the rows reads as the first of them.
 */
function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div>
        <h2 className="label-mono">{label}</h2>
        {hint && <p className="pt-1 text-tiny text-ink-600 dark:text-ink-400">{hint}</p>}
      </div>
      <div className="divide-y divide-ink-150 rounded-xl border border-ink-200 bg-white dark:divide-ink-800 dark:border-ink-800 dark:bg-ink-900">
        {children}
      </div>
    </section>
  );
}

/** One setting: what it is on the left, the control that changes it on the right. */
function Setting({
  label,
  hint,
  control,
}: {
  label: string;
  hint?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center gap-5 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-item font-medium">{label}</p>
        {hint && (
          <p className="pt-0.5 text-tiny leading-relaxed text-ink-600 dark:text-ink-400">{hint}</p>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
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
    <Setting
      label="Open Dermaga at login"
      hint={
        enabled
          ? 'It starts in the menu bar with no window, brings up the containers you marked to start with Dermaga, and says when one stops on its own.'
          : 'Nothing is watching your containers until Dermaga is opened.'
      }
      control={
        <Switch
          checked={enabled}
          // The answer is what macOS says afterwards, not what was asked for.
          onChange={(value) => {
            setEnabled(value);
            void setOpenAtLogin(value).then(setEnabled);
          }}
          label="Open Dermaga at login"
          disabled={!ready}
        />
      }
    />
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
      <Setting
        label="Keep the agent running when Dermaga is quit"
        hint={
          installed
            ? 'A small background process, started at login by macOS. It watches your containers and brings up the ones you marked, with no Dermaga running at all. Turning it off puts the agent back inside the app.'
            : 'Only matters if you quit Dermaga. Opening at login already brings your containers up and keeps watching them — this is for wanting that without the app.'
        }
        control={
          <Switch
            checked={installed}
            onChange={(value) => void change(value)}
            label="Keep the agent running when Dermaga is quit"
            disabled={!status || busy}
          />
        }
      />

      {/* A service points at the copy of Dermaga that installed it. Move that
          copy, delete it, or switch between a development build and an
          installed one, and it goes on pointing where it was -- so say so,
          rather than leave a service that is switched on and serving nobody. */}
      {installed && (status?.missing || status?.stale) && (
        <div className="flex flex-col items-start gap-2 bg-orange-600/5 px-5 py-4">
          <p className="text-tiny leading-relaxed text-ink-700 dark:text-ink-300">
            {status.missing
              ? 'The service points at a copy of Dermaga that is no longer there, so it cannot start:'
              : 'The service belongs to a different copy of Dermaga, so it is not the agent this window is talking to:'}
          </p>
          {/* On its own line and scrolling rather than wrapping. This path is
              here to be read and compared against another one, and a path
              broken across two lines -- at the hyphen in "dermaga-agent", of
              all places -- is a path that can be misread. */}
          <code className="block w-full overflow-x-auto whitespace-nowrap rounded-md bg-ink-500/10 px-2 py-1 font-mono text-tiny">
            {status.binary}
          </code>
          <Button busy={busy} busyLabel="Pointing…" onClick={() => void change(true)}>
            Point it at this copy
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * On or off, drawn as the thing it is.
 *
 * A checkbox says "include this"; a switch says "this is on now". Every
 * setting on this page is the second kind -- there is nothing to submit, so
 * the control's position is the state of the machine rather than an answer
 * waiting to be sent.
 */
export function Switch({
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
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex h-5.5 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-brand-600' : 'bg-ink-300 dark:bg-ink-700'
      }`}
    >
      <span
        className={`h-4.5 w-4.5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
          checked ? 'translate-x-4.5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
