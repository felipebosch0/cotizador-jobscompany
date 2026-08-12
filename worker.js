// ============================================================
// Worker principal (Cloudflare Workers con Static Assets). Reemplaza a las
// funciones de netlify/functions/ -- la cuenta de Cloudflare del usuario
// usa el sistema unificado "Workers" (no el Pages clasico con carpeta
// functions/ de ruteo automatico), asi que hay que manejar las rutas a
// mano y despues delegarle a env.ASSETS todo lo que no sea una de las 3
// rutas de API.
//
// Rutas de API: /dolar, /stock, /stock-write (mismo comportamiento y forma
// de respuesta que las funciones de Netlify que reemplazan).
// Todo lo demas (index.html, app.js, data.js, etc.) lo sirve env.ASSETS,
// que es el binding de "archivos estaticos" que Cloudflare arma solo a
// partir de la config "assets" de wrangler.jsonc.
// ============================================================

const LIBRO_STOCK_ID = '1WFl9nKbYYyOuz6ZLLzCNpnhrgd5qWqveP_IXmKG_1HE';
const NOMBRE_HOJA_INVENTARIO = 'Inventario iPhones';
const ESTADOS_STOCK_VISIBLES = ['En Stock', 'Reservado'];
const URL_INFODOLAR = 'https://www.infodolar.com/cotizacion-dolar-provincia-cordoba.aspx';

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
        observaciones: String(fila[8] || '').trim()
      });
    });
    return jsonResponse({ stock: stock, error: null });
  } catch (error) {
    return jsonResponse({ stock: [], error: String(error.message || error) });
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

// ---------------- Router ----------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/dolar') return manejarDolar();
    if (url.pathname === '/stock') return manejarStock();
    if (url.pathname === '/stock-write' && request.method === 'POST') return manejarStockWrite(request, env);

    // Todo lo demas: archivos estaticos (index.html, app.js, data.js, etc.)
    return env.ASSETS.fetch(request);
  }
};
