'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';

interface SinAltaRow { codigo: string; nombre: string | null; stock: number; }

// Banner + panel para dar de alta en NovaCaja los productos que tienen stock en la
// bodega (TC52) pero nunca se registraron en el POS. El admin pone el precio y el
// backend clona una plantilla (departamento/impuesto/unidad/flags) creando el
// producto en las 6 tablas. Nombre y stock vienen pre-llenados de la bodega.
export default function SinAltaNovacaja({ onAltaDone }: { onAltaDone?: () => void }) {
  const [open,     setOpen]     = useState(false);
  const [rows,     setRows]     = useState<SinAltaRow[]>([]);
  const [total,    setTotal]    = useState(0);
  // Total SIN filtro (para el banner y el return null). Se separa del `total`
  // filtrado porque una búsqueda sin resultados pondría total=0 y, al cerrar,
  // desaparecería el banner por completo.
  const [baseTotal, setBaseTotal] = useState(0);
  const [loading,  setLoading]  = useState(false);
  const [q,        setQ]        = useState('');
  const [precios,  setPrecios]  = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notif,    setNotif]    = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type }); setTimeout(() => setNotif(null), 3000);
  };

  const fetchList = useCallback(async (query = '') => {
    setLoading(true);
    try {
      const url  = query ? `/api/almacen/sin-alta?q=${encodeURIComponent(query)}` : '/api/almacen/sin-alta';
      const res  = await fetch(url);
      const data = await res.json();
      setRows(Array.isArray(data.data) ? data.data : []);
      setTotal(data.total ?? 0);
      if (!query) setBaseTotal(data.total ?? 0);   // solo la carga sin filtro fija el total del banner
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  // Carga inicial (para el conteo del banner). Cacheado 2 min en el backend.
  useEffect(() => { fetchList(); }, [fetchList]);

  // Búsqueda con debounce (solo cuando el panel está abierto)
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open) return;
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => fetchList(q), 350);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [q, open, fetchList]);

  const darAlta = async (r: SinAltaRow) => {
    if (savingId) return;                                // evita doble-submit (Enter + click)
    const precio = parseFloat(precios[r.codigo]);
    if (!(precio >= 0)) { notify('Ponle un precio de venta válido', 'error'); return; }
    if (!r.nombre)      { notify('Este producto no tiene nombre en la bodega', 'error'); return; }
    setSavingId(r.codigo);
    try {
      const res  = await fetch('/api/almacen/sin-alta/alta', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ codigo: r.codigo, descripcion: r.nombre, precio, stock: r.stock }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        notify(`Alta OK: ${r.nombre} ($${precio})`);
        setRows(rs => rs.filter(x => x.codigo !== r.codigo));
        setTotal(t => Math.max(0, t - 1));
        setBaseTotal(t => Math.max(0, t - 1));
        onAltaDone?.();
      } else {
        notify(data.mensaje || 'Error al dar de alta', 'error');
      }
    } catch { notify('Error de conexión', 'error'); }
    finally { setSavingId(null); }
  };

  if (baseTotal === 0 && !open) return null;

  return (
    <>
      {/* Toast propio (por si el panel está sobre el de Inventario) */}
      {notif && (
        <div className={cn(
          'fixed top-6 right-6 z-[320] px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-label font-bold',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
        )}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* Banner de alerta */}
      {baseTotal > 0 && (
        <button onClick={() => setOpen(true)}
          className="w-full mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-300/60 bg-amber-50 text-left hover:bg-amber-100 transition-colors">
          <Icon name="warning" className="text-amber-500 text-xl flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-body font-bold text-amber-900">
              {baseTotal.toLocaleString('es-MX')} productos con stock en bodega sin alta en NovaCaja
            </p>
            <p className="text-[11px] font-label text-amber-700/80">
              Al venderlos en caja no aparece nombre ni precio. Toca para darlos de alta.
            </p>
          </div>
          <span className="text-[10px] font-label font-bold uppercase tracking-widest text-amber-700 bg-amber-200/60 px-3 py-1.5 rounded-lg whitespace-nowrap">
            Dar de alta →
          </span>
        </button>
      )}

      {/* Panel modal */}
      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[300]" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-0 top-[3vh] mx-auto z-[301] w-[95%] max-w-3xl h-[94vh] bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-outline-variant/15">
            {/* Header */}
            <div className="p-5 border-b border-outline-variant/10 bg-surface-container-low flex items-start justify-between flex-shrink-0 gap-4">
              <div className="min-w-0">
                <h3 className="font-serif text-xl text-primary">Productos sin alta en NovaCaja</h3>
                <p className="text-[11px] font-label text-stone-500 mt-0.5">
                  {total.toLocaleString('es-MX')} con stock en bodega · pon el precio y da de alta (nombre y stock ya vienen de la bodega)
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 hover:bg-surface-variant rounded-full text-stone-400 flex-shrink-0">
                <Icon name="close" />
              </button>
            </div>

            {/* Buscador */}
            <div className="px-5 py-3 border-b border-surface-container flex-shrink-0">
              <div className="relative">
                <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xl" />
                {loading && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />}
                <input value={q} onChange={e => setQ(e.target.value)}
                  placeholder="Buscar por nombre o código..."
                  className="w-full pl-10 pr-10 py-2.5 bg-background border border-outline-variant/20 rounded-xl text-sm font-body outline-none focus:border-primary" />
              </div>
            </div>

            {/* Lista */}
            <div className="flex-1 overflow-y-auto p-3">
              {loading && rows.length === 0 ? (
                <div className="flex justify-center py-16">
                  <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                </div>
              ) : rows.length === 0 ? (
                <div className="py-16 flex flex-col items-center text-stone-300">
                  <Icon name="task_alt" className="text-5xl opacity-30 mb-3" />
                  <p className="text-sm font-label uppercase tracking-widest">Sin resultados</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {rows.map(r => (
                    <div key={r.codigo}
                      className="flex items-center gap-3 px-3 py-2.5 bg-surface-container-low/40 rounded-xl border border-outline-variant/10">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-body font-bold text-on-surface truncate">{r.nombre || <span className="text-error">(sin nombre)</span>}</p>
                        <p className="text-[10px] font-label text-stone-400">{r.codigo} · {r.stock} pzas en bodega</p>
                      </div>
                      <div className="relative flex-shrink-0">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                        <input type="number" min="0" step="0.50" inputMode="decimal"
                          value={precios[r.codigo] ?? ''}
                          onChange={e => setPrecios(p => ({ ...p, [r.codigo]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') darAlta(r); }}
                          placeholder="precio"
                          className="w-24 pl-6 pr-2 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-serif text-right outline-none focus:border-primary" />
                      </div>
                      <button onClick={() => darAlta(r)} disabled={savingId === r.codigo || !r.nombre}
                        className={cn(
                          'px-3 py-2 rounded-lg text-[11px] font-label font-bold uppercase tracking-widest whitespace-nowrap flex items-center gap-1.5 transition-all flex-shrink-0',
                          savingId === r.codigo || !r.nombre
                            ? 'bg-stone-200 text-stone-400 cursor-not-allowed'
                            : 'bg-primary text-on-primary hover:bg-primary-container shadow-sm'
                        )}>
                        {savingId === r.codigo
                          ? <div className="w-3.5 h-3.5 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
                          : <Icon name="add_business" className="text-sm" />}
                        Alta
                      </button>
                    </div>
                  ))}
                  {rows.length >= 500 && (
                    <p className="text-center text-[10px] font-label text-stone-400 uppercase tracking-widest py-3">
                      Mostrando los primeros 500 (de {total.toLocaleString('es-MX')}) · usa el buscador para el resto
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
