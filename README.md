# Kuidy Lyrics

Overlay flotante de letras de Spotify para Windows. Ventana transparente, siempre al frente (incluso encima de juegos en *borderless fullscreen*), con UI minimalista y letras **sincronizadas** que se resaltan línea a línea con la canción.

> ### Hay una version en Rust, y ya se puede descargar
>
> Kuidy se ha reescrito desde cero en Rust, sin Electron y sin navegador
> dentro: **14 MB en vez de 392**, un proceso en vez de cinco. Hace lo mismo
> —letras sincronizadas, traduccion y romaji— y ademas el romaji ya no
> arrastra un diccionario de 17 MB.
>
> **[Descargar el .exe](https://github.com/yoiberdev/kuidy-lyrics/releases/tag/rs-v0.1.0-alpha)**
> · el codigo esta en [`kuidy-rs/`](https://github.com/yoiberdev/kuidy-lyrics/tree/beta/0.9.0/kuidy-rs)
> (rama `beta/0.9.0`)
>
> Es una alpha y solo hay build de Windows. Lo de abajo describe la version
> de Electron, que sigue siendo la estable.

## Cómo funciona

- **Detección de canción**: usa la Spotify Web API (`/me/player/currently-playing`) — devuelve la pista y el progreso en ms con exactitud.
- **Letras**: las saca de [lrclib.net](https://lrclib.net) (gratis, sin API key, con letras sincronizadas en formato LRC).
- **Sub-líneas automáticas**: para canciones en japonés genera la lectura **romaji** debajo de cada frase (kuroshiro + kuromoji, offline); para canciones en otros idiomas muestra la **traducción al español**. Se puede desactivar desde el popover.
- **UI**: Electron + React + Tailwind + Framer Motion, con glassmorphism.

## Arquitectura

El proceso main está dividido en módulos bajo `electron/`:

| Módulo | Responsabilidad |
| --- | --- |
| `main.js` | Bootstrap: dotenv, single-instance lock, ciclo de vida, atajos globales |
| `context.js` | Estado compartido (refs de ventanas, tray, últimos payloads) |
| `windows.js` | Overlay y popover: creación, posicionamiento, modo flotante |
| `tray.js` | Icono de bandeja y menú contextual |
| `poller.js` | Polling adaptativo de Spotify y broadcasts IPC |
| `subtitles.js` | Sub-líneas: detección de idioma, romaji y traducción |
| `ipc.js` | Handlers de `ipcMain` |
| `config.js` | Config persistida con defaults y tokens cifrados (safeStorage/DPAPI) |

## Setup (primera vez)

### 1. Instala Node.js

Necesitas Node 20 o superior. Si no lo tienes: <https://nodejs.org>.

### 2. Instala dependencias

Desde una terminal en la carpeta del proyecto:

```bash
npm install
```

### 3. Crea una app en Spotify Developer (una sola vez)

1. Entra en <https://developer.spotify.com/dashboard> con tu cuenta de Spotify.
2. **Create app** → nombre `Kuidy Lyrics`, descripción cualquiera.
3. En **Redirect URIs** añade exactamente:

   ```
   http://127.0.0.1:8888/callback
   ```

4. Marca **Web API**, acepta los términos y guarda.
5. Copia el **Client ID** que te aparece.
6. En *Settings → User Management*, añade tu email de Spotify como *usuario autorizado*.

### 4. Configura el .env

Crea (o edita) un archivo `.env` en la raíz del proyecto:

```env
SPOTIFY_CLIENT_ID=pega_aqui_tu_client_id
```

### 5. Arranca

```bash
npm run dev
```

Click en "Conectar Spotify", autorizas en el navegador, y listo — el `.env` se carga solo y no vuelve a preguntar.

## Uso

Al abrir la app por primera vez aparece una guía con los atajos (se puede reabrir desde el popover → "Guía de atajos").

- **Arrastrar la ventana**: arrastra desde la barra superior. **Redimensionar**: arrastra los bordes.
- **Atajos globales** (funcionan incluso dentro de juegos):
  - `Ctrl + Alt + H` — oculta/muestra la ventana de letras.
  - `Ctrl + Alt + M` — modo flotante puro: solo la letra, los clicks la atraviesan.
- **Popover de la bandeja** (click en el icono junto al reloj): mostrar/ocultar overlay, modo flotante, sub-líneas, iniciar con Windows, tamaño de letra, opacidad, guía de atajos y sesión de Spotify. Click derecho: menú rápido.

## Empaquetar como `.exe` instalable

```bash
npm run build
```

El instalador queda en `release/`.

## Notas

- La config vive en `%APPDATA%\kuidy-lyrics\kuidy-config.json` y los tokens en `kuidy-tokens.json`, **cifrados con DPAPI** (safeStorage). Borra esos archivos si quieres reiniciar la config.
- El instalador incluye el `.env` como recurso (`build.extraResources`), así el Client ID viaja con la app empaquetada. Con PKCE el Client ID no es secreto — nunca pongas un client secret en el `.env`.
- La cuenta que autorizas en Kuidy debe ser **la misma** en la que suena la música; si el overlay dice "no se está reproduciendo nada" con música sonando, revisa con qué cuenta está logueado tu reproductor.
- Si Spotify devuelve **403** la primera vez, asegúrate de haber añadido tu email en *User Management* en el dashboard.
- Para juegos en **fullscreen exclusivo** (algunos DirectX antiguos) el overlay puede no aparecer encima — la mayoría de juegos modernos usan *borderless* y funciona perfectamente.
