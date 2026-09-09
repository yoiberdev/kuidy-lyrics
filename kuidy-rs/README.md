# kuidy (Rust)

kuidy-lyrics reescrito sobre [chaika](https://github.com/yoiberdev/chaika),
sin Electron.

Se construye por rebanadas, empezando por la que manda: el overlay de letras
que sigue a la cancion. Mientras dura, **lo que chaika haga mal se anota como
issue en su repo** (etiqueta `desde-kuidy`) y aqui se sigue adelante con el
apano que haga falta; el porque esta en `docs/hallazgos.md` de chaika.

Los apanos que dependan de un arreglo en chaika llevan un comentario
`// APANO(chaika#N):` para poder encontrarlos y quitarlos despues.

```sh
cargo run -- --login             # conecta la cuenta al arrancar (en el .exe: menu de la bandeja)
cargo run                        # despues: usa la sesion guardada
cargo run -- --demo              # sin cuenta: cancion fija, letra y traduccion de verdad
cargo run -- --demo "YOASOBI - Yoru ni Kakeru"   # la cancion que se pida (para ver el romaji)

cargo test                       # 59 tests, sin tocar la red
cargo test -- --ignored --nocapture   # ademas, 4 peticiones de verdad a lrclib y a Google
```

Ctrl+Alt+H muestra u oculta las letras; Ctrl+Alt+J abre los ajustes. El icono
de la bandeja hace lo mismo, y ahi esta tambien Salir.

## Conectar tu cuenta de Spotify

Kuidy trae un Client ID dentro, pero **solo sirve para cinco cuentas**:
Spotify limita a cinco los usuarios autorizados mientras una app esta en
Development Mode, y desde 2025 ya no concede el modo ampliado a proyectos de
una persona. Si no eres una de esas cinco, Spotify responde 403 y no hay nada
que el programa pueda hacer.

La solucion es poner el tuyo, que se saca gratis en dos minutos:

1. Entra en <https://developer.spotify.com/dashboard> y crea una app.
2. En *Redirect URIs* pon exactamente `http://127.0.0.1:8888/callback`.
3. Copia el Client ID.
4. Pegalo en `%APPDATA%\kuidy-rs\client-id.txt` (el archivo entero es el
   ID; las lineas que empiecen por `#` se ignoran).
5. Abre kuidy y pulsa **Conectar con Spotify...** en el menu de la bandeja.

En desarrollo es mas comodo la variable de entorno `SPOTIFY_CLIENT_ID`, que
tiene prioridad sobre el archivo.

No hace falta ningun client secret: kuidy usa PKCE y no lo pide. Si alguna
guia te pide uno, no es para esto.

El log va a `%APPDATA%\kuidy-rs\logs\main.log` y se abre desde el menu de la
bandeja. La sesion se guarda en `%APPDATA%\kuidy-rs\kuidy-tokens.json`, en su
propia carpeta: compartir el archivo con el kuidy de Electron seria pedir que los
dos refresquen a la vez y se pisen.

## Por donde va

| Pieza | Estado |
|---|---|
| Overlay: ventana sin marco, letra siguiendo a la cancion | hecho |
| lrclib: buscar la letra, elegir candidato, leer LRC | hecho |
| Spotify: cuenta (PKCE), que suena y por donde va | hecho |
| Ajustes que se guardan, popover, bandeja y atajos | hecho |
| Traduccion de las lineas (Google, no oficial) | hecho |
| Log a disco, con secretos tapados | hecho |
| Romaji para japones | hecho, sin diccionario |
| Mascota propia, y de ahi el icono de bandeja, ventana y .exe | hecho |

En japones se ensena la lectura y no la traduccion: la letra se canta, y sin
romaji no hay por donde entrarle. Sale del mismo endpoint de Google que ya se
usa para traducir (`dt=rm`), asi que **no cuesta ni un byte de binario**. El
kuidy de Electron lo sacaba de kuroshiro con un diccionario de 17 MB, y las
alternativas en Rust piden entre 1,7 y 50 MB para un binario que pesa 14.

El trato: Google acierta las lecturas pero a veces pega las palabras
(`Kiminonaha` donde tocaria `kimi no na wa`) y se equivoca con los kanji
sueltos (`日` lo lee `Ni~Tsu` en vez de `hi`). Para cantar encima sirve; para
estudiar japones, no. La otra cara es que necesita red: sin conexion no hay
romaji, igual que no hay letra.

## La mascota

Vive en `assets/kuidy.svg`, dibujada a mano: un peluche. Todo lo que se ve
es de tela -- la costura del medio, la panza cosida encima con su puntada
alrededor, los ojos de boton, la etiqueta que asoma por la cadera -- y en la
panza lleva bordada una corchea, que es lo unico que dice a que se dedica.

Hay **dos** dibujos, y no son el mismo a distinto tamano. `kuidy-16.svg`
es solo la cabeza. Con el cuerpo entero, a 16 pixeles le tocan ocho a la
cabeza, tres a las orejas y el resto a una mancha; recortando al busto,
esos mismos dieciseis pixeles se gastan en lo unico que se reconoce. Ahi
tampoco hay costuras, ni etiqueta, ni panza: a ese tamano cada rasgo mide
pixel y medio y todo eso se vuelve barro. Las orejas van redondas y casi
rectas, porque ladeadas salen en punta y parece un gato.

`build.rs` los rasteriza con `resvg` y saca:

| Sale | De | Donde se ve |
|---|---|---|
| `bandeja.rgba` 16px | la cabeza sola | la bandeja del sistema |
| `ventana.rgba` 64px | el completo | barra de titulo, barra de tareas, Alt+Tab |
| `kuidy.ico` 16/32/48/256 | los dos | el `.exe` en el explorador |

El `.ico` mezcla los dos: el de 16 sale de la cabeza y el resto del peluche
entero.

`resvg` es dependencia **de build**, asi que el binario no lleva ni un
lector de SVG: solo los pixeles ya cocinados, 37 KB en total. Y como se
rehace en cada compilacion, el icono no puede quedarse desfasado del
dibujo. El encuadre tambien es automatico -- se mide donde cae la tinta, no
el viewBox -- asi que retocar el SVG no obliga a recentrar nada.

Lo que no tiene arreglo desde aqui es que la barra de titulo y la barra de
tareas quieren 16 y 32 a la vez, y chaika solo acepta un tamano por
ventana: [chaika#8](https://github.com/yoiberdev/chaika/issues/8).
