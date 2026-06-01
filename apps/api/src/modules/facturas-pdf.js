// ============================================================
// facturas-pdf.js — Lector de facturas PDF (local, sin APIs externas).
//
// Estrategia: extracción por COORDENADAS (no por texto linearizado).
//   1) extractLogicalRows(buffer): agrupa los textos del PDF por 'y' (filas)
//      con tolerancia, conservando 'x' (columnas). pdf-parse expone las
//      coordenadas vía un pagerender propio (usa su pdfjs interno).
//   2) Auto-detección de proveedor por una firma en el texto.
//   3) Plantilla por proveedor: mapea bandas de 'x' a columnas.
//
// Para agregar un proveedor nuevo: añadir una entrada en PLANTILLAS.
// ============================================================

const pdf = require('pdf-parse');

// ── 1) Extracción por coordenadas ─────────────────────────────────────────────
// Devuelve { texto, paginas: [ { num, filas: [ { y, celdas: [{x, s}] } ] } ] }
async function extractLogicalRows(buffer) {
  const paginas = [];
  let textoPlano = '';

  const pagerender = (pageData) => {
    return pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })
      .then((tc) => {
        // Recolectar items con coordenadas
        const items = [];
        for (const it of tc.items) {
          if (!it.str || !it.str.trim()) continue;
          items.push({ x: Math.round(it.transform[4]), y: Math.round(it.transform[5]), s: it.str });
          textoPlano += it.str + ' ';
        }
        // Agrupar por 'y' con tolerancia (filas lógicas): items con |Δy|<=TOL = misma fila
        const TOL = 3;
        items.sort((a, b) => b.y - a.y || a.x - b.x); // arriba->abajo, izq->der
        const filas = [];
        for (const it of items) {
          let fila = filas.find(f => Math.abs(f.y - it.y) <= TOL);
          if (!fila) { fila = { y: it.y, celdas: [] }; filas.push(fila); }
          fila.celdas.push({ x: it.x, s: it.s });
        }
        for (const f of filas) f.celdas.sort((a, b) => a.x - b.x);
        paginas.push({ num: paginas.length + 1, filas });
        textoPlano += '\n';
        return ''; // el texto plano lo armamos aparte
      });
  };

  await pdf(buffer, { pagerender });
  return { texto: textoPlano, paginas };
}

// ── 2) Auto-detección de proveedor ────────────────────────────────────────────
function detectarProveedor(texto) {
  const t = (texto || '').toUpperCase();
  for (const [clave, p] of Object.entries(PLANTILLAS)) {
    if (p.firma.some(f => t.includes(f))) return clave;
  }
  return null;
}

// Helpers de banda de columna
const enBanda = (x, min, max) => x >= min && x <= max;
const celdaEnBanda = (celdas, min, max) =>
  celdas.find(c => enBanda(c.x, min, max));
const celdasDesde = (celdas, min) => celdas.filter(c => c.x >= min);

// ── 3) Plantilla NASSAU CANDY ─────────────────────────────────────────────────
// Bandas de x observadas: qtyOrdered≈46, orderUnit≈58, qtyShipped≈89,
//   backOrd≈136, itemNumber≈196, descripcion≈277 (con precio/unidad/extendido
//   embebidos en la misma celda).
function parseNassau({ texto, paginas }) {
  const RE_PRECIO = /(\d{1,3}(?:,\d{3})*\.\d{2})\s+(CS|BX|EA|LB|DZ|PK|CT)\s+(\d{1,3}(?:,\d{3})*\.\d{2})\s*$/;
  const BOILER = /(ITEM DESCRIPTION|ITEM NUMBER|PACKING LIST|INTEREST CHARGE|Please inspect|ENSURE PROPER|LABELING OF BULK|NASSAU CANDY|FREIGHT TERMS|ORDER PLACED|TOTAL # SOLID|Tot Qty|Comments|MISC\. CHARGES|SALE AMOUNT|HANDLING)/i;

  // Encabezado: proveedor, referencia (# factura), order no, fecha
  const proveedor = 'NASSAU CANDY SOUTHWEST';
  let referencia = null, orderNo = null, fecha = null;
  const headMatch = texto.match(/(\d{2}\/\d{2}\/\d{2})\s+(\d{4,6})\s+\d+ of \d+/); // fecha + invoice no
  if (headMatch) { fecha = headMatch[1]; referencia = headMatch[2]; }
  const ordMatch = texto.match(/\b(\d{6})\s+\d{2}\/\d{2}\/\d{2}\s+\d{10}\b/); // order no + order date + tel
  if (ordMatch) orderNo = ordMatch[1];

  const itemsMap = new Map(); // dedupe por SKU (packing list + invoice son copias)

  for (const pag of paginas) {
    let actual = null; // item en construcción para anexar descripción multi-línea
    for (const fila of pag.filas) {
      const c = fila.celdas;
      const itemCell    = celdaEnBanda(c, 185, 212);
      const esItem      = itemCell && /^\d{4,7}$/.test(itemCell.s.trim());
      const descCells   = celdasDesde(c, 260);
      const descRaw     = descCells.map(d => d.s).join(' ').replace(/\s+/g, ' ').trim();

      if (esItem) {
        const sku        = itemCell.s.trim();
        const qtyOrdC    = celdaEnBanda(c, 38, 53);
        const unitC      = celdaEnBanda(c, 54, 70);
        const qtyShipC   = celdaEnBanda(c, 80, 100);
        const qtyOrdered = qtyOrdC && /^\d+$/.test(qtyOrdC.s.trim()) ? parseInt(qtyOrdC.s, 10) : null;
        const orderUnit  = unitC && /^[A-Z]{2}$/.test(unitC.s.trim()) ? unitC.s.trim() : 'CS';
        const qtyShipped = qtyShipC && /^\d+$/.test(qtyShipC.s.trim()) ? parseInt(qtyShipC.s, 10) : 0;

        // Descripción + precio embebido
        let descripcion = descRaw, unitPrice = null, extended = null;
        const m = descRaw.match(RE_PRECIO);
        if (m) {
          descripcion = descRaw.slice(0, m.index).trim();
          unitPrice = parseFloat(m[1].replace(/,/g, ''));
          extended  = parseFloat(m[3].replace(/,/g, ''));
        }
        actual = {
          sku_proveedor: sku,
          descripcion_proveedor: descripcion,
          unidad: orderUnit,
          cajas_ordenadas: qtyOrdered,
          cajas_enviadas: qtyShipped,
          precio_unitario: unitPrice,
          importe: extended,
        };
        if (!itemsMap.has(sku)) itemsMap.set(sku, actual); // primera copia gana
        else actual = null; // copia duplicada (packing list + invoice): no reanexar descripción
      } else if (actual && descRaw && !BOILER.test(descRaw) && !RE_PRECIO.test(descRaw)
                 && /^[A-Z0-9][A-Z0-9 .,/&'#()-]+$/.test(descRaw) && descRaw.length <= 40) {
        // Continuación de la descripción (2da línea: "18CT-PK6", etc.)
        actual.descripcion_proveedor = (actual.descripcion_proveedor + ' ' + descRaw).trim();
      } else {
        actual = null; // cualquier otra fila corta el anexado
      }
    }
  }

  const items = Array.from(itemsMap.values());
  return { proveedor, referencia: referencia || orderNo, orderNo, fecha, items };
}

// Documentos conocidos que NO son facturas de producto itemizadas (no se importan).
const DOCS_NO_ITEMIZADOS = [
  {
    nombre: 'C&S / Grocers Supply',
    firma: ['GROCERS SUPPLY', 'C&S WHOLESALE', 'CUSTOMER STATEMENT'],
    mensaje: 'Este PDF parece un estado de cuenta de C&S / Grocers Supply (saldos y cargos), no una factura de producto itemizada. No se importa a recepción.',
  },
];

// ── Registro de plantillas ────────────────────────────────────────────────────
const PLANTILLAS = {
  nassau: {
    nombre: 'Nassau Candy Southwest',
    firma: ['NASSAU CANDY'],
    parse: parseNassau,
  },
};

// ── API pública ───────────────────────────────────────────────────────────────
async function parseInvoice(buffer) {
  const datos = await extractLogicalRows(buffer);
  const clave = detectarProveedor(datos.texto);
  if (!clave) {
    // ¿Es un documento conocido pero NO itemizado (estado de cuenta, etc.)?
    const t = (datos.texto || '').toUpperCase();
    const noItemizado = DOCS_NO_ITEMIZADOS.find(d => d.firma.some(f => t.includes(f)));
    if (noItemizado) {
      return { ok: false, error: noItemizado.mensaje, tipo: 'no_itemizado', proveedorDetectado: noItemizado.nombre };
    }
    return { ok: false, error: 'No se reconoció el proveedor del PDF (sin plantilla disponible).', proveedorDetectado: null };
  }
  const result = PLANTILLAS[clave].parse(datos);
  return { ok: true, plantilla: clave, proveedorPlantilla: PLANTILLAS[clave].nombre, ...result };
}

module.exports = { parseInvoice, extractLogicalRows, detectarProveedor, PLANTILLAS };
