// Importa la hoja "Inventario iPhones" a la base (tabla "unidades") y arma un INFORME
// PREVIO de lo que hay que limpiar (duplicados, IMEI invalidos, depositos nuevos...).
//
//   node herramientas/importar-stock.mjs --url                       -> baja el Sheet publico y muestra el informe
//   node herramientas/importar-stock.mjs <inventario.csv>            -> informe de un CSV ya bajado
//   node herramientas/importar-stock.mjs <csv|--url> --sql salida.sql -> ademas arma el SQL de importacion
//
// Reglas de la importacion (pensadas para que el cambio sea reversible y no pierda nada):
//  * El ID de cada unidad en la base ES su numero de fila en el Sheet. Asi el cotizador, que
//    identifica los equipos por fila, sigue funcionando igual aunque alguien tenga una pantalla
//    abierta justo en el momento del cambio.
//  * Un IMEI activo (En Stock / Reservado / Financiacion Propia) solo puede estar UNA vez. Si el
//    Sheet lo tiene repetido, queda activa la fila mas reciente y las otras se importan como
//    "vendido" con una marca en observaciones: NADA se descarta y todo queda en el informe.
//  * Filas sin IMEI reciben un codigo "SIN-IMEI-<fila>" (siguen contando para el stock por modelo).
//  * Se puede correr varias veces ANTES del cambio: actualiza por ID. Despues del cambio es inofensivo: no pisa ningun equipo
//    que la base ya haya movido (vendido, transferido, reservado) ni los que la base creo; solo agrega lo que falte.
// El SQL de salida no lleva datos personales (solo equipos); igual guardalo fuera del repositorio.

import { readFileSync, writeFileSync } from 'node:fs';

const LIBRO_STOCK_ID = '1WFl9nKbYYyOuz6ZLLzCNpnhrgd5qWqveP_IXmKG_1HE';
const HOJA = 'Inventario iPhones';

export function parseCsv(texto) {
  const filas = []; let fila = []; let campo = ''; let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) { if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += c; }
    else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (c === '\r') { /* ignorar */ }
    else campo += c;
  }
  if (campo.length || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

const ESTADOS = { 'en stock': 'en_stock', 'reservado': 'reservado', 'financiacion propia': 'financiacion_propia', 'vendido': 'vendido' };
const ACTIVOS = ['en_stock', 'reservado', 'financiacion_propia'];
const DEPOSITO_SUCURSAL = { 'OLMOS': 'Shopping', 'NUEVO CENTRO': 'Shopping', 'DINO': 'Dino', 'INDEPENDENCIA': 'Independencia' };

const luhn = n => { let s = 0; [...n].reverse().forEach((d, i) => { let x = +d; if (i % 2) { x *= 2; if (x > 9) x -= 9; } s += x; }); return s % 10 === 0; };
const categoriaDe = m => { m = String(m || '').toLowerCase(); if (/^iphone/.test(m)) return 'iphone'; if (/^ipad/.test(m)) return 'ipad'; if (/watch/.test(m)) return 'watch'; if (/macbook|imac|^mac\b|mac mini/.test(m)) return 'mac'; if (/airpods/.test(m)) return 'airpods'; if (/pencil/.test(m)) return 'apple_pencil'; if (/magic mouse/.test(m)) return 'magic_mouse'; return 'otro'; };
const bateriaPct = v => { const n = Number(String(v || '').replace('%', '').trim().replace(',', '.')); if (!n) return null; const p = Math.round(n <= 1 ? n * 100 : n); return p >= 1 && p <= 100 ? p : null; };
const condicionDe = t => /semi/i.test(t) ? 'seminuevo' : (/^(nuevo|sellado)$/i.test(String(t).trim()) ? 'sellado' : null);

// "dd/MM/yyyy" o "dd/MM/yyyy HH:mm:ss" (hora de Cordoba, UTC-3) -> ISO en UTC.
function fechaIso(t) {
  const m = String(t || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], (+m[4] || 0) + 3, +m[5] || 0, +m[6] || 0));
  return isNaN(d) ? null : d.toISOString().replace('.000Z', '.000Z');
}

export function analizar(csv) {
  const filas = parseCsv(csv);
  const unidades = []; const omitidas = []; const advertencias = [];
  filas.slice(1).forEach((f, i) => {
    const fila = i + 2;
    const celdas = f.map(x => String(x || '').trim());
    if (!celdas.slice(0, 12).some(Boolean)) return;          // fila vacia
    const [modelo, bateria, color, capacidad, imeiCrudo, deposito, estadoTxt, fechaTxt, col8, propietario, col10, usuario] = celdas;
    if (!modelo || !estadoTxt) { omitidas.push({ fila, motivo: 'falta modelo o estado', celdas: celdas.slice(0, 8).join(' | ') }); return; }
    const estado = ESTADOS[estadoTxt.toLowerCase()];
    const imei = imeiCrudo.replace(/\s+/g, '');
    const u = {
      fila, modelo, bateria: bateriaPct(bateria), color, capacidad, imei: imei || 'SIN-IMEI-' + fila, sinImei: !imei,
      deposito: deposito.toUpperCase(), estado: estado || 'vendido', estadoOriginal: estadoTxt, estadoDesconocido: !estado,
      fecha: fechaIso(fechaTxt), fechaTxt, observaciones: col8, condicion: condicionDe(col8), propietario, falla: col10, usuario,
      categoria: categoriaDe(modelo), notas: []
    };
    if (u.estadoDesconocido) advertencias.push({ fila, tipo: 'estado desconocido', detalle: 'Estado "' + estadoTxt + '": se importa como vendido (no cuenta como stock).' });
    if (!imei) advertencias.push({ fila, tipo: 'sin IMEI', detalle: modelo + ' ' + capacidad + ' ' + color + ' (' + estadoTxt + '): se le asigna ' + u.imei });
    else if (u.categoria === 'iphone' && !/^\d{15}$/.test(imei)) advertencias.push({ fila, tipo: 'IMEI con formato raro', detalle: imei + ' (un iPhone tiene 15 digitos)' });
    else if (u.categoria === 'iphone' && !luhn(imei)) advertencias.push({ fila, tipo: 'IMEI con digito verificador incorrecto', detalle: imei + ' (puede ser un error de tipeo)' });
    if (!deposito) advertencias.push({ fila, tipo: 'sin deposito', detalle: modelo + ' ' + imei });
    if (fechaTxt && !u.fecha) advertencias.push({ fila, tipo: 'fecha ilegible', detalle: '"' + fechaTxt + '"' });
    unidades.push(u);
  });

  // IMEI activo repetido: queda activa la mas reciente (por fecha; si empatan, la fila de mas abajo).
  const porImei = new Map();
  unidades.filter(u => ACTIVOS.includes(u.estado) && !u.sinImei).forEach(u => { (porImei.get(u.imei) || porImei.set(u.imei, []).get(u.imei)).push(u); });
  const duplicados = [];
  porImei.forEach((lista, imei) => {
    if (lista.length < 2) return;
    const orden = lista.slice().sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || a.fila - b.fila);
    const gana = orden[orden.length - 1];
    orden.slice(0, -1).forEach(u => { u.estado = 'vendido'; u.notas.push('DUPLICADO al importar: la fila activa es la ' + gana.fila); u.duplicadoDe = gana.fila; });
    duplicados.push({ imei, modelo: gana.modelo, filas: lista.map(u => ({ fila: u.fila, estado: u.estadoOriginal, deposito: u.deposito, fecha: u.fechaTxt })), queda: gana.fila });
  });
  // Un IMEI "vendido" y a la vez activo en otra fila es normal (el equipo volvio): se informa aparte.
  const vendidosYActivos = [];
  const imeisActivos = new Set(unidades.filter(u => ACTIVOS.includes(u.estado) && !u.sinImei).map(u => u.imei));
  unidades.filter(u => u.estado === 'vendido' && !u.duplicadoDe && imeisActivos.has(u.imei)).forEach(u => vendidosYActivos.push(u));

  const porEstado = {}; unidades.forEach(u => { porEstado[u.estado] = (porEstado[u.estado] || 0) + 1; });
  const depositos = {}; unidades.forEach(u => { if (u.deposito) depositos[u.deposito] = (depositos[u.deposito] || 0) + 1; });
  const modelosOtro = [...new Set(unidades.filter(u => u.categoria === 'otro').map(u => u.modelo))];
  return { total: filas.length - 1, unidades, omitidas, advertencias, duplicados, vendidosYActivos, porEstado, depositos, modelosOtro };
}

const q = v => v === null || v === undefined ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'";

export function armarSql(r) {
  const sql = ['-- Importacion del stock (generado por herramientas/importar-stock.mjs). Se puede repetir: actualiza por ID.'];
  Object.keys(r.depositos).sort().forEach(d => {
    const suc = DEPOSITO_SUCURSAL[d];
    sql.push(`INSERT OR IGNORE INTO depositos (nombre, sucursal_id) VALUES (${q(d)}, ${suc ? `(SELECT id FROM sucursales WHERE nombre = ${q(suc)})` : 'NULL'});`);
  });
  r.unidades.forEach(u => {
    const obs = [u.observaciones, ...u.notas].filter(Boolean).join(' · ');
    const iso = u.fecha || new Date().toISOString();
    sql.push(
      `INSERT INTO unidades (id, imei_serie, categoria, modelo, capacidad, color, bateria_pct, condicion, deposito_id, estado, origen, observaciones, falla, propietario_texto, usuario_texto, fila_sheet, creado_en, actualizado_en) VALUES (` +
      `${u.fila}, ${q(u.imei)}, ${q(u.categoria)}, ${q(u.modelo)}, ${q(u.capacidad || null)}, ${q(u.color || null)}, ${u.bateria === null ? 'NULL' : u.bateria}, ${q(u.condicion)}, ` +
      `${u.deposito ? `(SELECT id FROM depositos WHERE nombre = ${q(u.deposito)})` : `(SELECT id FROM depositos WHERE nombre = 'DEPO')`}, ${q(u.estado)}, 'ingreso', ${q(obs || null)}, ${q(u.falla || null)}, ${q(u.propietario || null)}, ${q(u.usuario || null)}, ${u.fila}, ${q(iso)}, ${q(iso)}) ` +
      `ON CONFLICT(id) DO UPDATE SET imei_serie = excluded.imei_serie, categoria = excluded.categoria, modelo = excluded.modelo, capacidad = excluded.capacidad, color = excluded.color, bateria_pct = excluded.bateria_pct, condicion = excluded.condicion, ` +
      `deposito_id = excluded.deposito_id, estado = excluded.estado, observaciones = excluded.observaciones, falla = excluded.falla, propietario_texto = excluded.propietario_texto, usuario_texto = excluded.usuario_texto, actualizado_en = excluded.actualizado_en ` +
      // PROTECCION: un equipo que la base ya movio (vendido, transferido, reservado...) o que la base creo no se pisa con un Sheet viejo.
      `WHERE NOT EXISTS (SELECT 1 FROM movimientos_stock m WHERE m.unidad_id = unidades.id AND COALESCE(m.nota, '') NOT LIKE 'Importado del Sheet%');`
    );
  });
  // Un movimiento "ingreso" por unidad, solo la primera vez que se importa.
  sql.push(`INSERT INTO movimientos_stock (unidad_id, tipo, hacia_deposito_id, usuario_id, nota, fecha_hora) SELECT u.id, 'ingreso', u.deposito_id, (SELECT id FROM usuarios WHERE rol = 'admin' ORDER BY id LIMIT 1), 'Importado del Sheet (fila ' || u.fila_sheet || ')', u.creado_en FROM unidades u WHERE NOT EXISTS (SELECT 1 FROM movimientos_stock m WHERE m.unidad_id = u.id);`);
  return sql.join('\n') + '\n';
}

export function imprimirInforme(r) {
  const L = (...a) => console.log(...a);
  L('\n=========== INFORME PREVIO DE IMPORTACION DEL STOCK ===========');
  L(`Filas leidas: ${r.total} · unidades a importar: ${r.unidades.length} · omitidas: ${r.omitidas.length}`);
  L('Por estado:', JSON.stringify(r.porEstado));
  L('Depositos (columna Sucursal):', JSON.stringify(r.depositos));
  L(`\n-- IMEI ACTIVOS REPETIDOS (hay que limpiarlos): ${r.duplicados.length}`);
  r.duplicados.forEach(d => L(`  ${d.imei} ${d.modelo}: filas ${d.filas.map(f => f.fila + ' (' + f.estado + ', ' + f.deposito + ')').join(' / ')} -> queda activa la fila ${d.queda}`));
  L(`\n-- ADVERTENCIAS: ${r.advertencias.length}`);
  r.advertencias.forEach(a => L(`  fila ${a.fila} · ${a.tipo}: ${a.detalle}`));
  L(`\n-- FILAS OMITIDAS: ${r.omitidas.length}`);
  r.omitidas.forEach(o => L(`  fila ${o.fila}: ${o.motivo} -> ${o.celdas}`));
  if (r.vendidosYActivos.length) L(`\n-- (informativo) ${r.vendidosYActivos.length} equipo(s) figuran vendidos en una fila y activos en otra: el equipo volvio (trade-in/devolucion).`);
  if (r.modelosOtro.length) L('\n-- Modelos que no se reconocen como iPhone/iPad/Watch/Mac/AirPods (categoria "otro"):', r.modelosOtro.join(', '));
  L('===============================================================\n');
}

// ---- uso por linea de comandos ----
if (process.argv[1] && process.argv[1].endsWith('importar-stock.mjs')) {
  const args = process.argv.slice(2);
  const iSql = args.indexOf('--sql');
  const salida = iSql !== -1 ? args[iSql + 1] : null;
  const origen = args.find(a => a !== '--sql' && a !== salida);
  if (!origen) { console.error('Uso: node herramientas/importar-stock.mjs <inventario.csv | --url> [--sql salida.sql]'); process.exit(1); }
  const csv = origen === '--url'
    ? await (await fetch('https://docs.google.com/spreadsheets/d/' + LIBRO_STOCK_ID + '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(HOJA))).text()
    : readFileSync(origen, 'utf8');
  if (/^\s*<!DOCTYPE html/i.test(csv)) { console.error('La planilla no es publica.'); process.exit(1); }
  const r = analizar(csv);
  imprimirInforme(r);
  if (salida) { writeFileSync(salida, armarSql(r)); console.log('SQL de importacion escrito en ' + salida + ' (' + r.unidades.length + ' unidades)'); }
}
