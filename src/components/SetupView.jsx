import { useEffect, useRef, useState } from 'react';

const DASHBOARD_URL = 'https://developer.spotify.com/dashboard';

// Spotify entrega el Client ID como 32 hexadecimales. Se valida aquí además de
// en el main para poder decirle al usuario qué le falta mientras teclea, no
// después de guardar.
const CLIENT_ID_LEN = 32;

// Si el status llegara sin redirectUri la pantalla se quedaría sin el dato más
// importante de todos, así que se cae al valor que usa el main (ipc.js).
const FALLBACK_REDIRECT_URI = 'http://127.0.0.1:8888/callback';

// El portapapeles asíncrono puede no estar disponible (permiso denegado,
// contexto no seguro); execCommand sigue funcionando dentro de Electron y es la
// diferencia entre copiar la Redirect URI y tener que teclearla sin fallar una
// sola letra.
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Se intenta el camino viejo antes de darlo por perdido.
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// El overlay bloquea la navegación externa y los popups (windows.js), así que
// abrir el enlace solo funciona si el bridge expone una salida al navegador.
// Cuando no la hay, copiar el enlace deja al usuario avanzar igualmente.
async function openInBrowser(url) {
  try {
    if (typeof window.kuidy?.openExternal === 'function') {
      await window.kuidy.openExternal(url);
      return 'opened';
    }
  } catch {
    // Da igual por qué falló: abajo queda el plan B.
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    // Puede estar denegado; el enlace copiado es lo que de verdad importa.
  }
  return (await copyText(url)) ? 'copied' : 'manual';
}

function validateClientId(raw) {
  const v = String(raw || '').trim();
  if (!v) return { ok: false, tone: 'idle', msg: '' };
  if (/[^0-9a-fA-F]/.test(v)) {
    return {
      ok: false,
      tone: 'bad',
      msg: 'El Client ID solo lleva números y letras de la A a la F. Revisa que no se haya colado un espacio o parte de otra línea.',
    };
  }
  if (v.length < CLIENT_ID_LEN) {
    const falta = CLIENT_ID_LEN - v.length;
    return {
      ok: false,
      tone: 'bad',
      msg: `Le faltan ${falta} ${falta === 1 ? 'carácter' : 'caracteres'}: el Client ID tiene ${CLIENT_ID_LEN}.`,
    };
  }
  if (v.length > CLIENT_ID_LEN) {
    const sobra = v.length - CLIENT_ID_LEN;
    return {
      ok: false,
      tone: 'bad',
      msg: `Le sobran ${sobra} ${sobra === 1 ? 'carácter' : 'caracteres'}: el Client ID tiene ${CLIENT_ID_LEN}.`,
    };
  }
  return { ok: true, tone: 'good', msg: 'Client ID completo.' };
}

function Step({ n, title, children }) {
  return (
    <div className="flex gap-2.5">
      <div className="shrink-0 mt-px w-[17px] h-[17px] rounded-full bg-white/10 border border-white/15 text-[9px] font-semibold text-white/75 flex items-center justify-center">
        {n}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <div className="text-[11px] text-white/80 leading-snug">{title}</div>
        {children && <div className="mt-1.5">{children}</div>}
      </div>
    </div>
  );
}

function CopyButton({ value, label = 'Copiar', className = '' }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => setCopied(await copyText(value))}
      className={`no-drag shrink-0 h-6 px-2 rounded-md text-[10px] font-medium transition-colors ${
        copied
          ? 'bg-emerald-500/20 text-emerald-200'
          : 'bg-white/10 text-white/75 hover:bg-white/15 hover:text-white'
      } ${className}`}
    >
      {copied ? 'Copiado' : label}
    </button>
  );
}

export default function SetupView({ status, onChange, blocked = null }) {
  const [authing, setAuthing] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [clientId, setClientId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [pasteError, setPasteError] = useState(null);
  const [linkHint, setLinkHint] = useState(null);
  // Con un Client ID equivocado ya guardado, la pantalla de conectar falla una y
  // otra vez sin salida: este flag permite volver al asistente para cambiarlo.
  const [editingClientId, setEditingClientId] = useState(false);
  // Cancelar hace que authenticate() devuelva un fallo que no es un problema:
  // sin esto el usuario ve en rojo el error de algo que ha pedido él.
  const cancelledRef = useRef(false);
  const inputRef = useRef(null);

  const redirectUri = status?.redirectUri || FALLBACK_REDIRECT_URI;
  const hasClientId = !!status?.hasClientId;
  const check = validateClientId(clientId);

  const connect = async () => {
    setAuthing(true);
    setError(null);
    setNotice(null);
    cancelledRef.current = false;
    try {
      const r = await window.kuidy.authenticate();
      if (!r?.ok) {
        if (cancelledRef.current) {
          setNotice('Conexión cancelada. Puedes volver a intentarlo cuando quieras.');
        } else {
          setError(r?.error || 'No se pudo conectar con Spotify. Vuelve a intentarlo.');
        }
      }
      await onChange?.();
    } catch (e) {
      setError(e?.message || 'No se pudo conectar con Spotify. Vuelve a intentarlo.');
    } finally {
      setAuthing(false);
    }
  };

  const cancelConnect = async () => {
    cancelledRef.current = true;
    setNotice('Cancelando...');
    try {
      await window.kuidy.cancelAuth?.();
    } catch {
      // El flujo se corta igual cuando caduca; no hay nada útil que contar aquí.
    }
    await onChange?.();
  };

  const saveClientId = async () => {
    const value = clientId.trim();
    if (!validateClientId(value).ok || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await window.kuidy.setClientId(value);
      if (!r?.ok) {
        setSaveError(r?.error || 'No se pudo guardar el Client ID. Vuelve a copiarlo del dashboard.');
        return;
      }
      setClientId('');
      setEditingClientId(false);
      await onChange?.();
    } catch (e) {
      setSaveError(e?.message || 'No se pudo guardar el Client ID. Vuelve a copiarlo del dashboard.');
    } finally {
      setSaving(false);
    }
  };

  // El overlay es una ventana que no roba el foco, así que teclear dentro puede
  // no llegar a funcionar: este botón es la vía de entrada que no depende del
  // teclado. Se intentan los dos caminos porque el portapapeles asíncrono pide
  // permiso y el permiso solo se concede con la ventana enfocada.
  const pasteClientId = async () => {
    setPasteError(null);
    try {
      const text = await navigator.clipboard.readText();
      const clean = String(text || '').trim();
      if (clean) {
        setClientId(clean);
        setSaveError(null);
        return;
      }
    } catch {
      // Camino bloqueado: queda el pegado clásico sobre el propio campo.
    }
    try {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
        if (document.execCommand('paste')) {
          const clean = String(el.value || '').trim();
          if (clean) {
            setClientId(clean);
            setSaveError(null);
            return;
          }
        }
      }
    } catch {
      // Nada que hacer: se lo contamos al usuario abajo.
    }
    setPasteError(
      'No pudimos coger nada del portapapeles. Vuelve a copiar el Client ID en el dashboard y pulsa Pegar otra vez.'
    );
  };

  const openDashboard = async () => {
    const r = await openInBrowser(DASHBOARD_URL);
    if (r === 'opened') setLinkHint('Abriendo el dashboard en tu navegador...');
    else if (r === 'copied') setLinkHint('Enlace copiado: pégalo en tu navegador.');
    else setLinkHint('Escribe developer.spotify.com/dashboard en tu navegador.');
  };

  if (!hasClientId || editingClientId || blocked) {
    return (
      <div className="no-drag h-full overflow-y-auto lyrics-scroll pr-1">
        <div className="max-w-[380px] mx-auto text-left pb-1">
          {blocked ? (
            <>
              <div className="text-[12px] font-semibold text-rose-200 leading-tight">
                Tu cuenta no cabe en esta app de Spotify
              </div>
              <div className="text-[10px] text-white/65 leading-snug mt-1 mb-1">
                Spotify limita cada app a 5 cuentas y las de esta ya están ocupadas. No
                es un fallo tuyo y no se arregla reintentando: con tu propia app de
                Spotify, que es gratis, dejas de competir por esas plazas.
              </div>
              <div className="text-[10px] text-amber-200/80 leading-snug mb-2.5">
                Aviso antes de empezar: al ser tú el dueño de la app, Spotify te exigirá
                tener <strong className="font-semibold">Premium</strong>. Con cuenta
                gratuita el trámite no servirá de nada.
              </div>
            </>
          ) : (
            <>
              <div className="text-[12px] font-semibold text-white/90 leading-tight">
                Crea tu app de Spotify
              </div>
              <div className="text-[10px] text-white/50 leading-snug mt-0.5 mb-1">
                Spotify solo permite 5 cuentas por app, así que Kuidy usa una app tuya.
                Es gratis y son dos minutos.
              </div>
              <div className="text-[10px] text-amber-200/80 leading-snug mb-2.5">
                Necesitas <strong className="font-semibold">Spotify Premium</strong>:
                serás el dueño de la app y Spotify lo exige.
              </div>
            </>
          )}

          <div className="space-y-2.5">
            <Step n="1" title="Entra en el dashboard de Spotify y pulsa «Create app». El nombre y la descripción da igual cuáles sean.">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openDashboard}
                  className="no-drag h-6 px-2.5 rounded-md bg-white/10 hover:bg-white/15 text-[10px] font-medium text-white/85 hover:text-white transition-colors"
                >
                  Abrir el dashboard
                </button>
                <span className="text-[9px] text-white/35 truncate">
                  developer.spotify.com/dashboard
                </span>
              </div>
              {linkHint && (
                <div className="text-[9px] text-white/45 mt-1 leading-snug">{linkHint}</div>
              )}
            </Step>

            <Step n="2" title="En «Redirect URI» pega esto, tal cual, y marca la casilla «Web API»:">
              <div className="flex items-center gap-1.5">
                <code className="flex-1 min-w-0 px-2 py-1 rounded-md bg-black/35 border border-white/10 font-mono text-[10px] text-emerald-200/90 truncate">
                  {redirectUri}
                </code>
                <CopyButton value={redirectUri} />
              </div>
              <div className="text-[9px] text-white/40 mt-1 leading-snug">
                Un carácter de diferencia y Spotify rechaza el login sin explicar por qué.
              </div>
            </Step>

            <Step n="3" title="Copia el «Client ID» de tu app y pégalo aquí:">
              <div className="flex items-center gap-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  value={clientId}
                  placeholder="32 caracteres"
                  onChange={(e) => {
                    setClientId(e.target.value);
                    setSaveError(null);
                    setPasteError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveClientId();
                  }}
                  className={`no-drag flex-1 min-w-0 h-7 px-2 rounded-md bg-black/35 border font-mono text-[10px] text-white/90 placeholder:text-white/25 transition-colors ${
                    check.tone === 'bad'
                      ? 'border-rose-400/50'
                      : check.tone === 'good'
                        ? 'border-emerald-400/50'
                        : 'border-white/10 focus:border-white/25'
                  }`}
                />
                <button
                  type="button"
                  onClick={pasteClientId}
                  className="no-drag shrink-0 h-7 px-2 rounded-md bg-white/10 hover:bg-white/15 text-[10px] font-medium text-white/75 hover:text-white transition-colors"
                >
                  Pegar
                </button>
                <button
                  type="button"
                  onClick={saveClientId}
                  disabled={!check.ok || saving}
                  className="no-drag shrink-0 h-7 px-2.5 rounded-md text-[10px] font-semibold text-white disabled:opacity-35 disabled:cursor-not-allowed transition-opacity"
                  style={{
                    background: 'linear-gradient(135deg, #1ed760 0%, #14b85a 60%, #0fa548 100%)',
                  }}
                >
                  {saving ? 'Guardando' : 'Guardar'}
                </button>
              </div>
              {check.msg && !saveError && !pasteError && (
                <div
                  className={`text-[9px] mt-1 leading-snug ${
                    check.tone === 'good' ? 'text-emerald-300/80' : 'text-amber-300/80'
                  }`}
                >
                  {check.msg}
                </div>
              )}
              {pasteError && (
                <div className="text-[9px] text-amber-300/85 mt-1 leading-snug">{pasteError}</div>
              )}
              {saveError && (
                <div className="text-[9px] text-rose-300 mt-1 leading-snug">{saveError}</div>
              )}
              {!check.msg && !saveError && !pasteError && (
                <div className="text-[9px] text-white/40 mt-1 leading-snug">
                  Es el «Client ID», no el «Client Secret»: Kuidy no necesita el secreto.
                </div>
              )}
            </Step>
          </div>

          <div className="mt-3 pt-2 border-t border-white/[0.07] space-y-1">
            <div className="text-[9px] text-white/50 leading-snug">
              Tu cuenta de Spotify tiene que ser <span className="text-white/75">Premium</span>:
              la API no da la canción en curso a las cuentas gratuitas.
            </div>
            <div className="text-[9px] text-white/50 leading-snug">
              En tu app del dashboard, entra en{' '}
              <span className="text-white/75">Settings &gt; User Management</span> y añade tu
              propio email. Si no lo haces, Spotify te dará error al conectar.
            </div>
          </div>

          {hasClientId && (
            <button
              type="button"
              onClick={() => {
                setEditingClientId(false);
                setClientId('');
                setSaveError(null);
                setPasteError(null);
              }}
              className="no-drag mt-2 text-[10px] text-white/45 hover:text-white/80 transition-colors"
            >
              ← Volver
            </button>
          )}
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
      <div className="flex items-center gap-2">
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

        {/* Sin esta salida, un login que se queda a medias deja al usuario
            mirando "Esperando autorización..." hasta que caduca el flujo. */}
        {authing && (
          <button
            onClick={cancelConnect}
            className="no-drag h-10 px-4 rounded-full text-[12px] font-medium text-white/70 hover:text-white bg-white/10 hover:bg-white/15 transition-colors"
          >
            Cancelar
          </button>
        )}
      </div>

      {error && (
        <div className="no-drag mt-3 text-[11px] text-rose-300 max-w-[340px] leading-snug">
          {error}
        </div>
      )}
      {!error && notice && (
        <div className="no-drag mt-3 text-[11px] text-white/55 max-w-[340px] leading-snug">
          {notice}
        </div>
      )}

      {!authing && (
        <button
          type="button"
          onClick={() => {
            setEditingClientId(true);
            setError(null);
            setNotice(null);
          }}
          className="no-drag mt-3 text-[10px] text-white/40 hover:text-white/75 transition-colors"
        >
          Cambiar el Client ID
        </button>
      )}
    </div>
  );
}
