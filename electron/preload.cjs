'use strict';

const { contextBridge, ipcRenderer } = require('electron');

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
  setCollapsed: value => ipcRenderer.invoke('violet:set-collapsed', value),
  setLanguage: language => ipcRenderer.invoke('violet:set-language', language),
  setLaunchAtLogin: value => ipcRenderer.invoke('violet:set-launch-at-login', value),
  setContentSize: size => ipcRenderer.invoke('violet:set-content-size', size),
  setInteractive: value => ipcRenderer.send('violet:set-interactive', value),
  setHitRegions: regions => ipcRenderer.send('violet:set-hit-regions', regions),
  resetPosition: () => ipcRenderer.invoke('violet:reset-position'),
  quit: () => ipcRenderer.invoke('violet:quit'),
}));
