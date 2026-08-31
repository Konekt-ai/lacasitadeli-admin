# La Casita Deli — Sistema de Administración

Sistema interno para La Casita Deli: panel administrativo web, control de bodega con Zebra TC52, y gestión de inventario conectada a NovaCaja (SQL Server).

Desarrollado por **Konekt**.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│  Panel Admin  (Next.js)          http://localhost:3001       │
│  — Dashboard, Inventario, Ventas, Bodega, Alertas, Prov.     │
└──────────────────────────┬──────────────────────────────────┘
                           │ /api/*  (proxy → :3002)
┌──────────────────────────▼──────────────────────────────────┐
│  API REST  (Express)             http://localhost:3002       │
│  — products / sales / novacaja / bodega / almacen / facturas │
└──────────┬────────────────────────────────┬─────────────────┘
           │                                │
┌──────────▼──────────┐        ┌────────────▼────────────────┐
│  SQL Server         │        │  SQLite (lacasita.db)        │
│  (compucaja)        │        │  — almacen_movimientos       │
│  — ArticulosAlmacen │        │  — merma_registros           │
│  — VArticulosUnif.  │        │  — product_expiry            │
│  — Proveedores      │        │  — facturas / pedidos        │
│  — inventario_bodega│        │  en desuso: ubicaciones_     │
│  — ubicaciones_bod. │        │  config, stock_ubicaciones   │
│  — recepciones_*    │        └──────────────────────────────┘
└─────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  PWA Zebra TC52  (React/Vite)    http://<IP-LOCAL>:3003      │
│  — Recepción, Salida, Merma, Búsqueda, Historial             │
└─────────────────────────────────────────────────────────────┘
```

---

## Requisitos previos

- **Node.js 18+** instalado
- **SQL Server 2014** con NovaCaja accesible en red local o VPN (Tailscale)
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
cd apps\api && npm install
cd ..\..\apps\web && npm install
```

Para la PWA del TC52:
```bat
cd ..\..\lacasitadeli-almacen\pwa-bodega && npm install
```

### 3. Configurar variables de entorno

Crear el archivo **`apps/api/.env`** con las credenciales de NovaCaja:

```env
# SQL Server — requerido
MSSQL_SERVER=<IP del servidor>
MSSQL_DATABASE=<nombre de la base de datos>
MSSQL_USER=<usuario SQL>
MSSQL_PASSWORD=<contraseña SQL>
MSSQL_PORT=1433

# Puerto de la API (opcional, default: 3002)
PORT=3002

# Umbral de stock bajo para el dashboard (opcional, default: 5 unidades)
LOW_STOCK_THRESHOLD=5

# Correo para reportes mensuales automáticos (opcional)
# Opción A — Gmail con contraseña de aplicación
EMAIL_USER=<correo@gmail.com>
EMAIL_PASS=<contraseña de aplicación Gmail>

# Opción B — Resend.dev (alternativa a Gmail)
RESEND_API_KEY=<tu API key de Resend>
```

> Si no existe el `.env`, al ejecutar `iniciar.bat` se abre el asistente de configuración automáticamente.

La base de datos SQLite (`apps/api/lacasita.db`) se crea sola al iniciar la API por primera vez.

### 4. Migración de tablas de Recepción (SQL Server)

El flujo de **Recepción con conversión caja→pieza** y **Caducidades** usa tablas propias en SQL Server (`recepciones_esperadas`, `recepciones_reales`, `productos_compra`, el SP `sp_confirmar_recepcion` y vistas). Se crean con una migración **idempotente** (segura de repetir):

```bat
cd apps\api
node migrate.js
```

- Lee `apps/api/.env` y aplica `crear_tablas_recepcion.sql` (en la raíz del repo) por lotes.
- Es **aditiva**: usa `IF NOT EXISTS` / `DROP-CREATE` de objetos propios; **no borra ni altera** tablas de NovaCaja.
- **`actualizar-sistema.bat` la ejecuta automáticamente** en cada actualización, así que en el cliente no hay que correr nada a mano.
- Para correrla desde otra PC (p. ej. tu laptop por Tailscale), apunta `MSSQL_SERVER` del `.env` a la IP correspondiente y ejecuta `node migrate.js`.

---

## Uso diario (desarrollo / pruebas)

Doble clic en **`iniciar.bat`** — levanta los 3 servicios con ventana de terminal visible.

```
Panel admin  →  http://localhost:3001          (se abre solo en el navegador)
API          →  http://localhost:3002
TC52 (WiFi)  →  http://<IP-LOCAL>:3003
TC52 (VPN)   →  http://<IP-TAILSCALE>:3003     (si está conectado a Tailscale)
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
5. Coloca un script en la carpeta **Startup de Windows** → el sistema arranca solo al iniciar sesión, sin ventana de terminal

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
| `actualizar-sistema.bat` | Baja cambios de GitHub (admin + almacén), `npm install`, **corre la migración de BD** y reinicia |
| `apps/api/migrate.js` | Migración idempotente de tablas de recepción en SQL Server |
| `crear_tablas_recepcion.sql` | Esquema de recepción (tablas + SP + vistas) que aplica `migrate.js` |
| `configurar-inicio.bat` | Instalación del inicio automático (correr una vez) |
| `detener.bat` | Detener todos los servicios |
| `arrancar.vbs` | Script silencioso que PM2 usa al iniciar Windows |
| `ecosystem.config.js` | Configuración de los 3 procesos en PM2 |
| `apps/pwa-server.js` | Servidor estático para la PWA compilada (puerto 3003) |
| `apps/api/.env` | Credenciales de SQL Server + email (no subir a git) |
| `apps/api/lacasita.db` | Base de datos SQLite local (movimientos, mermas, pedidos…) |
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
│   │   │   ├── db/
│   │   │   │   ├── index.js         # SQLite + tablas + índices
│   │   │   │   └── mssql.js         # Conexión SQL Server (pool)
│   │   │   ├── config/
│   │   │   │   └── novacaja-mapping.js  # Queries MSSQL reutilizables
│   │   │   ├── modules/
│   │   │   │   ├── almacen.js       # Stock por ubicación (MSSQL), entrada/salida, áreas
│   │   │   │   ├── bodega.js        # Asignación por área, merma, surtido, alertas
│   │   │   │   ├── recepcion.js     # Recepción caja→pieza, discrepancias, caducidades
│   │   │   │   ├── facturas.js      # Facturas de compra
│   │   │   │   ├── novacaja.js      # Dashboard NovaCaja, proveedores, polizas
│   │   │   │   ├── products.js      # Inventario, precios, stock
│   │   │   │   ├── sales.js         # Ventas locales (SQLite)
│   │   │   │   └── emailService.js  # Reporte mensual automático por correo
│   │   │   └── index.js             # Express server :3002 + cron mensual
│   │   ├── migrate.js               # Migración idempotente de tablas de recepción (MSSQL)
│   │   ├── lacasita.db              # Base de datos SQLite (auto-generada)
│   │   └── .env                     # Variables de entorno (no en git)
│   │
│   ├── web/
│   │   └── app/
│   │       ├── tabs/
│   │       │   ├── DashboardTab.tsx    # KPIs del día, ventas, stock bajo
│   │       │   ├── InventarioTab.tsx   # Búsqueda y edición de productos
│   │       │   ├── VentasTab.tsx       # Análisis de ventas NovaCaja
│   │       │   ├── BodegaTab.tsx       # Bodega completa (sub-módulos abajo)
│   │       │   ├── AlertasTab.tsx      # Caducidades, estancados, sin ventas
│   │       │   ├── ProveedoresTab.tsx  # Proveedores, rendimiento, reasignación
│   │       │   └── ReportesTab.tsx     # Pólizas de venta detalladas
│   │       └── ...                     # Next.js :3001
│   │
│   └── pwa-server.js                # Servidor estático PWA :3003
│
├── ecosystem.config.js              # Configuración PM2
├── iniciar.bat                      # Arranque desarrollo
├── actualizar-sistema.bat           # Pull GitHub + npm install + migración BD + reinicio
├── crear_tablas_recepcion.sql       # Esquema de recepción para SQL Server (lo aplica migrate.js)
├── configurar-inicio.bat            # Setup producción 24/7
├── detener.bat                      # Detener todo
└── arrancar.vbs                     # Launcher silencioso (Startup Windows)
```

---

## Módulos del panel admin

| Módulo | Descripción |
|---|---|
| **Dashboard** | Ventas del día, KPIs, stock bajo, movimientos recientes de bodega |
| **Inventario** | Búsqueda de productos NovaCaja, edición de precios y stock |
| **Ventas** | Análisis por periodo, top productos, pólizas de venta |
| **Bodega** | Control de áreas, merma/caducidad, surtido, discrepancias, conteos, TC52 |
| **Alertas** | Productos por caducar, estancados (+30 días sin venta), sin ventas en el mes |
| **Proveedores** | Rendimiento por proveedor, directorio, agregar/eliminar, reasignación |
| **Reportes** | Pólizas diarias detalladas, exportación a Excel |
| **Página web** | Catálogo de Shopify vs inventario: fotos, precios, publicar, crear borradores |
| **Pedidos web** | Pedidos de la tienda en línea (Shopify): al pagar se **apartan** en bodega (baja el disponible, no el físico), se preparan escaneando con la TC52 y al **entregar/enviar** sale físicamente (`movimientos_bodega` motivo `venta_web`). Ventas en línea por periodo, apartados activos y configuración |

### Pedidos web (Shopify → inventario)

- Módulo `apps/api/src/modules/pedidos-web.js` (`/api/pedidos-web`). Baja los pedidos de Shopify cada N min (necesita el permiso **`read_orders`** en la app "Inventario Casita"; opcional `write_merchant_managed_fulfillment_orders` para marcarlos como preparados/enviados en Shopify).
- Stock: **físico** = `inventario_bodega.cantidad` · **apartado** = `reservas_bodega` activas · **disponible** = físico − apartado (vista `v_stock_disponible`). El sync de Shopify empuja el **disponible**, así la web nunca vende lo apartado.
- Estados: `nuevo → preparando → listo → entregado | enviado`, o `cancelado` (libera el apartado si aún no salió). El escaneo de la TC52 solo valida piezas; **no** descuenta. La salida física ocurre al entregar/enviar y queda con stock antes/después y el número de pedido.
- Tablas nuevas (se crean solas): `pedidos_web`, `pedidos_web_lineas`, `pedidos_web_eventos`, `reservas_bodega`, `pedidos_web_config`.

### Sub-módulos de Bodega

| Sub-módulo | Función |
|---|---|
| **Stock & Surtido** | Stock por área (fuente única: SQL Server `inventario_bodega`) + transferencias |
| **Recepción** | Órdenes esperadas **en cajas** → el TC52 confirma → **conversión caja→pieza**, sube stock real, discrepancias y semáforo de caducidad |
| **Áreas** | Áreas/ubicaciones unificadas (Bodega, Casita 1/2, USA, Cocina, Refrigerador) leídas de SQL Server `ubicaciones_bodega`; asignación producto→área |
| **Merma / Caducidad** | Registro de bajas con motivo y área |
| **Caducidades** | Lotes con vencimiento capturado en recepción (semáforo VENCIDO/CRÍTICO/AVISO/OK, selector de días, export a Excel) |
| **Discrepancias** | Diferencias esperado vs recibido por orden |
| **Facturas** | Facturas de compra ligadas a pedidos |
| **Movimientos TC52** | Stock actual por ubicación e historial del día desde el Zebra TC52 |

> **Áreas y ubicaciones** ahora tienen **una sola fuente de verdad en SQL Server**: la lista de áreas en `ubicaciones_bodega` y el stock por ubicación en `inventario_bodega`. Las altas/bajas/edición de áreas ("Configurar Áreas") y las escrituras de entrada/salida/recepción operan todas sobre estas tablas. Las tablas SQLite antiguas (`ubicaciones_config`, `stock_ubicaciones`) quedaron en desuso (no se borraron).

---

## Zebra TC52 — App de bodega

URL: `http://<IP-LOCAL>:3003` — abrir en Chrome del TC52.

| Sección | Función |
|---|---|
| **Recepción** | Elegir orden (o sin orden) → escanear **cajas** → al confirmar en el panel se hace la **conversión caja→pieza** y sube el stock real; captura opcional de **lote y caducidad** |
| **Salida** | Escanear y registrar salida de mercancía (−stock en NovaCaja) |
| **Merma** | Dar de baja producto con motivo (vencimiento/daño/cocina/robo) |
| **Historial** | Ver movimientos del día |
| **Buscar** | Consultar existencia por nombre o código |

---

## Reportes automáticos por correo

El día 1 de cada mes a las 8:00 AM (hora México), la API envía automáticamente un reporte de inventario con:

- Productos estancados (sin venta en 30+ días)
- Productos sin ventas en el mes
- Caducidades próximas o vencidas

Requiere `EMAIL_USER` + `EMAIL_PASS` (Gmail) **o** `RESEND_API_KEY` en el `.env`.

---

## Licencia

Proyecto privado — propiedad de La Casita Deli. Desarrollado por Konekt. Uso interno únicamente.
