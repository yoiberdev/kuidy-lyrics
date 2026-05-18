const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kuidy', {
  getStatus: () => ipcRenderer.invoke('app:getStatus'),
  getPlayback: () => ipcRenderer.invoke('app:getPlayback'),
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
  onPopoverState: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('popover:state', handler);
    return () => ipcRenderer.removeListener('popover:state', handler);
  },

  close: () => ipcRenderer.invoke('window:close'),
  hideOverlay: () => ipcRenderer.invoke('window:hideOverlay'),
  showOverlay: () => ipcRenderer.invoke('window:showOverlay'),
  toggleOverlay: () => ipcRenderer.invoke('window:toggleOverlay'),
  setOpacity: (value) => ipcRenderer.invoke('window:setOpacity', value),
  setMinimalMode: (enabled) => ipcRenderer.invoke('window:setMinimalMode', enabled),

  closePopover: () => ipcRenderer.invoke('popover:close'),
  quit: () => ipcRenderer.invoke('app:quit'),
});
