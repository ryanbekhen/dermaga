import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import { api } from '../services/api';
import { onNotify } from '../services/ipc';
import type { Settings } from '../types';
import { DEFAULT_PROJECT } from '../utils/projects';

export type Theme = Settings['theme'];

interface SettingsState extends Settings {
  setTheme: (theme: Theme) => void;
  setActiveProject: (activeProject: string) => void;
  setShowStopped: (show: boolean) => void;
  setLogTail: (lines: number) => void;
  setConfirmDestructive: (confirm: boolean) => void;
  setNotifyOnExit: (notify: boolean) => void;
  setNotifyOnFinish: (notify: boolean) => void;
  setNotifyOnUpdate: (notify: boolean) => void;
  setTemplatesUrl: (url: string) => void;
  setShowBuilder: (show: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

type Persisted = Settings;

/**
 * Set while a change that came *from* the file is being applied.
 *
 * Writing one of those back is not merely wasteful, it is a fight. The agent
 * announces every save, so a value written back comes round again, and if
 * anything here corrects what arrived -- the switcher does, when the project is
 * one this window has not been told about yet -- the correction and the echo
 * take turns forever. It did: two values, alternating, hundreds of times a
 * second, until the app was killed.
 *
 * A plain variable and not state, because the whole of its life is the one
 * synchronous `setState` below.
 */
let applying = false;

/**
 * Preferences are stored by the agent in ~/.dermaga/config.json rather than in
 * browser storage, so they survive a reinstall and can be edited by hand. The
 * store hydrates from that file on load and writes back on every change of its
 * own.
 */
const fileStorage: PersistStorage<Persisted> = {
  getItem: async () => {
    try {
      const { settings } = await api.getSettings();
      return settings ? { state: settings, version: 1 } : null;
    } catch {
      // Agent not up yet: fall back to the defaults below.
      return null;
    }
  },
  setItem: async (_name, value) => {
    if (applying) return;

    try {
      await api.saveSettings(value.state);
    } catch {
      // A failed write should not break the interaction that caused it.
    }
  },
  removeItem: async () => {},
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      showStopped: true,
      logTail: 200,
      confirmDestructive: true,
      notifyOnExit: true,
      notifyOnFinish: true,
      notifyOnUpdate: true,
      sidebarCollapsed: false,
      templatesUrl: '',
      showBuilder: true,
      activeProject: DEFAULT_PROJECT,
      setTheme: (theme) => set({ theme }),
      setShowStopped: (showStopped) => set({ showStopped }),
      setLogTail: (logTail) => set({ logTail }),
      setConfirmDestructive: (confirmDestructive) => set({ confirmDestructive }),
      setNotifyOnExit: (notifyOnExit) => set({ notifyOnExit }),
      setNotifyOnFinish: (notifyOnFinish) => set({ notifyOnFinish }),
      setNotifyOnUpdate: (notifyOnUpdate) => set({ notifyOnUpdate }),
      setTemplatesUrl: (templatesUrl) => set({ templatesUrl }),
      setShowBuilder: (showBuilder) => set({ showBuilder }),
      setActiveProject: (activeProject) => set({ activeProject }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
    }),
    {
      name: 'dermaga.settings',
      version: 1,
      storage: fileStorage,
      partialize: (state): Persisted => ({
        theme: state.theme,
        showStopped: state.showStopped,
        logTail: state.logTail,
        confirmDestructive: state.confirmDestructive,
        notifyOnExit: state.notifyOnExit,
        notifyOnFinish: state.notifyOnFinish,
        notifyOnUpdate: state.notifyOnUpdate,
        sidebarCollapsed: state.sidebarCollapsed,
        templatesUrl: state.templatesUrl,
        showBuilder: state.showBuilder,
        activeProject: state.activeProject,
      }),
    }
  )
);

/**
 * Preferences changed somewhere other than here.
 *
 * This store hydrates from the file once and then only writes to it, which was
 * true for as long as the window was the only thing that ever wrote. The menu
 * bar switches project now, and a window that went on filtering by the project
 * it happened to open with would be a sidebar naming one point of view over a
 * list showing another.
 *
 * Applied only where it differs, and applied without being written back --
 * this window's own save arrives here as well, and a file that answers its own
 * echo never settles.
 */
export function subscribeToSettings(): () => void {
  return onNotify((message) => {
    if (message.method !== 'settings.changed') return;

    const next = (message.params as { settings?: Settings } | undefined)?.settings;
    if (!next) return;

    const current = useSettingsStore.getState();
    const changed = (Object.keys(next) as (keyof Settings)[]).filter(
      (key) => next[key] !== current[key]
    );

    if (changed.length === 0) return;

    applying = true;
    try {
      useSettingsStore.setState(
        Object.fromEntries(changed.map((key) => [key, next[key]])) as Partial<Settings>
      );
    } finally {
      applying = false;
    }
  });
}
