# La Casita Deli — Sistema de Administración

Sistema interno para La Casita Deli: panel administrativo web, control de bodega con Zebra TC52, y gestión de inventario conectada a NovaCaja (SQL Server).

Desarrollado por **Konekt**.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│  Panel Admin  (Next.js)          http://localhost:3001       │
│  — Inventario, ventas, bodega, merma, surtido, reportes      │
└──────────────────────────┬──────────────────────────────────┘
                           │ /api/*  (proxy)
┌──────────────────────────▼──────────────────────────────────┐
│  API REST  (Express)             http://localhost:3002       │
│  — almacen / bodega / ventas / auth / sync                   │
└──────────┬────────────────────────────────┬─────────────────┘
           │                                │
┌──────────▼──────────┐        ┌────────────▼────────────────┐
│  SQL Server 2014    │        │  SQLite  (lacasita.db)       │
│  NovaCaja           │        │  — almacen_movimientos       │
│  — VArticulosUnif.  │        │  — merma_registros           │
│  — ArticulosAlmacen │        │  — ventas / surtido / ...    │
└─────────────────────┘        └─────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  PWA Zebra TC52  (React/Vite)    http://<IP-LOCAL>:3003      │
│  — Recepción, Salida, Merma, Búsqueda, Historial             │
└─────────────────────────────────────────────────────────────┘
```

---

## Requisitos previos

- **Node.js 18+** instalado
- **SQL Server 2014** con NovaCaja accesible en red
- Credenciales de MSSQL disponibles
- Carpeta `lacasitadeli-almacen/pwa-bodega` junto a este repo (misma carpeta padre)

---

## Instalación desde cero

### 1. Clonar / copiar el proyecto

El directorio padre debe contener ambas carpetas:
```
Desktop/
├── lacasitadeli-admin/        ← este repo
└── lacasitadeli-almacen/
    └── pwa-bodega/            ← app del Zebra TC52
```

### 2. Instalar dependencias

Abrir terminal en `lacasitadeli-admin/` y ejecutar:

```bat
cd apps\api
npm install

cd ..\..\apps\web
npm install
```

Para la PWA del TC52:
```bat
cd ..\..\lacasitadeli-almacen\pwa-bodega
npm install
```

### 3. Configurar base de datos

Crear el archivo `apps/api/.env` con las credenciales de NovaCaja:

```env
DB_SERVER=192.168.x.x
DB_USER=usuario
DB_PASSWORD=contraseña
DB_DATABASE=compucaja
```

> Si no existe el `.env`, al ejecutar `iniciar.bat` se abre el asistente de configuración automáticamente.

---

## Uso diario (desarrollo / pruebas)

Doble clic en **`iniciar.bat`** — levanta los 3 servicios con ventana de terminal visible.

```
Panel admin  →  http://localhost:3001          (se abre solo en el navegador)
API          →  http://localhost:3002
TC52 (WiFi)  →  http://<IP-LOCAL>:3003
TC52 (VPN)   →  http://<IP-TAILSCALE>:3003     (si está conectado)
```

---

## Configurar inicio automático 24/7

**Ejecutar una sola vez** al instalar el sistema en el equipo del cliente.

```bat
configurar-inicio.bat
```

Esto hace en ~4 minutos:
1. Instala **PM2** (gestor de procesos en segundo plano)
2. Compila el panel web (Next.js producción — más rápido y estable)
3. Compila la PWA del TC52 con la IP de red del equipo
4. Arranca los 3 servicios vía PM2
5. Coloca un script en la carpeta **Startup de Windows** → desde ese momento el sistema arranca solo al iniciar sesión, sin ventana de terminal

> Si la IP de red del equipo cambia, volver a ejecutar `configurar-inicio.bat`.

---

## Comandos manuales (terminal)

### Ver estado de los servicios
```bash
pm2 status
```

### Ver logs en vivo
```bash
pm2 logs                    # todos
pm2 logs lacasita-api       # solo la API
pm2 logs lacasita-web       # solo el panel
pm2 logs lacasita-pwa       # solo la PWA TC52
```

### Reiniciar servicios
```bash
pm2 restart all             # reiniciar todo
pm2 restart lacasita-api    # reiniciar solo la API
pm2 restart lacasita-web    # reiniciar solo el panel
```

### Detener todo
```bash
pm2 stop all
# o doble clic en detener.bat
```

### Volver a iniciar después de detener
```bash
pm2 resurrect
# o doble clic en iniciar.bat (modo desarrollo)
```

### Ver los últimos errores
```bash
pm2 logs --err --lines 50
```

### Forzar recompilación del panel web
```bat
cd apps\web
npm run build
cd ..\..
pm2 restart lacasita-web
```

### Forzar recompilación de la PWA TC52
```bat
cd ..\lacasitadeli-almacen\pwa-bodega
npm run build
cd ..\..\lacasitadeli-admin
pm2 restart lacasita-pwa
```

---

## Archivos importantes

| Archivo | Para qué sirve |
|---|---|
| `iniciar.bat` | Arranque manual con terminal visible (desarrollo) |
| `configurar-inicio.bat` | Instalación del inicio automático (correr una vez) |
| `detener.bat` | Detener todos los servicios |
| `arrancar.vbs` | Script silencioso que PM2 usa al iniciar Windows |
| `ecosystem.config.js` | Configuración de los 3 procesos en PM2 |
| `apps/pwa-server.js` | Servidor estático para la PWA compilada (puerto 3003) |
| `apps/api/.env` | Credenciales de SQL Server (no subir a git) |
| `apps/api/lacasita.db` | Base de datos SQLite local (movimientos, mermas, ventas) |
| `logs/api.log` | Log de la API en producción |
| `logs/web.log` | Log del panel web en producción |
| `logs/pwa.log` | Log de la PWA TC52 en producción |

---

## Estructura del proyecto

```
lacasitadeli-admin/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── db/index.js          # SQLite + tablas
│   │   │   ├── db/mssql.js          # Conexión SQL Server
│   │   │   ├── modules/
│   │   │   │   ├── almacen.js       # Bodega TC52 (entrada/salida/merma)
│   │   │   │   ├── bodega.js        # Caducidades, surtido, recuentos
│   │   │   │   ├── ventas.js        # Sincronización ventas NovaCaja
│   │   │   │   └── ...
│   │   │   └── index.js             # Express server :3002
│   │   └── lacasita.db              # Base de datos SQLite
│   │
│   ├── web/
│   │   └── app/
│   │       ├── tabs/
│   │       │   ├── BodegaTab.tsx    # Control de bodega
│   │       │   ├── InventarioTab.tsx
│   │       │   ├── VentasTab.tsx
│   │       │   └── ...
│   │       └── ...                  # Next.js :3001
│   │
│   └── pwa-server.js                # Servidor estático PWA :3003
│
├── ecosystem.config.js              # Configuración PM2
├── iniciar.bat                      # Arranque desarrollo
├── configurar-inicio.bat            # Setup producción 24/7
├── detener.bat                      # Detener todo
└── arrancar.vbs                     # Launcher silencioso (Startup Windows)
```

---

## Módulos del panel admin

| Módulo | Descripción |
|---|---|
| **Dashboard** | Ventas del día, stock bajo, movimientos recientes |
| **Inventario** | Búsqueda de productos, existencias NovaCaja |
| **Ventas** | Corte del día, historial, sincronización con NovaCaja |
| **Bodega** | Áreas, merma/caducidad, surtido, discrepancias, conteo, Zebra TC52 |
| **Configuración** | Productos especiales, categorías, sobreescritura de imágenes |

### Sub-módulo Zebra TC52 (en Bodega)
Vista en el panel admin que muestra en tiempo real los movimientos registrados desde el dispositivo:
- Historial de entradas y salidas del día
- Mermas registradas (vencimiento, daño, cocina, robo, otro)

---

## Zebra TC52 — App de bodega

URL: `http://<IP-LOCAL>:3003` — abrir en Chrome del TC52.

| Sección | Función |
|---|---|
| **Recepción** | Escanear y registrar entrada de mercancía (+stock en NovaCaja) |
| **Salida** | Escanear y registrar salida de mercancía (−stock en NovaCaja) |
| **Merma** | Dar de baja producto con motivo (vencimiento/daño/cocina/robo) |
| **Historial** | Ver movimientos del día |
| **Buscar** | Consultar existencia por nombre o código |

---

## Licencia

Proyecto privado — propiedad de La Casita Deli. Desarrollado por Konekt. Uso interno únicamente.
