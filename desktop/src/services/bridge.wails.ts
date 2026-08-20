/**
 * The window's side of the bridge.
 *
 * `ipc.ts` talks to `window.dermaga` and knows nothing about what is behind it.
 * Behind it is the Go process the app is already made of: the same one that
 * speaks to the agent. This file is the whole of the connection.
 */
import { Call, Events, Flags } from '@wailsio/runtime';

/**
 * Every bridge method is a Go method on one bound service.
 *
 * The name of that service comes from Go rather than being written out here:
 * Wails names a bound method after the package it is declared in, so writing it
 * on this side means a call that breaks at runtime the day that package moves.
 */
const bridge = Flags.GetFlag('bridge') as string;

function call<T>(method: string, ...args: unknown[]): Promise<T> {
  return Call.ByName(`${bridge}.${method}`, ...args) as Promise<T>;
}

/**
 * Subscribes to a Wails event and hands back the unsubscribe, which is the
 * shape every listener in `ipc.ts` expects.
 */
function on<T>(name: string, callback: (data: T) => void): () => void {
  return Events.On(name, (event) => callback(event.data as T));
}

/** An empty string from Go is an absent value here. */
function orNull(value: string): string | null {
  return value === '' ? null : value;
}

/**
 * Paths of the files most recently dropped on the window.
 *
 * A dropped File carries no path of its own, and under Wails the paths do not
 * travel with the DOM event at all -- they arrive from the Go side, which is
 * the only place that sees the real drag. They are collected here and consumed
 * in order by the drop handler that fires a moment later.
 */
let droppedPaths: string[] = [];
let droppedCursor = 0;

Events.On('dermaga:files-dropped', (event) => {
  droppedPaths = (event.data as { paths?: string[] })?.paths ?? [];
  droppedCursor = 0;
});

interface ServiceStatusFromGo {
  installed: boolean;
  binary: string;
  socket: string;
  running: boolean;
  stale: boolean;
  missing: boolean;
}

async function serviceCall(method: string) {
  const status = await call<ServiceStatusFromGo>(method);

  return { ...status, binary: orNull(status.binary), socket: orNull(status.socket) };
}

window.dermaga = {
  platform: 'darwin',

  invoke: (method, params) => call('Invoke', method, params ?? null),

  onNotify: (callback) => on('dermaga:notify', callback),

  isFullScreen: () => call('IsFullScreen'),
  onFullScreenChange: (callback) =>
    on<boolean>('dermaga:fullscreen', (value) => callback(Boolean(value))),

  syncSettings: (settings) => {
    void call('SyncSettings', settings.notifyOnExit);
  },

  openNotificationSettings: () => call('OpenNotificationSettings'),

  takePendingOpen: async () => orNull(await call<string>('TakePendingOpen')),
  onOpenContainer: (callback) => on<string>('dermaga:open-container', callback),

  serviceStatus: () => serviceCall('ServiceStatus'),
  installService: () => serviceCall('InstallService'),
  uninstallService: () => serviceCall('UninstallService'),

  getOpenAtLogin: () => call('GetOpenAtLogin'),
  setOpenAtLogin: (value) => call('SetOpenAtLogin', value),

  pickDirectory: async (title) => orNull(await call<string>('PickDirectory', title ?? '')),
  pickSaveFile: async ({ title, defaultName, extension } = {}) =>
    orNull(await call<string>('PickSaveFile', title ?? '', defaultName ?? '', extension ?? '')),
  pickFile: async ({ title, extension } = {}) =>
    orNull(await call<string>('PickFile', title ?? '', extension ?? '')),

  pathForFile: () => droppedPaths[droppedCursor++] ?? '',
  onFilesDropped: (callback) =>
    on<{ paths?: string[]; target?: string }>('dermaga:files-dropped', (data) =>
      callback(data?.paths ?? [], data?.target ?? '')
    ),

  checkUpdate: () => call('CheckUpdate'),
  downloadUpdate: (assetUrl, version) => call('DownloadUpdate', assetUrl, version),
  installUpdate: (dmgPath) => call('InstallUpdate', dmgPath),
  onUpdateProgress: (callback) => on('dermaga:update-progress', callback),
};

/**
 * Tells the Go side the window has something on it, so the splash can stand
 * down. A window revealed before it has painted is worse than one revealed a
 * moment late.
 */
export function announceReady(): void {
  void Events.Emit('dermaga:ready', null);
}
