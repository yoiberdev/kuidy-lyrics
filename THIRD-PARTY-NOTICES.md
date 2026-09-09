# Avisos de terceros

Kuidy Lyrics se distribuye bajo la licencia MIT (ver [LICENSE](LICENSE)) e incluye o depende del software de terceros que se lista aquí. Las licencias indicadas se han comprobado leyendo el campo `license` del `package.json` de cada paquete instalado; las versiones son las que había en el árbol de dependencias al preparar la 0.9.0-beta.1.

## Dependencias

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
