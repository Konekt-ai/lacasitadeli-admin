# Guion de demo — Recepción por cajas con el TC52

Demostración del flujo: **factura/orden → recibir por CAJAS escaneando con el TC52 → el stock sube por piezas** (sin contar pieza por pieza).

## 1. Arrancar el sistema

Doble clic en **`iniciar.bat`**. Levanta:
- **API** → http://localhost:3002
- **Panel admin** → http://localhost:3001
- **TC52 Bodega (PWA)** → http://localhost:3003 (en el TC52 real: `http://<IP-de-esta-PC>:3003`)

> Si quieres una orden de prueba fresca antes de empezar:
> `node apps\api\_seed_demo.js`  (crea/repone la orden **DEMO-FACTURA-001**)

## 2. Datos de prueba ya cargados

**Orden:** `DEMO-FACTURA-001` — proveedor **DEMO TRAILER** — **19 cajas = 396 piezas**

| Código de barras | Producto | Cajas | Pzas/caja | Piezas |
|---|---|---|---|---|
| `019836200218` | BOING DURAZNO 500ML | 5 | 24 | 120 |
| `019836103069` | BOING UVA 500ML | 3 | 24 | 72 |
| `019836103052` | BOING MANZANA 500ML | 2 | 24 | 48 |
| `021136010534` | AGUA MINERAL TOPO CHICO 340ML | 4 | 24 | 96 |
| `019900003332` | POLVO HORNEAR CLABBER GIRL 624GR | 2 | 12 | 24 |
| `40235972` | DEDOS DE NOVIA GRANDE | 3 | 12 | 36 |

## 3. Guion (lo que se le muestra al cliente)

1. **Panel admin → Bodega → Recepción.** Mostrar la orden `DEMO-FACTURA-001` con las cajas esperadas por producto. (Aquí también se puede crear una orden desde **"Leer PDF"** de una factura.)
2. **TC52 (PWA) → pestaña Recepción.** Aparece la orden `DEMO-FACTURA-001`. Seleccionarla.
3. Por cada producto: **escanear el código** (o escribirlo) y poner el **número de CAJAS** que bajaron del trailer. El sistema convierte caja→pieza automáticamente (ej. 5 cajas × 24 = **120 piezas**). No se cuenta pieza por pieza.
4. Al terminar, **Confirmar**. El stock sube por piezas en el inventario.
5. **Panel admin → Bodega → Discrepancias / Recepción.** Mostrar recibido vs esperado y el stock actualizado.

### Extras que se pueden mostrar
- **Productos nuevos:** si llega algo que no está en el catálogo, en el TC52 (pestaña **Nuevos**) o desde el lector de PDF se registra como *pendiente* y se le asigna su código de barras al escanearlo en bodega.
- **Auto-enlace por nombre:** al leer un PDF, los renglones sin código se enlazan con un clic buscando coincidencias por nombre en el inventario.

## 4. Verificado (prueba técnica ya corrida)

Flujo completo probado end-to-end contra la base de prueba `compucaja`:
recibidas 19 cajas → **+396 piezas** aplicadas al stock; cada producto subió exactamente `cajas × piezas_por_caja`. ✔️

## Notas técnicas
- La PWA del TC52 (`server.js`, 3003) reenvía las rutas de **recepción** y **productos pendientes** a la API admin (3002) vía proxy; el resto (escaneo, stock, ubicaciones) lo resuelve directo contra `inventario_bodega`.
- `_seed_demo.js` es **no destructivo**: solo inserta/repone filas DEMO (proveedor `DEMO TRAILER`, referencia `DEMO-FACTURA-001`).
