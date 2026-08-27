import React from 'react';
import ReactDOM from 'react-dom/client';
// Installs window.dermaga before anything asks for it.
import { announceReady } from './services/bridge.wails';
import { sealWindow } from './services/notABrowser';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FindingWindow, findingRoute } from './pages/FindingWindow';
import { TrayPanel, isPanel } from './pages/TrayPanel';
import './index.css';

// Before the first frame: a right-click during startup would otherwise still
// find the browser underneath.
sealWindow();

// One bundle, three windows. A window opened for a single vulnerability loads
// the same code at a hash that names it, and renders that instead of the app:
// it has its own React root, its own bridge, and nothing of the shell -- no
// sidebar, no title bar of its own, nothing to navigate to. macOS draws its
// frame, which is where the CVE is named.
//
// The menu bar panel is the same trick again, at its own hash. It draws its own
// edge because macOS draws it none: it is a frameless window hanging under the
// menu bar, and everything inside it is this bundle's.
const finding = findingRoute();
const panel = isPanel();

// Inside StrictMode and around everything: a render that throws unmounts the
// tree, and with nothing to catch it this window has no console to explain
// itself with -- it is WebKit, not a browser, so a blank window would be the
// whole of the report.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {panel ? <TrayPanel /> : finding ? <FindingWindow route={finding} /> : <App />}
    </ErrorBoundary>
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
  // this rather than for a timer. Only the main window has a splash behind it
  // -- a second window announcing itself would dismiss one that is not there,
  // or worse, one belonging to a launch still in progress.
  if (!finding && !panel) announceReady();
});
