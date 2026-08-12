// ============================================================
// Cotizador - logica de calculo (harness local).
// Version simplificada respecto al proyecto original: usa el objeto
// window.COTIZADOR_DATA (data.js) en vez de leer una Google Sheet.
// Cuando esto se porte a Apps Script, esta logica es la que se copia casi
// tal cual, solo cambia de donde sale el objeto DATA.
// ============================================================

Notiflix.Loading.Init({ className: 'notiflix-loading', backgroundColor: 'rgba(0,0,0,0.8)', fontFamily: 'Poppins' });
Notiflix.Notify.Init({ position: 'center-top', fontFamily: 'Poppins' });
Notiflix.Report.Init({ fontFamily: 'Poppins' });

// ============================ TEMA (claro/oscuro) ============================
// Reutiliza las clases .light/.dark que ya vienen en Estilos.html (copia de
// css-inicio.html del proyecto original), solo faltaba el boton para
// cambiarlas y guardar la preferencia.
(function inicializarTema() {
  const guardado = localStorage.getItem('tema') || 'light';
  document.body.classList.remove('light', 'dark');
  document.body.classList.add(guardado);
  actualizarIconoTema(guardado);
})();

// ============================ LOGIN: mostrar/ocultar contrasena ============================
(function () {
  const boton = document.getElementById('loginTogglePassword');
  const input = document.getElementById('loginInputPassword');
  const icono = document.getElementById('loginIconoOjo');
  if (!boton || !input || !icono) return;

  const OJO_ABIERTO = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/>';
  const OJO_CERRADO = '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.4 20.4 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a20.3 20.3 0 0 1-3.22 4.36M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';

  boton.addEventListener('click', function () {
    const mostrar = input.type === 'password';
    input.type = mostrar ? 'text' : 'password';
    icono.innerHTML = mostrar ? OJO_CERRADO : OJO_ABIERTO;
  });
})();

function actualizarIconoTema(tema) {
  const icono = document.getElementById('toggleTema');
  if (!icono) return;
  icono.classList.toggle('fa-moon', tema === 'light');
  icono.classList.toggle('fa-sun', tema === 'dark');
}

function toggleTema() {
  const esOscuro = document.body.classList.contains('dark');
  const nuevo = esOscuro ? 'light' : 'dark';
  document.body.classList.remove('light', 'dark');
  document.body.classList.add(nuevo);
  localStorage.setItem('tema', nuevo);
  actualizarIconoTema(nuevo);
}

function MostrarAlerta(data) {
  Notiflix.Loading.Remove();
  switch (data.tipo) {
    case 'error': Notiflix.Report.Failure(data.title, data.mnsj, 'OK'); break;
    case 'warning': Notiflix.Report.Warning(data.title, data.mnsj, 'OK'); break;
    case 'success': Notiflix.Notify.Success(data.title + ': ' + data.mnsj); break;
    default: break;
  }
}

function formatNumberArg(n) {
  n = Number(String(n).replace(/,/g, '.'));
  return n.toLocaleString('es-ar', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 });
}

function formatNumberUsd(n) {
  n = Number(String(n).replace(/,/g, '.'));
  return n.toLocaleString('en-us', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
}

// ============================ ESTADO ============================
const DATA = window.COTIZADOR_DATA;
const principalDiv = document.getElementById('cotizador');
let sucursalActual = DATA.sucursales[0];
let equipos = []; // tabla de equipos de la sucursal actual
let infoFinanciacion = '';

function equiposDeLaSucursal(sucursal) {
  return DATA.equiposPorSucursal[sucursal] || [];
}

function buscarEquipo(modelo) {
  return equipos.find(e => e.modelo === modelo);
}

// AirPods/Apple Watch/iPad/MacBook: solo aparecen en Venta de equipos
// (Modelo), no en Compra (trade-in) ni en Reparacion, que siguen siendo
// solo celulares. AirPods/Watch/MacBook tienen el mismo precio en las 2
// sucursales; el iPad tiene su propia tabla por sucursal (precio distinto
// en Shopping vs Independencia, a pedido del usuario) asi que se recalcula
// cada vez en vez de fijarse una sola vez al cargar la pagina.
function otrosEquiposVenta() {
  const ipad = (DATA.iPadPorSucursal || {})[sucursalActual] || [];
  return (DATA.otrosEquiposUniversales || []).concat(ipad);
}

function equiposParaVenta() {
  return equipos.concat(otrosEquiposVenta());
}

function buscarEquipoVenta(modelo) {
  return equiposParaVenta().find(e => e.modelo === modelo);
}

const NOMBRE_CONDICION = { seminuevo: 'Seminuevo', sellado: 'Sellado' };

// "seminuevoTiers" (Independencia) es un array de { etiqueta, precio } --
// varios precios de Semi Nuevo segun el estado de bateria del equipo, en vez
// de un unico numero como en Shopping ("seminuevo"). Si una capacidad tiene
// tiers, cuenta como que esa capacidad tiene Semi Nuevo disponible.
function tieneSeminuevo(c) {
  return c.seminuevo != null || !!(c.seminuevoTiers && c.seminuevoTiers.length);
}

// Tiers de bateria disponibles para un modelo+capacidad (solo tiene sentido
// con condicion Semi Nuevo). Vacio si ese modelo usa el esquema simple de
// Shopping (un solo precio de "seminuevo", sin tiers).
function tiersDisponibles(equipo, capacidad) {
  if (!equipo || !capacidad || !equipo.capacidades[capacidad]) return [];
  return equipo.capacidades[capacidad].seminuevoTiers || [];
}

// ============================ STOCK (por unidad) ============================
// EN VIVO: se lee de netlify/functions/stock.js, que a su vez lee el
// Google Sheet de inventario (hoja "Inventario iPhones") via export CSV
// publico -- no hace falta credenciales, solo que la hoja este compartida
// como "Cualquiera con el enlace > Lector". window.STOCK_IPHONES (de
// stock-data.js) queda como fallback si la funcion todavia no respondio o
// fallo (ej. hoja no publica, sheet caida). El modulo se actualiza cada vez
// que se elige un modelo en Venta > Equipo, y la lista se refresca sola
// cada 7 min (antes 2 min, se espacio para gastar menos invocaciones de la
// funcion de Netlify).
//
// El excel tiene inconsistencias de tipeo en el modelo ("Iphone 13",
// "17 pro" en minuscula, espacios de mas), asi que el match se hace
// normalizando (sin espacios de mas, todo en minuscula) en vez de
// comparar el texto tal cual.
function normalizarModelo(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

let avisoStockMostrado = false;

// Pide el stock en vivo a la funcion de Netlify y pisa window.STOCK_IPHONES.
// Si falla (hoja no publica, sin red, etc.) deja el fallback estatico de
// stock-data.js como esta y avisa UNA sola vez.
async function actualizarStockEnVivo() {
  try {
    const response = await fetch('/stock');
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    window.STOCK_IPHONES = data.stock;
  } catch (error) {
    if (!avisoStockMostrado) {
      avisoStockMostrado = true;
      console.warn('No se pudo leer el stock en vivo (uso el fallback estatico de stock-data.js):', error);
      MostrarAlerta({ tipo: 'warning', title: 'Stock', mnsj: 'No se pudo leer el stock en vivo, usando el ultimo dato disponible.' });
    }
  }
}

// Devuelve a que sucursal de venta (Shopping/Independencia) pertenece un
// deposito de Stock.xlsx (OLMOS, DINO, etc.), segun DATA.depositoPorSucursal.
// Si el deposito no esta mapeado a ninguna sucursal (ej. DEPO, SERVICIO
// TECNICO) devuelve null.
function grupoDeSucursal(deposito) {
  const entrada = Object.entries(DATA.depositoPorSucursal || {})
    .find(([, depositos]) => depositos.includes(deposito));
  return entrada ? entrada[0] : null;
}

function actualizarModuloStock(modelo) {
  const modulo = document.getElementById('moduloStock');
  const tabla = document.getElementById('tablaStock');
  const body = document.getElementById('bodyStock');
  const vacio = document.getElementById('stockVacio');

  if (!modelo) { modulo.classList.add('oculto'); return; }
  modulo.classList.remove('oculto');

  const buscado = normalizarModelo(modelo);
  let stock = (window.STOCK_IPHONES || []).filter(u => normalizarModelo(u.modelo) === buscado);

  body.innerHTML = '';
  if (!stock.length) {
    tabla.classList.add('oculto');
    vacio.classList.remove('oculto');
    return;
  }

  // Las unidades que estan en la sucursal actual del vendedor aparecen
  // primero (son las que puede entregar sin pedir traslado).
  stock = stock.slice().sort((a, b) => {
    const aPropia = grupoDeSucursal(a.sucursal) === sucursalActual ? 0 : 1;
    const bPropia = grupoDeSucursal(b.sucursal) === sucursalActual ? 0 : 1;
    return aPropia - bPropia;
  });

  vacio.classList.add('oculto');
  tabla.classList.remove('oculto');
  const fragm = document.createDocumentFragment();
  stock.forEach(u => {
    const tr = document.createElement('tr');
    const capacidad = u.capacidad >= 1024 ? '1Tb' : u.capacidad + 'Gb';
    const grupo = grupoDeSucursal(u.sucursal);
    const sucursalTexto = grupo ? u.sucursal : 'Depo';
    if (grupo === sucursalActual) tr.style.fontWeight = 'bold';
    tr.innerHTML = `<td>${capacidad}</td><td>${u.bateria}%</td><td>${u.color}</td><td>${sucursalTexto}</td><td>${u.estado}</td><td>${u.observaciones}</td>`;
    fragm.appendChild(tr);
  });
  body.appendChild(fragm);
}

// ============================ STOCK: pestana completa ============================
// A diferencia de actualizarModuloStock (que se filtra solo al modelo que se
// esta cotizando en Venta > Equipo), esta pantalla es un modulo aparte para
// ver TODO el stock de una, con un filtro de modelo opcional.

function poblarSelectStockModelo() {
  const select = $('#selectStockModelo');
  const actual = select.val();
  select.children('option:not(:first)').remove();
  const vistos = {};
  (window.STOCK_IPHONES || []).forEach(u => { vistos[normalizarModelo(u.modelo)] = u.modelo; });
  Object.values(vistos)
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }))
    .forEach(modelo => select.append(new Option(modelo, modelo)));
  select.val(actual && vistos[normalizarModelo(actual)] ? actual : '');
}

function actualizarVistaStockCompleto() {
  const tabla = document.getElementById('tablaStockCompleto');
  const body = document.getElementById('bodyStockCompleto');
  const vacio = document.getElementById('stockCompletoVacio');
  const modeloFiltro = document.getElementById('selectStockModelo').value;

  let stock = window.STOCK_IPHONES || [];
  if (modeloFiltro) {
    const buscado = normalizarModelo(modeloFiltro);
    stock = stock.filter(u => normalizarModelo(u.modelo) === buscado);
  }

  body.innerHTML = '';
  if (!stock.length) {
    tabla.classList.add('oculto');
    vacio.classList.remove('oculto');
    return;
  }

  // Mismo criterio que el modulo de Venta: lo de la sucursal actual primero.
  stock = stock.slice().sort((a, b) => {
    const aPropia = grupoDeSucursal(a.sucursal) === sucursalActual ? 0 : 1;
    const bPropia = grupoDeSucursal(b.sucursal) === sucursalActual ? 0 : 1;
    if (aPropia !== bPropia) return aPropia - bPropia;
    return a.modelo.localeCompare(b.modelo);
  });

  vacio.classList.add('oculto');
  tabla.classList.remove('oculto');
  const fragm = document.createDocumentFragment();
  stock.forEach(u => {
    const tr = document.createElement('tr');
    const capacidad = u.capacidad >= 1024 ? '1Tb' : u.capacidad + 'Gb';
    const grupo = grupoDeSucursal(u.sucursal);
    const sucursalTexto = grupo ? u.sucursal : 'Depo';
    if (grupo === sucursalActual) tr.style.fontWeight = 'bold';
    tr.innerHTML = `<td>${u.modelo}</td><td>${capacidad}</td><td>${u.bateria}%</td><td>${u.color}</td><td>${sucursalTexto}</td><td>${u.estado}</td><td>${u.observaciones}</td>`;
    fragm.appendChild(tr);
  });
  body.appendChild(fragm);
}

// ============================ DOLAR: auto-actualizar cada 7 min ============================
// Fuente real: https://www.infodolar.com/cotizacion-dolar-provincia-cordoba.aspx
// (el scraping en si corre server-side en netlify/functions/dolar.js -- el
// navegador NO puede pedirle esto directo a infodolar.com por CORS, pero un
// server-to-server fetch no tiene ese problema. Misma logica que
// cotizador-appscript/Precios.gs, portada a una funcion de Netlify).
let avisoDolarMostrado = false;

async function actualizarDolar() {
  try {
    const response = await fetch('/dolar');
    const nuevo = await response.json();
    if (!nuevo.DolarVenta) throw new Error(nuevo.error || 'Respuesta invalida de la funcion de dolar');

    const cambio = nuevo.DolarVenta !== DATA.dolar.DolarVenta || nuevo.DolarCompra !== DATA.dolar.DolarCompra;
    DATA.dolar = nuevo;
    if (cambio) {
      MostrarAlerta({ tipo: 'info', title: 'Dolar', mnsj: 'Se actualizo: compra $' + nuevo.DolarCompra + ' / venta $' + nuevo.DolarVenta });
      if ($('#formVenta').hasClass('vista')) PreciosVentaE();
    }
  } catch (error) {
    if (!avisoDolarMostrado) {
      avisoDolarMostrado = true;
      console.warn('No se pudo actualizar el dolar (funcion de Netlify no disponible):', error);
      MostrarAlerta({ tipo: 'warning', title: 'Dolar', mnsj: 'No se pudo actualizar en vivo. Sigo usando $' + DATA.dolar.DolarVenta });
    }
  }
}

// ============================ CARRITO ============================
// Suma items de distintos tipos (equipo, accesorio) en una sola cotizacion
// con un total conjunto. No se resetea al cambiar de pestaña (Venta/Compra/
// Reparacion/Precios) ni al cambiar de sucursal, solo con "Vaciar carrito".

let carrito = [];

function agregarAlCarrito(item) {
  carrito.push(item);
  renderCarrito();
  MostrarAlerta({ tipo: 'success', title: 'Carrito', mnsj: 'Se agrego: ' + item.descripcion });
}

function quitarDelCarrito(index) {
  carrito.splice(index, 1);
  renderCarrito();
}

function totalCarrito() {
  return carrito.reduce((suma, item) => suma + item.precio, 0);
}

function renderCarrito() {
  const tabla = document.getElementById('tablaCarrito');
  const body = document.getElementById('bodyCarrito');
  const vacio = document.getElementById('carritoVacio');
  const totalWrap = document.getElementById('totalCarritoWrap');
  const btnExport = document.getElementById('btnExportCarrito');
  const badge = document.getElementById('badgeCarrito');

  badge.textContent = carrito.length;
  badge.classList.toggle('oculto', carrito.length === 0);

  body.innerHTML = '';
  if (!carrito.length) {
    tabla.classList.add('oculto');
    totalWrap.classList.add('oculto');
    btnExport.classList.add('oculto');
    vacio.classList.remove('oculto');
    $('#tablaFinancia').removeClass('vista').addClass('oculto');
    return;
  }

  vacio.classList.add('oculto');
  tabla.classList.remove('oculto');
  totalWrap.classList.remove('oculto');
  btnExport.classList.remove('oculto');

  const fragm = document.createDocumentFragment();
  carrito.forEach((item, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${item.tipo}</td><td>${item.descripcion}</td><td>${formatNumberArg(item.precio)}</td><td><i class="fas fa-times" data-quitar-carrito="${i}" style="cursor:pointer;"></i></td>`;
    fragm.appendChild(tr);
  });
  body.appendChild(fragm);
  document.getElementById('totalCarrito').value = formatNumberArg(totalCarrito());
  TablaFinancia(totalCarrito(), 'equipo');
}

function AgregarCarritoEquipo() {
  const modelo = $('#formVenta select[name="modeloV"]').val();
  const capacidad = $('#formVenta select[name="capacidadV"]').val();
  const condicion = $('#formVenta select[name="tipoEquipo"]').val();
  const bateria = $('#formVenta select[name="estadoBateria"]').val();
  const totalTexto = $('#formVenta input[name="totalVentaEquipo"]').val();
  const total = Number(String(totalTexto).replace(/[^0-9,-]/g, '').replace(',', '.'));
  // "Entrega efectivo" (USD y ARS, 2 campos separados) ya viene restada en
  // "total" (ver PreciosVentaE). Para que se vea en el carrito como sus
  // propios renglones en vez de desaparecer adentro del precio del equipo,
  // se agrega el equipo a precio completo (sin descontar) y despues un
  // renglon aparte por cada moneda cargada, discriminados.
  const adelantoArs = Number($('#formVenta input[name="EntregaAdelanto"]').val()) || 0;
  const adelantoUsd = Number($('#formVenta input[name="EntregaAdelantoUsd"]').val()) || 0;
  const adelantoUsdEnArs = adelantoUsd * DATA.dolar.DolarVenta;
  const adelanto = adelantoArs + adelantoUsdEnArs;

  const equipo = buscarEquipoVenta(modelo);
  const requiereBateria = condicion === 'seminuevo' && tiersDisponibles(equipo, capacidad).length > 0;

  if (!(modelo && capacidad && condicion) || (requiereBateria && !bateria) || !total) {
    return MostrarAlerta({ tipo: 'error', title: 'Carrito', mnsj: 'Completa el equipo antes de agregarlo al carrito' });
  }

  const condicionTexto = NOMBRE_CONDICION[condicion] || condicion;

  // Independencia: como el precio se puede editar a mano, se aclara al
  // lado cuanto es eso en USD (el "precio pagando en efectivo" ya neteado,
  // como si se pagara en efectivo con dolares) -- a pedido del usuario.
  const sufijoUsd = sucursalActual === 'Independencia'
    ? ` (USD ${Math.round(total / DATA.dolar.DolarVenta)})`
    : '';

  agregarAlCarrito({
    tipo: 'Equipo',
    descripcion: `${modelo} ${capacidad} (${condicionTexto})${sufijoUsd}`,
    precio: total + adelanto
  });

  if (adelantoUsd > 0) {
    agregarAlCarrito({
      tipo: 'Equipo',
      descripcion: `Entrega en efectivo (USD ${adelantoUsd})`,
      precio: -adelantoUsdEnArs
    });
  }
  if (adelantoArs > 0) {
    agregarAlCarrito({
      tipo: 'Equipo',
      descripcion: 'Entrega en efectivo (ARS)',
      precio: -adelantoArs
    });
  }
}

function AgregarCarritoAccesorio() {
  const categoria = $('#formVenta select[name="categoria"]').val();
  const descripcion = $('#formVenta select[name="descripcion"]').val();
  const modelo = $('#formVenta select[name="modeloA"]').val();
  const totalTexto = $('#formVenta input[name="totalAccesorio"]').val();
  const total = Number(String(totalTexto).replace(/[^0-9,-]/g, '').replace(',', '.'));

  if (!(categoria && descripcion && modelo) || !total) {
    return MostrarAlerta({ tipo: 'error', title: 'Carrito', mnsj: 'Completa el accesorio antes de agregarlo al carrito' });
  }

  agregarAlCarrito({
    tipo: 'Accesorio',
    descripcion: `${categoria} ${descripcion} - ${modelo}`,
    precio: total
  });
}

function VaciarCarrito() {
  if (!carrito.length) return;
  Notiflix.Confirm.Show('Vaciar carrito', 'Seguro que queres borrar todo el carrito?', 'Si', 'No', function () {
    carrito = [];
    renderCarrito();
  }, function () {});
}

function ExportarCarrito() {
  if (!carrito.length) return MostrarAlerta({ tipo: 'error', title: 'Carrito', mnsj: 'El carrito esta vacio' });
  const hh = new Date().getHours();
  let saludo = 'Buenos dias';
  if (hh > 14) saludo = 'Buenas tardes';
  if (hh > 19) saludo = 'Buenas noches';

  // La financiacion se calcula sobre el total sumado del carrito (ver
  // TablaFinancia) y se incluye aca con las distintas cotizaciones/planes,
  // a pedido del usuario.
  const lineas = carrito.map(item => `- ${item.descripcion}: ${formatNumberArg(item.precio)}`).join('\n');

  // Si hay un Trade In en el carrito, se agrega un parrafo personalizado
  // aclarando en cuanto se toma el equipo -- a pedido del usuario. Antes
  // decia "con un descuento de $X por el estado relevado (...)", lo cual
  // ademas quedaba roto ("(...)") cuando no se marco ninguna falla (equipo
  // en perfecto estado). Ahora dice en cuanto se toma el equipo, y solo
  // menciona las fallas marcadas si hay alguna.
  const tradeIn = carrito.find(item => item.tipo === 'Trade In');
  const parrafoTradeIn = tradeIn
    ? `\n\nTomamos tu *${tradeIn.modelo}* como parte de pago, en *${formatNumberArg(-tradeIn.precio)}* (USD ${Math.round(-tradeIn.precio / DATA.dolar.DolarVenta)})` +
      (tradeIn.detalleFallas.length ? `, segun el estado relevado: ${tradeIn.detalleFallas.join(', ')}.` : '.')
    : '';

  const parrafoFinanciacion = infoFinanciacion ? `\n*Financiacion*\n${infoFinanciacion}` : '';

  const mensaje = `${saludo}\n*Cotizacion*\n\n${lineas}\n\n*Total*: ${formatNumberArg(totalCarrito())}${parrafoTradeIn}\n${parrafoFinanciacion}${firmaWhatsapp()}`;

  const el = document.createElement('textarea');
  el.value = mensaje;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  MostrarAlerta({ tipo: 'success', title: 'Export', mnsj: 'Se copio la cotizacion del carrito' });
}

// ============================ TABS / RESET ============================

function ResetFormCotizador() {
  principalDiv.querySelector('#formVenta').reset();
  principalDiv.querySelector('#formTradeIn').reset();
  principalDiv.querySelector('#formReparacion').reset();
  principalDiv.querySelectorAll('.vista').forEach(el => { el.classList.remove('vista'); el.classList.add('oculto'); });
  document.getElementById('promo-cotizacion').classList.add('oculto');
  document.getElementById('moduloStock').classList.add('oculto');
}

function TradeIn() { ResetFormCotizador(); $('#formTradeIn').removeClass('oculto').addClass('vista'); }
function Venta() {
  ResetFormCotizador();
  $('#formVenta select[name="tipoVenta"]').val('venta accesorio').change();
  $('#formVenta').removeClass('oculto').addClass('vista');
  $('#dolarVentaE').text('');
}
function Reparacion() { ResetFormCotizador(); $('#formReparacion').removeClass('oculto').addClass('vista'); }
function Precios() { ResetFormCotizador(); $('#tablaPreciosSolos').removeClass('oculto').addClass('vista'); CargarSoloPrecios(); }
function Stock() { ResetFormCotizador(); $('#vistaStock').removeClass('oculto').addClass('vista'); poblarSelectStockModelo(); actualizarVistaStockCompleto(); }
function IngresoEgreso() { ResetFormCotizador(); $('#vistaIngresoEgreso').removeClass('oculto').addClass('vista'); }

// ============================ INGRESO / EGRESO DE STOCK (solo admin) ============================
// Escribe/actualiza la planilla real via una funcion de Netlify que le pega
// al Apps Script "puerta de entrada" pegado en la planilla (ver doPost en
// el .gs que se le paso al usuario). El Netlify function solo reenvia el
// pedido, no guarda nada -- la planilla sigue siendo la unica fuente de
// verdad.
async function llamarStockWrite(payload) {
  const response = await fetch('/stock-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

async function ConfirmarIngreso() {
  const modelo = $('#ingresoModelo').val().trim();
  const capacidad = $('#ingresoCapacidad').val().trim();
  const bateriaTexto = $('#ingresoBateria').val().trim();
  const color = $('#ingresoColor').val().trim();
  const imei = $('#ingresoImei').val().trim();
  const sucursal = $('#ingresoDeposito').val();
  const observaciones = $('#ingresoObservaciones').val();

  if (!modelo || !capacidad || !imei || !sucursal) {
    return MostrarAlerta({ tipo: 'error', title: 'Ingreso', mnsj: 'Completa al menos Modelo, Capacidad, IMEI y Deposito' });
  }

  // Bateria: se acepta "0.87" (fraccion) o "87" (ya en %) -- se guarda como
  // fraccion, igual que el resto de la planilla, para que el lector de
  // stock (bateriaAPorcentaje en netlify/functions/stock.js) lo interprete
  // igual que las filas cargadas a mano.
  let bateria = Number(bateriaTexto.replace(',', '.')) || 0;
  if (bateria > 1) bateria = bateria / 100;

  const boton = document.getElementById('btnConfirmarIngreso');
  boton.disabled = true;
  try {
    const resp = await llamarStockWrite({ accion: 'ingreso', modelo, capacidad, bateria, color, imei, sucursal, observaciones });
    if (!resp.ok) throw new Error(resp.error || 'Error desconocido');
    MostrarAlerta({ tipo: 'success', title: 'Ingreso', mnsj: `${modelo} ${capacidad}Gb agregado al stock` });
    $('#ingresoModelo, #ingresoCapacidad, #ingresoBateria, #ingresoColor, #ingresoImei').val('');
    $('#ingresoDeposito').val('');
    await actualizarStockEnVivo();
  } catch (error) {
    MostrarAlerta({ tipo: 'error', title: 'Ingreso', mnsj: 'No se pudo agregar: ' + error.message });
  } finally {
    boton.disabled = false;
  }
}

async function BuscarImei() {
  const ultimos = $('#egresoUltimosDigitos').val().trim();
  const contenedor = document.getElementById('egresoResultados');
  contenedor.innerHTML = '';

  if (!ultimos) return MostrarAlerta({ tipo: 'error', title: 'Egreso', mnsj: 'Escribi los ultimos digitos del IMEI' });

  const boton = document.getElementById('btnBuscarImei');
  boton.disabled = true;
  try {
    const resp = await llamarStockWrite({ accion: 'buscarImei', ultimos4: ultimos });
    if (!resp.ok) throw new Error(resp.error || 'Error desconocido');

    if (!resp.resultados.length) {
      contenedor.innerHTML = '<p class="sm-t">No se encontro ningun equipo activo con esos digitos.</p>';
      return;
    }

    const tabla = document.createElement('table');
    tabla.className = 'table2';
    tabla.innerHTML = '<thead><tr><th>Modelo</th><th>Capacidad</th><th>Color</th><th>IMEI</th><th>Deposito</th><th></th></tr></thead>';
    const tbody = document.createElement('tbody');
    resp.resultados.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.modelo}</td><td>${r.capacidad}</td><td>${r.color}</td><td>${r.imei}</td><td>${r.sucursal}</td><td></td>`;
      const tdBoton = tr.lastElementChild;
      const btnBaja = document.createElement('button');
      btnBaja.type = 'button';
      btnBaja.className = 'btn-total';
      btnBaja.textContent = 'Dar de baja';
      btnBaja.addEventListener('click', () => ConfirmarBaja(r.fila, btnBaja));
      tdBoton.appendChild(btnBaja);
      tbody.appendChild(tr);
    });
    tabla.appendChild(tbody);
    contenedor.appendChild(tabla);
  } catch (error) {
    MostrarAlerta({ tipo: 'error', title: 'Egreso', mnsj: 'No se pudo buscar: ' + error.message });
  } finally {
    boton.disabled = false;
  }
}

async function ConfirmarBaja(fila, boton) {
  boton.disabled = true;
  try {
    const resp = await llamarStockWrite({ accion: 'egreso', fila });
    if (!resp.ok) throw new Error(resp.error || 'Error desconocido');
    MostrarAlerta({ tipo: 'success', title: 'Egreso', mnsj: 'Equipo dado de baja' });
    $('#egresoUltimosDigitos').val('');
    document.getElementById('egresoResultados').innerHTML = '';
    await actualizarStockEnVivo();
  } catch (error) {
    MostrarAlerta({ tipo: 'error', title: 'Egreso', mnsj: 'No se pudo dar de baja: ' + error.message });
    boton.disabled = false;
  }
}

// ============================ VENTA ACCESORIO ============================

function accesoriosSucursal() {
  return (DATA.accesoriosPorSucursal || {})[sucursalActual] || [];
}

function PrecioAccesorio() {
  const categoria = $('#formVenta select[name="categoria"]').val();
  const modelo = $('#formVenta select[name="modeloA"]').val();
  const descripcion = $('#formVenta select[name="descripcion"]').val();
  $('#formVenta input[name="totalAccesorio"]').val('');

  if (categoria && modelo && descripcion) {
    const item = accesoriosSucursal().find(a => a.categoria === categoria && a.modelo === modelo && a.descripcion === descripcion);
    if (item) {
      $('#formVenta input[name="totalAccesorio"]').val(formatNumberArg(item.precio));
      TablaFinancia(item.precio, 'accesorio');
    }
  }

  if (!descripcion) {
    $('#formVenta select[name="descripcion"]').children('option:not(:first)').remove();
    const vistos = {};
    accesoriosSucursal().filter(a => a.categoria === categoria).forEach(a => {
      if (!vistos[a.descripcion]) { vistos[a.descripcion] = true; $('#formVenta select[name="descripcion"]').append(new Option(a.descripcion, a.descripcion)); }
    });
  }

  if (categoria && descripcion && !modelo) {
    $('#formVenta select[name="modeloA"]').children('option:not(:first)').remove();
    const vistos = {};
    accesoriosSucursal().filter(a => a.categoria === categoria && a.descripcion === descripcion).forEach(a => {
      if (!vistos[a.modelo]) { vistos[a.modelo] = true; $('#formVenta select[name="modeloA"]').append(new Option(a.modelo, a.modelo)); }
    });
  }
}

// ============================ VENTA EQUIPO ============================

function PreciosVentaE() {
  const condicion = $('#formVenta select[name="tipoEquipo"]').val();
  const capacidad = $('#formVenta select[name="capacidadV"]').val();
  const modelo = $('#formVenta select[name="modeloV"]').val();
  const bateria = $('#formVenta select[name="estadoBateria"]').val();
  const adelantoArs = Number($('#formVenta input[name="EntregaAdelanto"]').val()) || 0;
  const adelantoUsd = Number($('#formVenta input[name="EntregaAdelantoUsd"]').val()) || 0;
  const precioCompraEquipo = Number($('#formVenta input[name="PCompraEquipo"]').val()) || 0;
  const descuentoTotal = adelantoArs + (adelantoUsd * DATA.dolar.DolarVenta) + precioCompraEquipo;

  if (!(condicion && capacidad && modelo)) return;
  const equipo = buscarEquipoVenta(modelo);
  const tiers = condicion === 'seminuevo' ? tiersDisponibles(equipo, capacidad) : [];
  let precioUsd;
  if (tiers.length) {
    // Esta capacidad tiene varios precios de Semi Nuevo segun la bateria
    // (Independencia): no hay precio hasta que se elija un estado.
    if (!bateria) {
      $('#formVenta input[name="PVentaEquipo"]').val('');
      $('#formVenta input[name="totalVentaEquipo"]').val('$0');
      return;
    }
    const tier = tiers.find(t => t.etiqueta === bateria);
    precioUsd = tier ? tier.precio : null;
  } else {
    precioUsd = equipo && equipo.capacidades[capacidad] ? equipo.capacidades[capacidad][condicion] : null;
  }

  if (precioUsd == null) {
    $('#formVenta input[name="PVentaEquipo"]').val('No disponible');
    $('#formVenta input[name="totalVentaEquipo"]').val('$0');
    return;
  }

  const precioArs = precioUsd * DATA.dolar.DolarVenta;
  const total = precioArs - descuentoTotal;
  $('#formVenta input[name="PVentaEquipo"]').val('USD' + precioUsd);
  $('#dolarVentaE').text('cotizacion USD ' + DATA.dolar.DolarVenta);
  $('#formVenta input[name="totalVentaEquipo"]').val(formatNumberArg(total > 0 ? total : 0));
  TablaFinancia(total > 0 ? total : 0, 'equipo');
  promociones_disp(total > 0 ? total : 0);
}

// ============================ REPARACIONES: precio por modelo x falla ============================

function buscarReparacionesDeModelo(modelo) {
  const entrada = (DATA.reparacionesPorModelo || []).find(r => r.modelo === modelo);
  return entrada ? entrada.precios : null;
}

// Precio en ARS de una falla para un modelo puntual. Diagnostico es fijo
// (no depende de modelo ni dolar); el resto sale de reparacionesPorModelo
// en USD y se convierte con DolarVenta. Devuelve null si esa reparacion no
// se hace en ese modelo.
function precioFallaArs(modelo, nombreFalla) {
  if (nombreFalla === 'Diagnostico') return DATA.diagnosticoPrecioArs;
  const precios = buscarReparacionesDeModelo(modelo);
  if (!precios || precios[nombreFalla] == null) return null;
  return precios[nombreFalla] * DATA.dolar.DolarVenta;
}

// ============================ TRADE IN (canje) ============================
// El usuario elige un modelo (iPhone 11 en adelante) y tilda un checklist de
// fallas funcionales/esteticas. El "Plan canje" SIEMPRE resta al menos el
// valor base de ese modelo (DATA.baseTradeInUsdPorSucursal, segun sucursalActual); si ademas hay fallas
// marcadas con precio de reparacion equivalente, se SUMA arriba de esa base
// un 80% del precio de cada una (no la reemplaza).
//
// Items sin columna de precio equivalente (parlantes/microfono, botones,
// wifi/bluetooth/senal, rayas de pantalla, humedad, piezas faltantes) se
// registran en el detalle pero no restan nada -- no hay de donde sacar un
// numero real para esos (decision del usuario).
const PORCENTAJE_DESCUENTO_TRADEIN = 0.8;

// Solo entran los modelos que tienen valor base cargado. Quedan afuera del
// selector: iPhone X-SE2020 (no se toman) y, por ahora, iPhone 13 Mini y
// toda la familia iPhone 17 (el usuario no paso esos valores todavia).
function baseTradeInUsdSucursal() {
  return (DATA.baseTradeInUsdPorSucursal || {})[sucursalActual] || {};
}

function modelosTradeIn() {
  const tabla = baseTradeInUsdSucursal();
  return (DATA.reparacionesPorModelo || [])
    .map(r => r.modelo)
    .filter(m => Object.prototype.hasOwnProperty.call(tabla, m));
}

function baseTradeInArs(modelo) {
  const usd = baseTradeInUsdSucursal()[modelo];
  return usd == null ? null : usd * DATA.dolar.DolarVenta;
}

// Recorre los checkboxes tildados de #formTradeIn y devuelve
// { descuento, detalle } donde descuento YA incluye el valor base del
// modelo, y detalle es la lista de nombres marcados (con precio o no) para
// mostrar/exportar.
// OJO con el signo: las fallas RESTAN del valor que le damos al cliente por
// el equipo (un iPhone mas roto vale MENOS de canje, no da mas descuento).
// "descuento" aca es "cuanto vale el canje" (lo que se resta del carrito),
// asi que arranca en el valor base y las fallas se lo van comiendo, con
// piso en 0 (nunca queda negativo el valor del canje).
function evaluarChecklistTradeIn(modelo) {
  const base = baseTradeInArs(modelo) || 0;
  let costoFallas = 0;
  const detalle = [];

  $('#formTradeIn :checkbox:checked').each((i, el) => {
    const label = el.nextElementSibling ? el.nextElementSibling.textContent : '';
    detalle.push(label);

    if (el.dataset.informativo) return; // sin precio de referencia, no resta

    // Monto fijo en USD (no es "80% de un precio de reparacion", ya es el
    // numero final que el usuario dio -- ej. humedad, pieza cambiada).
    if (el.dataset.fallaFijoUsd) {
      costoFallas += Number(el.dataset.fallaFijoUsd) * DATA.dolar.DolarVenta;
      return;
    }

    if (el.dataset.fallaMax) {
      const nombres = el.dataset.fallaMax.split(',');
      const precios = nombres.map(n => precioFallaArs(modelo, n)).filter(p => p != null);
      if (precios.length) costoFallas += Math.max(...precios) * PORCENTAJE_DESCUENTO_TRADEIN;
      return;
    }

    if (el.dataset.falla) {
      const precio = precioFallaArs(modelo, el.dataset.falla);
      if (precio != null) costoFallas += precio * PORCENTAJE_DESCUENTO_TRADEIN;
    }
  });

  const descuento = Math.max(0, base - costoFallas);
  return { descuento, detalle, base, costoFallas };
}

function CalcularTradeIn() {
  const modelo = $('#formTradeIn select[name="modeloTI"]').val();
  if (!modelo) {
    $('#formTradeIn input[name="totalDescuentoTradeIn"]').val('');
    return;
  }
  const { descuento } = evaluarChecklistTradeIn(modelo);
  $('#formTradeIn input[name="totalDescuentoTradeIn"]').val(formatNumberArg(descuento));
}

function AgregarCarritoTradeIn() {
  const modelo = $('#formTradeIn select[name="modeloTI"]').val();
  if (!modelo) return MostrarAlerta({ tipo: 'error', title: 'Trade In', mnsj: 'Elegi un modelo antes de agregar el canje' });

  const { descuento, detalle } = evaluarChecklistTradeIn(modelo);
  // A pedido del usuario: mostrar entre parentesis en cuantos USD se toma el
  // equipo (el "descuento" ya esta en ARS, se vuelve a pasar a USD solo para
  // mostrarlo -- no se usa para calcular nada mas).
  const descuentoUsd = Math.round(descuento / DATA.dolar.DolarVenta);

  agregarAlCarrito({
    tipo: 'Trade In',
    descripcion: `Plan canje "${modelo}" (USD ${descuentoUsd})`,
    precio: -descuento,
    modelo: modelo,
    detalleFallas: detalle
  });
}

// ============================ REPARACION ============================

function PreciosRepa() {
  const modeloR = $('#formReparacion select[name="modeloR"]').val();
  if (!modeloR) return;
  let total = 0;
  let faltantes = [];
  $('#formReparacion :checkbox:checked').each((i, el) => {
    const precio = precioFallaArs(modeloR, el.dataset.falla);
    if (precio != null) total += precio;
    else faltantes.push(el.dataset.falla);
  });
  if (faltantes.length) {
    MostrarAlerta({ tipo: 'warning', title: 'Reparacion', mnsj: 'No disponible en ' + modeloR + ': ' + faltantes.join(', ') + ' (no se sumo al total)' });
  }
  $('#formReparacion input[name="totalCotizaRep"]').val(formatNumberArg(total));
  TablaFinancia(total, 'reparacion');
}

// ============================ FINANCIACION / PROMOS / PRECIOS ============================

// Si hay algo cargado en el carrito, la financiacion se muestra siempre
// sobre el total sumado del carrito (no sobre el producto individual que se
// este viendo en ese momento) -- a pedido del usuario. Se usan los planes de
// "equipo" (3/6/12 cuotas) por ser los mas completos, ya que el carrito puede
// mezclar equipos, accesorios y reparaciones bajo un solo total.
function TablaFinancia(value, categoria) {
  // Reparacion no tiene boton "Agregar al carrito" (es una cotizacion aparte,
  // con su propio total y export de WhatsApp), asi que no tiene sentido que
  // un carrito con OTRA cosa adentro (un equipo que el vendedor dejo cargado
  // de antes, por ejemplo) le pise la financiacion sin recargo que se definio
  // especificamente para Reparacion.
  if (carrito.length && categoria !== 'reparacion') {
    value = totalCarrito();
    categoria = 'equipo';
  }
  const filas = DATA.financiacion.filter(f => f.categoria === categoria);
  const table = document.getElementById('tablaResultados');
  table.innerHTML = '';
  infoFinanciacion = '';
  if (!filas.length || value <= 0) { $('#tablaFinancia').removeClass('vista').addClass('oculto'); return; }

  // Los medios de pago de 1 sola cuota sin recargo van todos al mismo valor
  // (interes 0) -- Efectivo se muestra en su propio renglon (con el
  // equivalente en dolares, a pedido del usuario) separado del resto
  // (Debito/QR/Transferencia si los hay), que van agrupados sin dolares.
  const pagoUnico = filas.filter(f => f.cuotas === 1 && f.interes === 0);
  const pagoUnicoEfectivo = pagoUnico.filter(f => f.plan === 'Efectivo');
  const pagoUnicoResto = pagoUnico.filter(f => f.plan !== 'Efectivo');
  const enCuotas = filas.filter(f => !(f.cuotas === 1 && f.interes === 0));

  const fragm = document.createDocumentFragment();

  if (pagoUnicoEfectivo.length) {
    const totalSinRecargo = value;
    infoFinanciacion += `Efectivo: ${formatNumberArg(totalSinRecargo)} (En dolares: ${formatNumberUsd(totalSinRecargo / DATA.dolar.DolarVenta)})\n`;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>0%</td><td>Efectivo</td><td>${formatNumberArg(totalSinRecargo)}</td><td><strong>${formatNumberArg(totalSinRecargo)}</strong></td>`;
    fragm.appendChild(tr);
  }

  if (pagoUnicoResto.length) {
    const totalSinRecargo = value;
    const nombrePlanes = pagoUnicoResto.map(f => f.plan).join(' / ');
    // Aviso de que el efectivo tiene descuento -- solo texto, no cambia el
    // precio de Debito/QR/Transferencia (a pedido del usuario).
    infoFinanciacion += `${nombrePlanes}: ${formatNumberArg(totalSinRecargo)} (Descuento pagando en efectivo)\n`;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>0%</td><td>${nombrePlanes}</td><td>${formatNumberArg(totalSinRecargo)}</td><td><strong>${formatNumberArg(totalSinRecargo)}</strong></td>`;
    fragm.appendChild(tr);
  }

  enCuotas.forEach(f => {
    const totalConInteres = value * (1 + f.interes);
    const cuota = totalConInteres / f.cuotas;
    infoFinanciacion += `${f.plan}: ${f.cuotas} cuotas de ${formatNumberArg(cuota)}\n`;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${(f.interes * 100).toFixed(0)}%</td><td>${f.plan}</td><td>${formatNumberArg(cuota)}</td><td><strong>${formatNumberArg(totalConInteres)}</strong></td>`;
    fragm.appendChild(tr);
  });
  table.appendChild(fragm);
  $('#tablaFinancia').removeClass('oculto').addClass('vista');
}

function promociones_disp(value) {
  const table = document.getElementById('promo-cotizacion');
  table.innerHTML = '';
  if (!DATA.promociones.length) { $('#promo-cotizacion').addClass('oculto'); return; }
  const fragm = document.createDocumentFragment();
  DATA.promociones.forEach(promo => {
    const div = document.createElement('div');
    div.classList.add('col-4', 'col-m-4', 'col-sm-4');
    div.innerHTML = `<div class="card-promo bg-primary"><div class="card-header"><h3>${promo.nombre}</h3></div>
      <div class="card-content"><p class="sm-t">${promo.descripcion}</p></div></div>`;
    fragm.appendChild(div);
  });
  table.appendChild(fragm);
  $('#promo-cotizacion').removeClass('oculto');
}

// Texto a mostrar para un capacidad+condicion puntual. Independencia usa
// "seminuevoTiers" (varios precios de Semi Nuevo segun % de bateria) en vez
// de un unico numero como Shopping -- si hay tiers se muestra el rango
// (precio mas bajo - precio mas alto) en vez de un solo valor.
function textoPrecioCapacidad(capInfo, condicion, enUsd) {
  if (!capInfo) return null;
  const formatear = enUsd ? formatNumberUsd : (usd => formatNumberArg(usd * DATA.dolar.DolarVenta));
  if (condicion === 'sellado') {
    return capInfo.sellado != null ? formatear(capInfo.sellado) : null;
  }
  // condicion === 'seminuevo'
  if (capInfo.seminuevoTiers && capInfo.seminuevoTiers.length) {
    const precios = capInfo.seminuevoTiers.map(t => t.precio);
    const min = Math.min(...precios), max = Math.max(...precios);
    if (min === max) return formatear(min);
    return formatear(min) + ' - ' + formatear(max);
  }
  return capInfo.seminuevo != null ? formatear(capInfo.seminuevo) : null;
}

function CargarSoloPrecios() {
  const table = document.getElementById('bodyPreciosSolos');
  table.innerHTML = '';
  const fragm = document.createDocumentFragment();
  const capacidades = ['64Gb', '128Gb', '256Gb', '512Gb', '1Tb'];
  const enUsd = document.getElementById('checkPreciosUsd').checked;
  equipos.forEach(equipo => {
    ['seminuevo', 'sellado'].forEach(condicion => {
      const valores = capacidades.map(cap => {
        const texto = textoPrecioCapacidad(equipo.capacidades[cap], condicion, enUsd);
        return texto == null ? '-' : texto;
      });
      if (valores.every(v => v === '-')) return;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${equipo.modelo}</td><td>${condicion === 'seminuevo' ? 'Seminuevo' : 'Sellado'}</td>` + valores.map(v => `<td>${v}</td>`).join('');
      fragm.appendChild(tr);
    });
  });
  table.appendChild(fragm);
}

// ============================ WHATSAPP ============================

// Firma del mensaje: antes decia "Jobs Company", ahora identifica a quien
// esta atendiendo (a pedido del usuario).
function firmaWhatsapp() {
  const sesion = sesionGuardada();
  const nombre = sesion ? sesion.nombre : '';
  return `Por cualquier consulta te espero, mi nombre es *${nombre}*`;
}

function ExportarInfo(actividad) {
  const hh = new Date().getHours();
  let saludo = 'Buenos dias';
  if (hh > 14) saludo = 'Buenas tardes';
  if (hh > 19) saludo = 'Buenas noches';
  let mensaje = '';

  if (actividad === 'Reparacion') {
    const fallas = $('#formReparacion :checkbox:checked').map((i, el) => el.dataset.falla).get().join(', ');
    mensaje = `${saludo}\n*Cotizacion de Reparacion*\n\n*Modelo*: ${$('#formReparacion select[name="modeloR"]').val()}\n*Falla/as*: ${fallas}\n\n*Total*: ${$('#formReparacion input[name="totalCotizaRep"]').val()} efectivo\n*Financiacion*\n${infoFinanciacion}\n${firmaWhatsapp()}`;
  } else if (actividad === 'VentaAccesorio') {
    mensaje = `${saludo}\n*Cotizacion de Accesorio*\n\n*Accesorio*: ${$('#formVenta select[name="descripcion"]').val()} - ${$('#formVenta select[name="modeloA"]').val()}\n*Precio*: ${$('#formVenta input[name="totalAccesorio"]').val()} efectivo\n${firmaWhatsapp()}`;
  } else if (actividad === 'VentaEquipo') {
    const bateria = $('#formVenta select[name="estadoBateria"]').val();
    const lineaBateria = bateria ? `\n*Estado de bateria*: ${bateria}` : '';
    // "Precio final" en el mensaje de WhatsApp muestra el precio de "3
    // cuotas sin interes" (no el de efectivo que se ve en pantalla) -- a
    // pedido del usuario, solo cambia lo que se manda por WhatsApp, no el
    // campo en pantalla ni el calculo de la tabla de Financiacion.
    const totalEfectivo = Number(String($('#formVenta input[name="totalVentaEquipo"]').val()).replace(/[^0-9,-]/g, '').replace(',', '.')) || 0;
    const plan3Cuotas = DATA.financiacion.find(f => f.categoria === 'equipo' && f.plan === '3 cuotas sin interes');
    const precioFinalMsj = plan3Cuotas ? totalEfectivo * (1 + plan3Cuotas.interes) : totalEfectivo;
    mensaje = `${saludo}\n*Cotizacion de Equipo*\n\n*Modelo*: ${$('#formVenta select[name="modeloV"]').val()}\n*Capacidad*: ${$('#formVenta select[name="capacidadV"]').val()}\n*Condicion*: ${NOMBRE_CONDICION[$('#formVenta select[name="tipoEquipo"]').val()] || $('#formVenta select[name="tipoEquipo"]').val()}${lineaBateria}\n\n*Precio final*: ${formatNumberArg(precioFinalMsj)}\n*Financiacion*\n${infoFinanciacion}\n${firmaWhatsapp()}`;
  }

  const el = document.createElement('textarea');
  el.value = mensaje;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  MostrarAlerta({ tipo: 'success', title: 'Export', mnsj: 'Se copio la cotizacion de ' + actividad });
}

// ============================ INICIALIZACION ============================

// Usado solo por Reparacion (Trade In tiene su checklist fijo en el HTML).
function poblarChecks(contenedorId, formSelector) {
  const contenedor = document.getElementById(contenedorId);
  contenedor.innerHTML = '';
  DATA.tiposFalla.forEach((nombre, i) => {
    const id = contenedorId + i;
    const div = document.createElement('div');
    div.className = 'my-1';
    div.innerHTML = `<input type="checkbox" id="${id}" data-falla="${nombre}"><label for="${id}">${nombre}</label>`;
    contenedor.appendChild(div);
  });
  $(formSelector + ' :checkbox').on('change', PreciosRepa);
}

function cargarSucursal(sucursal) {
  sucursalActual = sucursal;
  equipos = equiposDeLaSucursal(sucursal);

  $('#formVenta select[name="modeloV"]').children('option:not(:first)').remove();
  $('#formTradeIn select[name="modeloTI"]').children('option:not(:first)').remove();
  $('#formReparacion select[name="modeloR"]').children('option:not(:first)').remove();

  equiposParaVenta().forEach(e => $('#formVenta select[name="modeloV"]').append(new Option(e.modelo, e.modelo)));
  // Reparacion tiene su propia lista de modelos (llega mas atras, hasta el
  // iPhone X, no solo los que estan a la venta en esta sucursal).
  (DATA.reparacionesPorModelo || []).forEach(r => $('#formReparacion select[name="modeloR"]').append(new Option(r.modelo, r.modelo)));
  // Trade In: del iPhone 11 en adelante (no se toman modelos mas viejos).
  modelosTradeIn().forEach(m => $('#formTradeIn select[name="modeloTI"]').append(new Option(m, m)));

  // Accesorios: catalogo por sucursal, se repuebla cada vez que cambia (a
  // diferencia de modeloV/modeloTI/modeloR esto no se repoblaba antes, se
  // llenaba una unica vez al loguearse).
  $('#formVenta select[name="categoria"]').children('option:not(:first)').remove();
  const categoriasVistas = {};
  accesoriosSucursal().forEach(a => {
    if (!categoriasVistas[a.categoria]) { categoriasVistas[a.categoria] = true; $('#formVenta select[name="categoria"]').append(new Option(a.categoria, a.categoria)); }
  });

  // Precio venta / Precio pagando en efectivo: en Independencia se pueden
  // editar a mano (el vendedor puede sobreescribir el numero calculado); en
  // Shopping quedan como estaban, de solo lectura.
  const editable = sucursal === 'Independencia';
  $('#formVenta input[name="PVentaEquipo"]').prop('readonly', !editable);
  $('#formVenta input[name="totalVentaEquipo"]').prop('readonly', !editable);

  ResetFormCotizador();
  actualizarModuloStock('');

  if (!equipos.length) {
    MostrarAlerta({ tipo: 'warning', title: 'Sucursal', mnsj: sucursal + ' todavia no tiene lista de precios de iPhone cargada. AirPods/Watch/iPad/MacBook si estan disponibles.' });
  } else {
    MostrarAlerta({ tipo: 'success', title: 'Sucursal', mnsj: 'Mostrando precios de ' + sucursal + (DATA.sucursalesShopping.includes(sucursal) ? ' (shopping)' : '') });
  }
}

function iniciarApp(sesion) {
  document.getElementById('usuarioActualNombre').textContent = sesion.nombre;
  document.getElementById('usuarioActualRol').textContent = ROLES[sesion.rol].nombre;

  const selectSucursal = document.getElementById('selectSucursal');
  if (esAdmin(sesion)) {
    // Admin: ve y puede cambiar entre las 2 sucursales.
    DATA.sucursales.forEach(s => selectSucursal.appendChild(new Option(s + (DATA.sucursalesShopping.includes(s) ? ' (shopping)' : ''), s)));
    sucursalActual = DATA.sucursales[0];
  } else {
    // Vendedor: queda fijo en su sucursal asignada, el selector no se puede tocar.
    selectSucursal.appendChild(new Option(sesion.sucursal, sesion.sucursal));
    selectSucursal.disabled = true;
    sucursalActual = sesion.sucursal;
  }
  selectSucursal.value = sucursalActual;
  selectSucursal.addEventListener('change', () => cargarSucursal(selectSucursal.value));
  cargarSucursal(sucursalActual);

  // Ingreso/Egreso de stock: solo lo ve el admin.
  if (esAdmin(sesion)) {
    document.getElementById('btnCIngresoEgreso').classList.remove('oculto');
  }

  document.getElementById('toggleTema').addEventListener('click', toggleTema);

  document.getElementById('btnToggleCarrito').addEventListener('click', () => {
    document.getElementById('cardCarrito').classList.toggle('oculto');
  });

  document.getElementById('btnLogout').addEventListener('click', () => {
    cerrarSesion();
    location.reload();
  });

  document.getElementById('refrescarStock').addEventListener('click', async () => {
    await actualizarStockEnVivo();
    actualizarModuloStock($('#formVenta select[name="modeloV"]').val());
    MostrarAlerta({ tipo: 'success', title: 'Stock', mnsj: 'Actualizado' });
  });

  document.getElementById('refrescarStockCompleto').addEventListener('click', async () => {
    await actualizarStockEnVivo();
    poblarSelectStockModelo();
    actualizarVistaStockCompleto();
    MostrarAlerta({ tipo: 'success', title: 'Stock', mnsj: 'Actualizado' });
  });
  document.getElementById('selectStockModelo').addEventListener('change', actualizarVistaStockCompleto);

  document.getElementById('selectTipoOperacion').addEventListener('change', function () {
    const esIngreso = this.value === 'ingreso';
    $('#panelIngreso').toggleClass('oculto', !esIngreso);
    $('#panelEgreso').toggleClass('oculto', esIngreso);
  });
  document.getElementById('btnConfirmarIngreso').addEventListener('click', ConfirmarIngreso);
  document.getElementById('btnBuscarImei').addEventListener('click', BuscarImei);

  // Cada 7 min (antes 5 el dolar, 2 el stock) para gastar menos invocaciones
  // de las funciones de Netlify -- a pedido del usuario, se estaba por
  // quedar sin creditos del plan gratis.
  actualizarDolar();
  setInterval(actualizarDolar, 7 * 60 * 1000);

  actualizarStockEnVivo().then(() => actualizarModuloStock($('#formVenta select[name="modeloV"]').val()));
  setInterval(async () => {
    await actualizarStockEnVivo();
    actualizarModuloStock($('#formVenta select[name="modeloV"]').val());
    // Si la pestana Stock esta abierta en este momento, se refresca sola.
    if ($('#vistaStock').hasClass('vista')) { poblarSelectStockModelo(); actualizarVistaStockCompleto(); }
  }, 7 * 60 * 1000);

  $('#checkPreciosUsd').on('change', CargarSoloPrecios);

  poblarChecks('checksFallasReparacion', '#formReparacion');
  $('#formTradeIn :checkbox').on('change', CalcularTradeIn);
  $('#formTradeIn select[name="modeloTI"]').on('change', CalcularTradeIn);

  $('#formVenta select[name="tipoVenta"]').change(function () {
    const met = $(this).val();
    if (met === 'venta equipo') {
      $('#formVenta select[name="categoria"]').val('').change();
      $('#ventaAccesorio').removeClass('vista').addClass('oculto');
      $('#ventaEquipo').removeClass('oculto').addClass('vista');
    } else {
      $('#ventaEquipo').removeClass('vista').addClass('oculto');
      $('#ventaAccesorio').removeClass('oculto').addClass('vista');
      $('#promo-cotizacion').addClass('oculto');
      actualizarModuloStock('');
    }
  });

  $('#formVenta select[name="categoria"]').change(function () {
    $('#formVenta select[name="descripcion"]').children('option:not(:first)').remove();
    $('#formVenta select[name="modeloA"]').children('option:not(:first)').remove();
    PrecioAccesorio();
  });
  $('#formVenta select[name="descripcion"]').change(function () {
    $('#formVenta select[name="modeloA"]').children('option:not(:first)').remove();
    PrecioAccesorio();
  });
  $('#formVenta select[name="modeloA"]').change(PrecioAccesorio);

  // Modelo -> Condicion (solo las condiciones que ese modelo realmente tiene) -> Capacidad
  // (solo las capacidades que existen para el modelo+condicion elegidos). Cada condicion
  // es, en los hechos, "una lista distinta" de precios: Semi Nuevos vs Sellado.

  function condicionesDisponibles(equipo) {
    if (!equipo) return [];
    const condiciones = new Set();
    Object.keys(equipo.capacidades).forEach(cap => {
      if (tieneSeminuevo(equipo.capacidades[cap])) condiciones.add('seminuevo');
      if (equipo.capacidades[cap].sellado != null) condiciones.add('sellado');
    });
    return Array.from(condiciones);
  }

  function capacidadesDisponibles(equipo, condicion) {
    if (!equipo || !condicion) return [];
    return Object.keys(equipo.capacidades).filter(cap => {
      const c = equipo.capacidades[cap];
      return condicion === 'seminuevo' ? tieneSeminuevo(c) : c[condicion] != null;
    });
  }

  function ocultarEstadoBateria() {
    $('#formVenta select[name="estadoBateria"]').val('').children('option:not(:first)').remove();
    $('#grupoEstadoBateria').addClass('oculto');
  }

  $('#formVenta select[name="modeloV"]').change(function () {
    const equipo = buscarEquipoVenta($(this).val());
    const selectCondicion = $('#formVenta select[name="tipoEquipo"]');
    selectCondicion.children('option:not(:first)').remove();
    $('#formVenta select[name="capacidadV"]').val('').children('option:not(:first)').remove();
    ocultarEstadoBateria();
    condicionesDisponibles(equipo).forEach(cond => selectCondicion.append(new Option(NOMBRE_CONDICION[cond], cond)));
    selectCondicion.val('');
    actualizarModuloStock($(this).val());
  });

  $('#formVenta select[name="tipoEquipo"]').change(function () {
    const equipo = buscarEquipoVenta($('#formVenta select[name="modeloV"]').val());
    const condicion = $(this).val();
    const selectCapacidad = $('#formVenta select[name="capacidadV"]');
    selectCapacidad.val('').children('option:not(:first)').remove();
    ocultarEstadoBateria();
    capacidadesDisponibles(equipo, condicion).forEach(cap => selectCapacidad.append(new Option(cap, cap)));
    PreciosVentaE();
  });

  $('#formVenta select[name="capacidadV"]').change(function () {
    const equipo = buscarEquipoVenta($('#formVenta select[name="modeloV"]').val());
    const condicion = $('#formVenta select[name="tipoEquipo"]').val();
    const capacidad = $(this).val();
    const tiers = condicion === 'seminuevo' ? tiersDisponibles(equipo, capacidad) : [];
    const selectBateria = $('#formVenta select[name="estadoBateria"]');
    selectBateria.val('').children('option:not(:first)').remove();
    if (tiers.length) {
      tiers.forEach(t => selectBateria.append(new Option(t.etiqueta, t.etiqueta)));
      $('#grupoEstadoBateria').removeClass('oculto');
    } else {
      $('#grupoEstadoBateria').addClass('oculto');
    }
    PreciosVentaE();
  });

  $('#formVenta select[name="estadoBateria"], #formVenta input[name="EntregaAdelanto"], #formVenta input[name="EntregaAdelantoUsd"]').on('input change', PreciosVentaE);

  // Independencia: "Precio venta" (USD) y "Precio pagando en efectivo" (ARS)
  // dejan de ser de solo lectura -- el vendedor los puede sobreescribir a
  // mano. Si edita el USD, se recalcula el ARS (mismo descuento de entrega
  // en efectivo que ya estaba aplicado); si edita el ARS directo, se toma
  // tal cual y solo se actualiza la financiacion en base a ese numero.
  $('#formVenta input[name="PVentaEquipo"]').on('input', function () {
    if ($(this).prop('readonly')) return;
    const usd = Number(String($(this).val()).replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0;
    const adelantoArs = Number($('#formVenta input[name="EntregaAdelanto"]').val()) || 0;
    const adelantoUsd = Number($('#formVenta input[name="EntregaAdelantoUsd"]').val()) || 0;
    const descuentoTotal = adelantoArs + (adelantoUsd * DATA.dolar.DolarVenta);
    const total = (usd * DATA.dolar.DolarVenta) - descuentoTotal;
    $('#formVenta input[name="totalVentaEquipo"]').val(formatNumberArg(total > 0 ? total : 0));
    TablaFinancia(total > 0 ? total : 0, 'equipo');
    promociones_disp(total > 0 ? total : 0);
  });
  $('#formVenta input[name="totalVentaEquipo"]').on('input', function () {
    if ($(this).prop('readonly')) return;
    const total = Number(String($(this).val()).replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0;
    TablaFinancia(total > 0 ? total : 0, 'equipo');
    promociones_disp(total > 0 ? total : 0);
  });

  $('#formReparacion select[name="modeloR"]').change(PreciosRepa);

  document.addEventListener('click', e => {
    const node = e.target;
    if (node.matches('button')) {
      const accion = node.dataset.action;
      const acciones = {
        'ExportarInfo': (param) => ExportarInfo(param),
        'btnCVenta': () => Venta(),
        'btnCTradeIn': () => TradeIn(),
        'btnCRepa': () => Reparacion(),
        'btnCPrecios': () => Precios(),
        'btnCStock': () => Stock(),
        'btnCIngresoEgreso': () => IngresoEgreso(),
        'AgregarCarritoEquipo': () => AgregarCarritoEquipo(),
        'AgregarCarritoAccesorio': () => AgregarCarritoAccesorio(),
        'AgregarCarritoTradeIn': () => AgregarCarritoTradeIn(),
        'ExportarCarrito': () => ExportarCarrito()
      };
      if (accion && acciones[accion]) node.dataset.param ? acciones[accion](node.dataset.param) : acciones[accion]();
    }
    if (node.matches('.fa-eraser')) ResetFormCotizador();
    if (node.matches('.fa-trash')) VaciarCarrito();
    if (node.matches('[data-quitar-carrito]')) quitarDelCarrito(Number(node.dataset.quitarCarrito));
  });

  renderCarrito();
}

// ============================ ARRANQUE (login) ============================
// Si ya hay una sesion guardada (localStorage), entra directo. Si no,
// muestra el login y recien arranca la app cuando las credenciales son
// validas. Mientras no haya sesion, iniciarApp() nunca se llama -- no se
// pueblan selects ni se pide el dolar ni nada, para no hacer trabajo de
// mas ni exponer datos de precios antes de autenticar.
(function arrancar() {
  function mostrarApp(sesion) {
    // Saco la clase que pone el display:flex Y agrego "oculto" a la vez:
    // si quedaran las dos juntas, cual gana depende del orden de las reglas
    // CSS, mejor no depender de eso.
    document.getElementById('pantallaLogin').classList.remove('pantalla-login');
    document.getElementById('pantallaLogin').classList.add('oculto');
    document.getElementById('appContenido').classList.remove('oculto');
    iniciarApp(sesion);
  }

  const sesion = sesionGuardada();
  if (sesion) return mostrarApp(sesion);

  document.getElementById('formLogin').addEventListener('submit', function (e) {
    e.preventDefault();
    const form = e.target;
    const resultado = iniciarSesion(form.usuario.value.trim(), form.password.value);
    const error = document.getElementById('loginError');
    if (resultado.ok) {
      error.classList.add('oculto');
      mostrarApp(resultado.sesion);
    } else {
      error.textContent = resultado.error;
      error.classList.remove('oculto');
    }
  });
})();
