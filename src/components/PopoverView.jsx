import { useEffect, useMemo, useRef, useState } from 'react';
import KuidyMascot from './KuidyMascot.jsx';

// Idiomas destino más probables de las sub-líneas. 'Automático' manda '' y el
// main resuelve el idioma de Windows, así que el pill que se queda marcado
// después es el del idioma detectado, no el de 'Automático'.
const SUBS_LANGS = [
  { code: '', label: 'Automático' },
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
];

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

// Enlace al registro para las pantallas en las que todavía no hay menú: quien no
// consigue configurar ni conectar es justo quien más necesita mandarnos el log.
function LogsLink({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[10px] text-white/35 hover:text-white/70 underline decoration-white/20 underline-offset-2 transition-colors"
    >
      Abrir carpeta de logs
    </button>
  );
}

export default function PopoverView() {
  // El status del main es la única fuente de verdad: aquí solo se copia para
  // pintar y se parchea en optimista mientras llega el eco por IPC.
  const [status, setStatus] = useState(null);
  const [playback, setPlayback] = useState({ playing: false });
  const [authing, setAuthing] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authNotice, setAuthNotice] = useState(null);
  // Cancelar devuelve un fallo de authenticate que no es un problema: sin esto
  // el usuario ve en rojo el resultado de algo que ha pedido él.
  const cancelledRef = useRef(false);

  useEffect(() => {
    const refresh = async () => {
      // Sin catch, un fallo del invoke dejaba una promesa rechazada sin manejar
      // y el popover con el estado anterior sin decir nada.
      try {
        const s = await window.kuidy.getStatus();
        const pb = await window.kuidy.getPlayback().catch(() => null);
        setStatus((prev) => ({ ...prev, ...s }));
        setPlayback(pb || { playing: false });
      } catch {
        setAuthError('No pudimos leer el estado de Kuidy. Ciérralo desde la bandeja y ábrelo otra vez.');
      }
    };
    refresh();
    const offState = window.kuidy.onPopoverState?.((data) => {
      if (!data) return;
      const { playback: pb, ...rest } = data;
      setStatus((prev) => (prev ? { ...prev, ...rest } : prev));
      if (pb) setPlayback(pb);
    });
    // Sin esto el popover no se enteraba de los cambios que nacen fuera de él
    // (bandeja, atajos, la propia ventana de letras) y se quedaba desfasado.
    const offStatus = window.kuidy.onStatusChanged?.((s) => {
      if (s) setStatus((prev) => ({ ...prev, ...s }));
    });
    const offPlay = window.kuidy.onPlayback((data) => {
      setPlayback(data || { playing: false });
    });
    // Refresh whenever the popover gains focus (it's hidden between uses)
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      offState?.();
      offStatus?.();
      offPlay?.();
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Parche optimista sobre el status: el main confirma después por
  // 'status:changed' o 'popover:state' y lo que valga es siempre lo suyo.
  const patch = (fields) => setStatus((prev) => (prev ? { ...prev, ...fields } : prev));

  const overlayVisible = !!status?.overlayVisible;
  const minimalMode = !!status?.minimalMode;
  const showSubs = status?.showSubs !== false;
  const translateConsent = !!status?.translateConsent;
  const openAtLogin = !!status?.openAtLogin;
  const isAuthenticated = !!status?.isAuthenticated;
  const hasClientId = !!status?.hasClientId;
  const opacity = status?.opacity ?? 0.95;
  const fontScale = status?.fontScale || 1;
  const subsLang = status?.subsLang || '';

  // Si el idioma resuelto no es ninguno de los habituales (locale japonés, ruso…)
  // hay que enseñarlo igual o el usuario no vería marcado ninguno.
  const langOptions = useMemo(() => {
    const base = SUBS_LANGS.slice();
    if (subsLang && !base.some((o) => o.code === subsLang)) {
      base.push({ code: subsLang, label: subsLang.toUpperCase() });
    }
    return base;
  }, [subsLang]);

  const toggleOverlay = () => {
    patch({ overlayVisible: !overlayVisible });
    window.kuidy.toggleOverlay();
  };

  const toggleMinimal = () => {
    patch({ minimalMode: !minimalMode });
    window.kuidy.setMinimalMode(!minimalMode);
  };

  const updateOpacity = (v) => {
    patch({ opacity: v });
    window.kuidy.setOpacity(v);
  };

  const toggleOpenAtLogin = () => {
    patch({ openAtLogin: !openAtLogin });
    window.kuidy.setOpenAtLogin(!openAtLogin);
  };

  const toggleSubs = () => {
    patch({ showSubs: !showSubs });
    window.kuidy.setShowSubs(!showSubs);
  };

  const toggleTranslate = () => {
    patch({ translateConsent: !translateConsent });
    window.kuidy.setTranslateConsent(!translateConsent);
  };

  const chooseLang = (code) => {
    // Con 'Automático' (code '') el idioma real lo decide el main a partir del
    // locale de Windows, así que ahí no se adelanta nada: se espera al status.
    if (code) patch({ subsLang: code });
    window.kuidy.setSubsLang(code);
  };

  const updateFontScale = (v) => {
    patch({ fontScale: v });
    window.kuidy.setFontScale(v);
  };

  const openLogs = () => {
    window.kuidy.openLogs?.();
  };

  // El asistente de Client ID vive en la ventana de letras: desde aquí solo se
  // puede llevar al usuario hasta él.
  const openSetup = async () => {
    try {
      await window.kuidy.showOverlay();
    } finally {
      window.kuidy.closePopover();
    }
  };

  const connect = async () => {
    setAuthing(true);
    setAuthError(null);
    setAuthNotice(null);
    cancelledRef.current = false;
    try {
      // Antes se tiraba el resultado: fallar y acertar se veían exactamente
      // igual, el botón dejaba de girar y no pasaba nada más.
      const r = await window.kuidy.authenticate();
      if (!r?.ok) {
        if (cancelledRef.current) {
          setAuthNotice('Conexión cancelada.');
        } else {
          setAuthError(r?.error || 'No se pudo conectar con Spotify. Vuelve a intentarlo.');
        }
      }
    } catch (e) {
      setAuthError(e?.message || 'No se pudo conectar con Spotify. Vuelve a intentarlo.');
    } finally {
      setAuthing(false);
    }
  };

  const cancelConnect = async () => {
    cancelledRef.current = true;
    try {
      await window.kuidy.cancelAuth?.();
    } catch {
      // El flujo se corta igual al caducar; no hay nada útil que contar aquí.
    }
  };

  const logout = async () => {
    setAuthError(null);
    setAuthNotice(null);
    await window.kuidy.logout();
  };

  const quit = () => window.kuidy.quit();

  const track = playback?.playing ? playback.track : null;

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
              {!status
                ? 'Cargando...'
                : isAuthenticated
                  ? 'Spotify conectado'
                  : hasClientId
                    ? 'Sin conectar'
                    : 'Sin configurar'}
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
            {!playback.isPlaying && (
              <div className="text-[9px] uppercase tracking-wider text-white/35 shrink-0">
                pausa
              </div>
            )}
          </div>
        )}

        <div className="mx-3 h-px bg-white/[0.07]" />

        {/* Body */}
        {!status ? (
          // Hasta que llega el status no se sabe nada: pintar ya la pantalla de
          // "falta tu Client ID" le daba un susto a quien lo tiene puesto.
          <div className="flex-1 flex items-center justify-center">
            <div className="w-20 h-1 rounded-full shimmer" />
          </div>
        ) : !hasClientId ? (
          <div className="flex-1 px-4 py-4 text-center flex flex-col items-center justify-center gap-2">
            <div className="text-[12px] font-medium text-white/90">
              Falta tu Client ID de Spotify
            </div>
            <div className="text-[10px] text-white/55 leading-snug">
              Spotify solo permite 5 cuentas por app, así que Kuidy funciona con una app
              tuya. El asistente está en la ventana de letras.
            </div>
            <button
              onClick={openSetup}
              className="mt-1 px-4 h-9 rounded-full text-[12px] font-medium text-white bg-white/12 hover:bg-white/20 transition-colors"
            >
              Abrir el asistente
            </button>
            <div className="mt-1">
              <LogsLink onClick={openLogs} />
            </div>
          </div>
        ) : !isAuthenticated ? (
          <div className="flex-1 px-4 py-4 flex flex-col items-center justify-center gap-3">
            <div className="text-[11px] text-white/55 text-center leading-snug">
              Conecta tu cuenta de Spotify para empezar.
            </div>
            <div className="flex items-center gap-2">
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
              {authing && (
                <button
                  onClick={cancelConnect}
                  className="px-3 h-9 rounded-full text-[12px] text-white/70 hover:text-white bg-white/10 hover:bg-white/15 transition-colors"
                >
                  Cancelar
                </button>
              )}
            </div>
            {authError && (
              <div className="text-[10px] text-rose-300 text-center leading-snug">
                {authError}
              </div>
            )}
            {!authError && authNotice && (
              <div className="text-[10px] text-white/50 text-center leading-snug">
                {authNotice}
              </div>
            )}
            <LogsLink onClick={openLogs} />
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
              <ToggleVisual checked={overlayVisible} />
            </Row>

            <Row onClick={toggleMinimal} disabled={!overlayVisible}>
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-medium text-white/90">
                  Modo flotante puro
                </span>
                <span className="text-[10px] text-white/40">
                  Solo letra, ignora clicks
                </span>
              </div>
              <ToggleVisual checked={minimalMode} accent="bg-fuchsia-500" />
            </Row>

            <Row onClick={toggleSubs}>
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-medium text-white/90">
                  Sub-líneas de letra
                </span>
                <span className="text-[10px] text-white/40">
                  Romaji o traducción bajo cada frase
                </span>
              </div>
              <ToggleVisual checked={showSubs} accent="bg-violet-500" />
            </Row>

            <Row onClick={toggleTranslate}>
              <div className="flex flex-col min-w-0 pr-2">
                <span className="text-[12px] font-medium text-white/90">
                  Traducir letras
                </span>
                <span className="text-[10px] text-white/40 leading-snug">
                  Manda la letra a Google Traductor. El romaji del japonés es local y
                  funciona sin esto.
                </span>
              </div>
              <ToggleVisual checked={translateConsent} accent="bg-amber-500" />
            </Row>

            <div className="px-3 pt-2 pb-1">
              <div className="text-[11px] font-medium text-white/80 mb-1.5">
                Idioma de las sub-líneas
              </div>
              <div className="flex flex-wrap gap-1">
                {langOptions.map((o) => {
                  const active = o.code !== '' && o.code === subsLang;
                  return (
                    <button
                      key={o.code || 'auto'}
                      type="button"
                      onClick={() => chooseLang(o.code)}
                      className={`h-6 px-2 rounded-md text-[10px] font-medium transition-colors ${
                        active
                          ? 'bg-violet-500/30 text-violet-100'
                          : 'bg-white/[0.07] text-white/60 hover:bg-white/15 hover:text-white/90'
                      }`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
              <div className="text-[9px] text-white/35 mt-1 leading-snug">
                «Automático» usa el idioma de Windows y marca el que detecte.
              </div>
            </div>

            <Row onClick={toggleOpenAtLogin}>
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-medium text-white/90">
                  Iniciar con Windows
                </span>
                <span className="text-[10px] text-white/40">
                  Abrir Kuidy al encender el equipo
                </span>
              </div>
              <ToggleVisual checked={openAtLogin} accent="bg-sky-500" />
            </Row>

            <Row
              onClick={() => {
                window.kuidy.showGuide();
                window.kuidy.closePopover();
              }}
            >
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-medium text-white/90">
                  Guía de atajos
                </span>
                <span className="text-[10px] text-white/40">
                  Ctrl+Alt+H, Ctrl+Alt+M y más
                </span>
              </div>
              <span className="text-[13px] text-white/30 shrink-0">›</span>
            </Row>

            <Row onClick={openLogs}>
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-medium text-white/90">
                  Abrir carpeta de logs
                </span>
                <span className="text-[10px] text-white/40">
                  El registro que hay que mandarnos si algo falla
                </span>
              </div>
              <span className="text-[13px] text-white/30 shrink-0">›</span>
            </Row>

            <Row onClick={() => window.kuidy.openExternal('https://ko-fi.com/yoiberdev')}>
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-medium text-amber-300/90 flex items-center gap-1.5">
                  ☕ Invítame un café
                </span>
                <span className="text-[10px] text-white/40">
                  Apoya el desarrollo en Ko-fi o Buy Me a Coffee
                </span>
              </div>
              <span className="text-[13px] text-amber-300/60 shrink-0">›</span>
            </Row>

            <div className="px-3 pt-3 pb-1">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-white/80">Tamaño de letra</span>
                <span className="text-[10px] text-white/45 tabular-nums">
                  {Math.round(fontScale * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.8"
                max="1.6"
                step="0.05"
                value={fontScale}
                onChange={(e) => updateFontScale(parseFloat(e.target.value))}
                className="w-full accent-violet-400"
              />
            </div>

            <div className="px-3 pt-3 pb-1">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-white/80">Opacidad</span>
                <span className="text-[10px] text-white/45 tabular-nums">
                  {Math.round(opacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.3"
                max="1"
                step="0.05"
                value={opacity}
                onChange={(e) => updateOpacity(parseFloat(e.target.value))}
                className="w-full accent-fuchsia-400"
              />
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="px-2 pt-2 pb-1.5 border-t border-white/[0.07]">
          <div className="flex items-center gap-1">
            {isAuthenticated && (
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
          {status?.version && (
            <div className="text-center text-[9px] text-white/25 tabular-nums pt-0.5">
              v{status.version}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
