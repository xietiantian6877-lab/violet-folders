'use strict';

const { contextBridge, ipcRenderer, sharedTexture } = require('electron');

// Transfer VideoFrames into the page's world without copying their pixels or
// passing GPU/native handles through the public context bridge.
sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, geometry) => {
  let frame;
  try {
    frame = importedSharedTexture.getVideoFrame();
    window.postMessage({ type: 'violet-desktop-frame', frame, geometry }, '*', [frame]);
    frame = null;
  } finally { frame?.close(); importedSharedTexture.release(); }
});

// No filesystem, process, shell, or unrestricted IPC primitive crosses this bridge.
contextBridge.exposeInMainWorld('violet', Object.freeze({
  getState: () => ipcRenderer.invoke('violet:get-state'),
  onState(callback) {
    if (typeof callback !== 'function') throw new TypeError('A state callback is required.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('violet:state', listener);
    return () => ipcRenderer.removeListener('violet:state', listener);
  },
  openFolder: path => ipcRenderer.invoke('violet:open-folder', path),
  togglePin: path => ipcRenderer.invoke('violet:toggle-pin', path),
  reorder: paths => ipcRenderer.invoke('violet:reorder', paths),
  holdPointer: value => ipcRenderer.send('violet:hold-pointer', value === true),
  setCollapsed: value => ipcRenderer.invoke('violet:set-collapsed', value),
  setLanguage: language => ipcRenderer.invoke('violet:set-language', language),
  setGlassSettings: patch => ipcRenderer.invoke('violet:set-glass-settings', patch),
  getDesktopSource: options => ipcRenderer.invoke('violet:get-desktop-source', options),
  stopDesktopCapture: () => ipcRenderer.invoke('violet:stop-desktop-capture'),
  onDesktopGeometry(callback) {
    if (typeof callback !== 'function') throw new TypeError('A desktop geometry callback is required.');
    const listener = (_event, geometry) => callback(geometry);
    ipcRenderer.on('violet:desktop-geometry', listener);
    return () => ipcRenderer.removeListener('violet:desktop-geometry', listener);
  },
  setLaunchAtLogin: value => ipcRenderer.invoke('violet:set-launch-at-login', value),
  setContentSize: size => ipcRenderer.invoke('violet:set-content-size', size),
  setInteractive: value => ipcRenderer.send('violet:set-interactive', value),
  setHitRegions: regions => ipcRenderer.send('violet:set-hit-regions', regions),
  dragWindow: phase => ipcRenderer.send('violet:drag', phase === 'start' ? 'start' : 'end'),
  resetPosition: () => ipcRenderer.invoke('violet:reset-position'),
  quit: () => ipcRenderer.invoke('violet:quit'),
  captureStats: () => ipcRenderer.invoke('violet:capture-stats'),
}));
