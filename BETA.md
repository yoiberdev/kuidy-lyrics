# Kuidy Lyrics — Guía de la beta

**Versión: 0.9.0-beta.1**

Kuidy Lyrics es una ventana flotante que se queda siempre encima de lo demás y va mostrando, línea a línea, la letra de la canción que estás escuchando en Spotify. Para canciones en japonés escribe además la lectura en romaji debajo de cada frase, y para el resto puede mostrar la traducción al español.

Esto es una beta. Funciona, pero espera fallos: por eso está el apartado [Cómo reportar un fallo](#cómo-reportar-un-fallo).

---

## 1. Qué necesitas

- **Windows 10 o Windows 11.** No hay versión de macOS ni de Linux.
- **Una cuenta de Spotify Premium.** No es un capricho nuestro: la Web API de Spotify no responde a las apps en *Development Mode* si la cuenta no es Premium. Con cuenta gratuita la app se conectará pero nunca verá qué está sonando.
- **Nada más.** La mayoría solo tiene que abrir la app y pulsar *Conectar*. Si te toca el caso raro del paso 3, son 3 minutos y se hace una sola vez.

---

## 2. Instalación

1. Descarga `Kuidy-Lyrics-0.9.0-beta.1-x64.exe`.
2. Ejecútalo. **Windows va a mostrar una pantalla azul que dice "Windows protegió su PC"**. Es lo normal, no es un virus.
3. Pulsa **Más información** y luego el botón **Ejecutar de todas formas**.
4. Sigue el instalador. Puedes cambiar la carpeta de instalación si quieres. Se instala solo para tu usuario, no pide permisos de administrador.

### Por qué sale ese aviso

El instalador no está **firmado digitalmente**. Un certificado de firma de código cuesta varios cientos de euros al año y no tiene sentido pagarlo por una beta que van a probar unas cuantas personas. SmartScreen avisa de cualquier ejecutable que no reconoce, no de que haya detectado nada malo. Si prefieres no fiarte, el código está publicado en <https://github.com/yoiberdev/kuidy-lyrics> y puedes compilarlo tú.

---

## 3. Conectar con Spotify

Abre Kuidy Lyrics y pulsa **Conectar Spotify**. Se abrirá el navegador para que autorices; después puedes cerrar esa pestaña. Eso es todo.

> **Importante**: la cuenta con la que autorizas tiene que ser **la misma** en la que está sonando la música. Si el overlay dice que no suena nada mientras tú escuchas algo, comprueba con qué cuenta está logueado tu reproductor de Spotify.

### Si te dice que tu cuenta no cabe en esta app

Puede pasar, y no es culpa tuya. Spotify permite **un máximo de 5 cuentas** por app en *Development Mode*, y el modo que quitaría ese límite solo se concede a organizaciones con entidad legal y 250.000 usuarios activos mensuales; desde mayo de 2025 ya no acepta solicitudes de proyectos individuales. Si las 5 plazas están ocupadas, Kuidy te lo dirá y te ofrecerá crear tu propia app, que es gratis y no compite con nadie.

**Antes de empezar**: al ser tú el dueño de esa app, Spotify te exigirá tener **Premium**. Con cuenta gratuita el trámite no sirve de nada, así que compruébalo primero.

Los pasos, que la propia app te va guiando:

1. Entra en <https://developer.spotify.com/dashboard> con tu cuenta de Spotify.
2. Pulsa **Create app**. El nombre y la descripción da igual cuáles sean.
3. En **Redirect URI** pega **exactamente** esto y pulsa **Add**:

   ```
   http://127.0.0.1:8888/callback
   ```

   Tiene que ser idéntico: `127.0.0.1`, no `localhost`; `http`, no `https`; y sin barra al final. Si no coincide carácter por carácter, Spotify rechazará el login sin explicar por qué.
4. En **Which API/SDKs are you planning to use?** marca **Web API**.
5. Acepta los términos y pulsa **Create app**.
6. Entra en **Settings** y copia el **Client ID**.
7. Pégalo en Kuidy (hay botón de *Pegar*) y pulsa **Guardar**.

Si después de esto Spotify sigue devolviendo un error de autorización, ve a **Settings → User Management** y añade tu nombre y el email **de tu cuenta de Spotify**. Ojo: si creaste la cuenta con Google o Facebook, tu email habitual puede no ser ese. El cambio tarda hasta 15 minutos en propagarse.

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
- **Solo caben 5 personas por app de Spotify.** Si las plazas de esta están ocupadas, tendrás que crear tu propia app (apartado 3) y entonces necesitarás Premium tú. No hay forma de evitarlo con las reglas actuales de Spotify.
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
