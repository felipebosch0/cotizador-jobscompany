// ============================================================
// LEGAJO DIGITAL, RESERVAS/FINANCIACIONES, FICHA DE CLIENTES Y DELEGADOS (base D1 + R2).
//
// Reglas de acceso:
//  - Las fotos (DNI, firmas, ENACOM) las SUBE cualquiera con sesion, de su sucursal, pero
//    SOLO las ven administracion y oficina. Cada vista queda en la auditoria.
//  - Nada se borra: un documento se reemplaza. El borrado por pedido del titular es solo
//    de administracion, con motivo (borra el archivo y deja la fila marcada).
//  - El delegado solo recibe cantidades de su local: nunca montos ni datos de clientes.
// ============================================================

const TIPOS_DOC = ['dni_frente', 'dni_dorso', 'enacom', 'garantia_firmada', 'declaracion_firmada', 'reserva_firmada', 'financiacion_firmada', 'recibo_firmado'];
const TIPOS_IMPRESION = ['garantia', 'declaracion', 'reserva', 'financiacion', 'recibo'];
const MIME_DOC = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_DOC_BYTES = 3 * 1024 * 1024;
const MAX_IMPRESION_BYTES = 1536 * 1024;
const TOPE_ALMACENAMIENTO = 9.5 * 1024 * 1024 * 1024;   // el plan gratis de R2 son 10 GB
const DIAS_PENDIENTES = 45;
export const TEXTO_PERMISO_OFERTAS = 'v1: Acepto que Jobs Company use mis datos y los de mis compras para enviarme ofertas de recambio y novedades. Puedo pedir la baja cuando quiera.';

const ROLES_PANEL = ['admin', 'oficina'];
const UID_RE = /^[A-Za-z0-9._:-]{8,100}$/;
const dniLimpio = v => { const d = String(v || '').replace(/[.\s-]/g, ''); return /^\d{7,8}$/.test(d) ? d : null; };
const hex = buf => Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');

// Sucursales donde esta prendido el flujo nuevo. Sin la variable no esta prendido en ninguna:
// publicar el codigo no cambia nada hasta que se la configure. "*" = todas.
export function sucursalesFlujoNuevo(env) {
  return String(env.FLUJO_NUEVO_SUCURSALES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}
export function flujoNuevoPara(env, sucursal) {
  const l = sucursalesFlujoNuevo(env);
  return l.indexOf('*') !== -1 || (!!sucursal && l.indexOf(String(sucursal).toLowerCase()) !== -1);
}

// ---------- quien es (rol y sucursal salen de la base) ----------
async function quienEs(request, env, h, roles) {
  const s = await h.sesionObligatoria(request, env);
  if (s.error) return { error: s.error };
  if (!env.DB) return { error: h.jsonConEstado({ ok: false, noConfigurado: true, error: 'La base de datos no esta conectada' }, 503) };
  const u = await env.DB.prepare('SELECT u.id, u.rol, u.usuario, u.nombre, u.sucursal_id, s.nombre AS sucursal FROM usuarios u LEFT JOIN sucursales s ON s.id = u.sucursal_id WHERE u.usuario = ? AND u.activo = 1').bind(s.sesion.usuario).first();
  if (!u) return { error: h.jsonConEstado({ ok: false, noConfigurado: true, error: 'Tu usuario todavia no esta en la base' }, 503) };
  if (roles && roles.indexOf(u.rol) === -1) return { error: h.jsonConEstado({ ok: false, error: 'No tenes permiso para esto' }, 403) };
  return { usuario: u, sesion: s.sesion };
}

async function sucursalPorNombre(env, nombre) {
  return env.DB.prepare('SELECT id, nombre FROM sucursales WHERE nombre = ? COLLATE NOCASE').bind(String(nombre || '')).first();
}

// El vendedor trabaja siempre en su sucursal; administracion y oficina indican cual.
async function sucursalDeTrabajo(env, usuario, pedida) {
  if (usuario.rol === 'vendedor' && usuario.sucursal_id) return { id: usuario.sucursal_id, nombre: usuario.sucursal };
  return sucursalPorNombre(env, pedida);
}

// Sucursal de una operacion ya registrada (venta, reserva, financiacion o canje), si existe.
async function sucursalDeOperacion(env, opid) {
  const f = await env.DB.prepare(
    `SELECT sucursal_id AS id FROM ventas WHERE opid = ?1
     UNION SELECT l.sucursal_id FROM reservas r JOIN locales l ON l.id = r.local_id WHERE r.opid = ?1
     UNION SELECT l.sucursal_id FROM financiaciones f JOIN locales l ON l.id = f.local_id WHERE f.opid = ?1
     UNION SELECT sucursal_id FROM documentos WHERE opid = ?1
     LIMIT 1`).bind(opid).first();
  return f ? f.id : null;
}

const puedeSucursal = (usuario, sucursalId) => ROLES_PANEL.indexOf(usuario.rol) !== -1 || !usuario.sucursal_id || usuario.sucursal_id === sucursalId;

// ---------------- Documentos ----------------
async function subirDocumento(request, env, h, uid, url) {
  const a = await quienEs(request, env, h);
  if (a.error) return a.error;
  if (!env.COMPROBANTES) return h.jsonConEstado({ ok: false, noConfigurado: true, error: 'El almacenamiento no esta conectado' }, 503);
  const opid = String(url.searchParams.get('opid') || '');
  const tipo = url.searchParams.get('tipo');
  const dni = dniLimpio(url.searchParams.get('dni'));
  if (!UID_RE.test(uid) || !UID_RE.test(opid) || TIPOS_DOC.indexOf(tipo) === -1) return h.jsonConEstado({ ok: false, error: 'Datos del documento invalidos' }, 400);
  if ((tipo === 'dni_frente' || tipo === 'dni_dorso') && !dni) return h.jsonConEstado({ ok: false, error: 'Falta el numero de DNI de la foto' }, 400);
  const mime = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!MIME_DOC[mime]) return h.jsonConEstado({ ok: false, error: 'Tiene que ser una imagen (JPG, PNG, WEBP) o un PDF' }, 415);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_DOC_BYTES) return h.jsonConEstado({ ok: false, error: 'El archivo pesa mas de 3 MB' }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return h.jsonConEstado({ ok: false, error: 'El archivo esta vacio' }, 400);
  if (bytes.length > MAX_DOC_BYTES) return h.jsonConEstado({ ok: false, error: 'El archivo pesa mas de 3 MB' }, 413);
  if (!h.coincideFirma(mime, bytes)) return h.jsonConEstado({ ok: false, error: 'El archivo no es del tipo que dice ser' }, 400);

  const usuario = a.usuario;
  const suc = await sucursalDeTrabajo(env, usuario, url.searchParams.get('sucursal'));
  if (!suc) return h.jsonConEstado({ ok: false, error: 'Falta la sucursal' }, 400);
  const deLaOperacion = await sucursalDeOperacion(env, opid);
  if (deLaOperacion && !puedeSucursal(usuario, deLaOperacion)) return h.jsonConEstado({ ok: false, error: 'Esa operacion es de otra sucursal' }, 403);
  const sucursalId = deLaOperacion || suc.id;
  const sha = hex(await crypto.subtle.digest('SHA-256', bytes));

  const previo = await env.DB.prepare('SELECT sha256 FROM documentos WHERE uid = ?').bind(uid).first();
  if (previo) return previo.sha256 === sha ? h.jsonConEstado({ ok: true, repetido: true }, 200) : h.jsonConEstado({ ok: false, error: 'Ese identificador ya se uso con otro archivo' }, 409);

  const usado = await env.DB.prepare("SELECT COALESCE(SUM(tamano_bytes), 0) AS t FROM documentos WHERE estado <> 'borrado'").first();
  if (usado.t + bytes.length > TOPE_ALMACENAMIENTO) return h.jsonConEstado({ ok: false, error: 'El almacenamiento esta lleno: avisale al administrador' }, 507);

  const ahora = new Date();
  const clave = 'legajo/' + ahora.getUTCFullYear() + '/' + String(ahora.getUTCMonth() + 1).padStart(2, '0') + '/' + h.aBase64Url(crypto.getRandomValues(new Uint8Array(18))) + '.' + MIME_DOC[mime];
  await env.COMPROBANTES.put(clave, bytes, { httpMetadata: { contentType: mime } });
  try {
    const sentencias = [];
    // La foto de DNI mas nueva reemplaza a las anteriores de esa persona.
    if (tipo === 'dni_frente' || tipo === 'dni_dorso') sentencias.push(env.DB.prepare("UPDATE documentos SET estado = 'reemplazado' WHERE cliente_dni = ? AND tipo = ? AND estado = 'vigente'").bind(dni, tipo));
    sentencias.push(env.DB.prepare('INSERT INTO documentos (uid, opid, tipo, cliente_dni, sucursal_id, clave_archivo, mime, tamano_bytes, sha256, subido_por_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(uid, opid, tipo, dni, sucursalId, clave, mime, bytes.length, sha, usuario.id));
    await env.DB.batch(sentencias);
  } catch (e) {
    await env.COMPROBANTES.delete(clave).catch(() => {});
    if (/documentos\.uid/.test(String(e && e.message))) return h.jsonConEstado({ ok: true, repetido: true }, 200);
    throw e;
  }
  await h.auditar(env, request, { usuarioId: usuario.id, rol: usuario.rol, accion: 'documento.subir', entidad: 'documentos', entidadId: null, nota: tipo + ' · ' + opid.slice(0, 40) });
  return h.jsonConEstado({ ok: true }, 200);
}

// Solo dice SI hay foto cargada de ese DNI y de cuando es. Nunca la imagen.
async function estadoDni(request, env, h, dniCrudo) {
  const a = await quienEs(request, env, h);
  if (a.error) return a.error;
  const dni = dniLimpio(dniCrudo);
  if (!dni) return h.jsonConEstado({ ok: false, error: 'DNI invalido' }, 400);
  const { results } = await env.DB.prepare("SELECT tipo, MAX(subido_en) AS en FROM documentos WHERE cliente_dni = ? AND estado = 'vigente' AND tipo IN ('dni_frente', 'dni_dorso') GROUP BY tipo").bind(dni).all();
  const por = {};
  (results || []).forEach(r => { por[r.tipo] = r.en; });
  return h.jsonConEstado({ ok: true, frente: !!por.dni_frente, dorso: !!por.dni_dorso, fecha: por.dni_frente || por.dni_dorso || null }, 200);
}

// ---------------- Impresiones (para reimprimir) ----------------
// El HTML lo arma el cotizador. Se guarda sin scripts y se sirve con una politica que no
// ejecuta nada: asi un dato cargado a mano no puede correr codigo al reimprimir.
export function limpiarHtml(html) {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*>/gi, '')
    .replace(/<\/?(iframe|object|embed|form|base|meta\s+http-equiv)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

async function guardarImpresion(request, env, h, opid, tipo, url) {
  const a = await quienEs(request, env, h);
  if (a.error) return a.error;
  if (!env.COMPROBANTES) return h.jsonConEstado({ ok: false, noConfigurado: true, error: 'El almacenamiento no esta conectado' }, 503);
  if (!UID_RE.test(opid) || TIPOS_IMPRESION.indexOf(tipo) === -1) return h.jsonConEstado({ ok: false, error: 'Datos invalidos' }, 400);
  const texto = await request.text();
  if (!texto || texto.length > MAX_IMPRESION_BYTES) return h.jsonConEstado({ ok: false, error: 'El papel es demasiado grande o esta vacio' }, 413);
  const suc = await sucursalDeTrabajo(env, a.usuario, url.searchParams.get('sucursal'));
  if (!suc) return h.jsonConEstado({ ok: false, error: 'Falta la sucursal' }, 400);
  const deLaOperacion = await sucursalDeOperacion(env, opid);
  if (deLaOperacion && !puedeSucursal(a.usuario, deLaOperacion)) return h.jsonConEstado({ ok: false, error: 'Esa operacion es de otra sucursal' }, 403);
  const ya = await env.DB.prepare('SELECT id, sucursal_id FROM impresiones WHERE opid = ? AND tipo = ?').bind(opid, tipo).first();
  if (ya) return puedeSucursal(a.usuario, ya.sucursal_id) ? h.jsonConEstado({ ok: true, repetido: true }, 200) : h.jsonConEstado({ ok: false, error: 'Esa operacion es de otra sucursal' }, 403);
  const clave = 'impresiones/' + h.aBase64Url(crypto.getRandomValues(new Uint8Array(18))) + '.html';
  await env.COMPROBANTES.put(clave, limpiarHtml(texto), { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
  const titulo = String(url.searchParams.get('titulo') || tipo).replace(/[<>]/g, '').slice(0, 120);
  await env.DB.prepare('INSERT OR IGNORE INTO impresiones (opid, tipo, titulo, sucursal_id, clave_archivo, creado_por_id) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(opid, tipo, titulo, deLaOperacion || suc.id, clave, a.usuario.id).run();
  return h.jsonConEstado({ ok: true }, 200);
}

async function verImpresion(request, env, h, opid, tipo) {
  const a = await quienEs(request, env, h);
  if (a.error) return a.error;
  const f = await env.DB.prepare('SELECT id, sucursal_id, clave_archivo, creado_en FROM impresiones WHERE opid = ? AND tipo = ?').bind(opid, tipo).first();
  if (!f) return h.jsonConEstado({ ok: false, error: 'Ese papel no esta guardado' }, 404);
  if (!puedeSucursal(a.usuario, f.sucursal_id)) return h.jsonConEstado({ ok: false, error: 'No tenes permiso para esto' }, 403);
  // Un vendedor reimprime papeles recientes; mas viejos, por administracion u oficina.
  if (a.usuario.rol === 'vendedor' && Date.now() - Date.parse(f.creado_en) > DIAS_PENDIENTES * 86400000) return h.jsonConEstado({ ok: false, error: 'Ese papel es viejo: pedilo a administracion' }, 403);
  const obj = env.COMPROBANTES && await env.COMPROBANTES.get(f.clave_archivo);
  if (!obj) return h.jsonConEstado({ ok: false, error: 'El archivo no esta en el almacenamiento' }, 404);
  await h.auditar(env, request, { usuarioId: a.usuario.id, rol: a.usuario.rol, accion: 'impresion.ver', entidad: 'impresiones', entidadId: f.id, nota: tipo });
  return new Response(obj.body, { status: 200, headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"
  } });
}

// ---------------- Que falta en cada operacion ----------------
// Una sola regla para el vendedor y para el panel.
export function documentosRequeridos(op) {
  const pide = ['dni_frente', 'dni_dorso'];
  if (op.clase === 'venta') {
    if (op.conGarantia) pide.push('garantia_firmada');
    if (op.conCanje) pide.push('declaracion_firmada', 'enacom');
  }
  if (op.clase === 'reserva') pide.push('reserva_firmada');
  if (op.clase === 'financiacion') pide.push('financiacion_firmada');
  return pide;
}

export async function faltantesDe(env, ops) {
  if (!ops.length) return ops;
  const marcas = ops.map(() => '?').join(',');
  const opids = ops.map(o => o.opid);
  const dnis = ops.map(o => o.dni || '-');
  const docs = (await env.DB.prepare("SELECT opid, tipo FROM documentos WHERE estado = 'vigente' AND opid IN (" + marcas + ')').bind(...opids).all()).results || [];
  const dniDocs = (await env.DB.prepare("SELECT cliente_dni AS dni, tipo FROM documentos WHERE estado = 'vigente' AND tipo IN ('dni_frente','dni_dorso') AND cliente_dni IN (" + marcas + ')').bind(...dnis).all()).results || [];
  // La captura de ENACOM puede estar adjunta al pago del canje.
  const enPago = (await env.DB.prepare("SELECT v.opid FROM comprobantes c JOIN pagos p ON p.id = c.pago_id AND p.metodo = 'canje' JOIN ventas v ON v.id = p.venta_id WHERE v.opid IN (" + marcas + ')').bind(...opids).all()).results || [];
  const tiene = new Set(docs.map(d => d.opid + '|' + d.tipo));
  enPago.forEach(r => tiene.add(r.opid + '|enacom'));
  const dniTiene = new Set(dniDocs.map(d => d.dni + '|' + d.tipo));
  return ops.map(o => Object.assign(o, { faltan: documentosRequeridos(o).filter(t => !tiene.has(o.opid + '|' + t) && !dniTiene.has((o.dni || '-') + '|' + t)) }));
}

async function listaPendientes(request, env, h, url) {
  const a = await quienEs(request, env, h);
  if (a.error) return a.error;
  const suc = await sucursalDeTrabajo(env, a.usuario, url.searchParams.get('sucursal'));
  if (!suc) return h.jsonConEstado({ ok: false, error: 'Falta la sucursal' }, 400);
  const desde = new Date(Date.now() - DIAS_PENDIENTES * 86400000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT 'venta' AS clase, v.opid, v.codigo AS referencia, v.fecha_hora, c.nombre, c.dni,
            (SELECT GROUP_CONCAT(i.descripcion, ' + ') FROM venta_items i WHERE i.venta_id = v.id) AS producto,
            EXISTS (SELECT 1 FROM venta_items i WHERE i.venta_id = v.id AND i.garantia_meses IS NOT NULL) AS conGarantia,
            EXISTS (SELECT 1 FROM tradeins t WHERE t.venta_id = v.id) AS conCanje
       FROM ventas v JOIN clientes c ON c.id = v.cliente_id WHERE v.sucursal_id = ?1 AND v.estado <> 'anulada' AND v.fecha_hora >= ?2
     UNION ALL
     SELECT 'reserva', r.opid, 'Reserva ' || r.id, r.fecha_hora, c.nombre, c.dni, r.equipo_descripcion, 0, 0
       FROM reservas r JOIN clientes c ON c.id = r.cliente_id JOIN locales l ON l.id = r.local_id WHERE l.sucursal_id = ?1 AND r.opid IS NOT NULL AND r.estado <> 'cancelada' AND r.fecha_hora >= ?2
     UNION ALL
     SELECT 'financiacion', f.opid, 'Financiacion ' || f.id, f.fecha_hora, c.nombre, c.dni, f.equipo_descripcion, 0, 0
       FROM financiaciones f JOIN clientes c ON c.id = f.cliente_id JOIN locales l ON l.id = f.local_id WHERE l.sucursal_id = ?1 AND f.opid IS NOT NULL AND f.estado <> 'cancelado' AND f.fecha_hora >= ?2
     ORDER BY 4 DESC LIMIT 80`).bind(suc.id, desde).all();
  const ops = await faltantesDe(env, results || []);
  const impresas = ops.length ? ((await env.DB.prepare('SELECT opid, tipo, titulo FROM impresiones WHERE opid IN (' + ops.map(() => '?').join(',') + ')').bind(...ops.map(o => o.opid)).all()).results || []) : [];
  // Al vendedor no se le manda el DNI: le alcanza con el nombre y el producto.
  const salida = ops.map(o => ({ clase: o.clase, opid: o.opid, referencia: o.referencia, fecha: o.fecha_hora, cliente: o.nombre, producto: o.producto, faltan: o.faltan, papeles: impresas.filter(i => i.opid === o.opid).map(i => ({ tipo: i.tipo, titulo: i.titulo })) }));
  const soloFaltantes = url.searchParams.get('todas') !== '1';
  return h.jsonConEstado({ ok: true, sucursal: suc.nombre, operaciones: soloFaltantes ? salida.filter(o => o.faltan.length) : salida }, 200);
}

// ---------------- Reservas y financiaciones ----------------
function validarCliente(c, h) {
  const nombre = String((c && c.nombre) || '').replace(/\s+/g, ' ').trim();
  const dni = dniLimpio(c && c.dni);
  const telefono = String((c && c.telefono) || '').replace(/[\s().+-]/g, '');
  const email = String((c && c.email) || '').trim().toLowerCase();
  if (nombre.length < 3) return { error: 'Falta el nombre del cliente' };
  if (!dni) return { error: 'El DNI tiene que tener 7 u 8 numeros' };
  if (!/^\d{8,15}$/.test(telefono)) return { error: 'Falta el telefono del cliente' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'Email del cliente invalido' };
  return { cliente: { nombre: nombre.slice(0, 120), dni, telefono, email: email || null, aceptaOfertas: !!(c && c.aceptaOfertas) } };
}

export function sentenciasPermiso(env, dni, acepta) {
  if (!acepta) return [];
  return [env.DB.prepare("UPDATE clientes SET acepta_ofertas_en = COALESCE(acepta_ofertas_en, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), acepta_ofertas_texto = COALESCE(acepta_ofertas_texto, ?) WHERE dni = ?").bind(TEXTO_PERMISO_OFERTAS, dni)];
}

function sentenciasCliente(env, c) {
  return [
    env.DB.prepare('INSERT INTO clientes (nombre, dni, email, telefono) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM clientes WHERE dni = ?)').bind(c.nombre, c.dni, c.email, c.telefono, c.dni),
    env.DB.prepare('UPDATE clientes SET telefono = ?, email = COALESCE(?, email) WHERE dni = ?').bind(c.telefono, c.email, c.dni),
    ...sentenciasPermiso(env, c.dni, c.aceptaOfertas)
  ];
}

function sumarDiasHabiles(ymd, dias) {
  const d = new Date(ymd + 'T12:00:00Z');
  for (let n = 0; n < dias;) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0) n++; }
  return d.toISOString().slice(0, 10);
}

async function datosDeLugar(env, usuario, b) {
  const suc = await sucursalDeTrabajo(env, usuario, b.sucursal);
  if (!suc) return { error: 'Sucursal desconocida' };
  if (usuario.rol === 'vendedor' && b.sucursal && String(b.sucursal).toLowerCase() !== String(suc.nombre).toLowerCase()) return { error: 'Tu usuario es de ' + suc.nombre };
  const local = await env.DB.prepare('SELECT id FROM locales WHERE nombre = ? AND sucursal_id = ?').bind(String(b.local || ''), suc.id).first();
  if (!local) return { error: 'Local desconocido para esa sucursal' };
  const vendedor = String(b.vendedor || '').trim();
  if (vendedor.length < 2) return { error: 'Falta el vendedor' };
  return { suc, local, vendedor };
}

const VENDEDOR_SQL = '(SELECT id FROM vendedores WHERE nombre = ? COLLATE NOCASE)';
const CLIENTE_SQL = '(SELECT id FROM clientes WHERE dni = ? ORDER BY id LIMIT 1)';

async function crearPlan(request, env, h, clase) {
  const a = await quienEs(request, env, h);
  if (a.error) return a.error;
  const b = await h.cuerpoJson(request);
  const opId = String(b.opId || '');
  if (!UID_RE.test(opId)) return h.jsonConEstado({ ok: false, error: 'Falta el identificador de la operacion' }, 400);
  const esReserva = clase === 'reserva';
  const tabla = esReserva ? 'reservas' : 'financiaciones';
  const previa = await env.DB.prepare('SELECT id FROM ' + tabla + ' WHERE opid = ?').bind(opId).first();
  if (previa) return h.jsonConEstado({ ok: true, repetida: true, id: previa.id }, 200);
  const { cliente, error } = validarCliente(b.cliente, h);
  if (error) return h.jsonConEstado({ ok: false, error }, 400);
  const lugar = await datosDeLugar(env, a.usuario, b);
  if (lugar.error) return h.jsonConEstado({ ok: false, error: lugar.error }, 400);
  const equipo = String(b.equipo || '').replace(/[<>]/g, '').trim().slice(0, 200);
  if (equipo.length < 3) return h.jsonConEstado({ ok: false, error: 'Falta el equipo' }, 400);
  const total = Number(esReserva ? b.total : b.totalUsd);
  if (!(total > 0)) return h.jsonConEstado({ ok: false, error: 'Falta el total' }, 400);
  const v = await h.validarPagos(env, b.pagos, b.cotizacionUsd, null);
  if (v.error) return h.jsonConEstado({ ok: false, error: v.error }, 400);
  if (esReserva && v.pagos.reduce((t, p) => t + p.equivArs, 0) > h.aCentavos(total) + 100) return h.jsonConEstado({ ok: false, error: 'La seña supera el total de la reserva' }, 400);

  const imei = h.textoONull(b.imei);
  const sent = [
    env.DB.prepare('INSERT OR IGNORE INTO vendedores (nombre, sucursal_id, local_id) VALUES (?, ?, ?)').bind(lugar.vendedor, lugar.suc.id, lugar.local.id),
    ...sentenciasCliente(env, cliente)
  ];
  if (esReserva) {
    sent.push(env.DB.prepare('INSERT INTO reservas (opid, vendedor_id, local_id, cliente_id, equipo_descripcion, imei_serie, total_centavos, vence_en, observaciones, registrado_por_id) VALUES (?, ' + VENDEDOR_SQL + ', ?, ' + CLIENTE_SQL + ', ?, ?, ?, ?, ?, ?)')
      .bind(opId, lugar.vendedor, lugar.local.id, cliente.dni, equipo, imei, h.aCentavos(total), sumarDiasHabiles(h.hoyCordoba(), 5), h.textoONull(b.observaciones), a.usuario.id));
  } else {
    sent.push(env.DB.prepare('INSERT INTO financiaciones (opid, vendedor_id, cliente_id, local_id, equipo_descripcion, imei_serie, monto_total_usd_centavos, registrado_por_id) VALUES (?, ' + VENDEDOR_SQL + ', ' + CLIENTE_SQL + ', ?, ?, ?, ?, ?)')
      .bind(opId, lugar.vendedor, cliente.dni, lugar.local.id, equipo, imei, h.aCentavos(total), a.usuario.id));
  }
  const padre = { columna: esReserva ? 'reserva_id' : 'financiacion_id', sql: '(SELECT id FROM ' + tabla + ' WHERE opid = ?)', valor: opId };
  v.pagos.forEach(p => sent.push(h.sentenciaPago(env, p, padre, lugar.suc.id, a.usuario.id, null)));
  sent.push(env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, nota, ip) VALUES (?, ?, '" + clase + ".crear', '" + tabla + "', (SELECT id FROM " + tabla + ' WHERE opid = ?), ?, ?)')
    .bind(a.usuario.id, a.usuario.rol, opId, equipo, h.IP_DE(request)));
  try {
    await env.DB.batch(sent);
  } catch (e) {
    const otra = await env.DB.prepare('SELECT id FROM ' + tabla + ' WHERE opid = ?').bind(opId).first();
    if (otra) return h.jsonConEstado({ ok: true, repetida: true, id: otra.id }, 200);
    console.log('[' + clase + '] ' + (e && e.message));
    return h.jsonConEstado({ ok: false, error: 'No se pudo guardar en la base' }, 500);
  }
  const creada = await env.DB.prepare('SELECT id FROM ' + tabla + ' WHERE opid = ?').bind(opId).first();
  const pagos = (await env.DB.prepare('SELECT id FROM pagos WHERE ' + padre.columna + ' = ? ORDER BY id').bind(creada.id).all()).results || [];
  return h.jsonConEstado({ ok: true, id: creada.id, pagoIds: pagos.map(p => p.id) }, 200);
}

// Reservas y planes abiertos de un cliente en mi sucursal (para cuotas o para completar la venta).
async function planesAbiertos(request, env, h, url) {
  const a = await quienEs(request, env, h);
  if (a.error) return a.error;
  const suc = await sucursalDeTrabajo(env, a.usuario, url.searchParams.get('sucursal'));
  if (!suc) return h.jsonConEstado({ ok: false, error: 'Falta la sucursal' }, 400);
  const dni = dniLimpio(url.searchParams.get('dni'));
  const reservas = (await env.DB.prepare(
    `SELECT r.id, r.equipo_descripcion AS equipo, r.total_centavos, r.vence_en, c.nombre AS cliente,
            COALESCE((SELECT SUM(p.equiv_ars_centavos) FROM pagos p WHERE p.reserva_id = r.id AND p.estado = 'vigente'), 0) AS pagado_centavos
       FROM reservas r JOIN clientes c ON c.id = r.cliente_id JOIN locales l ON l.id = r.local_id
      WHERE r.estado = 'activa' AND l.sucursal_id = ?1 AND (?2 IS NULL OR c.dni = ?2) ORDER BY r.id DESC LIMIT 50`).bind(suc.id, dni).all()).results || [];
  const planes = (await env.DB.prepare(
    `SELECT f.id, f.equipo_descripcion AS equipo, f.monto_total_usd_centavos, c.nombre AS cliente,
            COALESCE((SELECT SUM(p.equiv_usd_centavos) FROM pagos p WHERE p.financiacion_id = f.id AND p.estado = 'vigente'), 0) AS pagado_usd_centavos,
            COALESCE((SELECT SUM(p.equiv_ars_centavos) FROM pagos p WHERE p.financiacion_id = f.id AND p.estado = 'vigente'), 0) AS pagado_centavos
       FROM financiaciones f JOIN clientes c ON c.id = f.cliente_id JOIN locales l ON l.id = f.local_id
      WHERE f.estado = 'activo' AND l.sucursal_id = ?1 AND (?2 IS NULL OR c.dni = ?2) ORDER BY f.id DESC LIMIT 50`).bind(suc.id, dni).all()).results || [];
  return h.jsonConEstado({ ok: true, reservas, financiaciones: planes }, 200);
}

async function pagarCuota(request, env, h, finId) {
  const a = await quienEs(request, env, h);
  if (a.error) return a.error;
  const b = await h.cuerpoJson(request);
  const opId = String(b.opId || '');
  if (!UID_RE.test(opId)) return h.jsonConEstado({ ok: false, error: 'Falta el identificador del pago' }, 400);
  const f = await env.DB.prepare('SELECT f.id, f.estado, f.monto_total_usd_centavos, l.sucursal_id FROM financiaciones f JOIN locales l ON l.id = f.local_id WHERE f.id = ?').bind(finId).first();
  if (!f) return h.jsonConEstado({ ok: false, error: 'Ese plan no existe' }, 404);
  if (!puedeSucursal(a.usuario, f.sucursal_id)) return h.jsonConEstado({ ok: false, error: 'Ese plan es de otra sucursal' }, 403);
  const previo = await env.DB.prepare('SELECT id FROM pagos WHERE opid = ?').bind(opId + ':0').first();
  if (previo) return h.jsonConEstado({ ok: true, repetida: true }, 200);
  if (f.estado !== 'activo') return h.jsonConEstado({ ok: false, error: 'Ese plan ya no esta activo' }, 409);
  const v = await h.validarPagos(env, b.pagos, b.cotizacionUsd, null);
  if (v.error) return h.jsonConEstado({ ok: false, error: v.error }, 400);
  if (!v.pagos.length) return h.jsonConEstado({ ok: false, error: 'Falta el pago' }, 400);
  const ya = await env.DB.prepare("SELECT COALESCE(SUM(equiv_usd_centavos), 0) AS t FROM pagos WHERE financiacion_id = ? AND estado = 'vigente'").bind(finId).first();
  const nuevo = v.pagos.reduce((t, p) => t + p.equivUsd, 0);
  if (ya.t + nuevo > f.monto_total_usd_centavos + 100) return h.jsonConEstado({ ok: false, error: 'El pago supera lo que falta del plan' }, 400);
  const padre = { columna: 'financiacion_id', sql: '?', valor: finId };
  const sent = v.pagos.map((p, i) => h.sentenciaPago(env, p, padre, f.sucursal_id, a.usuario.id, opId + ':' + i));
  sent.push(env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, nota, ip) VALUES (?, ?, 'financiacion.pago', 'financiaciones', ?, ?, ?)").bind(a.usuario.id, a.usuario.rol, finId, 'USD ' + (nuevo / 100), h.IP_DE(request)));
  try { await env.DB.batch(sent); }
  catch (e) {
    if (/pagos\.opid/.test(String(e && e.message))) return h.jsonConEstado({ ok: true, repetida: true }, 200);
    console.log('[cuota] ' + (e && e.message)); return h.jsonConEstado({ ok: false, error: 'No se pudo guardar el pago' }, 500);
  }
  const ids = [];
  for (let i = 0; i < v.pagos.length; i++) ids.push((await env.DB.prepare('SELECT id FROM pagos WHERE opid = ?').bind(opId + ':' + i).first()).id);
  return h.jsonConEstado({ ok: true, pagoIds: ids, saldoUsdCentavos: f.monto_total_usd_centavos - ya.t - nuevo }, 200);
}

async function cancelarPlan(request, env, h, clase, id) {
  const a = await quienEs(request, env, h, ['admin']);
  if (a.error) return a.error;
  const b = await h.cuerpoJson(request);
  const motivo = h.textoONull(b.motivo);
  if (!motivo || motivo.length < 3) return h.jsonConEstado({ ok: false, error: 'Falta el motivo' }, 400);
  const tabla = clase === 'reserva' ? 'reservas' : 'financiaciones';
  const activo = clase === 'reserva' ? 'activa' : 'activo';
  const nuevo = clase === 'reserva' ? 'cancelada' : 'cancelado';
  const r = await env.DB.prepare('UPDATE ' + tabla + " SET estado = ? WHERE id = ? AND estado = ?").bind(nuevo, id, activo).run();
  if (!r.meta.changes) return h.jsonConEstado({ ok: false, error: 'No se puede cancelar (no existe o ya no esta activa)' }, 409);
  await h.auditar(env, request, { usuarioId: a.usuario.id, rol: a.usuario.rol, accion: clase + '.cancelar', entidad: tabla, entidadId: id, nota: motivo.slice(0, 200) });
  return h.jsonConEstado({ ok: true }, 200);
}

// ---------------- Panel: documentos, planes y clientes ----------------
export async function legajoDeVenta(env, ventaId) {
  const v = await env.DB.prepare(
    `SELECT v.opid, c.dni, EXISTS (SELECT 1 FROM venta_items i WHERE i.venta_id = v.id AND i.garantia_meses IS NOT NULL) AS conGarantia,
            EXISTS (SELECT 1 FROM tradeins t WHERE t.venta_id = v.id) AS conCanje
       FROM ventas v JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?`).bind(ventaId).first();
  if (!v) return null;
  const docs = (await env.DB.prepare(
    "SELECT d.id, d.tipo, d.mime, d.tamano_bytes, d.subido_en, u.nombre AS subido_por FROM documentos d JOIN usuarios u ON u.id = d.subido_por_id WHERE d.estado = 'vigente' AND (d.opid = ? OR (d.cliente_dni = ? AND d.tipo IN ('dni_frente','dni_dorso'))) ORDER BY d.tipo, d.id").bind(v.opid, v.dni || '-').all()).results || [];
  const [op] = await faltantesDe(env, [{ clase: 'venta', opid: v.opid, dni: v.dni, conGarantia: v.conGarantia, conCanje: v.conCanje }]);
  const papeles = (await env.DB.prepare('SELECT tipo, titulo FROM impresiones WHERE opid = ?').bind(v.opid).all()).results || [];
  return { opid: v.opid, documentos: docs, faltan: op.faltan, papeles };
}

async function verDocumento(request, env, h, id) {
  const a = await quienEs(request, env, h, ROLES_PANEL);
  if (a.error) return a.error;
  const f = await env.DB.prepare('SELECT id, clave_archivo, mime, tipo, estado FROM documentos WHERE id = ?').bind(id).first();
  if (!f || f.estado === 'borrado') return h.jsonConEstado({ ok: false, error: 'Ese documento no existe' }, 404);
  const obj = env.COMPROBANTES && await env.COMPROBANTES.get(f.clave_archivo);
  if (!obj) return h.jsonConEstado({ ok: false, error: 'El archivo no esta en el almacenamiento' }, 404);
  await h.auditar(env, request, { usuarioId: a.usuario.id, rol: a.usuario.rol, accion: 'documento.ver', entidad: 'documentos', entidadId: f.id, nota: f.tipo });
  return new Response(obj.body, { status: 200, headers: { 'Content-Type': f.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="' + f.tipo + '-' + f.id + '.' + MIME_DOC[f.mime] + '"' } });
}

async function borrarDocumento(request, env, h, id) {
  const a = await quienEs(request, env, h, ['admin']);
  if (a.error) return a.error;
  const b = await h.cuerpoJson(request);
  const motivo = h.textoONull(b.motivo);
  if (!motivo || motivo.length < 5) return h.jsonConEstado({ ok: false, error: 'Falta el motivo del borrado' }, 400);
  const f = await env.DB.prepare('SELECT id, clave_archivo, estado FROM documentos WHERE id = ?').bind(id).first();
  if (!f || f.estado === 'borrado') return h.jsonConEstado({ ok: false, error: 'Ese documento no existe' }, 404);
  if (env.COMPROBANTES) await env.COMPROBANTES.delete(f.clave_archivo);
  await env.DB.prepare("UPDATE documentos SET estado = 'borrado', baja_motivo = ?, baja_por_id = ?, baja_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(motivo.slice(0, 300), a.usuario.id, id).run();
  await h.auditar(env, request, { usuarioId: a.usuario.id, rol: a.usuario.rol, accion: 'documento.borrar', entidad: 'documentos', entidadId: id, nota: motivo.slice(0, 200) });
  return h.jsonConEstado({ ok: true }, 200);
}

async function panelPlanes(request, env, h) {
  const a = await quienEs(request, env, h, ROLES_PANEL);
  if (a.error) return a.error;
  const filas = (await env.DB.prepare(
    `SELECT 'reserva' AS clase, r.id, r.opid, r.fecha_hora, r.estado, r.equipo_descripcion AS equipo, r.total_centavos AS total, 'ARS' AS moneda, r.vence_en,
            c.nombre AS cliente, c.dni, c.telefono, l.nombre AS local, ve.nombre AS vendedor,
            COALESCE((SELECT SUM(p.equiv_ars_centavos) FROM pagos p WHERE p.reserva_id = r.id AND p.estado = 'vigente'), 0) AS pagado
       FROM reservas r JOIN clientes c ON c.id = r.cliente_id JOIN locales l ON l.id = r.local_id JOIN vendedores ve ON ve.id = r.vendedor_id
     UNION ALL
     SELECT 'financiacion', f.id, f.opid, f.fecha_hora, f.estado, f.equipo_descripcion, f.monto_total_usd_centavos, 'USD', NULL,
            c.nombre, c.dni, c.telefono, l.nombre, ve.nombre,
            COALESCE((SELECT SUM(p.equiv_usd_centavos) FROM pagos p WHERE p.financiacion_id = f.id AND p.estado = 'vigente'), 0)
       FROM financiaciones f JOIN clientes c ON c.id = f.cliente_id JOIN locales l ON l.id = f.local_id JOIN vendedores ve ON ve.id = f.vendedor_id
     ORDER BY 4 DESC LIMIT 150`).all()).results || [];
  const conFaltantes = await faltantesDe(env, filas.filter(f => f.opid).slice(0, 80).map(f => ({ clase: f.clase, opid: f.opid, dni: f.dni, _id: f.clase + f.id })));
  const faltan = {};
  conFaltantes.forEach(o => { faltan[o._id] = o.faltan; });
  const ids = filas.length ? ((await env.DB.prepare('SELECT p.id, p.reserva_id, p.financiacion_id, p.metodo, p.moneda, p.monto_centavos, p.verificacion, p.estado FROM pagos p WHERE p.reserva_id IS NOT NULL OR p.financiacion_id IS NOT NULL ORDER BY p.id DESC LIMIT 400').all()).results || []) : [];
  const docs = (await env.DB.prepare("SELECT d.id, d.opid, d.tipo FROM documentos d WHERE d.estado = 'vigente' AND d.opid IN (SELECT opid FROM reservas WHERE opid IS NOT NULL UNION SELECT opid FROM financiaciones WHERE opid IS NOT NULL) LIMIT 500").all()).results || [];
  return h.jsonConEstado({ ok: true, planes: filas.map(f => Object.assign(f, { faltan: faltan[f.clase + f.id] || [], pagos: ids.filter(p => (f.clase === 'reserva' ? p.reserva_id : p.financiacion_id) === f.id), documentos: docs.filter(d => d.opid === f.opid) })) }, 200);
}

// Clientes con lo que tienen y lo que entregaron, para ofrecerles un recambio.
async function panelClientes(request, env, h, url) {
  const a = await quienEs(request, env, h, ROLES_PANEL);
  if (a.error) return a.error;
  const q = url.searchParams;
  const como = v => v ? '%' + String(v).replace(/[%_]/g, '') + '%' : null;
  const meses = Math.max(0, Math.min(120, Number(q.get('meses')) || 0));
  const antes = meses ? new Date(Date.now() - meses * 30.4 * 86400000).toISOString() : null;
  const soloPermiso = q.get('soloPermiso') === '1' ? 1 : 0;
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.nombre, c.dni, c.telefono, c.email, c.acepta_ofertas_en, c.no_contactar_en,
            EXISTS (SELECT 1 FROM seguimientos sg JOIN ventas vs ON vs.id = sg.venta_id WHERE vs.cliente_id = c.id AND sg.estado = 'no_contactar') AS no_contactar_venta,
            (SELECT GROUP_CONCAT(i.descripcion, ' + ') FROM venta_items i JOIN ventas v ON v.id = i.venta_id WHERE v.cliente_id = c.id AND v.estado <> 'anulada' AND NOT EXISTS (SELECT 1 FROM devoluciones d WHERE d.venta_item_id = i.id)) AS compro,
            (SELECT GROUP_CONCAT(t.modelo, ' + ') FROM tradeins t WHERE t.cliente_id = c.id) AS entrego,
            (SELECT MAX(v.fecha_hora) FROM ventas v WHERE v.cliente_id = c.id AND v.estado <> 'anulada') AS ultima_compra
       FROM clientes c
      WHERE (?1 IS NULL OR EXISTS (SELECT 1 FROM venta_items i JOIN ventas v ON v.id = i.venta_id WHERE v.cliente_id = c.id AND v.estado <> 'anulada' AND (i.modelo LIKE ?1 OR i.descripcion LIKE ?1)))
        AND (?2 IS NULL OR EXISTS (SELECT 1 FROM tradeins t WHERE t.cliente_id = c.id AND t.modelo LIKE ?2))
        AND (?3 IS NULL OR (SELECT MAX(v.fecha_hora) FROM ventas v WHERE v.cliente_id = c.id AND v.estado <> 'anulada') <= ?3)
        AND (?4 = 0 OR (c.acepta_ofertas_en IS NOT NULL AND c.no_contactar_en IS NULL
             AND NOT EXISTS (SELECT 1 FROM seguimientos sg JOIN ventas vs ON vs.id = sg.venta_id WHERE vs.cliente_id = c.id AND sg.estado = 'no_contactar')))
        AND (?5 IS NULL OR c.nombre LIKE ?5 OR c.dni LIKE ?5 OR c.telefono LIKE ?5)
      ORDER BY ultima_compra DESC LIMIT 200`).bind(como(q.get('modelo')), como(q.get('entregado')), antes, soloPermiso, como(q.get('q'))).all();
  const clientes = (results || []).map(c => Object.assign(c, { se_puede_ofrecer: !!c.acepta_ofertas_en && !c.no_contactar_en && !c.no_contactar_venta }));
  return h.jsonConEstado({ ok: true, clientes }, 200);
}

async function panelNoContactar(request, env, h, id) {
  const a = await quienEs(request, env, h, ROLES_PANEL);
  if (a.error) return a.error;
  const b = await h.cuerpoJson(request);
  const motivo = h.textoONull(b.motivo);
  if (!motivo || motivo.length < 3) return h.jsonConEstado({ ok: false, error: 'Falta el motivo' }, 400);
  const r = await env.DB.prepare("UPDATE clientes SET no_contactar_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), no_contactar_motivo = ?, acepta_ofertas_en = NULL, acepta_ofertas_texto = NULL WHERE id = ?").bind(motivo.slice(0, 200), id).run();
  if (!r.meta.changes) return h.jsonConEstado({ ok: false, error: 'Ese cliente no existe' }, 404);
  await h.auditar(env, request, { usuarioId: a.usuario.id, rol: a.usuario.rol, accion: 'cliente.no_contactar', entidad: 'clientes', entidadId: id, nota: motivo.slice(0, 200) });
  return h.jsonConEstado({ ok: true }, 200);
}

async function usoDeEspacio(request, env, h) {
  const a = await quienEs(request, env, h, ROLES_PANEL);
  if (a.error) return a.error;
  const u = await env.DB.prepare("SELECT COUNT(*) AS archivos, COALESCE(SUM(tamano_bytes), 0) AS bytes, COUNT(DISTINCT opid) AS operaciones FROM documentos WHERE estado <> 'borrado'").first();
  const c = await env.DB.prepare('SELECT COUNT(*) AS archivos, COALESCE(SUM(tamano_bytes), 0) AS bytes FROM comprobantes').first();
  return h.jsonConEstado({ ok: true, archivos: u.archivos + c.archivos, bytes: u.bytes + c.bytes, limite: 10 * 1024 * 1024 * 1024, operaciones: u.operaciones }, 200);
}

// ---------------- Delegados y objetivos ----------------
// Reparte un objetivo en partes iguales; lo que sobra se suma de a uno a los primeros.
export function repartir(total, personas) {
  if (!personas) return [];
  const base = Math.floor(total / personas), resto = total % personas;
  return Array.from({ length: personas }, (_, i) => base + (i < resto ? 1 : 0));
}

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Cantidades del mes por vendedor del local. Sin montos y sin datos de clientes.
export async function avanceDeLocal(env, localId, mes) {
  const vendedores = (await env.DB.prepare('SELECT id, nombre FROM vendedores WHERE local_id = ? AND activo = 1 ORDER BY nombre').bind(localId).all()).results || [];
  const objetivo = await env.DB.prepare('SELECT equipos, accesorios, servicios, premio_texto FROM objetivos_local WHERE mes = ? AND local_id = ?').bind(mes, localId).first();
  const ventas = (await env.DB.prepare(
    `SELECT v.vendedor_id AS id,
            COUNT(DISTINCT CASE WHEN i.tipo = 'equipo' AND i.garantia_meses IS NOT NULL THEN CASE WHEN upper(COALESCE(i.imei_serie,'')) IN ('S/N','') THEN 'i' || i.id ELSE i.imei_serie END END) AS equipos,
            SUM(CASE WHEN i.tipo = 'accesorio' THEN 1 ELSE 0 END) AS accesorios
       FROM venta_items i JOIN ventas v ON v.id = i.venta_id
      WHERE v.estado <> 'anulada' AND substr(datetime(v.fecha_hora, '-3 hours'), 1, 7) = ? AND NOT EXISTS (SELECT 1 FROM devoluciones d WHERE d.venta_item_id = i.id)
      GROUP BY v.vendedor_id`).bind(mes).all()).results || [];
  const servicios = (await env.DB.prepare('SELECT vendedor_id AS id, COUNT(*) AS n FROM comisiones_servicios WHERE mes = ? GROUP BY vendedor_id').bind(mes).all()).results || [];
  const primero = await env.DB.prepare("SELECT substr(datetime(MIN(fecha_hora), '-3 hours'), 1, 10) AS d FROM ventas WHERE local_id = ?").bind(localId).first();
  const meta = objetivo || { equipos: 0, accesorios: 0, servicios: 0, premio_texto: null };
  const partes = { equipos: repartir(meta.equipos, vendedores.length), accesorios: repartir(meta.accesorios, vendedores.length), servicios: repartir(meta.servicios, vendedores.length) };
  const filas = vendedores.map((v, i) => {
    const x = ventas.find(r => r.id === v.id) || {};
    const s = servicios.find(r => r.id === v.id);
    return { vendedor: v.nombre, equipos: x.equipos || 0, accesorios: x.accesorios || 0, servicios: s ? s.n : 0, objetivo: { equipos: partes.equipos[i], accesorios: partes.accesorios[i], servicios: partes.servicios[i] } };
  });
  const suma = k => filas.reduce((t, f) => t + f[k], 0);
  return { mes, objetivo: { equipos: meta.equipos, accesorios: meta.accesorios, servicios: meta.servicios }, premio: meta.premio_texto, total: { equipos: suma('equipos'), accesorios: suma('accesorios'), servicios: suma('servicios') }, vendedores: filas, datosDesde: primero ? primero.d : null };
}

async function localDelegado(env, usuarioId) {
  return env.DB.prepare('SELECT l.id, l.nombre FROM delegados_local d JOIN locales l ON l.id = d.local_id WHERE d.usuario_id = ? AND d.activo = 1').bind(usuarioId).first();
}

async function avanceDelegado(request, env, h, url) {
  const a = await quienEs(request, env, h);
  if (a.error) return a.error;
  const local = await localDelegado(env, a.usuario.id);
  if (!local) return h.jsonConEstado({ ok: false, error: 'No sos delegado de ningun local' }, 403);
  const mes = MES_RE.test(url.searchParams.get('mes') || '') ? url.searchParams.get('mes') : h.hoyCordoba().slice(0, 7);
  return h.jsonConEstado(Object.assign({ ok: true, local: local.nombre }, await avanceDeLocal(env, local.id, mes)), 200);
}

async function adminEquipo(request, env, h, url) {
  const a = await quienEs(request, env, h, ['admin']);
  if (a.error) return a.error;
  const mes = MES_RE.test(url.searchParams.get('mes') || '') ? url.searchParams.get('mes') : h.hoyCordoba().slice(0, 7);
  const locales = (await env.DB.prepare('SELECT l.id, l.nombre, s.nombre AS sucursal FROM locales l JOIN sucursales s ON s.id = l.sucursal_id WHERE l.activo = 1 ORDER BY l.id').all()).results || [];
  const vendedores = (await env.DB.prepare('SELECT id, nombre, local_id, sucursal_id, usuario_id, activo FROM vendedores ORDER BY nombre').all()).results || [];
  const usuarios = (await env.DB.prepare("SELECT u.id, u.usuario, u.nombre, u.rol, s.nombre AS sucursal FROM usuarios u LEFT JOIN sucursales s ON s.id = u.sucursal_id WHERE u.activo = 1 ORDER BY u.usuario").all()).results || [];
  const delegados = (await env.DB.prepare('SELECT local_id, usuario_id FROM delegados_local WHERE activo = 1').all()).results || [];
  const avance = [];
  for (const l of locales) avance.push(Object.assign({ local_id: l.id }, await avanceDeLocal(env, l.id, mes)));
  return h.jsonConEstado({ ok: true, mes, locales, vendedores, usuarios, delegados, avance }, 200);
}

async function adminEquipoGuardar(request, env, h, accion) {
  const a = await quienEs(request, env, h, ['admin']);
  if (a.error) return a.error;
  const b = await h.cuerpoJson(request);
  const localId = b.localId ? Number(b.localId) : null;
  const local = localId ? await env.DB.prepare('SELECT id, sucursal_id, nombre FROM locales WHERE id = ?').bind(localId).first() : null;
  if (accion === 'vendedor') {
    const v = await env.DB.prepare('SELECT id FROM vendedores WHERE id = ?').bind(Number(b.vendedorId)).first();
    if (!v) return h.jsonConEstado({ ok: false, error: 'Ese vendedor no existe' }, 404);
    if (localId && !local) return h.jsonConEstado({ ok: false, error: 'Ese local no existe' }, 404);
    await env.DB.prepare('UPDATE vendedores SET local_id = ?, sucursal_id = COALESCE(?, sucursal_id), activo = ? WHERE id = ?')
      .bind(localId, local ? local.sucursal_id : null, b.activo === false ? 0 : 1, v.id).run();
  } else if (accion === 'delegado') {
    if (!local) return h.jsonConEstado({ ok: false, error: 'Ese local no existe' }, 404);
    const sent = [env.DB.prepare('UPDATE delegados_local SET activo = 0 WHERE local_id = ? AND activo = 1').bind(local.id)];
    if (b.usuarioId) {
      const u = await env.DB.prepare('SELECT id FROM usuarios WHERE id = ? AND activo = 1').bind(Number(b.usuarioId)).first();
      if (!u) return h.jsonConEstado({ ok: false, error: 'Ese usuario no existe' }, 404);
      sent.push(env.DB.prepare('UPDATE delegados_local SET activo = 0 WHERE usuario_id = ? AND activo = 1').bind(u.id));
      sent.push(env.DB.prepare('INSERT INTO delegados_local (usuario_id, local_id) VALUES (?, ?)').bind(u.id, local.id));
    }
    await env.DB.batch(sent);
  } else {
    if (!local || !MES_RE.test(b.mes || '')) return h.jsonConEstado({ ok: false, error: 'Falta el local o el mes' }, 400);
    const n = k => Number(b[k] || 0);
    if (!['equipos', 'accesorios', 'servicios'].every(k => Number.isInteger(n(k)) && n(k) >= 0 && n(k) < 100000)) return h.jsonConEstado({ ok: false, error: 'Los objetivos tienen que ser numeros enteros' }, 400);
    await env.DB.prepare("INSERT INTO objetivos_local (mes, local_id, equipos, accesorios, servicios, premio_texto, cargado_por_id) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(mes, local_id) DO UPDATE SET equipos = excluded.equipos, accesorios = excluded.accesorios, servicios = excluded.servicios, premio_texto = excluded.premio_texto, cargado_por_id = excluded.cargado_por_id, actualizado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
      .bind(b.mes, local.id, n('equipos'), n('accesorios'), n('servicios'), h.textoONull(b.premio), a.usuario.id).run();
  }
  await h.auditar(env, request, { usuarioId: a.usuario.id, rol: a.usuario.rol, accion: 'equipo.' + accion, entidad: 'locales', entidadId: localId, nota: JSON.stringify(b).slice(0, 200) });
  return h.jsonConEstado({ ok: true }, 200);
}

// Una orden de servicio tecnico cargada en la planilla se anota tambien en la base (para los objetivos).
export async function anotarServicio(env, datos, sesion) {
  if (!env.DB || !sesion) return;
  const u = await env.DB.prepare('SELECT id FROM usuarios WHERE usuario = ?').bind(sesion.usuario).first();
  const v = await env.DB.prepare('SELECT id, sucursal_id FROM vendedores WHERE nombre = ? COLLATE NOCASE').bind(String(datos.vendedor || '')).first();
  if (!u || !v || !datos.orden || !MES_RE.test(datos.mes || '')) return;
  await env.DB.prepare('INSERT OR IGNORE INTO comisiones_servicios (orden, mes, sucursal_id, vendedor_id, cargado_por_id) VALUES (?, ?, ?, ?, ?)').bind(String(datos.orden).trim().slice(0, 40), datos.mes, v.sucursal_id, v.id, u.id).run();
}

async function configuracion(request, env, h) {
  const s = await h.sesionObligatoria(request, env);
  if (s.error) return s.error;
  let delegadoDe = null, sucursal = s.sesion.sucursal || null;
  if (env.DB) {
    try {
      const u = await env.DB.prepare('SELECT id FROM usuarios WHERE usuario = ? AND activo = 1').bind(s.sesion.usuario).first();
      if (u) { const l = await localDelegado(env, u.id); delegadoDe = l ? l.nombre : null; }
    } catch (e) { /* base sin las tablas nuevas */ }
  }
  return h.jsonConEstado({ ok: true, flujoNuevo: sucursalesFlujoNuevo(env), flujoEnMiSucursal: flujoNuevoPara(env, sucursal), delegadoDe, textoPermisoOfertas: TEXTO_PERMISO_OFERTAS }, 200);
}

// Devuelve la respuesta si la ruta es de este modulo; null si no.
export async function manejarLegajo(request, env, url, h) {
  const r = url.pathname, m = request.method;
  let x;
  const conocida = r === '/api/config' || r === '/api/pendientes' || r === '/api/planes' || r === '/api/reservas' || r === '/api/financiaciones' || r === '/api/delegado/avance' || r === '/api/panel/planes' || r === '/api/panel/clientes' || r === '/api/panel/legajo/uso' ||
    /^\/api\/(documentos|impresiones|admin\/equipo|admin\/objetivos|panel\/documentos|panel\/clientes|panel\/reservas|panel\/financiaciones)(\/|$)/.test(r) || /^\/api\/financiaciones\/\d+\/pagos$/.test(r);
  if (!conocida) return null;
  try {
    if (r === '/api/config' && m === 'GET') return configuracion(request, env, h);
    if (r === '/api/pendientes' && m === 'GET') return await listaPendientes(request, env, h, url);
    if (r === '/api/planes' && m === 'GET') return await planesAbiertos(request, env, h, url);
    if (r === '/api/reservas' && m === 'POST') return await crearPlan(request, env, h, 'reserva');
    if (r === '/api/financiaciones' && m === 'POST') return await crearPlan(request, env, h, 'financiacion');
    if ((x = r.match(/^\/api\/financiaciones\/(\d+)\/pagos$/)) && m === 'POST') return await pagarCuota(request, env, h, Number(x[1]));
    if ((x = r.match(/^\/api\/documentos\/dni\/([^/]+)$/)) && m === 'GET') return await estadoDni(request, env, h, decodeURIComponent(x[1]));
    if ((x = r.match(/^\/api\/documentos\/([^/]+)$/)) && m === 'PUT') return await subirDocumento(request, env, h, decodeURIComponent(x[1]), url);
    if ((x = r.match(/^\/api\/impresiones\/([^/]+)\/([a-z]+)$/))) {
      if (m === 'PUT') return await guardarImpresion(request, env, h, decodeURIComponent(x[1]), x[2], url);
      if (m === 'GET') return await verImpresion(request, env, h, decodeURIComponent(x[1]), x[2]);
    }
    if ((x = r.match(/^\/api\/panel\/documentos\/(\d+)$/)) && m === 'GET') return await verDocumento(request, env, h, Number(x[1]));
    if ((x = r.match(/^\/api\/panel\/documentos\/(\d+)\/borrar$/)) && m === 'POST') return await borrarDocumento(request, env, h, Number(x[1]));
    if (r === '/api/panel/planes' && m === 'GET') return await panelPlanes(request, env, h);
    if ((x = r.match(/^\/api\/panel\/(reservas|financiaciones)\/(\d+)\/cancelar$/)) && m === 'POST') return await cancelarPlan(request, env, h, x[1] === 'reservas' ? 'reserva' : 'financiacion', Number(x[2]));
    if (r === '/api/panel/clientes' && m === 'GET') return await panelClientes(request, env, h, url);
    if ((x = r.match(/^\/api\/panel\/clientes\/(\d+)\/no-contactar$/)) && m === 'POST') return await panelNoContactar(request, env, h, Number(x[1]));
    if (r === '/api/panel/legajo/uso' && m === 'GET') return await usoDeEspacio(request, env, h);
    if (r === '/api/delegado/avance' && m === 'GET') return await avanceDelegado(request, env, h, url);
    if (r === '/api/admin/equipo' && m === 'GET') return await adminEquipo(request, env, h, url);
    if ((x = r.match(/^\/api\/admin\/equipo\/(vendedor|delegado)$/)) && m === 'POST') return await adminEquipoGuardar(request, env, h, x[1]);
    if (r === '/api/admin/objetivos' && m === 'POST') return await adminEquipoGuardar(request, env, h, 'objetivos');
    return h.jsonConEstado({ ok: false, error: 'Ruta desconocida' }, 404);
  } catch (e) {
    console.log('[legajo] ' + r + ': ' + (e && e.message));
    return h.jsonConEstado({ ok: false, error: 'No se pudo completar. Proba de nuevo.' }, 500);
  }
}
