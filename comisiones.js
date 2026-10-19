// ============================================================
// CALCULADORA DE COMISIONES.
//
// Tres comisiones por vendedor, todas del mes elegido:
//  - EQUIPOS (individual): cantidad de iPhone vendidos, sale sola de la
//    pestana VentasEquipos de Reportes (la llena la Garantia del cotizador).
//    Escala en USD por equipo.
//  - ACCESORIOS (individual): el admin carga a mano cuanto vendio cada
//    vendedor (dato del informe de comisiones de Cianbox). Escala en % sobre
//    ese monto.
//  - SERVICIO TECNICO (grupal por sucursal): cada vendedor carga el numero
//    de orden de trabajo ("dino 001379"); se suman las ordenes de TODA la
//    sucursal y el escalon alcanzado paga el premio a cada vendedor del grupo.
//
// Lo que se carga a mano se guarda en el Sheet de Reportes (pestanas
// ComisionesAccesorios y ComisionesServicios, ver Comisiones.gs). Las tablas
// de escalas estan todas aca arriba para poder ajustarlas sin tocar la logica.
// ============================================================

// ---------------------------- Sucursales de comision ----------------------------
// Ojo: no son las 2 sucursales del cotizador (Shopping/Independencia) -- el
// Shopping se divide en 3 locales y cada uno tiene su propio grupo de
// servicio tecnico. "prefijo" es lo que va al principio del numero de orden.
const COMISION_SUCURSALES = {
  Dino:          { prefijo: 'dino' },
  NC:            { prefijo: 'nc' },
  Olmos:         { prefijo: 'olmos' },
  Independencia: { prefijo: 'independencia' }
};

// Vendedores por sucursal de comision. "alias" = formas en que puede venir el
// nombre en VentasEquipos / la sesion (se comparan sin tildes ni mayusculas).
const COMISION_VENDEDORES = [
  { nombre: 'Jose',                  sucursal: 'Dino',          alias: ['jose'] },
  { nombre: 'Ivonne',                sucursal: 'Dino',          alias: ['ivonne', 'nora ivonne'] },
  { nombre: 'Cristina',              sucursal: 'Dino',          alias: ['cristina', 'cris', 'cristina blanchard'] },
  { nombre: 'Yoko',                  sucursal: 'NC',            alias: ['yoko'] },
  { nombre: 'Eleazar',               sucursal: 'NC',            alias: ['eleazar', 'ele', 'eleazar alejandro'] },
  { nombre: 'Flor',                  sucursal: 'NC',            alias: ['flor', 'florencia', 'florencia ayelen', 'florencia ayelen de la fuente conti'] },
  { nombre: 'Agustina Manzanelli',   sucursal: 'Olmos',         alias: ['agustina manzanelli', 'agustina manzanellis', 'agus manzanelli', 'manzanelli'] },
  { nombre: 'Agustina Mendoza',      sucursal: 'Olmos',         alias: ['agustina mendoza', 'agus mendoza', 'agustina', 'agus', 'agus m'] },
  { nombre: 'Roxana',                sucursal: 'Olmos',         alias: ['roxana', 'rosana', 'rosana valles', 'ro'] },
  { nombre: 'Ludmi',                 sucursal: 'Independencia', alias: ['ludmi'] },
  { nombre: 'Vicky',                 sucursal: 'Independencia', alias: ['vicky'] }
];

// ---------------------------- Escalas ----------------------------
// Accesorios: % sobre lo vendido en el mes. "desde" = limite inferior
// EXCLUSIVO (el tramo vale cuando el monto es MAYOR a "desde"). El goal 10
// arranca en 12.500.000; lo que queda entre 8.997.000 y 12.500.000 se paga
// como goal 9 (la tabla original tenia un hueco ahi).
const ESCALA_ACCESORIOS = [
  { goal: 0,  desde: -1,       pct: 0 },
  { goal: 1,  desde: 1800000,  pct: 2.50 },
  { goal: 2,  desde: 3086000,  pct: 2.75 },
  { goal: 3,  desde: 3528000,  pct: 3.00 },
  { goal: 4,  desde: 4033000,  pct: 3.25 },
  { goal: 5,  desde: 4610000,  pct: 3.50 },
  { goal: 6,  desde: 5270000,  pct: 3.75 },
  { goal: 7,  desde: 6024000,  pct: 4.00 },
  { goal: 8,  desde: 6886000,  pct: 4.25 },
  { goal: 9,  desde: 7871000,  pct: 4.50 },
  { goal: 10, desde: 12500000, pct: 5.00 }
];

// Equipos: USD por equipo segun cuantos se vendieron en el mes. "desde" =
// cantidad minima del tramo (1 a 5 = 0 usd, 6 a 10 = 10 usd, etc.; el 5, 10,
// 15... pertenece al tramo de abajo). Mas de 70 queda en 24 usd.
const ESCALA_EQUIPOS = [
  { goal: 0, desde: 0,  usd: 0 },
  { goal: 1, desde: 1,  usd: 0 },
  { goal: 2, desde: 6,  usd: 10 },
  { goal: 3, desde: 11, usd: 12 },
  { goal: 4, desde: 16, usd: 14 },
  { goal: 5, desde: 21, usd: 16 },
  { goal: 6, desde: 31, usd: 18 },
  { goal: 7, desde: 41, usd: 20 },
  { goal: 8, desde: 51, usd: 22 },
  { goal: 9, desde: 61, usd: 24 }
];
// 'todos'    = TODOS los equipos del mes se pagan al valor del tramo alcanzado
//              (ej. 12 equipos -> 12 x 12 usd).
// 'marginal' = cada equipo se paga al valor de SU tramo (los primeros 5 a 0,
//              del 6 al 10 a 10, etc.).
const MODO_EQUIPOS = 'todos';

// Servicio tecnico: premio en pesos por escalon, segun cuantas ordenes sumo
// la sucursal en el mes. Cada vendedor del grupo cobra el monto completo.
const ESCALA_SERVICIO = [
  { goal: 0, desde: 0,  nombre: 'Sin escalon',        premio: 0 },
  { goal: 1, desde: 10, nombre: 'Escalon Jugando',    premio: 50000 },
  { goal: 2, desde: 20, nombre: 'Escalon Calentando', premio: 75000 },
  { goal: 3, desde: 30, nombre: 'Escalon de Primera', premio: 100000 },
  { goal: 4, desde: 40, nombre: 'Escalon Brillando',  premio: 125000 }
];

// Cortes del mes para cargar/comparar accesorios: cada lunes el admin sube el
// acumulado del mes y lo guarda en el corte que corresponde. El corte 4 es el
// mes completo (y es el que se usa para pagar si no hay otro mas nuevo).
const COMISION_CORTES = [
  { n: 1, hastaDia: 7,  nombre: 'Corte 1 (hasta el 7)' },
  { n: 2, hastaDia: 14, nombre: 'Corte 2 (hasta el 14)' },
  { n: 3, hastaDia: 21, nombre: 'Corte 3 (hasta el 21)' },
  { n: 4, hastaDia: 31, nombre: 'Corte 4 (fin de mes)' }
];

// ---------------------------- Calculos (puros) ----------------------------

function comNormalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Nombre tal cual viene (VentasEquipos, sesion, Cianbox) -> vendedor del roster, o null.
function comVendedorDe(nombre) {
  const n = comNormalizar(nombre);
  if (!n) return null;
  return COMISION_VENDEDORES.find(v => comNormalizar(v.nombre) === n || v.alias.indexOf(n) !== -1) || null;
}

function comTramoMayorA(escala, valor) {
  // Ultimo tramo cuyo "desde" es MENOR al valor (limite inferior exclusivo).
  let actual = escala[0];
  escala.forEach(t => { if (valor > t.desde) actual = t; });
  return actual;
}

function comTramoDesdeIgual(escala, valor) {
  // Ultimo tramo cuyo "desde" es MENOR O IGUAL al valor (limite inferior inclusivo).
  let actual = escala[0];
  escala.forEach(t => { if (valor >= t.desde) actual = t; });
  return actual;
}

function comisionAccesorios(monto) {
  const m = Math.max(0, Number(monto) || 0);
  const tramo = comTramoMayorA(ESCALA_ACCESORIOS, m);
  const siguiente = ESCALA_ACCESORIOS.find(t => t.goal === tramo.goal + 1) || null;
  return {
    monto: m, goal: tramo.goal, pct: tramo.pct,
    comision: Math.round(m * tramo.pct / 100),
    proximo: siguiente ? { goal: siguiente.goal, pct: siguiente.pct, faltan: siguiente.desde + 1 - m } : null
  };
}

function comisionEquipos(cantidad) {
  const n = Math.max(0, Math.floor(Number(cantidad) || 0));
  const tramo = comTramoDesdeIgual(ESCALA_EQUIPOS, n);
  const siguiente = ESCALA_EQUIPOS.find(t => t.goal === tramo.goal + 1) || null;
  let usd = 0;
  if (MODO_EQUIPOS === 'marginal') {
    for (let i = 1; i <= n; i++) usd += comTramoDesdeIgual(ESCALA_EQUIPOS, i).usd;
  } else {
    usd = n * tramo.usd;
  }
  return {
    cantidad: n, goal: tramo.goal, usdPorEquipo: tramo.usd, usd,
    proximo: siguiente ? { goal: siguiente.goal, usdPorEquipo: siguiente.usd, faltan: siguiente.desde - n } : null
  };
}

function comisionServicio(cantidadGrupo) {
  const n = Math.max(0, Math.floor(Number(cantidadGrupo) || 0));
  const tramo = comTramoDesdeIgual(ESCALA_SERVICIO, n);
  const siguiente = ESCALA_SERVICIO.find(t => t.goal === tramo.goal + 1) || null;
  return {
    cantidad: n, goal: tramo.goal, nombre: tramo.nombre, premio: tramo.premio,
    proximo: siguiente ? { nombre: siguiente.nombre, premio: siguiente.premio, faltan: siguiente.desde - n } : null
  };
}

// ---------------------------- Fechas y numeros ----------------------------

function comMesActual() {
  const h = new Date();
  return h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0');
}

// "19/10/2026", "2026-10-19", "2026-10-19T..." o Date -> "2026-10" (o '').
function comMesDeFecha(valor) {
  if (valor instanceof Date) return valor.getFullYear() + '-' + String(valor.getMonth() + 1).padStart(2, '0');
  const s = String(valor || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0');
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0');
  return '';
}

// Dia del mes de "19/10/2026", "2026-10-19" o Date (0 si no se puede leer).
function comDiaDeFecha(valor) {
  if (valor instanceof Date) return valor.getDate();
  const s = String(valor || '').trim();
  let m = s.match(/^\d{4}-\d{1,2}-(\d{1,2})/);
  if (m) return Number(m[1]);
  m = s.match(/^(\d{1,2})\/\d{1,2}\/\d{4}/);
  return m ? Number(m[1]) : 0;
}

function comMesAnterior(mes) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// Corte que corresponde "hoy": en el mes en curso segun el dia; en meses
// cerrados, el 4 (mes completo).
function comCorteDeHoy(mes) {
  if (mes !== comMesActual()) return 4;
  const dia = new Date().getDate();
  return dia <= 7 ? 1 : dia <= 14 ? 2 : dia <= 21 ? 3 : 4;
}

// Ultimo dia que cuenta para comparar: el final del corte, pero en el mes en
// curso nunca mas alla de hoy (asi se compara el mismo tramo del mes anterior).
function comDiaTope(mes, corte) {
  const tope = COMISION_CORTES.find(c => c.n === corte).hastaDia;
  return mes === comMesActual() ? Math.min(tope, new Date().getDate()) : tope;
}

// Variacion porcentual: { pct, texto, clase }. Sin dato si falta el mes anterior o es 0.
function comVariacion(actual, previo) {
  if (previo == null || actual == null || !(previo > 0)) return { pct: null, texto: 'sin dato', clase: 'sd' };
  const pct = Math.round((actual - previo) * 100 / previo);
  return { pct, texto: (pct > 0 ? '+' : '') + pct + '%', clase: pct > 0 ? 'sube' : pct < 0 ? 'baja' : 'igual' };
}

// "2.575.455,57" / "2575455.57" / 2575455 -> numero.
function comNumero(valor) {
  if (typeof valor === 'number') return valor;
  let s = String(valor == null ? '' : valor).replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  const ultimaComa = s.lastIndexOf(','), ultimoPunto = s.lastIndexOf('.');
  if (ultimaComa > -1 && ultimoPunto > -1) {
    s = ultimaComa > ultimoPunto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (ultimaComa > -1) {
    s = s.replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  return Number(s) || 0;
}

function comNombreMes(mes) {
  const [y, m] = mes.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
}

function comPesos(n) { return formatNumberArg(Math.round(n)); }

function comEsc(texto) {
  return String(texto == null ? '' : texto).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Numero de orden: "dino 001379" / "DINO001379" / "Dino-1379" -> "DINO 001379".
// El prefijo tiene que ser el de la sucursal del vendedor (es lo que despues
// permite cruzar la orden con el sistema de servicio tecnico).
function comNormalizarOrden(texto, sucursal) {
  const m = String(texto || '').trim().match(/^([a-zA-Z]+)[\s\-_.]*(\d{3,})$/);
  if (!m) return { ok: false, error: 'Escribi la orden como sucursal + numero, ej. ' + COMISION_SUCURSALES[sucursal].prefijo + ' 001379' };
  const prefijo = m[1].toLowerCase();
  if (prefijo !== COMISION_SUCURSALES[sucursal].prefijo) {
    return { ok: false, error: 'El prefijo de la orden tiene que ser "' + COMISION_SUCURSALES[sucursal].prefijo + '" (sucursal ' + sucursal + ')' };
  }
  return { ok: true, orden: m[1].toUpperCase() + ' ' + m[2] };
}

// ---------------------------- Datos (Sheet de Reportes) ----------------------------

let comDatos = { equipos: [], accesorios: [], servicios: [] };
let comInicializado = false;

async function comLeerHoja(tipo, encabezadoEsperado) {
  const resp = await fetch('/reportes/' + tipo);
  const json = await resp.json();
  if (json.error) throw new Error(json.error);
  // Si la pestana todavia no existe, Google devuelve la primera hoja del
  // libro en su lugar -- se detecta porque no estan las columnas esperadas.
  if (json.encabezados.indexOf(encabezadoEsperado) === -1) return [];
  return filasAObjetos(json.encabezados, json.filas);
}

async function comCargarDatos() {
  const [equipos, accesorios, servicios] = await Promise.all([
    comLeerHoja('VentasEquipos', 'Imei').catch(e => { comAvisarError('VentasEquipos', e); return []; }),
    comLeerHoja('ComisionesAccesorios', 'Monto').catch(e => { comAvisarError('ComisionesAccesorios', e); return []; }),
    comLeerHoja('ComisionesServicios', 'Orden').catch(e => { comAvisarError('ComisionesServicios', e); return []; })
  ]);
  comDatos = { equipos, accesorios, servicios };
}

let comErrorMostrado = false;
function comAvisarError(hoja, error) {
  if (comErrorMostrado) return;
  comErrorMostrado = true;
  MostrarAlerta({ tipo: 'warning', title: 'Comisiones', mnsj: 'No se pudo leer ' + hoja + ': ' + (error.message || error) });
}

// Arma el calculo completo de todos los vendedores para un mes.
function comCalcularMes(mes, corte) {
  corte = corte || comCorteDeHoy(mes);
  const porVendedor = {};
  COMISION_VENDEDORES.forEach(v => { porVendedor[v.nombre] = { vendedor: v, equiposRows: 0, accesorios: 0, ordenes: [] }; });

  // Equipos: solo iPhone, del mes, sin contar dos veces el mismo IMEI.
  const imeisVistos = {};
  comDatos.equipos.forEach(f => {
    if (!esTelefono(f.Modelo)) return;
    if (comMesDeFecha(f.Fecha) !== mes) return;
    const v = comVendedorDe(f.Vendedor);
    if (!v) return;
    const imei = String(f.Imei || '').trim();
    if (imei) { if (imeisVistos[imei]) return; imeisVistos[imei] = true; }
    porVendedor[v.nombre].equiposRows++;
  });

  // Accesorios: para pagar vale el ULTIMO corte cargado del mes (el acumulado
  // mas nuevo). Las filas viejas sin corte cuentan como corte 4 (mes completo).
  const corteVisto = {};
  comDatos.accesorios.forEach(f => {
    if (comMesDeFecha(f.Mes) !== mes) return;
    const v = comVendedorDe(f.Vendedor);
    if (!v) return;
    const c = Number(f.Corte) || 4;
    if (c >= (corteVisto[v.nombre] || 0)) { corteVisto[v.nombre] = c; porVendedor[v.nombre].accesorios = comNumero(f.Monto); }
  });

  // Servicio tecnico: ordenes del mes, sin repetir el numero de orden.
  const ordenesVistas = {};
  const ordenesPorSucursal = {};
  Object.keys(COMISION_SUCURSALES).forEach(s => { ordenesPorSucursal[s] = []; });
  comDatos.servicios.forEach(f => {
    if (comMesDeFecha(f.Mes) !== mes) return;
    const v = comVendedorDe(f.Vendedor);
    const orden = String(f.Orden || '').trim().toUpperCase();
    if (!v || !orden || ordenesVistas[orden]) return;
    ordenesVistas[orden] = true;
    const fila = { id: f.Id, orden, vendedor: v.nombre, sucursal: v.sucursal, fecha: f.Fecha };
    porVendedor[v.nombre].ordenes.push(fila);
    ordenesPorSucursal[v.sucursal].push(fila);
  });

  const servicioPorSucursal = {};
  Object.keys(ordenesPorSucursal).forEach(s => { servicioPorSucursal[s] = comisionServicio(ordenesPorSucursal[s].length); });

  // Comparativa contra el mes anterior (solo la ve el admin), mismo tramo de dias.
  const dia = comDiaTope(mes, corte);
  const mesPrev = comMesAnterior(mes);
  const eqAct = comEquiposPorVendedor(mes, dia), eqPrev = comEquiposPorVendedor(mesPrev, dia);
  const stAct = comOrdenesPorVendedor(mes, dia), stPrev = comOrdenesPorVendedor(mesPrev, dia);
  const accAct = comAccesoriosAlCorte(mes, corte), accPrev = comAccesoriosAlCorte(mesPrev, corte);

  const grupoCant = (m, d) => {
    const r = {};
    Object.keys(COMISION_SUCURSALES).forEach(s => { r[s] = 0; });
    COMISION_VENDEDORES.forEach(v => { r[v.sucursal] += (comOrdenesPorVendedor(m, d)[v.nombre] || 0); });
    return r;
  };
  const grupoAct = grupoCant(mes, dia), grupoPrev = grupoCant(mesPrev, dia);
  const variacionGrupo = {};
  Object.keys(grupoAct).forEach(s => { variacionGrupo[s] = comVariacion(grupoAct[s], grupoPrev[s]); });

  const dolar = (DATA.dolar && Number(DATA.dolar.DolarVenta)) || 0;
  const filas = COMISION_VENDEDORES.map(v => {
    const d = porVendedor[v.nombre];
    const equipos = comisionEquipos(d.equiposRows);
    const accesorios = comisionAccesorios(d.accesorios);
    const servicio = servicioPorSucursal[v.sucursal];
    const equiposArs = equipos.usd * dolar;
    const n = v.nombre;
    return {
      vendedor: v, equipos, accesorios, servicio, ordenes: d.ordenes, equiposArs,
      accCorte: accAct[n] == null ? null : accAct[n],
      variacion: {
        equipos: comVariacion(eqAct[n] || 0, eqPrev[n] || 0),
        accesorios: comVariacion(accAct[n], accPrev[n]),
        servicio: comVariacion(stAct[n] || 0, stPrev[n] || 0)
      },
      totalArs: equiposArs + accesorios.comision + servicio.premio
    };
  });
  return { mes, corte, dia, mesPrev, dolar, filas, ordenesPorSucursal, servicioPorSucursal, variacionGrupo };
}

// iPhone vendidos por vendedor en un mes, hasta cierto dia (sin repetir IMEI).
function comEquiposPorVendedor(mes, dia) {
  const r = {}, vistos = {};
  comDatos.equipos.forEach(f => {
    if (!esTelefono(f.Modelo) || comMesDeFecha(f.Fecha) !== mes || comDiaDeFecha(f.Fecha) > dia) return;
    const v = comVendedorDe(f.Vendedor);
    if (!v) return;
    const imei = String(f.Imei || '').trim();
    if (imei) { if (vistos[imei]) return; vistos[imei] = true; }
    r[v.nombre] = (r[v.nombre] || 0) + 1;
  });
  return r;
}

// Ordenes de servicio tecnico por vendedor en un mes, hasta cierto dia.
function comOrdenesPorVendedor(mes, dia) {
  const r = {}, vistas = {};
  comDatos.servicios.forEach(f => {
    if (comMesDeFecha(f.Mes) !== mes || comDiaDeFecha(f.Fecha) > dia) return;
    const v = comVendedorDe(f.Vendedor);
    const orden = String(f.Orden || '').trim().toUpperCase();
    if (!v || !orden || vistas[orden]) return;
    vistas[orden] = true;
    r[v.nombre] = (r[v.nombre] || 0) + 1;
  });
  return r;
}

// Monto de accesorios cargado EXACTAMENTE en ese corte (undefined si no hay).
// Las filas viejas sin corte cuentan como corte 4.
function comAccesoriosAlCorte(mes, corte) {
  const r = {};
  comDatos.accesorios.forEach(f => {
    if (comMesDeFecha(f.Mes) !== mes || (Number(f.Corte) || 4) !== corte) return;
    const v = comVendedorDe(f.Vendedor);
    if (v) r[v.nombre] = comNumero(f.Monto);
  });
  return r;
}

// ---------------------------- Escritura ----------------------------

async function comGuardarAccesorios(mes, vendedor, monto, corte) {
  const sesion = sesionGuardada();
  const resp = await llamarReportesWrite({
    accion: 'comision-accesorios-guardar', mes, vendedor, monto, corte,
    cargadoPor: sesion ? sesion.nombre : ''
  });
  if (!resp.ok) throw new Error(resp.error || 'Error desconocido');
}

async function comAgregarOrden(mes, vendedor, sucursal, orden) {
  const sesion = sesionGuardada();
  const ahora = new Date();
  const resp = await llamarReportesWrite({
    accion: 'comision-servicio-crear', mes, vendedor, sucursal, orden,
    fecha: ahora.toLocaleDateString('es-AR'), hora: ahora.toLocaleTimeString('es-AR'),
    cargadoPor: sesion ? sesion.nombre : ''
  });
  if (!resp.ok) throw new Error(resp.error || 'Error desconocido');
}

async function comEliminarOrden(id) {
  const resp = await llamarReportesWrite({ accion: 'comision-servicio-eliminar', id });
  if (!resp.ok) throw new Error(resp.error || 'Error desconocido');
}

// ---------------------------- Pantalla ----------------------------

function comSesionEsAdmin() { return esAdmin(sesionGuardada()); }

// Vendedor del roster que corresponde a quien esta logueado (null si es admin
// o si el usuario no figura en el roster).
function comVendedorLogueado() {
  const sesion = sesionGuardada();
  return sesion ? comVendedorDe(sesion.nombre) : null;
}

async function iniciarComisiones() {
  const admin = comSesionEsAdmin();
  if (!comInicializado) {
    comInicializado = true;
    const selMes = document.getElementById('comMes');
    selMes.value = comMesActual();
    selMes.addEventListener('change', () => { document.getElementById('comCorte').value = String(comCorteDeHoy(selMes.value || comMesActual())); comRender(); });
    document.getElementById('comCorte').addEventListener('change', () => comRender());
    document.getElementById('comVendedor').addEventListener('change', () => comRender());
    document.getElementById('comRefrescar').addEventListener('click', comRefrescar);
    document.getElementById('vistaComisiones').addEventListener('click', comClickDelegado);
    document.getElementById('vistaComisiones').addEventListener('change', comChangeDelegado);
    document.getElementById('vistaComisiones').addEventListener('submit', e => { e.preventDefault(); });
  }

  const selV = document.getElementById('comVendedor');
  selV.innerHTML = '';
  if (admin) {
    selV.appendChild(new Option('Todos los vendedores', ''));
    COMISION_VENDEDORES.forEach(v => selV.appendChild(new Option(v.nombre + ' (' + v.sucursal + ')', v.nombre)));
  } else {
    const yo = comVendedorLogueado();
    if (yo) selV.appendChild(new Option(yo.nombre + ' (' + yo.sucursal + ')', yo.nombre));
  }
  document.getElementById('comFiltroVendedor').classList.toggle('oculto', !admin);
  document.getElementById('comFiltroCorte').classList.toggle('oculto', !admin);
  const selC = document.getElementById('comCorte');
  if (!selC.options.length) COMISION_CORTES.forEach(c => selC.appendChild(new Option(c.nombre, String(c.n))));
  selC.value = String(comCorteDeHoy(document.getElementById('comMes').value || comMesActual()));
  await comRefrescar();
}

async function comRefrescar() {
  comErrorMostrado = false;
  document.getElementById('comContenido').innerHTML = '<p class="sm-t">Cargando...</p>';
  await comCargarDatos();
  comRender();
}

// Porcentaje vs. mes anterior (solo admin). Va chiquito al lado del dato.
function comDeltaHtml(v) {
  return ' <span class="com-delta ' + v.clase + '" title="Contra el mismo tramo del mes anterior">' + comEsc(v.texto) + '</span>';
}

function comBarraProgreso(actual, meta, texto) {
  const pct = meta > 0 ? Math.min(100, Math.round(actual * 100 / meta)) : 100;
  return '<div class="com-barra"><div class="com-barra-fill" style="width:' + pct + '%"></div></div><div class="sm-t">' + comEsc(texto) + '</div>';
}

function comRender() {
  const mes = document.getElementById('comMes').value || comMesActual();
  const admin = comSesionEsAdmin();
  const corte = Number(document.getElementById('comCorte').value) || comCorteDeHoy(mes);
  const calculo = comCalcularMes(mes, corte);
  const cont = document.getElementById('comContenido');

  let elegido = document.getElementById('comVendedor').value;
  if (!admin) {
    const yo = comVendedorLogueado();
    if (!yo) {
      cont.innerHTML = '<p class="sm-t">Tu usuario no figura en la lista de vendedores con comision. Avisale al administrador.</p>';
      return;
    }
    elegido = yo.nombre;
  }

  const dolarTxt = calculo.dolar ? 'Dolar de referencia: ' + formatNumberArg(calculo.dolar) : 'No hay cotizacion del dolar: los USD no se convierten a pesos.';
  let html = '<p class="sm-t">' + comEsc(comNombreMes(mes)) + ' &middot; ' + comEsc(dolarTxt) + '</p>';
  html += elegido ? comHtmlDetalle(calculo, elegido, admin) : comHtmlResumen(calculo);
  cont.innerHTML = html;
}

// Tabla de todos los vendedores (solo admin). El monto de accesorios se carga aca.
function comHtmlResumen(calculo) {
  let totalGeneral = 0;
  const filas = calculo.filas.map(f => {
    totalGeneral += f.totalArs;
    return '<tr>' +
      '<td><a href="#" data-com-ver="' + comEsc(f.vendedor.nombre) + '">' + comEsc(f.vendedor.nombre) + '</a></td>' +
      '<td>' + comEsc(f.vendedor.sucursal) + '</td>' +
      '<td>' + f.equipos.cantidad + comDeltaHtml(f.variacion.equipos) + '</td>' +
      '<td>' + (f.equipos.usd ? formatNumberUsd(f.equipos.usd) : '-') + '</td>' +
      '<td><input type="text" inputmode="decimal" class="com-input-monto" data-com-acc="' + comEsc(f.vendedor.nombre) + '" value="' + (f.accCorte != null ? comEsc(Math.round(f.accCorte)) : '') + '" placeholder="$0" autocomplete="off">' + comDeltaHtml(f.variacion.accesorios) + '</td>' +
      '<td>' + f.accesorios.pct.toLocaleString('es-AR') + '% &middot; ' + comPesos(f.accesorios.comision) + '</td>' +
      '<td>' + f.ordenes.length + comDeltaHtml(f.variacion.servicio) + '</td>' +
      '<td><strong>' + comPesos(f.totalArs) + '</strong></td>' +
    '</tr>';
  }).join('');

  const grupos = Object.keys(COMISION_SUCURSALES).map(s => {
    const sv = calculo.servicioPorSucursal[s];
    return '<li><strong>' + comEsc(s) + '</strong>: ' + sv.cantidad + comDeltaHtml(calculo.variacionGrupo[s]) + ' servicios &rarr; ' + comEsc(sv.nombre) + (sv.premio ? ' (' + comPesos(sv.premio) + ' c/u)' : '') + '</li>';
  }).join('');

  return '<div class="table-responsive"><table class="table2"><thead><tr>' +
      '<th>Vendedor</th><th>Sucursal</th><th>Equipos</th><th>USD equipos</th><th>Accesorios acumulados al corte ' + calculo.corte + ' ($)</th><th>Comision accesorios (ultimo corte)</th><th>Servicios</th><th>Total ($)</th>' +
    '</tr></thead><tbody>' + filas + '</tbody>' +
    '<tfoot><tr><td colspan="7"><strong>Total a pagar</strong></td><td><strong>' + comPesos(totalGeneral) + '</strong></td></tr></tfoot></table></div>' +
    '<p class="sm-t">El acumulado de accesorios se guarda en el corte elegido al salir del casillero; la comision se calcula con el ultimo corte cargado. Los porcentajes comparan contra el mismo tramo de ' + comEsc(comNombreMes(calculo.mesPrev)) + ' (dias 1 al ' + calculo.dia + '). Tocá un vendedor para ver el detalle.</p>' +
    '<p class="sm-t">Ojo con los equipos: solo cuentan desde que se registran en la Garantia, asi que en los primeros meses el porcentaje puede no ser confiable.</p>' +
    '<h4 class="com-sub">Servicio tecnico por sucursal</h4><ul class="com-lista">' + grupos + '</ul>';
}

function comHtmlDetalle(calculo, nombre, admin) {
  const f = calculo.filas.find(x => x.vendedor.nombre === nombre);
  if (!f) return '';
  const s = f.vendedor.sucursal;
  const ordenesGrupo = calculo.ordenesPorSucursal[s];

  // --- Equipos
  const e = f.equipos;
  let htmlEquipos = '<div class="com-cifra">' + e.cantidad + ' equipos' + (admin ? comDeltaHtml(f.variacion.equipos) : '') + '</div>' +
    '<div class="sm-t">Goal ' + e.goal + ' &middot; ' + formatNumberUsd(e.usdPorEquipo) + ' por equipo</div>' +
    '<div class="com-total">' + formatNumberUsd(e.usd) + (calculo.dolar ? ' <span class="sm-t">&asymp; ' + comPesos(f.equiposArs) + '</span>' : '') + '</div>';
  if (e.proximo) {
    htmlEquipos += comBarraProgreso(e.cantidad, e.cantidad + e.proximo.faltan, 'Faltan ' + e.proximo.faltan + ' equipos para goal ' + e.proximo.goal + ' (' + formatNumberUsd(e.proximo.usdPorEquipo) + ' por equipo)');
  }

  // --- Accesorios
  const a = f.accesorios;
  let htmlAcc = '<div class="com-cifra">' + comPesos(a.monto) + '</div>' +
    (admin ? '<div class="sm-t">Corte ' + calculo.corte + ': ' + (f.accCorte != null ? comPesos(f.accCorte) : 'sin cargar') + comDeltaHtml(f.variacion.accesorios) + '</div>' : '') +
    '<div class="sm-t">Goal ' + a.goal + ' &middot; ' + a.pct.toLocaleString('es-AR') + '%</div>' +
    '<div class="com-total">' + comPesos(a.comision) + '</div>';
  if (a.proximo) {
    htmlAcc += comBarraProgreso(a.monto, a.monto + a.proximo.faltan, 'Faltan ' + comPesos(a.proximo.faltan) + ' para goal ' + a.proximo.goal + ' (' + a.proximo.pct.toLocaleString('es-AR') + '%)');
  }
  if (admin) {
    htmlAcc += '<div class="form-group-total" style="margin-top:10px;"><label>Acumulado al corte ' + calculo.corte + ' ($)</label>' +
      '<input type="text" inputmode="decimal" class="com-input-monto" data-com-acc="' + comEsc(nombre) + '" value="' + (f.accCorte != null ? comEsc(Math.round(f.accCorte)) : '') + '" placeholder="$0" autocomplete="off"></div>';
  }

  // --- Servicio tecnico (grupal)
  const sv = f.servicio;
  let htmlSt = '<div class="com-cifra">' + sv.cantidad + ' servicios de ' + comEsc(s) + (admin ? comDeltaHtml(calculo.variacionGrupo[s]) : '') + '</div>' +
    (admin ? '<div class="sm-t">Cargadas por ' + comEsc(nombre) + ': ' + f.ordenes.length + comDeltaHtml(f.variacion.servicio) + '</div>' : '') +
    '<div class="sm-t">' + comEsc(sv.nombre) + ' &middot; premio grupal</div>' +
    '<div class="com-total">' + comPesos(sv.premio) + '</div>';
  if (sv.proximo) {
    htmlSt += comBarraProgreso(sv.cantidad, sv.cantidad + sv.proximo.faltan, 'Faltan ' + sv.proximo.faltan + ' servicios para ' + sv.proximo.nombre + ' (' + comPesos(sv.proximo.premio) + ')');
  }
  htmlSt += '<form class="com-orden-form"><div class="form-group-total"><label>Cargar orden de trabajo</label>' +
    '<div style="display:flex; gap:8px;"><input type="text" id="comOrden" placeholder="Ej. ' + comEsc(COMISION_SUCURSALES[s].prefijo) + ' 001379" autocomplete="off" style="flex:1;">' +
    '<button type="button" class="btn-total" data-com-agregar-orden="' + comEsc(nombre) + '" style="width:auto; margin:0; padding:0 16px;">Agregar</button></div></div></form>';

  const ordenesMias = f.ordenes;
  htmlSt += ordenesMias.length
    ? '<div class="table-responsive"><table class="table2"><thead><tr><th>Orden</th><th>Fecha</th><th></th></tr></thead><tbody>' +
      ordenesMias.map(o => '<tr><td>' + comEsc(o.orden) + '</td><td>' + comEsc(o.fecha) + '</td><td>' +
        (admin && o.id ? '<i class="fas fa-trash" style="cursor:pointer;" data-com-borrar-orden="' + comEsc(o.id) + '" title="Eliminar orden"></i>' : '') + '</td></tr>').join('') +
      '</tbody></table></div>'
    : '<p class="sm-t">Todavia no cargaste ordenes este mes.</p>';
  htmlSt += '<p class="sm-t">Entre toda la sucursal ' + comEsc(s) + ' van ' + ordenesGrupo.length + ' ordenes este mes.</p>';

  const dolarOk = calculo.dolar > 0;
  const html = '<div class="com-tarjetas">' +
    '<div class="com-tarjeta"><h4 class="com-sub">Equipos</h4>' + htmlEquipos + '</div>' +
    '<div class="com-tarjeta"><h4 class="com-sub">Accesorios</h4>' + htmlAcc + '</div>' +
    '<div class="com-tarjeta"><h4 class="com-sub">Servicio tecnico</h4>' + htmlSt + '</div>' +
  '</div>' +
  '<div class="com-gran-total"><span>Total a cobrar - ' + comEsc(nombre) + '</span><strong>' + comPesos(f.totalArs) + '</strong>' +
    (dolarOk ? '' : '<span class="sm-t"> (sin los USD de equipos: falta el dolar)</span>') + '</div>' +
  (admin ? '<p class="sm-t"><a href="#" data-com-ver="">&larr; Volver a todos</a></p>' : '');
  return html;
}

function comClickDelegado(e) {
  const ver = e.target.closest('[data-com-ver]');
  if (ver) {
    e.preventDefault();
    document.getElementById('comVendedor').value = ver.dataset.comVer;
    comRender();
    return;
  }
  const agregar = e.target.closest('[data-com-agregar-orden]');
  if (agregar) { comOnAgregarOrden(agregar.dataset.comAgregarOrden); return; }
  const borrar = e.target.closest('[data-com-borrar-orden]');
  if (borrar) { comOnBorrarOrden(borrar.dataset.comBorrarOrden); }
}

function comChangeDelegado(e) {
  const input = e.target.closest('[data-com-acc]');
  if (input) comOnGuardarAccesorios(input.dataset.comAcc, input.value, input);
}

async function comOnGuardarAccesorios(nombre, texto, input) {
  const mes = document.getElementById('comMes').value || comMesActual();
  const monto = comNumero(texto);
  const corte = Number(document.getElementById('comCorte').value) || comCorteDeHoy(mes);
  try {
    input.disabled = true;
    await comGuardarAccesorios(mes, nombre, monto, corte);
    comDatos.accesorios.push({ Mes: mes, Vendedor: nombre, Monto: monto, Corte: corte });
    MostrarAlerta({ tipo: 'success', title: 'Comisiones', mnsj: 'Accesorios de ' + nombre + ' guardado' });
  } catch (error) {
    MostrarAlerta({ tipo: 'error', title: 'Comisiones', mnsj: 'No se pudo guardar: ' + error.message });
  }
  comRender();
}

async function comOnAgregarOrden(nombre) {
  const v = comVendedorDe(nombre);
  const mes = document.getElementById('comMes').value || comMesActual();
  const r = comNormalizarOrden(document.getElementById('comOrden').value, v.sucursal);
  if (!r.ok) return MostrarAlerta({ tipo: 'error', title: 'Servicio tecnico', mnsj: r.error });
  const yaExiste = comDatos.servicios.some(f => String(f.Orden || '').trim().toUpperCase() === r.orden);
  if (yaExiste) return MostrarAlerta({ tipo: 'error', title: 'Servicio tecnico', mnsj: 'La orden ' + r.orden + ' ya esta cargada' });
  try {
    await comAgregarOrden(mes, v.nombre, v.sucursal, r.orden);
    MostrarAlerta({ tipo: 'success', title: 'Servicio tecnico', mnsj: 'Orden ' + r.orden + ' cargada' });
    await comRefrescar();
  } catch (error) {
    MostrarAlerta({ tipo: 'error', title: 'Servicio tecnico', mnsj: 'No se pudo cargar la orden: ' + error.message });
  }
}

async function comOnBorrarOrden(id) {
  if (!confirm('Eliminar esta orden?')) return;
  try {
    await comEliminarOrden(id);
    await comRefrescar();
  } catch (error) {
    MostrarAlerta({ tipo: 'error', title: 'Servicio tecnico', mnsj: 'No se pudo eliminar: ' + error.message });
  }
}
