export interface Product {
  id: number; barcode: string | null; name: string; description: string | null;
  costPrice: number; salePrice: number; stock: number; minStock: number;
  image: string | null; active: boolean; visibleWeb: boolean;
  category: string | null; categoryId: number | null; createdAt: string;
}

export interface Category { id: number; name: string; description: string | null; }

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
