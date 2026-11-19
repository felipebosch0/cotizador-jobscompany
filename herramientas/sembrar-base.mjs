// Arma el SQL con los datos iniciales de la base 3.0 (sucursales, locales,
// usuarios y vendedores) a partir de lo que YA existe:
//   - usuarios + hashes de clave: secretos.local.txt (USUARIOS_JSON, no va a git)
//   - vendedores por sucursal: auth.js (VENDEDORES_POR_SUCURSAL)
//
//   node herramientas/sembrar-base.mjs <archivo-de-salida.sql>
//
// Despues se aplica con:
//   npx wrangler d1 execute <base> --remote --file <archivo-de-salida.sql>
// El archivo de salida lleva hashes de clave (no claves): guardalo FUERA del
// repositorio y borralo al terminar. Se puede correr varias veces: usa
// INSERT OR IGNORE, asi que no pisa lo que ya este cargado.

import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const salida = process.argv[2];
if (!salida) { console.error('Falta el archivo de salida: node herramientas/sembrar-base.mjs <salida.sql>'); process.exit(1); }

const secretos = readFileSync(new URL('../secretos.local.txt', import.meta.url), 'utf8');
const m = secretos.match(/^USUARIOS_JSON=(.*)$/m);
if (!m) throw new Error('No encontre USUARIOS_JSON en secretos.local.txt');
const usuarios = JSON.parse(m[1].trim().replace(/^'|'$/g, ''));

const authFuente = readFileSync(new URL('../auth.js', import.meta.url), 'utf8');
const bloque = authFuente.match(/const VENDEDORES_POR_SUCURSAL = \{[\s\S]*?\n\};/);
if (!bloque) throw new Error('No encontre VENDEDORES_POR_SUCURSAL en auth.js');
const VENDEDORES = vm.runInNewContext(bloque[0].replace('const VENDEDORES_POR_SUCURSAL =', 'V =') + '; V');

const q = v => v === null || v === undefined ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'";
const capitalizar = n => String(n).trim().replace(/\s+/g, ' ').split(' ').map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');

const SUCURSALES = [
  { id: 1, nombre: 'Shopping',      cuit: '30-71929577-7' },
  { id: 2, nombre: 'Independencia', cuit: '30-71827656-6' },
  { id: 3, nombre: 'Dino',          cuit: '30-71929577-7' }
];
const idSucursal = Object.fromEntries(SUCURSALES.map(s => [s.nombre, s.id]));

// Mismos nombres y reparto que LOCALES_VENTA en app.js.
// url = link de resena en Google Maps (los mismos que ya usa la garantia impresa en app.js).
const LOCALES = [
  { id: 1, sucursal: 'Shopping',      nombre: 'Jobs Company / Nuevo Centro',  vendedores: ['Yoko', 'Ele', 'Flor'], url: 'https://g.page/r/Ccz8tyDhwq3nEBM/review' },
  { id: 2, sucursal: 'Shopping',      nombre: 'Jobs Company / Patio Olmos',  vendedores: ['Ro', 'Agus Manzanelli', 'Agus Mendoza'], url: 'https://g.page/r/CfR_ltI-9NcmEBM/review' },
  { id: 3, sucursal: 'Dino',          nombre: 'Jobs Company / Dino Mall',    vendedores: [], url: 'https://g.page/r/CaDN5blLIGF-EBM/review' },
  { id: 4, sucursal: 'Independencia', nombre: 'Tio Jobs / Independencia 468', vendedores: [], url: 'https://g.page/r/Ca-CvCNpZi3vEBM/review' }
];

const sql = [];
sql.push('-- Datos iniciales (generado por herramientas/sembrar-base.mjs). Lleva hashes: NO subir a git.');
SUCURSALES.forEach(s => sql.push(`INSERT OR IGNORE INTO sucursales (id, nombre, cuit) VALUES (${s.id}, ${q(s.nombre)}, ${q(s.cuit)});`));
LOCALES.forEach(l => {
  sql.push(`INSERT OR IGNORE INTO locales (id, sucursal_id, nombre, url_resenia) VALUES (${l.id}, ${idSucursal[l.sucursal]}, ${q(l.nombre)}, ${q(l.url)});`);
  sql.push(`UPDATE locales SET url_resenia = ${q(l.url)} WHERE id = ${l.id} AND url_resenia IS NULL;`);   // si el local ya existia sin link
});

usuarios.forEach(u => {
  if (!['admin', 'oficina', 'vendedor'].includes(u.rol)) throw new Error('Rol invalido para ' + u.usuario + ': ' + u.rol);
  if (!/^pbkdf2\$\d+\$/.test(u.hash)) throw new Error('El hash de ' + u.usuario + ' no tiene el formato esperado');
  const suc = u.sucursal ? idSucursal[u.sucursal] : null;
  if (u.sucursal && !suc) throw new Error('Sucursal desconocida para ' + u.usuario + ': ' + u.sucursal);
  sql.push(`INSERT OR IGNORE INTO usuarios (usuario, nombre, rol, sucursal_id, clave_hash) VALUES (${q(u.usuario.toLowerCase())}, ${q(u.nombre)}, ${q(u.rol)}, ${suc === null ? 'NULL' : suc}, ${q(u.hash)});`);
});

const localDe = (sucursal, nombre) => {
  const l = LOCALES.find(x => x.sucursal === sucursal && x.vendedores.some(v => v.toLowerCase() === nombre.toLowerCase()));
  if (l) return l.id;
  const unicos = LOCALES.filter(x => x.sucursal === sucursal);
  return unicos.length === 1 ? unicos[0].id : null;   // sucursal con un solo local
};
const vistos = new Set();
Object.entries(VENDEDORES).forEach(([sucursal, nombres]) => {
  nombres.forEach(n => {
    const nombre = capitalizar(n);
    if (vistos.has(nombre.toLowerCase())) return;
    vistos.add(nombre.toLowerCase());
    const loc = localDe(sucursal, nombre);
    sql.push(`INSERT OR IGNORE INTO vendedores (nombre, sucursal_id, local_id) VALUES (${q(nombre)}, ${idSucursal[sucursal]}, ${loc === null ? 'NULL' : loc});`);
  });
});

writeFileSync(salida, sql.join('\n') + '\n');
console.log('Listo: ' + usuarios.length + ' usuarios, ' + vistos.size + ' vendedores, ' + SUCURSALES.length + ' sucursales, ' + LOCALES.length + ' locales -> ' + salida);
