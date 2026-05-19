"""
Conversor: fks_indexes.sql (SQL Server) -> Postgres
====================================================

Procesa el archivo generado por SSMS y produce DOS archivos:
  - fks_postgres.sql     (foreign keys + unique constraints)
  - indexes_postgres.sql (todos los índices)

Uso:
    python convertir_fks_indexes.py
    # busca "fks_indexes.sql" en la carpeta actual
"""

import re
import sys
from pathlib import Path


def leer_con_encoding(ruta: Path) -> str:
    with open(ruta, "rb") as f:
        head = f.read(4)
    if head.startswith(b"\xff\xfe"):
        encodings = ["utf-16-le", "utf-16"]
    elif head.startswith(b"\xfe\xff"):
        encodings = ["utf-16-be", "utf-16"]
    elif head.startswith(b"\xef\xbb\xbf"):
        encodings = ["utf-8-sig", "utf-8"]
    else:
        encodings = ["utf-8", "utf-16", "cp1252", "latin-1"]
    for enc in encodings:
        try:
            t = ruta.read_text(encoding=enc)
            print(f"  (archivo leído como {enc})")
            return t
        except Exception:
            continue
    raise RuntimeError("No pude leer el archivo con ningún encoding")


# ---------- REGEX ----------

# Foreign Key: captura desde ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY hasta GO
FK_RE = re.compile(
    r'ALTER TABLE \[[^\]]+\]\.\[(?P<tabla>[^\]]+)\]\s+'
    r'(?:WITH\s+(?:CHECK|NOCHECK)\s+)?ADD\s+CONSTRAINT\s+\[(?P<name>[^\]]+)\]\s+'
    r'FOREIGN KEY\s*\(\s*(?P<cols>[^)]+)\s*\)\s+'
    r'REFERENCES\s+\[[^\]]+\]\.\[(?P<ref_tabla>[^\]]+)\]\s*'
    r'\(\s*(?P<ref_cols>[^)]+)\s*\)'
    r'(?P<actions>.*?)\s*GO',
    re.DOTALL | re.IGNORECASE,
)

# Acciones referenciales que sí queremos preservar
ACTION_RE = re.compile(
    r'ON\s+(DELETE|UPDATE)\s+(CASCADE|NO\s+ACTION|SET\s+NULL|SET\s+DEFAULT|RESTRICT)',
    re.IGNORECASE,
)

# Unique constraints (ALTER TABLE ... ADD CONSTRAINT ... UNIQUE)
UNIQUE_RE = re.compile(
    r'ALTER TABLE \[[^\]]+\]\.\[(?P<tabla>[^\]]+)\]\s+'
    r'ADD\s+CONSTRAINT\s+\[(?P<name>[^\]]+)\]\s+'
    r'UNIQUE\s+(?:CLUSTERED|NONCLUSTERED)?\s*'
    r'\(\s*(?P<cols>.*?)\s*\)'
    r'(?:\s*WITH\s*\([^)]+\))?'
    r'(?:\s*ON\s+\[[^\]]+\])?\s*GO',
    re.DOTALL | re.IGNORECASE,
)

# Indexes (incluyendo UNIQUE INDEX)
INDEX_RE = re.compile(
    r'CREATE\s+(?P<unique>UNIQUE\s+)?'
    r'(?:CLUSTERED\s+|NONCLUSTERED\s+)?INDEX\s+'
    r'\[(?P<name>[^\]]+)\]\s+ON\s+'
    r'\[[^\]]+\]\.\[(?P<tabla>[^\]]+)\]\s*'
    r'\(\s*(?P<cols>.*?)\s*\)\s*'
    r'(?:INCLUDE\s*\(\s*(?P<include>[^)]+?)\s*\)\s*)?'
    r'(?:WHERE\s*\((?P<where>[^)]+)\)\s*)?'
    r'(?:WITH\s*\([^)]+\)\s*)?'
    r'(?:ON\s+\[[^\]]+\]\s*)?'
    r'GO',
    re.DOTALL | re.IGNORECASE,
)

COL_RE = re.compile(r'\[([^\]]+)\]', re.IGNORECASE)
COL_DIR_RE = re.compile(r'\[([^\]]+)\]\s*(ASC|DESC)?', re.IGNORECASE)


def cols_simples(texto: str) -> str:
    """[col1], [col2] -> "col1", "col2" """
    cols = COL_RE.findall(texto)
    return ", ".join(f'"{c}"' for c in cols)


def cols_con_orden(texto: str) -> str:
    """[col1] ASC, [col2] DESC -> "col1", "col2" DESC (ASC se omite, es default) """
    out = []
    for m in COL_DIR_RE.finditer(texto):
        col = m.group(1)
        direccion = (m.group(2) or "").upper()
        if direccion == "DESC":
            out.append(f'"{col}" DESC')
        else:
            out.append(f'"{col}"')
    return ", ".join(out)


def acciones_fk(texto: str) -> str:
    """Extrae ON DELETE/UPDATE ... y los devuelve normalizados"""
    partes = []
    for m in ACTION_RE.finditer(texto):
        tipo = m.group(1).upper()
        accion = re.sub(r"\s+", " ", m.group(2).upper())
        partes.append(f"ON {tipo} {accion}")
    return (" " + " ".join(partes)) if partes else ""


# ---------- PROCESO ----------

def convertir(ruta_in: Path, ruta_fks: Path, ruta_idx: Path):
    sql = leer_con_encoding(ruta_in)

    fks_out = [
        "-- =====================================================",
        "-- Foreign Keys + Unique Constraints",
        "-- SQL Server -> PostgreSQL",
        "-- Si una FK falla suele ser por datos huérfanos en el origen.",
        "-- =====================================================",
        "",
    ]
    idx_out = [
        "-- =====================================================",
        "-- Indexes: SQL Server -> PostgreSQL",
        "-- Renombrados con sufijo _N si hay colisión de nombres.",
        "-- =====================================================",
        "",
    ]

    # FKs
    fk_count = 0
    for m in FK_RE.finditer(sql):
        tabla = m.group("tabla")
        name = m.group("name")
        cols = cols_simples(m.group("cols"))
        ref_tabla = m.group("ref_tabla")
        ref_cols = cols_simples(m.group("ref_cols"))
        acciones = acciones_fk(m.group("actions") or "")
        fks_out.append(
            f'ALTER TABLE "{tabla}" ADD CONSTRAINT "{name}" '
            f'FOREIGN KEY ({cols}) REFERENCES "{ref_tabla}" ({ref_cols}){acciones};'
        )
        fk_count += 1

    # Unique constraints
    uniq_count = 0
    for m in UNIQUE_RE.finditer(sql):
        tabla = m.group("tabla")
        name = m.group("name")
        cols = cols_simples(m.group("cols"))
        fks_out.append(
            f'ALTER TABLE "{tabla}" ADD CONSTRAINT "{name}" UNIQUE ({cols});'
        )
        uniq_count += 1

    # Indexes
    idx_count = 0
    nombres_usados = set()
    for m in INDEX_RE.finditer(sql):
        tabla = m.group("tabla")
        name = m.group("name")
        unique_kw = "UNIQUE " if m.group("unique") else ""
        cols = cols_con_orden(m.group("cols"))
        include = m.group("include")
        where = m.group("where")

        # Evitar colisiones de nombres en Postgres (alcance por schema, no por tabla)
        final_name = name
        base = final_name
        suf = 2
        while final_name in nombres_usados:
            final_name = f"{base}_{suf}"
            suf += 1
        nombres_usados.add(final_name)

        stmt = f'CREATE {unique_kw}INDEX "{final_name}" ON "{tabla}" ({cols})'

        if include:
            inc = cols_simples(include)
            stmt += f' INCLUDE ({inc})'

        if where:
            # Convertir [col] a "col" dentro del WHERE
            where_pg = re.sub(r'\[([^\]]+)\]', r'"\1"', where)
            stmt += f' WHERE ({where_pg})'

        stmt += ";"
        idx_out.append(stmt)
        idx_count += 1

    ruta_fks.write_text("\n".join(fks_out), encoding="utf-8")
    ruta_idx.write_text("\n".join(idx_out), encoding="utf-8")

    print()
    print(f"✓ {fk_count} foreign keys")
    print(f"✓ {uniq_count} unique constraints")
    print(f"  -> {ruta_fks}")
    print(f"✓ {idx_count} indexes")
    print(f"  -> {ruta_idx}")
    print()
    print("Aplicar en este orden:")
    print(f'  & "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe" '
          f'-U postgres -d novacaja22 -f {ruta_fks.name}')
    print(f'  & "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe" '
          f'-U postgres -d novacaja22 -f {ruta_idx.name}')


if __name__ == "__main__":
    entrada = Path(sys.argv[1] if len(sys.argv) > 1 else "fks_indexes.sql")
    salida_fks = Path("fks_postgres.sql")
    salida_idx = Path("indexes_postgres.sql")

    if not entrada.exists():
        print(f"✗ No encontré: {entrada}")
        sys.exit(1)

    convertir(entrada, salida_fks, salida_idx)