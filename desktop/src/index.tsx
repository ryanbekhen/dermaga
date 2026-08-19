import React from 'react';
import ReactDOM from 'react-dom/client';
// Installs window.dermaga before anything asks for it.
import { announceReady } from './services/bridge.wails';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// The next frame is the first one with the UI on it; the splash waits for this
// rather than for a timer.
requestAnimationFrame(() => announceReady());
