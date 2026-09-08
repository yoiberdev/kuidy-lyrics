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
cargo run                        # letra real de lrclib, reloj de mentira
cargo run -- --demo              # todo inventado, para verlo sin red
cargo test                       # incluye el parser de LRC y la eleccion de candidato
cargo test -- --ignored --nocapture   # ademas, una peticion real a lrclib
```

## Por donde va

| Pieza | Estado |
|---|---|
| Overlay: ventana sin marco, letra siguiendo a la cancion | hecho |
| lrclib: buscar la letra, elegir candidato, leer LRC | hecho |
| Spotify: cuenta, que suena y por donde va | pendiente |
| Popover de ajustes, bandeja, atajos | pendiente |
| Traduccion de subtitulos | pendiente |
