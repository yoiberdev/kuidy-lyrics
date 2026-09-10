use std::fs::File;
use std::io::{BufReader, BufWriter};
use vibrato::SystemDictionaryBuilder;

fn main() {
    let dir = std::env::args().nth(1).unwrap();
    let out = std::env::args().nth(2).unwrap();
    let r = |n: &str| BufReader::new(File::open(format!("{dir}/{n}")).unwrap());
    let t = std::time::Instant::now();
    let dict = SystemDictionaryBuilder::from_readers(
        r("lex.csv"),
        r("matrix.def"),
        r("char.def"),
        r("unk.def"),
    )
    .unwrap();
    println!("compilado en {:?}", t.elapsed());

    // sin comprimir
    let mut f = BufWriter::new(File::create(format!("{out}/system.dic")).unwrap());
    dict.write(&mut f).unwrap();
    drop(f);

    // comprimido zstd-19, que es lo que se embebe en el exe
    let raw = std::fs::read(format!("{out}/system.dic")).unwrap();
    let comp = zstd::encode_all(&raw[..], 19).unwrap();
    std::fs::write(format!("{out}/system.dic.zst"), &comp).unwrap();
    println!(
        "  crudo {:.2} MB -> zstd-19 {:.2} MB",
        raw.len() as f64 / 1048576.0,
        comp.len() as f64 / 1048576.0
    );
}
