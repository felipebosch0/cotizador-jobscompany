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
// en Shopping vs Independencia) asi que se recalcula cada vez en vez de
// fijarse una sola vez al cargar la pagina.
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
  // Comparacion sin importar mayusculas/espacios -- la planilla real tiene
  // el deposito de Independencia escrito como "Independencia" en vez de
  // "INDEPENDENCIA" como estaba mapeado, asi que no matcheaba nunca y esas
  // filas quedaban sin sucursal reconocida (mostraban "Depo" y sin precio).
  const buscado = String(deposito || '').trim().toLowerCase();
  const entrada = Object.entries(DATA.depositoPorSucursal || {})
    .find(([, depositos]) => depositos.some(d => d.toLowerCase() === buscado));
  return entrada ? entrada[0] : null;
}

// Precio de venta de una unidad de stock, sacado del modulo de Precios
// (equiposPorSucursal) segun sucursal + modelo + capacidad + condicion.
// La condicion sale de la vieja columna "Observaciones" ("Semi-Nuevo" o
// "Sellado"); si dice otra cosa (ej. "Trade-in") o el modelo/capacidad no
// tiene precio cargado, no hay de donde sacar un numero.
// stockPrecioUsd: toggleado con el boton "USD" del modulo de Stock, para
// ver los precios en dolares en vez de pesos.
let stockPrecioUsd = false;
function precioStockTexto(u) {
  const sucursal = grupoDeSucursal(u.sucursal);
  if (!sucursal) return '-';
  // El stock mezcla unidades de las 2 sucursales (para ver donde mas hay),
  // pero el precio solo tiene sentido para lo que es de TU sucursal actual
  // -- si es de la otra, no tiene por que valer lo mismo, asi que no se
  // muestra ningun numero (evita confundir "esto vale $X" con el precio de
  // una sucursal en la que no estas parado).
  if (sucursal !== sucursalActual) return '-';
  // Normalizado (sin espacios/guiones, minuscula) porque la planilla de
  // Independencia no siempre escribe "Semi-Nuevo" igual que Shopping --
  // aparecio como "Seminuevo"/"Semi Nuevo" y quedaba sin precio (mostraba
  // "-") por una comparacion exacta que no las reconocia.
  const observacionNormalizada = String(u.observaciones || '').toLowerCase().replace(/[\s-]/g, '');
  const condicion = observacionNormalizada === 'seminuevo' ? 'seminuevo' : observacionNormalizada === 'sellado' ? 'sellado' : null;
  if (!condicion) return '-';
  const equipo = (DATA.equiposPorSucursal[sucursal] || []).find(e => normalizarModelo(e.modelo) === normalizarModelo(u.modelo));
  if (!equipo) return '-';
  const capacidad = u.capacidad >= 1024 ? '1Tb' : u.capacidad + 'Gb';
  return textoPrecioCapacidad(equipo.capacidades[capacidad], condicion, stockPrecioUsd) || '-';
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
    tr.innerHTML = `<td>${capacidad}</td><td>${u.bateria}%</td><td>${u.color}</td><td>${precioStockTexto(u)}</td><td>${u.falla || ''}</td><td>${u.observaciones}</td><td>${sucursalTexto}</td>`;
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
    tr.innerHTML = `<td>${u.modelo}</td><td>${capacidad}</td><td>${u.bateria}%</td><td>${u.color}</td><td>${precioStockTexto(u)}</td><td>${u.falla || ''}</td><td>${u.observaciones}</td><td>${sucursalTexto}</td>`;
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
  const btnGarantia = document.getElementById('btnImprimirGarantia');
  const btnDeclaracion = document.getElementById('btnImprimirDeclaracion');
  const badge = document.getElementById('badgeCarrito');

  badge.textContent = carrito.length;
  badge.classList.toggle('oculto', carrito.length === 0);

  body.innerHTML = '';
  if (!carrito.length) {
    tabla.classList.add('oculto');
    totalWrap.classList.add('oculto');
    btnExport.classList.add('oculto');
    btnGarantia.classList.add('oculto');
    btnDeclaracion.classList.add('oculto');
    vacio.classList.remove('oculto');
    $('#tablaFinancia').removeClass('vista').addClass('oculto');
    return;
  }

  vacio.classList.add('oculto');
  tabla.classList.remove('oculto');
  totalWrap.classList.remove('oculto');
  btnExport.classList.remove('oculto');

  // El boton de garantia solo aparece si hay un equipo en el carrito Y ya
  // esta cargada la plantilla de garantia para la sucursal actual.
  const hayEquipo = !!equipoPrincipalDelCarrito();
  const hayPlantilla = hayEquipo && GARANTIA_TEXTOS[sucursalActual] && GARANTIA_TEXTOS[sucursalActual][equipoPrincipalDelCarrito().condicion];
  btnGarantia.classList.toggle('oculto', !hayPlantilla);

  // El boton de declaracion jurada solo aparece si hay un canje (Trade In)
  // en el carrito.
  btnDeclaracion.classList.toggle('oculto', !tradeInDelCarrito());

  const fragm = document.createDocumentFragment();
  carrito.forEach((item, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${item.tipo}</td><td>${item.descripcion}</td><td>${formatNumberArg(item.precio)}</td><td><i class="fas fa-times" data-quitar-carrito="${i}" style="cursor:pointer;"></i></td>`;
    fragm.appendChild(tr);
  });
  body.appendChild(fragm);
  document.getElementById('totalCarrito').value = formatNumberArg(totalCarrito());

  // La financiacion del carrito no se muestra en vivo mientras se navega
  // otras pestanas -- solo se calcula/actualiza si la pestana Carrito esta
  // activa en este momento.
  if ($('#vistaCarrito').hasClass('vista')) {
    $('#tablaFinancia').removeClass('oculto').addClass('vista');
    TablaFinancia(totalCarrito(), 'equipo');
  }
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
  // como si se pagara en efectivo con dolares).
  const sufijoUsd = sucursalActual === 'Independencia'
    ? ` (USD ${Math.round(total / DATA.dolar.DolarVenta)})`
    : '';

  agregarAlCarrito({
    tipo: 'Equipo',
    descripcion: `${modelo} ${capacidad} (${condicionTexto})${sufijoUsd}`,
    precio: total + adelanto,
    // Estos 3 campos son los que usa la garantia (ver imprimirGarantia) --
    // esEquipoPrincipal distingue este renglon de los de "Entrega en
    // efectivo" de abajo, que tambien quedan con tipo "Equipo".
    esEquipoPrincipal: true,
    modelo, capacidad, condicion
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
  // TablaFinancia) y se incluye aca con las distintas cotizaciones/planes.
  const lineas = carrito.map(item => `- ${item.descripcion}: ${formatNumberArg(item.precio)}`).join('\n');

  // Si hay un Trade In en el carrito, se agrega un parrafo personalizado
  // aclarando en cuanto se toma el equipo. Antes decia "con un descuento de
  // $X por el estado relevado (...)", lo cual ademas quedaba roto ("(...)")
  // cuando no se marco ninguna falla (equipo en perfecto estado). Ahora dice
  // en cuanto se toma el equipo, y solo menciona las fallas marcadas si hay
  // alguna.
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
// Definida en reportes.js -- se llama igual que el resto de las pestanas
// (ver dispatcher de data-action mas abajo) para no romper el patron.
function Reportes() { ResetFormCotizador(); $('#vistaReportes').removeClass('oculto').addClass('vista'); if (typeof iniciarReportes === 'function') iniciarReportes(); }
function Carrito() {
  ResetFormCotizador();
  $('#vistaCarrito').removeClass('oculto').addClass('vista');
  $('#cardCarrito').removeClass('oculto');
  renderCarrito();
  if (carrito.length) {
    $('#tablaFinancia').removeClass('oculto').addClass('vista');
    TablaFinancia(totalCarrito(), 'equipo');
  }
}

// ============================ INGRESO / EGRESO DE STOCK (solo admin) ============================
// Escribe/actualiza la planilla real via una funcion de Netlify que le pega
// al Apps Script "puerta de entrada" pegado en la planilla (ver doPost en
// cotizador-appscript/Codigo.gs). El Netlify function solo reenvia el
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
  const falla = $('#ingresoFalla').val().trim();

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
    const resp = await llamarStockWrite({ accion: 'ingreso', modelo, capacidad, bateria, color, imei, sucursal, observaciones, falla });
    if (!resp.ok) throw new Error(resp.error || 'Error desconocido');
    MostrarAlerta({ tipo: 'success', title: 'Ingreso', mnsj: `${modelo} ${capacidad}Gb agregado al stock` });
    $('#ingresoModelo, #ingresoCapacidad, #ingresoBateria, #ingresoColor, #ingresoImei, #ingresoFalla').val('');
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
// (no depende de modelo); el resto sale de reparacionesPorModelo, que
// ahora esta directo en ARS (lista real sacada de Gestioo, ya no se
// convierte con DolarVenta). Devuelve null si esa reparacion no se hace
// en ese modelo.
function precioFallaArs(modelo, nombreFalla) {
  if (nombreFalla === 'Diagnostico') return DATA.diagnosticoPrecioArs;
  const precios = buscarReparacionesDeModelo(modelo);
  if (!precios || precios[nombreFalla] == null) return null;
  return precios[nombreFalla];
}

// ============================ TRADE IN (canje) ============================
// El usuario elige un modelo (iPhone 11 en adelante) y tilda un checklist de
// fallas funcionales/esteticas. El "Plan canje" SIEMPRE resta al menos el
// valor base de ese modelo (DATA.baseTradeInUsdPorSucursal, segun sucursalActual); si ademas hay fallas
// marcadas con precio de reparacion equivalente, se SUMA arriba de esa base
// un 80% del precio de cada una (no la reemplaza).
//
// Wifi/bluetooth/senal es el unico item sin precio de referencia (no hay
// de donde sacar un numero real) -- se registra en el detalle pero no
// resta nada. El resto SI tiene categoria de precio: Parlantes/microfono y
// botones salen de Gestioo (Altavoz / Auricular y Flex boton encendido);
// Face ID/Touch ID y Chasis salen de una lista aparte que paso el negocio
// (Gestioo no las tenia cargadas).
const PORCENTAJE_DESCUENTO_TRADEIN = 0.8;

// Solo entran los modelos que tienen valor base cargado en
// baseTradeInUsdPorSucursal. Quedan afuera del selector los modelos
// anteriores a iPhone 11 (no se toman en Trade In) y cualquier modelo al
// que todavia le falte cargar ese valor.
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
    // numero final -- ej. humedad, pieza cambiada).
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
  // Se muestra entre parentesis en cuantos USD se toma el equipo (el
  // "descuento" ya esta en ARS, se vuelve a pasar a USD solo para
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

// ============================ TRADE IN: declaracion jurada ============================
// Boton aparte de "Agregar al carrito" -- no lo reemplaza ni depende de el.
// IMEI y bateria NO se piden en el formulario de Trade In (solo hacen falta
// para la declaracion), se completan aca en el modal junto con nombre y DNI
// del cliente. Al confirmar: 1) manda el equipo al stock (mismo mecanismo
// que Ingreso manual, leyenda "Trade-in" en Observaciones) y 2) abre una
// pestana nueva con la declaracion jurada lista para imprimir y firmar.

// El boton vive en el Carrito, no en el formulario de Trade In -- por eso
// toda la info del equipo (modelo, fallas marcadas, descuento) sale del
// item ya agregado al carrito, no del estado en vivo del formulario (que
// puede estar reseteado si el vendedor ya navego a otra pestana).
function tradeInDelCarrito() {
  return carrito.find(item => item.tipo === 'Trade In' && item.modelo) || null;
}

function AbrirModalDeclaracion() {
  const tradeIn = tradeInDelCarrito();
  if (!tradeIn) return MostrarAlerta({ tipo: 'error', title: 'Declaracion jurada', mnsj: 'No hay ningun canje (Trade In) en el carrito' });
  $('#djNombre, #djDni, #djImei, #djBateria, #djColor, #djCapacidad').val('');
  document.getElementById('modalDeclaracionJurada').style.display = 'block';
}

function CerrarModalDeclaracion() {
  document.getElementById('modalDeclaracionJurada').style.display = 'none';
}

async function ConfirmarDeclaracionJurada() {
  const nombre = $('#djNombre').val().trim();
  const dni = $('#djDni').val().trim();
  const imei = $('#djImei').val().trim();
  const bateriaTexto = $('#djBateria').val().trim();
  const color = $('#djColor').val().trim();
  const capacidad = $('#djCapacidad').val().trim();
  if (!nombre || !dni || !imei) return MostrarAlerta({ tipo: 'error', title: 'Declaracion jurada', mnsj: 'Completa nombre, DNI e IMEI del cliente' });
  if (!/^\d{15}$/.test(imei)) return MostrarAlerta({ tipo: 'error', title: 'Declaracion jurada', mnsj: 'El IMEI tiene que tener exactamente 15 digitos' });

  let bateria = Number(bateriaTexto.replace(',', '.')) || 0;
  if (bateria > 1) bateria = bateria / 100;

  const tradeIn = tradeInDelCarrito();
  if (!tradeIn) return MostrarAlerta({ tipo: 'error', title: 'Declaracion jurada', mnsj: 'No hay ningun canje (Trade In) en el carrito' });
  const modelo = tradeIn.modelo;
  const descuento = -tradeIn.precio;
  const falla = (tradeIn.detalleFallas || []).join(', ');

  // Observaciones queda como "Trade-in" (clasificacion del ingreso) y el
  // nombre del vendedor logueado que recibio el equipo se guarda aparte, en
  // la columna Propietario (J) de la planilla -- asi se puede filtrar por
  // esa columna sin tener que parsear texto en Observaciones.
  const sesion = sesionGuardada();
  const propietario = sesion ? sesion.nombre : 'desconocido';

  const boton = document.getElementById('btnConfirmarDeclaracion');
  boton.disabled = true;
  try {
    const resp = await llamarStockWrite({
      accion: 'ingreso', modelo, capacidad, bateria, color, imei,
      sucursal: sucursalActual, observaciones: 'Trade-in', falla, propietario
    });
    if (!resp.ok) throw new Error(resp.error || 'Error desconocido');
    await actualizarStockEnVivo();
    await imprimirDeclaracionJurada({ nombre, dni, modelo, imei, valor: descuento });
    CerrarModalDeclaracion();
    MostrarAlerta({ tipo: 'success', title: 'Declaracion jurada', mnsj: `${modelo} agregado al stock como Trade-in` });
  } catch (error) {
    MostrarAlerta({ tipo: 'error', title: 'Declaracion jurada', mnsj: 'No se pudo agregar al stock: ' + error.message });
  } finally {
    boton.disabled = false;
  }
}

// Los documentos imprimibles (declaracion jurada, garantia) se abren en una
// pestana en blanco via window.open('', ...) -- no tienen la URL del sitio
// como base, asi que una ruta relativa a la imagen del logo no resuelve.
// Por eso se trae el archivo y se embebe como base64 directo en el <img>.
// Se cachea por sucursal despues de la primera vez para no volver a
// pedirlo cada impresion. Cada sucursal tiene su propio logo.
const LOGOS_POR_SUCURSAL = {
  Shopping: 'logo-jobs-company.jpeg',
  Independencia: 'logo-independencia.jpeg'
};
const logoBase64Cache = {};
async function logoBase64(sucursal) {
  if (logoBase64Cache[sucursal]) return logoBase64Cache[sucursal];
  const archivo = LOGOS_POR_SUCURSAL[sucursal] || LOGOS_POR_SUCURSAL.Shopping;
  try {
    const resp = await fetch(archivo);
    if (!resp.ok) throw new Error('No se encontro ' + archivo);
    const buffer = await resp.arrayBuffer();
    // Se arma el data URI a mano con mime "image/jpeg" fijo -- no hay que
    // confiar en el Content-Type que devuelva el server (algunos servers
    // estaticos, sobre todo de prueba, sirven .jpeg como
    // application/octet-stream y el navegador no lo renderiza como imagen).
    let binario = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
    logoBase64Cache[sucursal] = 'data:image/jpeg;base64,' + btoa(binario);
  } catch (error) {
    logoBase64Cache[sucursal] = null;
  }
  return logoBase64Cache[sucursal];
}

async function imprimirDeclaracionJurada(datos) {
  // window.open tiene que llamarse ANTES de cualquier await -- si no, el
  // navegador ya no lo considera parte del gesto de click del usuario y
  // bloquea la ventana como si fuera un popup no solicitado.
  const ventana = window.open('', '_blank');
  if (!ventana) return MostrarAlerta({ tipo: 'error', title: 'Declaracion jurada', mnsj: 'El navegador bloqueo la ventana de impresion -- permiti popups para este sitio' });

  const logo = await logoBase64(sucursalActual);
  const encabezadoLogo = logo ? `<img src="${logo}" alt="Jobs Company" style="height:60px; display:block; margin:0 auto 16px;">` : '';
  const fecha = new Date().toLocaleDateString('es-AR');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Declaracion jurada</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; color: #111; line-height: 1.5; }
  h1 { font-size: 20px; text-align: center; }
  h2 { font-size: 15px; margin-top: 28px; border-bottom: 1px solid #999; padding-bottom: 4px; }
  ul { padding-left: 20px; }
  li { margin-bottom: 6px; }
  .campo { margin: 6px 0; }
  .campo strong { display: inline-block; min-width: 160px; }
  .firma { margin-top: 60px; }
  .firma .linea { margin-top: 40px; border-top: 1px solid #333; width: 300px; }
</style></head>
<body>
  ${encabezadoLogo}
  <h1>DOCUMENTO DE ENTREGA DE EQUIPOS EN PARTE DE PAGO</h1>

  <h2>DATOS DEL CLIENTE</h2>
  <div class="campo"><strong>Nombre y apellido:</strong> ${datos.nombre}</div>
  <div class="campo"><strong>DNI/CUIT:</strong> ${datos.dni}</div>

  <h2>DATOS DEL IPHONE ENTREGADO</h2>
  <div class="campo"><strong>Marca:</strong> Apple</div>
  <div class="campo"><strong>Modelo:</strong> ${datos.modelo}</div>
  <div class="campo"><strong>Numero de IMEI:</strong> ${datos.imei}</div>

  <h2>DECLARACIONES DEL CLIENTE</h2>
  <ul>
    <li>Declaro que el iPhone entregado es de mi propiedad y no tiene ninguna restriccion de uso.</li>
    <li>Declaro que el iPhone no esta bloqueado por ningun operador de telefonia movil.</li>
    <li>Declaro que el iPhone no esta denunciado por robado ni extraviado.</li>
    <li>Declaro que el iPhone no tiene ninguna cuenta de iCloud asociada y no esta sujeto a ninguna restriccion de activacion.</li>
    <li>Declaro que el iPhone no tiene bypass ni ningun otro tipo de modificacion no autorizada.</li>
  </ul>

  <h2>CONDICIONES DE LA ENTREGA</h2>
  <ul>
    <li>El cliente se compromete a proporcionar toda la informacion necesaria para verificar la propiedad y el estado del iPhone entregado.</li>
    <li>El cliente queda a disposicion de la empresa para resolver cualquier inconveniente.</li>
  </ul>
  <div class="campo"><strong>Valor del equipo:</strong> ${formatNumberArg(datos.valor)}</div>

  <div class="firma">
    <strong>FIRMA DEL CLIENTE</strong>
    <div class="linea"></div>
    <div class="campo">Fecha: ${fecha}</div>
  </div>

  <script>window.onload = () => window.print();</script>
</body></html>`;

  ventana.document.write(html);
  ventana.document.close();
}

// ============================ CARRITO: garantia ============================
// Boton "Imprimir garantia" en el Carrito -- solo aparece si hay un equipo
// (Venta > Equipo) cargado. El equipo ya trae modelo/capacidad/condicion/
// precio del carrito; lo unico que falta pedir es IMEI y color (Venta >
// Equipo no los pide hoy). El texto de la garantia varia segun sucursal y
// segun la condicion (Nuevo/Sellado = 12 meses oficial Apple, Semi-Nuevo =
// 3 meses Jobs Company). Por ahora solo esta cargado el texto de Shopping
// -- el de Independencia se agrega despues (tiene su propio formato de
// comprobante, distinto).
const GARANTIA_TEXTOS = {
  Shopping: {
    sellado: {
      condicionTexto: 'Nuevo',
      garantiaTexto: 'garantia oficial Apple de 12 meses'
    },
    seminuevo: {
      condicionTexto: 'Semi-Nuevo',
      garantiaTexto: 'garantia de 3 meses'
    }
  },
  // Independencia: mismo texto base que Shopping, pero el Semi-Nuevo tiene
  // solo 1 mes de garantia (distinto a Shopping que son 3). El Sellado/
  // Nuevo se asume igual (garantia oficial Apple de 12 meses, es un tema
  // de Apple, no de la sucursal) -- confirmar si no.
  Independencia: {
    sellado: {
      condicionTexto: 'Nuevo',
      garantiaTexto: 'garantia oficial Apple de 12 meses'
    },
    seminuevo: {
      condicionTexto: 'Semi-Nuevo',
      garantiaTexto: 'garantia de 1 mes'
    }
  }
};

function equipoPrincipalDelCarrito() {
  return carrito.find(item => item.esEquipoPrincipal) || null;
}

function AbrirModalGarantia() {
  const equipo = equipoPrincipalDelCarrito();
  if (!equipo) return MostrarAlerta({ tipo: 'error', title: 'Garantia', mnsj: 'No hay ningun equipo en el carrito' });
  if (!GARANTIA_TEXTOS[sucursalActual] || !GARANTIA_TEXTOS[sucursalActual][equipo.condicion]) {
    return MostrarAlerta({ tipo: 'error', title: 'Garantia', mnsj: 'Todavia no esta cargada la plantilla de garantia para ' + sucursalActual });
  }
  $('#gtImei, #gtColor').val('');
  document.getElementById('modalGarantia').style.display = 'block';
}

function CerrarModalGarantia() {
  document.getElementById('modalGarantia').style.display = 'none';
}

async function ConfirmarGarantia() {
  const imei = $('#gtImei').val().trim();
  const color = $('#gtColor').val().trim();
  if (!imei || !color) return MostrarAlerta({ tipo: 'error', title: 'Garantia', mnsj: 'Completa IMEI y color del equipo' });
  if (!/^\d{15}$/.test(imei)) return MostrarAlerta({ tipo: 'error', title: 'Garantia', mnsj: 'El IMEI tiene que tener exactamente 15 digitos' });

  const equipo = equipoPrincipalDelCarrito();
  if (!equipo) return MostrarAlerta({ tipo: 'error', title: 'Garantia', mnsj: 'No hay ningun equipo en el carrito' });

  // Los accesorios del carrito solo se listan en la garantia de
  // Independencia -- en Shopping la garantia sale solo con los datos del
  // equipo. El "Valor de la operacion" de
  // Independencia tambien tiene que incluir lo que suman esos accesorios,
  // no solo el precio del equipo.
  const accesoriosCarrito = sucursalActual === 'Independencia'
    ? carrito.filter(item => item.tipo === 'Accesorio')
    : [];
  const accesorios = accesoriosCarrito.map(item => item.descripcion);
  const totalAccesorios = accesoriosCarrito.reduce((sum, item) => sum + item.precio, 0);

  // Si el IMEI que se cargo corresponde a un equipo que estaba en el
  // deposito (dado de alta antes por Ingreso/Trade-in), se da de baja
  // automatico -- mismo mecanismo que el Egreso manual, con el vendedor
  // logueado en ese momento anotado en la columna Propietario. Si el IMEI
  // no estaba en stock (venta de mostrador sin control) no pasa nada, la
  // garantia se imprime igual. De paso, si ese equipo tenia una falla
  // anotada, se rescata para mostrarla en la garantia (solo Independencia).
  let falla = '';
  try {
    const busqueda = await llamarStockWrite({ accion: 'buscarImei', ultimos4: imei });
    if (busqueda.ok && busqueda.resultados.length === 1) {
      if (sucursalActual === 'Independencia') falla = busqueda.resultados[0].falla || '';
      const sesion = sesionGuardada();
      await llamarStockWrite({
        accion: 'egreso',
        fila: busqueda.resultados[0].fila,
        vendedor: sesion ? sesion.nombre : ''
      });
      await actualizarStockEnVivo();
    }
  } catch (error) {
    // No bloquea la impresion de la garantia si esto falla -- es una
    // mejora, no un requisito para vender.
  }

  // El box de Observacion (solo Independencia) junta 2 avisos distintos,
  // cada uno si corresponde: la falla que tenia el equipo vendido (si el
  // IMEI estaba en stock) y si el cliente entrego OTRO equipo en Trade In
  // como parte de pago de esta misma operacion -- sin mostrar el IMEI de
  // ese equipo entregado, solo el aviso.
  const observaciones = [];
  if (falla) observaciones.push('Falla del equipo: ' + falla);
  const tradeIn = sucursalActual === 'Independencia' ? tradeInDelCarrito() : null;
  if (tradeIn) observaciones.push('El cliente entrego un equipo (' + tradeIn.modelo + ') en Trade In como parte de pago.');

  // Plan canje para la planilla de pagos (pagina 3): a diferencia del aviso
  // de arriba (solo Independencia), esto se muestra en cualquier sucursal
  // si hay un Trade In cargado en el carrito.
  const tradeInCarrito = tradeInDelCarrito();
  const sesion = sesionGuardada();

  await imprimirGarantia({
    sucursal: sucursalActual,
    modelo: equipo.modelo,
    capacidad: equipo.capacidad,
    condicion: equipo.condicion,
    imei, color,
    precio: equipo.precio + totalAccesorios,
    accesorios,
    observaciones,
    vendedor: sesion ? sesion.nombre : '',
    tradeIn: tradeInCarrito ? { modelo: tradeInCarrito.modelo, precio: tradeInCarrito.precio } : null
  });
  CerrarModalGarantia();
}

async function imprimirGarantia(datos) {
  // window.open antes del await del logo -- mismo motivo que en
  // imprimirDeclaracionJurada (si no, el navegador bloquea el popup).
  const ventana = window.open('', '_blank');
  if (!ventana) return MostrarAlerta({ tipo: 'error', title: 'Garantia', mnsj: 'El navegador bloqueo la ventana de impresion -- permiti popups para este sitio' });

  const plantilla = GARANTIA_TEXTOS[datos.sucursal][datos.condicion];
  const logo = await logoBase64(datos.sucursal);
  const encabezadoLogo = logo ? `<img src="${logo}" alt="Jobs Company" style="height:60px; display:block; margin:0 auto 16px;">` : '';
  const fecha = new Date().toLocaleDateString('es-AR');
  const precioUsd = Math.round(datos.precio / DATA.dolar.DolarVenta);
  // La garantia de Shopping no muestra el precio de la operacion
  // (Independencia si).
  const lineaValorOperacion = datos.sucursal === 'Shopping'
    ? ''
    : `<div class="campo"><strong>Valor de la operacion:</strong> ${formatNumberArg(datos.precio)} (USD ${precioUsd})</div>`;

  const boxAccesorios = datos.accesorios.length
    ? `<div class="box"><strong>Accesorios incluidos</strong><ul>${datos.accesorios.map(a => `<li>${a}</li>`).join('')}</ul></div>`
    : '';

  // Independencia: avisos varios (falla del equipo vendido, si el cliente
  // entrego otro equipo en Trade In como parte de pago) -- ver armado de
  // la lista en ConfirmarGarantia. Mismo tratamiento visual que el box de
  // accesorios.
  const boxObservacion = (datos.observaciones && datos.observaciones.length)
    ? `<div class="box"><strong>Observacion</strong>${datos.observaciones.map(o => `<p>${o}</p>`).join('')}</div>`
    : '';

  // Contenido de la garantia en si (paginas 1 y 2 son identicas -- 2 copias,
  // una para el cliente y otra para el local).
  const contenidoGarantia = `
  ${encabezadoLogo}
  <h1>Cordoba, ${fecha}</h1>
  <p>En el dia de hoy recibo de Jobs Company SAS, el equipo que a continuacion se describe:</p>

  <div class="campo"><strong>Marca:</strong> Apple</div>
  <div class="campo"><strong>Modelo:</strong> ${datos.modelo} ${datos.capacidad}</div>
  <div class="campo"><strong>IMEI/Serie:</strong> ${datos.imei}</div>
  <div class="campo"><strong>Color:</strong> ${datos.color}</div>
  ${lineaValorOperacion}

  <p>Dando por entendido, que se entrega en conformidad un equipo en calidad de <strong>${plantilla.condicionTexto}</strong>,
  el cual tiene un perfecto funcionamiento de todos sus componentes.
  El equipo antes mencionado cuenta con ${plantilla.garantiaTexto} a partir de la fecha de compra siempre y cuando,
  los eventuales deterioros se produzcan por hechos no imputables al consumidor. En caso de falla del dispositivo,
  se debera acercar a cualquiera de las sucursales de JobsCompany para hacer valer la garantia.</p>

  <p>La empresa y/o el colaborador no se responsabilizan por la perdida de datos que pudiera ocurrir durante el proceso
  de transferencia de informacion. El cliente es responsable de proporcionar y conservar las credenciales de acceso
  necesarias para realizar dicho procedimiento.</p>

  ${boxObservacion}
  ${boxAccesorios}

  <div class="campo">CUIT: 30-71929577-7</div>

  <div class="firma">
    <div class="linea"></div>
    <strong>FIRMA, ACLARACION, DNI Y NUMERO DE CONTACTO</strong>
  </div>`;

  // Pagina 3: planilla de pagos interna (mismos campos/orden que la
  // plantilla en Excel del negocio). Solo se completan los datos
  // que ya tenemos de la operacion (Fecha, Vendedor, Equipo, GB, precio en
  // USD, cotizacion, pesos y -- si el cliente entrego algo en Trade In --
  // el equipo y la cotizacion del canje); el resto de los campos quedan en
  // blanco para completar a mano en el local.
  const filasPlanilla = [
    ['FECHA', fecha],
    ['VENDEDORES', datos.vendedor || ''],
    ['CLIENTES', ''],
    ['EQUIPO', datos.modelo],
    ['GB', datos.capacidad],
    ['BATERIA', ''],
    ['PRECIO DEL EQUIPO EN USD', 'USD ' + precioUsd],
    ['USD BILLETE', ''],
    ['COTIZACION DE USD', formatNumberArg(DATA.dolar.DolarVenta)],
    ['PESOS', formatNumberArg(datos.precio)],
    ['TRANSFERENCIA EN PESOS', ''],
    ['CUENTA', ''],
    ['TRANSFERENCIA EN USD', ''],
    ['CUENTA', ''],
    ['CREDITO TOTAL', ''],
    ['CANTIDAD DE CUOTAS', ''],
    ['USDT', ''],
    ['CUENTA', ''],
    ['EQUIPO EN PLAN CANJE', datos.tradeIn ? datos.tradeIn.modelo : ''],
    ['COTIZACION DEL CANJE', datos.tradeIn ? formatNumberArg(datos.tradeIn.precio) : '']
  ];
  const contenidoPlanilla = `
  ${encabezadoLogo}
  <h1>Planilla de pagos</h1>
  <table class="planilla">
    ${filasPlanilla.map(([label, valor]) => `<tr><td class="etiqueta">${label}</td><td class="valor">${valor}</td></tr>`).join('')}
  </table>`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Garantia</title>
<style>
  body { font-family: Arial, sans-serif; color: #111; line-height: 1.5; }
  h1 { font-size: 18px; text-align: center; }
  ul { padding-left: 20px; }
  li { margin-bottom: 6px; }
  p { text-align: justify; }
  .campo { margin: 6px 0; }
  .campo strong { display: inline-block; min-width: 140px; }
  .box { border: 1px solid #999; border-radius: 6px; padding: 10px 14px; margin-top: 16px; background: #f7f7f7; }
  .box strong { display: block; margin-bottom: 4px; }
  .box p, .box ul { margin: 4px 0 0; }
  .pagina { max-width: 700px; min-height: 950px; margin: 40px auto; padding-bottom: 40px; display: flex; flex-direction: column; page-break-after: always; }
  .pagina:last-child { page-break-after: auto; }
  .pagina > *:not(.firma) { flex-shrink: 0; }
  .firma { margin-top: auto; padding-top: 40px; }
  .firma .linea { margin-bottom: 6px; border-top: 1px solid #333; width: 300px; }
  .planilla { width: 100%; border-collapse: collapse; margin-top: 20px; }
  .planilla td { border: 1px solid #999; padding: 8px 10px; }
  .planilla td.etiqueta { font-weight: bold; width: 45%; background: #f7f7f7; }
  .planilla td.valor { min-height: 20px; }
</style></head>
<body>
  <div class="pagina">${contenidoGarantia}</div>
  <div class="pagina">${contenidoGarantia}</div>
  <div class="pagina">${contenidoPlanilla}</div>

  <script>window.onload = () => window.print();</script>
</body></html>`;

  ventana.document.write(html);
  ventana.document.close();
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

function TablaFinancia(value, categoria) {
  // Ya NO se pisa value/categoria con el total del carrito -- cada llamado
  // muestra la financiacion de lo que se esta viendo en ese momento (el
  // producto buscado, o el carrito completo cuando llama la pestana
  // Carrito). Antes, si habia algo cargado en el carrito, se mostraba esa
  // financiacion aunque el vendedor estuviera cotizando otra cosa sin
  // agregarla -- confundia al cliente con un numero que no correspondia.
  const filas = DATA.financiacion.filter(f => f.categoria === categoria);
  const table = document.getElementById('tablaResultados');
  table.innerHTML = '';
  infoFinanciacion = '';
  if (!filas.length || value <= 0) { $('#tablaFinancia').removeClass('vista').addClass('oculto'); return; }

  // Los medios de pago de 1 sola cuota sin recargo van todos al mismo valor
  // (interes 0) -- Efectivo se muestra en su propio renglon (con el
  // equivalente en dolares) separado del resto (Debito/QR/Transferencia si
  // los hay), que van agrupados sin dolares.
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
    // precio de Debito/QR/Transferencia.
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
// esta atendiendo.
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
    // cuotas sin interes" (no el de efectivo que se ve en pantalla) --
    // solo cambia lo que se manda por WhatsApp, no el campo en pantalla ni
    // el calculo de la tabla de Financiacion.
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

  // Ingreso/Egreso de stock y Reportes de gestion: solo los ve el admin.
  if (esAdmin(sesion)) {
    document.getElementById('btnCIngresoEgreso').classList.remove('oculto');
    document.getElementById('btnCReportes').classList.remove('oculto');
  }

  document.getElementById('toggleTema').addEventListener('click', toggleTema);

  document.getElementById('btnToggleCarrito').addEventListener('click', Carrito);

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

  document.getElementById('btnStockUsd').addEventListener('click', function () {
    stockPrecioUsd = !stockPrecioUsd;
    this.style.opacity = stockPrecioUsd ? '1' : '0.5';
    actualizarVistaStockCompleto();
    // No forzar actualizarModuloStock si no hay modelo elegido en Venta --
    // eso lo ocultaria (ver guard clause adentro de esa funcion).
    const modeloVenta = $('#formVenta select[name="modeloV"]').val();
    if (modeloVenta) actualizarModuloStock(modeloVenta);
  });
  document.getElementById('btnStockUsd').style.opacity = '0.5';
  document.getElementById('selectStockModelo').addEventListener('change', actualizarVistaStockCompleto);

  document.getElementById('selectTipoOperacion').addEventListener('change', function () {
    const esIngreso = this.value === 'ingreso';
    $('#panelIngreso').toggleClass('oculto', !esIngreso);
    $('#panelEgreso').toggleClass('oculto', esIngreso);
  });
  document.getElementById('btnConfirmarIngreso').addEventListener('click', ConfirmarIngreso);
  document.getElementById('btnBuscarImei').addEventListener('click', BuscarImei);

  document.getElementById('btnImprimirDeclaracion').addEventListener('click', AbrirModalDeclaracion);
  document.getElementById('cerrarModalDeclaracion').addEventListener('click', CerrarModalDeclaracion);
  document.getElementById('btnConfirmarDeclaracion').addEventListener('click', ConfirmarDeclaracionJurada);
  document.getElementById('modalDeclaracionJurada').addEventListener('click', e => {
    if (e.target.id === 'modalDeclaracionJurada') CerrarModalDeclaracion();
  });
  document.getElementById('djImei').addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 15);
  });

  document.getElementById('btnImprimirGarantia').addEventListener('click', AbrirModalGarantia);
  document.getElementById('cerrarModalGarantia').addEventListener('click', CerrarModalGarantia);
  document.getElementById('btnConfirmarGarantia').addEventListener('click', ConfirmarGarantia);
  document.getElementById('modalGarantia').addEventListener('click', e => {
    if (e.target.id === 'modalGarantia') CerrarModalGarantia();
  });
  document.getElementById('gtImei').addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 15);
  });

  // Cada 7 min (antes 5 el dolar, 2 el stock) para gastar menos invocaciones
  // de las funciones de Netlify -- se estaba por quedar sin creditos del
  // plan gratis.
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
        'btnCReportes': () => Reportes(),
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
