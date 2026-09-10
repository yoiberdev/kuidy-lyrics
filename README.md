# Kuidy Lyrics

Overlay flotante de letras de Spotify para Windows. Ventana transparente, siempre al frente (incluso encima de juegos en *borderless fullscreen*), con UI minimalista y letras **sincronizadas** que se resaltan línea a línea con la canción.

> ### Hay una version en Rust, y ya no pide cuenta de desarrollador
>
> Kuidy se ha reescrito desde cero en Rust, sin Electron y sin navegador
> dentro: **14 MB en vez de 392**, un proceso en vez de cinco. Y desde la
> 0.2.0 le pregunta a **Windows** que suena en lugar de a la API de Spotify,
> asi que **no hay nada que conectar**: se abre y funciona, con cualquier
> reproductor.
>
> **[Descargar el .exe](https://github.com/yoiberdev/kuidy-lyrics/releases/tag/rs-v0.2.0)**
> · el codigo y sus instrucciones estan en [`kuidy-rs/`](kuidy-rs/)
>
> Solo hay build de Windows. Lo de abajo describe la version de Electron,
> que sigue siendo la estable.

> **¿Solo quieres usar la app?** Este README es la documentación de desarrollo. Si has recibido un instalador `.exe`, lo tuyo es **[BETA.md](BETA.md)**: instalación, cómo crear tu app de Spotify y cómo reportar fallos.

## Cómo funciona

- **Detección de canción**: usa la Spotify Web API (`/me/player/currently-playing`) — devuelve la pista y el progreso en ms con exactitud.
- **Letras**: las saca de [lrclib.net](https://lrclib.net) (gratis, sin API key, con letras sincronizadas en formato LRC).
- **Sub-líneas automáticas**: para canciones en japonés genera la lectura **romaji** debajo de cada frase (kuroshiro + kuromoji, **offline**); para el resto de idiomas puede mostrar la **traducción**, que es *opt-in* porque manda el texto de la letra a un servicio externo. Todo se controla desde el popover.
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
| `lyrics.js` | Letras de lrclib, parseo LRC y caché en disco (`%APPDATA%\kuidy-lyrics\cache\lyrics.json`) |
| `subtitles.js` | Sub-líneas: detección de idioma, romaji y traducción |
| `ipc.js` | Handlers de `ipcMain` y emisión de `status:changed` |
| `preload.js` | Puente `window.kuidy` entre renderer y main (contextIsolation) |
| `config.js` | Config persistida con defaults, Client ID de usuario y tokens cifrados (safeStorage/DPAPI) |
| `log.js` | Log a archivo en `%APPDATA%`, con tokens y Client IDs redactados |

## Credenciales: dos escalones

Una app de Spotify en *Development Mode* admite [como máximo 5 cuentas de usuario](https://developer.spotify.com/documentation/web-api/concepts/quota-modes), y el *Extended Quota Mode* que quitaría ese límite solo se concede a organizaciones con entidad legal y 250.000 usuarios activos mensuales — desde mayo de 2025 ni siquiera se aceptan solicitudes de proyectos individuales. Así que no hay un único modelo que sirva para todos, sino dos:

| | Para quién | Fricción | Quién necesita Premium |
| --- | --- | --- | --- |
| **Client ID horneado** | Las 5 plazas de tu app | Abrir y pulsar Conectar | Solo el dueño de la app |
| **Client ID propio** | Del sexto en adelante, sin límite | ~3 min en el dashboard, una vez | Cada usuario el suyo |

`scripts/bundle-client-id.js` hornea `SPOTIFY_CLIENT_ID` (del entorno o del `.env`) en `electron/bundled-client-id.js`, que entra en el asar. Se ejecuta solo con `npm run build`. Sin esa variable el build sigue siendo válido: arranca directamente en el asistente.

Cuando la Web API responde 403 con el ID horneado, eso significa que la cuenta no está en las 5 plazas. No es un error transitorio, así que la app deja de reintentar y muestra el asistente para que el usuario cree la suya. El Client ID que el usuario pegue **siempre gana** sobre el horneado y sobre el del `.env`.

Como Kuidy usa PKCE, el Client ID no es un secreto. **Nunca** pongas un client secret en el `.env`: la app no lo usa.

## Setup (primera vez)

### 1. Instala Node.js

Necesitas Node 20 o superior. Si no lo tienes: <https://nodejs.org>.

### 2. Instala dependencias

Desde una terminal en la carpeta del proyecto:

```bash
npm install
```

### 3. Crea una app en Spotify Developer (una sola vez)

1. Entra en <https://developer.spotify.com/dashboard> con tu cuenta de Spotify (tiene que ser **Premium**: la Web API no responde a apps en Development Mode con cuentas gratuitas).
2. **Create app** → nombre `Kuidy Lyrics`, descripción cualquiera.
3. En **Redirect URIs** añade exactamente:

   ```
   http://127.0.0.1:8888/callback
   ```

   Carácter por carácter: `127.0.0.1` (no `localhost`), `http` (no `https`), sin barra final.
4. Marca **Web API**, acepta los términos y guarda.
5. Copia el **Client ID** que te aparece en *Settings*.
6. En *Settings → User Management*, añade tu email de Spotify como *usuario autorizado*. Si te lo saltas, Spotify responde `403`.

### 4. Arranca

```bash
npm run dev
```

Pega el Client ID cuando la app te lo pida, click en "Conectar Spotify", autorizas en el navegador y listo. Queda guardado en `%APPDATA%\kuidy-lyrics` y no vuelve a preguntar.

### 5. Opcional: `.env` para no repetir el paso anterior

Si trabajas sobre el código y no quieres volver a pegar el Client ID cada vez que reinicies la config, copia `.env.example` como `.env` en la raíz del proyecto:

```env
SPOTIFY_CLIENT_ID=pega_aqui_tu_client_id
```

Solo se lee en desarrollo, desde la raíz del proyecto. El instalador **no** lo empaqueta.

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

El instalador queda en `release/`, como `Kuidy Lyrics-<versión>-x64.exe`. Es un NSIS por usuario (no pide administrador, deja elegir carpeta) y al desinstalar **borra también `%APPDATA%\kuidy-lyrics`**: en una beta, "desinstala y reinstala" tiene que resetearlo todo de verdad, token de Spotify incluido.

El instalador **no** está firmado, así que SmartScreen avisará al ejecutarlo. Está explicado para los testers en [BETA.md](BETA.md).

## Limitaciones conocidas

- **Solo Windows.** No hay build de macOS ni de Linux.
- **Hace falta Spotify Premium**: la Web API no devuelve la reproducción a apps en Development Mode con cuentas gratuitas.
- **Solo 5 cuentas por app de Spotify.** A partir de ahí, cada usuario tiene que crear su propia app y pegar su Client ID (ver arriba). Es una consecuencia de las reglas de Spotify, no una decisión de diseño.
- **La UI está solo en español.** No hay i18n todavía.
- **El overlay no es accesible por teclado ni con lector de pantalla**: es una ventana que nunca toma el foco, que es justamente lo que le permite quedarse encima sin estorbar. Todo lo demás se controla desde el popover de la bandeja y con los atajos globales.
- **Fullscreen exclusivo** (DirectX antiguo) puede tapar el overlay; con *borderless* funciona bien.
- **Las letras vienen de [lrclib.net](https://lrclib.net)**: no están todas, y algunas solo existen sin sincronizar (se muestran como texto plano).
- **La traducción es opt-in** y usa un endpoint no oficial de Google (`google-translate-api-x`): puede fallar sin aviso. Mientras no se active, ni una línea de la letra sale del equipo. El romaji es 100% offline.

## Notas

- La config vive en `%APPDATA%\kuidy-lyrics\kuidy-config.json` y los tokens en `kuidy-tokens.json`, **cifrados con DPAPI** (safeStorage). Si safeStorage no está disponible, los tokens **no se guardan** en vez de quedarse en claro. Borra esos archivos si quieres reiniciar la config.
- Los logs del proceso main están en `%APPDATA%\kuidy-lyrics\logs\main.log` (bandeja → *Abrir carpeta de logs*). Tokens y Client IDs salen redactados, así que se pueden adjuntar a un issue sin repasarlos.
- La cuenta que autorizas en Kuidy debe ser **la misma** en la que suena la música; si el overlay dice "no se está reproduciendo nada" con música sonando, revisa con qué cuenta está logueado tu reproductor.
- Si Spotify devuelve **403**, asegúrate de haber añadido tu email en *Settings → User Management* en el dashboard.

## Licencia

Kuidy Lyrics es MIT — ver [LICENSE](LICENSE). Las licencias y atribuciones de las dependencias, de las letras de LRCLIB y el aviso sobre Spotify están en [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Kuidy Lyrics no está afiliada ni respaldada por Spotify AB.
