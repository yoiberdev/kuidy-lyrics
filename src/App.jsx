import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import TitleBar from './components/TitleBar.jsx';
import SetupView from './components/SetupView.jsx';
import LyricsView from './components/LyricsView.jsx';
import PopoverView from './components/PopoverView.jsx';
import GuideView from './components/GuideView.jsx';
import { extractPalette } from './lib/colors.js';

const DEFAULT_PALETTE = {
  vibrant: '#a78bfa',
  muted: '#f0abfc',
  accent: '#c4b5fd',
  vibrantRgb: '167,139,250',
  mutedRgb: '240,171,252',
  accentRgb: '196,181,253',
};

const isPopover =
  typeof window !== 'undefined' && window.location.hash.replace(/^#/, '') === 'popover';

// El main manda siempre { code, message, hint } y usa code:null para avisar de
// que el error se resolvió. Se normaliza aquí para no repartir por la vista
// objetos a medias si algún día llega un payload viejo.
function normalizeError(e) {
  if (!e || e.code === null) return null;
  if (!e.message) return null;
  return { code: e.code || 'unknown', message: e.message, hint: e.hint || '' };
}

export default function App() {
  if (isPopover) {
    return <PopoverView />;
  }
  return <OverlayApp />;
}

function OverlayApp() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [playback, setPlayback] = useState(null);
  const [lyricsState, setLyricsState] = useState({ lyrics: null, loadingLyrics: false });
  const [error, setError] = useState(null);
  const [palette, setPalette] = useState(DEFAULT_PALETTE);
  const [minimal, setMinimal] = useState(false);
  const [prefs, setPrefs] = useState({ showSubs: true, fontScale: 1 });
  const [showGuide, setShowGuide] = useState(false);

  // El status es la fuente de verdad de las preferencias y del modo flotante:
  // llega al montar y cada vez que el main lo cambia.
  const applyStatus = useCallback((s) => {
    if (!s) return;
    setStatus(s);
    setStatusError(null);
    setMinimal(!!s.minimalMode);
    setPrefs({ showSubs: s.showSubs !== false, fontScale: s.fontScale || 1 });
  }, []);

  useEffect(() => {
    window.kuidy
      .getStatus()
      .then((s) => {
        applyStatus(s);
        if (s && s.guideSeen === false) setShowGuide(true);
      })
      .catch(() => {
        // Si ni siquiera responde el IPC no se puede pintar el setup: sería
        // mentirle al usuario diciéndole que le falta conectar Spotify.
        setStatusError('No pudimos leer el estado de Kuidy. Ciérralo desde la bandeja y ábrelo otra vez.');
      });
    // La letra ya puede estar cargada si la ventana se abre a mitad de canción.
    window.kuidy.getLyrics?.()
      .then((l) => {
        if (l) setLyricsState(l);
      })
      .catch(() => {
        // Es solo un adelanto: el siguiente lyrics:update la trae igualmente.
      });
    const offPlay = window.kuidy.onPlayback((data) => setPlayback(data));
    const offLyrics = window.kuidy.onLyrics?.((data) => setLyricsState(data));
    // El poller avisa también cuando el error se resuelve, así que ya no hay
    // que limpiarlo a ciegas en cada playback:update.
    const offErr = window.kuidy.onPlaybackError((e) => setError(normalizeError(e)));
    // Sin esto, conectar Spotify desde el popover dejaba al overlay clavado
    // para siempre en la pantalla "Conecta con Spotify".
    const offStatus = window.kuidy.onStatusChanged?.((s) => applyStatus(s));
    const offMin = window.kuidy.onMinimalModeChange?.((v) => setMinimal(!!v));
    const offPrefs = window.kuidy.onPrefs?.((p) =>
      setPrefs((prev) => ({
        showSubs: p.showSubs !== false,
        fontScale: p.fontScale || prev.fontScale,
      }))
    );
    const offGuide = window.kuidy.onGuideShow?.(() => setShowGuide(true));
    return () => {
      offPlay?.();
      offLyrics?.();
      offErr?.();
      offStatus?.();
      offMin?.();
      offPrefs?.();
      offGuide?.();
    };
  }, [applyStatus]);

  const closeGuide = (dontShowAgain) => {
    setShowGuide(false);
    window.kuidy.guideDismissed?.(dontShowAgain);
  };

  useEffect(() => {
    const art = playback?.track?.albumArt;
    if (!art) {
      setPalette(DEFAULT_PALETTE);
      return;
    }
    let cancelled = false;
    extractPalette(art).then((p) => {
      if (cancelled) return;
      setPalette(p || DEFAULT_PALETTE);
    });
    return () => {
      cancelled = true;
    };
  }, [playback?.track?.id, playback?.track?.albumArt]);

  const refreshStatus = async () => {
    try {
      applyStatus(await window.kuidy.getStatus());
      setStatusError(null);
    } catch {
      setStatusError('No pudimos leer el estado de Kuidy. Ciérralo desde la bandeja y ábrelo otra vez.');
    }
  };

  // Hasta que no llega el status no se sabe nada: pintar el setup mientras
  // tanto le enseñaba "Conecta con Spotify" a todo el mundo, ya conectado o no.
  const showLoading = !status;
  const showSetup = !!status && (!status.hasClientId || !status.isAuthenticated);
  const showChrome = !minimal;

  return (
    <div className="h-screen w-screen flex flex-col">
      <div
        className={`relative flex-1 m-2 rounded-2xl overflow-hidden transition-all duration-300 ${
          showChrome
            ? 'border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.45)]'
            : 'border-transparent shadow-none'
        }`}
        style={{
          background: showChrome
            ? `linear-gradient(135deg, rgba(15,15,22,0.82) 0%, rgba(${palette.vibrantRgb},0.18) 50%, rgba(20,15,30,0.82) 100%)`
            : 'transparent',
          backdropFilter: showChrome ? 'blur(28px) saturate(140%)' : 'none',
          WebkitBackdropFilter: showChrome ? 'blur(28px) saturate(140%)' : 'none',
        }}
      >
        {showChrome && (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
            <div
              className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-48 w-[120%] blur-3xl rounded-full transition-colors duration-500"
              style={{ background: `rgba(${palette.vibrantRgb},0.18)` }}
            />
          </>
        )}

        <AnimatePresence>
          {showChrome && (
            <motion.div
              key="titlebar"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              <TitleBar onClose={() => window.kuidy.close()} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className={`relative px-4 pb-3 ${showChrome ? 'h-[calc(100%-36px)]' : 'h-full pt-3'}`}>
          {/* Fuera de la rama de carga: refreshStatus corre cuando el status ya
              está cargado (tras guardar el Client ID o conectar), y ahí su fallo
              no se veía en ninguna parte. */}
          {statusError && !showLoading && showChrome && (
            <div className="pb-1 text-[11px] text-rose-200/90 leading-snug">{statusError}</div>
          )}
          <AnimatePresence mode="wait">
            {showLoading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="h-full flex flex-col items-center justify-center text-center gap-2 px-3"
              >
                {statusError ? (
                  <div className="text-[11px] text-rose-200/90 leading-snug max-w-[320px]">
                    {statusError}
                  </div>
                ) : (
                  showChrome && (
                    <>
                      <div className="text-[11px] text-white/70">Iniciando Kuidy...</div>
                      <div className="w-24 h-1 rounded-full shimmer" />
                    </>
                  )
                )}
              </motion.div>
            ) : showSetup ? (
              <motion.div
                key="setup"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="h-full"
              >
                <SetupView status={status} onChange={refreshStatus} />
              </motion.div>
            ) : (
              <motion.div
                key="lyrics"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="h-full"
              >
                <LyricsView
                  playback={playback}
                  lyricsState={lyricsState}
                  error={error}
                  palette={palette}
                  minimal={minimal}
                  prefs={prefs}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {showGuide && (
            <GuideView
              onClose={closeGuide}
              version={status?.version}
              logPath={status?.logPath}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
