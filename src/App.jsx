import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import TitleBar from './components/TitleBar.jsx';
import SetupView from './components/SetupView.jsx';
import LyricsView from './components/LyricsView.jsx';
import { extractPalette } from './lib/colors.js';

const DEFAULT_PALETTE = {
  vibrant: '#a78bfa',
  muted: '#f0abfc',
  accent: '#c4b5fd',
  vibrantRgb: '167,139,250',
  mutedRgb: '240,171,252',
  accentRgb: '196,181,253',
};

export default function App() {
  const [status, setStatus] = useState(null);
  const [playback, setPlayback] = useState(null);
  const [error, setError] = useState(null);
  const [palette, setPalette] = useState(DEFAULT_PALETTE);
  const [minimal, setMinimal] = useState(false);

  useEffect(() => {
    window.kuidy.getStatus().then((s) => {
      setStatus(s);
      if (s?.minimalMode) setMinimal(true);
    });
    const offPlay = window.kuidy.onPlayback((data) => {
      setPlayback(data);
      setError(null);
    });
    const offErr = window.kuidy.onPlaybackError((e) => setError(e.message));
    const offMin = window.kuidy.onMinimalModeChange?.((v) => setMinimal(!!v));
    return () => {
      offPlay?.();
      offErr?.();
      offMin?.();
    };
  }, []);

  // Re-extraer paleta cuando cambia el album art
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
              <TitleBar
                onClose={() => window.kuidy.close()}
                onMinimize={() => window.kuidy.minimize()}
                status={status}
                minimal={minimal}
                onLogout={async () => {
                  await window.kuidy.logout();
                  await refreshStatus();
                  setPlayback(null);
                }}
              />
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
                  error={error}
                  palette={palette}
                  minimal={minimal}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
