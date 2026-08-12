// ============================================================
// Funcion serverless (Cloudflare Pages Functions) que hace de intermediaria
// entre la app y el Apps Script "Ingreso/Egreso" pegado en la planilla de
// stock (ver doPost en el .gs que se le paso al usuario). No guarda ningun
// dato aca -- solo reenvia el pedido y devuelve la respuesta. Portado desde
// netlify/functions/stock-write.js (migracion de Netlify a Cloudflare Pages
// por limite de creditos del plan gratis).
//
// Se pasa por un intermediario (en vez de que el navegador le pegue directo
// a la URL de Apps Script) para no dejar esa URL expuesta en el codigo que
// baja al navegador.
//
// URL del Apps Script: variable de entorno APPS_SCRIPT_STOCK_URL,
// configurada en Cloudflare Pages (Settings > Environment variables), NO en
// este archivo -- asi no queda en el repo.
// ============================================================

export async function onRequestPost(context) {
  const url = context.env.APPS_SCRIPT_STOCK_URL;
  if (!url) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Falta configurar APPS_SCRIPT_STOCK_URL en Cloudflare Pages' }),
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const bodyTexto = await context.request.text();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // asi Apps Script lo recibe simple, sin preflight raro
      body: bodyTexto,
      redirect: 'follow' // Apps Script /exec siempre redirige una vez, hay que seguirlo
    });
    const texto = await response.text();
    let json;
    try { json = JSON.parse(texto); } catch (e) { json = { ok: false, error: 'Respuesta invalida del Apps Script: ' + texto.slice(0, 200) }; }

    return new Response(JSON.stringify(json), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: String(error.message || error) }),
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }
}
