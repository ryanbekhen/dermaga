/**
 * The window's side of the bridge.
 *
 * `ipc.ts` talks to `window.dermaga` and knows nothing about what is behind it.
 * Behind it is the Go process the app is already made of: the same one that
 * speaks to the agent. This file is the whole of the connection.
 */
import { Call, Events, Flags } from '@wailsio/runtime';
import type { Announcement } from './ipc';

/**
 * Every bridge method is a Go method on one bound service.
 *
 * The name of that service comes from Go rather than being written out here:
 * Wails names a bound method after the package it is declared in, so writing it
 * on this side means a call that breaks at runtime the day that package moves.
 */
let bridgeName = '';

/** How long to keep waiting for Go to say what the service is called. */
const bridgeTimeout = 5000;
const bridgePoll = 20;

/**
 * The bound service's name, waited for rather than read once.
 *
 * Wails hands the flags to the page by running a script in it once the window
 * has finished navigating -- which is not necessarily before the modules on
 * that page have run. Reading the flag as this module loads therefore races
 * the runtime, and losing that race used to throw here: the module never
 * finished, `window.dermaga` was never set, and the window stayed white with
 * nothing able to repair it afterwards. A reload that Vite triggers on its own
 * -- after re-optimising its dependencies, say -- is enough to land there.
 *
 * So the name is asked for when it is first wanted, and waited for if it is
 * not there yet. Arriving a moment late costs nothing; not arriving at all is
 * worth an error that says so.
 */
async function bridge(): Promise<string> {
  if (bridgeName !== '') {
    return bridgeName;
  }

  for (let waited = 0; waited <= bridgeTimeout; waited += bridgePoll) {
    // GetFlag throws while the flags are still absent, which here is a reason
    // to wait rather than to fail.
    try {
      const name = Flags.GetFlag('bridge') as string;
      if (name) {
        bridgeName = name;

        return bridgeName;
      }
    } catch {
      // Not injected yet.
    }

    await new Promise((resolve) => setTimeout(resolve, bridgePoll));
  }

  throw new Error('the Go side never said what its bridge is called');
}

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  return (await Call.ByName(`${await bridge()}.${method}`, ...args)) as T;
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
    void call('SyncSettings', settings.notifyOnExit, settings.notifyOnFinish);
  },

  openNotificationSettings: () => call('OpenNotificationSettings'),

  openExternal: (url) => call('OpenExternal', url),

  openFinding: (reference, id) => call('OpenFinding', reference, id),

  registerContainerNames: () => call('RegisterContainerNames'),

  takePendingOpen: async () => orNull(await call<string>('TakePendingOpen')),
  onOpenContainer: (callback) => on<string>('dermaga:open-container', callback),

  takePendingTask: async () => orNull(await call<string>('TakePendingTask')),
  onOpenTask: (callback) => on<string>('dermaga:open-task', callback),
  onAnnouncement: (callback) =>
    on<Announcement>('dermaga:announce', (data) => data && callback(data)),

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
  resolveBuildDrop: (paths) => call('ResolveBuildDrop', paths),

  checkUpdate: () => call('CheckUpdate'),
  stageUpdate: (assetUrl, version) => call('StageUpdate', assetUrl, version),
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
