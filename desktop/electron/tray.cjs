// The menu bar item: what Dermaga is watching, without a window.
//
// It reports the state of the container services rather than of Dermaga
// itself, which is the useful question here: Apple's CLI runs containers
// through launchd, so they outlive this app -- "is Dermaga running?" answers
// nothing, while "are the services up, and what is running?" answers the thing
// people open the window for.
const { Menu, Tray, nativeImage } = require('electron');
const path = require('node:path');
const { trayLabel, trayMenuTemplate } = require('./tray-menu.cjs');

let tray = null;
let handlers = {};
let state = { running: null, containers: [] };

function icon(name) {
  const image = nativeImage.createFromPath(path.join(__dirname, 'icons', `${name}.png`));
  // Template images follow the menu bar into dark mode and under highlights.
  image.setTemplateImage(true);
  return image;
}

function build() {
  const handlerFor = {
    open: () => handlers.onOpen?.(),
    'start-services': () => handlers.onStartServices?.(),
    quit: () => handlers.onQuit?.(),
  };

  return Menu.buildFromTemplate(
    trayMenuTemplate(state).map(({ label, type, enabled, action, id }) => ({
      label,
      type,
      enabled,
      click:
        action === 'open-container'
          ? () => handlers.onOpenContainer?.(id)
          : (handlerFor[action] ?? undefined),
    }))
  );
}

function apply() {
  if (!tray) return;

  // Filled while the services are up, hollow when they are not: a broken
  // runtime is visible without opening the menu.
  tray.setImage(icon(state.running === false ? 'trayStoppedTemplate' : 'trayTemplate'));
  tray.setToolTip(`Dermaga — ${trayLabel(state)}`);
  tray.setContextMenu(build());
}

function createTray(callbacks) {
  handlers = callbacks;
  tray = new Tray(icon('trayTemplate'));
  apply();
  return tray;
}

/** Called with whatever has just changed; the rest of the state is kept. */
function updateTray(next) {
  state = { ...state, ...next };
  apply();
}

module.exports = { createTray, updateTray };
