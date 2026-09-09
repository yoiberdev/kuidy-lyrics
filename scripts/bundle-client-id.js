// Hornea el Client ID de Spotify en el build.
//
// Antes esto se hacía metiendo el .env en build.extraResources, y tenía dos
// problemas: .env está en .gitignore, así que cualquier build hecho fuera de la
// máquina del desarrollador salía muerto y electron-builder solo avisaba con un
// warning; y el fichero quedaba suelto en resources/, editable.
//
// Ahora el valor se escribe en un módulo que entra en el asar como cualquier
// otro. Con PKCE el Client ID es público por diseño (viaja en la URL del
// navegador en cada login), así que empaquetarlo no filtra nada. Lo que jamás
// debe viajar es el client secret, que esta app no usa.
//
// Sin SPOTIFY_CLIENT_ID el build sigue siendo válido: se genera un módulo vacío
// y la app arranca en el asistente de configuración.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'electron', 'bundled-client-id.js');

function readFromEnvFile() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const m = raw.match(/^\s*SPOTIFY_CLIENT_ID\s*=\s*(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

const id = String(process.env.SPOTIFY_CLIENT_ID || readFromEnvFile() || '').trim();

if (id && !/^[0-9a-f]{32}$/i.test(id)) {
  console.error(
    `[bundle-client-id] SPOTIFY_CLIENT_ID no parece un Client ID de Spotify (32 hex): ${id.length} caracteres. Abortando para no publicar un build roto.`
  );
  process.exit(1);
}

fs.writeFileSync(
  OUT,
  `// GENERADO por scripts/bundle-client-id.js — no editar a mano, no versionar.\nmodule.exports = ${JSON.stringify(id)};\n`,
  'utf8'
);

if (id) {
  console.log(`[bundle-client-id] Client ID horneado (…${id.slice(-4)}).`);
} else {
  console.log(
    '[bundle-client-id] sin SPOTIFY_CLIENT_ID: el build pedirá al usuario que introduzca el suyo.'
  );
}
