// Historial de versiones del cotizador: icono "!" de la barra superior.
// Para sumar una version nueva, agregarla ARRIBA de todo en VERSIONES.
const VERSIONES = [
  { v: '2.7', fecha: '28/10/2026', titulo: 'Comisiones al dia', items: [
    'Equipos: al llegar justo a la cantidad del escalon (5, 10, 15...) ya se cobra el valor del escalon siguiente.',
    'Todo lo que se vende con garantia (iPhone, MacBook, iPad, AirPods, Watch, etc.) cuenta como equipo vendido.',
    'Ludmi y Vicky cobran un valor fijo por equipo, sin escala.',
    'Carrito: cuadro "Datos para transferir" con las cuentas segun dia y hora, y boton para copiar el alias para WhatsApp.',
    'Cambio de clave listo para activarse (se avisa cuando corresponda).' ] },
  { v: '2.6', fecha: '27/10/2026', titulo: 'Seguridad y reportes', items: [
    'Login validado en el servidor, con sesion de 12 horas.',
    'Reportes: se leen todas las filas de VentasEquipos y Comisiones.',
    'Se saca el modo Boca.' ] },
  { v: '2.5', fecha: '12/10/2026', titulo: 'Comisiones y precios sellados', items: [
    'Calculadora de comisiones por sucursal: equipos, accesorios y servicio tecnico.',
    'Cortes semanales de accesorios y comparativa contra el mes anterior (solo admin).',
    'Precios sellados de Independencia y tercera lista de precios (Dino).',
    'Accesorios de Independencia actualizados desde Cianbox.',
    'Clip a la carpeta de Drive con protocolos y manuales.',
    'La pagina se recarga sola tras 5 minutos sin uso para traer la ultima version.' ] },
  { v: '2.4', fecha: '05/10/2026', titulo: 'Nuevo diseno y Comparador', items: [
    'Tema visual estilo Apple en todo el cotizador.',
    'Comparador de modelos (iPhone, iPad, Mac, Apple Watch y AirPods) para el mostrador.',
    'Carrito con promociones de cargador (Original, Premium, Ahorro).',
    'Garantia con nombre y DNI del cliente; selector de color en equipos sellados.',
    'WhatsApp del carrito con precio original tachado.' ] },
  { v: '2.3', fecha: '01/09/2026', titulo: 'Financiacion propia', items: [
    'Modulo de Financiacion Propia (Independencia) con papel impreso de plan y pagos.',
    'Transferencia de stock entre depositos y selector de vendedor.',
    'Reservas con vencimiento de 5 dias habiles y alerta visual.',
    'Numero de serie para equipos sin IMEI y validacion de Stock al vender.' ] },
  { v: '2.2', fecha: '18/08/2026', titulo: 'Garantia, Declaracion jurada y Reportes', items: [
    'Garantia de venta para Shopping e Independencia.',
    'Declaracion jurada de Trade In.',
    'Modulo de Reportes de gestion (solo admin).',
    'Precios de Reparacion y Accesorios tomados de Gestioo y Cianbox.' ] },
  { v: '2.1', fecha: '12/08/2026', titulo: 'Stock e Ingreso/Egreso', items: [
    'Pestana Stock con vista completa y refresco automatico.',
    'Ingreso / Egreso de stock (solo admin) conectado a la planilla real.',
    'Carrito como pestana aparte.',
    'Migracion a Cloudflare Workers.' ] },
  { v: '2.0', fecha: '03/08/2026', titulo: 'Venta, Trade In y mensajes', items: [
    'Precios en USD con un toque; WhatsApp firmado con el vendedor.',
    'Trade In con equivalente en dolares.',
    'Financiacion: efectivo separado de debito/QR/transferencia y cuotas con recargo.',
    'Catalogos unificados de MacBook, iPad, AirPods y Apple Watch.' ] },
  { v: '1.0', fecha: '30/07/2026', titulo: 'Primera version', items: [
    'Cotizador web con dolar en vivo y stock en vivo.',
    'Catalogo real de accesorios por sucursal (Shopping e Independencia).',
    'Venta de equipos, Reparacion y Trade In.' ] }
];

(function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function abrir() {
    const lista = document.getElementById('listaNovedades');
    if (!lista.dataset.lista) {
      lista.innerHTML = VERSIONES.map((x, i) =>
        '<div class="nov-version' + (i === 0 ? ' nov-actual' : '') + '">' +
        '<div class="nov-cab"><span class="nov-tag">v' + esc(x.v) + '</span><strong>' + esc(x.titulo) + '</strong>' +
        '<span class="nov-fecha">' + esc(x.fecha) + (i === 0 ? ' · actual' : '') + '</span></div>' +
        '<ul>' + x.items.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></div>').join('');
      lista.dataset.lista = '1';
    }
    document.getElementById('modalNovedades').style.display = 'block';
  }
  function cerrar() { document.getElementById('modalNovedades').style.display = 'none'; }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnNovedades').addEventListener('click', abrir);
    document.getElementById('cerrarModalNovedades').addEventListener('click', cerrar);
    document.getElementById('modalNovedades').addEventListener('click', e => {
      if (e.target.id === 'modalNovedades') cerrar();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });
  });
})();
