// ============================================================================
// resurtido.js — Solicitudes de resurtido (mover mercancía de Bodega a un anaquel).
//
// El botón "Resurtir" del panel (y de la app de inventario de los resurtidores) NO
// mueve stock: crea una SOLICITUD. Quien la ejecuta físicamente es el de bodega con
// la TC52: mueve la mercancía y registra el traslado escaneando. Ese traslado (fila
// 'traslado' en movimientos_bodega, con area = origen y ubicacion = destino) cierra
// la solicitud solo. Así el botón representa una acción real, y el inventario solo
// cambia cuando alguien de verdad movió las piezas.
//
// Tablas nuevas (compucaja.dbo): solicitudes_resurtido, solicitudes_resurtido_eventos.
// Estados: pendiente -> hecha | cancelada.
// ============================================================================
const express = require('express');
const mssql   = require('../db/mssql');

const { sql } = mssql;
const router = express.Router();

const T = {
  sol: '[compucaja].[dbo].[solicitudes_resurtido]',
  ev:  '[compucaja].[dbo].[solicitudes_resurtido_eventos]',
  inv: '[compucaja].[dbo].[inventario_bodega]',
  mov: '[compucaja].[dbo].[movimientos_bodega]',
  cod: '[compucaja].[dbo].[codigos_producto]',
  art: '[compucaja].[dbo].[VArticulosUnificados]',
  ubi: '[compucaja].[dbo].[ubicaciones_bodega]',
  map: '[compucaja].[dbo].[estacion_area_map]',
  res: '[compucaja].[dbo].[reservas_bodega]',
};
const ESTADOS = ['pendiente', 'hecha', 'cancelada'];
const VENTANA_DIAS  = Math.max(3, parseInt(process.env.RESURTIDO_VENTANA_DIAS || '14'));
const OBJETIVO_DIAS = Math.max(1, parseInt(process.env.RESURTIDO_OBJETIVO_DIAS || '7'));

const recorta = (s, n) => (s == null ? null : String(s).slice(0, n));
function bind(req, params) {
  for (const [k, v] of Object.entries(params || {})) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'type' in v) req.input(k, v.type, v.value);
    else req.input(k, v);
  }
  return req;
}
async function q(texto, params, tx) {
  const req = tx ? new sql.Request(tx) : (await mssql.getPool()).request();
  const r = await bind(req, params).query(texto);
  return r.recordset || [];
}
const str = (v, n) => ({ type: sql.VarChar(n), value: recorta(v, n) });
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error('[resurtido]', e.message); res.status(500).json({ error: e.message }); });
const usuarioDe = req => recorta((req.body && req.body.usuario) || req.query.usuario || req.get('x-usuario') || 'panel', 60);

// ── Migración ligera (idempotente, SQL Server 2014) ────────────────────────────
let migrado = false;
async function migrar() {
  if (migrado) return;
  await mssql.query(`
    IF OBJECT_ID('${T.sol}') IS NULL BEGIN
      CREATE TABLE ${T.sol} (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        codigo_barras  VARCHAR(50)  NOT NULL,      -- código BASE (= inventario_bodega / movimientos_bodega)
        codigo_pedido  VARCHAR(50)  NULL,          -- lo que tecleó/escaneó quien pidió (puede ser código de caja)
        nombre         VARCHAR(200) NULL,
        de_ubicacion   VARCHAR(50)  NOT NULL,      -- = movimientos_bodega.area (origen)
        a_ubicacion    VARCHAR(50)  NOT NULL,      -- = movimientos_bodega.ubicacion (destino)
        cantidad       INT          NOT NULL,      -- piezas pedidas
        cantidad_hecha INT          NULL,          -- piezas realmente movidas
        estado         VARCHAR(12)  NOT NULL DEFAULT 'pendiente',
        prioridad      TINYINT      NOT NULL DEFAULT 0,   -- 0 normal, 1 alta
        origen         VARCHAR(20)  NOT NULL DEFAULT 'panel',   -- panel | invetory | tc52
        nota           VARCHAR(300) NULL,
        solicitado_por VARCHAR(60)  NULL,
        hecha_por      VARCHAR(60)  NULL,
        movimiento_id  INT          NULL,          -- movimientos_bodega.id del traslado que la cerró
        stock_origen_al_crear  INT NULL,
        stock_destino_al_crear INT NULL,
        creado         DATETIME     NOT NULL DEFAULT GETDATE(),
        actualizado    DATETIME     NOT NULL DEFAULT GETDATE(),
        hecha_en       DATETIME     NULL,
        cancelada_en   DATETIME     NULL,
        motivo_cancelacion VARCHAR(200) NULL
      );
      CREATE INDEX IX_sol_resurtido_estado ON ${T.sol}(estado, creado);
      CREATE INDEX IX_sol_resurtido_codigo ON ${T.sol}(codigo_barras, estado);
      CREATE UNIQUE INDEX UQ_sol_resurtido_mov ON ${T.sol}(movimiento_id) WHERE movimiento_id IS NOT NULL;
    END;
    IF OBJECT_ID('${T.ev}') IS NULL BEGIN
      CREATE TABLE ${T.ev} (
        id INT IDENTITY(1,1) PRIMARY KEY,
        solicitud_id INT NOT NULL,
        fecha DATETIME NOT NULL DEFAULT GETDATE(),
        tipo VARCHAR(30) NOT NULL,
        de VARCHAR(20) NULL, a VARCHAR(20) NULL,
        usuario VARCHAR(60) NULL, detalle VARCHAR(400) NULL
      );
      CREATE INDEX IX_sol_resurtido_ev ON ${T.ev}(solicitud_id, fecha);
    END;
  `);
  migrado = true;
}

async function evento(id, tipo, { de = null, a = null, usuario = null, detalle = null } = {}, tx) {
  await q(`INSERT INTO ${T.ev} (solicitud_id, tipo, de, a, usuario, detalle) VALUES (@p, @t, @de, @a, @u, @d)`,
    { p: id, t: str(tipo, 30), de: str(de, 20), a: str(a, 20), u: str(usuario, 60), d: str(detalle, 400) }, tx);
}

// Código de caja -> código base + piezas por caja (codigos_producto). Igual que pedidos-web.
async function codigoBase(codigo) {
  const c = String(codigo || '').trim();
  if (!c) return { base: null, unidades: 1 };
  const r = await q(`SELECT TOP 1 codigo_base, unidades FROM ${T.cod} WHERE codigo = @c`, { c: str(c, 50) }).catch(() => []);
  if (r[0] && r[0].codigo_base) return { base: String(r[0].codigo_base).trim(), unidades: Math.max(1, r[0].unidades || 1) };
  return { base: c, unidades: 1 };
}

async function ubicacionesActivas() {
  const r = await q(`SELECT nombre FROM ${T.ubi} WITH (NOLOCK) WHERE activa = 1 ORDER BY orden, nombre`);
  return r.map(x => String(x.nombre).trim());
}

// ── Sugerencia: cuánto mover para que un anaquel aguante OBJETIVO_DIAS ─────────
// venta_diaria = piezas vendidas en la caja de ESA área en los últimos VENTANA_DIAS
// (Tickets+TicketsPS por 4 llaves, caja -> área con estacion_area_map). Sin dinero.
async function sugerencia(codigo, destino, origen = 'Bodega') {
  const rows = await q(`
    SELECT
      ISNULL((SELECT SUM(i.cantidad) FROM ${T.inv} i WITH (NOLOCK) WHERE i.codigo_barras = @c AND i.ubicacion = @o), 0) AS stock_origen,
      (SELECT SUM(i.cantidad) FROM ${T.inv} i WITH (NOLOCK) WHERE i.codigo_barras = @c AND i.ubicacion = @d) AS stock_destino,
      ISNULL((SELECT SUM(r.cantidad) FROM ${T.res} r WITH (NOLOCK) WHERE r.activa = 1 AND r.codigo_barras = @c AND r.ubicacion = @d), 0) AS apartado_destino,
      ISNULL((
        SELECT SUM(ps.Cantidad)
        FROM [compucaja].[dbo].[TicketsPS] ps WITH (NOLOCK)
        JOIN [compucaja].[dbo].[Tickets] t WITH (NOLOCK)
          ON t.FolTda_Codigo = ps.FolTda_Codigo AND t.FolEst_Codigo = ps.FolEst_Codigo
         AND t.FolDoc_Codigo = ps.FolDoc_Codigo AND t.FolConsecutivo = ps.FolConsecutivo
        JOIN ${T.map} m WITH (NOLOCK) ON m.est_codigo = CAST(t.FolEst_Codigo AS VARCHAR(20))
        WHERE ps.Codigo = @c AND m.area = @d AND t.T_Fecha >= DATEADD(DAY, -${VENTANA_DIAS}, GETDATE())
      ), 0) AS vendidas_ventana,
      (SELECT MAX(ps.FechaHora) FROM [compucaja].[dbo].[TicketsPS] ps WITH (NOLOCK) WHERE ps.Codigo = @c) AS ultima_venta,
      (SELECT TOP 1 a.Art_Descripcion FROM ${T.art} a WITH (NOLOCK) WHERE a.Art_Codigo = @c) AS nombre
    OPTION (MAXDOP 1)`, { c: str(codigo, 50), d: str(destino, 50), o: str(origen, 50) });
  const r = rows[0] || {};
  const stockDestino = r.stock_destino == null ? null : Number(r.stock_destino);
  const disponible = Math.max(0, (stockDestino || 0) - Number(r.apartado_destino || 0));
  const ventaDiaria = Number(r.vendidas_ventana || 0) / VENTANA_DIAS;
  const cobertura = ventaDiaria > 0 ? disponible / ventaDiaria : null;
  const sugeridoBruto = Math.max(0, Math.ceil(ventaDiaria * OBJETIVO_DIAS - disponible));
  const stockOrigen = Number(r.stock_origen || 0);
  return {
    codigo, nombre: r.nombre ? String(r.nombre).trim() : null, origen, destino,
    stock_origen: stockOrigen,
    stock_destino: stockDestino,           // null = nunca contado en esa área
    apartado_destino: Number(r.apartado_destino || 0),
    disponible_destino: disponible,
    vendidas_ventana: Number(r.vendidas_ventana || 0), ventana_dias: VENTANA_DIAS,
    venta_diaria: Math.round(ventaDiaria * 100) / 100,
    cobertura_dias: cobertura == null ? null : Math.round(cobertura * 10) / 10,
    ultima_venta: r.ultima_venta || null,
    sugerido: Math.min(sugeridoBruto, stockOrigen),
    sugerido_sin_tope: sugeridoBruto,
    objetivo_dias: OBJETIVO_DIAS,
  };
}

// ── Conciliación: cerrar solicitudes cuyo traslado ya quedó registrado ─────────
// La TC52 (o el admin) escribe en movimientos_bodega una fila 'traslado' con
// codigo_barras = base, area = origen, ubicacion = destino, cantidad = piezas.
// Si es posterior a la solicitud y cubre la cantidad, la solicitud queda hecha.
let conciliando = null;
function conciliar() {
  if (conciliando) return conciliando;
  conciliando = (async () => {
    const cerradas = [];
    const pend = await q(`SELECT id, codigo_barras, de_ubicacion, a_ubicacion, cantidad, creado FROM ${T.sol} WHERE estado = 'pendiente' ORDER BY creado`);
    for (const s of pend) {
      const m = (await q(`
        SELECT TOP 1 m.id, m.cantidad FROM ${T.mov} m WITH (NOLOCK)
        WHERE m.tipo = 'traslado' AND m.codigo_barras = @c AND m.area = @de AND m.ubicacion = @a
          AND m.fecha >= DATEADD(MINUTE, -1, @creado) AND m.cantidad >= @n
          AND NOT EXISTS (SELECT 1 FROM ${T.sol} x WITH (NOLOCK) WHERE x.movimiento_id = m.id)
        ORDER BY m.fecha, m.id OPTION (MAXDOP 1)`,
        { c: str(s.codigo_barras, 50), de: str(s.de_ubicacion, 50), a: str(s.a_ubicacion, 50), creado: s.creado, n: s.cantidad }))[0];
      if (!m) continue;
      const upd = await q(`UPDATE ${T.sol} SET estado = 'hecha', cantidad_hecha = @n, movimiento_id = @m, hecha_por = 'TC52', hecha_en = GETDATE(), actualizado = GETDATE()
                           OUTPUT inserted.id WHERE id = @id AND estado = 'pendiente'`, { id: s.id, n: m.cantidad, m: m.id });
      if (upd.length) {
        await evento(s.id, 'estado', { de: 'pendiente', a: 'hecha', usuario: 'auto', detalle: `Traslado #${m.id} (${m.cantidad} pzas) detectado en movimientos_bodega` });
        cerradas.push(s.id);
      }
    }
    return { ok: true, cerradas };
  })().finally(() => { conciliando = null; });
  return conciliando;
}

// ── Lecturas ───────────────────────────────────────────────────────────────────
const SQL_LISTA = `
  SELECT s.*,
    COALESCE(NULLIF(s.nombre, ''), NULLIF(a.Art_Descripcion, ''), NULLIF(ib.nombre, ''), s.codigo_barras) AS nombre_mostrar,
    ISNULL(so.cantidad, 0) AS stock_origen,
    sd.cantidad AS stock_destino
  FROM ${T.sol} s WITH (NOLOCK)
  OUTER APPLY (SELECT TOP 1 a2.Art_Descripcion FROM ${T.art} a2 WITH (NOLOCK) WHERE a2.Art_Codigo = s.codigo_barras) a
  OUTER APPLY (SELECT TOP 1 i.nombre FROM ${T.inv} i WITH (NOLOCK) WHERE i.codigo_barras = s.codigo_barras AND i.nombre IS NOT NULL AND i.nombre <> '') ib
  OUTER APPLY (SELECT SUM(i.cantidad) AS cantidad FROM ${T.inv} i WITH (NOLOCK) WHERE i.codigo_barras = s.codigo_barras AND i.ubicacion = s.de_ubicacion) so
  OUTER APPLY (SELECT SUM(i.cantidad) AS cantidad FROM ${T.inv} i WITH (NOLOCK) WHERE i.codigo_barras = s.codigo_barras AND i.ubicacion = s.a_ubicacion) sd`;

async function detalle(id) {
  const s = (await q(`${SQL_LISTA} WHERE s.id = @id`, { id }))[0];
  if (!s) return null;
  s.eventos = await q(`SELECT * FROM ${T.ev} WHERE solicitud_id = @id ORDER BY fecha DESC, id DESC`, { id });
  return s;
}

// ── Endpoints ──────────────────────────────────────────────────────────────────
// Pendientes (TC52 y panel). Antes de listar concilia: lo ya trasladado desaparece solo.
router.get('/pendientes', wrap(async (req, res) => {
  await migrar();
  await conciliar().catch(e => console.error('[resurtido] conciliar:', e.message));
  const rows = await q(`${SQL_LISTA} WHERE s.estado = 'pendiente' ORDER BY s.prioridad DESC, s.creado ASC OPTION (MAXDOP 1)`);
  res.json(rows);
}));

// Historial / lista general
router.get('/', wrap(async (req, res) => {
  await migrar();
  const estado = String(req.query.estado || 'todas');
  const w = []; const p = {};
  if (ESTADOS.includes(estado)) { w.push('s.estado = @e'); p.e = str(estado, 12); }
  if (req.query.codigo) { w.push('s.codigo_barras = @c'); p.c = str(req.query.codigo, 50); }
  if (req.query.desde) { w.push('CAST(s.creado AS DATE) >= @d'); p.d = str(req.query.desde, 10); }
  if (req.query.hasta) { w.push('CAST(s.creado AS DATE) <= @h'); p.h = str(req.query.hasta, 10); }
  const lim = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
  const rows = await q(`SELECT TOP ${lim} * FROM (${SQL_LISTA}) x ${w.length ? 'WHERE ' + w.join(' AND ').replace(/\bs\./g, 'x.') : ''} ORDER BY x.creado DESC OPTION (MAXDOP 1)`, p);
  const conteo = (await q(`SELECT estado, COUNT(*) AS n FROM ${T.sol} WITH (NOLOCK) GROUP BY estado`)).reduce((acc, r) => { acc[r.estado] = r.n; return acc; }, { pendiente: 0, hecha: 0, cancelada: 0 });
  res.json({ solicitudes: rows, conteo });
}));

router.get('/ubicaciones', wrap(async (req, res) => {
  const todas = await ubicacionesActivas();
  const venta = (await q(`SELECT DISTINCT area FROM ${T.map} WITH (NOLOCK)`)).map(x => String(x.area).trim());
  res.json({ todas, venta: todas.filter(u => venta.includes(u)), respaldo: todas.filter(u => !venta.includes(u)) });
}));

router.get('/sugerencia/:codigo', wrap(async (req, res) => {
  const destino = String(req.query.destino || '').trim();
  if (!destino) return res.status(400).json({ error: 'Falta el destino (?destino=Casita 1)' });
  const { base, unidades } = await codigoBase(req.params.codigo);
  const s = await sugerencia(base, destino, String(req.query.origen || 'Bodega').trim());
  res.json({ ...s, codigo_pedido: String(req.params.codigo).trim(), unidades_por_caja: unidades });
}));

router.get('/:id', wrap(async (req, res) => {
  await migrar();
  const s = await detalle(parseInt(req.params.id));
  if (!s) return res.status(404).json({ error: 'Solicitud no encontrada' });
  res.json(s);
}));

// Crear. body: { codigo_barras | codigo, a_ubicacion, de_ubicacion='Bodega', cantidad, nota, prioridad, origen, usuario }
router.post('/', wrap(async (req, res) => {
  await migrar();
  const b = req.body || {};
  const codigoPedido = String(b.codigo_barras || b.codigo || '').trim();
  const n = parseInt(b.cantidad);
  const a = String(b.a_ubicacion || '').trim();
  const de = String(b.de_ubicacion || 'Bodega').trim();
  if (!codigoPedido || !n || n <= 0 || !a) return res.status(400).json({ error: 'Faltan código, cantidad o destino' });
  if (de === a) return res.status(400).json({ error: 'Origen y destino deben ser diferentes' });
  const activas = await ubicacionesActivas();
  if (!activas.includes(a) || !activas.includes(de)) return res.status(400).json({ error: 'Ubicación inválida' });
  const { base, unidades } = await codigoBase(codigoPedido);
  const piezas = b.en_cajas ? n * unidades : n;

  const dup = (await q(`${SQL_LISTA} WHERE s.estado = 'pendiente' AND s.codigo_barras = @c AND s.a_ubicacion = @a`,
    { c: str(base, 50), a: str(a, 50) }))[0];
  if (dup) return res.status(409).json({ error: `Ya hay una solicitud pendiente de ${dup.cantidad} pzas para ${a} (#${dup.id})`, existente: dup });

  const sug = await sugerencia(base, a, de).catch(() => null);
  const nombre = recorta(b.nombre || (sug && sug.nombre) || null, 200);
  const r = await q(`
    INSERT INTO ${T.sol} (codigo_barras, codigo_pedido, nombre, de_ubicacion, a_ubicacion, cantidad, prioridad, origen, nota, solicitado_por,
      stock_origen_al_crear, stock_destino_al_crear)
    OUTPUT inserted.id
    VALUES (@c, @cp, @nom, @de, @a, @n, @pr, @o, @nota, @u, @so, @sd)`, {
    c: str(base, 50), cp: str(codigoPedido, 50), nom: str(nombre, 200), de: str(de, 50), a: str(a, 50), n: piezas,
    pr: b.prioridad ? 1 : 0, o: str(b.origen || 'panel', 20), nota: str(b.nota || b.notas, 300), u: str(usuarioDe(req), 60),
    so: sug ? sug.stock_origen : null, sd: sug ? sug.stock_destino : null,
  });
  const id = r[0].id;
  await evento(id, 'creada', { a: 'pendiente', usuario: usuarioDe(req), detalle: `${piezas} pzas ${de} -> ${a}${sug && sug.stock_origen < piezas ? ` (OJO: en ${de} solo hay ${sug.stock_origen})` : ''}` });
  res.json({ ok: true, id, solicitud: await detalle(id), aviso: sug && sug.stock_origen < piezas ? `En ${de} solo hay ${sug.stock_origen} pza(s); se pidieron ${piezas}.` : null });
}));

// La TC52 la marca hecha después de registrar el traslado (o al ejecutar desde su página).
router.post('/:id/hecha', wrap(async (req, res) => {
  await migrar();
  const id = parseInt(req.params.id); const b = req.body || {};
  const s = (await q(`SELECT * FROM ${T.sol} WHERE id = @id`, { id }))[0];
  if (!s) return res.status(404).json({ error: 'Solicitud no encontrada' });
  if (s.estado !== 'pendiente') return res.status(409).json({ error: `La solicitud ya está ${s.estado}` });
  const hecha = parseInt(b.cantidad) || s.cantidad;
  const movId = parseInt(b.movimiento_id) || null;
  await q(`UPDATE ${T.sol} SET estado = 'hecha', cantidad_hecha = @n, movimiento_id = @m, hecha_por = @u, hecha_en = GETDATE(), actualizado = GETDATE()
           WHERE id = @id AND estado = 'pendiente'`, { id, n: hecha, m: movId, u: str(usuarioDe(req), 60) });
  await evento(id, 'estado', { de: 'pendiente', a: 'hecha', usuario: usuarioDe(req), detalle: `${hecha} pzas movidas${movId ? ` (traslado #${movId})` : ''}` });
  res.json({ ok: true, solicitud: await detalle(id) });
}));

router.post('/:id/cancelar', wrap(async (req, res) => {
  await migrar();
  const id = parseInt(req.params.id); const b = req.body || {};
  const s = (await q(`SELECT * FROM ${T.sol} WHERE id = @id`, { id }))[0];
  if (!s) return res.status(404).json({ error: 'Solicitud no encontrada' });
  if (s.estado !== 'pendiente') return res.status(409).json({ error: `La solicitud ya está ${s.estado}` });
  await q(`UPDATE ${T.sol} SET estado = 'cancelada', cancelada_en = GETDATE(), motivo_cancelacion = @m, actualizado = GETDATE() WHERE id = @id AND estado = 'pendiente'`,
    { id, m: str(b.motivo, 200) });
  await evento(id, 'estado', { de: 'pendiente', a: 'cancelada', usuario: usuarioDe(req), detalle: b.motivo || null });
  res.json({ ok: true, solicitud: await detalle(id) });
}));

// La PWA lo llama (best-effort) justo después de registrar un traslado.
router.post('/conciliar', wrap(async (req, res) => { await migrar(); res.json(await conciliar()); }));

function startScheduler() {
  migrar().catch(e => console.error('[resurtido] Migración falló:', e.message));
  // Cada 2 min cierra lo que ya se trasladó aunque nadie abra la lista.
  setInterval(() => conciliar().catch(e => console.error('[resurtido] conciliar:', e.message)), 2 * 60 * 1000);
}

module.exports = { router, migrar, conciliar, sugerencia, startScheduler };
