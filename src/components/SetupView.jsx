import { useState } from 'react';

export default function SetupView({ status, onChange }) {
  const [authing, setAuthing] = useState(false);
  const [error, setError] = useState(null);

  const connect = async () => {
    setAuthing(true);
    setError(null);
    try {
      const r = await window.kuidy.authenticate();
      if (!r.ok) setError(r.error);
      await onChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setAuthing(false);
    }
  };

  if (status && !status.hasClientId) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-3">
        <div className="text-sm font-medium text-rose-300 mb-1">Configuración incompleta</div>
        <div className="text-[11px] text-white/55 leading-snug max-w-[340px]">
          Falta el archivo <code className="text-white/80">.env</code> con la variable{' '}
          <code className="text-white/80">SPOTIFY_CLIENT_ID</code>.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-2">
      <div className="text-sm font-medium text-white/85 mb-1">Conecta con Spotify</div>
      <div className="text-[11px] text-white/55 mb-4 leading-snug max-w-[320px]">
        Se abrirá tu navegador para autorizar el acceso.
        <br />
        Solo leemos qué canción estás escuchando.
      </div>
      <button
        disabled={authing}
        onClick={connect}
        className="no-drag group relative h-10 px-6 rounded-full text-sm font-medium text-white shadow-lg shadow-emerald-900/40 disabled:opacity-50 transition-all overflow-hidden"
        style={{
          background:
            'linear-gradient(135deg, #1ed760 0%, #14b85a 50%, #0fa548 100%)',
        }}
      >
        <span className="relative z-10 flex items-center gap-2">
          {authing ? (
            <>Esperando autorización...</>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.5 14.4c-.18.3-.54.42-.84.24-2.34-1.44-5.28-1.74-8.76-.96-.36.06-.66-.18-.72-.48-.06-.36.18-.66.48-.72 3.78-.84 7.08-.48 9.66 1.08.36.18.42.54.18.84zm1.2-2.7c-.24.36-.66.48-1.02.24-2.7-1.68-6.78-2.16-9.96-1.2-.42.12-.84-.12-.96-.54-.12-.42.12-.84.54-.96 3.6-1.08 8.1-.54 11.16 1.32.36.18.48.66.24 1.14zm.12-2.82C14.4 8.94 9.78 8.7 7.02 9.54c-.48.18-1.02-.12-1.2-.6-.18-.48.12-1.02.6-1.2 3.18-.96 8.28-.78 11.7 1.26.42.24.6.84.36 1.26-.18.36-.78.54-1.2.3z" />
              </svg>
              Conectar Spotify
            </>
          )}
        </span>
        <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors" />
      </button>

      {error && (
        <div className="no-drag mt-3 text-[11px] text-rose-300 max-w-[340px] leading-snug">
          {error}
        </div>
      )}
    </div>
  );
}
