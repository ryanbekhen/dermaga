'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The renderer has no network access of its own: every call goes through the
// main process to the agent, and everything the agent pushes comes back on one
// notification channel.
contextBridge.exposeInMainWorld('dermaga', {
  platform: process.platform,
  isElectron: true,

  invoke: (method, params) => ipcRenderer.invoke('dermaga:invoke', method, params),

  onNotify: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on('dermaga:notify', handler);
    return () => ipcRenderer.removeListener('dermaga:notify', handler);
  },

  isFullScreen: () => ipcRenderer.invoke('dermaga:is-fullscreen'),

  // Keeps the main process in step with preferences it has to act on without
  // asking, such as whether to raise a notification.
  syncSettings: (settings) => ipcRenderer.send('dermaga:settings', settings),


  onOpenContainer: (callback) => {
    const handler = (_event, id) => callback(id);
    ipcRenderer.on('dermaga:open-container', handler);
    return () => ipcRenderer.removeListener('dermaga:open-container', handler);
  },

  // Returns the chosen path, or null if the dialog was dismissed.
  pickDirectory: (title) => ipcRenderer.invoke('dermaga:pick-directory', title),

  // Fetches a licence that is too large to ship, by key rather than by URL.
  fetchLicence: (key) => ipcRenderer.invoke('dermaga:fetch-licence', key),

  checkUpdate: () => ipcRenderer.invoke('dermaga:check-update'),
  downloadUpdate: (assetUrl, version) =>
    ipcRenderer.invoke('dermaga:download-update', assetUrl, version),
  // Opens the installer and closes Dermaga, so the app can be replaced.
  installUpdate: (dmgPath) => ipcRenderer.invoke('dermaga:install-update', dmgPath),

  onUpdateProgress: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('dermaga:update-progress', handler);
    return () => ipcRenderer.removeListener('dermaga:update-progress', handler);
  },

  onFullScreenChange: (callback) => {
    const handler = (_event, value) => callback(Boolean(value));
    ipcRenderer.on('dermaga:fullscreen', handler);
    return () => ipcRenderer.removeListener('dermaga:fullscreen', handler);
  },
});
