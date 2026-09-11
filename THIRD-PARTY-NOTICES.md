# Avisos de terceros

Kuidy Lyrics se distribuye bajo la licencia MIT (ver [LICENSE](LICENSE)) e incluye o depende del software de terceros que se lista aquí.

Hay **dos programas distintos** que se descargan por separado, y cada uno lleva sus propias dependencias:

| Build | Qué es | Dónde se listan |
| --- | --- | --- |
| **Electron 0.9.0-beta.1** | La versión estable, la del instalador `.exe` | [Dependencias de Electron](#dependencias-de-electron) |
| **Rust 0.3.0** | El port sin navegador, en [`kuidy-rs/`](kuidy-rs/) | [El port en Rust](#el-port-en-rust) |

No comparten ni una sola dependencia: el port no lleva Electron, ni Node, ni npm. Y desde la 0.2.0 tampoco comparten los servicios: **el port ya no usa la API de Spotify** —le pregunta a Windows qué suena— y desde la 0.3.0 **el romaji lo calcula en la máquina**, con un diccionario que lleva dentro. Lo único que sigue consultando fuera es [LRCLIB](#letras-lrclib) y, solo con permiso explícito, [la traducción de Google](#traducción-endpoint-no-oficial-de-google).

## Dependencias de Electron

Las licencias se han comprobado leyendo el campo `license` del `package.json` de cada paquete instalado; las versiones son las que había en el árbol de dependencias al preparar la 0.9.0-beta.1.

| Paquete | Versión | Licencia | Origen |
| --- | --- | --- | --- |
| electron | 33.4.11 | MIT | <https://github.com/electron/electron> |
| react | 18.3.1 | MIT | <https://github.com/facebook/react> |
| react-dom | 18.3.1 | MIT | <https://github.com/facebook/react> |
| framer-motion | 11.18.2 | MIT | <https://github.com/motiondivision/motion> |
| tailwindcss | 3.4.19 | MIT | <https://github.com/tailwindlabs/tailwindcss> |
| kuroshiro | 1.2.0 | MIT | <https://github.com/hexenq/kuroshiro> |
| kuroshiro-analyzer-kuromoji | 1.1.0 | MIT | <https://github.com/hexenq/kuroshiro-analyzer-kuromoji> |
| kuromoji | 0.1.2 | Apache-2.0 | <https://github.com/takuyaa/kuromoji.js> |
| google-translate-api-x | 10.7.3 | MIT | <https://github.com/AidanWelch/google-translate-api> |
| dotenv | 17.4.2 | BSD-2-Clause | <https://github.com/motdotla/dotenv> |

Electron incluye a su vez Chromium y Node.js, con sus propias licencias (BSD-3-Clause y MIT respectivamente, más las de sus componentes). El detalle completo viaja dentro de la propia distribución de Electron, en `LICENSES.chromium.html` y `LICENSE`, dentro de la carpeta de instalación de Kuidy Lyrics.

## kuromoji — Apache License 2.0

> Esto es **solo de la versión de Electron**. El port en Rust no lleva kuromoji: desde la 0.3.0 usa otro diccionario, IPADIC, con su propia licencia y sus propias obligaciones — ver [Diccionario japonés IPADIC](#diccionario-japonés-ipadic).

`kuromoji` se distribuye bajo la Apache License 2.0, que obliga a reproducir sus avisos de copyright. Se reproducen aquí:

```
Copyright 2014 Takuya Asano
Copyright 2010-2014 Atilika Inc. and contributors
```

El texto completo de la licencia está en <https://www.apache.org/licenses/LICENSE-2.0> y en `node_modules/kuromoji/LICENSE-2.0.txt`.

### Diccionario mecab-ipadic

kuromoji (y por tanto `kuroshiro-analyzer-kuromoji`, que es lo que Kuidy usa para generar el romaji) incluye datos derivados de **mecab-ipadic-2.7.0-20070801**. Su aviso, reproducido tal y como exige:

```
Copyright 2000, 2001, 2002, 2003 Nara Institute of Science
and Technology.  All Rights Reserved.

Use, reproduction, and distribution of this software is permitted.
Any copy of this software, whether in its original form or modified,
must include both the above copyright notice and the following
paragraphs.

Nara Institute of Science and Technology (NAIST),
the copyright holders, disclaims all warranties with regard to this
software, including all implied warranties of merchantability and
fitness, in no event shall NAIST be liable for
any special, indirect or consequential damages or any damages
whatsoever resulting from loss of use, data or profits, whether in an
action of contract, negligence or other tortuous action, arising out
of or in connection with the use or performance of this software.
```

Buena parte de las entradas del diccionario proceden de *ICOT Free Software*, cuya cláusula de **NO WARRANTY** debe acompañar siempre a la distribución. El aviso íntegro, incluida esa cláusula, está en `node_modules/kuromoji/NOTICE.md` y en el repositorio de kuromoji.

## El port en Rust

El port se distribuye como **un solo `.exe`**: las dependencias van compiladas dentro, no en archivos aparte. No hay un `node_modules` que inspeccionar ni una carpeta de instalación con las licencias al lado, así que todo lo que viaja dentro del binario se lista aquí.

Son **273 crates** en la 0.3.0, todos con licencia permisiva y ninguno copyleft. El desglose sale del campo `license` de cada crate, sobre el árbol de dependencias reales de `x86_64-pc-windows-msvc` (sin las de build ni las de test):

| Licencia | Crates |
| --- | --- |
| MIT o Apache-2.0, a elegir | 175 |
| MIT | 30 |
| Unicode-3.0 | 22 |
| Zlib entre las opciones | 9 |
| MIT o Unlicense | 8 |
| Apache-2.0 | 5 |
| Zlib | 4 |
| ISC | 3 |
| MPL-2.0 o MIT o Apache-2.0 | 3 |
| BSL-1.0 (Boost) | 2 |
| BSD-3-Clause | 2 |
| BSD-3-Clause o Apache-2.0 | 2 |
| BSD-2-Clause o Apache-2.0 o MIT | 2 |
| 0BSD o MIT o Apache-2.0 | 1 |
| (MIT o Apache-2.0) **y** Unicode-3.0 | 1 |
| Apache-2.0 **y** ISC | 1 |
| Apache-2.0 **y** MIT | 1 |
| Apache-2.0 o ISC o MIT | 1 |
| CDLA-Permissive-2.0 | 1 |

Las que sostienen lo que kuidy tiene de propio:

| Crate | Versión | Licencia | Para qué |
| --- | --- | --- | --- |
| vibrato | 0.5.2 | MIT o Apache-2.0 | Partir el japonés en palabras, para el romaji |
| wana_kana | 4.0.0 | MIT | Pasar los kana a alfabeto latino |
| ruzstd | 0.7.3 | MIT | Descomprimir el diccionario |
| windows | 0.62.2 | MIT o Apache-2.0 | Preguntarle al sistema qué suena |
| windows-future | 0.3.2 | MIT o Apache-2.0 | Esperar a las llamadas asíncronas de Windows |

## Diccionario japonés IPADIC

> Esto es **solo del port en Rust**, desde la 0.3.0.

El port lleva dentro del `.exe` una versión recortada del diccionario **IPADIC**, que es lo que le permite leer el japonés en romaji sin conexión. El recorte quita nueve de los trece campos de cada entrada —los que no hacen falta para leer— pero **no quita ni una palabra**; el script está en [`kuidy-rs/tools/recortar-ipadic.py`](kuidy-rs/tools/recortar-ipadic.py).

Su licencia **obliga a que el aviso de copyright acompañe a cualquier copia del programa**, y la cláusula de ICOT Free Software que arrastra exige además que la sección *NO WARRANTY* aparezca siempre junto a lo que se distribuye. Como kuidy se reparte como un `.exe` suelto, sin instalador ni carpeta al lado, el texto **va empotrado en el propio ejecutable**: se abre desde el menú de la bandeja, en *Avisos de terceros*.

El texto íntegro está también en el repositorio:

- [`kuidy-rs/assets/ipadic-COPYING.txt`](kuidy-rs/assets/ipadic-COPYING.txt) — la licencia
- [`kuidy-rs/assets/ipadic-NOTICE.txt`](kuidy-rs/assets/ipadic-NOTICE.txt) — de dónde salen los datos

Los titulares:

```
Copyright 2000, 2001, 2002, 2003 Nara Institute of Science
and Technology.
Copyright 2023, LegalOn Technologies, Inc.
All Rights Reserved.
```

Los identificadores de conexión están remapeados con datos CORE del [BCCWJ](https://clrd.ninjal.ac.jp/bccwj/), del NINJAL, como dice el `NOTICE`.

Para rehacer la lista, desde `kuidy-rs/`:

```sh
cargo tree -e normal --target x86_64-pc-windows-msvc
```

El texto íntegro de cada licencia viaja en el propio crate, en el archivo `LICENSE` de su directorio dentro de `~/.cargo/registry/src/`, y en el repositorio de cada proyecto.

### chaika

El port está construido sobre **[chaika](https://github.com/yoiberdev/chaika)** (`chaika`, `chaika-anim`, `chaika-elements`, `chaika-geom`, `chaika-layout`, `chaika-platform`, `chaika-reactive`, `chaika-render`, `chaika-text`), que es del mismo autor que Kuidy Lyrics y también es MIT. No es una dependencia de terceros, pero sí un proyecto aparte con su propio repositorio y su propio ciclo de vida, y se cita aquí para que quede claro de dónde sale la mitad del binario.

### Unicode License V3

Veintidós crates de **[ICU4X](https://github.com/unicode-org/icu4x)** (`icu_collections`, `icu_locale`, `icu_normalizer`, `icu_properties`, `icu_segmenter`, sus crates de datos y el andamiaje `yoke`/`zerovec`/`zerotrie`/`writeable`/`tinystr`/`litemap`) están bajo la Unicode License V3, que exige que el aviso de copyright y de permiso acompañe a toda copia. El aviso:

```
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 2020-2024 Unicode, Inc.
```

El texto completo está en <https://www.unicode.org/license.txt> y en el archivo `LICENSE` de cada uno de esos crates.

Son los que parten el texto en grafemas y saben dónde puede cortarse una línea. Sin ellos el overlay no sabría dónde termina un carácter japonés ni cómo romper un verso largo.

### Otras que piden mención

- **`webpki-roots` 1.0.9** (CDLA-Permissive-2.0) incluye la lista de autoridades de certificación de Mozilla. Es lo que permite verificar el TLS de Spotify, lrclib y Google sin depender del almacén de certificados de Windows.
- **`ring` 0.17.14** (`Apache-2.0 AND ISC`) es la criptografía que hay debajo de ese TLS, y es el caso más enredado del árbol: el código nuevo es ISC, el que viene de **BoringSSL** es Apache-2.0 (con algunos archivos ISC, indicado archivo por archivo), y el polyfill de `once_cell` es Apache-2.0 o MIT. Los textos van en el propio crate, en `LICENSE`, `LICENSE-other-bits` y `LICENSE-BoringSSL`.
- **`libloading`, `rustls-webpki` y `untrusted`** son ISC a secas. **`rustls`** ofrece a elegir entre Apache-2.0, ISC y MIT.
- **`clipboard-win` y `error-code`** (BSL-1.0, Boost) son lo que deja copiar texto. La licencia de Boost no exige reproducir el aviso cuando lo que se distribuye es solo el binario compilado, pero se cita igual.

### Tipografías e iconos

El port **no empaqueta ninguna tipografía**: pide al sistema las que ya tiene Windows, igual que la versión de Electron.

Los iconos salen de `kuidy-rs/assets/kuidy.svg` y `kuidy-16.svg`, dibujados a mano para el proyecto y cubiertos por la licencia MIT del repositorio. Se rasterizan durante la compilación y se incrustan en el `.exe` con cuatro crates que son dependencias **de build**, no del programa:

| Crate | Versión | Licencia |
| --- | --- | --- |
| `resvg` | 0.48.1 | Apache-2.0 o MIT |
| `usvg` | 0.48.1 | Apache-2.0 o MIT |
| `tiny-skia` | 0.12.0 | BSD-3-Clause |
| `winresource` | 0.1.31 | MIT |

Que sean de build significa que el binario final **no lleva ni un lector de SVG**: solo los píxeles ya calculados, 37 KB en total.

## Letras: LRCLIB

Las letras las proporciona **[LRCLIB](https://lrclib.net)**, una base de datos abierta y colaborativa de letras sincronizadas, accesible sin clave de API. Kuidy Lyrics no aloja ni redistribuye letras: las consulta en el momento contra `lrclib.net`. Gracias a quienes mantienen y alimentan ese proyecto — sin él esta app no existiría.

Los derechos de las letras pertenecen a sus autores y editoriales; LRCLIB y Kuidy Lyrics solo actúan como consulta.

## Traducción: endpoint no oficial de Google

La función **opcional** de traducción usa `google-translate-api-x`, que habla con un endpoint **no oficial y no documentado** de Google Translate. No es una API pública con contrato: puede cambiar, limitar peticiones o dejar de responder en cualquier momento, y no hay ningún acuerdo entre Kuidy Lyrics y Google.

Por eso la traducción es **opt-in**: está desactivada hasta que el usuario la activa explícitamente. Mientras no la active, ni una línea de la letra sale del equipo. El romaji del japonés no está afectado, porque se genera offline con kuroshiro/kuromoji.

## Spotify

**Kuidy Lyrics no está afiliada, asociada, autorizada ni respaldada por Spotify AB**, ni por ninguna de sus filiales. *Spotify* y el logotipo de Spotify son marcas registradas de Spotify AB.

Kuidy Lyrics es un cliente no oficial que usa la Spotify Web API pública, con las credenciales que cada usuario crea a su nombre en <https://developer.spotify.com/dashboard>, y únicamente para leer qué se está reproduciendo. No descarga, almacena ni reproduce audio.

## Iconos y tipografías

El icono de la aplicación (`build/icon.png`) es original del proyecto y queda cubierto por la licencia MIT del repositorio. La interfaz no incluye ninguna tipografía: usa las que ya trae Windows (Segoe UI Variable Text / Segoe UI), así que no se redistribuye ningún archivo de fuente.
