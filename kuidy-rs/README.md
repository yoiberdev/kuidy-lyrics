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
cargo run                        # y ya: sigue lo que este sonando
cargo run -- --demo              # sin tocar el reproductor: cancion fija, letra de verdad
cargo run -- --demo "YOASOBI - Yoru ni Kakeru"   # la cancion que se pida (para ver el romaji)

cargo test                       # 60 tests, sin tocar la red
cargo test -- --ignored --nocapture   # ademas, 4 peticiones de verdad a lrclib y a Google
```

Ctrl+Alt+H muestra u oculta las letras; Ctrl+Alt+J abre los ajustes. El icono
de la bandeja hace lo mismo, y ahi esta tambien Salir.

## Compilar

**chaika no esta en crates.io.** Es una dependencia por ruta, y la ruta es
fija: `../../chaika/crates/chaika`. O sea que clonar solo este repo no basta
para compilar el port -- `cargo build` falla antes de empezar si al lado no
esta el otro repo. Los dos tienen que quedar como hermanos:

```text
un-directorio-cualquiera/
  kuidy-lyrics/      <- este repo
    kuidy-rs/
  chaika/            <- github.com/yoiberdev/chaika
    crates/chaika/
```

```sh
git clone https://github.com/yoiberdev/kuidy-lyrics.git
git clone https://github.com/yoiberdev/chaika.git
cd kuidy-lyrics/kuidy-rs
cargo run
```

Hace falta Rust 1.85 o mas nuevo, porque el crate es edicion 2024. Ahora
mismo **chaika es un repo privado**, asi que hasta que se abra el port solo
lo compila quien tenga acceso; el `.exe` de las releases existe justamente
para que probarlo no dependa de eso.

### El `.exe` que se publica

```sh
cargo build --release          # queda en target/release/kuidy.exe, 20 MB
```

El perfil de release lleva `lto = "fat"`, `codegen-units = 1` y `strip`, asi
que tarda bastante mas que un build normal. Dos cosas pasan solo aqui y no en
`cargo run`:

- `windows_subsystem = "windows"`, que es lo que evita la ventana negra de
  consola detras de la app. En desarrollo no se pone a proposito: la consola
  es justo donde uno quiere los logs.
- Los iconos incrustados en el PE, que `build.rs` rasteriza desde los SVG con
  `resvg` y `winresource` mete dentro (ver [La mascota](#la-mascota)).

Como en release no hay consola, **la unica traza es el log a disco**. Si algo
va mal en el binario publicado y no en `cargo run`, el archivo de log es el
sitio donde mirar.

## Que hace falta

**Windows 10 version 1809 (10.0.17763) o posterior**, que es cuando aparecio
`Windows.Media.Control`, de donde kuidy saca lo que suena. Probado solo en
Windows 11; en 10 deberia ir, pero nadie lo ha comprobado.

No hay version de Linux ni de macOS. La parte de kuidy que ata a un sistema
es **un solo archivo**, `media.rs`: en Linux lo equivalente es MPRIS
(`org.mpris.MediaPlayer2`) sobre D-Bus, que Spotify implementa y que da los
mismos datos, asi que seria escribir ese `leer()` y devolver la misma
`Foto`. En macOS no hay API publica para esto y habria que volver a la API
de Spotify, con la cuenta de desarrollador que eso arrastra.

El resto del programa no sabe en que sistema esta. Lo que si esta sin probar
fuera de Windows es [chaika](https://github.com/yoiberdev/chaika), que lleva
los `cfg` de las otras plataformas pero nadie ha compilado alli.

## De donde sale lo que suena

De **Windows**, no de Spotify. El sistema lleva un registro de lo que
reproduce cada programa -- es lo que alimenta el panel de medios y los
botones de reproduccion del teclado -- y ahi esta todo lo que una letra
necesita: titulo, artista, album, duracion, posicion y si suena o no.

Eso quita de en medio la cuenta de desarrollador, el Client ID, el OAuth,
la cuota y el limite de cinco usuarios que Spotify impone a las apps en
Development Mode. **No hay nada que conectar**: se abre y funciona. Y de
propina sirve para cualquier reproductor, no solo para Spotify; si hay
varios sonando, gana Spotify.

El detalle que hay que entender para tocar `media.rs`: la posicion no es un
cronometro. Windows publica una foto (`Position`) con la hora a la que se
tomo (`LastUpdatedTime`), y Spotify solo la refresca cada dos segundos
largos. La posicion de verdad es la foto mas lo que ha pasado desde esa
hora. Medido contra el reloj, esa cuenta no se desvia ni un milisegundo, y
un salto dentro de la cancion se refleja en unos 130 ms.

## Por donde va

| Pieza | Estado |
|---|---|
| Overlay: ventana sin marco, letra siguiendo a la cancion | hecho |
| lrclib: buscar la letra, elegir candidato, leer LRC | hecho |
| Que suena y por donde va, leido de Windows | hecho |
| Ajustes que se guardan, popover, bandeja y atajos | hecho |
| Traduccion de las lineas (Google, no oficial), con permiso | hecho |
| Log a disco | hecho |
| Romaji para japones, sin internet | hecho |
| Mascota propia, y de ahi el icono de bandeja, ventana y .exe | hecho |

**Nada de esto sale de la maquina sin permiso.** Traducir y romanizar
manda el texto de la letra a un servicio de fuera, asi que de serie esta
apagado: la primera vez que hace falta se pregunta una sola vez, y lo que se
conteste se guarda en `translationAllowed`. Quien ya usaba kuidy conserva su
ajuste de visualizacion, pero se le pregunta igual, porque nunca dio permiso
explicito.

Ojo con no confundir los dos interruptores, que antes eran uno y hacian un
lio: `showSubs` decide si se **ensena** la linea de abajo, y
`translationAllowed` decide si se **manda** la letra fuera para traducirla.

## El romaji

En japones se ensena la lectura y no la traduccion: la letra se canta, y sin
romaji no hay por donde entrarle.

**Se hace aqui, sin internet.** No pasa por Google, no pide permiso y
funciona sin conexion. Cuesta 6,3 MB de diccionario dentro del binario, que
se paga en disco y **nada en memoria hasta que suena algo en japones**: quien
no escuche japones no lo carga nunca.

Lo que hizo viable meterlo, despues de descartarlo dos veces por tamano, no
fue encontrar un diccionario mas pequeno: fue darse cuenta de que el
diccionario se recorta **por columnas y no por palabras**. IPADIC trae trece
campos por entrada y para leer hacen falta tres -- categoria, subcategoria y
lectura -- asi que tirando los otros nueve baja de 7,7 a 5,7 MB sin quitar ni
una palabra. El recorte lo hace `tools/recortar-ipadic.py`.

Y se eligio IPADIC y no UniDic por un detalle que solo se ve probandolo:
IPADIC guarda la lectura (読み) y la pronunciacion (発音) por separado, asi
que se puede leer は como "wa" en las particulas y 今日 como "kyou". El
UniDic recortado, que por tamano tambien entraba, solo conserva la
pronunciacion y da "kyoo" y "jinsee".

Comparado con lo que habia: el kuidy de Electron cargaba kuroshiro con 17 MB
de diccionario; kakasi cabia en 1,7 MB pero leia mal (君の名は le salia "kun
no mei ha"); y lindera da las mismas lecturas que esto pero se lleva el
binario a 45 MB porque embebe sin comprimir.

Lo que no cubre: IPADIC no acierta con algunos numerales irregulares, asi que
`romaji.rs` lleva una lista corta y a mano (一人, 二人, 大人). Es corta a
proposito: una tabla larga seria un diccionario paralelo mal hecho.

## Los modulos## Los modulos

`src/` se parte por responsabilidad, no por capas. La linea que separa todo
es la misma: **lo que toca la red bloquea y va en otro hilo, y lo que vuelve
son senales que la interfaz lee**. El overlay no sabe de donde sale la letra.

| Modulo | De que responde |
|---|---|
| `main.rs` | Arranque, ventanas, bandeja y atajos |
| `overlay.rs` | La ventana sin marco: la linea que suena en grande, las de alrededor apagandose, y la lista moviendose sola |
| `settings.rs` | El popover de ajustes, en ventana aparte para que el overlay pueda seguir siendo diminuto y dejar pasar los clics |
| `prefs.rs` | Lo que el usuario deja puesto. Cada ajuste es una senal y se guarda solo, con un respiro para no escribir el disco en cada valor del deslizador |
| `media.rs` | Preguntarle a Windows que suena, y convertir su foto de la posicion en un reloj. El ritmo baja cuando no mira nadie |
| `fetch.rs` | El unico sitio donde se juntan las dos mitades: entra la cancion, sale la letra, y la interfaz no se para |
| `lyrics.rs` | La letra y por que linea va. No habla con nadie: son datos y una busqueda |
| `lrclib.rs` | lrclib.net: los dos endpoints y el orden en que se prueban |
| `lrc.rs` | El formato LRC, con sus marcas de tiempo y los estribillos repetidos |
| `translate.rs` | El endpoint no oficial de Google, de donde sale la traduccion. Solo se llama con permiso |
| `romaji.rs` | La lectura del japones, aqui mismo: diccionario IPADIC recortado, cargado solo si hace falta |
| `playback.rs` | Que suena y por donde va. El reloj de mentira que avanza solo es lo que hace posible el `--demo` |
| `store.rs` | Donde viven los ajustes: la carpeta del usuario, nunca junto al binario |
| `log_file.rs` | El log a disco. Sigue tapando lo que parezca un secreto, por si alguna vez vuelve a haberlos |

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
