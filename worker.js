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

async function manejarReportesRead(tipo) {
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
    const filas = todasLasFilas.slice(1).filter(fila => fila.some(celda => String(celda || '').trim() !== ''));
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

async function manejarReportesWrite(request, env) {
  const url = env.APPS_SCRIPT_REPORTES_URL;
  if (!url) return jsonResponse({ ok: false, error: 'Falta configurar APPS_SCRIPT_REPORTES_URL en Cloudflare' });

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
  if (!env.USUARIOS_JSON || !env.SESSION_SECRET) return jsonConEstado({ ok: false, noConfigurado: true }, 501);
  let usuarios;
  try { usuarios = JSON.parse(env.USUARIOS_JSON); } catch (e) {
    return jsonConEstado({ ok: false, error: 'USUARIOS_JSON mal formado' }, 500);
  }

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
  const correcta = await verificarClave(clave, vigente.hash);
  if (!encontrado || !correcta) {
    await sumarIntento(env, claveIntentos, previos);
    return jsonConEstado({ ok: false, error: 'Usuario o contrasena incorrectos' }, 401);
  }

  await limpiarIntentos(env, claveIntentos);
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
  if (!sesion) return jsonConEstado({ ok: false, configurado: !!(env.SESSION_SECRET && env.USUARIOS_JSON) }, 401);
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

  let usuarios;
  try { usuarios = JSON.parse(env.USUARIOS_JSON); } catch (e) { return jsonConEstado({ ok: false, error: 'USUARIOS_JSON mal formado' }, 500); }
  const encontrado = usuarios.find(u => u.usuario === sesion.usuario);
  if (!encontrado) return jsonConEstado({ ok: false, error: 'Usuario inexistente' }, 401);

  const vigente = await hashVigente(env, sesion.usuario, encontrado.hash);
  if (!(await verificarClave(actual, vigente.hash))) {
    await sumarIntento(env, claveIntentos, previos);
    return jsonConEstado({ ok: false, error: 'La clave actual no es correcta' }, 401);
  }
  const motivo = validarClaveNueva(nueva, actual, sesion.usuario);
  if (motivo) return jsonConEstado({ ok: false, error: motivo }, 400);

  await env.LOGIN_KV.put('clave:' + sesion.usuario, await hashearClave(nueva));
  await limpiarIntentos(env, claveIntentos);
  const token = await firmarSesion(env, { u: sesion.usuario, n: sesion.nombre, r: sesion.rol, s: sesion.sucursal, c: 0, exp: Date.now() + SESION_HORAS * 3600 * 1000 });
  return jsonConEstado({ ok: true }, 200, { 'Set-Cookie': cookieSesion(token, SESION_HORAS * 3600) });
}

// Solo admin: borra la clave que cambio un usuario, asi vuelve a la inicial
// (y, con FORZAR_CAMBIO_CLAVE, la tiene que cambiar otra vez).
async function manejarResetearClave(request, env) {
  const sesion = await sesionDeRequest(request, env);
  if (!sesion || sesion.rol !== 'admin') return jsonConEstado({ ok: false, error: 'Solo el administrador puede hacer esto' }, 403);
  if (!env.LOGIN_KV) return jsonConEstado({ ok: false, noConfigurado: true }, 501);
  let body;
  try { body = await request.json(); } catch (e) { body = {}; }
  const usuario = String(body.usuario || '').trim().toLowerCase();
  if (!usuario) return jsonConEstado({ ok: false, error: 'Falta el usuario' }, 400);
  await env.LOGIN_KV.delete('clave:' + usuario);
  await limpiarIntentos(env, 'intentos:' + usuario);
  return jsonConEstado({ ok: true }, 200);
}

function manejarLogout() {
  return jsonConEstado({ ok: true }, 200, { 'Set-Cookie': cookieSesion('', 0) });
}

// Rutas con datos: con REQUIRE_AUTH=1 exigen sesion; sin eso solo se anota.
async function exigirSesion(request, env, url) {
  const sesion = await sesionDeRequest(request, env);
  if (sesion && sesion.debeCambiarClave) {
    if (env.REQUIRE_AUTH === '1') return jsonConEstado({ ok: false, error: 'Tenes que cambiar tu clave antes de seguir', debeCambiarClave: true }, 403);
    console.log('[auth] clave pendiente de cambio: ' + request.method + ' ' + url.pathname);
    return null;
  }
  if (sesion) return null;
  if (env.REQUIRE_AUTH === '1') {
    return jsonConEstado({ ok: false, error: 'Sesion vencida o inexistente', sinSesion: true }, 401);
  }
  console.log('[auth] sin sesion: ' + request.method + ' ' + url.pathname);
  return null;
}

// ---------------- Router ----------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/dolar') return manejarDolar();
    if (url.pathname === '/api/login' && request.method === 'POST') return manejarLogin(request, env);
    if (url.pathname === '/api/me') return manejarMe(request, env);
    if (url.pathname === '/api/logout' && request.method === 'POST') return manejarLogout();
    if (url.pathname === '/api/cambiar-clave' && request.method === 'POST') return manejarCambiarClave(request, env);
    if (url.pathname === '/api/admin/resetear-clave' && request.method === 'POST') return manejarResetearClave(request, env);

    const RUTAS_DATOS = ['/stock', '/stock-imeis', '/stock-write', '/reportes-write'];
    if (RUTAS_DATOS.indexOf(url.pathname) !== -1 || url.pathname.startsWith('/reportes/')) {
      const bloqueo = await exigirSesion(request, env, url);
      if (bloqueo) return bloqueo;
    }

    if (url.pathname === '/stock') return manejarStock();
    if (url.pathname === '/stock-imeis') return manejarStockImeis();
    if (url.pathname === '/stock-write' && request.method === 'POST') return manejarStockWrite(request, env);
    if (url.pathname.startsWith('/reportes/')) return manejarReportesRead(url.pathname.slice('/reportes/'.length));
    if (url.pathname === '/reportes-write' && request.method === 'POST') return manejarReportesWrite(request, env);

    // Todo lo demas: archivos estaticos (index.html, app.js, data.js, etc.)
    return env.ASSETS.fetch(request);
  }
};
