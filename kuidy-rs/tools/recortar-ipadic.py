# Recorta mecab-ipadic dejando solo lo que hace falta para romanizar:
# superficie, ids, coste, y TRES campos de feature (pos, sub1, lectura ya resuelta).
# El IPADIC original trae 13 campos; los otros nueve son gramatica que aqui
# no se usa y que es el grueso del tamano.
import io, os, sys, glob, csv

src = sys.argv[1]   # carpeta con los .csv, matrix.def, char.def, unk.def (EUC-JP)
dst = sys.argv[2]
os.makedirs(dst, exist_ok=True)

def leer(p):
    # El mecab-ipadic que reempaqueta lindera ya viene en UTF-8 (trae
    # convert_utf8.sh aplicado). El original de 2007 era EUC-JP.
    datos = io.open(p, 'rb').read()
    try:
        return datos.decode('utf-8')
    except UnicodeDecodeError:
        return datos.decode('euc_jp')

# --- lexico ---
filas = 0
salida = io.open(os.path.join(dst, 'lex.csv'), 'w', encoding='utf-8', newline='')
w = csv.writer(salida, quoting=csv.QUOTE_MINIMAL, lineterminator='\n')
for p in sorted(glob.glob(os.path.join(src, '*.csv'))):
    for row in csv.reader(io.StringIO(leer(p))):
        if len(row) < 13:
            continue
        surface, lid, rid, cost = row[0], row[1], row[2], row[3]
        pos, sub1 = row[4], row[5]
        yomi, pron = row[11], row[12]
        # La particula se lee como suena: は -> ワ, へ -> エ. Se resuelve aqui,
        # asi no hay que guardar los dos campos.
        lectura = pron if (pos == '助詞' and pron not in ('', '*')) else yomi
        if lectura in ('', '*'):
            lectura = '*'
        w.writerow([surface, lid, rid, cost, pos, sub1, lectura])
        filas += 1
salida.close()

# --- unk.def: mismo numero de campos de feature ---
out = io.open(os.path.join(dst, 'unk.def'), 'w', encoding='utf-8', newline='')
for row in csv.reader(io.StringIO(leer(os.path.join(src, 'unk.def')))):
    if len(row) < 5:
        continue
    out.write(','.join([row[0], row[1], row[2], row[3], row[4],
                        row[5] if len(row) > 5 else '*', '*']) + '\n')
out.close()

# --- char.def y matrix.def tal cual, solo reencodeados ---
for n in ('char.def', 'matrix.def'):
    io.open(os.path.join(dst, n), 'w', encoding='utf-8', newline='\n').write(leer(os.path.join(src, n)))

print('filas lexico:', filas)
for n in ('lex.csv', 'unk.def', 'char.def', 'matrix.def'):
    print('  %-12s %8.2f MB' % (n, os.path.getsize(os.path.join(dst, n)) / 1048576))
