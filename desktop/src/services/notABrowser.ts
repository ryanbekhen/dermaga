/**
 * Closing the browser behind the app.
 *
 * The window is a WebView, which is an implementation detail everywhere except
 * where it leaks: right-click offers Reload and, in a development build, Inspect
 * Element; Cmd-R throws the page away. None of that belongs to an app for
 * managing containers, and Reload is worse than useless here -- it drops the
 * window's state and reconnects to the agent, which is what somebody reaches for
 * when they are looking for a refresh button that this app deliberately does not
 * have, because nothing here is ever stale.
 *
 * The menu bar loses View on the Go side. This is the other half: the parts of
 * a browser reachable without a menu.
 */

/** Fields keep their own menu: cut, copy and paste are theirs, not the web's. */
function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

/**
 * True for the keystroke that reloads a page.
 *
 * Command only, deliberately. Control-R on a Mac reloads nothing -- but it is
 * reverse history search in every shell, and the terminal tab is a shell.
 */
function reloads(event: KeyboardEvent): boolean {
  return event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'r';
}

export function sealWindow() {
  document.addEventListener('contextmenu', (event) => {
    if (editable(event.target)) return;

    event.preventDefault();
  });

  // Captured, so it is answered before anything in the app can act on it, and
  // before WebKit can.
  document.addEventListener(
    'keydown',
    (event) => {
      if (reloads(event)) event.preventDefault();
    },
    { capture: true }
  );
}
