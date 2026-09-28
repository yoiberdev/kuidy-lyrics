//! De lo que dice Windows a lo que entiende lrclib.
//!
//! Windows entrega el titulo tal y como lo puso quien publica el audio, y eso
//! casi nunca es el nombre de la cancion. Un reproductor decente manda
//! "Bohemian Rhapsody"; un navegador con YouTube delante manda
//! "Queen - Bohemian Rhapsody (Official Video Remastered)" y por artista el
//! nombre del canal, cuando manda algo.
//!
//! lrclib busca por coincidencia, no por parecido: cualquiera de esos adornos
//! basta para no encontrar una cancion que si esta en la base. De ahi este
//! modulo, que no consulta nada — solo convierte una consulta en la lista de
//! consultas que vale la pena probar, de la mas fiel a la mas desesperada.
//!
//! El titulo crudo no se toca en ningun otro sitio: es el que se ensena en la
//! cabecera del overlay, donde lo que se quiere es lo que el usuario puso a
//! sonar, adornos incluidos.

use crate::lrclib::Query;

/// Palabras que delatan un adorno y no una parte del nombre de la cancion.
///
/// La lista es corta a proposito: cada palabra que se anade puede romper una
/// cancion que la lleve de verdad en el titulo.
///
/// Lo que hace que puedan estar aqui palabras tan corrientes como "music" o
/// "live" es que el tramo solo cuenta como adorno si **todas** sus palabras
/// estan en esta lista. "(Official Music Video)" se va entero; "(Music Box
/// Version)" se queda, porque "box" y "version" no estan.
const ADORNOS: &[&str] = &[
    "official",
    "video",
    "audio",
    "music",
    "lyric",
    "lyrics",
    "visualizer",
    "visualiser",
    "remaster",
    "remastered",
    "explicit",
    "clean",
    "live",
    "vevo",
    "hd",
    "hq",
    "4k",
    "8k",
    "mv",
    "pv",
    "topic",
    "legendado",
    "sub espanol",
    "full album",
    "out now",
    // Y en espanol, que es la mitad de lo que suena aqui. La regla de "todas
    // las palabras del grupo" hace seguro incluso meter "en": "(En Vivo)" se
    // va entero, pero "En Mi Corazon" no, porque "corazon" no es adorno.
    "oficial",
    "videoclip",
    "letra",
    "letras",
    "video",
    "vivo",
    "en",
    "directo",
    "subtitulado",
    "subtitulada",
    "completo",
];

/// Lo que marca a un invitado. Se quita porque lrclib indexa el tema por su
/// artista principal: "Song (feat. B)" de A esta guardado como "Song" de A.
const INVITADOS: &[&str] = &["feat.", "feat ", "ft.", "ft ", "featuring", "with "];

/// Las consultas que vale la pena probar, en orden.
///
/// La primera es siempre la original sin tocar: cuando los metadatos vienen
/// limpios — que es lo normal en Spotify — la busqueda exacta acierta de lleno
/// y no hay motivo para estropearla. Las demas solo se llegan a usar si esa no
/// encuentra nada.
///
/// Nunca devuelve una consulta con el titulo vacio, y nunca repite.
pub fn intentos(query: &Query) -> Vec<Query> {
    let mut out = vec![query.clone()];

    let limpio = limpiar(&query.track);
    if !limpio.is_empty() && limpio != query.track {
        out.push(Query { track: limpio.clone(), ..query.clone() });
    }

    // Un canal no es un artista. Lo que Windows entrega de un navegador con
    // YouTube es el nombre del canal --- "AlejandroSanzVEVO", "Alejandro Sanz
    // - Topic" --- y con eso lrclib no encuentra nada aunque tenga la cancion.
    let canal = limpiar_canal(&query.artist);
    if !canal.is_empty() && canal != query.artist {
        let track = if limpio.is_empty() { query.track.clone() } else { limpio.clone() };
        out.push(Query { track, artist: canal, ..query.clone() });
    }

    // Y el titulo de YouTube suele traer "Artista - Cancion", que es donde
    // esta el artista de verdad. Se intenta **siempre** que el titulo se pueda
    // partir, no solo cuando el artista viene vacio: cuando lo que viene es un
    // canal, el artista no falta, sobra --- y estorba mas que faltar. Esa
    // condicion de "solo si esta vacio" era la razon de que una cancion
    // conocidisima no apareciera.
    let base = if limpio.is_empty() { query.track.clone() } else { limpio };
    if let Some((artista, titulo)) = partir(&base) {
        out.push(Query { track: titulo, artist: artista, ..query.clone() });
    }

    out.dedup_by(|a, b| a.track == b.track && a.artist == b.artist);
    out
}

/// Quita del titulo lo que no es el nombre de la cancion.
///
/// Dos formas de adorno, porque se usan las dos: entre parentesis o corchetes
/// — "(Official Video)", "[4K]" — y colgando de un guion al final —
/// "- Remastered 2011".
fn limpiar(titulo: &str) -> String {
    let sin_grupos = quitar_grupos(titulo);
    let sin_cola = quitar_cola(&sin_grupos);
    sin_cola.trim().trim_end_matches(['-', '|', ':']).trim().to_string()
}

/// Quita los parentesis y corchetes que solo llevan adorno dentro.
///
/// Solo esos: hay canciones cuyo nombre lleva parentesis de verdad, como
/// "Everything I Do (I Do It for You)", y vaciarlos todos las perderia.
fn quitar_grupos(titulo: &str) -> String {
    let mut out = String::with_capacity(titulo.len());
    let mut grupo = String::new();
    let mut cierre: Option<char> = None;

    for c in titulo.chars() {
        match cierre {
            None => match c {
                '(' => cierre = Some(')'),
                '[' => cierre = Some(']'),
                _ => out.push(c),
            },
            Some(esperado) if c == esperado => {
                if !es_adorno(&grupo) {
                    let abre = if esperado == ')' { '(' } else { '[' };
                    out.push(abre);
                    out.push_str(&grupo);
                    out.push(esperado);
                }
                grupo.clear();
                cierre = None;
            }
            Some(_) => grupo.push(c),
        }
    }

    // Un parentesis que nunca cierra: se devuelve lo que habia, sin inventar.
    if cierre.is_some() {
        out.push('(');
        out.push_str(&grupo);
    }

    // Quitar un grupo deja dos espacios pegados donde estaba.
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Quita el adorno que cuelga de un guion al final: "Cancion - Remastered".
///
/// Solo mira el ultimo tramo, y solo lo quita si es adorno. "Artista - Titulo"
/// no se toca aqui: eso lo decide `partir`, y solo cuando falta el artista.
fn quitar_cola(titulo: &str) -> String {
    match titulo.rsplit_once(" - ") {
        Some((cabeza, cola)) if es_adorno(cola) && !cabeza.trim().is_empty() => cabeza.to_string(),
        _ => titulo.to_string(),
    }
}

/// Si un tramo de texto es adorno y no parte del nombre.
///
/// Se mira palabra a palabra y no por trozos sueltos: buscando "mv" dentro de
/// la cadena, "Improvisation" seria un adorno.
fn es_adorno(tramo: &str) -> bool {
    let bajo = tramo.to_lowercase();
    let limpio = bajo.trim();
    if limpio.is_empty() {
        return false;
    }
    if INVITADOS.iter().any(|i| limpio.starts_with(i)) {
        return true;
    }
    // Un ano suelto acompana al adorno ("Remastered 2011") y no lo invalida.
    limpio
        .split(|c: char| !c.is_alphanumeric())
        .filter(|p| !p.is_empty())
        .filter(|p| !p.chars().all(|c| c.is_ascii_digit()))
        .all(|palabra| ADORNOS.contains(&palabra))
}

/// Parte "Artista - Titulo" por el primer guion.
///
/// Por el primero y no por el ultimo: los titulos con guion suelen tenerlo en
/// el nombre de la cancion, no en el del artista.
/// Quita del nombre de un canal lo que no es el artista.
///
/// YouTube Music publica cada artista como un canal "Fulano - Topic", y los
/// canales oficiales de las discograficas anaden "VEVO" pegado al nombre. Ni
/// uno ni otro existen como artista en ninguna base de letras.
fn limpiar_canal(artista: &str) -> String {
    let a = artista.trim();
    let sin_topic = a.strip_suffix(" - Topic").unwrap_or(a);
    let sin_vevo = sin_topic.strip_suffix("VEVO").unwrap_or(sin_topic);
    // "Official" suelto al final, que tambien se ve: "Alejandro Sanz Official".
    let sin_oficial = sin_vevo.trim().strip_suffix(" Official").unwrap_or(sin_vevo);
    sin_oficial.trim().to_string()
}

fn partir(titulo: &str) -> Option<(String, String)> {
    let (artista, resto) = titulo.split_once(" - ")?;
    let artista = artista.trim();
    let resto = resto.trim();
    if artista.is_empty() || resto.is_empty() {
        return None;
    }
    Some((artista.to_string(), resto.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn query(track: &str, artist: &str) -> Query {
        Query {
            track: track.into(),
            artist: artist.into(),
            album: String::new(),
            duration: Duration::from_secs(200),
        }
    }

    #[test]
    fn lo_que_ya_viene_limpio_se_prueba_una_sola_vez() {
        let intentos = intentos(&query("Bohemian Rhapsody", "Queen"));
        assert_eq!(intentos.len(), 1, "sin adornos no hay nada que reintentar");
    }

    #[test]
    fn el_original_siempre_va_primero() {
        let intentos = intentos(&query("Song (Official Video)", "A"));
        assert_eq!(intentos[0].track, "Song (Official Video)");
    }

    #[test]
    fn se_cae_el_parentesis_de_adorno() {
        assert_eq!(limpiar("Yoru ni Kakeru (Official Music Video)"), "Yoru ni Kakeru");
        assert_eq!(limpiar("Song [4K]"), "Song");
        assert_eq!(limpiar("Song (Lyrics)"), "Song");
    }

    #[test]
    fn una_palabra_corriente_sola_no_basta_para_tirar_el_grupo() {
        // "music" y "live" estan en la lista, pero el tramo entero tiene que
        // serlo. Si no, esto perderia el nombre real de la cancion.
        let titulo = "Song (Music Box Version)";
        assert_eq!(limpiar(titulo), titulo);
        let otro = "Song (Live at Wembley)";
        assert_eq!(limpiar(otro), otro);
    }

    #[test]
    fn se_queda_el_parentesis_que_es_del_titulo() {
        let titulo = "Everything I Do (I Do It for You)";
        assert_eq!(limpiar(titulo), titulo, "eso es el nombre de la cancion");
    }

    #[test]
    fn se_cae_la_cola_colgada_del_guion() {
        assert_eq!(limpiar("Bohemian Rhapsody - Remastered 2011"), "Bohemian Rhapsody");
    }

    #[test]
    fn no_se_cae_lo_que_no_es_adorno() {
        let titulo = "Marea - En mi cabeza";
        assert_eq!(limpiar(titulo), titulo, "eso es artista y cancion, no un adorno");
    }

    #[test]
    fn el_invitado_se_quita() {
        assert_eq!(limpiar("Song (feat. Alguien)"), "Song");
        assert_eq!(limpiar("Song (ft. Alguien)"), "Song");
    }

    #[test]
    fn sin_artista_se_saca_del_titulo() {
        let intentos = intentos(&query("Queen - Bohemian Rhapsody (Official Video)", ""));
        let ultimo = intentos.last().unwrap();
        assert_eq!(ultimo.artist, "Queen");
        assert_eq!(ultimo.track, "Bohemian Rhapsody");
    }

    #[test]
    fn con_artista_el_titulo_no_se_parte() {
        let intentos = intentos(&query("Marea - En mi cabeza", "Marea"));
        assert!(
            intentos.iter().all(|q| q.artist == "Marea"),
            "si Windows dio el artista, no hay que adivinarlo"
        );
    }

    #[test]
    fn un_titulo_que_es_todo_adorno_no_deja_la_consulta_vacia() {
        let intentos = intentos(&query("(Official Video)", "A"));
        assert!(intentos.iter().all(|q| !q.track.trim().is_empty()));
    }

    #[test]
    fn un_parentesis_sin_cerrar_no_se_come_el_titulo() {
        assert_eq!(limpiar("Song (Official"), "Song (Official");
    }

    #[test]
    fn improvisation_no_es_un_adorno_por_llevar_mv_dentro() {
        let titulo = "Improvisation";
        assert_eq!(limpiar(titulo), titulo);
    }

    /// El caso que hacia que canciones conocidisimas no aparecieran.
    ///
    /// Con YouTube en el navegador, Windows entrega como artista el nombre del
    /// **canal**. La particion "Artista - Cancion" del titulo solo se
    /// intentaba cuando el artista venia vacio, y con un canal nunca lo esta:
    /// asi que la unica consulta que podia acertar no se llegaba a hacer.
    #[test]
    fn un_canal_de_youtube_no_impide_encontrar_al_artista() {
        let q = query("Alejandro Sanz - Cancion (Videoclip Oficial)", "AlejandroSanzVEVO");
        let intentos = intentos(&q);
        let pares: Vec<(&str, &str)> =
            intentos.iter().map(|i| (i.track.as_str(), i.artist.as_str())).collect();

        assert!(
            pares.contains(&("Cancion", "Alejandro Sanz")),
            "tiene que probar con el artista del titulo: {pares:?}"
        );
        // Del canal sale el nombre pegado --- no hay forma de saber donde iba
        // el espacio --- pero es un intento mas, no el que acierta.
        assert!(
            pares.contains(&("Alejandro Sanz - Cancion", "AlejandroSanz")),
            "y con el canal sin el VEVO: {pares:?}"
        );
        assert!(
            pares.contains(&("Alejandro Sanz - Cancion", "AlejandroSanzVEVO")),
            "y con el titulo sin el adorno en espanol: {pares:?}"
        );
        assert_eq!(pares[0], ("Alejandro Sanz - Cancion (Videoclip Oficial)", "AlejandroSanzVEVO"));
    }

    /// YouTube Music publica cada artista como un canal "Fulano - Topic".
    #[test]
    fn un_canal_topic_se_queda_en_el_artista() {
        assert_eq!(limpiar_canal("Alejandro Sanz - Topic"), "Alejandro Sanz");
        assert_eq!(limpiar_canal("AlejandroSanzVEVO"), "AlejandroSanz");
        assert_eq!(limpiar_canal("Alejandro Sanz Official"), "Alejandro Sanz");
        // Y un artista normal no se toca, aunque lleve palabras parecidas.
        assert_eq!(limpiar_canal("Alejandro Sanz"), "Alejandro Sanz");
        assert_eq!(limpiar_canal("Topic"), "Topic");
    }

}
