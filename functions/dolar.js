// ============================================================
// Funcion serverless (Cloudflare Pages Functions) que scrapea infodolar.com
// desde el servidor -- el navegador no puede pedirle esto directo por CORS,
// pero un server-to-server fetch no tiene ese problema. Portado 1 a 1 desde
// netlify/functions/dolar.js (migracion de Netlify a Cloudflare Pages por
// limite de creditos del plan gratis de Netlify).
//
// Fuente: https://www.infodolar.com/cotizacion-dolar-provincia-cordoba.aspx
// Fila del dolar blue promedio, tabla #BluePromedio: 2da celda = Compra,
// 3ra celda = Venta (el xpath //*[@id="BluePromedio"]/tbody/tr/td[3] que
// paso el usuario es la de Venta).
// ============================================================

const URL_INFODOLAR = 'https://www.infodolar.com/cotizacion-dolar-provincia-cordoba.aspx';

function extraerCeldas(html) {
  const inicio = html.indexOf('id="BluePromedio"');
  if (inicio === -1) throw new Error('No se encontro la tabla BluePromedio en el HTML de infodolar.com');
  const cierre = html.indexOf('</table>', inicio);
  const bloque = html.slice(inicio, cierre === -1 ? undefined : cierre);

  const regexDataOrder = /data-order="([^"]*)"/g;
  const valores = [];
  let match;
  while ((match = regexDataOrder.exec(bloque)) !== null) {
    valores.push(match[1]);
  }
  return valores;
}

function limpiarNumero(valor) {
  return Number(valor.replace(/\$/g, '').trim().split(',')[0].replace(/\./g, ''));
}

export async function onRequestGet() {
  try {
    const response = await fetch(URL_INFODOLAR);
    if (!response.ok) throw new Error('infodolar.com respondio ' + response.status);
    const html = await response.text();

    const celdas = extraerCeldas(html);
    const DolarCompra = limpiarNumero(celdas[0]);
    const DolarVenta = limpiarNumero(celdas[1]);

    return new Response(
      JSON.stringify({ DolarCompra, DolarVenta, actualizado: new Date().toISOString() }),
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ DolarCompra: 0, DolarVenta: 0, actualizado: null, error: String(error.message || error) }),
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }
}
