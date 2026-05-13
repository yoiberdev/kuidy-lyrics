const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kuidy', {
  getStatus: () => ipcRenderer.invoke('app:getStatus'),
  authenticate: () => ipcRenderer.invoke('spotify:authenticate'),
  logout: () => ipcRenderer.invoke('spotify:logout'),

  onPlayback: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('playback:update', handler);
    return () => ipcRenderer.removeListener('playback:update', handler);
  },
  onPlaybackError: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('playback:error', handler);
    return () => ipcRenderer.removeListener('playback:error', handler);
  },
  onClickThroughChange: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('settings:clickThrough', handler);
    return () => ipcRenderer.removeListener('settings:clickThrough', handler);
  },
  onMinimalModeChange: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('settings:minimalMode', handler);
    return () => ipcRenderer.removeListener('settings:minimalMode', handler);
  },

  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  setClickThrough: (enabled) => ipcRenderer.invoke('window:setClickThrough', enabled),
  setOpacity: (value) => ipcRenderer.invoke('window:setOpacity', value),
  setMinimalMode: (enabled) => ipcRenderer.invoke('window:setMinimalMode', enabled),
});
