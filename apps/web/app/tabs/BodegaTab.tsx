'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import type {
  Area, AreaCount, AreaProduct, ExpiryRecord,
  SurtidoTransfer, Recuento, StagnantProduct,
} from '../lib/types';

// ── Sub-view config ────────────────────────────────────────────────────────────
type SubView = 'areas' | 'merma' | 'surtido' | 'discrepancias' | 'facturas' | 'zebra';
const SUB_VIEWS: { id: SubView; label: string; icon: string; dev?: boolean }[] = [
  { id: 'areas',         label: 'Áreas',          icon: 'warehouse' },
  { id: 'merma',         label: 'Merma / Caducidad', icon: 'event_busy' },
  { id: 'surtido',       label: 'Surtido',         icon: 'swap_horiz' },
  { id: 'discrepancias', label: 'Discrepancias',   icon: 'difference' },
  { id: 'facturas',      label: 'Facturas PDF',    icon: 'receipt_long', dev: true },
  { id: 'zebra',         label: 'Zebra TC52',      icon: 'qr_code_scanner', dev: true },
];

const AREA_META: Record<Area, { label: string; icon: string; color: string; bg: string }> = {
  bodega:       { label: 'Bodega',       icon: 'warehouse',    color: 'text-blue-700',  bg: 'bg-blue-50' },
  cocina:       { label: 'Cocina',       icon: 'restaurant',   color: 'text-amber-700', bg: 'bg-amber-50' },
  tienda:       { label: 'Tienda',       icon: 'storefront',   color: 'text-green-700', bg: 'bg-green-50' },
  refrigerador: { label: 'Refrigerador', icon: 'ac_unit',      color: 'text-cyan-700',  bg: 'bg-cyan-50' },
  otro:         { label: 'Otro',         icon: 'category',     color: 'text-stone-600', bg: 'bg-stone-100' },
};
const AREAS = Object.keys(AREA_META) as Area[];

// ── Dev-in-progress placeholder ────────────────────────────────────────────────
function DevPlaceholder({ label, icon }: { label: string; icon: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
        <Icon name={icon} className="text-4xl text-primary" />
      </div>
      <h3 className="text-2xl font-serif text-primary mb-2">{label}</h3>
      <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-full border border-amber-200 text-xs font-label font-bold uppercase tracking-widest mt-2">
        <Icon name="construction" className="text-base" />
        En Desarrollo
      </div>
      <p className="text-sm text-stone-400 font-body mt-4 max-w-sm">
        Esta función está siendo desarrollada y estará disponible próximamente. Regresa pronto.
      </p>
    </div>
  );
}

// ── Áreas sub-view ─────────────────────────────────────────────────────────────
function AreasView() {
  const [counts,        setCounts]        = useState<AreaCount[]>([]);
  const [selectedArea,  setSelectedArea]  = useState<Area | null>(null);
  const [areaProducts,  setAreaProducts]  = useState<AreaProduct[]>([]);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [loadingProds,  setLoadingProds]  = useState(false);
  const [search,        setSearch]        = useState('');
  const [reassignId,    setReassignId]    = useState<string | null>(null);
  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3000);
  };

  const fetchCounts = useCallback(async () => {
    setLoadingCounts(true);
    try {
      const data = await fetch('/api/bodega/area-counts').then(r => r.json());
      if (Array.isArray(data)) setCounts(data);
    } catch { /* silent */ }
    finally { setLoadingCounts(false); }
  }, []);

  const fetchAreaProducts = useCallback(async (area: Area, q = '') => {
    setLoadingProds(true);
    try {
      const url  = `/api/bodega/areas/${area}/products${q ? `?search=${encodeURIComponent(q)}` : ''}`;
      const data = await fetch(url).then(r => r.json());
      setAreaProducts(Array.isArray(data) ? data : []);
    } catch { setAreaProducts([]); }
    finally { setLoadingProds(false); }
  }, []);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  useEffect(() => {
    if (selectedArea) fetchAreaProducts(selectedArea, search);
  }, [selectedArea, fetchAreaProducts]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedArea) fetchAreaProducts(selectedArea, search);
  };

  const reassign = async (artCodigo: string, newArea: Area) => {
    try {
      const res  = await fetch(`/api/bodega/products/${artCodigo}/location`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ area: newArea }),
      });
      const data = await res.json();
      if (res.ok) {
        notify(`Movido a ${AREA_META[newArea].label}`);
        setReassignId(null);
        if (selectedArea) fetchAreaProducts(selectedArea, search);
        fetchCounts();
      } else notify(data.error || 'Error', 'error');
    } catch { notify('Error de conexión', 'error'); }
  };

  if (!selectedArea) {
    return (
      <div>
        {notif && (
          <div className={cn(
            'fixed top-4 right-4 z-[300] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
            notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
          )}>
            <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
            {notif.msg}
          </div>
        )}
        <p className="text-[11px] font-label uppercase tracking-widest text-stone-400 mb-6">
          Selecciona un área para ver los productos asignados
        </p>
        {loadingCounts ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-3 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {AREAS.map(area => {
              const meta  = AREA_META[area];
              const count = counts.find(c => c.area === area)?.total ?? 0;
              return (
                <button key={area}
                  onClick={() => { setSelectedArea(area); setSearch(''); }}
                  className="group bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/10 hover:border-primary/30 hover:shadow-lg transition-all text-left flex flex-col gap-3">
                  <div className={cn('w-12 h-12 rounded-full flex items-center justify-center', meta.bg)}>
                    <Icon name={meta.icon} className={cn('text-2xl', meta.color)} />
                  </div>
                  <div>
                    <p className="font-serif text-lg text-on-surface">{meta.label}</p>
                    <p className={cn('text-2xl font-serif font-bold mt-1', meta.color)}>{count}</p>
                    <p className="text-[9px] font-label uppercase tracking-widest text-stone-400">
                      {count === 1 ? 'producto' : 'productos'}
                      {area === 'bodega' && count === 0 && (
                        <span className="ml-1">(todos)</span>
                      )}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[10px] font-label text-stone-400 mt-4 text-center">
          Los productos sin área asignada se encuentran en Bodega por defecto
        </p>
      </div>
    );
  }

  const meta = AREA_META[selectedArea];
  return (
    <div>
      {notif && (
        <div className={cn(
          'fixed top-4 right-4 z-[300] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
        )}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* Back + header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => { setSelectedArea(null); setSearch(''); setAreaProducts([]); }}
          className="p-2 hover:bg-stone-100 rounded-full text-stone-500 transition-colors">
          <Icon name="arrow_back" className="text-xl" />
        </button>
        <div className={cn('w-10 h-10 rounded-full flex items-center justify-center', meta.bg)}>
          <Icon name={meta.icon} className={cn('text-xl', meta.color)} />
        </div>
        <div>
          <h3 className="font-serif text-xl text-primary">{meta.label}</h3>
          <p className="text-[10px] font-label uppercase tracking-widest text-stone-400">
            {areaProducts.length} productos
          </p>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-5">
        <div className="relative flex-1">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xl" />
          <input
            type="text"
            placeholder="Buscar producto o código..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-background border border-outline-variant/20 rounded-xl text-sm font-body outline-none focus:border-primary transition-colors"
          />
        </div>
        <button type="submit"
          className="px-4 py-2.5 bg-primary text-on-primary rounded-xl text-xs font-label font-bold uppercase tracking-widest">
          Buscar
        </button>
      </form>

      {/* Products table */}
      {loadingProds ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container">
              <tr>
                <th className="px-5 py-3">Producto</th>
                <th className="px-5 py-3 text-center">Stock</th>
                <th className="px-5 py-3">Categoría</th>
                <th className="px-5 py-3 text-right">Mover a</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container">
              {areaProducts.map(p => (
                <tr key={p.id} className="hover:bg-background transition-colors group">
                  <td className="px-5 py-3">
                    <p className="text-sm font-body text-on-surface">{p.name}</p>
                    <p className="text-[9px] font-label text-stone-400 mt-0.5">{p.id}</p>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className="font-serif text-lg text-on-surface">{p.stock}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-[10px] font-label text-stone-500 bg-surface-container px-2 py-0.5 rounded uppercase tracking-wider">
                      {p.category || 'Sin categoría'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {reassignId === p.id ? (
                      <div className="flex gap-1 justify-end flex-wrap">
                        {AREAS.filter(a => a !== selectedArea).map(a => (
                          <button key={a}
                            onClick={() => reassign(p.id, a)}
                            className={cn(
                              'px-2 py-1 rounded-lg text-[9px] font-label font-bold uppercase tracking-wider transition-all',
                              AREA_META[a].bg, AREA_META[a].color
                            )}>
                            {AREA_META[a].label}
                          </button>
                        ))}
                        <button onClick={() => setReassignId(null)}
                          className="p-1 text-stone-400 hover:text-stone-600 rounded-lg">
                          <Icon name="close" className="text-sm" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setReassignId(p.id)}
                        className="opacity-0 group-hover:opacity-100 px-3 py-1.5 bg-surface-container text-stone-500 rounded-lg text-[10px] font-label hover:bg-primary/10 hover:text-primary transition-all">
                        <Icon name="swap_horiz" className="text-sm" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {areaProducts.length === 0 && (
            <div className="py-14 flex flex-col items-center text-stone-300">
              <Icon name="inventory_2" className="text-5xl mb-3 opacity-20" />
              <p className="text-sm font-label uppercase tracking-widest">Sin productos en esta área</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Merma / Caducidad sub-view ──────────────────────────────────────────────────
function MermaView() {
  const [records, setRecords] = useState<ExpiryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ art_codigo: '', nombre: '', fecha_caducidad: '', cantidad: '', area: 'bodega' as Area, notas: '' });
  const [saving, setSaving] = useState(false);
  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3500);
  };

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetch('/api/bodega/expiry').then(r => r.json());
      setRecords(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const saveExpiry = async () => {
    if (!form.art_codigo || !form.fecha_caducidad) {
      notify('Código y fecha son requeridos', 'error'); return;
    }
    setSaving(true);
    try {
      const res  = await fetch('/api/bodega/expiry', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        notify(data.message || 'Guardado');
        setShowForm(false);
        setForm({ art_codigo: '', nombre: '', fecha_caducidad: '', cantidad: '', area: 'bodega', notas: '' });
        fetchRecords();
      } else notify(data.error || 'Error', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSaving(false); }
  };

  const deleteRecord = async (id: number) => {
    try {
      await fetch(`/api/bodega/expiry/${id}`, { method: 'DELETE' });
      notify('Eliminado');
      fetchRecords();
    } catch { notify('Error', 'error'); }
  };

  const sendAlert = async (items: ExpiryRecord[]) => {
    setSending(true);
    try {
      const res  = await fetch('/api/bodega/alerts/send-email', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: 'expiry', items }),
      });
      const data = await res.json();
      if (res.ok) notify(data.message || 'Alerta enviada');
      else notify(data.error || 'Error al enviar', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSending(false); }
  };

  const today    = new Date().toISOString().slice(0, 10);
  const in7      = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const in30     = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const expired  = records.filter(r => r.fecha_caducidad < today);
  const critical = records.filter(r => r.fecha_caducidad >= today && r.fecha_caducidad <= in7);
  const warning  = records.filter(r => r.fecha_caducidad > in7 && r.fecha_caducidad <= in30);
  const ok       = records.filter(r => r.fecha_caducidad > in30);

  const rowColor = (r: ExpiryRecord) => {
    if (r.fecha_caducidad < today) return 'border-error/20 bg-error-container/10';
    if (r.fecha_caducidad <= in7)  return 'border-orange-200 bg-orange-50/50';
    if (r.fecha_caducidad <= in30) return 'border-yellow-200 bg-yellow-50/30';
    return 'border-outline-variant/10';
  };

  const badgeColor = (r: ExpiryRecord) => {
    if (r.fecha_caducidad < today) return 'bg-error text-on-error';
    if (r.fecha_caducidad <= in7)  return 'bg-orange-500 text-white';
    if (r.fecha_caducidad <= in30) return 'bg-yellow-400 text-yellow-900';
    return 'bg-primary-fixed text-on-primary-fixed-variant';
  };

  const badgeLabel = (r: ExpiryRecord) => {
    if (r.fecha_caducidad < today) return 'Vencido';
    const days = Math.ceil((new Date(r.fecha_caducidad).getTime() - new Date(today).getTime()) / 86400_000);
    return days === 0 ? 'Hoy' : `${days}d`;
  };

  return (
    <div>
      {notif && (
        <div className={cn(
          'fixed top-4 right-4 z-[300] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
        )}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 mb-5">
        {[
          { label: 'Vencidos',      count: expired.length,  color: 'bg-error-container/50 text-on-error-container' },
          { label: 'Crítico (7d)',  count: critical.length, color: 'bg-orange-100 text-orange-700' },
          { label: 'Aviso (30d)',   count: warning.length,  color: 'bg-yellow-100 text-yellow-700' },
          { label: 'En orden',      count: ok.length,       color: 'bg-primary-fixed/30 text-primary' },
        ].map(c => (
          <span key={c.label}
            className={cn('px-3 py-1 rounded-full text-[10px] font-label font-bold uppercase tracking-widest', c.color)}>
            {c.label}: {c.count}
          </span>
        ))}
        {(expired.length > 0 || critical.length > 0) && (
          <button
            onClick={() => sendAlert([...expired, ...critical])}
            disabled={sending}
            className="ml-auto px-3 py-1 bg-primary text-on-primary rounded-full text-[10px] font-label font-bold uppercase tracking-widest flex items-center gap-1 hover:bg-primary-container transition-all">
            {sending ? (
              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Icon name="mail" className="text-sm" />
            )}
            Enviar Alerta por Correo
          </button>
        )}
      </div>

      {/* Add button */}
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 bg-primary text-on-primary rounded-lg text-xs font-label font-bold uppercase tracking-widest flex items-center gap-2 shadow-md hover:bg-primary-container transition-all">
          <Icon name={showForm ? 'close' : 'add'} className="text-base" />
          {showForm ? 'Cancelar' : 'Registrar Caducidad'}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="bg-surface-container-low rounded-xl border border-primary/20 p-5 mb-5 space-y-4">
          <h4 className="text-[10px] font-label font-bold uppercase tracking-widest text-stone-500">Nuevo Registro de Caducidad</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Código *</label>
              <input value={form.art_codigo} onChange={e => setForm(f => ({ ...f, art_codigo: e.target.value }))}
                placeholder="Art_Codigo"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Nombre</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Nombre del producto"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Fecha de caducidad *</label>
              <input type="date" value={form.fecha_caducidad} onChange={e => setForm(f => ({ ...f, fecha_caducidad: e.target.value }))}
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Cantidad</label>
              <input type="number" min="0" value={form.cantidad} onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))}
                placeholder="Ej: 10"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Área</label>
              <select value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value as Area }))}
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors">
                {AREAS.map(a => <option key={a} value={a}>{AREA_META[a].label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                placeholder="Opcional"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
          </div>
          <button onClick={saveExpiry} disabled={saving}
            className={cn(
              'w-full py-2.5 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all',
              saving ? 'bg-stone-200 text-stone-400' : 'bg-primary text-on-primary hover:bg-primary-container'
            )}>
            {saving
              ? <div className="w-4 h-4 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
              : <Icon name="save" className="text-base" />}
            Guardar
          </button>
        </div>
      )}

      {/* Records list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : records.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-stone-300">
          <Icon name="event_available" className="text-5xl opacity-20 mb-3" />
          <p className="text-sm font-label uppercase tracking-widest">Sin registros de caducidad</p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map(r => (
            <div key={r.id}
              className={cn('rounded-xl border p-4 flex items-center gap-4 transition-all', rowColor(r))}>
              <div className={cn('px-2.5 py-1 rounded-full text-[10px] font-label font-bold min-w-[50px] text-center', badgeColor(r))}>
                {badgeLabel(r)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-body text-sm text-on-surface truncate">{r.nombre || r.art_codigo}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[10px] font-label text-stone-400">
                    Vence: {new Date(r.fecha_caducidad + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  {r.cantidad > 0 && (
                    <span className="text-[10px] font-label text-stone-400">{r.cantidad} uds</span>
                  )}
                  <span className={cn('text-[9px] font-label px-1.5 py-0.5 rounded uppercase', AREA_META[r.area as Area]?.bg, AREA_META[r.area as Area]?.color)}>
                    {AREA_META[r.area as Area]?.label || r.area}
                  </span>
                </div>
              </div>
              <button onClick={() => deleteRecord(r.id)}
                className="p-1.5 text-stone-300 hover:text-error hover:bg-error-container/20 rounded-lg transition-colors flex-shrink-0">
                <Icon name="delete_outline" className="text-lg" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Surtido sub-view ──────────────────────────────────────────────────────────
function SurtidoView() {
  const [transfers, setTransfers] = useState<SurtidoTransfer[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [showForm,  setShowForm]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [form, setForm] = useState({
    art_codigo: '', nombre: '',
    de_area: 'bodega' as Area, a_area: 'cocina' as Area,
    cantidad: '', notas: '',
  });
  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3000);
  };

  const fetchTransfers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetch('/api/bodega/surtido').then(r => r.json());
      setTransfers(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTransfers(); }, [fetchTransfers]);

  const saveTransfer = async () => {
    if (!form.art_codigo || !form.cantidad) { notify('Código y cantidad son requeridos', 'error'); return; }
    setSaving(true);
    try {
      const res  = await fetch('/api/bodega/surtido', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        notify(data.message || 'Transferencia registrada');
        setShowForm(false);
        setForm({ art_codigo: '', nombre: '', de_area: 'bodega', a_area: 'cocina', cantidad: '', notas: '' });
        fetchTransfers();
      } else notify(data.error || 'Error', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSaving(false); }
  };

  const autorizar = async (id: number) => {
    try {
      const res  = await fetch(`/api/bodega/surtido/${id}/autorizar`, { method: 'PUT' });
      const data = await res.json();
      if (res.ok) { notify(data.message || 'Autorizado'); fetchTransfers(); }
      else notify(data.error || 'Error', 'error');
    } catch { notify('Error de conexión', 'error'); }
  };

  // Group by week
  const byWeek = transfers.reduce<Record<string, SurtidoTransfer[]>>((acc, t) => {
    const key = t.semana || 'Sin semana';
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  return (
    <div>
      {notif && (
        <div className={cn(
          'fixed top-4 right-4 z-[300] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
        )}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center mb-5">
        <p className="text-[11px] font-label uppercase tracking-widest text-stone-400">
          Registro de movimientos bodega ↔ áreas
        </p>
        <button onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 bg-primary text-on-primary rounded-lg text-xs font-label font-bold uppercase tracking-widest flex items-center gap-2 shadow-md hover:bg-primary-container transition-all">
          <Icon name={showForm ? 'close' : 'add'} className="text-base" />
          {showForm ? 'Cancelar' : 'Nuevo Surtido'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-surface-container-low rounded-xl border border-primary/20 p-5 mb-5 space-y-4">
          <h4 className="text-[10px] font-label font-bold uppercase tracking-widest text-stone-500">Registrar Surtido</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Código *</label>
              <input value={form.art_codigo} onChange={e => setForm(f => ({ ...f, art_codigo: e.target.value }))}
                placeholder="Art_Codigo"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Nombre</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Nombre del producto"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">De área</label>
              <select value={form.de_area} onChange={e => setForm(f => ({ ...f, de_area: e.target.value as Area }))}
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors">
                {AREAS.map(a => <option key={a} value={a}>{AREA_META[a].label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">A área</label>
              <select value={form.a_area} onChange={e => setForm(f => ({ ...f, a_area: e.target.value as Area }))}
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors">
                {AREAS.map(a => <option key={a} value={a}>{AREA_META[a].label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Cantidad *</label>
              <input type="number" min="0.01" step="0.01" value={form.cantidad} onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))}
                placeholder="Ej: 5"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                placeholder="Opcional"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs font-body text-amber-700">
            <strong>Nota:</strong> Al <strong>autorizar</strong> una transferencia desde Bodega, la cantidad se descontará automáticamente del inventario principal en el sistema.
          </div>
          <button onClick={saveTransfer} disabled={saving}
            className={cn(
              'w-full py-2.5 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all',
              saving ? 'bg-stone-200 text-stone-400' : 'bg-primary text-on-primary hover:bg-primary-container'
            )}>
            {saving
              ? <div className="w-4 h-4 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
              : <Icon name="save" className="text-base" />}
            Registrar
          </button>
        </div>
      )}

      {/* Transfers by week */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : transfers.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-stone-300">
          <Icon name="swap_horiz" className="text-5xl opacity-20 mb-3" />
          <p className="text-sm font-label uppercase tracking-widest">Sin transferencias registradas</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byWeek).map(([week, list]) => (
            <div key={week}>
              <p className="text-[10px] font-label font-bold uppercase tracking-widest text-stone-400 mb-2">{week}</p>
              <div className="space-y-2">
                {list.map(t => (
                  <div key={t.id}
                    className={cn(
                      'bg-surface-container-lowest rounded-xl border p-4 flex items-center gap-4',
                      t.autorizado ? 'border-primary/15' : 'border-outline-variant/10'
                    )}>
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <div className={cn('w-8 h-8 rounded-full flex items-center justify-center', AREA_META[t.de_area as Area]?.bg || 'bg-stone-100')}>
                        <Icon name={AREA_META[t.de_area as Area]?.icon || 'warehouse'} className={cn('text-sm', AREA_META[t.de_area as Area]?.color || 'text-stone-500')} />
                      </div>
                      <Icon name="arrow_downward" className="text-stone-300 text-sm" />
                      <div className={cn('w-8 h-8 rounded-full flex items-center justify-center', AREA_META[t.a_area as Area]?.bg || 'bg-stone-100')}>
                        <Icon name={AREA_META[t.a_area as Area]?.icon || 'category'} className={cn('text-sm', AREA_META[t.a_area as Area]?.color || 'text-stone-500')} />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm text-on-surface truncate">{t.nombre || t.art_codigo}</p>
                      <p className="text-[10px] font-label text-stone-400 mt-0.5">
                        {AREA_META[t.de_area as Area]?.label || t.de_area} → {AREA_META[t.a_area as Area]?.label || t.a_area} · {t.cantidad} uds
                      </p>
                      <p className="text-[9px] font-label text-stone-300">
                        {new Date(t.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                        {t.notas && ` · ${t.notas}`}
                      </p>
                    </div>
                    {t.autorizado ? (
                      <span className="flex-shrink-0 px-2.5 py-1 bg-primary-fixed/30 text-primary text-[9px] font-label font-bold uppercase tracking-widest rounded-full">
                        Autorizado
                      </span>
                    ) : (
                      <button onClick={() => autorizar(t.id)}
                        className="flex-shrink-0 px-3 py-1.5 bg-primary text-on-primary rounded-lg text-[10px] font-label font-bold uppercase tracking-widest hover:bg-primary-container transition-all shadow-sm">
                        Autorizar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Discrepancias sub-view ─────────────────────────────────────────────────────
function DiscrepanciasView() {
  const [stagnant,  setStagnant]  = useState<StagnantProduct[]>([]);
  const [recuentos, setRecuentos] = useState<Recuento[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [showForm,  setShowForm]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [form, setForm] = useState({ art_codigo: '', nombre: '', stock_sistema: '', stock_conteo: '', area: 'bodega' as Area, notas: '' });
  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type }); setTimeout(() => setNotif(null), 3000);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetch('/api/bodega/discrepancias').then(r => r.json());
      setStagnant(data.stagnant || []);
      setRecuentos(data.recuentos || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const saveRecuento = async () => {
    if (!form.art_codigo) { notify('Código requerido', 'error'); return; }
    setSaving(true);
    try {
      const res  = await fetch('/api/bodega/recuento', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) { notify(data.message || 'Guardado'); setShowForm(false); setForm({ art_codigo: '', nombre: '', stock_sistema: '', stock_conteo: '', area: 'bodega', notas: '' }); fetchData(); }
      else notify(data.error || 'Error', 'error');
    } catch { notify('Error', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      {notif && (
        <div className={cn(
          'fixed top-4 right-4 z-[300] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
        )}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* Stagnant products from MSSQL */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="font-serif text-base text-primary">Inventario Sin Movimiento</h4>
            <p className="text-[10px] font-label uppercase tracking-widest text-stone-400">
              Productos con stock pero sin ventas en los últimos 30 días
            </p>
          </div>
          <button onClick={() => setShowForm(v => !v)}
            className="px-3 py-1.5 bg-surface-container-low text-stone-500 rounded-lg text-[10px] font-label font-bold uppercase tracking-widest flex items-center gap-1.5 hover:bg-primary/10 hover:text-primary transition-all border border-outline-variant/20">
            <Icon name="checklist" className="text-sm" />
            Registrar Recuento
          </button>
        </div>

        {/* Recount form */}
        {showForm && (
          <div className="bg-surface-container-low rounded-xl border border-primary/20 p-5 mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Código *</label>
                <input value={form.art_codigo} onChange={e => setForm(f => ({ ...f, art_codigo: e.target.value }))} placeholder="Art_Codigo"
                  className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
              </div>
              <div>
                <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Nombre</label>
                <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre"
                  className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
              </div>
              <div>
                <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Stock sistema</label>
                <input type="number" min="0" value={form.stock_sistema} onChange={e => setForm(f => ({ ...f, stock_sistema: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
              </div>
              <div>
                <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Stock conteo físico</label>
                <input type="number" min="0" value={form.stock_conteo} onChange={e => setForm(f => ({ ...f, stock_conteo: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveRecuento} disabled={saving}
                className={cn('flex-1 py-2 rounded-lg text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all',
                  saving ? 'bg-stone-200 text-stone-400' : 'bg-primary text-on-primary hover:bg-primary-container')}>
                {saving ? <div className="w-3 h-3 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" /> : null}
                Guardar
              </button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-surface-container text-stone-500 rounded-lg text-xs font-label uppercase tracking-widest">Cancelar</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-7 h-7 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container">
                <tr>
                  <th className="px-5 py-3">Producto</th>
                  <th className="px-5 py-3 text-center">Stock</th>
                  <th className="px-5 py-3">Última Venta</th>
                  <th className="px-5 py-3">Categoría</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {stagnant.map(p => (
                  <tr key={p.id} className="hover:bg-background transition-colors">
                    <td className="px-5 py-3">
                      <p className="text-sm font-body text-on-surface">{p.name}</p>
                      <p className="text-[9px] font-label text-stone-400">{p.id}</p>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className="font-serif text-lg text-amber-600">{p.stock}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-body text-stone-500">
                        {p.ultima_venta
                          ? new Date(p.ultima_venta).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
                          : 'Sin registro'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-[10px] font-label text-stone-500 bg-surface-container px-2 py-0.5 rounded uppercase tracking-wider">
                        {p.category || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stagnant.length === 0 && !loading && (
              <div className="py-10 flex flex-col items-center text-stone-300">
                <Icon name="check_circle" className="text-4xl opacity-20 mb-2" />
                <p className="text-xs font-label uppercase tracking-widest">Sin productos estancados</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Recuento history */}
      {recuentos.length > 0 && (
        <div>
          <h4 className="font-serif text-base text-primary mb-3">Historial de Recuentos</h4>
          <div className="space-y-2">
            {recuentos.map(r => {
              const diff = r.stock_conteo - r.stock_sistema;
              return (
                <div key={r.id} className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-4 flex items-center gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-body text-on-surface">{r.nombre || r.art_codigo}</p>
                    <p className="text-[10px] font-label text-stone-400">
                      {new Date(r.created_at).toLocaleDateString('es-MX')} · {AREA_META[r.area as Area]?.label || r.area}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-label text-stone-400">Sistema: {r.stock_sistema} · Conteo: {r.stock_conteo}</p>
                    <span className={cn('text-xs font-serif font-bold', diff === 0 ? 'text-primary' : diff > 0 ? 'text-emerald-600' : 'text-error')}>
                      {diff > 0 ? '+' : ''}{diff} uds
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main BodegaTab ─────────────────────────────────────────────────────────────
export default function BodegaTab() {
  const [view, setView] = useState<SubView>('areas');

  return (
    <section className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">

      {/* Title */}
      <div className="mb-6">
        <h2 className="text-3xl font-serif italic text-primary">Control de Bodega</h2>
        <p className="text-[10px] font-label uppercase tracking-widest text-stone-500 mt-1">
          Control interno · merma · surtido · trazabilidad
        </p>
      </div>

      {/* Sub-nav */}
      <div className="flex gap-1 overflow-x-auto pb-1 mb-6 scrollbar-hide">
        {SUB_VIEWS.map(sv => (
          <button key={sv.id}
            onClick={() => setView(sv.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-label font-bold uppercase tracking-widest whitespace-nowrap transition-all flex-shrink-0',
              view === sv.id
                ? 'bg-primary text-on-primary shadow-md'
                : 'bg-surface-container-low text-stone-500 hover:text-primary hover:bg-primary/5'
            )}>
            <Icon name={sv.icon} className="text-base" />
            {sv.label}
            {sv.dev && (
              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[8px] font-bold rounded-full uppercase">
                Dev
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-[400px]">
        {view === 'areas'         && <AreasView />}
        {view === 'merma'         && <MermaView />}
        {view === 'surtido'       && <SurtidoView />}
        {view === 'discrepancias' && <DiscrepanciasView />}
        {view === 'facturas'      && <DevPlaceholder label="Automatización de Facturas PDF" icon="receipt_long" />}
        {view === 'zebra'         && <DevPlaceholder label="Mejora Operativa Zebra TC52" icon="qr_code_scanner" />}
      </div>
    </section>
  );
}
