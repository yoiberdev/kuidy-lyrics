import { useCallback, useEffect, useRef, useState } from 'react';
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

// El aviso de error nunca sustituye a la letra: un 429 o un corte de red de tres
// segundos borraba la pantalla entera y el usuario perdía el hilo de la canción.
function ErrorBanner({ error }) {
  return (
    <div className="mb-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-2.5 py-1.5">
      <div className="text-[11px] text-rose-200 leading-snug">{error.message}</div>
      {error.hint && (
        <div className="text-[10px] text-white/70 leading-snug mt-0.5">{error.hint}</div>
      )}
    </div>
  );
}

// En modo flotante los clicks atraviesan la ventana: una caja de error sería
// imposible de quitar y se quedaría encima de lo que el usuario esté haciendo.
function ErrorDot() {
  return (
    <div
      className="pointer-events-none absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full"
      style={{ background: 'rgba(251,113,133,0.9)', boxShadow: '0 0 6px rgba(0,0,0,0.9)' }}
    />
  );
}

export default function LyricsView({ playback, lyricsState, error, palette, minimal, prefs }) {
  const lyrics = lyricsState?.lyrics || null;
  const loadingLyrics = !!lyricsState?.loadingLyrics;
  const lines = lyrics?.lines || [];
  const synced = !!(lyrics?.synced && lines.length > 0);

  const showSubs = prefs?.showSubs !== false;
  const fontScale = prefs?.fontScale || 1;
  // Tamaños en px reales escalados por la preferencia del usuario. El énfasis
  // de la línea activa se hace con font-size, no con transform: scale(), que
  // rasteriza el texto ya pintado y lo emborrona.
  const px = (n) => Math.round(n * fontScale * 10) / 10;

  const [currentIdx, setCurrentIdx] = useState(-1);
  const lastSyncRef = useRef({ at: 0, pos: 0, playing: false });
  const linesRef = useRef([]);
  const containerRef = useRef(null);
  const activeRef = useRef(null);
  const resizeObsRef = useRef(null);
  // En un ref y no en estado: solo lo lee el scroll, y así scrollToActive puede
  // ser estable y servir también de callback ref del contenedor.
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    reduceMotionRef.current = mq.matches;
    const onChange = () => {
      reduceMotionRef.current = mq.matches;
    };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    linesRef.current = synced ? lines : [];
  }, [lines, synced]);

  // Resincroniza la posición con cada tick del poll y recalcula la línea activa.
  useEffect(() => {
    if (!playback || !playback.playing) {
      lastSyncRef.current = { at: Date.now(), pos: 0, playing: false };
      setCurrentIdx(-1);
      return;
    }
    lastSyncRef.current = {
      at: Date.now(),
      pos: playback.progressMs || 0,
      playing: !!playback.isPlaying,
    };
    setCurrentIdx(findCurrentLineIndex(linesRef.current, playback.progressMs || 0));
  }, [playback?.progressMs, playback?.track?.id, playback?.isPlaying, playback?.playing, synced]);

  // Entre ticks del poll, el rAF interpola la posición pero solo hace setState
  // cuando cambia la línea activa: re-renderizar toda la letra a 60fps cuando
  // la línea cambia cada ~3s sería trabajo tirado. En pausa o sin letra
  // sincronizada el loop ni siquiera corre.
  const isActivePlayback = !!(playback?.playing && playback?.isPlaying);
  useEffect(() => {
    if (!isActivePlayback || !synced) return;
    let raf;
    const tick = () => {
      const { at, pos, playing } = lastSyncRef.current;
      if (playing) {
        const idx = findCurrentLineIndex(linesRef.current, pos + (Date.now() - at));
        setCurrentIdx((prev) => (prev === idx ? prev : idx));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isActivePlayback, synced]);

  const scrollToActive = useCallback((smooth) => {
    const c = containerRef.current;
    const el = activeRef.current;
    if (!c || !el) return;
    const targetTop = el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2;
    c.scrollTo({
      top: Math.max(0, targetTop),
      behavior: smooth && !reduceMotionRef.current ? 'smooth' : 'auto',
    });
  }, []);

  // Callback ref en vez de un efecto: el contenedor se desmonta cada vez que se
  // corta la reproducción, y con un efecto el observer se quedaba mirando al
  // nodo viejo.
  const attachContainer = useCallback(
    (node) => {
      containerRef.current = node;
      resizeObsRef.current?.disconnect();
      resizeObsRef.current = null;
      if (!node || typeof ResizeObserver === 'undefined') return;
      // Redimensionar la ventana no dispara ningún efecto por sí solo y la
      // línea activa se quedaba fuera de pantalla hasta la siguiente.
      const ro = new ResizeObserver(() => scrollToActive(false));
      ro.observe(node);
      resizeObsRef.current = ro;
    },
    [scrollToActive]
  );

  useEffect(() => () => resizeObsRef.current?.disconnect(), []);

  // fontScale y showSubs cambian la altura de cada línea: sin ellos en las
  // dependencias, tocar el tamaño de letra o las sub-líneas dejaba la línea
  // activa descolocada hasta que la canción avanzaba.
  useEffect(() => {
    if (!synced) return;
    scrollToActive(true);
  }, [currentIdx, synced, fontScale, showSubs, scrollToActive]);

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

  // 'ad' y 'episode' se veían igual que "no se está reproduciendo nada", que es
  // también lo que sale con la cuenta equivocada: el usuario no podía distinguirlos.
  const kind = playback?.kind || 'track';
  const isAd = kind === 'ad';
  const isEpisode = kind === 'episode';
  const hasTrack = !!(playback?.playing && playback.track && !isAd && !isEpisode);

  if (!hasTrack) {
    if (minimal) {
      return (
        <div className="relative h-full">
          {error && <ErrorDot />}
          {(isAd || isEpisode) && (
            <div className="h-full flex items-center justify-center text-center px-2">
              <div className="text-[12px] text-white/70" style={{ textShadow: minimalShadow }}>
                {isAd ? 'Anuncio de Spotify' : 'Podcast: sin letra sincronizada'}
              </div>
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-2 px-3">
        {error ? (
          // Aquí no hay letra que tapar y el error es lo único accionable.
          <>
            <div className="text-xs text-rose-200 leading-snug max-w-[340px]">{error.message}</div>
            {error.hint && (
              <div className="text-[10px] text-white/70 leading-snug max-w-[320px]">{error.hint}</div>
            )}
          </>
        ) : !playback ? (
          <div className="text-[11px] text-white/70">Conectando con Spotify...</div>
        ) : isAd ? (
          <>
            <div className="text-xs text-white/70">Anuncio de Spotify</div>
            <div className="text-[10px] text-white/70">La letra vuelve al acabar el anuncio.</div>
          </>
        ) : isEpisode ? (
          <>
            <div className="text-xs text-white/70 leading-snug max-w-[300px]">
              Esto es un podcast, no tiene letra sincronizada
            </div>
            {playback.track?.name && (
              <div className="text-[10px] text-white/70 truncate max-w-[280px]">
                {playback.track.name}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-[28px]">🎧</div>
            <div className="text-xs text-white/70">No se está reproduciendo nada</div>
            <div className="text-[10px] text-white/70 leading-snug max-w-[300px]">
              Si estás escuchando algo, comprueba que Spotify está en la misma cuenta que
              autorizaste.
            </div>
          </>
        )}
      </div>
    );
  }

  const { track, isPlaying } = playback;

  return (
    <div className="relative h-full flex flex-col">
      {minimal && error && <ErrorDot />}
      {!minimal && error && <ErrorBanner error={error} />}

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
            <div className="text-[9px] uppercase tracking-wider text-white/70">pausa</div>
          )}
        </div>
      )}

      <div
        ref={attachContainer}
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
              {!minimal && <div className="text-[10px] text-white/70">Buscando letra...</div>}
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
                    className="text-center transition-opacity duration-300"
                    style={{
                      opacity: isActive ? 1 : Math.max(minimal ? 0 : 0.12, 0.7 - distance * 0.22),
                    }}
                  >
                    <span
                      className={
                        isActive
                          ? minimal
                            ? 'font-bold text-white'
                            : 'font-semibold text-white'
                          : minimal
                          ? 'text-white/80 font-medium'
                          : 'text-white/55'
                      }
                      style={{
                        fontSize: `${px(isActive ? (minimal ? 20 : 15) : minimal ? 14 : 12)}px`,
                        transition: 'font-size 0.25s ease, color 0.25s ease',
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
                    {showSubs && line.sub && (
                      <div
                        className={
                          isActive
                            ? minimal
                              ? 'text-white/90 mt-0.5'
                              : 'text-white/70 mt-0.5'
                            : minimal
                            ? 'text-white/60'
                            : 'text-white/35'
                        }
                        style={{
                          fontSize: `${px(isActive ? (minimal ? 13 : 11) : minimal ? 11 : 10)}px`,
                          transition: 'font-size 0.25s ease',
                          textShadow: minimal ? minimalShadow : 'none',
                        }}
                      >
                        {line.sub}
                      </div>
                    )}
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
                <div className="text-[10px] uppercase tracking-wider text-white/70 mb-2">
                  Letra (sin sincronizar)
                </div>
              )}
              <div
                className={
                  minimal
                    ? 'leading-relaxed text-white whitespace-pre-wrap font-medium'
                    : 'leading-relaxed text-white/75 whitespace-pre-wrap'
                }
                style={{
                  fontSize: `${px(minimal ? 14 : 12)}px`,
                  textShadow: minimal ? minimalShadow : 'none',
                }}
              >
                {lyrics.plain}
              </div>
            </motion.div>
          ) : lyrics?.instrumental ? (
            <motion.div
              key="instrumental"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="h-full flex items-center justify-center text-[11px] text-white/70"
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
                className="text-[11px] text-white/70"
                style={{ textShadow: minimal ? minimalShadow : 'none' }}
              >
                {minimal
                  ? ''
                  : lyrics?.errorKind
                  ? 'No pudimos descargar la letra ahora mismo. Lo reintentamos en un momento.'
                  : 'No encontramos letra para esta canción.'}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
