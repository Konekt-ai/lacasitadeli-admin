'use client';

import React, { useState, useEffect } from 'react';
import { Icon } from '../components/Icon';
import { cn } from '../lib/utils';

interface SysInfo {
  hasGit: boolean;
  hash: string;
  branch: string;
  lastMsg: string;
  lastDate: string;
  present?: boolean;
}

interface GitInfo {
  name: string;
  email: string;
  remote: string;
}

export default function AdminConsoleTab() {
  const [gitInfo,    setGitInfo]    = useState<GitInfo>({ name: '', email: '', remote: '' });
  const [sysInfo,    setSysInfo]    = useState<SysInfo | null>(null);
  const [bodInfo,    setBodInfo]    = useState<SysInfo | null>(null);
  const [gitSaving,  setGitSaving]  = useState(false);
  const [gitMsg,     setGitMsg]     = useState<{ text: string; ok: boolean } | null>(null);
  const [launching,  setLaunching]  = useState(false);
  const [launchMsg,  setLaunchMsg]  = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/git').then(r => r.json()).catch(() => ({})),
      fetch('/api/admin/sistema/info').then(r => r.json()).catch(() => ({})),
      fetch('/api/admin/bodega/info').then(r => r.json()).catch(() => ({})),
    ]).then(([git, sys, bod]) => {
      setGitInfo({
        name:   git.name   || 'casitadev',
        email:  git.email  || 'lacasitadeli2000@gmail.com',
        remote: git.remote || 'https://github.com/Konekt-ai/lacasitadeli-admin',
      });
      setSysInfo(sys);
      setBodInfo(bod);
    });
  }, []);

  const saveGitConfig = async () => {
    setGitSaving(true);
    setGitMsg(null);
    try {
      const res  = await fetch('/api/admin/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gitInfo),
      });
      const data = await res.json();
      setGitMsg({ text: data.ok ? 'Configuración guardada' : (data.error || 'Error'), ok: !!data.ok });
    } catch {
      setGitMsg({ text: 'Error de conexión', ok: false });
    } finally {
      setGitSaving(false);
    }
  };

  const launchActualizar = async () => {
    setLaunching(true);
    setLaunchMsg(null);
    try {
      const res  = await fetch('/api/admin/sistema/lanzar-actualizacion', { method: 'POST' });
      const data = await res.json();
      setLaunchMsg({
        text: data.ok
          ? 'Script lanzado. El sistema se actualizará y reiniciará en segundo plano.'
          : (data.error || 'Error al lanzar el script'),
        ok: !!data.ok,
      });
    } catch {
      setLaunchMsg({ text: 'Error de conexión con la API', ok: false });
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-2xl">

      {/* Info de versión: panel admin + bodega (TC52) */}
      <div className="grid sm:grid-cols-2 gap-3">
        {sysInfo?.hasGit && (
          <div className="bg-stone-950 text-emerald-400 rounded-xl p-4 font-mono text-xs space-y-1 border border-stone-800">
            <div className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1.5">Panel admin</div>
            <div><span className="text-stone-500">rama &nbsp;&nbsp;:</span> {sysInfo.branch}</div>
            <div><span className="text-stone-500">commit:</span> {sysInfo.hash} — {sysInfo.lastMsg}</div>
            <div><span className="text-stone-500">fecha &nbsp;:</span> {sysInfo.lastDate}</div>
          </div>
        )}
        {bodInfo?.hasGit ? (
          <div className="bg-stone-950 text-sky-400 rounded-xl p-4 font-mono text-xs space-y-1 border border-stone-800">
            <div className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1.5">Bodega (TC52)</div>
            <div><span className="text-stone-500">rama &nbsp;&nbsp;:</span> {bodInfo.branch}</div>
            <div><span className="text-stone-500">commit:</span> {bodInfo.hash} — {bodInfo.lastMsg}</div>
            <div><span className="text-stone-500">fecha &nbsp;:</span> {bodInfo.lastDate}</div>
          </div>
        ) : bodInfo && !bodInfo.present ? (
          <div className="bg-stone-950 text-amber-400 rounded-xl p-4 font-mono text-xs border border-stone-800 flex items-center">
            <div>
              <div className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1.5">Bodega (TC52)</div>
              repo no encontrado en ..\lacasitadeli-almacen
            </div>
          </div>
        ) : null}
      </div>

      {/* Actualizar sistema */}
      <section className="bg-surface rounded-2xl border border-stone-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Icon name="system_update_alt" className="text-primary text-xl" />
          <h3 className="font-label font-bold tracking-wide uppercase text-sm">Actualizar sistema</h3>
        </div>
        <p className="text-stone-500 text-sm leading-relaxed">
          Ejecuta <code className="bg-stone-100 px-1.5 py-0.5 rounded text-stone-700 text-xs">actualizar-silencioso.vbs</code>,
          que descarga los últimos cambios de Git de <strong>ambos</strong> repos (panel admin y bodega/TC52),
          reinstala dependencias, reconstruye la PWA y reinicia el sistema completo.
        </p>
        <button
          onClick={launchActualizar}
          disabled={launching}
          className={cn(
            'flex items-center gap-2 px-5 py-2.5 rounded-lg font-label font-bold text-sm uppercase tracking-wide transition-all',
            launching
              ? 'bg-stone-200 text-stone-400 cursor-not-allowed'
              : 'bg-primary text-on-primary hover:opacity-90 active:opacity-70'
          )}
        >
          <Icon name={launching ? 'hourglass_empty' : 'play_arrow'} className="text-lg" />
          {launching ? 'Lanzando...' : 'Ejecutar actualización'}
        </button>
        {launchMsg && (
          <p className={cn('text-sm font-label flex items-center gap-1.5', launchMsg.ok ? 'text-emerald-600' : 'text-error')}>
            <Icon name={launchMsg.ok ? 'check_circle' : 'error'} className="text-base" />
            {launchMsg.text}
          </p>
        )}
      </section>

      {/* Git config */}
      <section className="bg-surface rounded-2xl border border-stone-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Icon name="manage_accounts" className="text-primary text-xl" />
          <h3 className="font-label font-bold tracking-wide uppercase text-sm">Configuración de Git</h3>
        </div>
        <div className="space-y-3">
          {[
            { label: 'Nombre',     key: 'name',   placeholder: 'Tu nombre',             type: 'text'  },
            { label: 'Email',      key: 'email',  placeholder: 'tu@email.com',          type: 'email' },
            { label: 'Remote URL', key: 'remote', placeholder: 'https://github.com/...', type: 'url'  },
          ].map(({ label, key, placeholder, type }) => (
            <div key={key}>
              <label className="block text-[10px] font-label uppercase tracking-widest text-stone-400 mb-1">
                {label}
              </label>
              <input
                type={type}
                value={gitInfo[key as keyof GitInfo]}
                onChange={e => setGitInfo(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-stone-50 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
            </div>
          ))}
        </div>
        <button
          onClick={saveGitConfig}
          disabled={gitSaving}
          className={cn(
            'flex items-center gap-2 px-5 py-2.5 rounded-lg font-label font-bold text-sm uppercase tracking-wide transition-all',
            gitSaving
              ? 'bg-stone-200 text-stone-400 cursor-not-allowed'
              : 'bg-primary text-on-primary hover:opacity-90 active:opacity-70'
          )}
        >
          <Icon name={gitSaving ? 'hourglass_empty' : 'save'} className="text-lg" />
          {gitSaving ? 'Guardando...' : 'Guardar cambios'}
        </button>
        {gitMsg && (
          <p className={cn('text-sm font-label flex items-center gap-1.5', gitMsg.ok ? 'text-emerald-600' : 'text-error')}>
            <Icon name={gitMsg.ok ? 'check_circle' : 'error'} className="text-base" />
            {gitMsg.text}
          </p>
        )}
      </section>
    </div>
  );
}
