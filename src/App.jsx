import { useEffect, useState } from 'react';
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

export default function App() {
  if (isPopover) {
    return <PopoverView />;
  }
  return <OverlayApp />;
}

function OverlayApp() {
  const [status, setStatus] = useState(null);
  const [playback, setPlayback] = useState(null);
  const [lyricsState, setLyricsState] = useState({ lyrics: null, loadingLyrics: false });
  const [error, setError] = useState(null);
  const [palette, setPalette] = useState(DEFAULT_PALETTE);
  const [minimal, setMinimal] = useState(false);
  const [prefs, setPrefs] = useState({ showSubs: true, fontScale: 1 });
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    window.kuidy.getStatus().then((s) => {
      setStatus(s);
      if (s?.minimalMode) setMinimal(true);
      setPrefs({ showSubs: s?.showSubs !== false, fontScale: s?.fontScale || 1 });
      if (s && s.guideSeen === false) setShowGuide(true);
    });
    // La letra ya puede estar cargada si la ventana se abre a mitad de canción.
    window.kuidy.getLyrics?.().then((l) => {
      if (l) setLyricsState(l);
    });
    const offPlay = window.kuidy.onPlayback((data) => {
      setPlayback(data);
      setError(null);
    });
    const offLyrics = window.kuidy.onLyrics?.((data) => setLyricsState(data));
    const offErr = window.kuidy.onPlaybackError((e) => setError(e.message));
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
      offMin?.();
      offPrefs?.();
      offGuide?.();
    };
  }, []);

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
    const s = await window.kuidy.getStatus();
    setStatus(s);
  };

  const showSetup = !status || !status.hasClientId || !status.isAuthenticated;
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
          <AnimatePresence mode="wait">
            {showSetup ? (
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
          {showGuide && <GuideView onClose={closeGuide} />}
        </AnimatePresence>
      </div>
    </div>
  );
}
