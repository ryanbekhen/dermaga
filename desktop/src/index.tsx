import React from 'react';
import ReactDOM from 'react-dom/client';
// Installs window.dermaga before anything asks for it.
import { announceReady } from './services/bridge.wails';
import { sealWindow } from './services/notABrowser';
import App from './App';
import './index.css';

// Before the first frame: a right-click during startup would otherwise still
// find the browser underneath.
sealWindow();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

requestAnimationFrame(() => {
  // WKWebView hands focus to the first thing it can find when the view becomes
  // first responder, which since buttons joined the tab order means the first
  // sidebar entry -- so the app opened with a focus ring on Containers that
  // nobody asked for. Nothing should be focused until someone presses Tab.
  // It happens once, on load; the window regaining focus does not repeat it.
  const focused = document.activeElement;
  if (
    focused instanceof HTMLElement &&
    focused !== document.body &&
    !focused.hasAttribute('autofocus')
  ) {
    focused.blur();
  }

  // The next frame is the first one with the UI on it; the splash waits for
  // this rather than for a timer.
  announceReady();
});
