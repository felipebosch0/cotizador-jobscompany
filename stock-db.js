// ============================================================
// STOCK EN LA BASE (3.0, Etapa 6)
//
// Hace lo mismo que el Apps Script "StockWrite.gs" + las lecturas del Sheet, pero contra la
// base (tablas "unidades" y "movimientos_stock"), con LAS MISMAS acciones y LOS MISMOS formatos
// de respuesta. Por eso el cotizador no cambia: solo se prende el interruptor STOCK_EN_BASE=1
// del servidor (y se apaga para volver al Sheet).
//
// Identificacion de equipos: igual que hoy, por "fila". En la base, fila = unidades.id; al
// importar, el id de cada equipo ES su numero de fila en el Sheet, y los equipos nuevos siguen
// la numeracion (MAX(id)+1).
//
// Reglas que ahora garantiza la base y no el programa:
//   * un IMEI activo (En Stock / Reservado / Financiacion Propia) solo puede estar UNA vez
//     (indice unico parcial): ya no hay forma de duplicarlo;
//   * nada se borra: un equipo vendido queda con estado "vendido" y su historial;
//   * cada movimiento queda en "movimientos_stock" (solo se agrega).
// ============================================================

const ESTADO_TXT = { en_stock: 'En Stock', reservado: 'Reservado', financiacion_propia: 'Financiacion Propia', vendido: 'Vendido' };
const ACTIVOS = "('en_stock', 'reservado', 'financiacion_propia')";
const AHORA = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const ADMIN_ID = "(SELECT id FROM usuarios WHERE rol = 'admin' ORDER BY id LIMIT 1)";
const DEPOSITO_SUCURSAL = { 'OLMOS': 'Shopping', 'NUEVO CENTRO': 'Shopping', 'DINO': 'Dino', 'INDEPENDENCIA': 'Independencia' };
const ACCIONES_QUE_ESCRIBEN = ['ingreso', 'egreso', 'reservar', 'liberarReserva', 'transferir', 'alerta'];

const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const texto = v => v === null || v === undefined ? '' : String(v).trim();
const nulo = v => { const t = texto(v); return t === '' ? null : t; };

export function capacidadANumero(crudo) {
  const t = String(crudo || '');
  if (/t/i.test(t)) return 1024;
  return Number(t) || 0;
}

// "0.88", 88, "88%" -> 88 (entero 1-100) o null.
export function bateriaPct(crudo) {
  const n = Number(String(crudo === null || crudo === undefined ? '' : crudo).replace('%', '').trim().replace(',', '.'));
  if (!n) return null;
  const p = Math.round(n <= 1 ? n * 100 : n);
  return p >= 1 && p <= 100 ? p : null;
}

export function categoriaDe(modelo) {
  const m = String(modelo || '').toLowerCase();
  if (/^iphone/.test(m)) return 'iphone';
  if (/^ipad/.test(m)) return 'ipad';
  if (/watch/.test(m)) return 'watch';
  if (/macbook|imac|^mac\b|mac mini/.test(m)) return 'mac';
  if (/airpods/.test(m)) return 'airpods';
  if (/pencil/.test(m)) return 'apple_pencil';
  if (/magic mouse/.test(m)) return 'magic_mouse';
  return 'otro';
}

const condicionDe = t => /semi/i.test(t) ? 'seminuevo' : (/^(nuevo|sellado)$/i.test(String(t).trim()) ? 'sellado' : null);
const origenDe = obs => /^trade/i.test(obs) ? 'trade_in' : (/^generado/i.test(obs) ? 'generado_al_vender' : (/^devolucion/i.test(obs) ? 'devolucion' : 'ingreso'));

// ---------------- Lecturas (mismo formato que /stock y /stock-imeis del Sheet) ----------------

export async function stockLeer(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT u.modelo, u.capacidad, u.bateria_pct, u.color, d.nombre AS sucursal, u.estado, u.observaciones, u.falla FROM unidades u JOIN depositos d ON d.id = u.deposito_id WHERE u.estado IN ${ACTIVOS} ORDER BY u.id`).all();
    return json({
      stock: (results || []).map(u => ({
        modelo: u.modelo, capacidad: capacidadANumero(u.capacidad), bateria: u.bateria_pct || 0, color: u.color || '', sucursal: u.sucursal,
        estado: ESTADO_TXT[u.estado], observaciones: u.observaciones || '', falla: u.falla || ''
      })), error: null
    });
  } catch (e) { return json({ stock: [], error: String((e && e.message) || e) }); }
}

export async function stockImeis(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT u.modelo, u.capacidad, u.bateria_pct, u.color, u.imei_serie, d.nombre AS sucursal, u.observaciones FROM unidades u JOIN depositos d ON d.id = u.deposito_id WHERE u.estado = 'en_stock' AND u.imei_serie NOT LIKE 'SIN-IMEI-%' ORDER BY u.id").all();
    return json({
      unidades: (results || []).map(u => ({ modelo: u.modelo, capacidad: capacidadANumero(u.capacidad), bateria: u.bateria_pct || 0, color: u.color || '', imei: u.imei_serie, sucursal: u.sucursal, condicion: u.observaciones || '' })),
      error: null
    });
  } catch (e) { return json({ unidades: [], error: String((e && e.message) || e) }); }
}

// ---------------- Escrituras (mismas acciones que StockWrite.gs) ----------------

function reenviarAlerta(env, ctx, tipo, imei, detalle, usuario) {
  // El Apps Script manda el mail al administrador y deja la fila en la pestana "Alertas".
  if (!env.APPS_SCRIPT_STOCK_URL) return;
  const p = fetch(env.APPS_SCRIPT_STOCK_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', body: JSON.stringify({ accion: 'alerta', tipo, imei, detalle, usuario }) }).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}

// Devuelve { res } (resultados de cada sentencia) o { cached } si otra peticion igual (mismo opId)
// se adelanto: en ese caso se devuelve lo que ya contesto, sin escribir nada de nuevo.
async function ejecutar(env, sentencias, claveOp) {
  try { return { res: await env.DB.batch(sentencias) }; } catch (e) {
    if (claveOp && /ops_stock/.test(String(e && e.message))) {
      const previo = await env.DB.prepare('SELECT respuesta FROM ops_stock WHERE clave = ?').bind(claveOp).first();
      if (previo) return { cached: JSON.parse(previo.respuesta) };
    }
    throw e;
  }
}

const opInsert = (env, clave, respuesta) => env.DB.prepare('INSERT INTO ops_stock (clave, respuesta) VALUES (?, ?)').bind(clave, JSON.stringify(respuesta));
const deposito = (env, nombre) => env.DB.prepare('INSERT OR IGNORE INTO depositos (nombre, sucursal_id) VALUES (?, ' + (DEPOSITO_SUCURSAL[nombre] ? '(SELECT id FROM sucursales WHERE nombre = ?)' : 'NULL') + ')').bind(...(DEPOSITO_SUCURSAL[nombre] ? [nombre, DEPOSITO_SUCURSAL[nombre]] : [nombre]));
// Una fila en el historial de movimientos. desdeId = id del deposito de origen (o null);
// haciaNombre = NOMBRE del deposito de destino (o null). Sin usuario de la base, queda a nombre del administrador.
// Si quien lo hizo no esta en la base, el movimiento queda a nombre del administrador PERO con el nombre real en la nota.
const notaMov = (usuario, nota) => [nota, (!usuario.id && usuario.texto) ? 'por ' + usuario.texto : null].filter(Boolean).join(' · ') || null;
const movimiento = (env, unidadId, tipo, desdeId, haciaNombre, usuario, nota) => env.DB.prepare(
  `INSERT INTO movimientos_stock (unidad_id, tipo, desde_deposito_id, hacia_deposito_id, usuario_id, nota) VALUES (?, ?, ?, (SELECT id FROM depositos WHERE nombre = ?), COALESCE(?, ${ADMIN_ID}), ?)`)
  .bind(unidadId, tipo, desdeId, haciaNombre, usuario.id || null, notaMov(usuario, nota));
// El mismo movimiento, pero solo si la sentencia anterior (el UPDATE) realmente cambio una fila.
const movimientoSiCambio = (env, unidadId, tipo, desdeId, haciaNombre, usuario, nota) => env.DB.prepare(
  `INSERT INTO movimientos_stock (unidad_id, tipo, desde_deposito_id, hacia_deposito_id, usuario_id, nota) SELECT ?, ?, ?, (SELECT id FROM depositos WHERE nombre = ?), COALESCE(?, ${ADMIN_ID}), ? WHERE changes() > 0`)
  .bind(unidadId, tipo, desdeId, haciaNombre, usuario.id || null, notaMov(usuario, nota));
// El movimiento del equipo que se acaba de insertar en esta misma transaccion.
const movimientoDelUltimo = (env, tipo, haciaNombre, usuario, nota) => env.DB.prepare(
  `INSERT INTO movimientos_stock (unidad_id, tipo, desde_deposito_id, hacia_deposito_id, usuario_id, nota) VALUES ((SELECT MAX(id) FROM unidades), ?, NULL, (SELECT id FROM depositos WHERE nombre = ?), COALESCE(?, ${ADMIN_ID}), ?)`)
  .bind(tipo, haciaNombre, usuario.id || null, notaMov(usuario, nota));

async function unidadPorFila(env, filaCruda) {
  const fila = Number(filaCruda);
  if (!Number.isInteger(fila) || fila < 2) return { error: 'Fila invalida' };
  const u = await env.DB.prepare('SELECT u.id, u.estado, u.imei_serie, u.modelo, u.deposito_id, d.nombre AS deposito FROM unidades u JOIN depositos d ON d.id = u.deposito_id WHERE u.id = ?').bind(fila).first();
  return u ? { u } : { error: 'Fila invalida' };
}

export async function stockEscribir(request, env, ctx, usuario) {
  let d;
  try { d = await request.json(); } catch (e) { return json({ ok: false, error: 'SyntaxError: cuerpo invalido' }); }
  try {
    const escribe = ACCIONES_QUE_ESCRIBEN.indexOf(d.accion) !== -1;
    // El stock ya no es un buzon publico: para escribir hay que haber iniciado sesion.
    if (escribe && !usuario.conSesion) return json({ ok: false, error: 'Sesion vencida o inexistente', sinSesion: true }, 401);
    usuario = Object.assign({}, usuario, { texto: texto(d.usuario) || texto(d.vendedor) || texto(d.propietario) });
    const claveOp = (escribe && d.opId) ? 'op:' + d.accion + ':' + d.opId + ':' + (d.fila || '') : '';
    if (claveOp) {
      const previo = await env.DB.prepare('SELECT respuesta FROM ops_stock WHERE clave = ?').bind(claveOp).first();
      if (previo) return json(JSON.parse(previo.respuesta));
      // Limpieza de memoria vieja (la del Apps Script dura 6 horas): de paso, sin apuro.
      if (Math.random() < 0.02) ctx && ctx.waitUntil && ctx.waitUntil(env.DB.prepare("DELETE FROM ops_stock WHERE creada_en < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')").run().catch(() => {}));
    }
    let r;
    if (d.accion === 'ingreso') r = await accionIngreso(env, ctx, d, usuario, claveOp);
    else if (d.accion === 'alerta') r = await accionAlerta(env, ctx, d, usuario, claveOp);
    else if (d.accion === 'buscarImei') r = await accionBuscar(env, d);
    else if (d.accion === 'egreso') r = await accionEgreso(env, d, usuario, claveOp);
    else if (d.accion === 'reservar') r = await accionReservar(env, d, usuario, claveOp);
    else if (d.accion === 'liberarReserva') r = await accionLiberar(env, d, usuario, claveOp);
    else if (d.accion === 'transferir') r = await accionTransferir(env, d, usuario, claveOp);
    else r = { ok: false, error: 'Accion desconocida: ' + d.accion };
    return json(r);
  } catch (e) {
    console.log('[stock-db] error: ' + (e && e.message));
    return json({ ok: false, error: 'No se pudo completar: ' + String((e && e.message) || e) });
  }
}

async function accionAlerta(env, ctx, d, usuario, claveOp) {
  const sentencias = [];
  if (claveOp) sentencias.push(opInsert(env, claveOp, { ok: true }));
  sentencias.push(env.DB.prepare('INSERT INTO alertas (tipo, imei_serie, detalle, usuario_id) VALUES (?, ?, ?, ?)').bind(texto(d.tipo) || 'Aviso', nulo(d.imei), texto(d.detalle) || '(sin detalle)', usuario.id || null));
  const r = await ejecutar(env, sentencias, claveOp);
  if (r.cached) return r.cached;
  reenviarAlerta(env, ctx, texto(d.tipo) || 'Aviso', texto(d.imei), texto(d.detalle), texto(d.usuario));
  return { ok: true };
}

async function accionBuscar(env, d) {
  const buscado = texto(d.ultimos4).replace(/\s+/g, '');
  if (!buscado) return { ok: true, resultados: [] };
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.modelo, u.bateria_pct, u.color, u.capacidad, u.imei_serie, d.nombre AS sucursal, u.estado, u.observaciones, u.falla FROM unidades u JOIN depositos d ON d.id = u.deposito_id
     WHERE u.estado IN ${ACTIVOS} AND substr(u.imei_serie, -?) = ? ORDER BY u.id`).bind(buscado.length, buscado).all();
  return {
    ok: true,
    resultados: (results || []).map(u => ({ fila: u.id, modelo: u.modelo, bateria: u.bateria_pct ? u.bateria_pct + '%' : '', color: u.color || '', capacidad: u.capacidad || '', imei: u.imei_serie, sucursal: u.sucursal, estado: ESTADO_TXT[u.estado], observaciones: u.observaciones || '', falla: u.falla || '' }))
  };
}

async function accionIngreso(env, ctx, d, usuario, claveOp) {
  const imei = texto(d.imei).replace(/\s+/g, '');
  const usuarioTxt = texto(d.usuario) || texto(d.propietario);
  const modelo = texto(d.modelo);
  if (!modelo) return { ok: false, error: 'Falta el modelo' };
  const dep = texto(d.sucursal).toUpperCase() || 'DEPO';
  const obs = texto(d.observaciones);

  for (let intento = 0; intento < 5; intento++) {
    const dup = imei ? await env.DB.prepare(
      `SELECT u.id, u.estado, u.modelo, d.nombre AS sucursal, u.actualizado_en FROM unidades u JOIN depositos d ON d.id = u.deposito_id WHERE u.imei_serie = ? AND u.estado IN ${ACTIVOS}`).bind(imei).first() : null;

    if (dup) {
      // Regla: un IMEI activo una sola vez. No se frena ni se crea otra: se actualiza la existente y se avisa.
      const sets = ["estado = 'en_stock'", 'actualizado_en = ' + AHORA]; const vals = [];
      const campo = (col, v) => { sets.push(col + ' = ?'); vals.push(v); };
      if (modelo) { campo('modelo', modelo); campo('categoria', categoriaDe(modelo)); }
      if (d.bateria !== undefined && d.bateria !== null && d.bateria !== '') campo('bateria_pct', bateriaPct(d.bateria));
      if (texto(d.color)) campo('color', texto(d.color));
      if (texto(d.capacidad)) campo('capacidad', texto(d.capacidad));
      if (obs) { campo('observaciones', obs); campo('condicion', condicionDe(obs)); }
      if (texto(d.propietario)) campo('propietario_texto', texto(d.propietario));
      if (texto(d.falla)) campo('falla', texto(d.falla));
      if (usuarioTxt) campo('usuario_texto', usuarioTxt);
      if (texto(d.sucursal)) sets.push('deposito_id = (SELECT id FROM depositos WHERE nombre = ?)'), vals.push(dep);
      const respuesta = { ok: true, fila: dup.id, duplicado: true };
      const detalle = 'Se intento ingresar (' + (obs || 'sin observaciones') + ') un equipo que ya figuraba ' + ESTADO_TXT[dup.estado] + ' en ' + dup.sucursal +
        ' (fila ' + dup.id + ', ' + dup.modelo + '). No se creo fila nueva: se actualizo esa fila a En Stock en ' + (texto(d.sucursal) ? dep : dup.sucursal) + '. Revisar si faltaba darlo de baja.';
      const sentencias = [];
      if (claveOp) sentencias.push(opInsert(env, claveOp, respuesta));
      if (texto(d.sucursal)) sentencias.push(deposito(env, dep));
      sentencias.push(env.DB.prepare('UPDATE unidades SET ' + sets.join(', ') + ' WHERE id = ?').bind(...vals, dup.id));
      sentencias.push(movimiento(env, dup.id, 'ajuste', null, texto(d.sucursal) ? dep : null, usuario, 'Ingreso sobre un IMEI ya activo: se actualizo el equipo'));
      sentencias.push(env.DB.prepare("INSERT INTO alertas (tipo, imei_serie, detalle, usuario_id) VALUES ('IMEI ya estaba activo al ingresar', ?, ?, ?)").bind(imei, detalle, usuario.id || null));
      const r = await ejecutar(env, sentencias, claveOp);
      if (r.cached) return r.cached;
      reenviarAlerta(env, ctx, 'IMEI ya estaba activo al ingresar', imei, detalle, usuarioTxt);
      return respuesta;
    }

    // Equipo nuevo. El numero de fila (id) lo asigna la BASE dentro de la misma transaccion (MAX+1), asi dos
    // ingresos a la vez nunca chocan ni dejan huecos; la fila definitiva se lee al final del mismo lote.
    const sentencias = [deposito(env, dep)];
    sentencias.push(env.DB.prepare(
      `INSERT INTO unidades (id, imei_serie, categoria, modelo, capacidad, color, bateria_pct, condicion, deposito_id, estado, origen, observaciones, falla, propietario_texto, usuario_texto, creado_en, actualizado_en)
       VALUES ((SELECT COALESCE(MAX(id), 1) + 1 FROM unidades), COALESCE(?, 'SIN-IMEI-' || (SELECT COALESCE(MAX(id), 1) + 1 FROM unidades)), ?, ?, ?, ?, ?, ?, (SELECT id FROM depositos WHERE nombre = ?), 'en_stock', ?, ?, ?, ?, ?, ${AHORA}, ${AHORA})`)
      .bind(nulo(imei), categoriaDe(modelo), modelo, nulo(d.capacidad), nulo(d.color), bateriaPct(d.bateria), condicionDe(obs), dep, origenDe(obs), nulo(obs), nulo(d.falla), nulo(d.propietario), nulo(usuarioTxt)));
    if (claveOp) sentencias.push(env.DB.prepare("INSERT INTO ops_stock (clave, respuesta) VALUES (?, json_object('ok', json('true'), 'fila', (SELECT MAX(id) FROM unidades)))").bind(claveOp));
    sentencias.push(movimientoDelUltimo(env, 'ingreso', dep, usuario, obs || null));
    const idxFila = sentencias.length;
    sentencias.push(env.DB.prepare('SELECT MAX(id) AS fila FROM unidades'));
    try {
      const r = await ejecutar(env, sentencias, claveOp);
      if (r.cached) return r.cached;
      return { ok: true, fila: r.res[idxFila].results[0].fila };
    } catch (e) {
      // Otro ingreso del mismo IMEI se colo en el medio: se reintenta y ahi cae en la rama de "ya activo".
      if (/UNIQUE/i.test(String(e && e.message)) && !/ops_stock/.test(String(e.message))) continue;
      throw e;
    }
  }
  return { ok: false, error: 'No se pudo ingresar el equipo (hubo cambios al mismo tiempo): intenta de nuevo' };
}

// Movimientos que ya conocen el deposito del equipo.
async function accionConUnidad(env, d, usuario, claveOp, preparar) {
  for (let intento = 0; intento < 3; intento++) {
    const { u, error } = await unidadPorFila(env, d.fila);
    if (error) return { ok: false, error };
    const plan = preparar(u);
    if (plan.error) return { ok: false, error: plan.error };
    const sentencias = [];
    if (claveOp) sentencias.push(opInsert(env, claveOp, { ok: true }));
    (plan.previas || []).forEach(x => sentencias.push(x));
    const idxUpdate = sentencias.length;
    // Solo cambia si el equipo sigue en el estado y deposito en que se lo leyo: si otro vendedor lo toco en el medio, no pisa.
    sentencias.push(env.DB.prepare('UPDATE unidades SET ' + plan.sets.join(', ') + ' WHERE id = ? AND estado = ? AND deposito_id = ?').bind(...plan.vals, u.id, u.estado, u.deposito_id));
    sentencias.push(movimientoSiCambio(env, u.id, plan.tipo, u.deposito_id, plan.hacia || null, usuario, plan.nota));
    const r = await ejecutar(env, sentencias, claveOp);
    if (r.cached) return r.cached;
    if (r.res[idxUpdate].meta.changes === 1) return { ok: true };
    // Perdio la carrera: otro cambio se adelanto. Se olvida la memoria del opId (para que un reintento vuelva a evaluar) y se
    // vuelve a leer: ahora el equipo esta en otro estado y sale el mensaje correcto ("ya estaba dado de baja", etc.).
    if (claveOp) await env.DB.prepare('DELETE FROM ops_stock WHERE clave = ?').bind(claveOp).run();
  }
  return { ok: false, error: 'El equipo cambio mientras se procesaba: intenta de nuevo' };
}

const actualizado = () => 'actualizado_en = ' + AHORA;

async function accionEgreso(env, d, usuario, claveOp) {
  const vendedor = nulo(d.vendedor); const usuarioTxt = nulo(d.usuario) || vendedor;
  return accionConUnidad(env, d, usuario, claveOp, u => {
    if (u.estado === 'vendido') return { error: 'Ese equipo ya estaba dado de baja' };
    const sets = ["estado = 'vendido'", actualizado()]; const vals = [];
    if (vendedor) { sets.push('propietario_texto = ?'); vals.push(vendedor); }
    if (usuarioTxt) { sets.push('usuario_texto = ?'); vals.push(usuarioTxt); }
    return { sets, vals, tipo: 'venta', nota: vendedor ? 'Vendedor: ' + vendedor : null };
  });
}

async function accionReservar(env, d, usuario, claveOp) {
  const nuevo = d.estado === 'Financiacion Propia' ? 'financiacion_propia' : 'reservado';
  return accionConUnidad(env, d, usuario, claveOp, u => {
    if (u.estado === 'vendido') return { error: 'Ese equipo ya esta vendido, no se puede reservar' };
    const sets = ['estado = ?', actualizado()]; const vals = [nuevo];
    if (nulo(d.usuario)) { sets.push('usuario_texto = ?'); vals.push(texto(d.usuario)); }
    return { sets, vals, tipo: nuevo === 'reservado' ? 'reserva' : 'financiacion', nota: nulo(d.usuario) };
  });
}

async function accionLiberar(env, d, usuario, claveOp) {
  return accionConUnidad(env, d, usuario, claveOp, u => {
    if (['reservado', 'financiacion_propia'].indexOf(u.estado) === -1) return { error: 'Ese equipo no esta Reservado (esta "' + ESTADO_TXT[u.estado] + '")' };
    const sets = ["estado = 'en_stock'", actualizado()]; const vals = [];
    if (nulo(d.usuario)) { sets.push('usuario_texto = ?'); vals.push(texto(d.usuario)); }
    return { sets, vals, tipo: 'liberar_reserva', nota: nulo(d.usuario) };
  });
}

async function accionTransferir(env, d, usuario, claveOp) {
  const destino = texto(d.sucursalDestino).toUpperCase();
  if (!destino) return { ok: false, error: 'Falta la sucursal de destino' };
  return accionConUnidad(env, d, usuario, claveOp, u => {
    if (u.estado === 'vendido') return { error: 'Ese equipo ya esta vendido, no se puede transferir' };
    if (u.deposito.toUpperCase() === destino) return { error: 'El equipo ya esta en ' + texto(d.sucursalDestino) };
    const sets = ['deposito_id = (SELECT id FROM depositos WHERE nombre = ?)', actualizado()]; const vals = [destino];
    if (nulo(d.usuario)) { sets.push('usuario_texto = ?'); vals.push(texto(d.usuario)); }
    return { sets, vals, tipo: 'transferencia', hacia: destino, nota: u.deposito + ' -> ' + destino, previas: [deposito(env, destino)] };
  });
}

// ---------------- Panel (admin y oficina): resumen, conteo fisico y exportacion ----------------

export async function stockPanel(env, url) {
  const g = k => (url.searchParams.get(k) || '').trim();
  const w = []; const b = [];
  const estado = ['en_stock', 'reservado', 'financiacion_propia', 'vendido'].indexOf(g('estado')) !== -1 ? g('estado') : null;
  if (estado) { w.push('u.estado = ?'); b.push(estado); } else w.push(`u.estado IN ${ACTIVOS}`);
  if (g('deposito')) { w.push('d.nombre = ? COLLATE NOCASE'); b.push(g('deposito')); }
  const q = g('q').replace(/[%_\\]/g, '').slice(0, 60);
  if (q) { w.push('(u.modelo LIKE ? OR u.imei_serie LIKE ? OR u.color LIKE ?)'); b.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
  const { results: unidades } = await env.DB.prepare(
    'SELECT u.id AS fila, u.imei_serie, u.modelo, u.capacidad, u.color, u.bateria_pct, d.nombre AS deposito, u.estado, u.observaciones, u.falla, u.propietario_texto, u.actualizado_en FROM unidades u JOIN depositos d ON d.id = u.deposito_id WHERE ' +
    w.join(' AND ') + ' ORDER BY u.modelo, u.capacidad, u.id LIMIT 300').bind(...b).all();
  const { results: porDeposito } = await env.DB.prepare(
    `SELECT d.nombre AS deposito, SUM(CASE WHEN u.estado = 'en_stock' THEN 1 ELSE 0 END) AS en_stock, SUM(CASE WHEN u.estado = 'reservado' THEN 1 ELSE 0 END) AS reservado, SUM(CASE WHEN u.estado = 'financiacion_propia' THEN 1 ELSE 0 END) AS financiacion
     FROM unidades u JOIN depositos d ON d.id = u.deposito_id WHERE u.estado IN ${ACTIVOS} GROUP BY d.nombre ORDER BY d.nombre`).all();
  const { results: depositos } = await env.DB.prepare('SELECT nombre FROM depositos ORDER BY nombre').all();
  return { ok: true, unidades: (unidades || []).map(u => Object.assign({}, u, { estado_txt: ESTADO_TXT[u.estado] })), porDeposito: porDeposito || [], depositos: (depositos || []).map(x => x.nombre) };
}

// Compara lo que hay fisicamente (lista de IMEI contados) con lo que el sistema dice que hay en ese deposito.
export async function stockConteo(env, body, usuario, ip) {
  const dep = texto(body.deposito).toUpperCase();
  const d = dep ? await env.DB.prepare('SELECT id, nombre FROM depositos WHERE nombre = ? COLLATE NOCASE').bind(dep).first() : null;
  if (!d) return { status: 400, cuerpo: { ok: false, error: 'Elegí el depósito que se contó' } };
  const crudo = Array.isArray(body.imeis) ? body.imeis.join('\n') : texto(body.imeis);
  const contados = [...new Set(crudo.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean))];
  if (!contados.length) return { status: 400, cuerpo: { ok: false, error: 'Pegá la lista de IMEI / series que contaste' } };
  if (contados.length > 2000) return { status: 400, cuerpo: { ok: false, error: 'La lista es demasiado larga (máximo 2000)' } };

  const { results: esperados } = await env.DB.prepare(`SELECT u.imei_serie, u.modelo, u.capacidad, u.color, u.estado FROM unidades u WHERE u.deposito_id = ? AND u.estado IN ${ACTIVOS} AND u.imei_serie NOT LIKE 'SIN-IMEI-%' ORDER BY u.modelo, u.id`).bind(d.id).all();
  const setContados = new Set(contados);
  const setEsperados = new Set((esperados || []).map(u => u.imei_serie));
  const faltantes = (esperados || []).filter(u => !setContados.has(u.imei_serie));
  const sobrantes = []; const otroDeposito = [];
  for (let i = 0; i < contados.length; i += 80) {
    const lote = contados.slice(i, i + 80).filter(x => !setEsperados.has(x));
    if (!lote.length) continue;
    const { results } = await env.DB.prepare(`SELECT u.imei_serie, u.modelo, u.estado, dd.nombre AS deposito FROM unidades u JOIN depositos dd ON dd.id = u.deposito_id WHERE u.imei_serie IN (${lote.map(() => '?').join(',')}) AND u.estado IN ${ACTIVOS}`).bind(...lote).all();
    const activos = new Map((results || []).map(u => [u.imei_serie, u]));
    lote.forEach(x => { const a = activos.get(x); if (a) otroDeposito.push({ imei: x, modelo: a.modelo, deposito_actual: a.deposito }); else sobrantes.push({ imei: x }); });
  }
  const resultado = { ok: true, deposito: d.nombre, esperados: (esperados || []).length, contados: contados.length, coinciden: (esperados || []).length - faltantes.length, faltantes, sobrantes, otroDeposito, registrado: false };
  if (body.registrar) {
    const sentencias = faltantes.slice(0, 200).map(f => env.DB.prepare("INSERT INTO alertas (tipo, imei_serie, detalle, usuario_id) VALUES ('stock_faltante', ?, ?, ?)")
      .bind(f.imei_serie, 'Conteo fisico en ' + d.nombre + ': no apareció ' + f.modelo + ' ' + (f.capacidad || '') + ' ' + (f.color || '') + ' (figura ' + ESTADO_TXT[f.estado] + ' en el sistema).', usuario.id));
    sentencias.push(env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, nota, despues_json, ip) VALUES (?, ?, 'stock.conteo', 'unidades', ?, ?, ?)")
      .bind(usuario.id, usuario.rol, d.nombre, JSON.stringify({ esperados: resultado.esperados, contados: resultado.contados, faltantes: faltantes.length, sobrantes: sobrantes.length, otro_deposito: otroDeposito.length }), ip));
    await env.DB.batch(sentencias);
    resultado.registrado = true;
  }
  return { status: 200, cuerpo: resultado };
}

// Una celda que empieza con = + - @ (o tabulacion) la ejecutaria Excel / Sheets como formula: se la deja como texto.
const csvCelda = v => { let t = String(v === null || v === undefined ? '' : v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
const fechaCordoba = iso => { if (!iso) return ''; const d = new Date(Date.parse(iso) - 3 * 3600 * 1000); if (isNaN(d)) return ''; const p = n => String(n).padStart(2, '0'); return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()); };

// CSV con el mismo orden de columnas que la hoja "Inventario iPhones" (para volver al Sheet si hace falta).
// La fila N del archivo corresponde a la fila N de la hoja: los equipos van en orden de ID, y si falta
// alguno el hueco se rellena con una fila vacia para que los numeros de fila sigan coincidiendo.
export async function stockExportarCsv(env) {
  const { results } = await env.DB.prepare('SELECT u.id, u.modelo, u.bateria_pct, u.color, u.capacidad, u.imei_serie, d.nombre AS deposito, u.estado, u.actualizado_en, u.observaciones, u.propietario_texto, u.falla, u.usuario_texto FROM unidades u JOIN depositos d ON d.id = u.deposito_id ORDER BY u.id').all();
  const filas = ['Modelo,Bateria,Color,Capacidad,IMEI,Sucursal,Estado,Último movimiento,Estado,Propietario,Observacion,usuario'];
  let esperada = 2;
  (results || []).forEach(u => {
    while (esperada < u.id) { filas.push(',,,,,,,,,,,'); esperada++; }
    filas.push([u.modelo, u.bateria_pct ? u.bateria_pct + '%' : '', u.color, u.capacidad, /^SIN-IMEI-/.test(u.imei_serie) ? '' : u.imei_serie, u.deposito, ESTADO_TXT[u.estado], fechaCordoba(u.actualizado_en), u.observaciones, u.propietario_texto, u.falla, u.usuario_texto].map(csvCelda).join(','));
    esperada = u.id + 1;
  });
  return new Response('﻿' + filas.join('\r\n') + '\r\n', { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="stock-' + new Date().toISOString().slice(0, 10) + '.csv"', 'Cache-Control': 'no-store' } });
}
