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

La sesion se guarda en `%APPDATA%\kuidy-rs\kuidy-tokens.json`, en su propia
carpeta: compartir el archivo con el kuidy de Electron seria pedir que los
dos refresquen a la vez y se pisen.

## Por donde va

| Pieza | Estado |
|---|---|
| Overlay: ventana sin marco, letra siguiendo a la cancion | hecho |
| lrclib: buscar la letra, elegir candidato, leer LRC | hecho |
| Spotify: cuenta (PKCE), que suena y por donde va | hecho |
| Ajustes que se guardan, popover, bandeja y atajos | hecho |
| Traduccion de las lineas (Google, no oficial) | hecho |
| Romaji para japones | pendiente: el diccionario pesa 50 MB y el binario 11 |
