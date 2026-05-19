"""
Migración SQL Server -> PostgreSQL
===================================

Flujo:
  1. Restaurar el .bak en SQL Server Express (YA HECHO).
  2. Crear una base vacía en PostgreSQL como destino:
        psql -U postgres -c "CREATE DATABASE novacaja22;"
  3. Editar SOLO la contraseña de POSTGRES más abajo.
  4. Correrlo:  python migrar_mssql_a_postgres.py

Dependencias:
  pip install pyodbc psycopg2-binary

Necesitas también el "ODBC Driver 17 for SQL Server" de Microsoft:
  https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server

Lo que hace y lo que NO hace:
  ✓ Migra todas las tablas de usuario (esquema + datos).
  ✓ Mapea tipos comunes de SQL Server a PostgreSQL.
  ✓ Inserta en lotes (batch_size configurable) para soportar tablas grandes.
  ✓ Cita identificadores para sobrevivir nombres con mayúsculas o espacios.
  ✗ NO migra: foreign keys, índices, vistas, procedures, triggers, funciones.
     (Esto es a propósito: primero pasa los datos, después las constraints,
     porque si las pones antes el orden de inserción te rompe todo).
  ✗ NO migra logins ni permisos (en Postgres son otro modelo).

Para FKs/índices/procedures: después de correr esto, en SSMS haces clic
derecho sobre la BD restaurada -> Tasks -> Generate Scripts, eliges solo
"Foreign Keys" e "Indexes", y traduces a sintaxis Postgres.
"""

import sys

import pyodbc
import psycopg2
from psycopg2.extras import execute_batch


# ============================================================
# CONFIG  -- editar SOLO la contraseña de POSTGRES
# ============================================================

# SQL Server: usa tu usuario de Windows (no necesita contraseña)
MSSQL = {
    "driver":   "{ODBC Driver 17 for SQL Server}",
    "server":   "localhost\\SQLEXPRESS",
    "database": "novacaja22",
}

# PostgreSQL: pon aquí la contraseña que definiste al instalar Postgres
POSTGRES = {
    "host":     "localhost",
    "port":     5432,
    "dbname":   "novacaja22",              # crearla vacía antes de correr
    "user":     "postgres",
    "password": "12345",  # <-- CAMBIAR ESTO
}

BATCH_SIZE = 1000           # filas por lote al insertar
SCHEMAS_INCLUIR = None      # None = todos los esquemas de usuario; o lista: ["dbo"]
TABLAS_EXCLUIR = set()      # ej. {"sysdiagrams", "log_temporal"}


# ============================================================
# Mapeo de tipos SQL Server -> PostgreSQL
# ============================================================

TIPOS = {
    "int":              "INTEGER",
    "bigint":           "BIGINT",
    "smallint":         "SMALLINT",
    "tinyint":          "SMALLINT",       # Postgres no tiene tinyint
    "bit":              "BOOLEAN",
    "decimal":          "NUMERIC",
    "numeric":          "NUMERIC",
    "money":            "NUMERIC(19,4)",
    "smallmoney":       "NUMERIC(10,4)",
    "float":            "DOUBLE PRECISION",
    "real":             "REAL",
    "datetime":         "TIMESTAMP",
    "datetime2":        "TIMESTAMP",
    "smalldatetime":    "TIMESTAMP",
    "date":             "DATE",
    "time":             "TIME",
    "datetimeoffset":   "TIMESTAMPTZ",
    "char":             "CHAR",
    "varchar":          "VARCHAR",
    "text":             "TEXT",
    "nchar":            "CHAR",
    "nvarchar":         "VARCHAR",
    "ntext":            "TEXT",
    "binary":           "BYTEA",
    "varbinary":        "BYTEA",
    "image":            "BYTEA",
    "uniqueidentifier": "UUID",
    "xml":              "XML",
    "sql_variant":      "TEXT",
}


def mapear_tipo(sql_type, max_len, precision, scale):
    """Convierte un tipo de SQL Server a su equivalente en PostgreSQL."""
    base = TIPOS.get(sql_type.lower(), "TEXT")

    if base in ("VARCHAR", "CHAR"):
        # max_len = -1 en SQL Server significa MAX (ej. varchar(MAX))
        if max_len and max_len > 0:
            return f"{base}({max_len})"
        return "TEXT"

    if base == "NUMERIC" and precision:
        return f"NUMERIC({precision},{scale or 0})"

    return base


# ============================================================
# Conexiones
# ============================================================

def conectar_mssql():
    cs = (
        f"DRIVER={MSSQL['driver']};"
        f"SERVER={MSSQL['server']};"
        f"DATABASE={MSSQL['database']};"
        "Trusted_Connection=yes;"
        "TrustServerCertificate=yes;"
    )
    return pyodbc.connect(cs)


def conectar_postgres():
    return psycopg2.connect(**POSTGRES)


# ============================================================
# Lectura de metadatos
# ============================================================

def listar_tablas(cur):
    cur.execute("""
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
          AND TABLE_SCHEMA NOT IN ('sys','INFORMATION_SCHEMA')
        ORDER BY TABLE_SCHEMA, TABLE_NAME
    """)
    return [(r[0], r[1]) for r in cur.fetchall()]


def listar_columnas(cur, schema, tabla):
    cur.execute("""
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
               NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
    """, schema, tabla)
    return cur.fetchall()


# ============================================================
# Creación de tabla en Postgres
# ============================================================

def crear_tabla_postgres(pg_cur, tabla, columnas):
    partes = []
    for nombre, tipo, max_len, prec, scale, nullable in columnas:
        pg_tipo = mapear_tipo(tipo, max_len, prec, scale)
        null_sql = "NULL" if nullable == "YES" else "NOT NULL"
        partes.append(f'"{nombre}" {pg_tipo} {null_sql}')

    pg_cur.execute(f'DROP TABLE IF EXISTS "{tabla}" CASCADE')
    ddl = f'CREATE TABLE "{tabla}" (\n  ' + ",\n  ".join(partes) + "\n)"
    pg_cur.execute(ddl)


# ============================================================
# Conversión de valores fila por fila
# ============================================================

def normalizar_fila(fila):
    """
    pyodbc devuelve algunos tipos que psycopg2 no maneja bien.
    Aquí los normalizamos.
    """
    out = []
    for v in fila:
        if v is None:
            out.append(None)
        elif isinstance(v, bytearray):
            out.append(bytes(v))
        else:
            out.append(v)
    return tuple(out)


# ============================================================
# Migración de datos
# ============================================================

def migrar_datos(ms_cur, pg_cur, schema, tabla, columnas):
    nombres = [c[0] for c in columnas]
    cols_quoted = ", ".join(f'"{c}"' for c in nombres)
    cols_quoted_ms = ", ".join(f"[{c}]" for c in nombres)

    ms_cur.execute(f"SELECT {cols_quoted_ms} FROM [{schema}].[{tabla}]")

    placeholders = ", ".join(["%s"] * len(nombres))
    insert_sql = f'INSERT INTO "{tabla}" ({cols_quoted}) VALUES ({placeholders})'

    total = 0
    while True:
        lote = ms_cur.fetchmany(BATCH_SIZE)
        if not lote:
            break
        lote = [normalizar_fila(r) for r in lote]
        execute_batch(pg_cur, insert_sql, lote, page_size=BATCH_SIZE)
        total += len(lote)
        sys.stdout.write(f"\r   ... {total:,} filas")
        sys.stdout.flush()

    sys.stdout.write("\r")
    return total


# ============================================================
# Main
# ============================================================

def main():
    print("→ Conectando a SQL Server...")
    ms = conectar_mssql()
    ms_cur = ms.cursor()

    print("→ Conectando a PostgreSQL...")
    pg = conectar_postgres()
    pg_cur = pg.cursor()

    print("→ Listando tablas...")
    tablas = listar_tablas(ms_cur)
    if SCHEMAS_INCLUIR is not None:
        tablas = [t for t in tablas if t[0] in SCHEMAS_INCLUIR]
    tablas = [t for t in tablas if t[1] not in TABLAS_EXCLUIR]
    print(f"   {len(tablas)} tablas a migrar.\n")

    resumen = []
    errores = []

    for schema, tabla in tablas:
        print(f"• {schema}.{tabla}")
        try:
            cols = listar_columnas(ms_cur, schema, tabla)
            crear_tabla_postgres(pg_cur, tabla, cols)
            pg.commit()
            filas = migrar_datos(ms_cur, pg_cur, schema, tabla, cols)
            pg.commit()
            print(f"   ✓ {filas:,} filas")
            resumen.append((tabla, filas))
        except Exception as e:
            pg.rollback()
            print(f"   ✗ ERROR: {e}")
            errores.append((tabla, str(e)))

    ms.close()
    pg.close()

    print("\n" + "=" * 50)
    print("RESUMEN")
    print("=" * 50)
    total_filas = sum(f for _, f in resumen)
    print(f"Tablas migradas:  {len(resumen)}")
    print(f"Filas totales:    {total_filas:,}")
    print(f"Errores:          {len(errores)}")
    if errores:
        print("\nDetalle de errores:")
        for t, e in errores:
            print(f"  - {t}: {e}")

    print("\nSiguiente paso: generar FKs/índices/vistas desde SSMS")
    print("(Tasks -> Generate Scripts) y aplicarlos en Postgres.")


if __name__ == "__main__":
    main()