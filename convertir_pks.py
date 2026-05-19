"""
Conversor: pks.sql (SQL Server) -> pks_postgres.sql (PostgreSQL)
================================================================

Toma el archivo generado por SSMS con CREATE TABLE + PRIMARY KEY,
extrae solo las PKs y genera ALTER TABLE compatibles con Postgres
para aplicar sobre las tablas ya migradas (que ya tienen los datos).

Uso:
    python convertir_pks.py
    # busca "pks.sql" en la carpeta actual y genera "pks_postgres.sql"

    o con rutas explícitas:
    python convertir_pks.py C:\\ruta\\pks.sql C:\\ruta\\pks_postgres.sql
"""

import re
import sys
from pathlib import Path


# Regex para capturar cada bloque CREATE TABLE ... PRIMARY KEY
TABLA_PK_RE = re.compile(
    r'CREATE TABLE \[(?P<schema>[^\]]+)\]\.\[(?P<tabla>[^\]]+)\].*?'
    r'PRIMARY KEY\s+(?:CLUSTERED|NONCLUSTERED)?\s*\(\s*'
    r'(?P<cols>.*?)\s*\)\s*WITH',
    re.DOTALL | re.IGNORECASE,
)

# Regex para extraer nombres de columnas de "[col] ASC, [col] DESC, ..."
COL_RE = re.compile(r'\[([^\]]+)\]', re.IGNORECASE)


def leer_con_encoding(ruta: Path) -> str:
    """
    SSMS guarda los .sql en distintos encodings dependiendo del modo:
    - "Unicode text" = UTF-16 LE con BOM
    - "ANSI text"    = Windows-1252
    - A veces UTF-8 con BOM
    Probamos en orden hasta que uno funcione.
    """
    with open(ruta, "rb") as f:
        head = f.read(4)

    # Detección por BOM
    if head.startswith(b"\xff\xfe"):
        encodings = ["utf-16-le", "utf-16"]
    elif head.startswith(b"\xfe\xff"):
        encodings = ["utf-16-be", "utf-16"]
    elif head.startswith(b"\xef\xbb\xbf"):
        encodings = ["utf-8-sig", "utf-8"]
    else:
        encodings = ["utf-8", "utf-16", "cp1252", "latin-1"]

    ultimo_error = None
    for enc in encodings:
        try:
            texto = ruta.read_text(encoding=enc)
            print(f"  (archivo leído como {enc})")
            return texto
        except (UnicodeDecodeError, UnicodeError) as e:
            ultimo_error = e
            continue

    raise RuntimeError(
        f"No pude leer {ruta} con ningún encoding conocido. "
        f"Último error: {ultimo_error}"
    )


def convertir(ruta_entrada: Path, ruta_salida: Path):
    sql = leer_con_encoding(ruta_entrada)

    salida = [
        "-- =====================================================",
        "-- Primary Keys: SQL Server -> PostgreSQL",
        "-- Aplicar DESPUES de migrar los datos.",
        "-- Si alguna tabla tiene duplicados en las columnas PK,",
        "-- esa linea va a fallar — las demas siguen aplicandose.",
        "-- =====================================================",
        "",
    ]

    # Todas las tablas que aparecen en el archivo
    todas = re.findall(r'CREATE TABLE \[[^\]]+\]\.\[([^\]]+)\]', sql)
    con_pk = set()

    for m in TABLA_PK_RE.finditer(sql):
        tabla = m.group("tabla")
        cols = COL_RE.findall(m.group("cols"))
        if not cols:
            continue
        con_pk.add(tabla)
        cols_sql = ", ".join(f'"{c}"' for c in cols)
        salida.append(
            f'ALTER TABLE "{tabla}" ADD PRIMARY KEY ({cols_sql});'
        )

    sin_pk = [t for t in todas if t not in con_pk]

    salida.append("")
    if sin_pk:
        salida.append(
            f"-- Tablas sin PRIMARY KEY en el origen ({len(sin_pk)}):"
        )
        for t in sin_pk:
            salida.append(f"--   {t}")

    # Lo guardamos como UTF-8 sin BOM (Postgres lo lee perfecto)
    ruta_salida.write_text("\n".join(salida), encoding="utf-8")

    print(f"\n✓ {len(con_pk)} ALTER TABLE generados")
    print(f"  {len(sin_pk)} tablas sin PK (listadas como comentario al final)")
    print(f"\nArchivo: {ruta_salida}")
    print(f"\nPara aplicarlo en Postgres:")
    print(
        f'  "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe" '
        f'-U postgres -d novacaja22 -f "{ruta_salida}"'
    )


if __name__ == "__main__":
    entrada = Path(sys.argv[1] if len(sys.argv) > 1 else "pks.sql")
    salida = Path(sys.argv[2] if len(sys.argv) > 2 else "pks_postgres.sql")

    if not entrada.exists():
        print(f"✗ No encontré: {entrada}")
        print(f"  Pon el script en la misma carpeta que pks.sql,")
        print(f"  o pasa la ruta como argumento.")
        sys.exit(1)

    convertir(entrada, salida)