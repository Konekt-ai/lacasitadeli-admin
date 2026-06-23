'use client';
import React, { useState, useEffect } from 'react';
import { Icon } from './Icon';

// Llave completa de un ticket físico. FolConsecutivo se recicla entre cajas/días,
// por eso el modal necesita los 4 campos para abrir el ticket EXACTO (no otro con
// el mismo número). tda/est/doc opcionales = modo legacy (el más reciente).
export type TicketKey = { folio: number; tda?: number; est?: number; doc?: number };

interface DetalleLinea {
  codigo:        string;
  concepto:      string;
  cantidad:      number;
  valorUnitario: number;
  importe:       number;
}

export function TicketDetalleModal({ tk, onClose }: { tk: TicketKey; onClose: () => void }) {
  const folio = tk.folio;
  const [lineas,  setLineas]  = useState<DetalleLinea[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Llave completa cuando viene del desglose/feed → abre ESE ticket físico exacto.
    const qs = (tk.tda != null && tk.est != null && tk.doc != null)
      ? `?tda=${tk.tda}&est=${tk.est}&doc=${tk.doc}` : '';
    fetch(`/api/novacaja/tickets/${folio}/detalle${qs}`)
      .then(r => r.ok ? r.json() : {})
      .then((data: any) => {
        if (Array.isArray(data)) setLineas(data);
        else if (data?.lineas)   setLineas(data.lineas);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [folio, tk.tda, tk.est, tk.doc]);

  const total = lineas.reduce((s, l) => s + Number(l.importe), 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-[400] flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10 flex-shrink-0">
          <div>
            <h3 className="font-serif text-xl text-primary">Ticket #{folio}</h3>
            <p className="text-[10px] font-label uppercase tracking-widest text-stone-400">
              {loading ? 'Cargando...' : `${lineas.length} producto${lineas.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-full text-stone-400 transition-colors">
            <Icon name="close" className="text-xl" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : lineas.length === 0 ? (
            <div className="py-12 flex flex-col items-center text-stone-300">
              <Icon name="receipt_long" className="text-5xl opacity-20 mb-3" />
              <p className="text-sm font-label uppercase tracking-widest">Sin detalle disponible</p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container sticky top-0">
                <tr>
                  <th className="px-5 py-3">Código</th>
                  <th className="px-5 py-3">Producto</th>
                  <th className="px-5 py-3 text-center">Cant.</th>
                  <th className="px-5 py-3 text-right">P. Unit.</th>
                  <th className="px-5 py-3 text-right">Importe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {lineas.map((l, i) => (
                  <tr key={i} className="hover:bg-background transition-colors">
                    <td className="px-5 py-3 text-[10px] font-label text-stone-400">{l.codigo}</td>
                    <td className="px-5 py-3 text-sm font-body text-on-surface">{l.concepto}</td>
                    <td className="px-5 py-3 text-center font-serif text-on-surface">{l.cantidad}</td>
                    <td className="px-5 py-3 text-right text-xs font-body text-stone-500">
                      ${Number(l.valorUnitario).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-3 text-right font-serif font-bold text-on-surface">
                      ${Number(l.importe).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {lineas.length > 0 && (
          <div className="px-6 py-4 border-t border-outline-variant/10 flex-shrink-0 bg-surface-container-low/30">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-label uppercase tracking-widest text-stone-400">
                {lineas.length} producto{lineas.length !== 1 ? 's' : ''}
              </span>
              <span className="font-serif text-xl text-primary font-bold">
                ${total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
