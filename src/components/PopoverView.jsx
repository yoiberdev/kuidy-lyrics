import { useEffect, useState } from 'react';
import KuidyMascot from './KuidyMascot.jsx';

function ToggleVisual({ checked, accent = 'bg-emerald-500' }) {
  return (
    <span
      aria-hidden
      className={`relative inline-block w-10 h-6 rounded-full transition-colors shrink-0 ${
        checked ? accent : 'bg-white/15'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </span>
  );
}

function Row({ onClick, children, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center justify-between text-left px-3 py-2.5 rounded-lg hover:bg-white/[0.06] active:bg-white/[0.09] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}

export default function PopoverView() {
  const [state, setState] = useState({
    overlayVisible: true,
    minimalMode: false,
    opacity: 0.95,
    isAuthenticated: false,
    hasClientId: false,
    playback: { playing: false },
  });
  const [authing, setAuthing] = useState(false);

  useEffect(() => {
    const refresh = async () => {
      const s = await window.kuidy.getStatus();
      const pb = await window.kuidy.getPlayback().catch(() => ({ playing: false }));
      setState((prev) => ({
        ...prev,
        overlayVisible: s.overlayVisible,
        minimalMode: s.minimalMode,
        opacity: s.opacity,
        isAuthenticated: s.isAuthenticated,
        hasClientId: s.hasClientId,
        playback: pb || { playing: false },
      }));
    };
    refresh();
    const offState = window.kuidy.onPopoverState?.((data) => {
      setState((prev) => ({ ...prev, ...data }));
    });
    const offPlay = window.kuidy.onPlayback((data) => {
      setState((prev) => ({ ...prev, playback: data }));
    });
    // Refresh whenever the popover gains focus (it's hidden between uses)
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      offState?.();
      offPlay?.();
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const toggleOverlay = () => {
    window.kuidy.toggleOverlay();
    setState((p) => ({ ...p, overlayVisible: !p.overlayVisible }));
  };

  const toggleMinimal = () => {
    const next = !state.minimalMode;
    setState((p) => ({ ...p, minimalMode: next }));
    window.kuidy.setMinimalMode(next);
  };

  const updateOpacity = (v) => {
    setState((p) => ({ ...p, opacity: v }));
    window.kuidy.setOpacity(v);
  };

  const connect = async () => {
    setAuthing(true);
    try {
      await window.kuidy.authenticate();
    } finally {
      setAuthing(false);
    }
  };

  const logout = async () => {
    await window.kuidy.logout();
  };

  const quit = () => window.kuidy.quit();

  const track = state.playback?.playing ? state.playback.track : null;

  return (
    <div className="popover-shell h-screen w-screen p-2">
      <div className="popover-card relative h-full w-full rounded-2xl border border-white/10 overflow-hidden flex flex-col">
        {/* Header: brand + now playing */}
        <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
          <KuidyMascot size={22} animated={false} />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-white/90 leading-tight">
              Kuidy Lyrics
            </div>
            <div className="text-[10px] text-white/45 leading-tight truncate">
              {state.isAuthenticated ? 'Spotify conectado' : 'Sin conectar'}
            </div>
          </div>
        </div>

        {track && (
          <div className="px-4 pb-3 flex items-center gap-2.5">
            {track.albumArt ? (
              <img
                src={track.albumArt}
                alt=""
                className="w-9 h-9 rounded-md object-cover shadow shrink-0"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-9 h-9 rounded-md bg-white/10 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-white/90 truncate leading-tight">
                {track.name}
              </div>
              <div className="text-[10px] text-white/45 truncate leading-tight">
                {track.artists?.join(', ')}
              </div>
            </div>
            {!state.playback.isPlaying && (
              <div className="text-[9px] uppercase tracking-wider text-white/35 shrink-0">
                pausa
              </div>
            )}
          </div>
        )}

        <div className="mx-3 h-px bg-white/[0.07]" />

        {/* Body */}
        {!state.hasClientId ? (
          <div className="flex-1 px-4 py-4 text-center flex flex-col items-center justify-center gap-1">
            <div className="text-[12px] font-medium text-rose-300">
              Configuración incompleta
            </div>
            <div className="text-[10px] text-white/55 leading-snug">
              Falta el archivo <code className="text-white/80">.env</code> con{' '}
              <code className="text-white/80">SPOTIFY_CLIENT_ID</code>.
            </div>
          </div>
        ) : !state.isAuthenticated ? (
          <div className="flex-1 px-4 py-4 flex flex-col items-center justify-center gap-3">
            <div className="text-[11px] text-white/55 text-center leading-snug">
              Conecta tu cuenta de Spotify para empezar.
            </div>
            <button
              onClick={connect}
              disabled={authing}
              className="px-4 h-9 rounded-full text-[12px] font-medium text-white shadow-lg shadow-emerald-900/40 disabled:opacity-50 transition-colors"
              style={{
                background:
                  'linear-gradient(135deg, #1ed760 0%, #14b85a 50%, #0fa548 100%)',
              }}
            >
              {authing ? 'Esperando…' : 'Conectar Spotify'}
            </button>
          </div>
        ) : (
          <div className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
            <Row onClick={toggleOverlay}>
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-medium text-white/90">
                  Mostrar letras
                </span>
                <span className="text-[10px] text-white/40">
                  Ventana flotante always-on-top
                </span>
              </div>
              <ToggleVisual checked={state.overlayVisible} />
            </Row>

            <Row onClick={toggleMinimal} disabled={!state.overlayVisible}>
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-medium text-white/90">
                  Modo flotante puro
                </span>
                <span className="text-[10px] text-white/40">
                  Solo letra, ignora clicks
                </span>
              </div>
              <ToggleVisual checked={state.minimalMode} accent="bg-fuchsia-500" />
            </Row>

            <div className="px-3 pt-3 pb-1">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-white/80">Opacidad</span>
                <span className="text-[10px] text-white/45 tabular-nums">
                  {Math.round(state.opacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.3"
                max="1"
                step="0.05"
                value={state.opacity}
                onChange={(e) => updateOpacity(parseFloat(e.target.value))}
                className="w-full accent-fuchsia-400"
              />
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="px-2 pt-2 pb-2 border-t border-white/[0.07] flex items-center gap-1">
          {state.isAuthenticated && (
            <button
              onClick={logout}
              className="flex-1 h-8 rounded-lg text-[11px] text-white/70 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              Cerrar sesión
            </button>
          )}
          <button
            onClick={quit}
            className="flex-1 h-8 rounded-lg text-[11px] text-rose-300/90 hover:text-rose-200 hover:bg-rose-500/10 transition-colors"
          >
            Salir
          </button>
        </div>
      </div>
    </div>
  );
}
