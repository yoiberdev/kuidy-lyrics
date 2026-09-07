# Kuidy Lyrics — Guía de la beta

**Versión: 0.9.0-beta.1**

Kuidy Lyrics es una ventana flotante que se queda siempre encima de lo demás y va mostrando, línea a línea, la letra de la canción que estás escuchando en Spotify. Para canciones en japonés escribe además la lectura en romaji debajo de cada frase, y para el resto puede mostrar la traducción al español.

Esto es una beta. Funciona, pero espera fallos: por eso está el apartado [Cómo reportar un fallo](#cómo-reportar-un-fallo).

---

## 1. Qué necesitas

- **Windows 10 o Windows 11.** No hay versión de macOS ni de Linux.
- **Una cuenta de Spotify Premium.** No es un capricho nuestro: la Web API de Spotify no responde a las apps en *Development Mode* si la cuenta no es Premium. Con cuenta gratuita la app se conectará pero nunca verá qué está sonando.
- **Unos 5 minutos** para crear tu propia app en el dashboard de Spotify (paso 3). Solo se hace una vez.

---

## 2. Instalación

1. Descarga `Kuidy-Lyrics-0.9.0-beta.1-x64.exe`.
2. Ejecútalo. **Windows va a mostrar una pantalla azul que dice "Windows protegió su PC"**. Es lo normal, no es un virus.
3. Pulsa **Más información** y luego el botón **Ejecutar de todas formas**.
4. Sigue el instalador. Puedes cambiar la carpeta de instalación si quieres. Se instala solo para tu usuario, no pide permisos de administrador.

### Por qué sale ese aviso

El instalador no está **firmado digitalmente**. Un certificado de firma de código cuesta varios cientos de euros al año y no tiene sentido pagarlo por una beta que van a probar unas cuantas personas. SmartScreen avisa de cualquier ejecutable que no reconoce, no de que haya detectado nada malo. Si prefieres no fiarte, el código está publicado en <https://github.com/yoiberdev/kuidy-lyrics> y puedes compilarlo tú.

---

## 3. Configuración: tu propio Client ID de Spotify

La primera vez, Kuidy te pedirá un **Client ID**. Tienes que crear tu propia app en el dashboard de Spotify y pegarlo.

### Por qué tienes que hacer esto tú

Sería mucho más cómodo que la app trajera unas credenciales ya puestas, pero no es posible:

- Spotify permite **un máximo de 5 cuentas de usuario** en una app que esté en *Development Mode*.
- El modo ampliado (*Extended Quota Mode*), que quitaría ese límite, **solo se concede a organizaciones con entidad legal y 250.000 usuarios activos mensuales**, y desde mayo de 2025 Spotify ya no acepta solicitudes de proyectos individuales.

Es decir: cualquier instalador que repartiéramos con un Client ID nuestro dejaría de funcionar en cuanto lo probara la sexta persona. Con tu propio Client ID, tu app es tuya y no compites con nadie por esas 5 plazas.

### Pasos

1. Entra en <https://developer.spotify.com/dashboard> y accede con tu cuenta de Spotify.
2. Pulsa **Create app**.
3. Rellena:
   - **App name**: `Kuidy Lyrics` (o lo que quieras).
   - **App description**: cualquier cosa, por ejemplo `Overlay de letras`.
   - **Redirect URI**: escribe **exactamente** esto y pulsa **Add**:

     ```
     http://127.0.0.1:8888/callback
     ```

     Tiene que ser idéntico: `127.0.0.1`, no `localhost`; `http`, no `https`; y sin barra al final. Si no coincide carácter por carácter, Spotify rechazará el inicio de sesión.
   - En **Which API/SDKs are you planning to use?** marca **Web API**.
4. Acepta los términos y pulsa **Create app**.
5. Entra en la app recién creada y ve a **Settings**. Ahí verás el **Client ID**: una cadena larga de 32 letras y números. Cópiala. (El **Client Secret** NO hace falta; Kuidy usa PKCE y nunca te lo va a pedir.)
6. Ve a **Settings → User Management** y añade **tu propio nombre y el email de tu cuenta de Spotify** a la lista de usuarios. Este paso es obligatorio: si te lo saltas, Spotify responderá `403` y Kuidy te dirá que tu cuenta no está autorizada.
7. Abre Kuidy Lyrics, pega el Client ID donde te lo pide y conecta. Se abrirá el navegador para que autorices; después puedes cerrar esa pestaña.

> **Importante**: la cuenta con la que autorizas en Kuidy tiene que ser **la misma** en la que está sonando la música. Si el overlay dice que no suena nada mientras tú escuchas algo, comprueba con qué cuenta está logueado tu reproductor de Spotify.

---

## 4. Cómo se usa

- **Atajos globales** (funcionan aunque Kuidy no tenga el foco, incluso dentro de un juego):
  - `Ctrl + Alt + H` — oculta o muestra la ventana de letras.
  - `Ctrl + Alt + M` — modo flotante puro: se queda solo el texto y los clicks lo atraviesan, como si no estuviera. Útil mientras juegas o trabajas.
- **Icono de la bandeja** (junto al reloj, abajo a la derecha; puede estar escondido bajo la flechita `^`):
  - **Click izquierdo**: abre el panel con las opciones — mostrar/ocultar el overlay, modo flotante, sub-líneas (romaji/traducción), iniciar con Windows, tamaño de letra, opacidad, la guía de atajos y la sesión de Spotify.
  - **Click derecho**: menú rápido, con la versión, la carpeta de logs y salir.
- **Mover la ventana**: arrástrala desde la barra de arriba.
- **Cambiar el tamaño**: arrastra desde cualquier borde o esquina.
- La primera vez se abre sola una guía con los atajos. Puedes volver a abrirla desde el panel de la bandeja.

---

## 5. Cómo reportar un fallo

Un "no me funciona" no se puede arreglar. Con esto sí:

1. Click **derecho** en el icono de la bandeja → **Abrir carpeta de logs**. Se abrirá el explorador en `%APPDATA%\kuidy-lyrics\logs`.
2. Adjunta el archivo **`main.log`**. Los tokens y los Client ID salen tachados en el log, así que puedes mandarlo sin miedo.
3. Cuenta, aunque sea en dos líneas:
   - **Qué versión** tienes (sale en el menú de la bandeja y en la guía de atajos).
   - **Qué estaba sonando**: canción y artista. Muchos fallos solo pasan con una canción concreta.
   - **Qué esperabas que pasara y qué pasó**.
   - Si salió algún aviso en la ventana de letras, cópialo tal cual.

Abre un issue en <https://github.com/yoiberdev/kuidy-lyrics/issues> o mándalo por donde recibiste la beta.

---

## 6. Limitaciones conocidas

Nada de esto es un fallo que vayas a reportar: ya lo sabemos.

- **Solo Windows.** No hay build de macOS ni de Linux.
- **Hace falta Spotify Premium.** Con cuenta gratuita la Web API no devuelve la reproducción.
- **Tienes que crear tú la app de Spotify** y pegar tu Client ID (ver el apartado 3). No hay forma de evitarlo con las reglas actuales de Spotify.
- **La interfaz está solo en español.** No hay traducción de la propia app todavía.
- **La ventana de letras no se puede manejar con el teclado ni con un lector de pantalla.** Es una ventana que nunca coge el foco (eso es lo que le permite quedarse encima sin molestar), y el precio es que es inaccesible por teclado. Todo lo importante se puede hacer desde el panel de la bandeja y con los atajos globales.
- **Los juegos en pantalla completa exclusiva pueden tapar el overlay.** Con *borderless fullscreen* (lo que usa casi todo lo moderno) funciona bien; con fullscreen exclusivo de DirectX antiguo, no hay nada que hacer.
- **Las letras vienen de [lrclib.net](https://lrclib.net)**, una base de datos colaborativa y gratuita. No están todas, y algunas están sin sincronizar (se ven como texto plano en vez de resaltarse línea a línea). Si falta una canción, se puede contribuir en lrclib.
- **La traducción es opcional y hay que activarla a mano.** Usa un endpoint no oficial de Google, así que puede fallar o dejar de funcionar sin aviso. Mientras no la actives, ni una línea de la letra sale de tu ordenador. El romaji del japonés sí es completamente offline.
- **El overlay se queda quieto donde lo dejaste**, incluso si cambias de resolución o desconectas un monitor. Si "desaparece", arrástralo de vuelta o reinicia la app.

---

## 7. Desinstalar

**Configuración → Aplicaciones → Aplicaciones instaladas → Kuidy Lyrics → Desinstalar** (o desde el menú Inicio).

El desinstalador borra el programa **y también** todos tus datos locales: la carpeta `%APPDATA%\kuidy-lyrics`, que contiene la configuración, tu Client ID, los logs y el token de sesión de Spotify. Es deliberado: en una beta, "desinstala y vuelve a instalar" tiene que dejarlo todo como el primer día.

Lo que **no** borra, porque no es nuestro:

- La app que creaste en el dashboard de Spotify. Puedes borrarla tú desde <https://developer.spotify.com/dashboard>.
- El permiso que le diste a esa app sobre tu cuenta. Se revoca en <https://www.spotify.com/account/apps/>.

---

Kuidy Lyrics no está afiliada ni respaldada por Spotify AB. Licencias de terceros en [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
