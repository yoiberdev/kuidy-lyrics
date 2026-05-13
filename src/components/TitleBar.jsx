import { useEffect, useState } from 'react';
import KuidyMascot from './KuidyMascot.jsx';

function IconButton({ children, onClick, title, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`no-drag inline-flex items-center justify-center w-6 h-6 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

function Toggle({ checked, onChange, activeColor = 'bg-fuchsia-500/70' }) {
  return (
    <button
      onClick={onChange}
      className={`relative w-9 h-5 rounded-full transition-colors ${checked ? activeColor : 'bg-white/15'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export default function TitleBar({ onClose, onMinimize, status, minimal, onLogout }) {
  const [opacity, setOpacity] = useState(0.95);
  const [clickThrough, setClickThrough] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (status?.opacity != null) setOpacity(status.opacity);
    if (status?.clickThrough != null) setClickThrough(status.clickThrough);
  }, [status?.opacity, status?.clickThrough]);

  useEffect(() => {
    const off = window.kuidy.onClickThroughChange?.((v) => setClickThrough(!!v));
    return () => off?.();
  }, []);

  const updateOpacity = (v) => {
    setOpacity(v);
    window.kuidy.setOpacity(v);
  };

  const toggleClickThrough = () => {
    const next = !clickThrough;
    setClickThrough(next);
    window.kuidy.setClickThrough(next);
  };

  const toggleMinimal = () => {
    window.kuidy.setMinimalMode(!minimal);
    setMenuOpen(false);
  };

  return (
    <div className="drag relative h-9 flex items-center px-3 select-none">
      <div className="flex items-center gap-1.5">
        <div className="flex items-center justify-center w-5 h-5">
          <KuidyMascot size={18} />
        </div>
        <span className="text-[11px] font-medium tracking-wide text-white/70 brand-text">Kuidy Lyrics</span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <IconButton title="Opciones" onClick={() => setMenuOpen((v) => !v)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
            <circle cx="5" cy="12" r="1.6" />
          </svg>
        </IconButton>
        <IconButton title="Minimizar" onClick={onMinimize}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </IconButton>
        <IconButton title="Cerrar" onClick={onClose} className="hover:!text-rose-300 hover:!bg-rose-500/20">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </IconButton>
      </div>

      {menuOpen && (
        <div
          className="no-drag absolute right-2 top-9 z-30 w-64 rounded-xl border border-white/10 bg-black/75 backdrop-blur-xl p-3 shadow-2xl"
          onMouseLeave={() => setMenuOpen(false)}
        >
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Modo</div>
          <label className="flex items-center justify-between text-xs text-white/80">
            <div className="flex flex-col">
              <span>Modo flotante puro</span>
              <span className="text-[10px] text-white/40 mt-0.5">Solo letra, sin bordes</span>
            </div>
            <Toggle checked={!!minimal} onChange={toggleMinimal} activeColor="bg-emerald-500/80" />
          </label>
          <div className="mt-1 text-[10px] text-white/40 leading-snug">
            Atajo: <span className="text-white/60">Ctrl + Alt + M</span>. Al activarlo se ignoran tus clicks sobre la ventana — usa el atajo para volver.
          </div>

          <div className="my-3 h-px bg-white/10" />

          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Apariencia</div>
          <label className="block text-xs text-white/70 mb-1">Opacidad</label>
          <input
            type="range"
            min="0.3"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(e) => updateOpacity(parseFloat(e.target.value))}
            className="w-full accent-fuchsia-400"
          />

          <div className="my-3 h-px bg-white/10" />

          <label className="flex items-center justify-between text-xs text-white/80">
            <span>Atravesar clicks</span>
            <Toggle checked={clickThrough} onChange={toggleClickThrough} />
          </label>
          <div className="mt-1 text-[10px] text-white/40 leading-snug">
            Ctrl + Alt + L también activa esto. Ctrl + Alt + H oculta la ventana.
          </div>

          {status?.isAuthenticated && (
            <>
              <div className="my-3 h-px bg-white/10" />
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onLogout?.();
                }}
                className="w-full text-left text-xs text-rose-300 hover:text-rose-200"
              >
                Cerrar sesión de Spotify
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
