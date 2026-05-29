export interface Product {
  id: number; barcode: string | null; name: string; description: string | null;
  costPrice: number; salePrice: number; stock: number; minStock: number;
  image: string | null; active: boolean; visibleWeb: boolean;
  category: string | null; categoryId: number | null; createdAt: string;
}

export interface Category { id: string | number; name: string; description?: string | null; }

export interface SalesSummary {
  totalVentas: number; totalIngresos: number; ticketPromedio: number;
  totalEfectivo: number; totalTarjeta: number; totalTransferencia: number; gananciaEstimada: number;
}

export interface Sale {
  id: number; invoiceNumber: string; total: number; paymentMethod: string;
  canal: string; createdAt: string; cajero: string | null; numProductos: number;
}

export interface TopProduct {
  name: string; unidadesVendidas: number; ingresos: number; category?: string; image?: string;
}

export interface PolizaTicket {
  ticket: string; fecha: string; factura: string;
  totalImporte: number; totalCosto: number; ganancia: number; numProductos: number;
}

export interface PolizaSummary {
  totalImporte: number; totalCosto: number; totalGanancia: number; numTickets: number;
}

export interface HourRow {
  hora: number; numTickets: number; unidadesVendidas: number; totalVentas: number; totalCosto: number;
}

export interface MonthRow {
  anio: number; mes: number; numTickets: number; unidadesVendidas: number; totalVentas: number; totalCosto: number;
}

export interface ProdHour  { nombre: string; hora: number; unidades: number; ingresos: number; }
export interface ProdMonth { nombre: string; anio: number; mes: number; unidades: number; ingresos: number; }

export interface AnalyticsData {
  byHour:          HourRow[];
  byMonth:         MonthRow[];
  productsByHour:  ProdHour[];
  productsByMonth: ProdMonth[];
}

// ── Bodega / Control Interno ──────────────────────────────────────────────────
export type Area = string; // configurable — formerly 'bodega'|'cocina'|'tienda'|'refrigerador'|'otro'

export interface AreaConfig {
  id:         number;
  clave:      string;
  nombre:     string;
  icono:      string;
  color_bg:   string;
  color_text: string;
  activo:     number;
  orden:      number;
}

export interface AreaCount  { area: Area; total: number; }

export interface AreaProduct {
  id: string; name: string; stock: number; category: string | null; notas?: string | null;
}

export interface ExpiryRecord {
  id: number; art_codigo: string; nombre: string | null;
  fecha_caducidad: string; cantidad: number; area: string;
  notas: string | null; alerta_enviada: number; created_at: string;
}

export interface SurtidoTransfer {
  id: number; art_codigo: string; nombre: string | null;
  de_area: string; a_area: string; cantidad: number;
  autorizado: number; semana: string | null; notas: string | null; created_at: string;
}

export interface Recuento {
  id: number; art_codigo: string; nombre: string | null;
  stock_sistema: number; stock_conteo: number; area: string;
  notas: string | null; created_at: string;
}

export interface StagnantProduct {
  id: string; name: string; stock: number; category: string | null; ultima_venta: string | null;
}

export interface AlertTotals {
  expirySoon: number; expired: number; stagnant: number; noSales: number;
}

export interface BodegaAlerts {
  expirySoon: ExpiryRecord[];
  expired:    ExpiryRecord[];
  stagnant:   StagnantProduct[];
  noSales:    StagnantProduct[];
  totals:     AlertTotals;
}

// ── Ubicaciones y movimientos unificados ──────────────────────────────────────
export interface StockUbicacion {
  art_codigo: string;
  nombre:     string | null;
  area:       string;
  cantidad:   number;
  updated_at: string;
}

export interface ResumenUbicacion {
  area:      string;
  productos: number;
  unidades:  number;
}

export type TipoMovimiento = 'entrada' | 'salida' | 'merma' | 'transferencia';

export interface MovimientoUnificado {
  uid:           string;
  tipo:          TipoMovimiento;
  codigo:        string;
  nombre:        string | null;
  cantidad:      number;
  area_origen:   string | null;
  area_destino:  string | null;
  stock_antes:   number | null;
  stock_despues: number | null;
  motivo:        string | null;
  notas:         string | null;
  usuario:       string;
  fecha:         string;
}
