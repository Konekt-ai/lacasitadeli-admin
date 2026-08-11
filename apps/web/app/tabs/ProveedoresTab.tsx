'use client';
import React, { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { cn, hoyMX } from '../lib/utils';
import { Icon } from '../components/Icon';

type TimeFilter = 'Hoy' | 'Esta semana' | 'Últimos 30 días' | 'Este mes';
const PERIOD_MAP: Record<string, string> = { 'Hoy': 'day', 'Esta semana': 'week', 'Últimos 30 días': 'days30', 'Este mes': 'month' };
const PERIOD_LABEL: Record<string, string> = { day: 'hoy', week: 'últimos 7 días', days30: 'últimos 30 días', month: 'este mes' };

interface Supplier {
  id: string;
  nombre: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  rfc: string;
  telefono1: string;
  url: string;
  domicilio: string;
  estado: string;
  municipio: string;
  pais: string;
  cp: string;
  comprasAcumuladas: number;
  fechaUltimaCompra: string | null;
  totalProductos: number;
  totalVentas: number;
  totalCosto: number;
  ganancia: number;
  totalTickets: number;
  unidadesVendidas: number;
}

interface SupplierProduct {
  productCode: string;
  name: string;
  unidadesVendidas: number;
  ingresos: number;
  costo: number;
}

interface AddForm {
  nombre: string; rfc: string; telefono1: string; url: string;
  domicilio: string; estado: string; municipio: string; pais: string; cp: string;
}

const EMPTY_FORM: AddForm = {
  nombre: '', rfc: '', telefono1: '', url: '',
  domicilio: '', estado: '', municipio: '', pais: 'México', cp: '',
};

const LIMIT_OPTIONS = [
  { value: 10,  label: 'Top 10' },
  { value: 50,  label: 'Top 50' },
  { value: 100, label: 'Top 100' },
  { value: 202, label: 'Todos' },
];

interface Props { timeFilter: string; }

export default function ProveedoresTab({ timeFilter }: Props) {
  const [suppliers,        setSuppliers]        = useState<Supplier[]>([]);
  const [totalSuppliers,   setTotalSuppliers]   = useState(0);
  const [loading,          setLoading]          = useState(false);
  const [limit,            setLimit]            = useState(50);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierProducts, setSupplierProducts] = useState<SupplierProduct[]>([]);
  const [loadingProducts,  setLoadingProducts]  = useState(false);
  const [showAdd,          setShowAdd]          = useState(false);
  const [addForm,          setAddForm]          = useState<AddForm>(EMPTY_FORM);
  const [addSaving,        setAddSaving]        = useState(false);
  const [confirmDelete,    setConfirmDelete]    = useState(false);
  const [deleting,         setDeleting]         = useState(false);
  const [showReasign,      setShowReasign]      = useState(false);
  const [reasignMap,       setReasignMap]       = useState<Record<string, string>>({});
  const [notif,            setNotif]            = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const period = PERIOD_MAP[timeFilter as TimeFilter] ?? 'day';

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3500);
  };

  const fetchSuppliers = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/novacaja/proveedores?period=${period}&limit=${limit}`);
      const data = await res.json();
      if (data.error) { console.error(data.error); return; }
      setSuppliers(data.suppliers || []);
      setTotalSuppliers(data.total || 0);
    } catch (e) { console.error('Error proveedores', e); }
    finally { setLoading(false); }
  }, [period, limit]);

  useEffect(() => { fetchSuppliers(); }, [fetchSuppliers]);

  const openSupplier = async (s: Supplier) => {
    setSelectedSupplier(s);
    setLoadingProducts(true);
    try {
      const res  = await fetch(`/api/novacaja/proveedores/${s.id}/products?period=${period}`);
      const data = await res.json();
      setSupplierProducts(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    finally { setLoadingProducts(false); }
  };

  const closePanel = () => {
    setSelectedSupplier(null);
    setSupplierProducts([]);
    setConfirmDelete(false);
    setShowReasign(false);
    setReasignMap({});
  };

  const isDiversos = (s: Supplier) =>
    /divers/i.test(s.nombre) || /divers/i.test(s.apellidoPaterno);

  const deleteSupplier = async () => {
    if (!selectedSupplier) return;
    setDeleting(true);
    try {
      const res  = await fetch(`/api/novacaja/proveedores/${selectedSupplier.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        notify(data.message || 'Proveedor eliminado');
        closePanel();
        fetchSuppliers();
      } else notify(data.error || 'Error al eliminar', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setDeleting(false); }
  };

  const saveNewSupplier = async () => {
    if (!addForm.nombre.trim()) { notify('El nombre es requerido', 'error'); return; }
    setAddSaving(true);
    try {
      const res  = await fetch('/api/novacaja/proveedores', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(addForm),
      });
      const data = await res.json();
      if (res.ok) {
        notify(data.message || 'Proveedor agregado');
        setShowAdd(false);
        setAddForm(EMPTY_FORM);
        fetchSuppliers();
      } else notify(data.error || 'Error al guardar', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setAddSaving(false); }
  };

  const fmt = (n: number) => `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
  const maxVentas   = Math.max(...suppliers.map(s => s.totalVentas), 1);
  const totalPeriod = suppliers.reduce((sum, s) => sum + s.totalVentas, 0);

  const exportToExcel = () => {
    const wb          = XLSX.utils.book_new();
    const date        = hoyMX();
    const currFmt     = '"$"#,##0.00';
    const pctFmt      = '0.00"%"';
    const pLabel: Record<string, string> = { day: 'Hoy', week: 'Últimos 7 días', days30: 'Últimos 30 días', month: 'Este mes' };

    const totVentas    = suppliers.reduce((s, p) => s + p.totalVentas,      0);
    const totCosto     = suppliers.reduce((s, p) => s + p.totalCosto,       0);
    const totGanancia  = suppliers.reduce((s, p) => s + p.ganancia,         0);
    const totTickets   = suppliers.reduce((s, p) => s + p.totalTickets,     0);
    const totUnidades  = suppliers.reduce((s, p) => s + p.unidadesVendidas, 0);
    const totProductos = suppliers.reduce((s, p) => s + p.totalProductos,   0);
    const totMargen    = totVentas > 0 ? (totGanancia / totVentas) * 100 : 0;

    // ── Hoja 1: Resumen por proveedor ──────────────────────────────────────────
    const h1 = [
      '#', 'Proveedor', 'RFC',
      'Ventas ($)', '% Part. Ventas',
      'Costo ($)', 'Utilidad ($)', 'Margen (%)', '% Part. Utilidad',
      'Tickets', 'Unidades', 'Productos', 'Compras Acum. ($)', 'Últ. Compra',
    ];

    const dataRows = suppliers.map((s, i) => {
      const margen    = s.totalVentas > 0 ? (s.ganancia    / s.totalVentas)  * 100 : 0;
      const pctVentas = totVentas     > 0 ? (s.totalVentas / totVentas)      * 100 : 0;
      const pctUtil   = totGanancia   > 0 ? (s.ganancia    / totGanancia)    * 100 : 0;
      return [
        i + 1,
        displayName(s),
        s.rfc || '',
        +s.totalVentas.toFixed(2),
        +pctVentas.toFixed(2),
        +s.totalCosto.toFixed(2),
        +s.ganancia.toFixed(2),
        +margen.toFixed(2),
        +pctUtil.toFixed(2),
        s.totalTickets,
        s.unidadesVendidas,
        s.totalProductos,
        +s.comprasAcumuladas.toFixed(2),
        s.fechaUltimaCompra ? new Date(s.fechaUltimaCompra).toLocaleDateString('es-MX') : '',
      ];
    });

    // Blank separator + totals row
    dataRows.push([] as unknown as typeof dataRows[0]);
    dataRows.push([
      'TOTAL', `${suppliers.length} proveedores`, '',
      +totVentas.toFixed(2),    100,
      +totCosto.toFixed(2),     +totGanancia.toFixed(2), +totMargen.toFixed(2), 100,
      totTickets, totUnidades, totProductos, '', '',
    ] as unknown as typeof dataRows[0]);

    const aoa1 = [
      [`Reporte de Proveedores — La Casita Deli`],
      [`Periodo: ${pLabel[period] ?? period}   |   Generado: ${new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}`],
      [],
      h1,
      ...dataRows,
    ];

    const ws1 = XLSX.utils.aoa_to_sheet(aoa1);
    ws1['!cols'] = [
      { wch: 4 }, { wch: 36 }, { wch: 16 },
      { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 14 },
      { wch: 9 },  { wch: 10 }, { wch: 9 },  { wch: 16 }, { wch: 14 },
    ];

    // Number formats: data rows start at Excel row 5 (3 title/blank + 1 header)
    const dStart = 5;
    const dEnd   = 4 + dataRows.length;
    for (let r = dStart; r <= dEnd; r++) {
      (['D', 'F', 'G', 'M'] as const).forEach(col => { const c = ws1[`${col}${r}`]; if (c) c.z = currFmt; });
      (['E', 'H', 'I']       as const).forEach(col => { const c = ws1[`${col}${r}`]; if (c) c.z = pctFmt; });
    }

    XLSX.utils.book_append_sheet(wb, ws1, 'Por Proveedor');

    // ── Hoja 2: Directorio de contacto ────────────────────────────────────────
    const h2 = ['Proveedor', 'RFC', 'Teléfono', 'Web', 'Domicilio', 'Municipio', 'Estado', 'CP', 'País', 'Últ. Compra', 'Compras Acum. ($)'];
    const contactRows = suppliers.map(s => [
      displayName(s), s.rfc || '', s.telefono1 || '', s.url || '',
      s.domicilio || '', s.municipio || '', s.estado || '', s.cp || '', s.pais || '',
      s.fechaUltimaCompra ? new Date(s.fechaUltimaCompra).toLocaleDateString('es-MX') : '',
      +s.comprasAcumuladas.toFixed(2),
    ]);

    const ws2 = XLSX.utils.aoa_to_sheet([h2, ...contactRows]);
    ws2['!cols'] = [
      { wch: 36 }, { wch: 16 }, { wch: 15 }, { wch: 30 },
      { wch: 30 }, { wch: 20 }, { wch: 20 }, { wch: 8 }, { wch: 12 },
      { wch: 14 }, { wch: 16 },
    ];
    for (let r = 2; r <= contactRows.length + 1; r++) {
      const c = ws2[`K${r}`]; if (c) c.z = currFmt;
    }
    XLSX.utils.book_append_sheet(wb, ws2, 'Directorio');

    XLSX.writeFile(wb, `proveedores-${period}-${date}.xlsx`);
  };

  const displayName = (s: Supplier) =>
    [s.nombre, s.apellidoPaterno, s.apellidoMaterno].filter(Boolean).join(' ');

  return (
    <section className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">

      {/* Toast */}
      {notif && (
        <div className={cn(
          'fixed top-4 right-4 z-[300] px-5 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
        )}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* ── Detail side panel ───────────────────────────────────────────────── */}
      {selectedSupplier && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[200]" onClick={closePanel} />
          <div className="fixed right-0 top-0 h-full w-full lg:w-[480px] bg-surface shadow-2xl z-[201] flex flex-col border-l border-outline-variant/15">

            {/* Panel header */}
            <div className="p-5 border-b border-outline-variant/10 bg-surface-container-low flex items-start justify-between flex-shrink-0">
              <div className="pr-4 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon name="local_shipping" className="text-primary text-base" />
                  </div>
                  <h3 className="font-serif text-lg text-primary truncate">{displayName(selectedSupplier)}</h3>
                </div>
                {selectedSupplier.rfc && (
                  <span className="inline-block text-[9px] font-label bg-primary/10 text-primary px-2 py-0.5 rounded-full uppercase tracking-widest">
                    {selectedSupplier.rfc}
                  </span>
                )}
              </div>
              <button onClick={closePanel} className="p-2 hover:bg-surface-variant rounded-full text-stone-400 flex-shrink-0">
                <Icon name="close" />
              </button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {showReasign ? (
              <div className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <p className="text-xs font-label font-bold text-amber-700 uppercase tracking-widest mb-0.5">Reasignar productos</p>
                  <p className="text-[11px] font-body text-amber-600">
                    Elige a qué proveedor mover cada producto de PROVEEDORES DIVERSOS.
                  </p>
                </div>

                {loadingProducts ? (
                  <div className="flex justify-center py-6">
                    <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                  </div>
                ) : supplierProducts.length === 0 ? (
                  <p className="text-xs font-body text-stone-400 italic text-center py-6">Sin productos en este periodo</p>
                ) : (
                  <div className="space-y-2">
                    {supplierProducts.map(p => (
                      <div key={p.productCode} className="bg-surface-container-low rounded-xl p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-body text-on-surface font-semibold leading-tight">{p.name}</p>
                          <span className="text-[9px] font-label text-stone-400 bg-surface-container px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0">
                            {p.productCode}
                          </span>
                        </div>
                        <select
                          value={reasignMap[p.productCode] ?? ''}
                          onChange={e => setReasignMap(m => ({ ...m, [p.productCode]: e.target.value }))}
                          className="w-full px-3 py-2 bg-surface border border-outline-variant/20 focus:border-primary rounded-lg text-xs font-body outline-none">
                          <option value="">— Sin cambio —</option>
                          {suppliers
                            .filter(s => selectedSupplier && s.id !== selectedSupplier.id)
                            .map(s => (
                              <option key={s.id} value={s.id}>{displayName(s)}</option>
                            ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (<>

              {/* Sales KPIs */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Ventas',    value: fmt(selectedSupplier.totalVentas),   icon: 'payments',     color: 'text-amber-700',   bg: 'bg-amber-50' },
                  { label: 'Ganancia',  value: fmt(selectedSupplier.ganancia),      icon: 'trending_up',  color: 'text-emerald-700', bg: 'bg-emerald-50' },
                  { label: 'Tickets',   value: selectedSupplier.totalTickets.toLocaleString('es-MX'), icon: 'receipt_long', color: 'text-primary', bg: 'bg-primary/5' },
                  { label: 'Unidades',  value: selectedSupplier.unidadesVendidas.toLocaleString('es-MX'), icon: 'inventory_2', color: 'text-stone-600', bg: 'bg-stone-100' },
                ].map(card => (
                  <div key={card.label} className="bg-surface-container-low rounded-xl p-3">
                    <div className={cn('w-7 h-7 rounded-full flex items-center justify-center mb-2', card.bg)}>
                      <Icon name={card.icon} className={cn('text-sm', card.color)} />
                    </div>
                    <p className="text-[9px] font-label uppercase tracking-widest text-stone-400">{card.label}</p>
                    <p className={cn('font-serif text-base font-bold mt-0.5', card.color)}>{card.value}</p>
                  </div>
                ))}
              </div>

              {/* Margen bar */}
              {selectedSupplier.totalVentas > 0 && (
                <div className="bg-surface-container-low rounded-xl p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-label uppercase tracking-widest text-stone-400">Margen de ganancia</span>
                    <span className="text-sm font-serif text-primary font-bold">
                      {((selectedSupplier.ganancia / selectedSupplier.totalVentas) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 bg-surface-container rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-700"
                      style={{ width: `${Math.max(0, Math.min((selectedSupplier.ganancia / selectedSupplier.totalVentas) * 100, 100))}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[9px] font-label text-stone-400">Costo {fmt(selectedSupplier.totalCosto)}</span>
                    <span className="text-[9px] font-label text-stone-400">{selectedSupplier.totalProductos} productos</span>
                  </div>
                </div>
              )}

              {/* Contact info */}
              <div className="space-y-2">
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 font-bold">Contacto</p>
                {[
                  { icon: 'phone',       label: 'Teléfono',  value: selectedSupplier.telefono1 },
                  { icon: 'language',    label: 'Web',       value: selectedSupplier.url },
                  { icon: 'location_on', label: 'Domicilio', value: [selectedSupplier.domicilio, selectedSupplier.municipio, selectedSupplier.estado, selectedSupplier.cp, selectedSupplier.pais].filter(Boolean).join(', ') },
                  { icon: 'shopping_bag', label: 'Últ. compra', value: selectedSupplier.fechaUltimaCompra ? new Date(selectedSupplier.fechaUltimaCompra).toLocaleDateString('es-MX') : null },
                ].filter(r => r.value).map(row => (
                  <div key={row.label} className="flex items-start gap-3 py-2 border-b border-surface-container last:border-0">
                    <Icon name={row.icon} className="text-stone-400 text-base mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[9px] font-label uppercase tracking-widest text-stone-400">{row.label}</p>
                      <p className="text-sm font-body text-on-surface break-words">{row.value}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Top products */}
              <div>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 font-bold mb-3">
                  Top Productos — {PERIOD_LABEL[period]}
                </p>
                {loadingProducts ? (
                  <div className="flex justify-center py-6">
                    <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                  </div>
                ) : supplierProducts.length === 0 ? (
                  <p className="text-xs font-body text-stone-400 italic py-4 text-center">Sin ventas {PERIOD_LABEL[period]}</p>
                ) : (
                  <div className="space-y-2">
                    {supplierProducts.map((p, i) => {
                      const maxIngresos = Math.max(...supplierProducts.map(x => x.ingresos), 1);
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <div className={cn(
                            'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-label font-bold flex-shrink-0',
                            i === 0 ? 'bg-primary text-on-primary' : 'bg-surface-container text-stone-400'
                          )}>
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-body text-on-surface truncate">{p.name}</p>
                            <div className="mt-1 h-1.5 bg-surface-container rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary/60 rounded-full"
                                style={{ width: `${(p.ingresos / maxIngresos) * 100}%` }}
                              />
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs font-bold text-primary">{fmt(p.ingresos)}</p>
                            <p className="text-[9px] text-stone-400">{p.unidadesVendidas} uds</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>)}
            </div>

            <div className="p-5 border-t border-outline-variant/10 flex-shrink-0 space-y-3">
              {/* Reasign mode footer */}
              {showReasign ? (
                <div className="flex gap-2">
                  <button onClick={() => { setShowReasign(false); setReasignMap({}); }}
                    className="flex-1 py-3 bg-surface-variant text-on-surface-variant rounded-xl text-xs font-label font-bold uppercase tracking-widest hover:bg-stone-200 transition-all">
                    Cancelar
                  </button>
                  <button
                    disabled
                    title="Pendiente de implementar en API"
                    className="flex-1 py-3 bg-stone-200 text-stone-400 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 cursor-not-allowed">
                    <Icon name="shuffle" className="text-base" />
                    Guardar cambios
                  </button>
                </div>
              ) : confirmDelete ? (
                <div className="bg-error/5 border border-error/20 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-label text-error text-center font-bold uppercase tracking-widest">
                    ¿Eliminar permanentemente?
                  </p>
                  <p className="text-[11px] font-body text-stone-500 text-center">
                    Se borrará <span className="font-bold">{displayName(selectedSupplier)}</span> de la base de datos. Esta acción no se puede deshacer.
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmDelete(false)} disabled={deleting}
                      className="flex-1 py-2.5 bg-surface-variant text-on-surface-variant rounded-xl text-xs font-label font-bold uppercase tracking-widest hover:bg-stone-200 transition-all">
                      Cancelar
                    </button>
                    <button onClick={deleteSupplier} disabled={deleting}
                      className={cn(
                        'flex-1 py-2.5 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all',
                        deleting ? 'bg-stone-200 text-stone-400' : 'bg-error text-on-error hover:opacity-90'
                      )}>
                      {deleting
                        ? <div className="w-4 h-4 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
                        : <Icon name="delete_forever" className="text-base" />}
                      Eliminar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  {selectedSupplier && isDiversos(selectedSupplier) && (
                    <button onClick={() => setShowReasign(true)}
                      className="px-4 py-3 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-xs font-label font-bold flex items-center gap-2 hover:bg-amber-100 transition-all">
                      <Icon name="shuffle" className="text-base" />
                      Reasignar
                    </button>
                  )}
                  <button onClick={() => setConfirmDelete(true)}
                    className="px-4 py-3 bg-error/10 text-error rounded-xl text-xs font-label font-bold flex items-center gap-2 hover:bg-error/20 transition-all">
                    <Icon name="delete" className="text-base" />
                    Eliminar
                  </button>
                  <button onClick={closePanel}
                    className="flex-1 py-3 bg-surface-variant text-on-surface-variant rounded-xl text-xs font-label font-bold uppercase tracking-widest hover:bg-stone-200 transition-all">
                    Cerrar
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Add Supplier Modal ───────────────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-surface rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg shadow-2xl border border-outline-variant/15 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-5 bg-surface-container-low border-b border-outline-variant/10 flex justify-between items-center flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <Icon name="person_add" className="text-primary" />
                </div>
                <div>
                  <h3 className="font-serif text-lg text-primary">Nuevo Proveedor</h3>
                  <p className="text-[10px] font-label uppercase tracking-widest text-stone-400">Agrega a la base de datos</p>
                </div>
              </div>
              <button onClick={() => { setShowAdd(false); setAddForm(EMPTY_FORM); }}
                className="p-1.5 hover:bg-surface-variant rounded-full text-stone-400">
                <Icon name="close" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Required */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">
                  Nombre / Razón social *
                </label>
                <input
                  value={addForm.nombre}
                  onChange={e => setAddForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej: COCA COLA FEMSA S.A. DE C.V."
                  className="w-full px-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-body"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">RFC</label>
                  <input
                    value={addForm.rfc}
                    onChange={e => setAddForm(f => ({ ...f, rfc: e.target.value.toUpperCase() }))}
                    placeholder="Ej: CCF890101XXX"
                    className="w-full px-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-label tracking-wider"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Teléfono</label>
                  <input
                    value={addForm.telefono1}
                    onChange={e => setAddForm(f => ({ ...f, telefono1: e.target.value }))}
                    placeholder="Ej: 4421234567"
                    className="w-full px-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-body"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Sitio Web / URL</label>
                <input
                  value={addForm.url}
                  onChange={e => setAddForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://..."
                  className="w-full px-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-body"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Domicilio</label>
                <input
                  value={addForm.domicilio}
                  onChange={e => setAddForm(f => ({ ...f, domicilio: e.target.value }))}
                  placeholder="Calle, número..."
                  className="w-full px-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-body"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Estado</label>
                  <input
                    value={addForm.estado}
                    onChange={e => setAddForm(f => ({ ...f, estado: e.target.value }))}
                    placeholder="Querétaro"
                    className="w-full px-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-body"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Municipio</label>
                  <input
                    value={addForm.municipio}
                    onChange={e => setAddForm(f => ({ ...f, municipio: e.target.value }))}
                    placeholder="Querétaro"
                    className="w-full px-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-body"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">CP</label>
                  <input
                    value={addForm.cp}
                    onChange={e => setAddForm(f => ({ ...f, cp: e.target.value }))}
                    placeholder="76000"
                    className="w-full px-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-label"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">País</label>
                  <input
                    value={addForm.pais}
                    onChange={e => setAddForm(f => ({ ...f, pais: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-body"
                  />
                </div>
              </div>
            </div>

            <div className="px-6 pb-6 flex gap-3 flex-shrink-0">
              <button onClick={() => { setShowAdd(false); setAddForm(EMPTY_FORM); }}
                className="flex-1 py-3 bg-surface-variant text-on-surface-variant rounded-xl text-xs font-label font-bold uppercase tracking-widest hover:bg-stone-200 transition-all">
                Cancelar
              </button>
              <button onClick={saveNewSupplier} disabled={addSaving}
                className={cn(
                  'flex-1 py-3 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 shadow-md transition-all',
                  addSaving ? 'bg-stone-200 text-stone-400' : 'bg-primary text-on-primary hover:bg-primary-container'
                )}>
                {addSaving
                  ? <div className="w-4 h-4 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
                  : <Icon name="save" className="text-base" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 mb-6">
        <div>
          <h2 className="text-2xl lg:text-3xl font-serif italic text-primary">Proveedores</h2>
          <p className="text-[10px] font-label uppercase tracking-widest text-stone-500 mt-1">
            {suppliers.length} de {totalSuppliers} proveedores · ventas {PERIOD_LABEL[period]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Limit selector */}
          <div className="flex items-center gap-1 bg-surface-container-low px-2 py-1 rounded-lg border border-outline-variant/10">
            {LIMIT_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setLimit(opt.value)}
                className={cn('px-3 py-1.5 rounded-md text-[10px] font-label font-bold uppercase tracking-widest transition-all',
                  limit === opt.value ? 'bg-surface text-primary shadow-sm' : 'text-stone-400 hover:text-stone-600')}>
                {opt.label}
              </button>
            ))}
          </div>
          {suppliers.length > 0 && (
            <button onClick={exportToExcel}
              className="px-4 py-2 bg-surface-container-low text-stone-600 border border-outline-variant/20 rounded-lg text-xs font-label font-bold flex items-center gap-2 hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all">
              <Icon name="download" className="text-base" />
              <span className="hidden sm:inline">Excel</span>
            </button>
          )}
          <button onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-primary text-on-primary rounded-lg text-xs font-label font-bold flex items-center gap-2 shadow-md hover:bg-primary-container transition-all">
            <Icon name="person_add" className="text-base" />
            <span className="hidden sm:inline">Agregar</span>
          </button>
        </div>
      </div>

      {/* ── Summary KPI strip ───────────────────────────────────────────────── */}
      {!loading && suppliers.length > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
            {[
              {
                label: 'Ventas',
                sub:   `${suppliers.length} proveedores mostrados`,
                value: `$${Number(totalPeriod).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`,
                icon: 'payments', color: 'text-amber-700', bg: 'bg-amber-50',
              },
              {
                label: 'Ganancia',
                sub:   `${suppliers.length} proveedores mostrados`,
                value: `$${Number(suppliers.reduce((s, p) => s + p.ganancia, 0)).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`,
                icon: 'trending_up', color: 'text-emerald-700', bg: 'bg-emerald-50',
              },
              {
                label: 'Proveedores activos',
                sub:   `de ${suppliers.length} mostrados`,
                value: suppliers.filter(s => s.totalVentas > 0).length.toString(),
                icon: 'local_shipping', color: 'text-primary', bg: 'bg-primary/5',
              },
              {
                label: 'Sin ventas',
                sub:   `de ${suppliers.length} mostrados`,
                value: suppliers.filter(s => s.totalVentas === 0).length.toString(),
                icon: 'warning', color: 'text-stone-500', bg: 'bg-stone-100',
              },
            ].map(card => (
              <div key={card.label} className="bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/10">
                <div className="flex justify-between items-start mb-3">
                  <span className="text-[10px] font-label uppercase tracking-widest text-stone-400">{card.label}</span>
                  <div className={cn('w-7 h-7 rounded-full flex items-center justify-center', card.bg)}>
                    <Icon name={card.icon} className={cn('text-sm', card.color)} />
                  </div>
                </div>
                <p className={cn('text-2xl font-serif', card.color)}>{card.value}</p>
                <p className="text-[9px] font-label text-stone-400 mt-1 uppercase tracking-widest">{card.sub}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] font-label text-stone-400 mb-5 flex items-center gap-1.5">
            <Icon name="info" className="text-sm text-stone-300" />
            Subtotal de los proveedores listados. No incluye productos sin proveedor asignado ni proveedores fuera del límite seleccionado.
          </p>
        </>
      )}

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-[0px_12px_32px_rgba(28,28,25,0.04)] overflow-hidden">
        {loading ? (
          <div className="py-24 flex flex-col items-center text-stone-400">
            <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
            <p className="text-sm font-label uppercase tracking-widest">Cargando proveedores {PERIOD_LABEL[period]}...</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[640px]">
                <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container">
                  <tr>
                    <th className="px-5 py-4 w-10">#</th>
                    <th className="px-5 py-4">Proveedor</th>
                    <th className="px-5 py-4 text-center">Prods</th>
                    <th className="px-5 py-4 text-right">Ventas</th>
                    <th className="px-5 py-4 text-right">Ganancia</th>
                    <th className="px-5 py-4 text-right hidden lg:table-cell">Margen</th>
                    <th className="px-5 py-4 text-right hidden lg:table-cell">Tickets</th>
                    <th className="px-5 py-4 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {suppliers.map((s, i) => {
                    const margen = s.totalVentas > 0 ? (s.ganancia / s.totalVentas) * 100 : 0;
                    const barPct = (s.totalVentas / maxVentas) * 100;
                    return (
                      <tr key={s.id}
                        onClick={() => openSupplier(s)}
                        className="hover:bg-background transition-colors cursor-pointer group">
                        <td className="px-5 py-3">
                          <div className={cn(
                            'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-label font-bold',
                            i === 0 ? 'bg-primary text-on-primary' : i < 3 ? 'bg-primary/20 text-primary' : 'bg-surface-container text-stone-400'
                          )}>
                            {i + 1}
                          </div>
                        </td>
                        <td className="px-5 py-3 max-w-[240px]">
                          <p className="font-semibold text-sm text-on-surface font-body truncate">{displayName(s)}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {s.rfc && (
                              <span className="text-[9px] font-label text-stone-400 bg-surface-container px-1.5 py-0.5 rounded uppercase tracking-wider">
                                {s.rfc}
                              </span>
                            )}
                            {/* Sales bar */}
                            {s.totalVentas > 0 && (
                              <div className="flex-1 h-1 bg-surface-container rounded-full overflow-hidden max-w-[80px]">
                                <div className="h-full bg-primary/50 rounded-full" style={{ width: `${barPct}%` }} />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span className="text-sm font-body text-stone-500">{s.totalProductos}</span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          {s.totalVentas > 0 ? (
                            <span className="text-sm font-bold font-body text-on-surface">{fmt(s.totalVentas)}</span>
                          ) : (
                            <span className="text-xs font-label text-stone-300 uppercase tracking-widest">Sin ventas</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={cn('text-sm font-serif font-bold', s.ganancia >= 0 ? 'text-primary' : 'text-error')}>
                            {s.totalVentas > 0 ? fmt(s.ganancia) : '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right hidden lg:table-cell">
                          {s.totalVentas > 0 ? (
                            <span className={cn('text-xs font-label font-bold px-2 py-1 rounded-full',
                              margen >= 30 ? 'bg-primary-fixed/30 text-emerald-700'
                              : margen >= 15 ? 'bg-secondary-fixed/30 text-amber-700'
                              : 'bg-error-container/30 text-error')}>
                              {margen.toFixed(1)}%
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-5 py-3 text-right hidden lg:table-cell">
                          <span className="text-sm font-body text-stone-500">
                            {s.totalVentas > 0 ? s.totalTickets.toLocaleString('es-MX') : '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <Icon name="chevron_right" className="text-stone-300 group-hover:text-primary transition-colors text-lg" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {suppliers.length === 0 && (
              <div className="py-20 flex flex-col items-center text-stone-300">
                <Icon name="local_shipping" className="text-6xl opacity-20 mb-4" />
                <p className="text-sm font-label uppercase tracking-widest">Sin proveedores</p>
              </div>
            )}

            <div className="px-5 py-3 border-t border-surface-container bg-surface-container-low/30 flex items-center justify-between">
              <p className="text-[10px] font-label text-stone-400 uppercase tracking-widest">
                Mostrando {suppliers.length} de {totalSuppliers} proveedores
                {suppliers.filter(s => s.totalVentas > 0).length > 0 && (
                  <span className="ml-2 text-primary font-bold">
                    · {suppliers.filter(s => s.totalVentas > 0).length} con ventas {PERIOD_LABEL[period]}
                  </span>
                )}
              </p>
              <p className="hidden lg:block text-[9px] font-label text-stone-300 uppercase tracking-widest">
                Clic en fila para ver detalle
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
