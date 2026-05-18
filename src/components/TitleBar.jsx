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

export default function TitleBar({ onClose }) {
  return (
    <div className="drag relative h-9 flex items-center px-3 select-none">
      <div className="flex items-center gap-1.5">
        <div className="flex items-center justify-center w-5 h-5">
          <KuidyMascot size={18} />
        </div>
        <span className="text-[11px] font-medium tracking-wide text-white/70 brand-text">
          Kuidy Lyrics
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <IconButton
          title="Ocultar (las opciones están en el icono de la barra del sistema)"
          onClick={onClose}
          className="hover:!text-rose-300 hover:!bg-rose-500/20"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}
