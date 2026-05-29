# Instructivo del Sistema — La Casita Deli Admin

Sistema de administración para La Casita Deli. Funciona con dos interfaces:
- **Panel Admin** (esta app web) — administración, reportes y configuración
- **TC52 PWA** (escáner Zebra en bodega) — operaciones físicas de bodega

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
- Badge de color por área (azul = bodega, naranja = cocina, verde = tienda, etc.)
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

**Qué muestra:**
- Conteo de unidades por área (bodega, cocina, tienda, refrigerador, etc.)
- Al seleccionar un área: lista de productos con sus cantidades
- Pestaña "Resumen" con totales

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
4. Si hubo problema, puedes cancelarlo

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
- Selecciona un área en el panel izquierdo (Bodega, Cocina, Tienda, etc.)
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

**Para qué sirve:** Controlar qué materia prima o producto se manda de bodega a otra área (cocina, tienda, etc.) y registrar el consumo en cada área.

**Panel superior — Stock físico por área**

Muestra cuántas unidades tiene actualmente cada área no-bodega, basado en todos los surtidos autorizados menos los consumos registrados.

- Tabs de colores: selecciona el área que quieres ver (Cocina, Refrigerador, Tienda, Otro)
- Tabla con cada producto y sus unidades actuales en esa área
- Botón **Registrar Consumo** (naranja): para cuando cocina usa ingredientes
  1. Ingresa el código o selecciona de la lista desplegable
  2. Ingresa la cantidad consumida
  3. Confirmar — el saldo del área se reduce automáticamente

Al fondo del panel: historial de los últimos 10 consumos en esa área.

**Historial de Surtidos (parte de abajo)**

Log de todas las transferencias entre áreas, agrupadas por semana.

**Registrar un nuevo surtido:**
1. Clic en "Nuevo Surtido"
2. Ingresa código del producto, cantidad, área de origen y área destino
3. Clic en "Registrar" — queda como **pendiente de autorización**
4. Cuando se confirme que salió de bodega: clic en "Autorizar"
   - Si el origen es Bodega: descuenta automáticamente del inventario en NovaCaja
   - Actualiza el saldo del área destino en el panel de stock físico

---

### 7.6 Discrepancias

**Para qué sirve:** Ver productos que podrían representar pérdidas o ineficiencias: inventario que no se mueve y ventas que dejaron de llegar.

**Secciones:**

**Inventario Estancado** — productos con stock en NovaCaja pero sin ventas en 30+ días

**Sin Ventas Este Mes** — productos con stock que no han tenido venta en el mes actual

En ambas listas puedes descartar un producto (ícono X) para que deje de aparecer si ya lo revisaste.

**Historial de Recuentos** — registros de conteos físicos vs. sistema (guardados desde Conteo Ventas)

**Reporte Mensual por Correo:**
- Tarjeta "Último envío" con la fecha del reporte anterior
- Botón "Enviar Reporte Ahora" — manda un correo a `lacasitadeli2000@gmail.com` con el resumen completo de alertas (estancados, sin ventas, caducidades)
- El reporte también se envía automáticamente el **día 1 de cada mes a las 8:00 AM**

---

### 7.7 Conteo Ventas

**Para qué sirve:** Sincronizar las ventas registradas en NovaCaja con el inventario de bodega para mantener el stock actualizado.

**Cómo funciona:**
1. Selecciona el rango de fechas de las ventas a sincronizar
2. Clic en "Contar Ventas" — el sistema consulta NovaCaja y calcula cuántas unidades se vendieron por producto
3. Revisa la tabla de productos con unidades vendidas
4. Si todo está correcto, clic en "Aplicar Deducción" — descuenta esas cantidades del inventario

**Historial de sesiones:** guarda un log de cada sincronización con fecha, productos afectados y total de unidades descontadas.

---

### 7.8 Facturas PDF

> **En desarrollo.** Próximamente disponible.

---

### 7.9 Movimientos TC52

**Para qué sirve:** Ver el historial unificado de todo lo que se hizo desde el escáner Zebra en bodega.

**Tipos de movimiento:**

| Tipo | Descripción |
|---|---|
| ↓ Entrada | Mercancía recibida en bodega |
| ↑ Salida | Producto sacado de bodega |
| Merma | Producto dado de baja por daño, vencimiento, robo u otro motivo |
| ↔ Traslado | Movimiento entre áreas |

**Filtros disponibles:**
- Por tipo de movimiento (todos / entradas / salidas / mermas / traslados)
- Por fecha

Cada registro muestra: producto, cantidad, área, stock antes y después, hora y usuario.

---

### 7.10 Configurar Áreas

**Para qué sirve:** Crear, editar o eliminar las áreas de bodega del sistema. Los cambios se reflejan en el TC52 automáticamente.

**Crear un área nueva:**
1. Clic en "Nueva Área"
2. Ingresa la clave (sin espacios, ej: `freezer`), nombre visible (ej: `Congelador`)
3. Elige un ícono de la paleta
4. Elige un color
5. Guardar

**Editar un área existente:**
- Clic en el ícono de editar sobre el card del área
- Modifica nombre, ícono o color

**Eliminar un área:**
- Clic en el ícono de basura — se desactiva (los productos no se pierden, solo ya no aparece el área)

---

## TC52 — App del Escáner Zebra (Bodega)

Aplicación separada instalada en el escáner de mano. Se abre desde el navegador del dispositivo.

### Pantallas disponibles:

**Recepción de Mercancía**
1. Muestra los pedidos abiertos con barra de progreso (cuánto ya se escaneó vs. esperado)
2. Selecciona el pedido a recibir (o continúa sin orden para entrada libre)
3. Escanea el código de barras del producto
4. Confirma la cantidad recibida
5. Opcionalmente asigna una ubicación al producto
6. El sistema registra la entrada vinculada al pedido

**Registro de Merma**
1. Escanea el producto
2. Ingresa la cantidad
3. Selecciona el motivo: Vencimiento / Daño / Cocina / Robo / Otro
4. Agrega notas opcionales
5. Confirmar

**Salida de Producto**
1. Escanea el código
2. Ingresa la cantidad que sale
3. Confirmar — descuenta del inventario

**Gestión de Ubicaciones**
- Crear nueva área con nombre y color
- Eliminar áreas existentes
- Asignar un producto a una ubicación específica

---

## Correo automático mensual

El sistema envía automáticamente el **día 1 de cada mes a las 8:00 AM** un correo a `lacasitadeli2000@gmail.com` con:

- Resumen de productos sin ventas
- Resumen de inventario estancado
- Próximos a vencer / ya vencidos
- Conteo de unidades y porcentajes

También puedes enviarlo manualmente en cualquier momento desde **Bodega → Discrepancias → Reporte Mensual**.

---

## Resumen rápido — ¿Qué hago cuando...?

| Situación | Dónde ir |
|---|---|
| Quiero ver cuánto vendí hoy | Dashboard |
| Un producto tiene precio incorrecto | Inventario → lápiz del producto |
| Llegó mercancía de un proveedor | Bodega → Recepción → crear pedido |
| El TC52 recibió mercancía | Bodega → Recepción → abrir pedido → cerrar |
| Cocina usó ingredientes | Bodega → Surtido → Registrar Consumo |
| Se mandó mercancía a cocina | Bodega → Surtido → Nuevo Surtido → Autorizar |
| Se perdió producto por daño | Bodega → Merma / Caducidad (o TC52 desde bodega) |
| Quiero ver qué tiene cocina ahorita | Bodega → Surtido → tab Cocina (panel superior) |
| Un producto ya venció | Bodega → Merma / Caducidad → Registrar Caducidad |
| Quiero exportar las ventas | Reportes → Exportar Excel |
| Quiero saber qué no se vende | Alertas o Bodega → Discrepancias |
| Quiero agregar un área nueva (ej: freezer) | Bodega → Configurar Áreas |

---

*Última actualización: Mayo 2026*
