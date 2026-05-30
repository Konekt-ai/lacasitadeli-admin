# Instructivo del Sistema — La Casita Deli Admin

Sistema de administración para La Casita Deli. Funciona con dos interfaces:
- **Panel Admin** (app web) — administración, reportes y configuración
- **TC52 PWA** (escáner Zebra en bodega) — operaciones físicas de bodega

---

## INSTALACIÓN MANUAL

> Sigue estos pasos en orden cuando instales el sistema en una computadora nueva.
> No se necesita ningún .bat — todo se hace a mano para evitar problemas con permisos.

---

### Paso 1 — Instalar Node.js

1. Abre el navegador y ve a **https://nodejs.org**
2. Descarga la versión **LTS** (la de la izquierda, más estable)
3. Ejecuta el instalador `.msi`
4. En la pantalla de opciones, deja todo como está y asegúrate de que **"Add to PATH"** esté marcado
5. Termina la instalación y **reinicia la computadora**
6. Para verificar: abre `cmd` y escribe `node --version` — debe mostrar un número (ej. `v20.x.x`)

---

### Paso 2 — Instalar Python

Python es necesario para el ícono de la bandeja del sistema (el que aparece como Discord/WhatsApp).

1. Ve a **https://www.python.org/downloads/**
2. Descarga la versión más reciente (botón amarillo grande "Download Python 3.x.x")
3. Ejecuta el instalador `.exe`
4. **MUY IMPORTANTE:** En la primera pantalla marca la casilla **"Add Python to PATH"** antes de darle a Install
5. Termina la instalación
6. Para verificar: abre `cmd` y escribe `python --version` — debe mostrar `Python 3.x.x`

**Instalar las librerías necesarias** (solo una vez, en `cmd`):

```
pip install pystray pillow
```

Espera a que descargue e instale. No debe haber errores rojos.

---

### Paso 3 — Instalar las dependencias del proyecto

Abre `cmd` (no necesitas admin), navega a la carpeta del proyecto y corre:

```
cd C:\Users\TU_USUARIO\Desktop\lacasitadeli-admin\apps\api
npm install
```

Espera a que termine (descarga paquetes, puede tardar 1-2 minutos). Luego:

```
cd C:\Users\TU_USUARIO\Desktop\lacasitadeli-admin\apps\web
npm install
```

Este tarda más (~3-5 minutos). Cuando termine no debe haber errores rojos.

---

### Paso 3 — Crear el archivo de conexión (.env)

El sistema necesita saber cómo conectarse a SQL Server. Este archivo se crea a mano:

1. Abre el **Explorador de archivos** y navega a: `lacasitadeli-admin\apps\api\`
2. Haz clic derecho → **Nuevo → Documento de texto**
3. Nómbralo exactamente: `.env` (con el punto adelante, sin extensión .txt)
   - Si Windows no deja poner solo `.env`, créalo como `.env.txt` y luego quítale el `.txt` desde Renombrar
4. Ábrelo con Notepad y escribe exactamente esto (cambiando los datos del SQL Server):

```
MSSQL_SERVER=192.168.1.XX
MSSQL_DATABASE=compucaja
MSSQL_USER=sa
MSSQL_PASSWORD=TuContraseña
MSSQL_PORT=1433
```

- `MSSQL_SERVER` → la IP de la computadora donde está SQL Server (ej. `192.168.1.68` o `localhost` si es la misma máquina)
- `MSSQL_PASSWORD` → la contraseña del usuario `sa` de SQL Server

5. Guarda y cierra el archivo

---

### Paso 4 — Crear las tablas en SQL Server

Solo se hace una vez por instalación.

1. Abre **SQL Server Management Studio (SSMS)**
2. Conéctate al servidor `compucaja`
3. En el menú: **Archivo → Abrir → Archivo...**
4. Navega a la carpeta del proyecto y abre: `crear_tablas.sql`
5. Presiona **F5** o el botón **Ejecutar**
6. Debe decir "Comandos completados correctamente" (o similar) sin errores rojos

---

### Paso 5 — Instalar Tailscale (para el TC52 por VPN)

Solo necesario si el escáner Zebra TC52 se conecta desde otra red.

1. Ve a **https://tailscale.com/download/windows**
2. Descarga e instala el cliente para Windows
3. Al abrir Tailscale te pedirá iniciar sesión — usa la cuenta del negocio
4. Una vez conectado aparecerá un ícono en la bandeja del sistema (la barra de tareas)

---

### Paso 6 — Configurar inicio automático con Windows

Para que el servidor arranque solo cada vez que enciendas la computadora:

1. Presiona **Win + R** y escribe: `shell:startup` → Enter
2. Se abre una carpeta. Copia aquí el archivo **`iniciar-silencioso.vbs`** del proyecto
3. Listo. La próxima vez que inicies sesión en Windows, el servidor arrancará solo

> El ícono verde en la bandeja del sistema (esquina inferior derecha, flechita `^`) indica que el servidor está activo.
> Haz doble clic en el ícono para abrir el panel. Clic derecho para ver opciones.

---

### Paso 7 — Instalar el sistema de bodega (TC52 Zebra)

El sistema de bodega es un proyecto separado en la carpeta `lacasitadeli-almacen`.

**Instalar dependencias** (solo la primera vez, en `cmd`):

```
cd C:\Users\TU_USUARIO\Desktop\lacasitadeli-almacen\pwa-bodega
npm install
```

**Construir el sistema** (solo la primera vez, en la misma carpeta):

```
npm run build
```

Esto genera la carpeta `dist/` que el servidor necesita. Tarda ~1 minuto.

> Este paso solo se hace UNA VEZ por instalación. El sistema usa rutas relativas, así que
> funciona en cualquier computadora sin tener que cambiar ninguna IP manualmente.

---

### Paso 8 — Prueba de funcionamiento

Antes de configurar el inicio automático, verifica que todo funciona:

1. Doble clic en **`iniciar.bat`** (en la carpeta `lacasitadeli-admin`)
2. Se abren dos ventanas: una para la API y otra para el panel web
3. Espera ~30 segundos — el navegador debe abrirse en `http://localhost:3001`
4. Si el panel carga correctamente, el sistema está bien instalado
5. Para verificar la bodega: abre `http://localhost:3003` en el navegador
6. Cierra la ventana principal del bat para detener todo

---

## Uso diario

Para el día a día **no uses el bat**. El sistema arranca solo con Windows gracias al VBS.
Si por alguna razón necesitas iniciarlo a mano: doble clic en **`iniciar-silencioso.vbs`**.

El ícono en la bandeja del sistema funciona igual que Discord o WhatsApp Web:
- **Verde** → servidor activo
- **Rojo** → servidor detenido (con notificación)
- **Doble clic** → abre el panel en el navegador
- **Clic derecho** → opciones: abrir panel, ver logs, detener servidor

---

## Navegación principal

El menú superior tiene 7 secciones. Cada una se describe abajo.

---

## 1. Dashboard

**Para qué sirve:** Vista rápida del desempeño del negocio.

**Qué muestra:**
- Tarjetas con KPIs del período seleccionado: número de tickets, total de ventas, costo total, ganancia estimada
- Gráfica de barras con los top 10 productos más vendidos y su margen
- Últimos 10 tickets del día (se actualiza automáticamente cada 30 segundos)

**Cómo usarlo:**
1. Usa los filtros de período (Hoy / Semana / Mes) en la barra superior para cambiar el rango
2. El panel de tickets recientes no requiere acción — se refresca solo
3. Si ves el badge rojo en el tab "Alertas" hay productos con stock bajo

---

## 2. Inventario

**Para qué sirve:** Ver y editar todos los productos del catálogo de NovaCaja.

**Qué muestra:**
- Tabla con nombre, categoría, precio de venta, costo, stock actual y área asignada
- Badge de color por área (esmeralda = bodega, azul = Casita 1, morado = Casita 2, ámbar = USA, naranja = cocina, cyan = refrigerador)
- Badge rojo si el stock está por debajo del mínimo configurado

**Qué puedes editar** (clic en el ícono de lápiz de cada producto):
- Precio de venta
- Stock mínimo (para alertas)
- Imagen del producto (URL)
- Si aparece visible en pedidos web

**Nota:** El costo y el stock real vienen de NovaCaja y son solo lectura aquí.

---

## 3. Análisis

**Para qué sirve:** Entender patrones de venta a lo largo del tiempo.

**Qué incluye:**

| Sección | Descripción |
|---|---|
| Volumen por Hora del Día | Gráfica de barras — a qué horas se vende más |
| Mapa de Calor Producto × Hora | Qué producto específico se vende en qué horario |
| Volumen Mensual | Tendencia de ventas mes a mes |
| Productos por Mes | Qué productos subieron o bajaron en los últimos meses |

**Cómo usarlo:**
- Cambia el rango con el selector de meses (1, 3, 6, 12 meses)
- En el mapa de calor puedes seleccionar productos específicos para comparar
- Alterna entre "Unidades vendidas" e "Ingresos ($)" con el toggle

---

## 4. Reportes

**Para qué sirve:** Ver el detalle financiero de ventas por período y los tickets en vivo.

**Secciones:**

**Póliza de Ventas**
- Lista de todos los tickets con folio, total, costo y ganancia estimada
- Resumen en tarjetas: total de ventas, costo, ganancia, número de tickets
- Botón "Exportar Excel" para bajar el reporte completo

**Tickets en Vivo**
- Los últimos 50 tickets abiertos en caja, actualizados cada 30 segundos
- Útil para monitorear la operación en tiempo real

**Cómo exportar:**
1. Selecciona el período con el filtro superior
2. Clic en "Exportar Excel"
3. Se descarga un `.xlsx` con todos los tickets del período

---

## 5. Alertas

**Para qué sirve:** Detectar problemas de inventario antes de que afecten la operación.

**Categorías de alerta:**

| Alerta | Qué significa |
|---|---|
| Stock bajo | El producto tiene menos unidades que el mínimo configurado |
| Próximos a vencer | Productos con fecha de caducidad en los próximos 7 días |
| Vencidos | Productos ya caducados |
| Inventario estancado | Stock disponible sin ventas en 30+ días |
| Sin ventas este mes | Tienen stock pero no se han vendido en el mes actual |

**Cómo usarlo:**
- Cada categoría se expande con clic
- En "Stock bajo" puedes ajustar el stock mínimo directamente desde aquí
- Los productos estancados se pueden descartar individualmente (para que no sigan apareciendo)

---

## 6. Proveedores

**Para qué sirve:** Ver qué proveedores surtieron más y qué productos compraste a cada uno.

**Qué muestra:**
- Lista de proveedores ordenada por compras acumuladas en el período
- Al hacer clic en un proveedor: lista de productos comprados, cantidad y total

**Agregar proveedor manualmente:**
1. Clic en "Agregar Proveedor"
2. Llena nombre, RFC, teléfono, domicilio
3. Clic en Guardar

**Exportar a Excel:**
- Botón en la esquina — genera un `.xlsx` con todos los proveedores y sus datos de compra

---

## 7. Bodega

Esta sección es el corazón del control interno. Tiene 9 sub-vistas accesibles con las pestañas horizontales.

---

### 7.1 Ubicaciones

**Para qué sirve:** Ver el resumen de cuántas unidades hay en cada área según los movimientos registrados en el TC52.

**Áreas del sistema:**

| Área | Color | Descripción |
|---|---|---|
| Bodega | Esmeralda | Almacén principal |
| Casita 1 | Azul | Tienda sucursal 1 |
| Casita 2 | Morado | Tienda sucursal 2 |
| USA | Ámbar | Mercancía que llega desde Estados Unidos |
| Cocina | Naranja | Área de preparación |
| Refrigerador | Cyan | Productos fríos |

**Nota:** Estos datos vienen de los movimientos físicos escaneados en el TC52, no del sistema de caja.

---

### 7.2 Recepción

**Para qué sirve:** Controlar la llegada de mercancía desde un proveedor. El admin crea el pedido con lo que se espera recibir; el operador de bodega lo recibe con el TC52 escaneando cada producto.

**Flujo completo:**

**Desde el Admin (esta app):**
1. Clic en "Nuevo Pedido"
2. Ingresa proveedor, fecha esperada y agrega los artículos con la cantidad esperada
3. Guarda — se genera un folio tipo `REC-20260101-0001`
4. El pedido aparece en estado **Pendiente**

**Desde el TC52 (en bodega):**
1. El operador abre la app del TC52
2. Selecciona el pedido que va a recibir
3. Escanea cada artículo que llega — el sistema registra la cantidad recibida
4. Al terminar, el pedido cambia a estado **En Recepción**

**De vuelta en el Admin:**
1. Abre el pedido para ver el detalle
2. Revisa la tabla de diferencias (esperado vs. recibido)
3. Si todo está bien, clic en "Cerrar Pedido"

**Estados del pedido:**

| Estado | Significado |
|---|---|
| Pendiente | Creado, aún no llega mercancía |
| En Recepción | El TC52 ya registró al menos un artículo |
| Cerrado | Recepción finalizada y verificada |
| Cancelado | Se anuló el pedido |

---

### 7.3 Asignar Áreas

**Para qué sirve:** Ver qué productos están asignados a cada área y reasignarlos si es necesario.

**Cómo funciona:**
- Selecciona un área en el panel izquierdo (Bodega, Casita 1, Casita 2, USA, Cocina, etc.)
- Ve la lista de productos asignados a esa área
- Para mover un producto: selecciónalo → elige área destino → Confirmar

**Nota:** "Bodega" muestra automáticamente todos los productos que no están asignados explícitamente a otra área.

---

### 7.4 Merma / Caducidad

**Para qué sirve:** Registrar productos vencidos o dañados y llevar estadísticas de pérdidas.

**Secciones:**

**Registro de Caducidad (parte de arriba)**
- Lista de productos con fecha de caducidad registrada
- Chips de color: Vencido (rojo), Crítico 7 días (naranja), Aviso 30 días (amarillo), En orden (verde)
- Botón "Enviar Alerta por Correo" — manda los vencidos y críticos al correo configurado

**Agregar registro:**
1. Clic en "Registrar Caducidad"
2. Ingresa código, nombre, fecha de caducidad, cantidad y área
3. Guardar

**Estadísticas de Merma (panel colapsable)**
- Selector de mes (por defecto el mes actual)
- Tarjetas: unidades perdidas totales + número de incidencias
- Barras horizontales por motivo: vencimiento, daño, cocina, robo, otro (con % del total)
- Tabla de top productos con más merma

**Historial TC52 (parte de abajo)**
- Lista de mermas registradas desde el escáner Zebra
- Filtro por fecha
- Botón de descarga (ícono flechita) — exporta a Excel con 3 hojas:
  - **Merma**: historial completo con todos los campos
  - **Por Motivo**: resumen con porcentaje del total
  - **Top Productos**: ranking de los que más merma generan

---

### 7.5 Surtido

**Para qué sirve:** Controlar qué materia prima o producto se manda de bodega a otra área (cocina, Casita 1, Casita 2, etc.) y registrar el consumo en cada área.

**Panel superior — Stock físico por área**

Muestra cuántas unidades tiene actualmente cada área no-bodega, basado en todos los surtidos autorizados menos los consumos registrados.

- Tabs de colores: selecciona el área que quieres ver (Casita 1, Casita 2, Cocina, Refrigerador, USA)
- Tabla con cada producto y sus unidades actuales en esa área
- Botón **Registrar Consumo** (naranja): para cuando cocina usa ingredientes

**Historial de Surtidos (parte de abajo)**

Log de todas las transferencias entre áreas, agrupadas por semana.

**Registrar un nuevo surtido:**
1. Clic en "Nuevo Surtido"
2. Ingresa código del producto, cantidad, área de origen y área destino
3. Clic en "Registrar" — queda como **pendiente de autorización**
4. Cuando se confirme que salió de bodega: clic en "Autorizar"

---

### 7.6 Discrepancias

**Para qué sirve:** Ver productos que podrían representar pérdidas o ineficiencias.

**Secciones:**

**Inventario Estancado** — productos con stock en NovaCaja pero sin ventas en 30+ días

**Sin Ventas Este Mes** — productos con stock que no han tenido venta en el mes actual

**Reporte Mensual por Correo:**
- Botón "Enviar Reporte Ahora" — manda un correo con el resumen completo de alertas
- El reporte también se envía automáticamente el **día 1 de cada mes a las 8:00 AM**

---

### 7.7 Conteo Ventas

**Para qué sirve:** Sincronizar las ventas registradas en NovaCaja con el inventario de bodega.

**Cómo funciona:**
1. Selecciona el rango de fechas de las ventas a sincronizar
2. Clic en "Contar Ventas" — calcula cuántas unidades se vendieron por producto
3. Revisa la tabla
4. Clic en "Aplicar Deducción" — descuenta esas cantidades del inventario

---

### 7.8 Movimientos TC52

**Para qué sirve:** Ver el historial unificado de todo lo que se hizo desde el escáner Zebra en bodega.

**Tipos de movimiento:**

| Tipo | Descripción |
|---|---|
| ↓ Entrada | Mercancía recibida (llega de USA o proveedor) |
| ↑ Salida | Producto sacado de bodega hacia tienda |
| Merma | Producto dado de baja por daño, vencimiento, robo u otro motivo |
| ↔ Traslado | Movimiento entre áreas (ej. Bodega → Casita 1) |

Filtros por tipo y por fecha. Cada registro muestra: producto, cantidad, área, stock antes y después, hora y usuario.

---

### 7.9 Configurar Áreas

**Para qué sirve:** Crear, editar o eliminar las áreas de bodega del sistema. Los cambios se reflejan en el TC52 automáticamente.

**Crear un área nueva:**
1. Clic en "Nueva Área"
2. Ingresa la clave (sin espacios, ej: `freezer`), nombre visible (ej: `Congelador`)
3. Elige un ícono de la paleta
4. Elige un color
5. Guardar

---

## TC52 — App del Escáner Zebra (Bodega)

Aplicación instalada en el escáner de mano. Se abre desde el navegador del dispositivo.

### Pantallas disponibles:

**Recepción de Mercancía**
1. Muestra los pedidos abiertos con barra de progreso
2. Selecciona el pedido a recibir (o entrada libre sin pedido)
3. Escanea el código de barras del producto
4. Confirma la cantidad recibida
5. Opcionalmente asigna una ubicación (Bodega, Casita 1, Casita 2, USA, Cocina, Refrigerador)

**Registro de Merma**
1. Escanea el producto
2. Ingresa la cantidad
3. Selecciona el motivo: Vencimiento / Daño / Cocina / Robo / Otro
4. Confirmar

**Traslado entre ubicaciones**
1. Escanea el producto
2. Selecciona ubicación de origen y destino
3. Ingresa la cantidad
4. Confirmar

---

## Correo automático mensual

El sistema envía automáticamente el **día 1 de cada mes a las 8:00 AM** un correo a `lacasitadeli2000@gmail.com` con:

- Resumen de productos sin ventas
- Resumen de inventario estancado
- Próximos a vencer / ya vencidos

También puedes enviarlo manualmente desde **Bodega → Discrepancias → Reporte Mensual**.

---

## Resumen rápido — ¿Qué hago cuando...?

| Situación | Dónde ir |
|---|---|
| Quiero ver cuánto vendí hoy | Dashboard |
| Un producto tiene precio incorrecto | Inventario → lápiz del producto |
| Llegó mercancía de USA | TC52 → Entrada → ubicación USA |
| Llegó mercancía de un proveedor | Bodega → Recepción → crear pedido |
| El TC52 recibió mercancía | Bodega → Recepción → abrir pedido → cerrar |
| Cocina usó ingredientes | Bodega → Surtido → Registrar Consumo |
| Se mandó mercancía a Casita 1 o 2 | Bodega → Surtido → Nuevo Surtido → Autorizar |
| Se perdió producto por daño | Bodega → Merma / Caducidad (o TC52 desde bodega) |
| Quiero ver qué tiene Casita 1 ahorita | Bodega → Surtido → tab Casita 1 |
| Un producto ya venció | Bodega → Merma / Caducidad → Registrar Caducidad |
| Quiero exportar las ventas | Reportes → Exportar Excel |
| Quiero saber qué no se vende | Alertas o Bodega → Discrepancias |
| El servidor está rojo en la bandeja | Doble clic en iniciar-silencioso.vbs |

---

*Última actualización: Mayo 2026*
