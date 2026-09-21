// Baja de Google, UNA vez, los iconos Material Symbols que usa el panel y los deja
// en public/fonts/ para que la página no dependa de internet (en la tienda ya pasó
// que un celular no podía llegar a fonts.googleapis.com y los iconos salían como
// texto: "dashboard", "storefront"...).
//
//   node scripts/bajar-iconos.mjs
//
// Genera dos archivos:
//   public/fonts/material-symbols-subset.woff2   solo los iconos que aparecen en app/ (~50 KB)
//   public/fonts/material-symbols-outlined.woff2 la fuente completa (~4 MB), que el
//                                                navegador SOLO baja si un icono no está
//                                                en el subconjunto (p. ej. uno nuevo que
//                                                se agregó sin volver a correr esto)
// y actualiza la lista de nombres en public/fonts/material-symbols-subset.txt.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const carpetaApp = join(raiz, 'app');
const salida = join(raiz, 'public', 'fonts');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

// ── 1) Todos los nombres de icono que aparecen en el código ─────────────────
function archivos(dir) {
  const lista = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) lista.push(...archivos(ruta));
    else if (/\.(tsx|ts|jsx|js)$/.test(nombre)) lista.push(ruta);
  }
  return lista;
}
const nombres = new Set();
const patronNombre = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
for (const ruta of archivos(carpetaApp)) {
  const codigo = readFileSync(ruta, 'utf8');
  // name="x" / name='x' / name={cond ? 'a' : 'b'} / icon: 'x' / icon="x" / icono: 'x'
  for (const m of codigo.matchAll(/<Icon\b[^>]*?\bname=(?:"([a-z0-9_]+)"|'([a-z0-9_]+)'|\{([^}]*)\})/g)) {
    if (m[1]) nombres.add(m[1]);
    if (m[2]) nombres.add(m[2]);
    if (m[3]) for (const q of m[3].matchAll(/['"`]([a-z][a-z0-9_]+)['"`]/g)) nombres.add(q[1]);
  }
  for (const m of codigo.matchAll(/\bicon(?:o)?\s*[:=]\s*['"]([a-z][a-z0-9_]+)['"]/g)) nombres.add(m[1]);
}
const lista = [...nombres].filter(n => patronNombre.test(n) && n.length >= 3).sort();
console.log(`${lista.length} iconos distintos en app/`);

// ── 2) Pedir a Google la CSS con esos nombres y bajar el woff2 ──────────────
const EJES = 'opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200';
async function bajar(url, destino) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} al pedir ${url}`);
  const css = await r.text();
  // El subconjunto viene como .../l/font?kit=... (sin .woff2 en la liga).
  const m = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/);
  if (!m) throw new Error(`Google no devolvió un .woff2 para ${url}\n${css.slice(0, 300)}`);
  const f = await fetch(m[1], { headers: { 'User-Agent': UA } });
  if (!f.ok) throw new Error(`${f.status} al bajar ${m[1]}`);
  const bytes = Buffer.from(await f.arrayBuffer());
  writeFileSync(destino, bytes);
  console.log(`${destino.replace(raiz, '')}: ${(bytes.length / 1024).toFixed(0)} KB`);
}

mkdirSync(salida, { recursive: true });
await bajar(
  `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:${EJES}&icon_names=${lista.join(',')}&display=block`,
  join(salida, 'material-symbols-subset.woff2'),
);
await bajar(
  `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:${EJES}&display=block`,
  join(salida, 'material-symbols-outlined.woff2'),
);
writeFileSync(join(salida, 'material-symbols-subset.txt'), `${lista.join('\n')}\n`);
console.log('Listo. Si agregas un icono nuevo, vuelve a correr este script (mientras, lo cubre la fuente completa).');
