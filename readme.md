# La Casita — Panel de Administración

Sistema de administración interno para La Casita: gestión de productos, categorías, ubicaciones, usuarios y corte diario de ventas.

Desarrollado por **Konekt** como parte del sistema integral de inventarios y ventas.

![Status](https://img.shields.io/badge/Status-En%20Desarrollo-yellow)
![Python](https://img.shields.io/badge/Python-3.11+-blue)
![SQLite](https://img.shields.io/badge/DB-SQLite-lightgrey)

---

## 📖 Tabla de Contenidos
- [¿Qué es este repo?](#-qué-es-este-repo)
- [Arquitectura](#-arquitectura)
- [Estructura del Proyecto](#-estructura-del-proyecto)
- [Instalación y Uso](#-instalación-y-uso)
- [Módulos del Panel Admin](#-módulos-del-panel-admin)
- [Usuarios de prueba](#-usuarios-de-prueba)
- [Roadmap](#-roadmap)

---

## 🧭 ¿Qué es este repo?

Este repositorio contiene el sistema operativo de La Casita: un **POS (Punto de Venta)** para cajeros y un **Panel de Administración** para gestión interna. Ambos corren como archivos HTML estáticos servidos por un backend Python/Flask con base de datos SQLite.

| Interfaz | URL | Acceso |
|----------|-----|--------|
| POS — Punto de Venta | `http://localhost:3001/` | Cajeros |
| Admin — Panel de gestión | `http://localhost:3001/admin.html` | Solo administradores |

---

## 🏗 Arquitectura

Arquitectura simple y sin dependencias externas. Todo corre localmente con Python y SQLite.

```
┌─────────────────────────────────────────┐
│           Navegador (Frontend)          │
│                                         │
│  index.html  ←──── POS / Cajeros        │
│  admin.html  ←──── Panel Admin          │
└────────────────────┬────────────────────┘
                     │ HTTP / REST API
┌────────────────────▼────────────────────┐
│         Python / Flask (server.py)      │
│                                         │
│  /api/auth        /api/products         │
│  /api/sales       /api/sessions         │
│  /api/locations   /api/admin/*          │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│           SQLite (lacasita.db)          │
│                                         │
│  User · Location · Category · Product  │
│  Inventory · Sale · SaleItem           │
│  CashSession                           │
└─────────────────────────────────────────┘
```

---

## 📂 Estructura del Proyecto

```text
lacasitadeli-konekt-admin/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── db/
│   │       │   └── lacasita.db          # Base de datos SQLite
│   │       ├── modules/
│   │       │   ├── auth.js              # Login y ubicaciones
│   │       │   ├── products.js          # Consulta de productos e inventario
│   │       │   ├── sales.js             # Registro y reporte de ventas
│   │       │   └── sessions.js          # Control de caja (apertura/cierre)
│   │       ├── index.js                 # Servidor Node (legacy)
│   │       └── server.py                # Servidor principal Python/Flask ✅
│   │
│   └── web/
│       └── public/
│           ├── index.html               # POS — Punto de Venta (cajeros)
│           └── admin.html               # Panel de Administración
│
├── infra/
│   └── docker-compose.yml               # Opcional: n8n para automatizaciones
│
├── iniciar.sh                           # Arranque rápido (Linux/Mac)
├── iniciar.bat                          # Arranque rápido (Windows)
└── README.md
```

---

## 🚀 Instalación y Uso

### Requisitos
- Python 3.11+
- Flask (`pip install flask`)

### Arranque rápido

**Linux / Mac:**
```bash
chmod +x iniciar.sh
./iniciar.sh
```

**Windows:**
```bat
iniciar.bat
```

El script verifica Python, instala Flask si no está, e inicia el servidor en `http://localhost:3001`.

### Arranque manual
```bash
cd apps/api/src
python3 server.py
```

---

## 🧩 Módulos del Panel Admin

Accesible en `http://localhost:3001/admin.html` — solo para cuentas con rol `admin`.

| Módulo | Descripción |
|--------|-------------|
| 📊 **Dashboard** | Métricas del día: ventas, ingresos, ganancia estimada, ticket promedio, top productos y alertas de stock bajo |
| 📦 **Productos** | Alta, edición y baja de productos con código de barras, precio, costo, categoría y unidad |
| 🏷️ **Categorías** | Gestión de categorías con color personalizado (se refleja en el POS) |
| 📍 **Ubicaciones** | Alta de sucursales, almacenes, restaurante y ecommerce |
| 👤 **Usuarios** | Gestión de cajeros, bodegueros y administradores con roles y contraseñas |
| 🧾 **Corte del día** | Reporte filtrable por fecha y sucursal: ingresos por método de pago, productos más vendidos y detalle completo de ventas |

---

## 👤 Usuarios de prueba

| Correo | Contraseña | Rol |
|--------|------------|-----|
| `admin@lacasita.com` | `admin123` | Administrador |
| `cajero1@lacasita.com` | `cajero123` | Cajero |
| `cajero2@lacasita.com` | `cajero123` | Cajero |

---

## 🗺 Roadmap

- [x] **Fase 0** — POS base: cobro, carrito, sesión de caja, inventario y reportes
- [x] **Fase 0.5** — Panel admin: CRUD de productos, categorías, ubicaciones y usuarios
- [ ] **Fase 1** — Rutas `/api/admin/*` en backend: guardar, editar y eliminar desde el panel
- [ ] **Fase 1.5** — Control de inventario: entradas desde bodega, salidas por sucursal
- [ ] **Fase 2** — Integración con Shopify: sincronización de stock en tiempo real
- [ ] **Fase 2.5** — Integración con NOVACAJA: ventas físicas descuentan inventario central
- [ ] **Fase 3** — Control de consumos en restaurante/bar
- [ ] **Fase 3.5** — Alertas de stock bajo y caducidades vía n8n
- [ ] **Fase 4** — Reportes consolidados multi-canal (tienda, ecommerce, restaurante)

---

## 🔗 Repositorio

[github.com/PlekDev/lacasitadeli-konekt-admin](https://github.com/PlekDev/lacasitadeli-konekt-admin)

---

## 📄 Licencia

Proyecto privado — propiedad de La Casita. Desarrollado por Konekt. Uso interno únicamente.