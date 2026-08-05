import { useState } from 'react';
import { motion } from 'framer-motion';

function Kbd({ children }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded-md bg-white/10 border border-white/15 text-[10px] font-semibold text-white/90 tracking-wide whitespace-nowrap">
      {children}
    </kbd>
  );
}

function ShortcutRow({ keys, children }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="flex items-center gap-1 shrink-0 pt-px">
        {keys.map((k, i) => (
          <Kbd key={i}>{k}</Kbd>
        ))}
      </div>
      <div className="text-[11px] text-white/65 leading-snug">{children}</div>
    </div>
  );
}

export default function GuideView({ onClose }) {
  const [dontShowAgain, setDontShowAgain] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="no-drag absolute inset-0 z-50 flex items-center justify-center p-3"
      style={{
        background: 'rgba(8,8,14,0.78)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-[380px] rounded-xl border border-white/10 bg-[#16121f]/95 p-4 shadow-2xl"
      >
        <div className="text-[13px] font-semibold text-white/95 mb-3">
          Atajos de Kuidy Lyrics
        </div>

        <div className="space-y-2.5 mb-3.5">
          <ShortcutRow keys={['Ctrl', 'Alt', 'H']}>
            Mostrar u ocultar la ventana de letras
          </ShortcutRow>
          <ShortcutRow keys={['Ctrl', 'Alt', 'M']}>
            Modo flotante puro: solo la letra, los clicks la atraviesan
          </ShortcutRow>
          <ShortcutRow keys={['Bandeja']}>
            Click en el icono junto al reloj: ajustes, tamaño y opacidad
          </ShortcutRow>
        </div>

        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="accent-violet-400 w-3.5 h-3.5"
            />
            <span className="text-[10px] text-white/50">No volver a mostrar</span>
          </label>
          <button
            type="button"
            onClick={() => onClose(dontShowAgain)}
            className="h-8 px-4 rounded-full text-[11px] font-medium text-white transition-opacity hover:opacity-90"
            style={{
              background: 'linear-gradient(135deg, #a78bfa 0%, #c084fc 60%, #e879f9 100%)',
            }}
          >
            Entendido
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
