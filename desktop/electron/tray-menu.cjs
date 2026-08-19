// What the menu bar item says, as data.
//
// Kept apart from the Electron glue so the decisions -- what counts as worth
// showing, when Start services is offered, how many rows before the list is
// cut -- can be read and tested without a menu bar to hang them on.

/** Beyond this the menu becomes a list to scroll rather than a glance. */
const MAX_CONTAINERS = 8;

/** The one line someone reads when they look up at the clock. */
function trayLabel({ running, containers }) {
  if (running === null || running === undefined) return 'Checking the services…';
  if (!running) return 'Services stopped';

  const count = containers?.length ?? 0;
  return `Services running · ${count} container${count === 1 ? '' : 's'}`;
}

/**
 * The menu, as a template Electron can build. Actions are named rather than
 * bound here; the caller supplies the handlers.
 */
function trayMenuTemplate(state) {
  const { running, containers = [] } = state;
  const items = [{ label: trayLabel(state), enabled: false }, { type: 'separator' }];

  if (running) {
    if (containers.length === 0) {
      items.push({ label: 'No containers running', enabled: false });
    } else {
      for (const container of containers.slice(0, MAX_CONTAINERS)) {
        items.push({ label: container.name, action: 'open-container', id: container.id });
      }

      const hidden = containers.length - MAX_CONTAINERS;
      if (hidden > 0) items.push({ label: `…and ${hidden} more`, enabled: false });
    }

    items.push({ type: 'separator' });
  }

  items.push({ label: 'Open Dermaga', action: 'open' });

  // Only the way out of a stopped runtime is offered. Stopping the services
  // takes every container with it, which is not a thing to put one click away
  // from the clock.
  if (running === false) items.push({ label: 'Start services', action: 'start-services' });

  items.push({ type: 'separator' }, { label: 'Quit Dermaga', action: 'quit' });

  return items;
}

module.exports = { trayLabel, trayMenuTemplate, MAX_CONTAINERS };
