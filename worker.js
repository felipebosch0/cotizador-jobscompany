// ============================================================
// Worker principal (Cloudflare Workers con Static Assets). Reemplaza a las
// funciones de netlify/functions/ -- la cuenta de Cloudflare del usuario
// usa el sistema unificado "Workers" (no el Pages clasico con carpeta
// functions/ de ruteo automatico), asi que hay que manejar las rutas a
// mano y despues delegarle a env.ASSETS todo lo que no sea una de las 3
// rutas de API.
//
// Rutas de API: /dolar, /stock, /stock-imeis, /stock-write, /reportes/:tipo, /reportes-write
// (mismo comportamiento y forma de respuesta que las funciones de Netlify
// que reemplazan).
// Todo lo demas (index.html, app.js, data.js, etc.) lo sirve env.ASSETS,
// que es el binding de "archivos estaticos" que Cloudflare arma solo a
// partir de la config "assets" de wrangler.jsonc.
// ============================================================

import { stockLeer, stockImeis, stockEscribir, stockPanel, stockConteo, stockExportarCsv } from './stock-db.js';

const LIBRO_STOCK_ID = '1WFl9nKbYYyOuz6ZLLzCNpnhrgd5qWqveP_IXmKG_1HE';
const NOMBRE_HOJA_INVENTARIO = 'Inventario iPhones';
const ESTADOS_STOCK_VISIBLES = ['En Stock', 'Reservado', 'Financiacion Propia'];
const URL_INFODOLAR = 'https://www.infodolar.com/cotizacion-dolar-provincia-cordoba.aspx';

// Sheet separado (no el de Stock) donde vive el modulo de Reportes de
// gestion -- Ventas/VentasProducto/VentasProductoAnterior/Stock, cargadas
// por el admin via drag&drop desde el cotizador (ver /reportes-write). El
// ID es publico (Sheet compartido "Cualquiera con el enlace > Lector"),
// no hace falta que sea secreto -- igual que LIBRO_STOCK_ID arriba.
const LIBRO_REPORTES_ID = '12baER-esKK6_vrXMLFVaWmsVLXvCIlKTosMFyVINzY0';
const GID_HOJAS_EXPORT = { VentasEquipos: '1038264943', ComisionesServicios: '111379614', ComisionesAccesorios: '602716115' };
const HOJAS_REPORTES_VALIDAS = ['Ventas', 'VentasProducto', 'VentasProductoAnterior', 'Stock', 'Reservas', 'FinanciacionPropia', 'FinanciacionPagos', 'VentasEquipos', 'ComisionesAccesorios', 'ComisionesServicios'];

function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

// ---------------- /dolar ----------------

function extraerCeldasDolar(html) {
  const inicio = html.indexOf('id="BluePromedio"');
  if (inicio === -1) throw new Error('No se encontro la tabla BluePromedio en el HTML de infodolar.com');
  const cierre = html.indexOf('</table>', inicio);
  const bloque = html.slice(inicio, cierre === -1 ? undefined : cierre);
  const regexDataOrder = /data-order="([^"]*)"/g;
  const valores = [];
  let match;
  while ((match = regexDataOrder.exec(bloque)) !== null) valores.push(match[1]);
  return valores;
}

function limpiarNumero(valor) {
  return Number(valor.replace(/\$/g, '').trim().split(',')[0].replace(/\./g, ''));
}

async function manejarDolar() {
  try {
    const response = await fetch(URL_INFODOLAR);
    if (!response.ok) throw new Error('infodolar.com respondio ' + response.status);
    const html = await response.text();
    const celdas = extraerCeldasDolar(html);
    const DolarCompra = limpiarNumero(celdas[0]);
    const DolarVenta = limpiarNumero(celdas[1]);
    return jsonResponse({ DolarCompra, DolarVenta, actualizado: new Date().toISOString() });
  } catch (error) {
    return jsonResponse({ DolarCompra: 0, DolarVenta: 0, actualizado: null, error: String(error.message || error) });
  }
}

// ---------------- /stock ----------------

function parseCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else entreComillas = false;
      } else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (c === '\r') { /* ignorar */ }
    else campo += c;
  }
  if (campo.length || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

function bateriaAPorcentaje(valorCrudo) {
  const limpio = String(valorCrudo || '').replace('%', '').trim();
  const num = Number(limpio);
  if (!num) return 0;
  return Math.round(num <= 1 ? num * 100 : num);
}

function capacidadANumero(valorCrudo) {
  const texto = String(valorCrudo || '');
  if (/t/i.test(texto)) return 1024;
  return Number(texto) || 0;
}

async function manejarStock() {
  try {
    const url = 'https://docs.google.com/spreadsheets/d/' + LIBRO_STOCK_ID +
      '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(NOMBRE_HOJA_INVENTARIO);
    const response = await fetch(url);
    if (!response.ok) throw new Error('Google Sheets respondio ' + response.status);
    const texto = await response.text();
    if (/^\s*<!DOCTYPE html/i.test(texto)) {
      throw new Error('La planilla no es publica (Compartir > Cualquiera con el enlace > Lector)');
    }
    const filas = parseCsv(texto).slice(1);
    const stock = [];
    filas.forEach(fila => {
      const modelo = String(fila[0] || '').trim();
      const estado = String(fila[6] || '').trim();
      if (!modelo || !estado) return;
      if (ESTADOS_STOCK_VISIBLES.indexOf(estado) === -1) return;
      stock.push({
        modelo: modelo,
        capacidad: capacidadANumero(fila[3]),
        bateria: bateriaAPorcentaje(fila[1]),
        color: String(fila[2] || '').trim(),
        sucursal: String(fila[5] || '').trim(),
        estado: estado,
        observaciones: String(fila[8] || '').trim(),
        falla: String(fila[10] || '').trim()
      });
    });
    return jsonResponse({ stock: stock, error: null });
  } catch (error) {
    return jsonResponse({ stock: [], error: String(error.message || error) });
  }
}

// ---------------- /stock-imeis ----------------
// Unidades "En Stock" CON IMEI/Serie, para que el modal de Garantia deje
// elegir el equipo de una lista en vez de tipear 15 digitos a mano. Se pide
// recien al abrir ese modal (no va dentro de /stock, que se carga siempre al
// abrir el cotizador). Solo "En Stock": lo Reservado o en Financiacion Propia
// no se ofrece como disponible para vender.
async function manejarStockImeis() {
  try {
    const url = 'https://docs.google.com/spreadsheets/d/' + LIBRO_STOCK_ID +
      '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(NOMBRE_HOJA_INVENTARIO);
    const response = await fetch(url);
    if (!response.ok) throw new Error('Google Sheets respondio ' + response.status);
    const texto = await response.text();
    if (/^\s*<!DOCTYPE html/i.test(texto)) {
      throw new Error('La planilla no es publica (Compartir > Cualquiera con el enlace > Lector)');
    }
    const unidades = [];
    parseCsv(texto).slice(1).forEach(fila => {
      const modelo = String(fila[0] || '').trim();
      const imei = String(fila[4] || '').replace(/\s+/g, '');
      const estado = String(fila[6] || '').trim();
      if (!modelo || !imei || estado !== 'En Stock') return;
      unidades.push({
        modelo: modelo,
        capacidad: capacidadANumero(fila[3]),
        bateria: bateriaAPorcentaje(fila[1]),
        color: String(fila[2] || '').trim(),
        imei: imei,
        sucursal: String(fila[5] || '').trim(),
        condicion: String(fila[8] || '').trim()
      });
    });
    return jsonResponse({ unidades: unidades, error: null });
  } catch (error) {
    return jsonResponse({ unidades: [], error: String(error.message || error) });
  }
}

// ---------------- /stock-write ----------------

async function manejarStockWrite(request, env) {
  const url = env.APPS_SCRIPT_STOCK_URL;
  if (!url) return jsonResponse({ ok: false, error: 'Falta configurar APPS_SCRIPT_STOCK_URL en Cloudflare' });

  try {
    const bodyTexto = await request.text();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: bodyTexto,
      redirect: 'follow'
    });
    const texto = await response.text();
    let json;
    try { json = JSON.parse(texto); } catch (e) { json = { ok: false, error: 'Respuesta invalida del Apps Script: ' + texto.slice(0, 200) }; }
    return jsonResponse(json);
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error.message || error) });
  }
}

// ---------------- /reportes/:tipo ----------------
// Lectura generica de una de las 4 pestanas del Sheet de Reportes. A
// diferencia de /stock, ac no se arma un objeto con forma fija -- se
// devuelven encabezados + filas tal cual estan en la pestana, porque cada
// una tiene columnas distintas (son 4 reportes de Cianbox diferentes) y
// toda la logica de negocio (run-rate, top productos, alertas de stock,
// etc.) vive en app.js, no aca.

// Los vendedores no ven los reportes de administracion, y en VentasEquipos reciben las
// columnas con datos del cliente en blanco (se mantiene la posicion de cada columna).
const REPORTES_DE_VENDEDOR = ['Reservas', 'FinanciacionPropia', 'FinanciacionPagos', 'VentasEquipos', 'ComisionesAccesorios', 'ComisionesServicios'];
const COLUMNA_DE_CLIENTE = /dni|mail|correo|tel[eé]fono|celular|domicilio|direcci[oó]n|cliente|comprador|^nombre/i;
const ACCIONES_SOLO_ADMIN = ['reportes-escribir', 'comision-accesorios-guardar', 'comision-servicio-eliminar'];

function ocultarDatosDeCliente(encabezados, filas) {
  const ocultas = encabezados.map((h, i) => COLUMNA_DE_CLIENTE.test(String(h || '').trim()) ? i : -1).filter(i => i >= 0);
  return filas.map(f => f.map((c, i) => ocultas.indexOf(i) !== -1 ? '' : c));
}

async function manejarReportesRead(tipo, rol) {
  if (HOJAS_REPORTES_VALIDAS.indexOf(tipo) === -1) {
    return jsonResponse({ encabezados: [], filas: [], error: 'Tipo de reporte desconocido: ' + tipo });
  }
  try {
    // gviz respeta los filtros de la planilla (si alguien deja un filtro puesto,
    // faltan filas); /export trae siempre todas. Se usa para las pestanas que
    // alimentan las comisiones, de las que se conoce el gid.
    const gid = GID_HOJAS_EXPORT[tipo];
    const url = 'https://docs.google.com/spreadsheets/d/' + LIBRO_REPORTES_ID +
      (gid ? '/export?format=csv&gid=' + gid : '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(tipo));
    const response = await fetch(url);
    if (!response.ok) throw new Error('Google Sheets respondio ' + response.status);
    const texto = await response.text();
    if (/^\s*<!DOCTYPE html/i.test(texto)) {
      throw new Error('La planilla no es publica (Compartir > Cualquiera con el enlace > Lector)');
    }
    const todasLasFilas = parseCsv(texto);
    const encabezados = todasLasFilas[0] || [];
    let filas = todasLasFilas.slice(1).filter(fila => fila.some(celda => String(celda || '').trim() !== ''));
    if (rol === 'vendedor' && tipo === 'VentasEquipos') filas = ocultarDatosDeCliente(encabezados, filas);
    return jsonResponse({ encabezados, filas, error: null });
  } catch (error) {
    return jsonResponse({ encabezados: [], filas: [], error: String(error.message || error) });
  }
}

// ---------------- /reportes-write ----------------
// Mismo patron que /stock-write: reenvia tal cual al Apps Script "puerta de
// entrada" del Sheet de Reportes (URL en la variable de entorno
// APPS_SCRIPT_REPORTES_URL, configurada en Cloudflare -- no en este
// archivo, para no dejarla expuesta en el codigo que baja al navegador).

async function manejarReportesWrite(request, env, rol) {
  const url = env.APPS_SCRIPT_REPORTES_URL;
  try {
    const bodyTexto = await request.text();
    if (rol && rol !== 'admin') {
      let accion = '';
      try { accion = String(JSON.parse(bodyTexto).accion || ''); } catch (e) {}
      if (ACCIONES_SOLO_ADMIN.indexOf(accion) !== -1) return jsonConEstado({ ok: false, error: 'Solo administracion puede hacer eso' }, 403);
    }
    if (!url) return jsonResponse({ ok: false, error: 'Falta configurar APPS_SCRIPT_REPORTES_URL en Cloudflare' });
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: bodyTexto,
      redirect: 'follow'
    });
    const texto = await response.text();
    let json;
    try { json = JSON.parse(texto); } catch (e) { json = { ok: false, error: 'Respuesta invalida del Apps Script: ' + texto.slice(0, 200) }; }
    return jsonResponse(json);
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error.message || error) });
  }
}

// ---------------- Login y sesion (servidor) ----------------
// Reemplaza al login que vivia en el navegador (auth.js). Secretos en
// Cloudflare (nunca en el codigo):
//   USUARIOS_JSON  = lista de { usuario, hash, rol, nombre, sucursal } (ver
//                    herramientas/generar-usuarios.mjs, que arma los hashes)
//   SESSION_SECRET = texto largo al azar con el que se firma la cookie
//   REQUIRE_AUTH   = "1" para exigir sesion en las rutas de datos; sin eso
//                    solo se registra en el log quien llamo sin sesion
//   LOGIN_KV       = (opcional) KV para contar intentos fallidos y guardar las
//                    claves que cada usuario cambio ("clave:<usuario>")
//   FORZAR_CAMBIO_CLAVE = "1" para que quien todavia no cambio su clave tenga
//                    que hacerlo antes de usar el sistema (necesita LOGIN_KV)
//   DB             = (opcional) base D1 "cotizador-produccion". Si esta y tiene
//                    usuarios, la lista de usuarios sale de ahi (con rol y baja);
//                    USUARIOS_JSON queda de respaldo. Los ingresos y cambios de
//                    clave quedan en la tabla "auditoria".
// Si falta USUARIOS_JSON o SESSION_SECRET, /api/login responde 501 y el
// navegador sigue con el login viejo: asi se puede desplegar sin cortar nada.

const SESION_COOKIE = 'sid';
const SESION_HORAS = 12;
const MAX_INTENTOS = 5;
const VENTANA_INTENTOS_SEG = 15 * 60;
const ITERACIONES_CLAVE = 10000; // bajo a proposito: el plan gratis de Workers limita el CPU por pedido
const intentosLocales = new Map(); // respaldo si no hay LOGIN_KV (por instancia)

const codificador = new TextEncoder();

function aBase64Url(bytes) {
  let bin = '';
  new Uint8Array(bytes).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64Url(texto) {
  const b64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function igualesConstante(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

// hash guardado: "pbkdf2$<iteraciones>$<sal base64url>$<hash base64url>"
async function verificarClave(clave, guardado) {
  const partes = String(guardado || '').split('$');
  if (partes.length !== 4 || partes[0] !== 'pbkdf2') return false;
  const iteraciones = Number(partes[1]);
  const sal = deBase64Url(partes[2]);
  const esperado = deBase64Url(partes[3]);
  const material = await crypto.subtle.importKey('raw', codificador.encode(clave), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones }, material, esperado.length * 8);
  return igualesConstante(new Uint8Array(bits), esperado);
}

async function hashearClave(clave) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', codificador.encode(clave), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: ITERACIONES_CLAVE }, material, 256);
  return 'pbkdf2$' + ITERACIONES_CLAVE + '$' + aBase64Url(sal) + '$' + aBase64Url(bits);
}

// Hash vigente de un usuario: la clave que cambio (KV) o, si no cambio, la inicial.
async function hashVigente(env, usuario, hashInicial) {
  if (!env.LOGIN_KV) return { hash: hashInicial, cambiada: false };
  const propia = await env.LOGIN_KV.get('clave:' + usuario);
  return propia ? { hash: propia, cambiada: true } : { hash: hashInicial, cambiada: false };
}

// ---- Usuarios: la base (D1) manda; USUARIOS_JSON queda de respaldo ----
// Si D1 esta conectada (binding DB) y tiene usuarios, ESA es la lista: ahi se
// da de alta/baja a alguien y se cambia su rol. Si D1 no esta, falla o esta
// vacia, se usa USUARIOS_JSON como hasta ahora, asi que el login no se corta.
// Cada usuario trae "hashRespaldo" (el de USUARIOS_JSON) por si el de la base
// no coincide: se prueban los dos antes de rechazar una clave.
async function cargarUsuarios(env) {
  let json = [];
  try { json = JSON.parse(env.USUARIOS_JSON || '[]'); } catch (e) { json = null; }
  if (env.DB) {
    try {
      const { results } = await env.DB.prepare(
        'SELECT u.id, u.usuario, u.nombre, u.rol, s.nombre AS sucursal, u.clave_hash AS hash ' +
        'FROM usuarios u LEFT JOIN sucursales s ON s.id = u.sucursal_id WHERE u.activo = 1'
      ).all();
      if (results && results.length) {
        const respaldo = {};
        (json || []).forEach(u => { respaldo[u.usuario] = u.hash; });
        return { usuarios: results.map(u => Object.assign({}, u, { usuario: String(u.usuario).toLowerCase(), hashRespaldo: respaldo[String(u.usuario).toLowerCase()] || null })), origen: 'base' };
      }
    } catch (e) {
      console.log('[auth] D1 no disponible, uso USUARIOS_JSON: ' + (e && e.message));
    }
  }
  if (json === null) return { usuarios: null, origen: 'json-malformado' };
  return { usuarios: json, origen: 'json' };
}

// Libro de auditoria: nunca puede frenar un ingreso, por eso no propaga errores.
async function auditar(env, request, datos) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      'INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, antes_json, despues_json, nota, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(datos.usuarioId || null, datos.rol || null, datos.accion, datos.entidad || 'usuarios', datos.entidadId || null,
      datos.antes ? JSON.stringify(datos.antes) : null, datos.despues ? JSON.stringify(datos.despues) : null, datos.nota || null,
      request.headers.get('CF-Connecting-IP') || null).run();
  } catch (e) {
    console.log('[auditoria] no se pudo registrar ' + datos.accion + ': ' + (e && e.message));
  }
}

async function marcarIngreso(env, usuarioId) {
  if (!env.DB || !usuarioId) return;
  try {
    await env.DB.prepare("UPDATE usuarios SET ultimo_ingreso_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(usuarioId).run();
  } catch (e) {
    console.log('[auth] no se pudo marcar el ultimo ingreso: ' + (e && e.message));
  }
}

// Exige que la sesion tenga uno de los roles; devuelve la respuesta de error o null.
function exigirRol(sesion, roles) {
  if (!sesion) return jsonConEstado({ ok: false, error: 'Sesion vencida o inexistente', sinSesion: true }, 401);
  if (roles.indexOf(sesion.rol) === -1) return jsonConEstado({ ok: false, error: 'No tenes permiso para esto' }, 403);
  return null;
}

const CLAVES_DEBILES = ['12345678', 'password', 'contrasena', 'jobscompany', 'jobscompany468', 'shopping123', 'independencia123', 'dino123', 'jobs468'];

function validarClaveNueva(nueva, actual, usuario) {
  if (nueva.length < 8) return 'La clave nueva tiene que tener al menos 8 caracteres';
  if (nueva === actual) return 'La clave nueva tiene que ser distinta a la actual';
  if (nueva.toLowerCase() === usuario) return 'La clave no puede ser igual al usuario';
  if (CLAVES_DEBILES.indexOf(nueva.toLowerCase()) !== -1) return 'Esa clave es muy comun, elegi otra';
  if (!/[a-zA-Z]/.test(nueva) || !/\d/.test(nueva)) return 'La clave tiene que tener letras y numeros';
  return null;
}

async function claveHmac(env) {
  return crypto.subtle.importKey('raw', codificador.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function firmarSesion(env, datos) {
  const cuerpo = aBase64Url(codificador.encode(JSON.stringify(datos)));
  const firma = await crypto.subtle.sign('HMAC', await claveHmac(env), codificador.encode(cuerpo));
  return cuerpo + '.' + aBase64Url(firma);
}

function leerCookie(request, nombre) {
  const cookies = request.headers.get('Cookie') || '';
  const m = cookies.split(/;\s*/).find(c => c.startsWith(nombre + '='));
  return m ? m.slice(nombre.length + 1) : '';
}

// Devuelve { usuario, nombre, rol, sucursal } o null.
async function sesionDeRequest(request, env) {
  if (!env.SESSION_SECRET) return null;
  const token = leerCookie(request, SESION_COOKIE);
  const punto = token.indexOf('.');
  if (punto < 1) return null;
  try {
    const cuerpo = token.slice(0, punto);
    const ok = await crypto.subtle.verify('HMAC', await claveHmac(env), deBase64Url(token.slice(punto + 1)), codificador.encode(cuerpo));
    if (!ok) return null;
    const datos = JSON.parse(new TextDecoder().decode(deBase64Url(cuerpo)));
    if (!datos.exp || datos.exp < Date.now()) return null;
    return { usuario: datos.u, nombre: datos.n, rol: datos.r, sucursal: datos.s, debeCambiarClave: !!datos.c };
  } catch (error) {
    return null;
  }
}

function cookieSesion(valor, segundos) {
  return SESION_COOKIE + '=' + valor + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + segundos;
}

function jsonConEstado(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, extraHeaders || {})
  });
}

async function intentosPrevios(env, clave) {
  if (env.LOGIN_KV) return Number(await env.LOGIN_KV.get(clave)) || 0;
  const r = intentosLocales.get(clave);
  return r && r.vence > Date.now() ? r.n : 0;
}

async function sumarIntento(env, clave, previos) {
  if (env.LOGIN_KV) return env.LOGIN_KV.put(clave, String(previos + 1), { expirationTtl: VENTANA_INTENTOS_SEG });
  intentosLocales.set(clave, { n: previos + 1, vence: Date.now() + VENTANA_INTENTOS_SEG * 1000 });
}

async function limpiarIntentos(env, clave) {
  if (env.LOGIN_KV) return env.LOGIN_KV.delete(clave);
  intentosLocales.delete(clave);
}

async function manejarLogin(request, env) {
  if ((!env.USUARIOS_JSON && !env.DB) || !env.SESSION_SECRET) return jsonConEstado({ ok: false, noConfigurado: true }, 501);
  const { usuarios } = await cargarUsuarios(env);
  if (!usuarios) return jsonConEstado({ ok: false, error: 'USUARIOS_JSON mal formado' }, 500);

  let body;
  try { body = await request.json(); } catch (e) { body = {}; }
  // El usuario no distingue mayusculas ("Jose" entra igual que "jose"); la clave si.
  const usuario = String(body.usuario || '').trim().toLowerCase();
  const clave = String(body.password || '');
  const ip = request.headers.get('CF-Connecting-IP') || 'sin-ip';
  const claveIntentos = 'intentos:' + usuario + ':' + ip;

  const previos = await intentosPrevios(env, claveIntentos);
  if (previos >= MAX_INTENTOS) {
    return jsonConEstado({ ok: false, error: 'Demasiados intentos. Espera 15 minutos y proba de nuevo.' }, 429);
  }

  const encontrado = usuarios.find(u => u.usuario === usuario);
  // Se calcula el hash aunque el usuario no exista, para que tarde parecido.
  const hashDeRelleno = 'pbkdf2$1000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const vigente = encontrado ? await hashVigente(env, usuario, encontrado.hash) : { hash: hashDeRelleno, cambiada: false };
  let correcta = await verificarClave(clave, vigente.hash);
  // Si la base y USUARIOS_JSON difieren, vale la clave de cualquiera de los dos
  // (solo mientras el usuario no haya cambiado la suya).
  if (encontrado && !correcta && !vigente.cambiada && encontrado.hashRespaldo && encontrado.hashRespaldo !== vigente.hash) {
    correcta = await verificarClave(clave, encontrado.hashRespaldo);
  }
  if (!encontrado || !correcta) {
    await sumarIntento(env, claveIntentos, previos);
    // Solo se anota si el usuario existe: asi nadie llena la auditoria con nombres inventados.
    if (encontrado) await auditar(env, request, { usuarioId: encontrado.id, rol: encontrado.rol, accion: 'login.fallido', entidad: 'usuarios', entidadId: encontrado.id });
    return jsonConEstado({ ok: false, error: 'Usuario o contrasena incorrectos' }, 401);
  }

  await limpiarIntentos(env, claveIntentos);
  await marcarIngreso(env, encontrado.id);
  await auditar(env, request, { usuarioId: encontrado.id, rol: encontrado.rol, accion: 'login.ok', entidad: 'usuarios', entidadId: encontrado.id });
  const cambioClaveHabilitado = !!env.LOGIN_KV && env.FORZAR_CAMBIO_CLAVE === '1';
  const debeCambiarClave = cambioClaveHabilitado && !vigente.cambiada;
  const sesion = { usuario: encontrado.usuario, nombre: encontrado.nombre, rol: encontrado.rol, sucursal: encontrado.sucursal, debeCambiarClave, cambioClaveHabilitado };
  const token = await firmarSesion(env, { u: sesion.usuario, n: sesion.nombre, r: sesion.rol, s: sesion.sucursal, c: debeCambiarClave ? 1 : 0, exp: Date.now() + SESION_HORAS * 3600 * 1000 });
  return jsonConEstado({ ok: true, sesion }, 200, { 'Set-Cookie': cookieSesion(token, SESION_HORAS * 3600) });
}

async function manejarMe(request, env) {
  const sesion = await sesionDeRequest(request, env);
  // configurado: el servidor ya tiene usuarios, asi que una sesion del login viejo
  // (sin cookie) ya no sirve y hay que volver a entrar.
  if (!sesion) return jsonConEstado({ ok: false, configurado: !!(env.SESSION_SECRET && (env.USUARIOS_JSON || env.DB)) }, 401);
  sesion.cambioClaveHabilitado = !!env.LOGIN_KV && env.FORZAR_CAMBIO_CLAVE === '1';
  return jsonConEstado({ ok: true, sesion }, 200);
}

// Cambio de clave: pide la actual, guarda el hash nuevo en KV y reemite la cookie
// sin la marca de "debe cambiar".
async function manejarCambiarClave(request, env) {
  const sesion = await sesionDeRequest(request, env);
  if (!sesion) return jsonConEstado({ ok: false, error: 'Sesion vencida', sinSesion: true }, 401);
  if (!env.LOGIN_KV) return jsonConEstado({ ok: false, noConfigurado: true, error: 'El cambio de clave todavia no esta habilitado' }, 501);

  let body;
  try { body = await request.json(); } catch (e) { body = {}; }
  const actual = String(body.actual || '');
  const nueva = String(body.nueva || '');

  const claveIntentos = 'cambio:' + sesion.usuario;
  const previos = await intentosPrevios(env, claveIntentos);
  if (previos >= MAX_INTENTOS) return jsonConEstado({ ok: false, error: 'Demasiados intentos. Espera 15 minutos.' }, 429);

  const { usuarios } = await cargarUsuarios(env);
  if (!usuarios) return jsonConEstado({ ok: false, error: 'USUARIOS_JSON mal formado' }, 500);
  const encontrado = usuarios.find(u => u.usuario === sesion.usuario);
  if (!encontrado) return jsonConEstado({ ok: false, error: 'Usuario inexistente' }, 401);

  const vigente = await hashVigente(env, sesion.usuario, encontrado.hash);
  let actualOk = await verificarClave(actual, vigente.hash);
  if (!actualOk && !vigente.cambiada && encontrado.hashRespaldo && encontrado.hashRespaldo !== vigente.hash) {
    actualOk = await verificarClave(actual, encontrado.hashRespaldo);
  }
  if (!actualOk) {
    await sumarIntento(env, claveIntentos, previos);
    return jsonConEstado({ ok: false, error: 'La clave actual no es correcta' }, 401);
  }
  const motivo = validarClaveNueva(nueva, actual, sesion.usuario);
  if (motivo) return jsonConEstado({ ok: false, error: motivo }, 400);

  await env.LOGIN_KV.put('clave:' + sesion.usuario, await hashearClave(nueva));
  await auditar(env, request, { usuarioId: encontrado.id, rol: encontrado.rol, accion: 'clave.cambiar', entidad: 'usuarios', entidadId: encontrado.id });
  await limpiarIntentos(env, claveIntentos);
  const token = await firmarSesion(env, { u: sesion.usuario, n: sesion.nombre, r: sesion.rol, s: sesion.sucursal, c: 0, exp: Date.now() + SESION_HORAS * 3600 * 1000 });
  return jsonConEstado({ ok: true }, 200, { 'Set-Cookie': cookieSesion(token, SESION_HORAS * 3600) });
}

// Solo admin: borra la clave que cambio un usuario, asi vuelve a la inicial
// (y, con FORZAR_CAMBIO_CLAVE, la tiene que cambiar otra vez).
async function manejarResetearClave(request, env) {
  const sesion = await sesionDeRequest(request, env);
  const prohibido = exigirRol(sesion, ['admin']);
  if (prohibido) return prohibido;
  if (!env.LOGIN_KV) return jsonConEstado({ ok: false, noConfigurado: true }, 501);
  let body;
  try { body = await request.json(); } catch (e) { body = {}; }
  const usuario = String(body.usuario || '').trim().toLowerCase();
  if (!usuario) return jsonConEstado({ ok: false, error: 'Falta el usuario' }, 400);
  await env.LOGIN_KV.delete('clave:' + usuario);
  await limpiarIntentos(env, 'intentos:' + usuario);
  await auditar(env, request, { rol: sesion.rol, accion: 'clave.resetear', entidad: 'usuarios', nota: 'por ' + sesion.usuario + ' a ' + usuario });
  return jsonConEstado({ ok: true }, 200);
}

function manejarLogout() {
  return jsonConEstado({ ok: true }, 200, { 'Set-Cookie': cookieSesion('', 0) });
}

// Rutas con datos: con REQUIRE_AUTH=1 exigen sesion; sin eso solo se anota.
// La sesion es obligatoria salvo que se apague a proposito con REQUIRE_AUTH="0".
const authObligatoria = env => env.REQUIRE_AUTH !== '0';

// Un usuario dado de baja en la base pierde la sesion aunque su cookie siga vigente.
async function usuarioDadoDeBaja(env, sesion) {
  if (!env.DB) return false;
  try {
    const u = await env.DB.prepare('SELECT activo FROM usuarios WHERE usuario = ?').bind(sesion.usuario).first();
    return !!u && !u.activo;
  } catch (e) { return false; }
}

async function exigirSesion(request, env, url) {
  let sesion = await sesionDeRequest(request, env);
  if (sesion && await usuarioDadoDeBaja(env, sesion)) sesion = null;
  if (sesion && sesion.debeCambiarClave) {
    if (authObligatoria(env)) return jsonConEstado({ ok: false, error: 'Tenes que cambiar tu clave antes de seguir', debeCambiarClave: true }, 403);
    console.log('[auth] clave pendiente de cambio: ' + request.method + ' ' + url.pathname);
    return null;
  }
  if (sesion) return null;
  if (authObligatoria(env)) {
    return jsonConEstado({ ok: false, error: 'Sesion vencida o inexistente', sinSesion: true }, 401);
  }
  console.log('[auth] sin sesion: ' + request.method + ' ' + url.pathname);
  return null;
}

// ---------------- Ventas y cobros (base D1) ----------------
// Etapa 2: la venta queda registrada en la base ADEMAS de VentasEquipos (doble
// escritura). Todo se guarda en UNA sola transaccion (env.DB.batch): o queda la
// venta completa o no queda nada. "opId" hace que un reintento (doble clic, mala
// conexion) devuelva la misma venta en vez de crear otra. Si la base no esta, el
// cotizador sigue vendiendo: guarda la venta en el navegador y la reintenta.

const METODOS_PAGO = ['efectivo', 'transferencia', 'usdt', 'debito', 'qr', 'credito', 'canje'];
const CATEGORIAS_ITEM = ['iphone', 'ipad', 'watch', 'mac', 'airpods', 'apple_pencil', 'magic_mouse', 'jbl', 'playstation', 'accesorio', 'servicio', 'otro'];
const MIME_COMPROBANTE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_COMPROBANTE_BYTES = 10 * 1024 * 1024;

// Una sesion valida (y con la clave ya cambiada) o la respuesta de error.
async function sesionObligatoria(request, env) {
  const sesion = await sesionDeRequest(request, env);
  if (!sesion || await usuarioDadoDeBaja(env, sesion)) return { error: jsonConEstado({ ok: false, error: 'Sesion vencida o inexistente', sinSesion: true }, 401) };
  if (sesion.debeCambiarClave) return { error: jsonConEstado({ ok: false, error: 'Tenes que cambiar tu clave antes de seguir', debeCambiarClave: true }, 403) };
  return { sesion };
}

async function usuarioDeBase(env, sesion) {
  return env.DB.prepare('SELECT id, rol FROM usuarios WHERE usuario = ? AND activo = 1').bind(sesion.usuario).first();
}

const aCentavos = n => Math.round(Number(n) * 100);

// Fecha de hoy en Cordoba (UTC-3 todo el año) como YYYY-MM-DD.
function hoyCordoba() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function sumarMeses(ymd, meses) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, ultimoDia));
  return t.toISOString().slice(0, 10);
}

const textoONull = v => (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim();

// Valida el cuerpo de la venta. Devuelve { error } o { datos } ya normalizado
// (dinero en centavos).
function validarVenta(b) {
  const falla = texto => ({ error: texto });
  if (!b || typeof b !== 'object') return falla('Cuerpo invalido');
  const opId = String(b.opId || '');
  if (opId.length < 8 || opId.length > 80) return falla('Falta el identificador de la venta (opId)');

  const c = b.cliente || {};
  const nombre = String(c.nombre || '').replace(/\s+/g, ' ').trim();
  const dni = String(c.dni || '').replace(/[.\s-]/g, '');
  const email = String(c.email || '').trim().toLowerCase();
  if (nombre.length < 3) return falla('Falta el nombre del cliente');
  if (!/^\d{7,8}$/.test(dni)) return falla('El DNI tiene que tener 7 u 8 numeros');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return falla('Email del cliente invalido');
  // Telefono: solo digitos. Es opcional para el servidor (las ventas guardadas en el
  // navegador antes de pedirlo no lo traen), pero si viene tiene que ser un numero real.
  const telefono = String(c.telefono || '').replace(/[\s().+-]/g, '');
  if (telefono && !/^\d{8,15}$/.test(telefono)) return falla('El telefono del cliente no es valido');

  const cotizacion = Number(b.cotizacionUsd);
  if (!(cotizacion > 0)) return falla('Falta la cotizacion del dolar');
  const cotX100 = Math.round(cotizacion * 100);

  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 20) return falla('La venta tiene que tener entre 1 y 20 productos');
  const items = [];
  for (const it of b.items) {
    const tipo = ['equipo', 'accesorio', 'servicio'].indexOf(it.tipo) !== -1 ? it.tipo : null;
    const categoria = CATEGORIAS_ITEM.indexOf(it.categoria) !== -1 ? it.categoria : null;
    const descripcion = textoONull(it.descripcion);
    const precio = Number(it.precio);
    if (!tipo || !categoria || !descripcion || !(precio >= 0)) return falla('Producto invalido: ' + (descripcion || '(sin descripcion)'));
    const meses = it.garantiaMeses === undefined || it.garantiaMeses === null ? null : Number(it.garantiaMeses);
    if (meses !== null && !(Number.isInteger(meses) && meses >= 1 && meses <= 36)) return falla('Meses de garantia invalidos en ' + descripcion);
    const bateria = it.bateriaPct === undefined || it.bateriaPct === null || it.bateriaPct === '' ? null : Math.round(Number(it.bateriaPct));
    if (bateria !== null && !(bateria >= 1 && bateria <= 100)) return falla('Bateria invalida en ' + descripcion);
    const condicion = ['sellado', 'seminuevo'].indexOf(it.condicion) !== -1 ? it.condicion : null;
    items.push({
      tipo, categoria, descripcion, modelo: textoONull(it.modelo), capacidad: textoONull(it.capacidad), condicion,
      color: textoONull(it.color), imeiSerie: textoONull(it.imeiSerie), bateria, precioCent: aCentavos(precio),
      meses, marca: textoONull(it.garantiaMarca), versionTexto: textoONull(it.versionTexto) || 'sin-version'
    });
  }

  const total = Number(b.totalPesos);
  if (!(total >= 0)) return falla('Falta el total de la venta');

  let tradeIn = null;
  if (b.tradeIn) {
    const t = b.tradeIn;
    const valor = Number(t.valor);
    if (!textoONull(t.imeiSerie) || !textoONull(t.modelo) || !(valor >= 0)) return falla('Datos del equipo en canje incompletos');
    const bt = t.bateriaPct === undefined || t.bateriaPct === null || t.bateriaPct === '' ? null : Math.round(Number(t.bateriaPct));
    tradeIn = { imeiSerie: textoONull(t.imeiSerie), modelo: textoONull(t.modelo), capacidad: textoONull(t.capacidad), color: textoONull(t.color), bateria: bt >= 1 && bt <= 100 ? bt : null, valorCent: aCentavos(valor), falla: textoONull(t.falla) };
  }

  const pagosEntrada = Array.isArray(b.pagos) ? b.pagos : [];
  if (pagosEntrada.length > 10) return falla('Demasiadas lineas de pago');
  const pagos = [];
  for (const p of pagosEntrada) {
    const metodo = p.metodo;
    if (METODOS_PAGO.indexOf(metodo) === -1) return falla('Metodo de pago invalido');
    const moneda = metodo === 'usdt' ? 'USDT' : (['efectivo', 'transferencia'].indexOf(metodo) !== -1 ? (p.moneda === 'USD' ? 'USD' : 'ARS') : 'ARS');
    let montoCent = aCentavos(p.monto);
    if (metodo === 'canje') {
      if (!tradeIn) return falla('Un pago por canje necesita los datos del equipo entregado');
      montoCent = tradeIn.valorCent;
    }
    if (!(montoCent > 0)) return falla('El monto de cada pago tiene que ser mayor a cero');
    let cotPagoX100 = null;
    let equivArs;
    let equivUsd;
    if (moneda === 'ARS') {
      equivArs = p.equivArs !== undefined && p.equivArs !== null && p.equivArs !== '' ? aCentavos(p.equivArs) : montoCent;
      if (!(equivArs > 0)) return falla('El monto a imputar de un pago tiene que ser mayor a cero');
      equivUsd = Math.max(1, Math.round(equivArs * 100 / cotX100));
    } else {
      cotPagoX100 = p.cotizacion ? Math.round(Number(p.cotizacion) * 100) : cotX100;
      if (!(cotPagoX100 > 0)) return falla('Cotizacion del pago invalida');
      equivArs = Math.max(1, Math.round(montoCent * cotPagoX100 / 100));
      equivUsd = montoCent; // USD y USDT valen 1 a 1
    }
    let cuotas = null;
    if (metodo === 'credito') {
      cuotas = Number(p.cuotas);
      if (!(Number.isInteger(cuotas) && cuotas >= 1 && cuotas <= 24)) return falla('Falta la cantidad de cuotas del credito');
    }
    const recargo = Math.round(Number(p.recargoPct || 0) * 100);
    if (!(recargo >= -10000 && recargo <= 20000)) return falla('Recargo fuera de rango');
    const cuentaId = p.cuentaId ? Number(p.cuentaId) : null;
    if (['transferencia', 'usdt'].indexOf(metodo) !== -1 && !cuentaId) return falla('Elegi la cuenta a la que entro la ' + (metodo === 'usdt' ? 'transferencia en USDT' : 'transferencia'));
    pagos.push({ metodo, moneda, montoCent, cotPagoX100, equivArs, equivUsd, cuotas, recargo, cuentaId, referencia: textoONull(p.referencia), nota: textoONull(p.nota) });
  }

  return {
    datos: {
      opId, nombre, dni, email,
      telefono: telefono || null,
      domicilio: textoONull(c.domicilio) && textoONull(c.domicilio).slice(0, 200),
      aceptaMails: c.aceptaMails ? 1 : 0,
      sucursal: String(b.sucursal || ''), local: String(b.local || ''), vendedor: String(b.vendedor || '').trim(),
      cotX100, totalCent: aCentavos(total), pauta: b.pauta ? 1 : 0,
      garantiaImpresa: b.garantiaImpresa ? 1 : 0,
      observaciones: textoONull(b.observaciones),
      items, tradeIn, pagos
    }
  };
}

async function manejarCrearVenta(request, env) {
  const { sesion, error } = await sesionObligatoria(request, env);
  if (error) return error;
  if (!env.DB) return jsonConEstado({ ok: false, noConfigurado: true, error: 'La base de datos no esta conectada' }, 503);

  let body;
  try { body = await request.json(); } catch (e) { body = null; }
  const { datos: d, error: invalido } = validarVenta(body);
  if (invalido) return jsonConEstado({ ok: false, error: invalido }, 400);

  try {
    const usuario = await usuarioDeBase(env, sesion);
    if (!usuario) return jsonConEstado({ ok: false, noConfigurado: true, error: 'Tu usuario todavia no esta en la base' }, 503);

    // Reintento: la venta ya estaba guardada.
    const previa = await env.DB.prepare('SELECT id, codigo FROM ventas WHERE opid = ?').bind(d.opId).first();
    if (previa) return jsonConEstado(await respuestaVenta(env, previa.id, previa.codigo, true), 200);

    if (usuario.rol === 'vendedor' && sesion.sucursal && String(sesion.sucursal).toLowerCase() !== String(d.sucursal).toLowerCase()) {
      return jsonConEstado({ ok: false, error: 'Tu usuario es de ' + sesion.sucursal + ': no podés registrar ventas de ' + d.sucursal }, 400);
    }
    const suc = await env.DB.prepare('SELECT id FROM sucursales WHERE nombre = ? COLLATE NOCASE').bind(d.sucursal).first();
    if (!suc) return jsonConEstado({ ok: false, error: 'Sucursal desconocida: ' + d.sucursal }, 400);
    const loc = await env.DB.prepare('SELECT id FROM locales WHERE nombre = ? AND sucursal_id = ?').bind(d.local, suc.id).first();
    if (!loc) return jsonConEstado({ ok: false, error: 'Local desconocido para esa sucursal: ' + d.local }, 400);
    if (d.vendedor.length < 2) return jsonConEstado({ ok: false, error: 'Falta el vendedor' }, 400);

    // Las cuentas elegidas tienen que existir, estar activas y ser del tipo del pago.
    for (const p of d.pagos) {
      if (!p.cuentaId) continue;
      const cuenta = await env.DB.prepare('SELECT tipo, activa FROM cuentas_cobro WHERE id = ?').bind(p.cuentaId).first();
      const tipoEsperado = p.metodo === 'usdt' ? 'usdt' : (p.moneda === 'USD' ? 'transferencia_usd' : 'transferencia_ars');
      if (!cuenta || !cuenta.activa) return jsonConEstado({ ok: false, error: 'La cuenta elegida no existe o esta desactivada' }, 400);
      if (p.metodo !== 'efectivo' && cuenta.tipo !== tipoEsperado) return jsonConEstado({ ok: false, error: 'La cuenta elegida no corresponde al tipo de pago' }, 400);
    }

    const hoy = hoyCordoba();
    const prefijo = 'V-' + hoy.replace(/-/g, '') + '-';
    const ip = request.headers.get('CF-Connecting-IP') || null;
    let ultimoError = null;

    for (let intento = 0; intento < 12; intento++) {
      // Numero siguiente = mayor del dia + 1. Si otras ventas simultaneas se llevan el mismo numero, se reintenta
      // saltando un poco al azar para no volver a chocar con las mismas.
      const cuenta = await env.DB.prepare('SELECT COALESCE(MAX(CAST(SUBSTR(codigo, ?) AS INTEGER)), 0) AS n FROM ventas WHERE codigo LIKE ?').bind(prefijo.length + 1, prefijo + '%').first();
      const salto = intento === 0 ? 0 : intento + Math.floor(Math.random() * intento * 3);
      const codigo = prefijo + String((cuenta ? cuenta.n : 0) + 1 + salto).padStart(4, '0');
      const sentencias = armarSentenciasVenta(env, d, { codigo, sucId: suc.id, locId: loc.id, usuario, hoy, ip });
      try {
        await env.DB.batch(sentencias);
        const creada = await env.DB.prepare('SELECT id FROM ventas WHERE opid = ?').bind(d.opId).first();
        return jsonConEstado(await respuestaVenta(env, creada.id, codigo, false), 200);
      } catch (e) {
        ultimoError = e;
        const msg = String(e && e.message || e);
        if (/ventas\.opid/.test(msg)) {            // otra peticion igual se adelanto
          const otra = await env.DB.prepare('SELECT id, codigo FROM ventas WHERE opid = ?').bind(d.opId).first();
          if (otra) return jsonConEstado(await respuestaVenta(env, otra.id, otra.codigo, true), 200);
        }
        if (!/ventas\.codigo/.test(msg)) break;     // no era un choque de codigo: no se reintenta
      }
    }
    console.log('[ventas] no se pudo guardar: ' + (ultimoError && ultimoError.message));
    return jsonConEstado({ ok: false, error: 'No se pudo guardar la venta en la base' }, 500);
  } catch (e) {
    console.log('[ventas] error: ' + (e && e.message));
    return jsonConEstado({ ok: false, error: 'La base de datos no respondio' }, 503);
  }
}

async function respuestaVenta(env, ventaId, codigo, repetida) {
  const { results } = await env.DB.prepare('SELECT id FROM pagos WHERE venta_id = ? ORDER BY id').bind(ventaId).all();
  const cobro = await env.DB.prepare('SELECT estado_cobro, pagado_centavos, total_centavos FROM v_ventas_cobro WHERE venta_id = ?').bind(ventaId).first();
  return { ok: true, repetida: !!repetida, ventaId, codigo, pagoIds: (results || []).map(r => r.id), estadoCobro: cobro ? cobro.estado_cobro : null, pagadoCentavos: cobro ? cobro.pagado_centavos : 0, totalCentavos: cobro ? cobro.total_centavos : 0 };
}

// Todas las sentencias de la venta, en el orden en que se ejecutan en la transaccion.
function armarSentenciasVenta(env, d, ctx) {
  const db = env.DB;
  const ventaDe = '(SELECT id FROM ventas WHERE opid = ?)';
  const vendedorDe = '(SELECT id FROM vendedores WHERE nombre = ? COLLATE NOCASE)';
  const clienteDe = '(SELECT id FROM clientes WHERE dni = ? ORDER BY id LIMIT 1)';
  const ahoraIso = new Date().toISOString();
  const s = [];

  // Un vendedor que todavia no esta cargado se da de alta (no frena la venta).
  s.push(db.prepare('INSERT OR IGNORE INTO vendedores (nombre, sucursal_id, local_id) VALUES (?, ?, ?)').bind(d.vendedor, ctx.sucId, ctx.locId));

  // Cliente: se reutiliza por DNI; el mail mas reciente es el que vale.
  s.push(db.prepare('INSERT INTO clientes (nombre, dni, email, telefono, domicilio, acepta_mails, acepta_mails_en) SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM clientes WHERE dni = ?)')
    .bind(d.nombre, d.dni, d.email, d.telefono, d.domicilio, d.aceptaMails, d.aceptaMails ? ahoraIso : null, d.dni));
  // El telefono y el mail mas recientes son los que valen; un telefono vacio no pisa el que ya habia.
  s.push(db.prepare('UPDATE clientes SET email = ?, telefono = COALESCE(?, telefono), domicilio = COALESCE(?, domicilio), acepta_mails = MAX(acepta_mails, ?), acepta_mails_en = COALESCE(acepta_mails_en, ?) WHERE dni = ?')
    .bind(d.email, d.telefono, d.domicilio, d.aceptaMails, d.aceptaMails ? ahoraIso : null, d.dni));

  s.push(db.prepare(
    'INSERT INTO ventas (codigo, opid, sucursal_id, local_id, vendedor_id, cargado_por_id, cliente_id, total_centavos, cotizacion_usd_x100, pauta, garantia_impresa_en, observaciones) ' +
    'VALUES (?, ?, ?, ?, ' + vendedorDe + ', ?, ' + clienteDe + ', ?, ?, ?, ?, ?)')
    .bind(ctx.codigo, d.opId, ctx.sucId, ctx.locId, d.vendedor, ctx.usuario.id, d.dni, d.totalCent, d.cotX100, d.pauta, d.garantiaImpresa ? ahoraIso : null, d.observaciones));

  if (d.tradeIn) {
    const t = d.tradeIn;
    s.push(db.prepare(
      'INSERT INTO tradeins (opid, local_id, vendedor_id, cliente_id, imei_serie, modelo, capacidad, color, bateria_pct, valor_centavos, falla, venta_id, registrado_por_id) ' +
      'VALUES (?, ?, ' + vendedorDe + ', ' + clienteDe + ', ?, ?, ?, ?, ?, ?, ?, ' + ventaDe + ', ?)')
      .bind(d.opId + ':canje', ctx.locId, d.vendedor, d.dni, t.imeiSerie, t.modelo, t.capacidad, t.color, t.bateria, t.valorCent, t.falla, d.opId, ctx.usuario.id));
  }

  d.items.forEach(it => {
    s.push(db.prepare(
      'INSERT INTO venta_items (venta_id, tipo, categoria, descripcion, modelo, capacidad, condicion, color, imei_serie, bateria_pct, precio_centavos, garantia_meses, garantia_marca) ' +
      'VALUES (' + ventaDe + ', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(d.opId, it.tipo, it.categoria, it.descripcion, it.modelo, it.capacidad, it.condicion, it.color, it.imeiSerie, it.bateria, it.precioCent, it.meses, it.marca));
    if (it.meses) {
      s.push(db.prepare('INSERT INTO garantias (venta_item_id, desde, hasta, meses, version_texto) VALUES (last_insert_rowid(), ?, ?, ?, ?)')
        .bind(ctx.hoy, sumarMeses(ctx.hoy, it.meses), it.meses, it.versionTexto));
    }
  });

  d.pagos.forEach(p => {
    s.push(db.prepare(
      'INSERT INTO pagos (venta_id, sucursal_id, metodo, moneda, monto_centavos, cotizacion_usd_x100, equiv_ars_centavos, equiv_usd_centavos, cuotas, recargo_pct_x100, cuenta_cobro_id, tradein_id, referencia, nota, registrado_por_id) ' +
      'VALUES (' + ventaDe + ', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ' + (p.metodo === 'canje' ? '(SELECT id FROM tradeins WHERE opid = ?)' : 'NULL') + ', ?, ?, ?)')
      .bind(...[d.opId, ctx.sucId, p.metodo, p.moneda, p.montoCent, p.cotPagoX100, p.equivArs, p.equivUsd, p.cuotas, p.recargo, p.cuentaId]
        .concat(p.metodo === 'canje' ? [d.opId + ':canje'] : [])
        .concat([p.referencia, p.nota, ctx.usuario.id])));
  });

  s.push(db.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, nota, ip) VALUES (?, ?, 'venta.crear', 'ventas', " + ventaDe + ', ?, ?)')
    .bind(ctx.usuario.id, ctx.usuario.rol, d.opId, ctx.codigo + ' · ' + d.items.length + ' item(s) · ' + d.pagos.length + ' pago(s)', ctx.ip));
  return s;
}

// Cuentas a las que puede entrar la plata (solo con sesion iniciada: no van en
// el codigo publico del sitio).
async function manejarCuentasCobro(request, env) {
  const { error } = await sesionObligatoria(request, env);
  if (error) return error;
  if (!env.DB) return jsonConEstado({ ok: false, noConfigurado: true }, 503);
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, etiqueta, tipo, moneda, titular, alias, cbu_cvu, cuit, email_o_wallet, red, franja FROM cuentas_cobro WHERE activa = 1 ORDER BY orden, id'
    ).all();
    return jsonConEstado({ ok: true, cuentas: results || [] }, 200);
  } catch (e) {
    return jsonConEstado({ ok: false, error: 'La base de datos no respondio' }, 503);
  }
}

// El archivo tiene que ser lo que dice ser (no alcanza con el Content-Type).
function coincideFirma(mime, bytes) {
  const b = Array.from(bytes.slice(0, 12));
  if (mime === 'image/jpeg') return b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
  if (mime === 'image/png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
  if (mime === 'image/webp') return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  if (mime === 'application/pdf') return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
  return false;
}

// POST /api/pagos/<id>/comprobante  (cuerpo = el archivo; Content-Type = su tipo)
async function manejarSubirComprobante(request, env, pagoId) {
  const { sesion, error } = await sesionObligatoria(request, env);
  if (error) return error;
  if (!env.DB || !env.COMPROBANTES) return jsonConEstado({ ok: false, noConfigurado: true, error: 'El almacenamiento de comprobantes no esta conectado' }, 503);

  const mime = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!MIME_COMPROBANTE[mime]) return jsonConEstado({ ok: false, error: 'El comprobante tiene que ser una imagen (JPG, PNG, WEBP) o un PDF' }, 415);
  const declarado = Number(request.headers.get('Content-Length') || 0);
  if (declarado > MAX_COMPROBANTE_BYTES) return jsonConEstado({ ok: false, error: 'El comprobante pesa mas de 10 MB' }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return jsonConEstado({ ok: false, error: 'El archivo esta vacio' }, 400);
  if (bytes.length > MAX_COMPROBANTE_BYTES) return jsonConEstado({ ok: false, error: 'El comprobante pesa mas de 10 MB' }, 413);
  if (!coincideFirma(mime, bytes)) return jsonConEstado({ ok: false, error: 'El archivo no es del tipo que dice ser' }, 400);

  try {
    const usuario = await usuarioDeBase(env, sesion);
    if (!usuario) return jsonConEstado({ ok: false, noConfigurado: true, error: 'Tu usuario todavia no esta en la base' }, 503);
    const pago = await env.DB.prepare(
      'SELECT p.id, p.estado, v.cargado_por_id FROM pagos p JOIN ventas v ON v.id = p.venta_id WHERE p.id = ?').bind(pagoId).first();
    if (!pago) return jsonConEstado({ ok: false, error: 'Ese pago no existe' }, 404);
    // Un vendedor solo adjunta a las ventas que cargo el; administracion y oficina, a cualquiera.
    if (pago.cargado_por_id !== usuario.id && ['admin', 'oficina'].indexOf(usuario.rol) === -1) {
      return jsonConEstado({ ok: false, error: 'No tenes permiso para esto' }, 403);
    }
    if (pago.estado === 'anulado') return jsonConEstado({ ok: false, error: 'Ese pago esta anulado' }, 409);

    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(x => x.toString(16).padStart(2, '0')).join('');
    const ahora = new Date();
    const clave = 'comprobantes/' + ahora.getUTCFullYear() + '/' + String(ahora.getUTCMonth() + 1).padStart(2, '0') +
      '/pago-' + pagoId + '-' + hash.slice(0, 12) + '-' + aBase64Url(crypto.getRandomValues(new Uint8Array(6))) + '.' + MIME_COMPROBANTE[mime];
    const nombreOriginal = textoONull(decodeURIComponent(request.headers.get('X-Nombre-Archivo') || '')) ;

    await env.COMPROBANTES.put(clave, bytes, { httpMetadata: { contentType: mime } });
    try {
      await env.DB.prepare('INSERT INTO comprobantes (pago_id, clave_archivo, nombre_original, mime, tamano_bytes, sha256, subido_por_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(pagoId, clave, nombreOriginal && nombreOriginal.slice(0, 200), mime, bytes.length, hash, usuario.id).run();
    } catch (e) {
      await env.COMPROBANTES.delete(clave).catch(() => {});   // no dejar archivos huerfanos
      throw e;
    }

    // El mismo archivo en otro pago: posible comprobante reutilizado -> aviso al admin.
    const otros = await env.DB.prepare('SELECT COUNT(*) AS n FROM comprobantes WHERE sha256 = ? AND pago_id <> ?').bind(hash, pagoId).first();
    const repetido = !!(otros && otros.n > 0);
    if (repetido) {
      await env.DB.prepare("INSERT INTO alertas (tipo, detalle, usuario_id) VALUES ('comprobante_repetido', ?, ?)")
        .bind('El comprobante del pago ' + pagoId + ' ya estaba cargado en otro pago (huella ' + hash.slice(0, 12) + ').', usuario.id).run();
    }
    await auditar(env, request, { usuarioId: usuario.id, rol: usuario.rol, accion: 'comprobante.subir', entidad: 'pagos', entidadId: pagoId, nota: repetido ? 'comprobante repetido' : null });
    return jsonConEstado({ ok: true, repetido }, 200);
  } catch (e) {
    console.log('[comprobante] error: ' + (e && e.message));
    return jsonConEstado({ ok: false, error: 'No se pudo guardar el comprobante' }, 500);
  }
}

// ---------------- Panel de ventas (administracion y oficina) ----------------
// Etapa 3. TODAS las rutas /api/panel/* son solo para admin y oficina, y el rol se
// toma de la BASE (no de la cookie): dar de baja o cambiar de rol a alguien corta el
// acceso al panel de inmediato. Un vendedor recibe 403 aunque tenga sesion.
// Lo que NO se puede: borrar nada. Se verifica, se marca con diferencia o se anula
// (anular = solo admin, con motivo); todo deja una fila en "auditoria".

const SOLO_ADMIN = ['admin'];
const ADMIN_Y_OFICINA = ['admin', 'oficina'];
const ESTADOS_COBRO = ['completo', 'parcial', 'excedido', 'sin_cobro_registrado'];
const ESTADOS_VENTA = ['registrada', 'con_devolucion', 'anulada'];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

async function autorizarPanel(request, env, roles) {
  const { sesion, error } = await sesionObligatoria(request, env);
  if (error) return { error };
  if (!env.DB) return { error: jsonConEstado({ ok: false, noConfigurado: true, error: 'La base de datos no esta conectada' }, 503) };
  const usuario = await usuarioDeBase(env, sesion);
  if (!usuario || roles.indexOf(usuario.rol) === -1) return { error: jsonConEstado({ ok: false, error: 'No tenes permiso para esto' }, 403) };
  return { sesion, usuario };
}

async function cuerpoJson(request) {
  try { const j = await request.json(); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; }
}

// Arma el WHERE de la lista de ventas a partir de los filtros de la pantalla.
function filtrosVentas(params) {
  const w = [];
  const b = [];
  const g = k => (params.get(k) || '').trim();
  if (FECHA_RE.test(g('desde'))) { w.push('substr(fecha_local, 1, 10) >= ?'); b.push(g('desde')); }
  if (FECHA_RE.test(g('hasta'))) { w.push('substr(fecha_local, 1, 10) <= ?'); b.push(g('hasta')); }
  if (g('local')) { w.push('local = ?'); b.push(g('local')); }
  if (g('vendedor')) { w.push('vendedor = ? COLLATE NOCASE'); b.push(g('vendedor')); }
  if (ESTADOS_COBRO.indexOf(g('estadoCobro')) !== -1) { w.push('estado_cobro = ?'); b.push(g('estadoCobro')); }
  if (ESTADOS_VENTA.indexOf(g('estadoVenta')) !== -1) { w.push('estado_venta = ?'); b.push(g('estadoVenta')); }
  if (METODOS_PAGO.indexOf(g('metodo')) !== -1) {
    w.push("EXISTS (SELECT 1 FROM pagos pg WHERE pg.venta_id = v_ventas_panel.venta_id AND pg.estado = 'vigente' AND pg.metodo = ?)");
    b.push(g('metodo'));
  }
  if (g('solo') === 'pendientes') w.push('pagos_sin_verificar > 0');
  if (g('solo') === 'diferencia') w.push('pagos_con_diferencia > 0');
  const q = g('q').replace(/[%_\\]/g, '').slice(0, 60);
  if (q) {
    const like = '%' + q + '%';
    w.push('(codigo LIKE ? OR cliente LIKE ? OR cliente_dni LIKE ? OR EXISTS (SELECT 1 FROM venta_items i WHERE i.venta_id = v_ventas_panel.venta_id AND i.imei_serie LIKE ?))');
    b.push(like, like, like, like);
  }
  return { donde: w.length ? ' WHERE ' + w.join(' AND ') : '', b };
}

async function panelListaVentas(env, url) {
  const { donde, b } = filtrosVentas(url.searchParams);
  const exportar = url.searchParams.get('exportar') === '1';
  const limite = exportar ? 5000 : Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 100, 1), 200);
  const desde = exportar ? 0 : Math.max(parseInt(url.searchParams.get('offset'), 10) || 0, 0);
  const { results } = await env.DB.prepare('SELECT * FROM v_ventas_panel' + donde + ' ORDER BY venta_id DESC LIMIT ? OFFSET ?').bind(...b, limite, desde).all();
  // Los totales no cuentan las ventas anuladas.
  const totales = await env.DB.prepare(
    "SELECT COUNT(*) AS cantidad, COALESCE(SUM(CASE WHEN estado_venta <> 'anulada' THEN total_centavos END), 0) AS total_centavos, " +
    "COALESCE(SUM(CASE WHEN estado_venta <> 'anulada' THEN pagado_centavos END), 0) AS pagado_centavos FROM v_ventas_panel" + donde).bind(...b).first();
  const salida = { ok: true, ventas: results || [], totales };
  if (exportar) {
    const { results: pagos } = await env.DB.prepare(
      'SELECT v.codigo, p.id AS pago_id, p.metodo, p.moneda, p.monto_centavos, p.cotizacion_usd_x100, p.equiv_ars_centavos, p.cuotas, p.recargo_pct_x100, ' +
      'cc.etiqueta AS cuenta, p.referencia, p.verificacion, p.estado, p.creado_en ' +
      'FROM pagos p JOIN ventas v ON v.id = p.venta_id LEFT JOIN cuentas_cobro cc ON cc.id = p.cuenta_cobro_id ' +
      'WHERE p.venta_id IN (SELECT venta_id FROM v_ventas_panel' + donde + ' ORDER BY venta_id DESC LIMIT 5000) ORDER BY p.id').bind(...b).all();
    salida.pagos = pagos || [];
  }
  return salida;
}

async function panelDetalleVenta(env, ventaId, usuario) {
  const venta = await env.DB.prepare('SELECT * FROM v_ventas_panel WHERE venta_id = ?').bind(ventaId).first();
  if (!venta) return null;
  const extra = await env.DB.prepare(
    'SELECT v.cotizacion_usd_x100, v.observaciones, v.motivo_anulacion, v.anulada_en, v.garantia_mail_enviado_en, c.domicilio, c.telefono ' +
    'FROM ventas v JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?').bind(ventaId).first();
  const { results: items } = await env.DB.prepare(
    'SELECT i.id, i.tipo, i.categoria, i.descripcion, i.imei_serie, i.bateria_pct, i.precio_centavos, i.garantia_meses, g.id AS garantia_id, g.desde, g.hasta, g.estado AS garantia_estado ' +
    'FROM venta_items i LEFT JOIN garantias g ON g.venta_item_id = i.id WHERE i.venta_id = ? ORDER BY i.id').bind(ventaId).all();
  const { results: pagos } = await env.DB.prepare(
    'SELECT p.id, p.metodo, p.moneda, p.monto_centavos, p.cotizacion_usd_x100, p.equiv_ars_centavos, p.cuotas, p.recargo_pct_x100, p.referencia, p.nota, ' +
    'p.verificacion, p.verificado_en, p.nota_verificacion, p.estado, p.motivo_anulacion, p.creado_en, ' +
    'cc.etiqueta AS cuenta, cc.alias AS cuenta_alias, uv.nombre AS verificado_por, ur.nombre AS registrado_por ' +
    'FROM pagos p LEFT JOIN cuentas_cobro cc ON cc.id = p.cuenta_cobro_id LEFT JOIN usuarios uv ON uv.id = p.verificado_por_id LEFT JOIN usuarios ur ON ur.id = p.registrado_por_id ' +
    'WHERE p.venta_id = ? ORDER BY p.id').bind(ventaId).all();
  const ids = (pagos || []).map(p => p.id);
  let comprobantes = [];
  if (ids.length) {
    const r = await env.DB.prepare('SELECT id, pago_id, mime, nombre_original, tamano_bytes, subido_en FROM comprobantes WHERE pago_id IN (' + ids.map(() => '?').join(',') + ') ORDER BY id').bind(...ids).all();
    comprobantes = r.results || [];
  }
  const { results: canjes } = await env.DB.prepare('SELECT modelo, capacidad, color, imei_serie, bateria_pct, valor_centavos, falla FROM tradeins WHERE venta_id = ?').bind(ventaId).all();
  let auditoria = null;   // solo la ve el administrador
  if (usuario.rol === 'admin') {
    const r = await env.DB.prepare(
      "SELECT a.fecha_hora, a.accion, a.rol, a.nota, u.usuario FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id " +
      "WHERE (a.entidad = 'ventas' AND a.entidad_id = ?) OR (a.entidad = 'pagos' AND a.entidad_id IN (SELECT id FROM pagos WHERE venta_id = ?)) ORDER BY a.id").bind(ventaId, ventaId).all();
    auditoria = r.results || [];
  }
  const devoluciones = (await env.DB.prepare(
    'SELECT d.id, d.venta_item_id, d.fecha_hora, d.tipo, d.motivo, d.monto_reintegrado_centavos, d.metodo_reintegro, d.reingresa_a_stock, d.reingreso_estado, d.reingreso_detalle, d.deposito, u.nombre AS registrado_por ' +
    'FROM devoluciones d LEFT JOIN usuarios u ON u.id = d.registrado_por_id WHERE d.venta_id = ? ORDER BY d.id').bind(ventaId).all()).results || [];
  return { ok: true, venta: Object.assign({}, venta, extra), items: items || [], pagos: pagos || [], comprobantes, canjes: canjes || [], devoluciones, auditoria, posventa: await panelPosventaDeVenta(env, ventaId) };
}

// Verifica un pago contra el banco/billetera: "verificado" o "con diferencia" (con nota).
async function panelVerificarPago(request, env, pagoId, usuario) {
  const b = await cuerpoJson(request);
  const resultado = b.resultado;
  const nota = textoONull(b.nota);
  if (['verificado', 'con_diferencia'].indexOf(resultado) === -1) return jsonConEstado({ ok: false, error: 'El resultado tiene que ser "verificado" o "con_diferencia"' }, 400);
  if (resultado === 'con_diferencia' && (!nota || nota.length < 3)) return jsonConEstado({ ok: false, error: 'Contanos cual es la diferencia (nota obligatoria)' }, 400);
  const pago = await env.DB.prepare('SELECT p.id, p.estado, p.verificacion, p.monto_centavos, p.moneda, v.codigo FROM pagos p JOIN ventas v ON v.id = p.venta_id WHERE p.id = ?').bind(pagoId).first();
  if (!pago) return jsonConEstado({ ok: false, error: 'Ese pago no existe' }, 404);
  if (pago.estado === 'anulado') return jsonConEstado({ ok: false, error: 'Ese pago esta anulado' }, 409);
  const sentencias = [
    env.DB.prepare("UPDATE pagos SET verificacion = ?, verificado_por_id = ?, verificado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), nota_verificacion = ? WHERE id = ? AND estado = 'vigente'")
      .bind(resultado, usuario.id, nota, pagoId),
    env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, antes_json, despues_json, nota, ip) VALUES (?, ?, 'pago.verificar', 'pagos', ?, ?, ?, ?, ?)")
      .bind(usuario.id, usuario.rol, pagoId, JSON.stringify({ verificacion: pago.verificacion }), JSON.stringify({ verificacion: resultado }), nota, request.headers.get('CF-Connecting-IP') || null)
  ];
  if (resultado === 'con_diferencia') {
    sentencias.push(env.DB.prepare("INSERT INTO alertas (tipo, detalle, usuario_id) VALUES ('pago_con_diferencia', ?, ?)")
      .bind('Venta ' + pago.codigo + ', pago ' + pagoId + ' con diferencia: ' + nota, usuario.id));
  }
  await env.DB.batch(sentencias);
  return jsonConEstado({ ok: true, verificacion: resultado }, 200);
}

// Anula un pago (solo admin, con motivo): no se borra, queda marcado y sale de lo cobrado.
async function panelAnularPago(request, env, pagoId, usuario) {
  const b = await cuerpoJson(request);
  const motivo = textoONull(b.motivo);
  if (!motivo || motivo.length < 3) return jsonConEstado({ ok: false, error: 'Falta el motivo de la anulacion' }, 400);
  const pago = await env.DB.prepare('SELECT id, estado, metodo, monto_centavos FROM pagos WHERE id = ?').bind(pagoId).first();
  if (!pago) return jsonConEstado({ ok: false, error: 'Ese pago no existe' }, 404);
  if (pago.estado === 'anulado') return jsonConEstado({ ok: false, error: 'Ese pago ya esta anulado' }, 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE pagos SET estado = 'anulado', anulado_por_id = ?, anulado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), motivo_anulacion = ? WHERE id = ? AND estado = 'vigente'").bind(usuario.id, motivo, pagoId),
    env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, antes_json, despues_json, nota, ip) VALUES (?, ?, 'pago.anular', 'pagos', ?, ?, ?, ?, ?)")
      .bind(usuario.id, usuario.rol, pagoId, JSON.stringify({ estado: 'vigente', metodo: pago.metodo, monto_centavos: pago.monto_centavos }), JSON.stringify({ estado: 'anulado' }), motivo, request.headers.get('CF-Connecting-IP') || null)
  ]);
  return jsonConEstado({ ok: true }, 200);
}

// Anula una venta entera (solo admin, con motivo): sus pagos y garantias tambien quedan
// anulados. El STOCK no se repone solo (eso es la devolucion con reingreso, Etapa 5).
async function panelAnularVenta(request, env, ventaId, usuario) {
  const b = await cuerpoJson(request);
  const motivo = textoONull(b.motivo);
  if (!motivo || motivo.length < 3) return jsonConEstado({ ok: false, error: 'Falta el motivo de la anulacion' }, 400);
  const venta = await env.DB.prepare('SELECT id, codigo, estado, total_centavos FROM ventas WHERE id = ?').bind(ventaId).first();
  if (!venta) return jsonConEstado({ ok: false, error: 'Esa venta no existe' }, 404);
  if (venta.estado === 'anulada') return jsonConEstado({ ok: false, error: 'Esa venta ya esta anulada' }, 409);
  if (venta.estado === 'con_devolucion') return jsonConEstado({ ok: false, error: 'Esa venta tiene una devolucion registrada: no se anula' }, 409);
  const ahora = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  await env.DB.batch([
    env.DB.prepare("UPDATE pagos SET estado = 'anulado', anulado_por_id = ?, anulado_en = " + ahora + ", motivo_anulacion = ? WHERE venta_id = ? AND estado = 'vigente'").bind(usuario.id, 'Venta anulada: ' + motivo, ventaId),
    env.DB.prepare("UPDATE garantias SET estado = 'anulada' WHERE venta_item_id IN (SELECT id FROM venta_items WHERE venta_id = ?) AND estado <> 'anulada'").bind(ventaId),
    env.DB.prepare("UPDATE ventas SET estado = 'anulada', anulada_por_id = ?, anulada_en = " + ahora + ", motivo_anulacion = ? WHERE id = ? AND estado = 'registrada'").bind(usuario.id, motivo, ventaId),
    env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, antes_json, despues_json, nota, ip) VALUES (?, ?, 'venta.anular', 'ventas', ?, ?, ?, ?, ?)")
      .bind(usuario.id, usuario.rol, ventaId, JSON.stringify({ estado: 'registrada', total_centavos: venta.total_centavos }), JSON.stringify({ estado: 'anulada' }), venta.codigo + ': ' + motivo, request.headers.get('CF-Connecting-IP') || null)
  ]);
  const repuestos = await reponerStockDeVentaAnulada(env, ventaId, venta.codigo, motivo, usuario, textoONull(b.deposito));
  const hechos = repuestos.filter(r => r.ok), fallos = repuestos.filter(r => !r.ok && !r.omitido);
  let aviso = 'La venta quedó anulada.';
  if (hechos.length) aviso += ' ' + (hechos.length === 1 ? 'El equipo volvió al stock' : 'Volvieron al stock ' + hechos.length + ' equipos') + ' (' + hechos.map(r => r.deposito).join(', ') + ').';
  if (fallos.length) aviso += ' NO se pudo reponer al stock: ' + fallos.map(r => r.imei + ' (' + r.error + ')').join('; ') + '. Hay que reingresarlo a mano.';
  if (!hechos.length && !fallos.length) aviso += ' Ningún equipo volvió al stock (no estaba cargado en el stock o no se indicó depósito).';
  return jsonConEstado({ ok: true, aviso, repuestos }, 200);
}

// Al anular una venta, el equipo vuelve al stock. Con STOCK_EN_BASE=1 se sabe de que deposito salio
// (solo se repone si realmente salio del stock: un equipo cargado a mano no existe en el). Con el stock
// en el Sheet no hay forma de saberlo: se repone solo si el panel manda el deposito elegido.
async function reponerStockDeVentaAnulada(env, ventaId, codigo, motivo, usuario, depositoElegido) {
  const { results } = await env.DB.prepare("SELECT id, descripcion, modelo, capacidad, color, imei_serie, bateria_pct FROM venta_items WHERE venta_id = ? AND tipo = 'equipo' AND imei_serie IS NOT NULL AND imei_serie <> '' AND upper(imei_serie) <> 'S/N'").bind(ventaId).all();
  const quien = await env.DB.prepare('SELECT nombre FROM usuarios WHERE id = ?').bind(usuario.id).first();
  const nombre = (quien && quien.nombre) || 'administracion';
  const enBase = env.STOCK_EN_BASE === '1' && !!env.DB;
  const salida = [];
  for (const it of (results || [])) {
    let deposito = null;
    if (enBase) {
      const u = await env.DB.prepare("SELECT d.nombre AS deposito FROM unidades u JOIN depositos d ON d.id = u.deposito_id WHERE u.imei_serie = ? AND u.estado = 'vendido' ORDER BY u.id DESC LIMIT 1").bind(it.imei_serie).first();
      const yaActivo = await env.DB.prepare("SELECT id FROM unidades WHERE imei_serie = ? AND estado IN ('en_stock', 'reservado')").bind(it.imei_serie).first();
      if (!u || yaActivo) { salida.push({ ok: false, omitido: true, imei: it.imei_serie }); continue; }
      deposito = u.deposito;
    } else {
      deposito = depositoElegido ? String(depositoElegido).trim().toUpperCase() : null;
      if (!deposito || DEPOSITOS_STOCK.indexOf(deposito) === -1) { salida.push({ ok: false, omitido: true, imei: it.imei_serie }); continue; }
    }
    const r = await reingresarAStock(env, Object.assign({}, it, { id: 'anul-' + it.id, codigo, motivo, etiqueta: 'VENTA ANULADA' }), deposito, nombre, usuario);
    salida.push({ ok: !!r.ok, imei: it.imei_serie, deposito, error: r.ok ? undefined : r.error });
    await env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, nota) VALUES (?, ?, 'venta.anular.reingreso', 'ventas', ?, ?)")
      .bind(usuario.id, usuario.rol, ventaId, (r.ok ? 'hecho en ' : 'FALLO en ') + deposito + ' · ' + it.imei_serie + (r.ok ? '' : ': ' + r.error)).run();
  }
  return salida;
}

// Sirve el archivo de un comprobante (nunca queda publico: solo admin/oficina con sesion).
async function panelComprobante(env, id) {
  if (!env.COMPROBANTES) return jsonConEstado({ ok: false, noConfigurado: true, error: 'El almacenamiento de comprobantes no esta conectado' }, 503);
  const fila = await env.DB.prepare('SELECT clave_archivo, mime, nombre_original FROM comprobantes WHERE id = ?').bind(id).first();
  if (!fila) return jsonConEstado({ ok: false, error: 'Ese comprobante no existe' }, 404);
  const obj = await env.COMPROBANTES.get(fila.clave_archivo);
  if (!obj) return jsonConEstado({ ok: false, error: 'El archivo no esta en el almacenamiento' }, 404);
  return new Response(obj.body, { status: 200, headers: {
    'Content-Type': fila.mime,
    'Content-Disposition': 'inline; filename="' + encodeURIComponent(fila.nombre_original || ('comprobante-' + id)) + '"',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
  } });
}

// ---------------- Posventa (Etapa 4) ----------------
// Seguimiento de ventas (solo admin y oficina; el vendedor no ve nada de esto),
// bitacora de contactos, reclamos de garantia y encuesta de satisfaccion. La encuesta
// es lo UNICO sin sesion: el cliente entra con un link de un solo uso (token al azar).

const ESTADOS_SEGUIMIENTO = ['pendiente', 'contactado', 'respondio', 'cerrado', 'no_contactar'];
const CANALES_SEGUIMIENTO = ['whatsapp', 'mail', 'llamada'];
const CANALES_EVENTO = ['whatsapp', 'mail', 'llamada', 'presencial'];
const TIPOS_EVENTO = ['contacto', 'recordatorio_resenia', 'encuesta_enviada', 'respuesta', 'nota'];
const ESTADOS_RECLAMO = ['abierto', 'en_revision', 'reparado', 'cambiado', 'rechazado', 'cerrado'];
const VIDA_ENCUESTA_DIAS = 90;
const DIAS_PRIMER_SEGUIMIENTO = 3;

function sumarDias(ymd, dias) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}
const fechaValida = v => v === null || v === undefined || v === '' || (FECHA_RE.test(String(v)) && !isNaN(Date.parse(v)));
const IP_DE = request => request.headers.get('CF-Connecting-IP') || null;

async function panelPosventaDeVenta(env, ventaId) {
  const seg = await env.DB.prepare(
    'SELECT s.id, s.estado, s.canal_preferido, s.proxima_accion_en, s.creado_en, s.actualizado_en, u.nombre AS creado_por FROM seguimientos s LEFT JOIN usuarios u ON u.id = s.creado_por_id WHERE s.venta_id = ?').bind(ventaId).first();
  const eventos = seg ? ((await env.DB.prepare(
    'SELECT e.id, e.fecha_hora, e.tipo, e.canal, e.detalle, u.nombre AS usuario FROM seguimiento_eventos e LEFT JOIN usuarios u ON u.id = e.usuario_id WHERE e.seguimiento_id = ? ORDER BY e.id DESC').bind(seg.id).all()).results || []) : [];
  const encuestas = (await env.DB.prepare(
    'SELECT id, token, creada_en, enviada_en, respondida_en, puntaje, comentario, mejora_sugerida FROM encuestas WHERE venta_id = ? ORDER BY id DESC').bind(ventaId).all()).results || [];
  const reclamos = (await env.DB.prepare(
    'SELECT r.id, r.garantia_id, r.abierto_en, r.descripcion, r.estado, r.tecnico, r.resuelto_en, r.resolucion, i.descripcion AS producto FROM reclamos_garantia r ' +
    'JOIN garantias g ON g.id = r.garantia_id JOIN venta_items i ON i.id = g.venta_item_id WHERE i.venta_id = ? ORDER BY r.id DESC').bind(ventaId).all()).results || [];
  return { seguimiento: seg || null, eventos, encuestas, reclamos };
}

async function posventaCrearSeguimiento(request, env, ventaId, usuario) {
  const b = await cuerpoJson(request);
  const venta = await env.DB.prepare('SELECT id, estado FROM ventas WHERE id = ?').bind(ventaId).first();
  if (!venta) return jsonConEstado({ ok: false, error: 'Esa venta no existe' }, 404);
  if (venta.estado === 'anulada') return jsonConEstado({ ok: false, error: 'Una venta anulada no tiene seguimiento' }, 409);
  const existente = await env.DB.prepare('SELECT id FROM seguimientos WHERE venta_id = ?').bind(ventaId).first();
  if (existente) return jsonConEstado({ ok: true, seguimientoId: existente.id, existente: true }, 200);
  const canal = CANALES_SEGUIMIENTO.indexOf(b.canal) !== -1 ? b.canal : null;
  if (!fechaValida(b.proximaAccion)) return jsonConEstado({ ok: false, error: 'La fecha de la proxima accion no es valida' }, 400);
  const proxima = b.proximaAccion || sumarDias(hoyCordoba(), DIAS_PRIMER_SEGUIMIENTO);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO seguimientos (venta_id, canal_preferido, proxima_accion_en, creado_por_id) VALUES (?, ?, ?, ?)').bind(ventaId, canal, proxima, usuario.id),
    env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, nota, ip) VALUES (?, ?, 'seguimiento.crear', 'ventas', ?, ?, ?)").bind(usuario.id, usuario.rol, ventaId, 'proxima accion ' + proxima, IP_DE(request))
  ]);
  const creado = await env.DB.prepare('SELECT id FROM seguimientos WHERE venta_id = ?').bind(ventaId).first();
  return jsonConEstado({ ok: true, seguimientoId: creado.id, existente: false }, 200);
}

async function posventaActualizarSeguimiento(request, env, segId, usuario) {
  const b = await cuerpoJson(request);
  const seg = await env.DB.prepare('SELECT id, estado, canal_preferido, proxima_accion_en, venta_id FROM seguimientos WHERE id = ?').bind(segId).first();
  if (!seg) return jsonConEstado({ ok: false, error: 'Ese seguimiento no existe' }, 404);
  const sets = [];
  const vals = [];
  const despues = {};
  if (b.estado !== undefined) {
    if (ESTADOS_SEGUIMIENTO.indexOf(b.estado) === -1) return jsonConEstado({ ok: false, error: 'Estado invalido' }, 400);
    sets.push('estado = ?'); vals.push(b.estado); despues.estado = b.estado;
  }
  if (b.proximaAccion !== undefined) {
    if (!fechaValida(b.proximaAccion)) return jsonConEstado({ ok: false, error: 'La fecha de la proxima accion no es valida' }, 400);
    sets.push('proxima_accion_en = ?'); vals.push(b.proximaAccion || null); despues.proxima_accion_en = b.proximaAccion || null;
  }
  if (b.canal !== undefined) {
    if (b.canal && CANALES_SEGUIMIENTO.indexOf(b.canal) === -1) return jsonConEstado({ ok: false, error: 'Canal invalido' }, 400);
    sets.push('canal_preferido = ?'); vals.push(b.canal || null); despues.canal_preferido = b.canal || null;
  }
  if (!sets.length) return jsonConEstado({ ok: false, error: 'No hay nada para cambiar' }, 400);
  await env.DB.batch([
    env.DB.prepare("UPDATE seguimientos SET " + sets.join(', ') + ", actualizado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(...vals, segId),
    env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, antes_json, despues_json, ip) VALUES (?, ?, 'seguimiento.actualizar', 'ventas', ?, ?, ?, ?)")
      .bind(usuario.id, usuario.rol, seg.venta_id, JSON.stringify({ estado: seg.estado, proxima_accion_en: seg.proxima_accion_en, canal_preferido: seg.canal_preferido }), JSON.stringify(despues), IP_DE(request))
  ]);
  return jsonConEstado({ ok: true }, 200);
}

async function posventaAgregarEvento(request, env, segId, usuario) {
  const b = await cuerpoJson(request);
  if (TIPOS_EVENTO.indexOf(b.tipo) === -1) return jsonConEstado({ ok: false, error: 'Tipo de contacto invalido' }, 400);
  if (b.canal && CANALES_EVENTO.indexOf(b.canal) === -1) return jsonConEstado({ ok: false, error: 'Canal invalido' }, 400);
  const detalle = textoONull(b.detalle);
  if (['contacto', 'nota'].indexOf(b.tipo) !== -1 && (!detalle || detalle.length < 2)) return jsonConEstado({ ok: false, error: 'Contá brevemente qué pasó' }, 400);
  if (detalle && detalle.length > 1000) return jsonConEstado({ ok: false, error: 'El detalle es demasiado largo' }, 400);
  const seg = await env.DB.prepare('SELECT id, estado FROM seguimientos WHERE id = ?').bind(segId).first();
  if (!seg) return jsonConEstado({ ok: false, error: 'Ese seguimiento no existe' }, 404);
  const sentencias = [
    env.DB.prepare('INSERT INTO seguimiento_eventos (seguimiento_id, usuario_id, tipo, canal, detalle) VALUES (?, ?, ?, ?, ?)').bind(segId, usuario.id, b.tipo, b.canal || null, detalle)
  ];
  // Un primer contacto pasa el seguimiento de "pendiente" a "contactado".
  if (b.tipo === 'contacto' && seg.estado === 'pendiente') {
    sentencias.push(env.DB.prepare("UPDATE seguimientos SET estado = 'contactado', actualizado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(segId));
  } else {
    sentencias.push(env.DB.prepare("UPDATE seguimientos SET actualizado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(segId));
  }
  await env.DB.batch(sentencias);
  return jsonConEstado({ ok: true }, 200);
}

// Crea (o devuelve la que ya esta pendiente) la encuesta de una venta: un link con token al azar.
async function posventaCrearEncuesta(request, env, ventaId, usuario) {
  const venta = await env.DB.prepare('SELECT id, estado FROM ventas WHERE id = ?').bind(ventaId).first();
  if (!venta) return jsonConEstado({ ok: false, error: 'Esa venta no existe' }, 404);
  if (venta.estado === 'anulada') return jsonConEstado({ ok: false, error: 'Una venta anulada no tiene encuesta' }, 409);
  const vigente = await env.DB.prepare(
    "SELECT token FROM encuestas WHERE venta_id = ? AND respondida_en IS NULL AND creada_en > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) ORDER BY id DESC LIMIT 1").bind(ventaId, '-' + VIDA_ENCUESTA_DIAS + ' days').first();
  const origen = new URL(request.url).origin;
  if (vigente) return jsonConEstado({ ok: true, token: vigente.token, url: origen + '/e/' + vigente.token, repetida: true }, 200);
  const token = aBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const seg = await env.DB.prepare('SELECT id FROM seguimientos WHERE venta_id = ?').bind(ventaId).first();
  const sentencias = [
    env.DB.prepare("INSERT INTO encuestas (venta_id, token, enviada_en) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))").bind(ventaId, token),
    env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, ip) VALUES (?, ?, 'encuesta.crear', 'ventas', ?, ?)").bind(usuario.id, usuario.rol, ventaId, IP_DE(request))
  ];
  if (seg) sentencias.push(env.DB.prepare("INSERT INTO seguimiento_eventos (seguimiento_id, usuario_id, tipo, detalle) VALUES (?, ?, 'encuesta_enviada', 'Se generó el link de la encuesta')").bind(seg.id, usuario.id));
  await env.DB.batch(sentencias);
  return jsonConEstado({ ok: true, token, url: origen + '/e/' + token, repetida: false }, 200);
}

async function posventaAbrirReclamo(request, env, garantiaId, usuario) {
  const b = await cuerpoJson(request);
  const descripcion = textoONull(b.descripcion);
  if (!descripcion || descripcion.length < 3) return jsonConEstado({ ok: false, error: 'Contá qué falla tiene el equipo' }, 400);
  const g = await env.DB.prepare('SELECT g.id, g.estado, i.venta_id FROM garantias g JOIN venta_items i ON i.id = g.venta_item_id WHERE g.id = ?').bind(garantiaId).first();
  if (!g) return jsonConEstado({ ok: false, error: 'Esa garantia no existe' }, 404);
  if (g.estado === 'anulada') return jsonConEstado({ ok: false, error: 'Esa garantia esta anulada' }, 409);
  const abierto = await env.DB.prepare("SELECT id FROM reclamos_garantia WHERE garantia_id = ? AND estado IN ('abierto', 'en_revision')").bind(garantiaId).first();
  if (abierto) return jsonConEstado({ ok: false, error: 'Esa garantia ya tiene un reclamo abierto' }, 409);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO reclamos_garantia (garantia_id, abierto_por_id, descripcion, tecnico) VALUES (?, ?, ?, ?)').bind(garantiaId, usuario.id, descripcion.slice(0, 1000), textoONull(b.tecnico)),
    env.DB.prepare("UPDATE garantias SET estado = 'en_reclamo' WHERE id = ? AND estado = 'vigente'").bind(garantiaId),
    env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, nota, ip) VALUES (?, ?, 'reclamo.abrir', 'garantias', ?, ?, ?)").bind(usuario.id, usuario.rol, garantiaId, descripcion.slice(0, 200), IP_DE(request))
  ]);
  return jsonConEstado({ ok: true }, 200);
}

async function posventaActualizarReclamo(request, env, reclamoId, usuario) {
  const b = await cuerpoJson(request);
  const r = await env.DB.prepare('SELECT id, estado, garantia_id FROM reclamos_garantia WHERE id = ?').bind(reclamoId).first();
  if (!r) return jsonConEstado({ ok: false, error: 'Ese reclamo no existe' }, 404);
  if (['abierto', 'en_revision'].indexOf(r.estado) === -1) return jsonConEstado({ ok: false, error: 'Ese reclamo ya esta resuelto' }, 409);
  if (ESTADOS_RECLAMO.indexOf(b.estado) === -1) return jsonConEstado({ ok: false, error: 'Estado invalido' }, 400);
  const resuelve = ['abierto', 'en_revision'].indexOf(b.estado) === -1;
  const resolucion = textoONull(b.resolucion);
  if (resuelve && (!resolucion || resolucion.length < 3)) return jsonConEstado({ ok: false, error: 'Contá cómo se resolvió' }, 400);
  const sentencias = [
    env.DB.prepare("UPDATE reclamos_garantia SET estado = ?, tecnico = COALESCE(?, tecnico), resolucion = ?, resuelto_en = " + (resuelve ? "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" : 'NULL') + ' WHERE id = ?')
      .bind(b.estado, textoONull(b.tecnico), resuelve ? resolucion.slice(0, 1000) : null, reclamoId),
    env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, antes_json, despues_json, nota, ip) VALUES (?, ?, 'reclamo.actualizar', 'garantias', ?, ?, ?, ?, ?)")
      .bind(usuario.id, usuario.rol, r.garantia_id, JSON.stringify({ estado: r.estado }), JSON.stringify({ estado: b.estado }), resolucion && resolucion.slice(0, 200), IP_DE(request))
  ];
  // Resuelto: la garantia vuelve a "vigente" (o se cierra si se cambio el equipo).
  if (resuelve) sentencias.push(env.DB.prepare("UPDATE garantias SET estado = ? WHERE id = ? AND estado = 'en_reclamo'").bind(b.estado === 'cambiado' ? 'cerrada' : 'vigente', r.garantia_id));
  await env.DB.batch(sentencias);
  return jsonConEstado({ ok: true }, 200);
}

async function posventaListas(env, ruta, url) {
  if (ruta === '/api/panel/seguimientos') {
    const g = k => (url.searchParams.get(k) || '').trim();
    const w = [];
    const b = [];
    if (ESTADOS_SEGUIMIENTO.indexOf(g('estado')) !== -1) { w.push('s.estado = ?'); b.push(g('estado')); } else w.push("s.estado IN ('pendiente', 'contactado', 'respondio')");
    if (g('vencidos') === '1') { w.push('s.proxima_accion_en IS NOT NULL AND s.proxima_accion_en <= ?'); b.push(hoyCordoba()); }
    const { results } = await env.DB.prepare(
      'SELECT s.id, s.venta_id, s.estado, s.canal_preferido, s.proxima_accion_en, s.actualizado_en, v.codigo, c.nombre AS cliente, c.email, c.telefono, l.nombre AS local, ' +
      '(SELECT GROUP_CONCAT(i.descripcion, \' + \') FROM venta_items i WHERE i.venta_id = v.id) AS productos, ' +
      '(SELECT COUNT(*) FROM seguimiento_eventos e WHERE e.seguimiento_id = s.id) AS eventos, ' +
      '(SELECT puntaje FROM encuestas WHERE venta_id = v.id AND respondida_en IS NOT NULL ORDER BY id DESC LIMIT 1) AS puntaje ' +
      'FROM seguimientos s JOIN ventas v ON v.id = s.venta_id JOIN clientes c ON c.id = v.cliente_id JOIN locales l ON l.id = v.local_id WHERE ' + w.join(' AND ') +
      ' ORDER BY (s.proxima_accion_en IS NULL), s.proxima_accion_en ASC, s.id DESC LIMIT 200').bind(...b).all();
    return { ok: true, seguimientos: results || [], hoy: hoyCordoba() };
  }
  if (ruta === '/api/panel/garantias-por-vencer') {
    const { results } = await env.DB.prepare('SELECT * FROM v_garantias_por_vencer ORDER BY hasta, garantia_id LIMIT 200').all();
    return { ok: true, garantias: results || [] };
  }
  if (ruta === '/api/panel/reclamos') {
    const soloAbiertos = url.searchParams.get('todos') !== '1';
    const { results } = await env.DB.prepare(
      'SELECT r.id, r.garantia_id, r.abierto_en, r.descripcion, r.estado, r.tecnico, r.resuelto_en, r.resolucion, i.descripcion AS producto, i.imei_serie, v.id AS venta_id, v.codigo, c.nombre AS cliente, c.telefono, c.email ' +
      'FROM reclamos_garantia r JOIN garantias g ON g.id = r.garantia_id JOIN venta_items i ON i.id = g.venta_item_id JOIN ventas v ON v.id = i.venta_id JOIN clientes c ON c.id = v.cliente_id ' +
      (soloAbiertos ? "WHERE r.estado IN ('abierto', 'en_revision') " : '') + 'ORDER BY r.id DESC LIMIT 200').all();
    return { ok: true, reclamos: results || [] };
  }
  // /api/panel/encuestas
  const { results } = await env.DB.prepare(
    'SELECT e.id, e.respondida_en, e.puntaje, e.comentario, e.mejora_sugerida, v.id AS venta_id, v.codigo, c.nombre AS cliente, l.nombre AS local ' +
    'FROM encuestas e JOIN ventas v ON v.id = e.venta_id JOIN clientes c ON c.id = v.cliente_id JOIN locales l ON l.id = v.local_id WHERE e.respondida_en IS NOT NULL ORDER BY e.id DESC LIMIT 200').all();
  const est = await env.DB.prepare(
    'SELECT COUNT(*) AS respondidas, ROUND(AVG(puntaje), 2) AS promedio, ' +
    "(SELECT COUNT(*) FROM encuestas WHERE respondida_en IS NULL AND creada_en > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-" + VIDA_ENCUESTA_DIAS + " days')) AS sin_responder FROM encuestas WHERE respondida_en IS NOT NULL").first();
  return { ok: true, encuestas: results || [], estadisticas: est };
}

// ---------------- Devoluciones, caja del dia y comisiones (Etapa 5) ----------------

const DEPOSITOS_STOCK = ['OLMOS', 'DINO', 'NUEVO CENTRO', 'INDEPENDENCIA', 'DEPO', 'SERVICIO TECNICO'];
const METODOS_REINTEGRO = ['efectivo', 'transferencia', 'usdt', 'credito_a_favor'];

// Reingresa el equipo devuelto al stock. Hoy el stock vive en el Sheet, asi que se le
// pide al mismo Apps Script de siempre (accion "ingreso"); si falla, la devolucion queda
// registrada igual y se puede repetir el reingreso.
async function reingresarAStock(env, dev, deposito, nombreUsuario, usuario) {
  const cuerpo = JSON.stringify({
    accion: 'ingreso', modelo: dev.modelo || dev.descripcion, capacidad: dev.capacidad || '', color: dev.color || '', imei: dev.imei_serie,
    bateria: dev.bateria_pct ? dev.bateria_pct / 100 : undefined, sucursal: deposito,
    observaciones: (dev.etiqueta || 'DEVOLUCION') + ' ' + dev.codigo + ': ' + String(dev.motivo).slice(0, 120), usuario: nombreUsuario, propietario: nombreUsuario,
    opId: 'devolucion-' + dev.id
  });
  // Con STOCK_EN_BASE=1 el stock vive en la base: el reingreso se hace ahi (mismo codigo que /stock-write),
  // no en el Sheet. Sin el interruptor, se le pide al Apps Script de siempre.
  if (env.STOCK_EN_BASE === '1' && env.DB) {
    try {
      const r = await stockEscribir(new Request('https://interno.local/stock-write', { method: 'POST', body: cuerpo }), env, undefined,
        { id: usuario && usuario.id || null, rol: usuario && usuario.rol || null, conSesion: true });
      const j = await r.json();
      return j.ok ? { ok: true, fila: j.fila } : { ok: false, error: j.error || 'El stock no acepto el reingreso' };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }
  const url = env.APPS_SCRIPT_STOCK_URL;
  if (!url) return { ok: false, error: 'Falta configurar APPS_SCRIPT_STOCK_URL' };
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', body: cuerpo });
    const texto = await resp.text();
    let j; try { j = JSON.parse(texto); } catch (e) { return { ok: false, error: 'Respuesta invalida del Apps Script' }; }
    return j.ok ? { ok: true, fila: j.fila } : { ok: false, error: j.error || 'El stock no acepto el reingreso' };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function panelDatosDevolucion(env, devId) {
  return env.DB.prepare(
    'SELECT d.id, d.motivo, d.reingreso_estado, v.codigo, i.descripcion, i.modelo, i.capacidad, i.color, i.imei_serie, i.bateria_pct ' +
    'FROM devoluciones d JOIN ventas v ON v.id = d.venta_id JOIN venta_items i ON i.id = d.venta_item_id WHERE d.id = ?').bind(devId).first();
}

async function posventaDevolucion(request, env, ventaId, usuario) {
  const b = await cuerpoJson(request);
  const tipo = b.tipo === 'cambio' ? 'cambio' : (b.tipo === 'devolucion' ? 'devolucion' : null);
  const motivo = textoONull(b.motivo);
  if (!tipo) return jsonConEstado({ ok: false, error: 'Elegí si es devolución o cambio' }, 400);
  if (!motivo || motivo.length < 3) return jsonConEstado({ ok: false, error: 'Contá el motivo de la devolución' }, 400);
  const venta = await env.DB.prepare('SELECT id, codigo, estado FROM ventas WHERE id = ?').bind(ventaId).first();
  if (!venta) return jsonConEstado({ ok: false, error: 'Esa venta no existe' }, 404);
  if (venta.estado === 'anulada') return jsonConEstado({ ok: false, error: 'Una venta anulada no admite devoluciones' }, 409);
  const item = await env.DB.prepare('SELECT id, precio_centavos, imei_serie, categoria FROM venta_items WHERE id = ? AND venta_id = ?').bind(Number(b.itemId), ventaId).first();
  if (!item) return jsonConEstado({ ok: false, error: 'Ese producto no es de esta venta' }, 404);
  if (await env.DB.prepare('SELECT id FROM devoluciones WHERE venta_item_id = ?').bind(item.id).first()) return jsonConEstado({ ok: false, error: 'Ese producto ya tiene una devolución registrada' }, 409);

  const montoCent = aCentavos(b.reintegroMonto || 0);
  if (!(montoCent >= 0)) return jsonConEstado({ ok: false, error: 'El monto a reintegrar no es válido' }, 400);
  let metodo = null;
  if (montoCent > 0) {
    metodo = b.reintegroMetodo;
    if (METODOS_REINTEGRO.indexOf(metodo) === -1) return jsonConEstado({ ok: false, error: 'Elegí cómo se le devuelve el dinero' }, 400);
    if (montoCent > item.precio_centavos) return jsonConEstado({ ok: false, error: 'No se puede devolver más de lo que costó el producto' }, 400);
    // Ni mas de lo que realmente se cobro de la venta (descontando lo ya devuelto).
    const cobro = await env.DB.prepare('SELECT pagado_centavos FROM v_ventas_cobro WHERE venta_id = ?').bind(ventaId).first();
    const ya = await env.DB.prepare('SELECT COALESCE(SUM(monto_reintegrado_centavos), 0) AS t FROM devoluciones WHERE venta_id = ?').bind(ventaId).first();
    if (montoCent + ya.t > (cobro ? cobro.pagado_centavos : 0)) return jsonConEstado({ ok: false, error: 'Se está devolviendo más de lo que se cobró en esta venta' }, 400);
  }
  const reingresa = b.reingresaStock ? 1 : 0;
  let deposito = null;
  if (reingresa) {
    if (!item.imei_serie || String(item.imei_serie).toUpperCase() === 'S/N') return jsonConEstado({ ok: false, error: 'Este producto no tiene IMEI/serie: no se puede reingresar al stock' }, 400);
    deposito = String(b.deposito || '').trim().toUpperCase();
    if (DEPOSITOS_STOCK.indexOf(deposito) === -1) return jsonConEstado({ ok: false, error: 'Elegí el depósito donde vuelve el equipo' }, 400);
  }

  await env.DB.batch([
    env.DB.prepare('INSERT INTO devoluciones (venta_id, venta_item_id, tipo, motivo, monto_reintegrado_centavos, metodo_reintegro, reingresa_a_stock, deposito, registrado_por_id, nota) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(ventaId, item.id, tipo, motivo.slice(0, 500), montoCent, metodo, reingresa, deposito, usuario.id, textoONull(b.nota)),
    env.DB.prepare("UPDATE garantias SET estado = 'cerrada' WHERE venta_item_id = ? AND estado IN ('vigente', 'en_reclamo')").bind(item.id),
    env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, despues_json, nota, ip) VALUES (?, ?, 'devolucion.registrar', 'ventas', ?, ?, ?, ?)")
      .bind(usuario.id, usuario.rol, ventaId, JSON.stringify({ tipo, monto_centavos: montoCent, metodo, reingresa_a_stock: reingresa }), venta.codigo + ': ' + motivo.slice(0, 150), IP_DE(request))
  ]);
  const dev = await env.DB.prepare('SELECT id FROM devoluciones WHERE venta_item_id = ?').bind(item.id).first();

  let reingreso = null;
  if (reingresa) reingreso = await posventaReingreso(env, dev.id, deposito, usuario);
  return jsonConEstado({ ok: true, devolucionId: dev.id, reingreso }, 200);
}

async function posventaReingreso(env, devId, deposito, usuario) {
  const dev = await panelDatosDevolucion(env, devId);
  const quien = await env.DB.prepare('SELECT nombre FROM usuarios WHERE id = ?').bind(usuario.id).first();
  const r = await reingresarAStock(env, dev, deposito, (quien && quien.nombre) || 'oficina', usuario);
  await env.DB.batch([
    env.DB.prepare('UPDATE devoluciones SET reingreso_estado = ?, reingreso_detalle = ?, deposito = ? WHERE id = ?').bind(r.ok ? 'hecho' : 'fallo', r.ok ? (r.fila ? 'Fila ' + r.fila : 'ok') : String(r.error).slice(0, 300), deposito, devId),
    env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, nota) VALUES (?, ?, 'devolucion.reingreso', 'devoluciones', ?, ?)").bind(usuario.id, usuario.rol, devId, (r.ok ? 'hecho en ' : 'FALLO en ') + deposito + (r.ok ? '' : ': ' + r.error))
  ]);
  return { estado: r.ok ? 'hecho' : 'fallo', detalle: r.ok ? null : r.error };
}

async function posventaRepetirReingreso(request, env, devId, usuario) {
  const b = await cuerpoJson(request);
  const dev = await env.DB.prepare('SELECT id, reingresa_a_stock, reingreso_estado FROM devoluciones WHERE id = ?').bind(devId).first();
  if (!dev) return jsonConEstado({ ok: false, error: 'Esa devolución no existe' }, 404);
  if (!dev.reingresa_a_stock || dev.reingreso_estado !== 'fallo') return jsonConEstado({ ok: false, error: 'Esta devolución no tiene un reingreso fallido para repetir' }, 409);
  const deposito = String(b.deposito || '').trim().toUpperCase();
  if (DEPOSITOS_STOCK.indexOf(deposito) === -1) return jsonConEstado({ ok: false, error: 'Elegí el depósito donde vuelve el equipo' }, 400);
  return jsonConEstado({ ok: true, reingreso: await posventaReingreso(env, devId, deposito, usuario) }, 200);
}

// ---- Caja del dia ----
const DIA_RE = FECHA_RE;

async function cajaDelDia(env, sucursalId, dia) {
  const { results: metodos } = await env.DB.prepare(
    "SELECT metodo, moneda, COUNT(*) AS cantidad, SUM(monto_centavos) AS total_moneda_centavos, SUM(equiv_ars_centavos) AS total_ars_centavos, " +
    "SUM(CASE WHEN verificacion = 'verificado' THEN equiv_ars_centavos ELSE 0 END) AS verificado_ars_centavos, " +
    "SUM(CASE WHEN verificacion = 'pendiente' THEN 1 ELSE 0 END) AS pendientes, SUM(CASE WHEN verificacion = 'con_diferencia' THEN 1 ELSE 0 END) AS con_diferencia " +
    "FROM pagos WHERE estado = 'vigente' AND sucursal_id = ? AND date(creado_en, '-3 hours') = ? GROUP BY metodo, moneda ORDER BY metodo, moneda").bind(sucursalId, dia).all();
  const cash = (m, mon) => { const f = (metodos || []).find(x => x.metodo === m && x.moneda === mon); return f ? f.total_moneda_centavos : 0; };
  const { results: devs } = await env.DB.prepare(
    "SELECT d.id, d.tipo, d.motivo, d.monto_reintegrado_centavos, d.metodo_reintegro, d.reingreso_estado, v.codigo, i.descripcion FROM devoluciones d JOIN ventas v ON v.id = d.venta_id JOIN venta_items i ON i.id = d.venta_item_id " +
    "WHERE v.sucursal_id = ? AND date(d.fecha_hora, '-3 hours') = ? ORDER BY d.id").bind(sucursalId, dia).all();
  const reintegros = (devs || []).filter(d => d.metodo_reintegro === 'efectivo').reduce((s, d) => s + d.monto_reintegrado_centavos, 0);
  return {
    metodos: metodos || [], devoluciones: devs || [],
    efectivo_ars_cobrado_centavos: cash('efectivo', 'ARS'), efectivo_usd_cobrado_centavos: cash('efectivo', 'USD'), reintegros_efectivo_ars_centavos: reintegros,
    esperado_ars_centavos: cash('efectivo', 'ARS') - reintegros, esperado_usd_centavos: cash('efectivo', 'USD')
  };
}

async function panelCaja(env, url) {
  const dia = (url.searchParams.get('dia') || hoyCordoba()).trim();
  if (!DIA_RE.test(dia)) return { status: 400, cuerpo: { ok: false, error: 'La fecha no es valida' } };
  const suc = await env.DB.prepare('SELECT id, nombre FROM sucursales WHERE nombre = ? COLLATE NOCASE').bind((url.searchParams.get('sucursal') || '').trim()).first();
  if (!suc) return { status: 400, cuerpo: { ok: false, error: 'Elegí una sucursal' } };
  const caja = await cajaDelDia(env, suc.id, dia);
  const cierre = await env.DB.prepare(
    "SELECT c.*, u.nombre AS cerrado_por FROM cierres_caja c LEFT JOIN usuarios u ON u.id = c.cerrado_por_id WHERE c.sucursal_id = ? AND c.dia = ? AND c.estado = 'cerrado'").bind(suc.id, dia).first();
  // Si despues de cerrar se anulo o se cargo algo de ese dia, el sistema ya no espera lo mismo.
  const cambioPosterior = !!cierre && (cierre.efectivo_ars_esperado_centavos !== caja.esperado_ars_centavos || cierre.efectivo_usd_esperado_centavos !== caja.esperado_usd_centavos);
  return { status: 200, cuerpo: { ok: true, dia, sucursal: suc.nombre, hoy: hoyCordoba(), caja, cierre: cierre || null, cambioPosterior } };
}

async function panelCerrarCaja(request, env, usuario) {
  const b = await cuerpoJson(request);
  const dia = String(b.dia || '').trim();
  if (!DIA_RE.test(dia)) return jsonConEstado({ ok: false, error: 'La fecha no es valida' }, 400);
  if (dia > hoyCordoba()) return jsonConEstado({ ok: false, error: 'No se puede cerrar un día que todavía no pasó' }, 400);
  const suc = await env.DB.prepare('SELECT id, nombre FROM sucursales WHERE nombre = ? COLLATE NOCASE').bind(String(b.sucursal || '').trim()).first();
  if (!suc) return jsonConEstado({ ok: false, error: 'Elegí una sucursal' }, 400);
  const contadoArs = aCentavos(b.contadoArs);
  const contadoUsd = aCentavos(b.contadoUsd || 0);
  if (!(contadoArs >= 0) || !(contadoUsd >= 0) || b.contadoArs === undefined || b.contadoArs === '' || b.contadoArs === null) return jsonConEstado({ ok: false, error: 'Cargá cuánto efectivo se contó (en pesos; en dólares si hubo)' }, 400);
  const caja = await cajaDelDia(env, suc.id, dia);
  const difArs = contadoArs - caja.esperado_ars_centavos;
  const difUsd = contadoUsd - caja.esperado_usd_centavos;
  const nota = textoONull(b.nota);
  if ((difArs !== 0 || difUsd !== 0) && (!nota || nota.length < 3)) return jsonConEstado({ ok: false, error: 'No coincide con lo que espera el sistema: contá a qué se debe la diferencia (nota obligatoria)' }, 400);
  if (await env.DB.prepare("SELECT id FROM cierres_caja WHERE sucursal_id = ? AND dia = ? AND estado = 'cerrado'").bind(suc.id, dia).first()) {
    return jsonConEstado({ ok: false, error: 'Ese día ya tiene un cierre. Para rehacerlo hay que anularlo primero (administrador).' }, 409);
  }
  const resumen = JSON.stringify({ metodos: caja.metodos, devoluciones: caja.devoluciones.length, reintegros_efectivo_ars_centavos: caja.reintegros_efectivo_ars_centavos });
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO cierres_caja (sucursal_id, dia, efectivo_ars_esperado_centavos, efectivo_usd_esperado_centavos, efectivo_ars_contado_centavos, efectivo_usd_contado_centavos, diferencia_ars_centavos, diferencia_usd_centavos, resumen_json, nota, cerrado_por_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(suc.id, dia, caja.esperado_ars_centavos, caja.esperado_usd_centavos, contadoArs, contadoUsd, difArs, difUsd, resumen, nota, usuario.id),
      env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, despues_json, nota, ip) VALUES (?, ?, 'caja.cerrar', 'cierres_caja', (SELECT id FROM cierres_caja WHERE sucursal_id = ? AND dia = ? AND estado = 'cerrado'), ?, ?, ?)")
        .bind(usuario.id, usuario.rol, suc.id, dia, JSON.stringify({ esperado_ars: caja.esperado_ars_centavos, contado_ars: contadoArs, dif_ars: difArs, esperado_usd: caja.esperado_usd_centavos, contado_usd: contadoUsd, dif_usd: difUsd }), suc.nombre + ' ' + dia, IP_DE(request))
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) return jsonConEstado({ ok: false, error: 'Ese día ya tiene un cierre.' }, 409);
    throw e;
  }
  return jsonConEstado({ ok: true, diferencia_ars_centavos: difArs, diferencia_usd_centavos: difUsd }, 200);
}

async function panelAnularCierre(request, env, id, usuario) {
  const b = await cuerpoJson(request);
  const motivo = textoONull(b.motivo);
  if (!motivo || motivo.length < 3) return jsonConEstado({ ok: false, error: 'Falta el motivo de la anulación' }, 400);
  const c = await env.DB.prepare('SELECT id, estado, dia, sucursal_id FROM cierres_caja WHERE id = ?').bind(id).first();
  if (!c) return jsonConEstado({ ok: false, error: 'Ese cierre no existe' }, 404);
  if (c.estado === 'anulado') return jsonConEstado({ ok: false, error: 'Ese cierre ya está anulado' }, 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE cierres_caja SET estado = 'anulado', anulado_por_id = ?, anulado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), motivo_anulacion = ? WHERE id = ? AND estado = 'cerrado'").bind(usuario.id, motivo, id),
    env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, nota, ip) VALUES (?, ?, 'caja.anular', 'cierres_caja', ?, ?, ?)").bind(usuario.id, usuario.rol, id, c.dia + ': ' + motivo, IP_DE(request))
  ]);
  return jsonConEstado({ ok: true }, 200);
}

async function panelListaCierres(env) {
  const { results } = await env.DB.prepare(
    "SELECT c.id, c.dia, s.nombre AS sucursal, c.efectivo_ars_esperado_centavos, c.efectivo_ars_contado_centavos, c.diferencia_ars_centavos, c.efectivo_usd_esperado_centavos, c.efectivo_usd_contado_centavos, c.diferencia_usd_centavos, " +
    "c.nota, c.estado, c.cerrado_en, c.motivo_anulacion, u.nombre AS cerrado_por FROM cierres_caja c JOIN sucursales s ON s.id = c.sucursal_id LEFT JOIN usuarios u ON u.id = c.cerrado_por_id ORDER BY c.dia DESC, c.id DESC LIMIT 60").all();
  // Dias que ya pasaron, con cobros, y sin cierre vigente (ultimos 30 dias).
  const { results: pendientes } = await env.DB.prepare(
    "SELECT DISTINCT date(p.creado_en, '-3 hours') AS dia, s.nombre AS sucursal FROM pagos p JOIN sucursales s ON s.id = p.sucursal_id " +
    "WHERE p.estado = 'vigente' AND date(p.creado_en, '-3 hours') < ? AND date(p.creado_en, '-3 hours') >= date(?, '-30 days') " +
    "AND NOT EXISTS (SELECT 1 FROM cierres_caja c WHERE c.sucursal_id = p.sucursal_id AND c.dia = date(p.creado_en, '-3 hours') AND c.estado = 'cerrado') ORDER BY dia DESC, sucursal").bind(hoyCordoba(), hoyCordoba()).all();
  return { ok: true, cierres: results || [], pendientes: pendientes || [] };
}

// Comisiones de equipos calculadas desde las ventas (para comparar con la pantalla actual).
async function panelComisiones(env, url) {
  const mes = (url.searchParams.get('mes') || hoyCordoba().slice(0, 7)).trim();
  if (!/^\d{4}-\d{2}$/.test(mes)) return { status: 400, cuerpo: { ok: false, error: 'El mes no es valido (AAAA-MM)' } };
  const { results } = await env.DB.prepare(
    "SELECT ve.nombre AS vendedor, s.nombre AS sucursal, c.equipos FROM v_comision_equipos c JOIN vendedores ve ON ve.id = c.vendedor_id JOIN sucursales s ON s.id = ve.sucursal_id WHERE c.mes = ? ORDER BY c.equipos DESC, ve.nombre").bind(mes).all();
  const { results: detalle } = await env.DB.prepare(
    "SELECT ve.nombre AS vendedor, v.codigo, substr(datetime(v.fecha_hora, '-3 hours'), 1, 10) AS fecha, i.descripcion, i.imei_serie FROM venta_items i JOIN ventas v ON v.id = i.venta_id JOIN vendedores ve ON ve.id = v.vendedor_id " +
    "WHERE substr(datetime(v.fecha_hora, '-3 hours'), 1, 7) = ? AND v.estado <> 'anulada' AND i.garantia_meses IS NOT NULL AND i.imei_serie IS NOT NULL AND NOT EXISTS (SELECT 1 FROM devoluciones d WHERE d.venta_item_id = i.id) ORDER BY ve.nombre, v.id").bind(mes).all();
  const { results: excluidas } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM venta_items i JOIN ventas v ON v.id = i.venta_id WHERE substr(datetime(v.fecha_hora, '-3 hours'), 1, 7) = ? AND i.garantia_meses IS NOT NULL AND i.imei_serie IS NOT NULL AND (v.estado = 'anulada' OR EXISTS (SELECT 1 FROM devoluciones d WHERE d.venta_item_id = i.id))").bind(mes).all();
  return { status: 200, cuerpo: { ok: true, mes, vendedores: results || [], detalle: detalle || [], excluidos: excluidas && excluidas[0] ? excluidas[0].n : 0 } };
}

// ---- Encuesta publica (sin sesion): el token al azar ES la llave ----
const RESPUESTA_PUBLICA_HEADERS = { 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' };

async function manejarEncuestaPublica(request, env, token) {
  const respuesta = (obj, status) => jsonConEstado(obj, status, RESPUESTA_PUBLICA_HEADERS);
  if (!env.DB) return respuesta({ ok: false, error: 'La encuesta no esta disponible por ahora' }, 503);
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return respuesta({ ok: false, error: 'Este link no es valido' }, 404);
  try {
    const e = await env.DB.prepare(
      "SELECT e.id, e.venta_id, e.respondida_en, (e.creada_en <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)) AS vencida, c.nombre, l.nombre AS local, l.url_resenia, " +
      "(SELECT i.descripcion FROM venta_items i WHERE i.venta_id = e.venta_id ORDER BY i.id LIMIT 1) AS producto " +
      "FROM encuestas e JOIN ventas v ON v.id = e.venta_id JOIN clientes c ON c.id = v.cliente_id JOIN locales l ON l.id = v.local_id WHERE e.token = ?").bind('-' + VIDA_ENCUESTA_DIAS + ' days', token).first();
    if (!e) return respuesta({ ok: false, error: 'Este link no es valido' }, 404);

    if (request.method === 'GET') {
      // Solo lo necesario para saludar: nombre de pila, producto y local. Nada de DNI ni mail.
      return respuesta({ ok: true, respondida: !!e.respondida_en, vencida: !!e.vencida, nombre: String(e.nombre || '').split(' ')[0], producto: e.producto, local: e.local }, 200);
    }

    // POST: una sola vez.
    const texto = await request.text();
    if (texto.length > 6000) return respuesta({ ok: false, error: 'La respuesta es demasiado larga' }, 413);
    let b; try { b = JSON.parse(texto); } catch (err) { b = {}; }
    const puntaje = Number(b.puntaje);
    if (!(Number.isInteger(puntaje) && puntaje >= 1 && puntaje <= 5)) return respuesta({ ok: false, error: 'Elegí un puntaje de 1 a 5' }, 400);
    const comentario = textoONull(b.comentario);
    const mejora = textoONull(b.mejora);
    if ((comentario && comentario.length > 1000) || (mejora && mejora.length > 1000)) return respuesta({ ok: false, error: 'El texto es demasiado largo (máximo 1000 caracteres)' }, 400);
    if (e.respondida_en) return respuesta({ ok: false, error: 'Esta encuesta ya fue respondida. ¡Gracias!', respondida: true }, 409);
    if (e.vencida) return respuesta({ ok: false, error: 'Este link venció', vencida: true }, 410);

    const sentencias = [
      env.DB.prepare("UPDATE encuestas SET respondida_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), puntaje = ?, comentario = ?, mejora_sugerida = ? WHERE id = ? AND respondida_en IS NULL").bind(puntaje, comentario, mejora, e.id),
      // Si la venta tiene seguimiento, pasa a "respondio".
      env.DB.prepare("UPDATE seguimientos SET estado = 'respondio', actualizado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE venta_id = ? AND estado IN ('pendiente', 'contactado')").bind(e.venta_id)
    ];
    // Un puntaje bajo avisa a administracion para que contacten al cliente.
    if (puntaje <= 2) {
      sentencias.push(env.DB.prepare("INSERT INTO alertas (tipo, detalle) VALUES ('encuesta_baja', ?)")
        .bind('El cliente de la venta ' + e.venta_id + ' puntuó ' + puntaje + '/5' + (comentario ? ': ' + comentario.slice(0, 200) : '')));
    }
    const res = await env.DB.batch(sentencias);
    if (!(res[0].meta && res[0].meta.changes === 1)) return respuesta({ ok: false, error: 'Esta encuesta ya fue respondida. ¡Gracias!', respondida: true }, 409);
    return respuesta({ ok: true, resenia: puntaje >= 4 && e.url_resenia ? e.url_resenia : null }, 200);
  } catch (err) {
    console.log('[encuesta] error: ' + (err && err.message));
    return respuesta({ ok: false, error: 'No se pudo guardar tu respuesta. Probá de nuevo en un rato.' }, 503);
  }
}

async function manejarPanel(request, env, url) {
  const ruta = url.pathname;
  const metodo = request.method;
  try {
    let m;
    // --- lectura: admin y oficina ---
    if (metodo === 'GET') {
      const a = await autorizarPanel(request, env, ADMIN_Y_OFICINA);
      if (a.error) return a.error;
      if (ruta === '/api/panel/ventas') return jsonConEstado(await panelListaVentas(env, url), 200);
      if ((m = ruta.match(/^\/api\/panel\/ventas\/(\d+)$/))) {
        const d = await panelDetalleVenta(env, Number(m[1]), a.usuario);
        return d ? jsonConEstado(d, 200) : jsonConEstado({ ok: false, error: 'Esa venta no existe' }, 404);
      }
      if ((m = ruta.match(/^\/api\/panel\/comprobantes\/(\d+)$/))) return panelComprobante(env, Number(m[1]));
      if (ruta === '/api/panel/resumen') {
        const c = await env.DB.prepare(
          "SELECT (SELECT COUNT(*) FROM v_ventas_panel WHERE estado_cobro = 'sin_cobro_registrado' AND estado_venta <> 'anulada') AS sin_cobro, " +
          "(SELECT COUNT(*) FROM pagos WHERE estado = 'vigente' AND verificacion = 'pendiente') AS pendientes, " +
          "(SELECT COUNT(*) FROM pagos WHERE estado = 'vigente' AND verificacion = 'con_diferencia') AS con_diferencia, " +
          "(SELECT COUNT(*) FROM alertas WHERE resuelta = 0) AS alertas, " +
          "(SELECT COUNT(*) FROM seguimientos WHERE estado IN ('pendiente', 'contactado') AND proxima_accion_en IS NOT NULL AND proxima_accion_en <= ?) AS seguimientos_vencidos, " +
          "(SELECT COUNT(*) FROM v_garantias_por_vencer) AS garantias_por_vencer, " +
          "(SELECT COUNT(*) FROM reclamos_garantia WHERE estado IN ('abierto', 'en_revision')) AS reclamos_abiertos, " +
          "(SELECT COUNT(*) FROM (SELECT DISTINCT date(p.creado_en, '-3 hours'), p.sucursal_id FROM pagos p WHERE p.estado = 'vigente' AND date(p.creado_en, '-3 hours') < ? AND date(p.creado_en, '-3 hours') >= date(?, '-30 days') " +
          "AND NOT EXISTS (SELECT 1 FROM cierres_caja c WHERE c.sucursal_id = p.sucursal_id AND c.dia = date(p.creado_en, '-3 hours') AND c.estado = 'cerrado'))) AS cierres_pendientes").bind(hoyCordoba(), hoyCordoba(), hoyCordoba()).first();
        const locales = (await env.DB.prepare('SELECT nombre FROM locales WHERE activo = 1 ORDER BY nombre').all()).results || [];
        const vendedores = (await env.DB.prepare('SELECT nombre FROM vendedores WHERE activo = 1 ORDER BY nombre').all()).results || [];
        return jsonConEstado({ ok: true, contadores: c, locales: locales.map(x => x.nombre), vendedores: vendedores.map(x => x.nombre), rol: a.usuario.rol }, 200);
      }
      if (ruta === '/api/panel/alertas') {
        const soloPendientes = url.searchParams.get('todas') !== '1';
        const { results } = await env.DB.prepare('SELECT id, fecha_hora, tipo, imei_serie, detalle, resuelta, resuelta_en FROM alertas' + (soloPendientes ? ' WHERE resuelta = 0' : '') + ' ORDER BY id DESC LIMIT 200').all();
        return jsonConEstado({ ok: true, alertas: results || [] }, 200);
      }
      if (['/api/panel/seguimientos', '/api/panel/garantias-por-vencer', '/api/panel/reclamos', '/api/panel/encuestas'].indexOf(ruta) !== -1) {
        return jsonConEstado(await posventaListas(env, ruta, url), 200);
      }
      if (ruta === '/api/panel/stock') return jsonConEstado(await stockPanel(env, url), 200);
      if (ruta === '/api/panel/stock/exportar') return stockExportarCsv(env);
      if (ruta === '/api/panel/caja') { const r = await panelCaja(env, url); return jsonConEstado(r.cuerpo, r.status); }
      if (ruta === '/api/panel/caja/cierres') return jsonConEstado(await panelListaCierres(env), 200);
      if (ruta === '/api/panel/comisiones') { const r = await panelComisiones(env, url); return jsonConEstado(r.cuerpo, r.status); }
      if (ruta === '/api/panel/auditoria') {
        if (a.usuario.rol !== 'admin') return jsonConEstado({ ok: false, error: 'No tenes permiso para esto' }, 403);
        const { results } = await env.DB.prepare(
          'SELECT a.id, a.fecha_hora, a.accion, a.entidad, a.entidad_id, a.rol, a.nota, a.ip, u.usuario FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id ORDER BY a.id DESC LIMIT 300').all();
        return jsonConEstado({ ok: true, auditoria: results || [] }, 200);
      }
    }
    // --- escritura ---
    if (metodo === 'POST') {
      if ((m = ruta.match(/^\/api\/panel\/pagos\/(\d+)\/verificar$/))) {
        const a = await autorizarPanel(request, env, ADMIN_Y_OFICINA);
        return a.error || panelVerificarPago(request, env, Number(m[1]), a.usuario);
      }
      if ((m = ruta.match(/^\/api\/panel\/alertas\/(\d+)\/resolver$/))) {
        const a = await autorizarPanel(request, env, ADMIN_Y_OFICINA);
        if (a.error) return a.error;
        await env.DB.batch([
          env.DB.prepare("UPDATE alertas SET resuelta = 1, resuelta_por_id = ?, resuelta_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND resuelta = 0").bind(a.usuario.id, Number(m[1])),
          env.DB.prepare("INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, ip) VALUES (?, ?, 'alerta.resolver', 'alertas', ?, ?)").bind(a.usuario.id, a.usuario.rol, Number(m[1]), request.headers.get('CF-Connecting-IP') || null)
        ]);
        return jsonConEstado({ ok: true }, 200);
      }
      // --- posventa (admin y oficina) ---
      const rutasPosventa = [
        [/^\/api\/panel\/ventas\/(\d+)\/seguimiento$/, posventaCrearSeguimiento],
        [/^\/api\/panel\/seguimientos\/(\d+)$/, posventaActualizarSeguimiento],
        [/^\/api\/panel\/seguimientos\/(\d+)\/eventos$/, posventaAgregarEvento],
        [/^\/api\/panel\/ventas\/(\d+)\/encuesta$/, posventaCrearEncuesta],
        [/^\/api\/panel\/garantias\/(\d+)\/reclamo$/, posventaAbrirReclamo],
        [/^\/api\/panel\/reclamos\/(\d+)$/, posventaActualizarReclamo],
        [/^\/api\/panel\/ventas\/(\d+)\/devolucion$/, posventaDevolucion],
        [/^\/api\/panel\/devoluciones\/(\d+)\/reingresar-stock$/, posventaRepetirReingreso]
      ];
      if (ruta === '/api/panel/stock/conteo') {
        const a = await autorizarPanel(request, env, ADMIN_Y_OFICINA);
        if (a.error) return a.error;
        const r = await stockConteo(env, await cuerpoJson(request), a.usuario, IP_DE(request));
        return jsonConEstado(r.cuerpo, r.status);
      }
      if (ruta === '/api/panel/caja/cierre') {
        const a = await autorizarPanel(request, env, ADMIN_Y_OFICINA);
        return a.error || panelCerrarCaja(request, env, a.usuario);
      }
      if ((m = ruta.match(/^\/api\/panel\/caja\/cierres\/(\d+)\/anular$/))) {
        const a = await autorizarPanel(request, env, SOLO_ADMIN);
        return a.error || panelAnularCierre(request, env, Number(m[1]), a.usuario);
      }
      for (const [re, fn] of rutasPosventa) {
        const mm = ruta.match(re);
        if (!mm) continue;
        const a = await autorizarPanel(request, env, ADMIN_Y_OFICINA);
        return a.error || fn(request, env, Number(mm[1]), a.usuario);
      }
      if ((m = ruta.match(/^\/api\/panel\/pagos\/(\d+)\/anular$/))) {
        const a = await autorizarPanel(request, env, SOLO_ADMIN);
        return a.error || panelAnularPago(request, env, Number(m[1]), a.usuario);
      }
      if ((m = ruta.match(/^\/api\/panel\/ventas\/(\d+)\/anular$/))) {
        const a = await autorizarPanel(request, env, SOLO_ADMIN);
        return a.error || panelAnularVenta(request, env, Number(m[1]), a.usuario);
      }
    }
    return jsonConEstado({ ok: false, error: 'Ruta desconocida' }, 404);
  } catch (e) {
    console.log('[panel] error: ' + (e && e.message));
    return jsonConEstado({ ok: false, error: 'La base de datos no respondio' }, 503);
  }
}

// ---------------- Router ----------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/dolar') return manejarDolar();
    if (url.pathname === '/api/login' && request.method === 'POST') return manejarLogin(request, env);
    if (url.pathname === '/api/me') return manejarMe(request, env);
    if (url.pathname === '/api/logout' && request.method === 'POST') return manejarLogout();
    if (url.pathname === '/api/cambiar-clave' && request.method === 'POST') return manejarCambiarClave(request, env);
    if (url.pathname === '/api/admin/resetear-clave' && request.method === 'POST') return manejarResetearClave(request, env);

    if (url.pathname.startsWith('/api/panel/')) return manejarPanel(request, env, url);

    // Encuesta de satisfaccion: lo unico publico (sin sesion). La pagina es estatica
    // (encuesta.html) y se sirve en /e/<token>; los datos van por /api/encuesta/<token>.
    const rutaEncuesta = url.pathname.match(/^\/api\/encuesta\/([^/]+)$/);
    if (rutaEncuesta && ['GET', 'POST'].indexOf(request.method) !== -1) return manejarEncuestaPublica(request, env, rutaEncuesta[1]);
    if (/^\/e\/[^/]+$/.test(url.pathname) && request.method === 'GET') {
      // "/encuesta" (sin .html): el servicio de archivos redirige /encuesta.html a /encuesta
      // y esa redireccion perderia el token del link.
      const pagina = await env.ASSETS.fetch(new Request(new URL('/encuesta', url), request));
      const r = new Response(pagina.body, pagina);
      r.headers.set('Referrer-Policy', 'no-referrer'); r.headers.set('X-Robots-Tag', 'noindex'); r.headers.set('Cache-Control', 'no-store');
      return r;
    }

    // Ventas y cobros: siempre con sesion (son rutas nuevas, sin modo "solo registrar").
    if (url.pathname === '/api/ventas' && request.method === 'POST') return manejarCrearVenta(request, env);
    if (url.pathname === '/api/cuentas-cobro' && request.method === 'GET') return manejarCuentasCobro(request, env);
    const rutaComprobante = url.pathname.match(/^\/api\/pagos\/(\d+)\/comprobante$/);
    if (rutaComprobante && request.method === 'POST') return manejarSubirComprobante(request, env, Number(rutaComprobante[1]));

    const RUTAS_DATOS = ['/stock', '/stock-imeis', '/stock-write', '/reportes-write'];
    if (RUTAS_DATOS.indexOf(url.pathname) !== -1 || url.pathname.startsWith('/reportes/')) {
      const bloqueo = await exigirSesion(request, env, url);
      if (bloqueo) return bloqueo;
    }

    // STOCK_EN_BASE=1: el stock lo atiende la base (stock-db.js) con las MISMAS acciones y formatos que el
    // Sheet; sin la variable (o en 0) todo sigue yendo al Sheet como siempre. Es el interruptor del cambio.
    const stockEnBase = env.STOCK_EN_BASE === '1' && !!env.DB;
    if (url.pathname === '/stock') return stockEnBase ? stockLeer(env) : manejarStock();
    if (url.pathname === '/stock-imeis') return stockEnBase ? stockImeis(env) : manejarStockImeis();
    if (url.pathname === '/stock-write' && request.method === 'POST') {
      if (!stockEnBase) return manejarStockWrite(request, env);
      let quien = { id: null, rol: null, conSesion: false };
      try { const s = await sesionDeRequest(request, env); if (s) { quien.conSesion = true; const x = await usuarioDeBase(env, s); if (x) quien = Object.assign({ conSesion: true }, x); } } catch (e) { /* sin usuario de la base: queda a nombre del administrador, con el nombre real en la nota */ }
      return stockEscribir(request, env, ctx, quien);
    }
    if (url.pathname.startsWith('/reportes/')) {
      const quien = await sesionDeRequest(request, env);
      const tipoReporte = url.pathname.slice('/reportes/'.length);
      if (quien && quien.rol === 'vendedor' && REPORTES_DE_VENDEDOR.indexOf(tipoReporte) === -1) return jsonConEstado({ encabezados: [], filas: [], error: 'Ese reporte es solo para administracion' }, 403);
      return manejarReportesRead(tipoReporte, quien ? quien.rol : null);
    }
    if (url.pathname === '/reportes-write' && request.method === 'POST') {
      const quien = await sesionDeRequest(request, env);
      return manejarReportesWrite(request, env, quien ? quien.rol : null);
    }

    // Todo lo demas: archivos estaticos (index.html, app.js, data.js, etc.)
    return env.ASSETS.fetch(request);
  }
};
