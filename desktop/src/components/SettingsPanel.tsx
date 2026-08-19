import { useEffect, useState, type ReactNode } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getOpenAtLogin, openNotificationSettings, setOpenAtLogin } from '../services/ipc';
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
          It starts in the menu bar with no window, and says when a container stops on its own.
        </p>
      )}
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
