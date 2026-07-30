// ============================================================
// Funcion serverless (Netlify Functions) que scrapea infodolar.com desde
// el servidor -- el navegador no puede pedirle esto directo por CORS, pero
// un server-to-server fetch no tiene ese problema. Mismo scraping que
// cotizador-appscript/Precios.gs (PrecioDolarOnCache), portado a Node.
//
// Fuente: https://www.infodolar.com/cotizacion-dolar-provincia-cordoba.aspx
// Fila del dolar blue promedio, tabla #BluePromedio: 2da celda = Compra,
// 3ra celda = Venta (el xpath //*[@id="BluePromedio"]/tbody/tr/td[3] que
// paso el usuario es la de Venta).
// ============================================================

const URL_INFODOLAR = 'https://www.infodolar.com/cotizacion-dolar-provincia-cordoba.aspx';

function extraerCeldas(html) {
  // Recorta desde el id="BluePromedio" hasta el cierre de esa tabla, para
  // no levantar data-order de otras cotizaciones (oficial, mayorista, etc)
  // que estan en la misma pagina.
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

exports.handler = async function () {
  try {
    const response = await fetch(URL_INFODOLAR);
    if (!response.ok) throw new Error('infodolar.com respondio ' + response.status);
    const html = await response.text();

    const celdas = extraerCeldas(html);
    // La celda del nombre ("Dolar Blue en Cordoba") NO tiene atributo
    // data-order, asi que solo quedan 2 valores en el array: [0] = Compra,
    // [1] = Venta (confirmado contra el HTML real de infodolar.com).
    const DolarCompra = limpiarNumero(celdas[0]);
    const DolarVenta = limpiarNumero(celdas[1]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ DolarCompra, DolarVenta, actualizado: new Date().toISOString() })
    };
  } catch (error) {
    // Si infodolar.com esta caido o cambio de estructura, devolver 0 en vez
    // de un valor inventado -- se nota enseguida en pantalla que algo esta
    // mal, en vez de cotizar mal (misma decision que Precios.gs).
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ DolarCompra: 0, DolarVenta: 0, actualizado: null, error: String(error.message || error) })
    };
  }
};
