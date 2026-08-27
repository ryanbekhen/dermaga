import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notification } from '../services/ipc';

const saveSettings = vi.fn(async (settings: unknown) => ({ settings, path: '' }));
const listeners: ((message: Notification) => void)[] = [];

vi.mock('../services/api', () => ({
  api: {
    getSettings: async () => ({ settings: null, path: '' }),
    saveSettings: (settings: unknown) => saveSettings(settings),
  },
}));

vi.mock('../services/ipc', () => ({
  onNotify: (callback: (message: Notification) => void) => {
    listeners.push(callback);

    return () => listeners.splice(listeners.indexOf(callback), 1);
  },
}));

const { subscribeToSettings, useSettingsStore } = await import('./settingsStore');

function push(settings: Record<string, unknown>) {
  for (const listener of [...listeners]) {
    listener({ method: 'settings.changed', params: { settings, path: '' } } as Notification);
  }
}

/**
 * The preferences file is shared: this window, and the menu bar item that can
 * switch project without one being open.
 */
describe('a preference changed somewhere else', () => {
  beforeEach(() => {
    saveSettings.mockClear();
    useSettingsStore.setState({ activeProject: 'default', showBuilder: true });
    saveSettings.mockClear();
  });

  it('reaches the window that is already open', () => {
    const stop = subscribeToSettings();

    push({ activeProject: 'bengkel', showBuilder: true });

    expect(useSettingsStore.getState().activeProject).toBe('bengkel');

    stop();
  });

  /**
   * The one that has to hold. Every save is announced to everybody, so a value
   * written back arrives again -- and anything here that corrects what arrived
   * then takes turns with the echo forever. It did exactly that once: two
   * projects alternating hundreds of times a second, and a config file being
   * rewritten as fast as it could be read.
   */
  it('is not written back to the file it came from', () => {
    const stop = subscribeToSettings();

    push({ activeProject: 'bengkel', showBuilder: true });

    expect(saveSettings).not.toHaveBeenCalled();

    stop();
  });

  it('is ignored when it says what this window already thinks', () => {
    const stop = subscribeToSettings();

    push({ activeProject: 'default', showBuilder: true });

    expect(saveSettings).not.toHaveBeenCalled();

    stop();
  });

  // And a change made here is still written: suppressing the echo must not
  // suppress the point of the store.
  it("leaves this window's own change to be saved as before", () => {
    const stop = subscribeToSettings();

    useSettingsStore.getState().setActiveProject('toko');

    expect(saveSettings).toHaveBeenCalledTimes(1);

    stop();
  });
});
