// ============================================================
// Funcion serverless (Netlify Functions) que hace de intermediaria entre
// la app y el Apps Script "Ingreso/Egreso" pegado en la planilla de stock
// (ver doPost en el .gs que se le paso al usuario). No guarda ningun dato
// aca -- solo reenvia el pedido y devuelve la respuesta.
//
// Se pasa por un intermediario (en vez de que el navegador le pegue
// directo a la URL de Apps Script) para no dejar esa URL expuesta en el
// codigo que baja al navegador -- asi un vendedor curioso mirando la
// consola no la encuentra facil.
//
// URL del Apps Script: variable de entorno APPS_SCRIPT_STOCK_URL,
// configurada en Netlify (Site settings > Environment variables), NO en
// este archivo -- asi no queda en el repo.
// ============================================================

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Metodo no permitido' }) };
  }

  const url = process.env.APPS_SCRIPT_STOCK_URL;
  if (!url) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ ok: false, error: 'Falta configurar APPS_SCRIPT_STOCK_URL en Netlify' })
    };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // asi Apps Script lo recibe simple, sin preflight raro
      body: event.body,
      redirect: 'follow' // Apps Script /exec siempre redirige una vez, hay que seguirlo
    });
    const texto = await response.text();
    let json;
    try { json = JSON.parse(texto); } catch (e) { json = { ok: false, error: 'Respuesta invalida del Apps Script: ' + texto.slice(0, 200) }; }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(json)
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ ok: false, error: String(error.message || error) })
    };
  }
};
