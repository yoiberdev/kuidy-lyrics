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
cargo run -- --demo "YOASOBI - Yoru ni Kakeru"   # la cancion que se pida (para ver el romaji)

cargo test                       # 59 tests, sin tocar la red
cargo test -- --ignored --nocapture   # ademas, 4 peticiones de verdad a lrclib y a Google
```

Ctrl+Alt+H muestra u oculta las letras; Ctrl+Alt+J abre los ajustes. El icono
de la bandeja hace lo mismo, y ahi esta tambien Salir.

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

Vive en `assets/kuidy.svg`, dibujada a mano: una corchea con cara. La
silueta es la nota entera, plica y corchete incluidos, porque en la bandeja
se ve a 16 pixeles y a ese tamano la cara ya no se distingue: lo unico que
queda para decir "esto va de musica" es el contorno.

Hay **dos** dibujos. `kuidy-16.svg` es el mismo bicho sin degradado, sin
brillo y sin mofletes, con los ojos y la nota mas gordos. No es pereza: a 16
pixeles cada rasgo mide pixel y medio, y el degradado se convierte en barro.
Reducir el dibujo grande da una mancha; dibujar aparte da un icono.

`build.rs` los rasteriza con `resvg` y saca:

| Sale | De | Donde se ve |
|---|---|---|
| `bandeja.rgba` 16px | el simplificado | la bandeja del sistema |
| `ventana.rgba` 64px | el completo | barra de titulo, barra de tareas, Alt+Tab |
| `kuidy.ico` 16/32/48/256 | los dos | el `.exe` en el explorador |

`resvg` es dependencia **de build**, asi que el binario no lleva ni un
lector de SVG: solo los pixeles ya cocinados, 37 KB en total. Y como se
rehace en cada compilacion, el icono no puede quedarse desfasado del
dibujo. El encuadre tambien es automatico -- se mide donde cae la tinta, no
el viewBox -- asi que retocar el SVG no obliga a recentrar nada.

Lo que no tiene arreglo desde aqui es que la barra de titulo y la barra de
tareas quieren 16 y 32 a la vez, y chaika solo acepta un tamano por
ventana: [chaika#8](https://github.com/yoiberdev/chaika/issues/8).
