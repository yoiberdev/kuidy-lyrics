# Kuidy Lyrics

Overlay flotante de letras de Spotify para Windows. Ventana transparente, siempre al frente (incluso encima de juegos en *borderless fullscreen*), con UI minimalista y letras **sincronizadas** que se resaltan línea a línea con la canción.

## Cómo funciona

- **Detección de canción**: usa la Spotify Web API (`/me/player/currently-playing`) — devuelve la pista y el progreso en ms con exactitud.
- **Letras**: las saca de [lrclib.net](https://lrclib.net) (gratis, sin API key, con letras sincronizadas en formato LRC).
- **UI**: Electron + React + Tailwind + Framer Motion, con glassmorphism.

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

- **Arrastrar la ventana**: arrastra desde la barra superior.
- **Redimensionar**: arrastra los bordes.
- **Atajos globales** (funcionan incluso dentro de juegos):
  - `Ctrl + Alt + L` — alterna *click-through* (los clicks pasan a la ventana de debajo).
  - `Ctrl + Alt + H` — oculta/muestra la ventana.
- **Opacidad y opciones**: click en los tres puntos (`···`) arriba a la derecha.

## Empaquetar como `.exe` instalable

```bash
npm run build
```

El instalador queda en `release/`.

## Notas

- La app guarda tu Client ID y tokens en `%APPDATA%\Kuidy Lyrics\`. Bórralo si quieres reiniciar la config.
- Si Spotify devuelve **403** la primera vez, asegúrate de haber añadido tu email en *User Management* en el dashboard.
- Para juegos en **fullscreen exclusivo** (algunos DirectX antiguos) el overlay puede no aparecer encima — la mayoría de juegos modernos usan *borderless* y funciona perfectamente.
