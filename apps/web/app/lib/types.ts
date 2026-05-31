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

export interface WeekdayRow {
  diaSemana: number; numTickets: number; unidadesVendidas: number; totalVentas: number; totalCosto: number;
}
export interface CategoryRow {
  categoria: string; numTickets: number; unidadesVendidas: number; totalVentas: number; totalCosto: number;
}
export interface TopProduct {
  nombre: string; categoria: string; unidades: number; ingresos: number; costo: number; ganancia: number;
}

export interface AnalyticsData {
  byHour:      HourRow[];
  byMonth:     MonthRow[];
  byWeekday:   WeekdayRow[];
  byCategory:  CategoryRow[];
  topProducts: TopProduct[];
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

// ── Recepción de mercancía ────────────────────────────────────────────────────
export type EstadoPedido = 'pendiente' | 'en_recepcion' | 'cerrado' | 'cancelado';

export interface PedidoRecepcion {
  id:             number;
  folio:          string;
  proveedor:      string | null;
  fecha_esperada: string | null;
  estado:         EstadoPedido;
  notas:          string | null;
  cerrado_at:     string | null;
  created_at:     string;
  num_items:      number;
  total_esperado: number;
  total_recibido: number;
}

export interface PedidoDetalle {
  id:               number;
  pedido_id:        number;
  art_codigo:       string;
  nombre:           string | null;
  cantidad_esperada: number;
  cantidad_recibida: number;
  diferencia:       number;
}

export interface PedidoConDetalle extends PedidoRecepcion {
  detalle: PedidoDetalle[];
}

// ── Ubicaciones y movimientos unificados ──────────────────────────────────────
export interface StockUbicacion {
  art_codigo: string;
  nombre:     string | null;
  area:       string;
  cantidad:   number;
  updated_at: string;
}

export type EstadoFactura = 'en_camino' | 'en_almacen' | 'cancelada';

export interface FacturaCompra {
  id:              number;
  folio:           string;
  proveedor:       string;
  numero_factura:  string | null;
  fecha_emision:   string | null;
  fecha_esperada:  string | null;
  estado:          EstadoFactura;
  total_calculado: number;
  notas:           string | null;
  pedido_id:       number | null;
  entregado_at:    string | null;
  created_at:      string;
}

export interface FacturaDetalle {
  id:              number;
  factura_id:      number;
  art_codigo:      string;
  nombre:          string | null;
  cantidad:        number;
  precio_unitario: number;
  subtotal:        number;
}

export interface FacturaConDetalle extends FacturaCompra {
  detalle: FacturaDetalle[];
  pedido:  { id: number; folio: string; estado: string; total_esperado: number; total_recibido: number; num_items: number } | null;
}

export interface ConsumoArea {
  id:         number;
  art_codigo: string;
  nombre:     string | null;
  area:       string;
  cantidad:   number;
  notas:      string | null;
  usuario:    string;
  created_at: string;
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
