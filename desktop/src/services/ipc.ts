/**
 * The renderer's only way out. Every call is a JSON-RPC method on the agent,
 * brokered by the Electron main process -- there is no HTTP client here and no
 * server to point one at.
 */

export interface Notification {
  method: string;
  params?: unknown;
}

interface Bridge {
  platform: string;
  isElectron: boolean;
  invoke: (method: string, params?: unknown) => Promise<unknown>;
  onNotify: (callback: (message: Notification) => void) => () => void;
  isFullScreen?: () => Promise<boolean>;
  onFullScreenChange?: (callback: (value: boolean) => void) => () => void;
  pickDirectory?: (title?: string) => Promise<string | null>;
  pickSaveFile?: (options: {
    title?: string;
    defaultName?: string;
    extension?: string;
  }) => Promise<string | null>;
  pickFile?: (options: { title?: string; extension?: string }) => Promise<string | null>;
  pathForFile?: (file: File) => string;
  dragOut?: (container: string, path: string) => Promise<void>;
  syncSettings?: (settings: { notifyOnExit: boolean }) => void;
  openNotificationSettings?: () => Promise<void>;
  serviceStatus?: () => Promise<ServiceStatus>;
  installService?: () => Promise<ServiceStatus>;
  uninstallService?: () => Promise<ServiceStatus>;
  getOpenAtLogin?: () => Promise<boolean>;
  setOpenAtLogin?: (value: boolean) => Promise<boolean>;
  onOpenContainer?: (callback: (id: string) => void) => () => void;
  fetchLicence?: (key: string) => Promise<string>;
  checkUpdate?: () => Promise<UpdateCheck>;
  downloadUpdate?: (assetUrl: string, version: string) => Promise<string>;
  installUpdate?: (dmgPath: string) => Promise<void>;
  onUpdateProgress?: (callback: (value: { received: number; total: number }) => void) => () => void;
}

/** What the main process found on GitHub, if anything newer is there. */
export interface UpdateCheck {
  available: boolean;
  current: string;
  version?: string;
  url?: string;
  assetUrl?: string;
  size?: number;
}

declare global {
  interface Window {
    dermaga?: Bridge;
  }
}

export class NotRunningError extends Error {
  constructor() {
    super('Dermaga is not connected to its agent');
    this.name = 'NotRunningError';
  }
}

function bridge(): Bridge {
  const value = window.dermaga;
  if (!value) throw new NotRunningError();
  return value;
}

export function invoke<T>(method: string, params?: unknown): Promise<T> {
  return bridge().invoke(method, params) as Promise<T>;
}

/** Subscribes to everything the agent pushes; the caller filters by method. */
export function onNotify(callback: (message: Notification) => void): () => void {
  return bridge().onNotify(callback);
}

/**
 * The path of a file dropped from Finder. Electron stopped putting it on the
 * File object, so only the preload can answer.
 */
export function pathForFile(file: File): string | null {
  return bridge().pathForFile?.(file) ?? null;
}

/** Copies an entry out and hands it to Finder as a drag. */
export function dragOut(container: string, path: string): Promise<void> {
  const drag = bridge().dragOut;
  if (!drag) return Promise.reject(new Error('Only the desktop app can do this'));
  return drag(container, path);
}

/** Keeps the main process in step with preferences it acts on by itself. */
export function syncSettings(settings: { notifyOnExit: boolean }): void {
  bridge().syncSettings?.(settings);
}

/** Opens the macOS pane where notifications are allowed or refused. */
export function openNotificationSettings(): Promise<void> {
  return bridge().openNotificationSettings?.() ?? Promise.resolve();
}

/** Fires when a notification about a stopped container is clicked. */
/** Whether the agent is installed as a launchd service, and where it points. */
export interface ServiceStatus {
  installed: boolean;
  binary: string | null;
  socket: string | null;
  /** launchd has the job loaded and up. */
  running: boolean;
  /** It points at a different build of Dermaga than this one. */
  stale: boolean;
  /** It points at a copy of Dermaga that is no longer there. */
  missing: boolean;
}

const NO_SERVICE: ServiceStatus = {
  installed: false,
  binary: null,
  socket: null,
  running: false,
  stale: false,
  missing: false,
};

export function serviceStatus(): Promise<ServiceStatus> {
  return bridge().serviceStatus?.() ?? Promise.resolve(NO_SERVICE);
}

export function installService(): Promise<ServiceStatus> {
  return bridge().installService?.() ?? Promise.resolve(NO_SERVICE);
}

export function uninstallService(): Promise<ServiceStatus> {
  return bridge().uninstallService?.() ?? Promise.resolve(NO_SERVICE);
}

/**
 * Whether macOS opens Dermaga at login. The setting belongs to macOS -- it can
 * be changed in System Settings too -- so it is read back rather than stored,
 * and both calls answer with what macOS now says.
 */
export function getOpenAtLogin(): Promise<boolean> {
  return bridge().getOpenAtLogin?.() ?? Promise.resolve(false);
}

export function setOpenAtLogin(value: boolean): Promise<boolean> {
  return bridge().setOpenAtLogin?.(value) ?? Promise.resolve(false);
}

export function onOpenContainer(callback: (id: string) => void): () => void {
  return bridge().onOpenContainer?.(callback) ?? (() => {});
}

/** Opens the native folder chooser; null if the user dismissed it. */
export function pickDirectory(title?: string): Promise<string | null> {
  return bridge().pickDirectory?.(title) ?? Promise.resolve(null);
}

/** Where to write a file; null if the user dismissed the dialog. */
export function pickSaveFile(options: {
  title?: string;
  defaultName?: string;
  extension?: string;
}): Promise<string | null> {
  return bridge().pickSaveFile?.(options) ?? Promise.resolve(null);
}

/** Which file to read; null if the user dismissed the dialog. */
export function pickFile(options: { title?: string; extension?: string }): Promise<string | null> {
  return bridge().pickFile?.(options) ?? Promise.resolve(null);
}

/** Reads a licence from its source, for the ones too large to ship. */
export function fetchLicence(key: string): Promise<string> {
  const fetchIt = bridge().fetchLicence;
  if (!fetchIt) return Promise.reject(new Error('Only the desktop app can fetch this'));
  return fetchIt(key);
}

export const updates = {
  check: (): Promise<UpdateCheck> =>
    bridge().checkUpdate?.() ?? Promise.resolve({ available: false, current: '' }),

  download: (assetUrl: string, version: string): Promise<string> => {
    const download = bridge().downloadUpdate;
    if (!download) return Promise.reject(new Error('Updates need the desktop app'));
    return download(assetUrl, version);
  },

  /** Opens the installer; Dermaga closes itself a moment later. */
  install: (dmgPath: string): Promise<void> =>
    bridge().installUpdate?.(dmgPath) ?? Promise.resolve(),

  onProgress: (callback: (value: { received: number; total: number }) => void): (() => void) =>
    bridge().onUpdateProgress?.(callback) ?? (() => {}),
};

export interface StreamHandlers {
  onData: (chunk: string) => void;
  onEnd?: (error?: string) => void;
}

/**
 * Starts a streaming method and routes its chunks. The returned function
 * cancels the stream, which also stops the CLI process behind it.
 */
export async function openStream(
  method: string,
  params: unknown,
  handlers: StreamHandlers
): Promise<() => void> {
  const { streamId } = await invoke<{ streamId: string }>(method, params);

  const unsubscribe = onNotify((message) => {
    const payload = message.params as { id?: string; chunk?: string; error?: string } | undefined;
    if (!payload || payload.id !== streamId) return;

    if (message.method === 'stream.data' && typeof payload.chunk === 'string') {
      handlers.onData(payload.chunk);
      return;
    }

    if (message.method === 'stream.end') {
      unsubscribe();
      handlers.onEnd?.(payload.error);
    }
  });

  return () => {
    unsubscribe();
    void invoke('stream.cancel', { id: streamId }).catch(() => {
      // The stream may already have ended on its own.
    });
  };
}

/** Stream ids are needed for terminals, which also send input back. */
export async function openTerminalStream(
  params: { kind: 'container' | 'machine'; id: string; user?: string },
  handlers: StreamHandlers
): Promise<{ streamId: string; close: () => void }> {
  const { streamId } = await invoke<{ streamId: string }>('terminal.open', params);

  const unsubscribe = onNotify((message) => {
    const payload = message.params as { id?: string; chunk?: string; error?: string } | undefined;
    if (!payload || payload.id !== streamId) return;

    if (message.method === 'stream.data' && typeof payload.chunk === 'string') {
      handlers.onData(payload.chunk);
      return;
    }

    if (message.method === 'stream.end') {
      unsubscribe();
      handlers.onEnd?.(payload.error);
    }
  });

  return {
    streamId,
    close: () => {
      unsubscribe();
      void invoke('stream.cancel', { id: streamId }).catch(() => {});
    },
  };
}
