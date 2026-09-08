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
cargo run -- --login             # la primera vez: abre el navegador y conecta la cuenta
cargo run                        # despues: usa la sesion guardada
cargo run -- --demo              # sin cuenta: cancion fija, letra y traduccion de verdad

Ctrl+Alt+H muestra u oculta las letras; Ctrl+Alt+J abre los ajustes. El icono
de la bandeja hace lo mismo, y ahi esta tambien Salir.
cargo test                       # 37 tests
cargo test -- --ignored --nocapture   # ademas, una peticion real a lrclib
```

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
| Icono propio (hoy es un vinilo dibujado a mano) | pendiente |

En japones se ensena la lectura y no la traduccion: la letra se canta, y sin
romaji no hay por donde entrarle. Sale del mismo endpoint de Google que ya se
usa para traducir (`dt=rm`), asi que **no cuesta ni un byte de binario**. El
kuidy de Electron lo sacaba de kuroshiro con un diccionario de 17 MB, y las
alternativas en Rust piden entre 1,7 y 50 MB para un binario que pesa 11.

El trato: Google acierta las lecturas pero a veces pega las palabras
(`Kiminonaha` donde tocaria `kimi no na wa`) y se equivoca con los kanji
sueltos (`日` lo lee `Ni~Tsu` en vez de `hi`). Para cantar encima sirve; para
estudiar japones, no. La otra cara es que necesita red: sin conexion no hay
romaji, igual que no hay letra.
