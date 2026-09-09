const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kuidy', {
  getStatus: () => ipcRenderer.invoke('app:getStatus'),
  getPlayback: () => ipcRenderer.invoke('app:getPlayback'),
  getLyrics: () => ipcRenderer.invoke('app:getLyrics'),
  authenticate: () => ipcRenderer.invoke('spotify:authenticate'),
  cancelAuth: () => ipcRenderer.invoke('spotify:cancelAuth'),
  logout: () => ipcRenderer.invoke('spotify:logout'),
  setClientId: (id) => ipcRenderer.invoke('spotify:setClientId', id),

  onPlayback: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('playback:update', handler);
    return () => ipcRenderer.removeListener('playback:update', handler);
  },
  onLyrics: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('lyrics:update', handler);
    return () => ipcRenderer.removeListener('lyrics:update', handler);
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
  onPrefs: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('settings:prefs', handler);
    return () => ipcRenderer.removeListener('settings:prefs', handler);
  },
  onGuideShow: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('guide:show', handler);
    return () => ipcRenderer.removeListener('guide:show', handler);
  },
  onPopoverState: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('popover:state', handler);
    return () => ipcRenderer.removeListener('popover:state', handler);
  },
  onStatusChanged: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('status:changed', handler);
    return () => ipcRenderer.removeListener('status:changed', handler);
  },

  close: () => ipcRenderer.invoke('window:close'),
  hideOverlay: () => ipcRenderer.invoke('window:hideOverlay'),
  showOverlay: () => ipcRenderer.invoke('window:showOverlay'),
  toggleOverlay: () => ipcRenderer.invoke('window:toggleOverlay'),
  setOpacity: (value) => ipcRenderer.invoke('window:setOpacity', value),
  setMinimalMode: (enabled) => ipcRenderer.invoke('window:setMinimalMode', enabled),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke('app:setOpenAtLogin', enabled),
  setShowSubs: (enabled) => ipcRenderer.invoke('app:setShowSubs', enabled),
  setSubsLang: (lang) => ipcRenderer.invoke('app:setSubsLang', lang),
  setTranslateConsent: (enabled) => ipcRenderer.invoke('app:setTranslateConsent', enabled),
  setFontScale: (value) => ipcRenderer.invoke('app:setFontScale', value),
  showGuide: () => ipcRenderer.invoke('app:showGuide'),
  guideDismissed: (dontShowAgain) => ipcRenderer.invoke('app:guideDismissed', dontShowAgain),
  openLogs: () => ipcRenderer.invoke('app:openLogs'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  closePopover: () => ipcRenderer.invoke('popover:close'),
  quit: () => ipcRenderer.invoke('app:quit'),
});
