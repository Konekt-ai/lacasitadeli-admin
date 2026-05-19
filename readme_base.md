# Migración SQL Server → PostgreSQL: novacaja22

Documento de seguimiento del proyecto de migración de la base de datos
`novacaja22` (sistema POS del cliente) de SQL Server 2014 a PostgreSQL 18.

---

## Contexto del proyecto

- **Origen:** SQL Server 2014, base `novacaja22`, ~10.5 GB, 572 tablas
- **Destino:** PostgreSQL 18 local, base `novacaja22` (UTF-8)
- **Servidor SQL Server local de trabajo:** `localhost\SQLEXPRESS` (SQL Server 2022 Express)
- **Carpeta de trabajo:** `C:\Users\DiegoB)\Desktop\lacasitadeli-admin\`

**Situación inicial:** El cliente perdió la contraseña de su SQL Server original.
Se generó un backup `.bak` aprovechando una sesión activa. Como AWS DMS y otras
herramientas requieren la contraseña original, se optó por restaurar el `.bak`
en una instancia local de SQL Server Express (donde nosotros definimos las
credenciales) y migrar desde ahí con scripts propios en Python.

---

## Estado del proceso

| Paso | Estado | Notas |
|------|--------|-------|
| 1. Restaurar `.bak` en SQL Server Express local | ✅ Hecho | Tablas visibles en SSMS |
| 2. Crear base vacía en PostgreSQL 18 | ✅ Hecho | UTF-8 |
| 3. Migrar esquemas + datos de las 572 tablas | ✅ Hecho | 15,699,151 filas, 0 errores |
| 4. Aplicar Primary Keys en Postgres | ✅ Hecho | Vía `pks_postgres.sql` |
| 5. Aplicar Foreign Keys + Índices + Unique Keys | ⏳ Pendiente | Siguiente paso |
| 6. Manejar columnas IDENTITY (auto-increment) | ⏳ Pendiente | Necesario antes de que la app inserte |
| 7. Validar conteos de filas origen vs destino | ⏳ Pendiente | QA final |
| 8. Check Constraints, vistas, stored procedures | ⏳ Pendiente | Opcional según necesidad de la app |

---

## Archivos del proyecto

```
lacasitadeli-admin/
├── migrar_mssql_a_postgres.py   # Script principal de migración de datos (YA EJECUTADO)
├── convertir_pks.py             # Conversor de SQL Server PKs → Postgres ALTER TABLE
├── pks.sql                      # Script generado por SSMS (UTF-16, no usable directo)
├── pks_postgres.sql             # PKs convertidas, listas para psql (YA APLICADAS)
└── README.md                    # Este archivo
```

---

## Cómo retomar el proyecto

### Prerequisitos en la máquina de trabajo

1. **SQL Server 2022 Express** corriendo en `localhost\SQLEXPRESS` con la BD
   `novacaja22` restaurada. Autenticación por Windows (usuario actual).
2. **PostgreSQL 18** instalado en `C:\Program Files\PostgreSQL\18\` con la BD
   `novacaja22` creada.
3. **Python 3.13+** con estas librerías:
   ```bash
   pip install pyodbc psycopg2-binary
   ```
4. **ODBC Driver 17 for SQL Server** instalado (necesario para `pyodbc`).

### Configuración común

En `migrar_mssql_a_postgres.py` la sección `POSTGRES` tiene la contraseña de
Postgres. Verificar que esté correcta antes de cualquier nueva ejecución.

### Comandos clave

```powershell
# Conectarse a Postgres
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d novacaja22

# Aplicar un archivo .sql
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d novacaja22 -f archivo.sql

# Lo mismo pero guardando log:
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d novacaja22 -f archivo.sql *> log.txt
```

> **Nota PowerShell:** siempre anteponer `&` cuando se invoca un .exe entre
> comillas, de lo contrario PowerShell trata la ruta como string.

---

## Pasos pendientes — Instrucciones detalladas

### Paso 5: Foreign Keys + Índices + Unique Keys

**5.1. Generar el script desde SSMS:**

1. En SSMS, clic derecho en BD `novacaja22` → *Tasks* → *Generate Scripts*.
2. *Next* → *Select specific database objects* → marcar solo **Tables**.
3. *Next* → *Advanced*:

   Cambiar a **True:**
   - `Script Foreign Keys`
   - `Script Indexes`
   - `Script Unique Keys`
   - `Continue scripting on Error`

   Cambiar a **False:**
   - `Script Primary Keys` (ya aplicadas)
   - `Script Check Constraints` (las dejamos para después)
   - `Script Data Compression Options`
   - `Script Xml Compression Options`
   - `Script USE DATABASE`
   - `Script Triggers`
   - `Script Full-Text Indexes`

   Otros:
   - `Types of data to script` → **Schema only**
   - `Script DROP and CREATE` → **Script CREATE**

4. *Next* → **Save as script file** → *Single script file* → guardar como
   `fks_indexes.sql` en la carpeta del proyecto → **Unicode text**.

**5.2. Crear conversor `convertir_fks.py`:**

Análogo a `convertir_pks.py` pero maneja:

- `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY (...) REFERENCES ...`
- `CREATE [UNIQUE] [NONCLUSTERED] INDEX ... ON ... (...)`
- Quitar `INCLUDE (...)`, `WITH (...)`, `ON [PRIMARY]`, `WHERE (...)` específicos
  de SQL Server, o adaptarlos a sintaxis Postgres.
- Convertir `[corchetes]` a `"comillas"`.

**Antes de programarlo**, pasar las primeras ~50 líneas del `fks_indexes.sql`
generado para ver con qué cosas extrañas viene (a veces hay índices filtrados,
columnas INCLUDE, etc.). El conversor se adapta a lo que aparezca.

**5.3. Aplicar el resultado:**

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d novacaja22 -f fks_postgres.sql *> log_fks.txt
```

Las FKs que fallen probablemente sean por datos huérfanos (filas que apuntan a
IDs que no existen en la tabla padre). Eso es información valiosa para el
cliente: significa que su BD tenía inconsistencias. Documentar y consultar con
él si se limpian o se ignoran.

---

### Paso 6: Columnas IDENTITY (auto-increment)

SQL Server usa `IDENTITY(seed, increment)`; Postgres usa
`GENERATED BY DEFAULT AS IDENTITY` o `SERIAL`. La migración de datos NO transfirió
esta propiedad, así que si la aplicación intenta insertar un registro nuevo en
una tabla como `Articulos` (donde `Art_Codigo` probablemente es IDENTITY), va a
fallar porque Postgres no sabe que esa columna debe autogenerarse.

**Detección:** Correr esta query contra el SQL Server local:

```sql
SELECT
    s.name AS schema_name,
    t.name AS table_name,
    c.name AS column_name,
    IDENT_CURRENT(s.name + '.' + t.name) AS last_value
FROM sys.columns c
JOIN sys.tables t ON c.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE c.is_identity = 1
ORDER BY s.name, t.name;
```

**Para cada columna IDENTITY**, aplicar en Postgres:

```sql
ALTER TABLE "TablaX"
  ALTER COLUMN "ColX" ADD GENERATED BY DEFAULT AS IDENTITY (RESTART WITH <last_value + 1>);
```

El `RESTART WITH` es crítico: si no se hace, Postgres empieza desde 1 y va a
chocar con los IDs ya existentes.

Esto se puede automatizar con un script `migrar_identities.py` que lea el SQL
Server y genere el SQL de Postgres correspondiente. Pedirlo cuando se llegue
a este paso.

---

### Paso 7: Validación de conteos

Para confirmar que ninguna fila se perdió, correr una query equivalente en
ambas BDs y comparar.

**En SQL Server (SSMS):**

```sql
SELECT t.name AS tabla, p.rows AS filas
FROM sys.tables t
JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0,1)
ORDER BY t.name;
```

**En Postgres:**

```sql
SELECT
    schemaname || '.' || relname AS tabla,
    n_live_tup AS filas
FROM pg_stat_user_tables
ORDER BY relname;
```

(Para conteos exactos en Postgres usar `SELECT COUNT(*)` por tabla, pero con
572 tablas es preferible un script. Pedirlo si se quiere automatizar.)

---

### Paso 8: Check Constraints, vistas, procedures (opcional)

Solo necesario si la aplicación cliente los usa. **Recomendación:** preguntar
al cliente qué consume el `compucaja` / `novacaja22` antes de invertir tiempo
aquí. Probablemente sea una app de POS .NET que vive de las tablas, no de
procedures.

Si hay que migrar:
- **Check constraints:** sintaxis suele ser portable, find-and-replace de
  corchetes a comillas y listo.
- **Vistas:** sintaxis SQL Server T-SQL → Postgres PL/pgSQL. Suele requerir
  ajustes manuales (`ISNULL` → `COALESCE`, `GETDATE()` → `NOW()`, `TOP n` →
  `LIMIT n`, `[brackets]` → `"quotes"`, etc.).
- **Stored procedures / functions:** reescritura completa a PL/pgSQL.
  Conviene revisar caso por caso.

---

## Detalles técnicos importantes para retomar

### Encoding de los archivos de SSMS

SSMS guarda los `.sql` con BOM UTF-16 LE cuando se elige "Unicode text".
El conversor `convertir_pks.py` ya detecta esto automáticamente. Si se hace
otro conversor, replicar la función `leer_con_encoding()`.

### Mapeo de tipos aplicado

El script `migrar_mssql_a_postgres.py` ya mapeó (ver constante `TIPOS`):

| SQL Server          | PostgreSQL        |
|---------------------|-------------------|
| bit                 | BOOLEAN           |
| tinyint             | SMALLINT          |
| money               | NUMERIC(19,4)     |
| datetime, datetime2 | TIMESTAMP         |
| datetimeoffset      | TIMESTAMPTZ       |
| uniqueidentifier    | UUID              |
| nvarchar(MAX)       | TEXT              |
| varbinary, image    | BYTEA             |

### Cosas que el conversor de PKs limpia

- `[corchetes]` → `"comillas"`
- `CLUSTERED` / `NONCLUSTERED` → eliminados (Postgres no los usa)
- `WITH (PAD_INDEX = OFF, ...)` → eliminado
- `ON [PRIMARY]` → eliminado
- `ASC` en columnas de PK → ignorado (es el default)

### Resultados de la migración de datos

```
Tablas migradas:  572
Filas totales:    15,699,151
Errores:          0
```

---

## Contacto / siguiente sesión

Si se acaba el contexto del chat, abrir uno nuevo con este README y mencionar:

> "Estoy migrando una BD SQL Server a PostgreSQL 18, ya tengo migrados datos y
> PKs. Siguiente paso: foreign keys e índices. Aquí el README con el estado."

Y desde ahí seguir con el Paso 5.