'use strict';

const {
  app,
  BrowserWindow,
  dialog,
  Notification,
  ipcMain,
  nativeTheme,
  screen,
  shell,
  session,
} = require('electron');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const { Agent } = require('./agent.cjs');

const isDev = !app.isPackaged;
const DEV_ORIGIN = `http://localhost:${process.env.DERMAGA_DEV_PORT || 3000}`;

// A .app launched from Finder inherits a bare PATH, which will not contain the
// `container` binary. Put the usual install locations back.
const EXTRA_PATH = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'];

let mainWindow = null;
let splashWindow = null;
let agent = null;

/**
 * Windows open where the user is looking, not on whichever display macOS calls
 * primary. The display under the pointer is the best available guess, and it is
 * what every other Mac app does.
 */
function placeOn(width, height) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;

  // A window larger than the display it lands on would otherwise be pushed
  // off-screen.
  const fittedWidth = Math.min(width, area.width);
  const fittedHeight = Math.min(height, area.height);

  return {
    width: fittedWidth,
    height: fittedHeight,
    x: Math.round(area.x + (area.width - fittedWidth) / 2),
    y: Math.round(area.y + (area.height - fittedHeight) / 2),
  };
}

// Streams the startup sequence is listening to, keyed by stream id.
const streamListeners = new Map();


/** Runs a streaming agent method to completion, reporting each line. */
function runStream(method, params, onLine) {
  return new Promise((resolve, reject) => {
    agent
      .invoke(method, params)
      .then(({ streamId }) => {
        const lines = [];

        streamListeners.set(streamId, (event, payload) => {
          if (event === 'stream.data') {
            lines.push(payload.chunk);
            onLine?.(payload.chunk);
            return;
          }

          streamListeners.delete(streamId);

          if (payload.error) reject(new Error(payload.error));
          else resolve(lines);
        });
      })
      .catch(reject);
  });
}

// On a warm machine every step finishes in a few hundred milliseconds, and a
// splash that flashes past reads as a glitch rather than as progress. Hold it
// long enough to actually be read.
const MIN_SPLASH_MS = 2200;
const SPLASH_SETTLE_MS = 700;

// Startup takes a moment -- spawning the agent, asking the CLI where it stands
// -- and an empty window for that long looks broken. The splash says what is
// happening, and the main window is only revealed once there is something in it.
function createSplash() {
  splashWindow = new BrowserWindow({
    ...placeOn(620, 392),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'splash-preload.cjs'),
    },
  });

  splashWindow.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') {
      console.error(`[splash] ${event.message}`);
    }
  });

  splashWindow.once('ready-to-show', () => {
    splashWindow?.show();
    // Launched from a terminal rather than Finder, macOS leaves the app behind
    // whatever was in front -- so the splash runs its whole sequence unseen.
    splashWindow?.focus();
    app.focus({ steal: true });
  });
  // The version travels in the URL rather than over IPC: a round trip that
  // fails leaves the splash showing a placeholder, and it did exactly that in
  // 1.3.1. A query string cannot fail once the page has loaded at all.
  void splashWindow.loadFile(path.join(__dirname, 'splash.html'), {
    query: { version: app.getVersion() },
  });

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

// A first-run job that takes minutes gets its own panel, and the window grows
// to hold it: a one-line label is not enough to explain why nothing is
// happening for two minutes.
const SPLASH_SIZE = { width: 620, height: 392 };
const SPLASH_SETUP_SIZE = { width: 620, height: 500 };

// The kernel is 569 MB and the runtime fetches it from GitHub, so on a slow
// line this legitimately takes the best part of an hour. There is no time limit
// on it -- only on silence: if nothing at all is reported for this long, the
// download has stalled rather than slowed, and the window opens anyway.
const KERNEL_STALL_MS = 3 * 60 * 1000;

function splashSetup(title, line, done = false) {
  if (!splashWindow) return;

  splashWindow.webContents.send('splash:setup', { title, line, done });

  const size = done ? SPLASH_SIZE : SPLASH_SETUP_SIZE;
  const [width, height] = splashWindow.getSize();
  if (width === size.width && height === size.height) return;

  const bounds = splashWindow.getBounds();
  splashWindow.setBounds(
    {
      // Grow around the middle, so the window does not appear to jump.
      x: Math.round(bounds.x - (size.width - bounds.width) / 2),
      y: Math.round(bounds.y - (size.height - bounds.height) / 2),
      width: size.width,
      height: size.height,
    },
    true
  );
}

function splashStep(id, state, label) {
  splashWindow?.webContents.send('splash:step', { id, state, label });
}

/** Ends startup with an explanation the user can read, then closes the app. */
function splashFatal(title, detail) {
  splashWindow?.webContents.send('splash:fatal', { title, detail });

  // A backstop in case the window is left untouched; the Quit button is the
  // intended way out.
  setTimeout(() => app.quit(), 60000);
}

function closeSplash() {
  splashWindow?.close();
  splashWindow = null;
}

function agentBinary() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'dermaga-agent')]
    : [
        path.join(__dirname, '..', '..', 'bin', 'dermaga-agent'),
        path.join(__dirname, '..', 'resources', 'dermaga-agent'),
      ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function startAgent() {
  const binary = agentBinary();

  if (!binary) {
    console.error('[dermaga] agent binary not found; run `make build-agent`');
    return;
  }

  const mergedPath = Array.from(
    new Set([...(process.env.PATH || '').split(':').filter(Boolean), ...EXTRA_PATH])
  ).join(':');

  agent = new Agent({
    binary,
    env: { ...process.env, PATH: mergedPath },
    // Everything the agent pushes -- snapshots, stream chunks, terminal output
    // -- is forwarded to the renderer as one channel.
    onNotify: (message) => {
      // Startup runs its own streams before any window exists to forward to.
      const params = message?.params;
      if (params?.id && streamListeners.has(params.id)) {
        streamListeners.get(params.id)(message.method, params);
      }

      if (message?.method === 'containers.exited') notifyExit(message.params);

      mainWindow?.webContents.send('dermaga:notify', message);
    },
    onExit: (code) => console.warn('[dermaga] agent exited with code', code),
  });

  agent.start();
}

/**
 * Tells the user a container stopped without being asked to.
 *
 * The app usually sits in the background, so this is the one thing it has to
 * say unprompted -- a container that died while nobody was looking is exactly
 * what a window cannot report. Deliberate stops are filtered out by the agent,
 * so anything reaching here is genuinely unexpected.
 */
function notifyExit(exit) {
  if (!exit?.name) return;

  // Notifications fail quietly on macOS -- an app that has not been granted
  // permission simply never shows one -- so the reason is written down.
  if (!Notification.isSupported()) {
    console.warn('[dermaga] notifications are not supported here');
    return;
  }

  if (!settings.notifyOnExit) {
    console.warn('[dermaga] exit notification suppressed by settings');
    return;
  }

  console.log('[dermaga] notifying about', exit.name);

  // macOS accepts notifications only from apps signed with a Developer ID and
  // drops the rest without a word, so this may well go nowhere. The window has
  // its own message either way; what it cannot do is reach someone who is
  // looking at another app, which is what the sound is for.
  alertIfUnattended();

  const notification = new Notification({
    title: `${exit.name} stopped`,
    body: exit.image ? `Running ${exit.image}. Nothing asked it to stop.` : 'Nothing asked it to stop.',
    silent: false,
  });

  notification.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
    mainWindow?.webContents.send('dermaga:open-container', exit.id);
  });

  notification.show();
}

/**
 * Makes a sound when a container dies while nobody is watching the window.
 *
 * The app keeps running with its window closed, and an in-window message is no
 * use then. A system sound needs neither permission nor a signature, which is
 * more than can be said for the notification itself.
 */
function alertIfUnattended() {
  const watching = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();
  if (watching) return;

  const sound = '/System/Library/Sounds/Submarine.aiff';
  if (process.platform !== 'darwin' || !fs.existsSync(sound)) return;

  try {
    spawn('afplay', [sound], { stdio: 'ignore', detached: true }).unref();
  } catch (error) {
    console.warn('[dermaga] could not play the alert:', error.message);
  }
}

// Mirrors the stored preferences, so a notification can be suppressed without
// asking the agent first -- it arrives at the moment it is needed.
const settings = { notifyOnExit: true };

/**
 * Hands a file from inside a container to Finder as a native drag.
 *
 * A drag can only carry something that exists on disk, so the file is copied
 * out to a temporary directory first and dragged from there. The copy is the
 * slow part; it happens before the drag starts rather than during it, because
 * a drag that begins with nothing under the cursor is worse than a short wait.
 */
ipcMain.handle('dermaga:drag-out', async (event, { container, path: source }) => {
  if (!agent) throw new Error('The Dermaga agent is not running');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dermaga-drag-'));
  const name = source.split('/').filter(Boolean).pop() || 'file';
  const target = path.join(dir, name);

  await agent.invoke('files.copyOut', { container, path: source, target });

  event.sender.startDrag({
    file: target,
    // Electron insists on an icon; the file's own is not available to us, so
    // the app icon stands in.
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
  });
});

ipcMain.on('dermaga:settings', (_event, next) => {
  if (typeof next?.notifyOnExit === 'boolean') settings.notifyOnExit = next.notifyOnExit;
});

function applyContentSecurityPolicy() {
  if (isDev) return; // Vite's HMR client needs inline scripts and a websocket.

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // The renderer has no network access at all: everything goes over IPC.
        'Content-Security-Policy': [
          "default-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
        ],
      },
    });
  });
}

// A packaged build takes its icon from the bundle; in development the Dock
// would otherwise show Electron's own.
function applyDevIcon() {
  if (app.isPackaged || process.platform !== 'darwin') return;

  const icon = path.join(__dirname, '..', 'build', 'icon.png');
  if (fs.existsSync(icon)) app.dock?.setIcon(icon);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    // The same display the splash opened on, since the pointer has not moved
    // far in the second it took to get here.
    ...placeOn(1180, 760),
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    // Avoids a white flash into a dark UI (and the reverse) on launch.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#131317' : '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Shown by the startup sequence, once the renderer has something to draw.

  // A renderer crash used to show as an empty window with no explanation.
  mainWindow.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') {
      console.error(`[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    }
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('[renderer] failed to load', url, description, code);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] process gone:', details.reason);
  });

  // The traffic lights disappear in fullscreen, so the UI needs to know.
  const reportFullScreen = () =>
    mainWindow?.webContents.send('dermaga:fullscreen', mainWindow.isFullScreen());

  mainWindow.on('enter-full-screen', reportFullScreen);
  mainWindow.on('leave-full-screen', reportFullScreen);

  // External links open in the user's browser, never in the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    void mainWindow.loadURL(DEV_ORIGIN);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('dermaga:invoke', async (_event, method, params) => {
  if (!agent) throw new Error('The Dermaga agent is not running');
  return agent.invoke(method, params);
});

ipcMain.handle('dermaga:is-fullscreen', () => mainWindow?.isFullScreen() ?? false);

// --- updates --------------------------------------------------------------
//
// Releases are ad-hoc signed, and Squirrel refuses to swap an app whose
// signature it cannot match against the running one, so there is no silent
// self-update to be had. This is the honest version of it: fetch the release,
// download the DMG with progress, open it, and get out of the way so the user
// can drop the new build over the old one.

const UPDATE_REPO = 'ryanbekhen/dermaga';

/** True when `candidate` is a later version than `current`. */
function isNewer(candidate, current) {
  const parts = (value) =>
    String(value)
      .replace(/^v/, '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0);

  const [a, b] = [parts(candidate), parts(current)];

  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }

  return false;
}

ipcMain.handle('dermaga:check-update', async () => {
  const current = app.getVersion();

  const response = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Dermaga' },
  });

  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);

  const release = await response.json();
  const version = String(release.tag_name || '').replace(/^v/, '');
  const asset = (release.assets || []).find((item) => item.name?.endsWith('.dmg'));

  if (!version || !asset || !isNewer(version, current)) {
    return { available: false, current };
  }

  return {
    available: true,
    current,
    version,
    url: release.html_url,
    assetUrl: asset.browser_download_url,
    size: asset.size ?? 0,
  };
});

ipcMain.handle('dermaga:download-update', async (_event, assetUrl, version) => {
  const response = await fetch(assetUrl);
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`);

  const total = Number(response.headers.get('content-length')) || 0;
  // Downloads, not a temp directory: if anything goes wrong the user still has
  // the installer where they would expect to find it.
  const target = path.join(app.getPath('downloads'), `Dermaga-${version}-arm64.dmg`);
  const file = fs.createWriteStream(target);

  let received = 0;

  try {
    for await (const chunk of response.body) {
      received += chunk.length;
      file.write(chunk);
      mainWindow?.webContents.send('dermaga:update-progress', { received, total });
    }
  } catch (error) {
    file.destroy();
    fs.rmSync(target, { force: true });
    throw error;
  }

  await new Promise((resolve, reject) => {
    file.end(resolve);
    file.on('error', reject);
  });

  return target;
});

ipcMain.handle('dermaga:install-update', async (_event, dmgPath) => {
  const problem = await shell.openPath(dmgPath);
  if (problem) throw new Error(problem);

  // Quitting immediately would race Finder mounting the image, and the user
  // would be left staring at a closed app and no window.
  setTimeout(() => app.quit(), 1500);
});

// A build needs a directory on the user's disk, and the renderer is sandboxed
// with no filesystem access of its own. macOS grants access to whatever is
// chosen here, so no permission prompt of ours is involved.
ipcMain.handle('dermaga:pick-directory', async (_event, title) => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Choose a folder',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Choose',
  });

  return result.canceled ? null : (result.filePaths[0] ?? null);
});

// Licences too large to ship are read from source when someone asks to see
// them. The renderer has no network of its own, and this is not a general
// fetch: only these addresses can be asked for, so a compromised window cannot
// turn it into one.
const LICENCE_SOURCES = {
  chromium: 'https://raw.githubusercontent.com/chromium/chromium/main/LICENSE',
  node: 'https://raw.githubusercontent.com/nodejs/node/main/LICENSE',
};

ipcMain.handle('dermaga:fetch-licence', async (_event, key) => {
  const url = LICENCE_SOURCES[key];
  if (!url) throw new Error('Unknown licence');

  const response = await fetch(url, { headers: { Accept: 'text/plain' } });
  if (!response.ok) throw new Error(`Source answered ${response.status}`);

  return response.text();
});

ipcMain.on('splash:quit', () => app.quit());

/**
 * Starts the container services, installing the Linux kernel first if that is
 * what is in the way.
 *
 * A Mac that has never run a container has no kernel, and the runtime refuses
 * to start until one is set -- telling the user to go and run
 * `container system kernel set` by hand. Nothing works without it, so this is
 * part of getting ready rather than a choice worth interrupting for; it is the
 * same reasoning that installs the CLI a step earlier.
 */
async function startServices() {
  try {
    await agent.invoke('system.start', { installKernel: false });
  } catch (error) {
    // The runtime refuses to start until a kernel is set on some versions;
    // installing it is what ensureKernel does, so let it through and try again.
    if (!/kernel/i.test(error.message || '')) throw error;

    await ensureKernel();
    await agent.invoke('system.start', { installKernel: true });
  }
}

/**
 * Makes sure a default kernel exists, installing it if not.
 *
 * The services start perfectly well without one; what fails is the first
 * container, with "default kernel not configured for architecture arm64" and
 * an instruction to go and run a CLI command. So this asks the agent directly
 * rather than waiting to be told at the worst possible moment, and the splash
 * grows to show the download rather than sitting on one silent line.
 */
async function ensureKernel() {
  const { configured } = await agent
    .invoke('system.kernelConfigured')
    .catch(() => ({ configured: true }));

  if (configured) return;

  splashStep('services', 'active', 'Installing the Linux kernel\u2026');
  splashSetup('Setting up the default Linux kernel', 'Starting the download\u2026');

  let stalled;
  const stall = new Promise((_resolve, reject) => {
    stalled = reject;
  });

  let watchdog = setTimeout(() => stalled(new Error('kernel install stalled')), KERNEL_STALL_MS);

  const alive = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => stalled(new Error('kernel install stalled')), KERNEL_STALL_MS);
  };

  try {
    // However long it takes: a 569 MB download on a poor connection is slow,
    // not broken, and cutting it off at some arbitrary minute means starting
    // again from nothing.
    await Promise.race([
      runStream('system.installKernel', undefined, (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        alive();
        splashSetup('Setting up the default Linux kernel', trimmed.slice(0, 200));
      }),
      stall,
    ]);

    splashStep('services', 'done', 'Kernel installed');
  } catch (error) {
    console.error('[dermaga] kernel install failed:', error.message);
    splashStep('services', 'failed', 'Kernel not installed \u2014 retry from System');
  } finally {
    clearTimeout(watchdog);
    splashSetup(null, null, true);
  }
}

/**
 * The splash is the bootstrap, not a progress bar over one. It checks each
 * prerequisite and fixes what it can: installing the CLI through Homebrew,
 * starting the services if they are down. Without Homebrew there is nothing it
 * can do, so it says so and the app closes rather than opening onto a UI that
 * cannot work.
 */
async function startUp() {
  const startedAt = Date.now();
  createSplash();

  // 1. The agent itself.
  splashStep('agent', 'active');
  startAgent();

  let toolchain;
  try {
    toolchain = await agent.invoke('toolchain.status');
    splashStep('agent', 'done');
  } catch (error) {
    console.error('[dermaga] agent did not answer:', error.message);
    splashFatal('The Dermaga agent did not start', error.message);
    return;
  }

  // 2. Homebrew, which everything else here depends on.
  splashStep('brew', 'active');
  if (!toolchain.brewAvailable) {
    splashFatal(
      'Homebrew is required',
      'Dermaga installs and updates Apple\u2019s container CLI through Homebrew. Install it from brew.sh, then open Dermaga again.'
    );
    return;
  }
  splashStep('brew', 'done', 'Homebrew found');

  // 3. The container CLI, installed here if it is missing.
  if (toolchain.installed) {
    splashStep('cli', 'done', `Container CLI ${toolchain.version || ''}`.trim());
  } else {
    splashStep('cli', 'active', 'Installing the container CLI\u2026');
    try {
      await runStream('toolchain.install', undefined, (line) => {
        const trimmed = line.trim();
        if (trimmed) splashStep('cli', 'active', trimmed.slice(0, 60));
      });
      splashStep('cli', 'done', 'Container CLI installed');
    } catch (error) {
      console.error('[dermaga] install failed:', error.message);
      splashFatal('Could not install the container CLI', error.message);
      return;
    }
  }

  // 4. The background services, started here if they are down.
  splashStep('services', 'active');
  try {
    const report = await agent.invoke('system.status');

    if (report?.status?.running) {
      splashStep('services', 'done', 'Services running');
    } else {
      splashStep('services', 'active', 'Starting services\u2026');
      await startServices();
      splashStep('services', 'done', 'Services started');
    }

    // Checked whether or not the services needed starting: they run happily
    // with no kernel at all, and the failure is saved up for the first
    // container anyone tries to run.
    await ensureKernel();
  } catch (error) {
    console.error('[dermaga] services did not start:', error.message);
    // Not fatal: the app opens on its own "services are down" screen, which
    // offers the fix and can say more than one line of splash can.
    splashStep('services', 'failed', 'Could not start services');
  }

  // 5. The window itself.
  splashStep('ui', 'active');
  createWindow();

  await new Promise((resolve) => {
    // Whichever comes first: the renderer painting, or a timeout so a stuck
    // load cannot trap the user behind the splash.
    const timer = setTimeout(resolve, 8000);
    mainWindow.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  splashStep('ui', 'done');

  // Let the last step register as complete, then hold the whole splash to its
  // minimum so a fast start still shows what happened.
  await new Promise((resolve) => setTimeout(resolve, SPLASH_SETTLE_MS));
  const remaining = MIN_SPLASH_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));

  closeSplash();
  mainWindow?.show();
  mainWindow?.focus();
}

app.whenReady().then(() => {
  applyContentSecurityPolicy();
  applyDevIcon();
  void startUp();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    mainWindow?.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Take the agent down with the app rather than leaving it orphaned.
app.on('before-quit', () => agent?.stop());
