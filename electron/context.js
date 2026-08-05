// Estado compartido del proceso main. Los módulos (windows, tray, poller, ipc)
// leen y escriben estas referencias; context no importa nada, así que nunca
// participa en ciclos de require.
module.exports = {
  isDev: process.env.NODE_ENV === 'development',
  clientId: '',
  mainWindow: null,
  popoverWindow: null,
  tray: null,
  lastPlaybackPayload: { playing: false },
  lastLyricsPayload: { lyrics: null, loadingLyrics: false },
};
