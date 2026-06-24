const mssql     = require('../db/mssql');
const { getDb } = require('../db');
const { hoyMX, diasAtrasMX } = require('../util/fechas');

function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function pct(val, total) {
  if (!total || !val) return '0.0%';
  return ((val / total) * 100).toFixed(1) + '%';
}

function num(n) {
  return Number(n || 0).toLocaleString('es-MX');
}

async function fetchAlertData() {
  const db    = getDb();
  const today = hoyMX();
  const in30  = diasAtrasMX(-30);

  const expirySoon = db.prepare(
    `SELECT * FROM product_expiry WHERE fecha_caducidad BETWEEN ? AND ? ORDER BY fecha_caducidad ASC`
  ).all(today, in30);

  const expired = db.prepare(
    `SELECT * FROM product_expiry WHERE fecha_caducidad < ? ORDER BY fecha_caducidad DESC`
  ).all(today);

  const dismissedStagnant = new Set(
    db.prepare(`SELECT art_codigo FROM alertas_descartadas WHERE tipo='stagnant'`).all().map(r => r.art_codigo)
  );
  const dismissedNoSales = new Set(
    db.prepare(`SELECT art_codigo FROM alertas_descartadas WHERE tipo='noSales'`).all().map(r => r.art_codigo)
  );

  let stagnant = [], noSales = [];
  try {
    const [sRes, nRes] = await Promise.all([
      mssql.query(`
        SELECT
          a.Art_Codigo                         AS id,
          a.Art_Descripcion                    AS name,
          ISNULL(aa.AA_ExistenciaActualU, 0)   AS stock,
          a.Art_VECategoria                    AS category,
          a.Art_FechaUltimaVenta               AS ultima_venta
        FROM [compucaja].[dbo].[Articulos] a WITH (NOLOCK)
        JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
          ON aa.Art_Codigo = a.Art_Codigo
        WHERE aa.AA_ExistenciaActualU > 0
          AND a.Art_Bloqueado = 0
          AND (a.Art_FechaUltimaVenta < DATEADD(day,-30,GETDATE()) OR a.Art_FechaUltimaVenta IS NULL)
        ORDER BY aa.AA_ExistenciaActualU DESC
      `),
      mssql.query(`
        SELECT
          a.Art_Codigo                         AS id,
          a.Art_Descripcion                    AS name,
          ISNULL(aa.AA_ExistenciaActualU, 0)   AS stock,
          a.Art_VECategoria                    AS category,
          a.Art_FechaUltimaVenta               AS ultima_venta
        FROM [compucaja].[dbo].[Articulos] a WITH (NOLOCK)
        JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
          ON aa.Art_Codigo = a.Art_Codigo
        WHERE aa.AA_ExistenciaActualU > 0
          AND a.Art_Bloqueado = 0
          AND (
            a.Art_FechaUltimaVenta < DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1)
            OR a.Art_FechaUltimaVenta IS NULL
          )
        ORDER BY aa.AA_ExistenciaActualU DESC
      `),
    ]);
    stagnant = (sRes.recordset || []).filter(r => !dismissedStagnant.has(r.id));
    noSales  = (nRes.recordset || []).filter(r => !dismissedNoSales.has(r.id));
  } catch (e) {
    console.error('[emailService] MSSQL error:', e.message);
  }

  return { stagnant, noSales, expirySoon, expired };
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildHtml({ stagnant, noSales, expirySoon, expired }) {
  const totalNoSalesUnits  = noSales.reduce((s, r)  => s + Number(r.stock || 0), 0);
  const totalStagnantUnits = stagnant.reduce((s, r) => s + Number(r.stock || 0), 0);
  const fechaReporte = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  const generatedAt = new Date().toLocaleString('es-MX', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const TH = 'padding:10px 12px;text-align:left;background:#F5F0EB;color:#5D4037;font-size:11px;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap';
  const TD = 'padding:8px 12px;border-bottom:1px solid #F5EFE9;font-size:13px;vertical-align:top;color:#3E2723';

  function productTable(rows, totalUnits) {
    if (!rows.length) return '<p style="color:#999;font-size:13px;padding:8px 0">Sin productos en esta categoría.</p>';
    const header = `<tr>
      <th style="${TH}">Código</th>
      <th style="${TH}">Producto</th>
      <th style="${TH}">Categoría</th>
      <th style="${TH};text-align:right">Unidades</th>
      <th style="${TH};text-align:right">% del total</th>
      <th style="${TH}">Última Venta</th>
    </tr>`;
    const body = rows.map((r, i) => `<tr style="background:${i % 2 === 0 ? '#fff' : '#FDFAF7'}">
      <td style="${TD};font-family:monospace;font-size:11px;color:#A1887F">${r.id}</td>
      <td style="${TD};font-weight:600">${r.name || '—'}</td>
      <td style="${TD};color:#A1887F;font-size:12px">${r.category || '—'}</td>
      <td style="${TD};text-align:right;font-weight:700">${num(r.stock)}</td>
      <td style="${TD};text-align:right;color:#E65100;font-weight:600">${pct(r.stock, totalUnits)}</td>
      <td style="${TD};color:#A1887F;font-size:12px">${fmt(r.ultima_venta)}</td>
    </tr>`).join('');
    return `<table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #EDE0D4">
      <thead>${header}</thead><tbody>${body}</tbody>
    </table>`;
  }

  function expiryTable(rows, isExpired) {
    if (!rows.length) return '<p style="color:#999;font-size:13px;padding:8px 0">Sin productos.</p>';
    const accent = isExpired ? '#C62828' : '#E65100';
    const header = `<tr>
      <th style="${TH}">Producto</th>
      <th style="${TH}">Área</th>
      <th style="${TH};text-align:right">Cantidad</th>
      <th style="${TH}">Caducidad</th>
    </tr>`;
    const body = rows.map((r, i) => `<tr style="background:${i % 2 === 0 ? '#fff' : '#FDFAF7'}">
      <td style="${TD};font-weight:600">${r.nombre || r.art_codigo}</td>
      <td style="${TD};color:#A1887F;font-size:12px">${r.area || '—'}</td>
      <td style="${TD};text-align:right;font-weight:700;color:${accent}">${r.cantidad}</td>
      <td style="${TD};color:${accent};font-weight:700">${r.fecha_caducidad}</td>
    </tr>`).join('');
    return `<table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #EDE0D4">
      <thead>${header}</thead><tbody>${body}</tbody>
    </table>`;
  }

  const pendingTotal = noSales.length + stagnant.length;

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8F4F0;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:700px;margin:28px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(93,64,55,.12)">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#5D4037,#8D6E63);padding:32px;text-align:center">
    <h1 style="margin:0 0 6px;color:#fff;font-size:24px;letter-spacing:-.5px">La Casita Deli</h1>
    <p style="margin:0;color:#D7CCC8;font-size:14px;text-transform:uppercase;letter-spacing:1px">Reporte Semanal de Inventario</p>
    <p style="margin:8px 0 0;color:#BCAAA4;font-size:13px">${fechaReporte}</p>
  </div>

  <div style="padding:32px">
    <p style="font-size:13px;color:#888;margin:0 0 28px">Generado el ${generatedAt}.</p>

    <!-- Summary cards (table layout for email clients) -->
    <table style="width:100%;border-spacing:8px;border-collapse:separate;margin-bottom:32px">
      <tr>
        <td style="width:50%;padding:18px;background:#FFF8F5;border:1px solid #FFCCBC;border-radius:10px;text-align:center">
          <div style="font-size:36px;font-weight:800;color:#BF360C;line-height:1">${noSales.length}</div>
          <div style="font-size:11px;color:#A1887F;text-transform:uppercase;letter-spacing:.5px;margin-top:6px">Sin venta este mes</div>
          <div style="font-size:13px;color:#E64A19;font-weight:600;margin-top:4px">${num(totalNoSalesUnits)} unidades en inventario</div>
        </td>
        <td style="width:50%;padding:18px;background:#FFFDE7;border:1px solid #FFF176;border-radius:10px;text-align:center">
          <div style="font-size:36px;font-weight:800;color:#E65100;line-height:1">${stagnant.length}</div>
          <div style="font-size:11px;color:#A1887F;text-transform:uppercase;letter-spacing:.5px;margin-top:6px">Estancados +30 días</div>
          <div style="font-size:13px;color:#F57F17;font-weight:600;margin-top:4px">${num(totalStagnantUnits)} unidades paradas</div>
        </td>
      </tr>
      <tr>
        <td style="width:50%;padding:18px;background:#FCE4EC;border:1px solid #F8BBD0;border-radius:10px;text-align:center">
          <div style="font-size:36px;font-weight:800;color:#C62828;line-height:1">${expired.length + expirySoon.length}</div>
          <div style="font-size:11px;color:#A1887F;text-transform:uppercase;letter-spacing:.5px;margin-top:6px">Con caducidad registrada</div>
          <div style="font-size:13px;color:#B71C1C;font-weight:600;margin-top:4px">${expired.length} vencidos · ${expirySoon.length} próximos</div>
        </td>
        <td style="width:50%;padding:18px;background:#E8F5E9;border:1px solid #C8E6C9;border-radius:10px;text-align:center">
          <div style="font-size:36px;font-weight:800;color:#2E7D32;line-height:1">${pendingTotal}</div>
          <div style="font-size:11px;color:#A1887F;text-transform:uppercase;letter-spacing:.5px;margin-top:6px">Pendientes de confirmar</div>
          <div style="font-size:13px;color:#1B5E20;font-weight:600;margin-top:4px">Requieren revisión en el panel</div>
        </td>
      </tr>
    </table>

    <!-- Sin venta este mes -->
    <div style="margin-bottom:32px">
      <h2 style="font-size:18px;color:#5D4037;margin:0 0 4px;border-left:4px solid #FF7043;padding-left:10px">
        📦 Productos sin venta este mes
      </h2>
      <p style="font-size:12px;color:#999;margin:0 0 12px 14px">
        Artículos con existencia que no registraron ninguna venta desde el inicio del mes.
        Total: <strong>${num(totalNoSalesUnits)} unidades</strong> en inventario.
      </p>
      ${productTable(noSales, totalNoSalesUnits)}
    </div>

    <!-- Estancados 30+ días -->
    <div style="margin-bottom:32px">
      <h2 style="font-size:18px;color:#5D4037;margin:0 0 4px;border-left:4px solid #FFA726;padding-left:10px">
        🕐 Inventario estancado (+30 días)
      </h2>
      <p style="font-size:12px;color:#999;margin:0 0 12px 14px">
        Artículos sin movimiento de venta en 30 días o más.
        Total: <strong>${num(totalStagnantUnits)} unidades</strong> inmóviles.
      </p>
      ${productTable(stagnant, totalStagnantUnits)}
    </div>

    ${expired.length ? `
    <!-- Vencidos -->
    <div style="margin-bottom:32px">
      <h2 style="font-size:18px;color:#C62828;margin:0 0 4px;border-left:4px solid #C62828;padding-left:10px">
        🚨 Productos vencidos
      </h2>
      <p style="font-size:12px;color:#999;margin:0 0 12px 14px">Estos productos ya superaron su fecha de caducidad registrada.</p>
      ${expiryTable(expired, true)}
    </div>` : ''}

    ${expirySoon.length ? `
    <!-- Próximos a vencer -->
    <div style="margin-bottom:32px">
      <h2 style="font-size:18px;color:#E65100;margin:0 0 4px;border-left:4px solid #E65100;padding-left:10px">
        ⚠️ Próximos a vencer (30 días)
      </h2>
      <p style="font-size:12px;color:#999;margin:0 0 12px 14px">Toma acción antes de que lleguen a su fecha límite.</p>
      ${expiryTable(expirySoon, false)}
    </div>` : ''}

  </div>

  <!-- Footer -->
  <div style="background:#F5F0EB;padding:20px 32px;border-top:1px solid #EDE0D4">
    <p style="margin:0;font-size:12px;color:#A1887F;line-height:1.7">
      Sistema de Administración — La Casita Deli<br>
      Este correo se genera automáticamente el día 1 de cada mes a las 8:00 AM.<br>
      Los artículos pendientes pueden revisarse y confirmarse en <strong>Panel › Bodega › Discrepancias</strong>.
    </p>
  </div>

</div>
</body>
</html>`;
}

// ── Send report ───────────────────────────────────────────────────────────────

// Envía un correo por Resend (preferido) o Gmail/nodemailer. Reusado por todos
// los correos (reporte de inventario y resumen de ventas).
async function _sendEmail({ subject, html, to }) {
  const useResend = !!process.env.RESEND_API_KEY;
  const useGmail  = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
  if (!useResend && !useGmail) {
    throw new Error('Configura RESEND_API_KEY (recomendado) o EMAIL_USER + EMAIL_PASS en el .env');
  }
  if (useResend) {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({ from: 'La Casita Deli <onboarding@resend.dev>', to, subject, html });
    if (error) throw new Error(error.message);
  } else {
    const nodemailer  = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    await transporter.sendMail({ from: `"La Casita Deli Sistema" <${process.env.EMAIL_USER}>`, to, subject, html });
  }
}

async function sendMonthlyReport() {
  const data    = await fetchAlertData();
  const html    = buildHtml(data);
  const fechaY  = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  const subject = `📊 Reporte Semanal de Inventario — ${fechaY} — La Casita Deli`;
  const total   = data.noSales.length + data.stagnant.length + data.expirySoon.length + data.expired.length;
  const to      = process.env.EMAIL_USER || 'lacasitadeli2000@gmail.com';

  await _sendEmail({ subject, html, to });

  getDb().prepare(`
    INSERT INTO email_report_log (tipo, productos_detectados, noSales, stagnant, expiry, enviado_a)
    VALUES ('weekly', ?, ?, ?, ?, ?)
  `).run(total, data.noSales.length, data.stagnant.length, data.expirySoon.length + data.expired.length, to);

  return {
    sent:     true,
    total,
    noSales:  data.noSales.length,
    stagnant: data.stagnant.length,
    expiry:   data.expirySoon.length + data.expired.length,
    to,
  };
}

// ── RESUMEN DE VENTAS (manual, bajo demanda desde Análisis) ──────────────────
function buildSalesHtml({ dia, semana, mes, topProductos }) {
  const generatedAt = new Date().toLocaleString('es-MX', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const money = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const intn  = (n) => Number(n || 0).toLocaleString('es-MX');
  const marg  = (k) => (Number(k.margen) || 0).toFixed(1) + '%';

  const card = (titulo, k, color) => `
    <td style="padding:6px;vertical-align:top;width:33%">
      <div style="background:#fff;border:1px solid #ECE5DE;border-radius:12px;overflow:hidden">
        <div style="background:${color};padding:10px 14px;color:#fff;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:bold">${titulo}</div>
        <div style="padding:14px">
          <p style="margin:0 0 12px"><span style="color:#8D6E63;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Ventas</span><br><span style="font-size:20px;color:#012d1d;font-weight:bold">${money(k.totalVentas)}</span></p>
          <table style="width:100%;font-size:12px;color:#5D4037;border-collapse:collapse">
            <tr><td style="padding:3px 0">Tickets</td><td style="text-align:right;font-weight:bold">${intn(k.totalTickets)}</td></tr>
            <tr><td style="padding:3px 0">Costo</td><td style="text-align:right">${money(k.totalCosto)}</td></tr>
            <tr><td style="padding:5px 0;color:#012d1d;font-weight:bold;border-top:1px solid #F0EAE3">Ganancia</td><td style="text-align:right;color:#012d1d;font-weight:bold;border-top:1px solid #F0EAE3">${money(k.ganancia)}</td></tr>
            <tr><td style="padding:3px 0">Margen</td><td style="text-align:right">${marg(k)}</td></tr>
            <tr><td style="padding:3px 0">Ticket prom.</td><td style="text-align:right">${money(k.ticketPromedio)}</td></tr>
          </table>
        </div>
      </div>
    </td>`;

  const topRows = (topProductos || []).slice(0, 5).map((p, i) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #F0EAE3;color:#8D6E63">${i + 1}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #F0EAE3;color:#3E2723">${p.name || p.productCode || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #F0EAE3;text-align:right;font-weight:bold;color:#012d1d">${intn(p.unidadesVendidas)} uds</td>
      <td style="padding:8px 12px;border-bottom:1px solid #F0EAE3;text-align:right;color:#5D4037">${money(p.ingresos)}</td>
    </tr>`).join('');

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;background:#FAF7F3">
    <div style="background:linear-gradient(135deg,#012d1d,#1b4332);padding:32px;text-align:center">
      <h1 style="margin:0 0 6px;color:#fff;font-size:24px;letter-spacing:-.5px">La Casita Deli</h1>
      <p style="margin:0;color:#A7C4B5;font-size:14px;text-transform:uppercase;letter-spacing:1px">Resumen de Ventas</p>
      <p style="margin:8px 0 0;color:#7FA08F;font-size:13px;text-transform:capitalize">${generatedAt}</p>
    </div>
    <div style="padding:20px 10px">
      <table style="width:100%;border-collapse:collapse"><tr>
        ${card('Hoy', dia, '#012d1d')}
        ${card('Esta semana', semana, '#1b4332')}
        ${card('Este mes', mes, '#2d6a4f')}
      </tr></table>
      ${topRows ? `
      <div style="background:#fff;border:1px solid #ECE5DE;border-radius:12px;margin:16px 6px 0;overflow:hidden">
        <div style="padding:12px 14px;color:#3E2723;font-size:14px;font-weight:bold;border-bottom:1px solid #F0EAE3">Top productos del mes</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">${topRows}</table>
      </div>` : ''}
      <p style="text-align:center;color:#A1887F;font-size:11px;margin:22px 0 0">Generado a solicitud desde el panel · La Casita Deli</p>
    </div>
  </div>`;
}

async function sendSalesSummary({ dia, semana, mes, topProductos }) {
  const html    = buildSalesHtml({ dia, semana, mes, topProductos });
  const fechaY  = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  const subject = `💰 Resumen de Ventas — ${fechaY} — La Casita Deli`;
  const to      = process.env.EMAIL_USER || 'lacasitadeli2000@gmail.com';
  await _sendEmail({ subject, html, to });
  return { sent: true, to };
}

module.exports = { sendMonthlyReport, sendSalesSummary, fetchAlertData };
