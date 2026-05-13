import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

function findCurrentLineIndex(lines, posMs) {
  if (!lines || lines.length === 0) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= posMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export default function LyricsView({ playback, error, palette, minimal }) {
  const [localPos, setLocalPos] = useState(0);
  const lastSyncRef = useRef({ at: 0, pos: 0, playing: false });
  const containerRef = useRef(null);
  const activeRef = useRef(null);

  useEffect(() => {
    if (!playback || !playback.playing) {
      lastSyncRef.current = { at: Date.now(), pos: 0, playing: false };
      setLocalPos(0);
      return;
    }
    lastSyncRef.current = {
      at: Date.now(),
      pos: playback.progressMs || 0,
      playing: !!playback.isPlaying,
    };
    setLocalPos(playback.progressMs || 0);
  }, [playback?.progressMs, playback?.track?.id, playback?.isPlaying, playback?.playing]);

  useEffect(() => {
    let raf;
    const tick = () => {
      const { at, pos, playing } = lastSyncRef.current;
      if (playing) setLocalPos(pos + (Date.now() - at));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const synced = playback?.lyrics?.synced && playback?.lyrics?.lines?.length > 0;
  const lines = playback?.lyrics?.lines || [];
  const currentIdx = useMemo(
    () => (synced ? findCurrentLineIndex(lines, localPos) : -1),
    [synced, lines, localPos]
  );

  useEffect(() => {
    if (!synced || !activeRef.current || !containerRef.current) return;
    const c = containerRef.current;
    const el = activeRef.current;
    const targetTop = el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2;
    c.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
  }, [currentIdx, synced]);

  // Estilos derivados de la paleta
  const accent = palette?.accent || '#c4b5fd';
  const accentRgb = palette?.accentRgb || '196,181,253';

  // En modo minimal, el texto necesita ser legible sobre cualquier fondo
  const minimalShadow = `
    -1px -1px 0 rgba(0,0,0,0.95), 1px -1px 0 rgba(0,0,0,0.95),
    -1px 1px 0 rgba(0,0,0,0.95), 1px 1px 0 rgba(0,0,0,0.95),
    0 0 14px rgba(0,0,0,0.85),
    0 2px 6px rgba(0,0,0,0.7)
  `;
  const activeMinimalShadow = `
    ${minimalShadow},
    0 0 24px rgba(${accentRgb},0.55)
  `;

  if (error) {
    return (
      <div className="h-full flex items-center justify-center px-4 text-center">
        <div className="text-[11px] text-rose-300/90 leading-snug max-w-[340px]">{error}</div>
      </div>
    );
  }
  if (!playback) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-[11px] text-white/40">Conectando con Spotify...</div>
      </div>
    );
  }
  if (!playback.playing || !playback.track) {
    if (minimal) return <div className="h-full" />;
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-2">
        <div className="text-[28px]">🎧</div>
        <div className="text-xs text-white/55">No se está reproduciendo nada</div>
        <div className="text-[10px] text-white/30">Pon play en Spotify para empezar</div>
      </div>
    );
  }

  const { track, lyrics, loadingLyrics, isPlaying } = playback;

  return (
    <div className="h-full flex flex-col">
      {!minimal && (
        <div className="flex items-center gap-2 mb-2">
          {track.albumArt ? (
            <img
              src={track.albumArt}
              alt=""
              className="w-7 h-7 rounded-md object-cover shadow"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-7 h-7 rounded-md bg-white/10" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-white/90 truncate leading-tight">
              {track.name}
            </div>
            <div className="text-[10px] text-white/45 truncate leading-tight">
              {track.artists.join(', ')}
            </div>
          </div>
          {!isPlaying && (
            <div className="text-[9px] uppercase tracking-wider text-white/30">pausa</div>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        className={`relative flex-1 lyrics-scroll px-1 ${minimal ? 'minimal' : ''}`}
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent 0, #000 18%, #000 82%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0, #000 18%, #000 82%, transparent 100%)',
        }}
      >
        <AnimatePresence mode="wait">
          {loadingLyrics ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center h-full gap-2"
            >
              {!minimal && <div className="text-[10px] text-white/40">Buscando letra...</div>}
              {!minimal && <div className="w-32 h-1 rounded-full shimmer" />}
            </motion.div>
          ) : synced ? (
            <motion.div
              key={`synced-${track.id}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-6 space-y-2"
            >
              {lines.map((line, i) => {
                const isActive = i === currentIdx;
                const distance = Math.abs(i - currentIdx);
                return (
                  <div
                    key={i}
                    ref={isActive ? activeRef : null}
                    className="text-center transition-all duration-300 will-change-transform"
                    style={{
                      opacity: isActive ? 1 : Math.max(minimal ? 0 : 0.12, 0.7 - distance * 0.22),
                      transform: isActive ? 'scale(1.04)' : 'scale(1)',
                    }}
                  >
                    <span
                      className={
                        isActive
                          ? minimal
                            ? 'text-[20px] font-bold text-white'
                            : 'text-[15px] font-semibold text-white'
                          : minimal
                          ? 'text-[14px] text-white/80 font-medium'
                          : 'text-[12px] text-white/55'
                      }
                      style={{
                        textShadow: minimal
                          ? isActive
                            ? activeMinimalShadow
                            : minimalShadow
                          : isActive
                          ? `0 0 14px rgba(${accentRgb},0.55)`
                          : 'none',
                        color: isActive && !minimal ? '#fff' : undefined,
                      }}
                    >
                      {line.text || '♪'}
                    </span>
                  </div>
                );
              })}
            </motion.div>
          ) : lyrics?.plain ? (
            <motion.div
              key={`plain-${track.id}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-3 text-center"
            >
              {!minimal && (
                <div className="text-[10px] uppercase tracking-wider text-white/35 mb-2">
                  Letra (sin sincronizar)
                </div>
              )}
              <div
                className={
                  minimal
                    ? 'text-[14px] leading-relaxed text-white whitespace-pre-wrap font-medium'
                    : 'text-[12px] leading-relaxed text-white/75 whitespace-pre-wrap'
                }
                style={{ textShadow: minimal ? minimalShadow : 'none' }}
              >
                {lyrics.plain}
              </div>
            </motion.div>
          ) : lyrics?.instrumental ? (
            <motion.div
              key="instrumental"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="h-full flex items-center justify-center text-[11px] text-white/40"
              style={{ textShadow: minimal ? minimalShadow : 'none' }}
            >
              ♪ Tema instrumental ♪
            </motion.div>
          ) : (
            <motion.div
              key="not-found"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="h-full flex items-center justify-center text-center px-2"
            >
              <div
                className={minimal ? 'text-[12px] text-white/70' : 'text-[11px] text-white/40'}
                style={{ textShadow: minimal ? minimalShadow : 'none' }}
              >
                {minimal ? '' : 'No encontramos letra para esta canción.'}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
