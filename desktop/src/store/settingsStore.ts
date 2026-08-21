import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import { api } from '../services/api';
import type { Settings } from '../types';

export type Theme = Settings['theme'];

interface SettingsState extends Settings {
  setTheme: (theme: Theme) => void;
  setShowStopped: (show: boolean) => void;
  setLogTail: (lines: number) => void;
  setConfirmDestructive: (confirm: boolean) => void;
  setNotifyOnExit: (notify: boolean) => void;
  setTemplatesUrl: (url: string) => void;
  setShowBuilder: (show: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

type Persisted = Settings;

/**
 * Preferences are stored by the agent in ~/.dermaga/config.json rather than in
 * browser storage, so they survive a reinstall and can be edited by hand. The
 * store hydrates from that file on load and writes back on every change.
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
      sidebarCollapsed: false,
      templatesUrl: '',
      showBuilder: true,
      setTheme: (theme) => set({ theme }),
      setShowStopped: (showStopped) => set({ showStopped }),
      setLogTail: (logTail) => set({ logTail }),
      setConfirmDestructive: (confirmDestructive) => set({ confirmDestructive }),
      setNotifyOnExit: (notifyOnExit) => set({ notifyOnExit }),
      setTemplatesUrl: (templatesUrl) => set({ templatesUrl }),
      setShowBuilder: (showBuilder) => set({ showBuilder }),
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
        sidebarCollapsed: state.sidebarCollapsed,
        templatesUrl: state.templatesUrl,
        showBuilder: state.showBuilder,
      }),
    }
  )
);
