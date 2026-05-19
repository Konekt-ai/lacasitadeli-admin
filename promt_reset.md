# Reset contraseña `sa` — SQL Server

## Contexto

- **Tu máquina (pruebas):** SQL Server 2022 Express · instancia `localhost\SQLEXPRESS` · servicio `MSSQL$SQLEXPRESS`
- **Cliente (producción):** SQL Server 2014 · instancia `SERMARKET` · servicio `MSSQL$SERMARKET`
- **App:** Node.js + `mssql` npm · base `novacaja22` · usuario `sa`

---

## Escenario A — Tu máquina local (tienes Windows auth → NO necesitas single-user mode)

### 1. Habilitar `sa`, poner password y activar Mixed Mode

Abre CMD como administrador:

```cmd
sqlcmd -S localhost\SQLEXPRESS -E
```

Dentro del prompt `1>`:

```sql
-- Ver estado actual de sa
SELECT name, is_disabled FROM sys.server_principals WHERE name = 'sa';
GO

-- Habilitar sa y asignar password
ALTER LOGIN sa ENABLE;
GO
ALTER LOGIN sa WITH PASSWORD = 'TuPasswordSeguro2026!';
GO

-- Activar Mixed Mode (Windows + SQL auth)
EXEC xp_instance_regwrite
    N'HKEY_LOCAL_MACHINE',
    N'Software\Microsoft\MSSQLServer\MSSQLServer',
    N'LoginMode',
    REG_DWORD,
    2;
GO
EXIT
```

### 2. Reiniciar el servicio

```cmd
net stop "MSSQL$SQLEXPRESS"
net start "MSSQL$SQLEXPRESS"
```

### 3. Verificar login con sa

```cmd
sqlcmd -S localhost\SQLEXPRESS -U sa -P TuPasswordSeguro2026!
```

Si entra y ves `1>` → listo.

### 4. Actualizar `.env`

```env
MSSQL_SERVER=localhost\SQLEXPRESS
MSSQL_USER=sa
MSSQL_PASSWORD=TuPasswordSeguro2026!
MSSQL_DATABASE=novacaja22
MSSQL_PORT=1433
```

### 5. Probar la API

```cmd
cd apps\api && npm run dev
```

Luego en el navegador o curl:
```
GET http://localhost:3002/api/novacaja/status
```

**Si falla con "TCP connection refused":** SQL Server Express tiene TCP/IP deshabilitado por defecto.
Solución: abre **SQL Server Configuration Manager** → SQL Server Network Configuration → Protocols for SQLEXPRESS → habilita **TCP/IP** → reinicia el servicio.

---

## Escenario B — Máquina del cliente (SQL Server 2014, SERMARKET — sin Windows auth)

Este procedimiento requiere que tengas acceso físico o RDP al servidor, con una cuenta de Windows que sea administrador local.

### 1. Identificar el servicio exacto

```cmd
sc query | findstr "MSSQL"
```

Busca algo como `MSSQL$SERMARKET`. Ese es el nombre del servicio.

### 2. Detener SQL Server

```cmd
net stop "SQLAgent$SERMARKET"
net stop "MSSQL$SERMARKET"
```

Acepta detener servicios dependientes si te lo pide.

### 3. Iniciar en single-user mode

Abre CMD como administrador y ejecuta (deja esta ventana abierta):

```cmd
"C:\Program Files\Microsoft SQL Server\MSSQL12.SERMARKET\MSSQL\Binn\sqlservr.exe" -m"SQLCMD" -s"SERMARKET"
```

Espera a ver la línea: `SQL Server is now ready for client connections.`

> Si la ruta no existe, verifica en `C:\Program Files\Microsoft SQL Server\` el nombre real de la carpeta. Para SQL Server 2014 es `MSSQL12.*`.

### 4. Conectar y resetear (segunda ventana CMD)

```cmd
sqlcmd -S .\SERMARKET -E
```

```sql
ALTER LOGIN sa ENABLE;
GO
ALTER LOGIN sa WITH PASSWORD = 'TuPasswordSeguro2026!';
GO
EXEC xp_instance_regwrite
    N'HKEY_LOCAL_MACHINE',
    N'Software\Microsoft\MSSQLServer\MSSQLServer',
    N'LoginMode',
    REG_DWORD,
    2;
GO
EXIT
```

### 5. Apagar single-user y reiniciar normal

En la primera ventana (donde corre `sqlservr.exe`): presiona **Ctrl+C** y espera.

```cmd
net start "MSSQL$SERMARKET"
net start "SQLAgent$SERMARKET"
```

### 6. Verificar

```cmd
sqlcmd -S .\SERMARKET -U sa -P TuPasswordSeguro2026!
```

---

## Connection string para la app (Node.js + mssql)

**Máquina local:**
```env
MSSQL_SERVER=localhost\SQLEXPRESS
```

**Cliente (desde tu máquina por red):**
```env
MSSQL_SERVER=192.168.1.68
```
> TCP/IP debe estar habilitado en el SQL Server del cliente y el puerto 1433 abierto en el firewall.

---

## Login dedicado (recomendado para producción — no usar `sa` en la app)

```sql
CREATE LOGIN admin_app WITH PASSWORD = 'OtraPasswordFuerte2026!';
USE novacaja22;
CREATE USER admin_app FOR LOGIN admin_app;
ALTER ROLE db_datareader ADD MEMBER admin_app;
ALTER ROLE db_datawriter ADD MEMBER admin_app;
GRANT EXECUTE TO admin_app;
GO
```

Luego en `.env`: `MSSQL_USER=admin_app` y `MSSQL_PASSWORD=OtraPasswordFuerte2026!`
