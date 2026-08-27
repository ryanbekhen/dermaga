/**
 * The renderer's only way out. Every call is a JSON-RPC method on the agent,
 * brokered by the process that draws it -- there is no HTTP client here and no
 * server to point one at.
 */

import type { BuildDrop } from '../types';

export interface Notification {
  method: string;
  params?: unknown;
}

interface Bridge {
  platform: string;
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
  onFilesDropped?: (callback: (paths: string[], target: string) => void) => () => void;
  resolveBuildDrop?: (paths: string[]) => Promise<BuildDrop | null>;
  syncSettings?: (settings: {
    notifyOnExit: boolean;
    notifyOnFinish: boolean;
    notifyOnUpdate: boolean;
  }) => void;
  openNotificationSettings?: () => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
  openFinding?: (reference: string, id: string) => Promise<void>;
  registerContainerNames?: () => Promise<void>;
  takePendingOpen?: () => Promise<string | null>;
  takePendingTask?: () => Promise<string | null>;
  takePendingPage?: () => Promise<string | null>;
  serviceStatus?: () => Promise<ServiceStatus>;
  installService?: () => Promise<ServiceStatus>;
  uninstallService?: () => Promise<ServiceStatus>;
  getOpenAtLogin?: () => Promise<boolean>;
  setOpenAtLogin?: (value: boolean) => Promise<boolean>;
  onOpenContainer?: (callback: (id: string) => void) => () => void;
  onOpenTask?: (callback: (id: string) => void) => () => void;
  onOpenPage?: (callback: (page: string) => void) => () => void;
  onAnnouncement?: (callback: (news: Announcement) => void) => () => void;
  checkUpdate?: () => Promise<UpdateCheck>;
  stageUpdate?: (assetUrl: string, version: string) => Promise<StagedUpdate>;
  installUpdate?: (dmgPath: string) => Promise<void>;
  onUpdateProgress?: (callback: (value: { received: number; total: number }) => void) => () => void;
  panelHeight?: (height: number) => void;
  closePanel?: () => void;
  openWindow?: (container?: string) => void;
  pendingUpdate?: () => Promise<StagedUpdate>;
  onUpdateStaged?: (callback: (staged: StagedUpdate) => void) => () => void;
  startContainer?: (id: string, name: string) => Promise<void>;
  stopContainer?: (id: string, name: string) => Promise<void>;
  quitApp?: () => void;
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

/** A release that has landed, and what it would take to install it. */
export interface StagedUpdate {
  path: string;
  version: string;
  /**
   * True when a restart is all it would take. False means the old road: the
   * image opens and somebody drags the app across.
   */
  restartable: boolean;
  reason?: string;
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
 * The path of a file dropped from Finder. A File object carries no path, so
 * only the shell can answer.
 */
export function pathForFile(file: File): string | null {
  return bridge().pathForFile?.(file) ?? null;
}

/**
 * Files dragged in from Finder, when the shell catches the drag itself.
 *
 * Wails never lets the drag reach the page, so there is no DOM drop event to
 * read: the paths arrive here instead, with the name of the target they landed
 * on. Where there is no such channel this does nothing, and the DOM handler
 * that fires for an ordinary drop stands instead.
 */
export function onFilesDropped(callback: (paths: string[], target: string) => void): () => void {
  return bridge().onFilesDropped?.(callback) ?? (() => {});
}

/**
 * What a dropped path is worth building, if anything.
 *
 * Only the shell can answer: whether a path is a folder, and whether there is a
 * Dockerfile in it, are questions about a disk the page cannot see. Nothing to
 * build comes back as null, which is a real answer -- most drops are not about
 * building.
 */
export async function resolveBuildDrop(paths: string[]): Promise<BuildDrop | null> {
  return (await bridge().resolveBuildDrop?.(paths)) ?? null;
}

/** Keeps the main process in step with preferences it acts on by itself. */
export function syncSettings(settings: {
  notifyOnExit: boolean;
  notifyOnFinish: boolean;
  notifyOnUpdate: boolean;
}): void {
  bridge().syncSettings?.(settings);
}

/** Opens the macOS pane where notifications are allowed or refused. */
export function openNotificationSettings(): Promise<void> {
  return bridge().openNotificationSettings?.() ?? Promise.resolve();
}

/**
 * Opens a web address in the user's browser.
 *
 * This window is not a browser: an anchor with target="_blank" has nowhere to
 * put a tab, so every external link in the app did nothing when it was
 * clicked. macOS is asked to open it instead.
 *
 * The Go side refuses anything that is not http or https. These addresses come
 * from outside — a CVE link from the scanner, a homepage from a licence file —
 * and `open` acts on any scheme macOS knows.
 */
export function openExternal(url: string): Promise<void> {
  return bridge().openExternal?.(url) ?? Promise.resolve();
}

/**
 * Tells the menu bar panel's window how tall its page turned out to be.
 *
 * The panel is a list of whatever is running, so its height is a different
 * number every time it opens — and only this side can measure it. The Go side
 * clamps what it is told; this only reports.
 */
export function panelHeight(height: number): void {
  bridge().panelHeight?.(height);
}

/** Takes the panel down from the inside: Escape, or a row that leads away. */
export function closePanel(): void {
  bridge().closePanel?.();
}

/**
 * Raises the app's window, on a container when one is named.
 *
 * The panel's way out of itself. The window may not exist yet — it is closed
 * far more often than it is open — so this is an ask rather than a navigation,
 * and the other side decides what to make.
 */
export function openWindow(container?: string): void {
  bridge().openWindow?.(container);
}

/**
 * Starts or stops a container from the menu bar panel.
 *
 * Not `api.startContainer`, which would go straight to the agent from here: the
 * panel can be dismissed while the command is still running, and a failure
 * nobody is left to read is a failure nobody hears about. This hands it to the
 * process, which raises the same notification the menu bar's own rows do.
 */
export function startContainer(id: string, name: string): Promise<void> {
  return bridge().startContainer?.(id, name) ?? Promise.resolve();
}

export function stopContainer(id: string, name: string): Promise<void> {
  return bridge().stopContainer?.(id, name) ?? Promise.resolve();
}

/** Closes the app, from the one surface that is on screen when nothing else is. */
export function quitApp(): void {
  bridge().quitApp?.();
}

/**
 * Opens one vulnerability in a window of its own.
 *
 * Only the two names are passed. A URL is a poor place for a paragraph, and
 * the report can be rescanned while the window is open — so the window fetches
 * for itself and shows whatever is current.
 */
export function openFindingWindow(reference: string, id: string): Promise<void> {
  return bridge().openFinding?.(reference, id) ?? Promise.resolve();
}

/**
 * Asks macOS to route the container domain to the runtime's DNS service.
 *
 * Shows the system's own authorization panel — the password is typed into that
 * and never passes through Dermaga.
 */
export function registerContainerNames(): Promise<void> {
  return bridge().registerContainerNames?.() ?? Promise.resolve();
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

/**
 * A container asked for before this window existed -- from a notification about
 * one that died, or from the menu bar. Collected once, as the window starts.
 */
export function takePendingOpen(): Promise<string | null> {
  return bridge().takePendingOpen?.() ?? Promise.resolve(null);
}

export function onOpenContainer(callback: (id: string) => void): () => void {
  return bridge().onOpenContainer?.(callback) ?? (() => {});
}

/**
 * A finished command whose output somebody asked to see, from the notification
 * macOS raised about it.
 */
export function takePendingTask(): Promise<string | null> {
  return bridge().takePendingTask?.() ?? Promise.resolve(null);
}

export function onOpenTask(callback: (id: string) => void): () => void {
  return bridge().onOpenTask?.(callback) ?? (() => {});
}

/**
 * The pages the main process can ask for by name.
 *
 * One, for now, and the list is closed rather than "any route": the other side
 * is Go, so nothing checks that a page name still exists. A closed set means a
 * page renamed here fails to compile rather than opening nothing.
 */
export type NoticePage = 'system';

export function isNoticePage(page: string): page is NoticePage {
  return page === 'system';
}

/**
 * A page the main process wants opened -- news about the machine rather than
 * about anything in a list, so there is nothing to hand over but where to go.
 */
export function takePendingPage(): Promise<string | null> {
  return bridge().takePendingPage?.() ?? Promise.resolve(null);
}

export function onOpenPage(callback: (page: string) => void): () => void {
  return bridge().onOpenPage?.(callback) ?? (() => {});
}

/**
 * Something Dermaga has to say, arriving because this window has the focus.
 *
 * The other side decides which of the two channels a piece of news goes down --
 * a toast here, or a notification from macOS -- so it is never both and never
 * neither. This is the half for a reader who is already looking.
 */
export interface Announcement {
  id: string;
  title: string;
  body: string;
  failed: boolean;
  /**
   * What pressing it opens: a container, a finished command's output, or a
   * page of the app.
   */
  container?: string;
  task?: string;
  page?: NoticePage;
}

export function onAnnouncement(callback: (news: Announcement) => void): () => void {
  return bridge().onAnnouncement?.(callback) ?? (() => {});
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

export const updates = {
  check: (): Promise<UpdateCheck> =>
    bridge().checkUpdate?.() ?? Promise.resolve({ available: false, current: '' }),

  /**
   * Fetches the release and reports whether a restart could install it. A
   * download already on disk is taken as it is, so quitting without restarting
   * costs nothing the next time.
   */
  stage: (assetUrl: string, version: string): Promise<StagedUpdate> => {
    const stage = bridge().stageUpdate;
    if (!stage) return Promise.reject(new Error('Updates need the desktop app'));
    return stage(assetUrl, version);
  },

  /** Opens the installer; Dermaga closes itself a moment later. */
  install: (dmgPath: string): Promise<void> =>
    bridge().installUpdate?.(dmgPath) ?? Promise.resolve(),

  onProgress: (callback: (value: { received: number; total: number }) => void): (() => void) =>
    bridge().onUpdateProgress?.(callback) ?? (() => {}),

  /**
   * What has already been downloaded and is waiting, if anything.
   *
   * The window does the looking and the fetching; this is for the menu bar
   * panel, which is a different page in a different window and should not run a
   * second copy of any of that. It asks what is in hand and offers it.
   */
  pending: (): Promise<StagedUpdate | null> =>
    bridge()
      .pendingUpdate?.()
      .then((staged) => (staged?.version ? staged : null)) ?? Promise.resolve(null),

  /** And hears about one that lands while it is open. */
  onStaged: (callback: (staged: StagedUpdate) => void): (() => void) =>
    bridge().onUpdateStaged?.(callback) ?? (() => {}),
};

export interface StreamHandlers {
  onData: (chunk: string) => void;
  onEnd?: (error?: string) => void;
  /** The agent's name for this run, as soon as it has one. */
  onStart?: (streamId: string) => void;
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

  // The agent's own name for this run. Handed back because a notification
  // raised on the Go side knows only this -- and clicking it has to find the
  // task the window filed under a name of its own.
  handlers.onStart?.(streamId);

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
