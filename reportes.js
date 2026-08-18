// ============================================================
// REPORTES DE GESTION (solo admin).
//
// Flujo: el admin arrastra/pega los 4 exports de Cianbox (Libro IVA
// Ventas, Informe de Ventas por Producto x2 -- mes actual y mes anterior
// -- e Informe de Stock) en las zonas de drag&drop. Se parsean 100% en el
// navegador con SheetJS (no se sube el archivo a ningun lado tal cual,
// solo las filas ya extraidas) y se mandan a /reportes-write, que las
// guarda en una pestana del Sheet de Reportes (reemplazando el contenido
// entero -- ver Reportes.gs). Despues se leen de vuelta via /reportes/:tipo
// (mismo mecanismo que /stock) y toda la logica de negocio (run-rate, top
// productos, alertas de stock, tendencias semanales) se calcula aca, en
// JS, para que quede versionada como el resto de la app.
//
// El dashboard se actualiza solo con lo que ya este guardado en el Sheet
// -- no hace falta volver a subir los 4 archivos cada vez que se abre la
// pestana, solo cuando cambian los datos (1 vez por semana, a mano).
// ============================================================

// Vendedor (nombre tal cual aparece en el Libro IVA Ventas de Cianbox) ->
// sucursal. Cianbox no tiene una columna de sucursal en ese reporte, asi
// que se arma manualmente -- confirmado por el usuario. "Tio Jobs",
// "Independencia" y "Deposito" son las formas en que puede aparecer la
// venta de Independencia (no siempre hay un vendedor de carne y hueso
// asociado). Cualquier nombre que no este en esta lista cae en "Sin
// asignar" (se cuenta en los totales generales pero no en Ventas x
// Sucursal, para no adivinar mal).
const VENDEDOR_A_SUCURSAL = {
  'yoko': 'Shopping',
  'cristina': 'Shopping',
  'nora ivonne': 'Shopping',
  'beverlys naileth': 'Shopping',
  'florencia ayelen': 'Shopping',
  'agus m': 'Shopping',
  'agustina': 'Shopping',
  'eleazar alejandro': 'Shopping',
  'rosana valles': 'Shopping',
  'felipe': 'Shopping',
  'tio jobs': 'Independencia',
  'independencia': 'Independencia',
  'deposito': 'Independencia'
};

function sucursalDeVendedor(vendedor) {
  const key = String(vendedor || '').trim().toLowerCase();
  return VENDEDOR_A_SUCURSAL[key] || 'Sin asignar';
}

// ============================ CARGA (drag&drop + SheetJS) ============================

let reportesInicializado = false;
let cacheReportes = { Ventas: null, VentasProducto: null, VentasProductoAnterior: null, Stock: null };

function iniciarReportes() {
  if (!reportesInicializado) {
    reportesInicializado = true;
    ['Ventas', 'VentasProducto', 'VentasProductoAnterior', 'Stock'].forEach(tipo => {
      const drop = document.getElementById('drop' + tipo);
      const input = document.getElementById('file' + tipo);
      drop.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        if (input.files[0]) subirReporte(tipo, input.files[0]);
      });
      drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('reporte-drop-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('reporte-drop-over'));
      drop.addEventListener('drop', e => {
        e.preventDefault();
        drop.classList.remove('reporte-drop-over');
        const archivo = e.dataTransfer.files[0];
        if (archivo) subirReporte(tipo, archivo);
      });
      // Pegar con Ctrl+V mientras el foco esta en la zona de carga (algunos
      // navegadores permiten pegar un archivo copiado desde el explorador).
      drop.setAttribute('tabindex', '0');
      drop.addEventListener('paste', e => {
        const archivo = (e.clipboardData && e.clipboardData.files && e.clipboardData.files[0]) || null;
        if (archivo) subirReporte(tipo, archivo);
      });
    });
  }
  cargarDashboardReportes();
}

function marcarEstadoCarga(tipo, texto, clase) {
  const el = document.getElementById('estado' + tipo);
  el.textContent = texto;
  el.className = 'reporte-drop-estado' + (clase ? ' ' + clase : '');
}

async function subirReporte(tipo, archivo) {
  marcarEstadoCarga(tipo, 'Leyendo archivo...', '');
  try {
    const buffer = await archivo.arrayBuffer();
    const libro = XLSX.read(buffer, { type: 'array', cellDates: true });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    // header:1 = filas como arrays (no objetos), primera fila = encabezados.
    // Asi se manda tal cual al Apps Script, que solo hace setValues.
    const filasCrudas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', raw: true });
    if (!filasCrudas.length) throw new Error('El archivo esta vacio');
    const encabezados = filasCrudas[0].map(h => String(h));
    const filas = filasCrudas.slice(1)
      .filter(fila => fila.some(celda => String(celda).trim() !== ''))
      .map(fila => fila.map(celda => (celda instanceof Date ? celda.toISOString().slice(0, 10) : celda)));

    marcarEstadoCarga(tipo, 'Subiendo ' + filas.length + ' filas...', '');
    const resp = await fetch('/reportes-write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'reportes-escribir', tipo, encabezados, filas })
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Error desconocido');

    marcarEstadoCarga(tipo, 'OK -- ' + filas.length + ' filas (' + new Date().toLocaleString('es-AR') + ')', 'ok');
    cacheReportes[tipo] = null; // fuerza a releer del Sheet en vez de usar el cache viejo
    await cargarDashboardReportes();
  } catch (error) {
    marcarEstadoCarga(tipo, 'Error: ' + (error.message || error), 'error');
  }
}

// ============================ LECTURA ============================

function filasAObjetos(encabezados, filas) {
  return filas.map(fila => {
    const obj = {};
    encabezados.forEach((h, i) => { obj[h] = fila[i]; });
    return obj;
  });
}

async function leerReporte(tipo) {
  if (cacheReportes[tipo]) return cacheReportes[tipo];
  const resp = await fetch('/reportes/' + tipo);
  const json = await resp.json();
  if (json.error) throw new Error(json.error);
  const objetos = filasAObjetos(json.encabezados, json.filas);
  cacheReportes[tipo] = objetos;
  return objetos;
}

async function cargarDashboardReportes() {
  let ventas, ventasProducto, ventasProductoAnterior, stock;
  try {
    [ventas, ventasProducto, ventasProductoAnterior, stock] = await Promise.all([
      leerReporte('Ventas'), leerReporte('VentasProducto'), leerReporte('VentasProductoAnterior'), leerReporte('Stock')
    ]);
  } catch (error) {
    MostrarAlerta({ tipo: 'error', title: 'Reportes', mnsj: 'No se pudo leer el Sheet de Reportes: ' + error.message });
    return;
  }

  const hayDatos = ventas.length || ventasProducto.length || stock.length;
  document.getElementById('reportesVacio').classList.toggle('oculto', !!hayDatos);
  document.getElementById('reportesDashboard').classList.toggle('oculto', !hayDatos);
  if (!hayDatos) return;

  const datosVentas = prepararVentas(ventas);
  renderVentasPorGrupo('Vendedor', datosVentas, v => String(v.Vendedor || 'Sin asignar').trim() || 'Sin asignar',
    'chartVendedorMes', 'chartVendedorDiario', 'chartVendedorRunRate', 'bodyResumenVendedor');
  renderVentasPorGrupo('Sucursal', datosVentas, v => sucursalDeVendedor(v.Vendedor),
    'chartSucursalMes', 'chartSucursalDiario', 'chartSucursalRunRate', 'bodyResumenSucursal');

  const top15 = topProductosVendidos(ventasProducto, 15);
  renderProductos(top15, ventasProductoAnterior);
  renderStock(stock, ventasProducto, datosVentas, top15);
  renderTendenciaSemanal(datosVentas);
}

// ============================ VENTAS (Libro IVA) ============================

function prepararVentas(filas) {
  return filas
    .map(f => ({
      Vendedor: f['Vendedor'],
      Total: Number(f['Total']) || 0,
      Fecha: f['Fecha Comp'] ? new Date(f['Fecha Comp']) : null
    }))
    .filter(f => f.Fecha && !isNaN(f.Fecha.getTime()));
}

function claveMes(fecha) { return fecha.getFullYear() + '-' + String(fecha.getMonth() + 1).padStart(2, '0'); }
function nombreMes(claveYYYYMM) {
  const [y, m] = claveYYYYMM.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
}

// Arma la tabla resumen + los 3 graficos (total x mes, evolucion diaria,
// run-rate) para un agrupamiento dado (por Vendedor o por Sucursal) --
// misma logica, distinta funcion de agrupamiento, para no duplicar el
// calculo. La tabla es lo primero que se lee -- los graficos son el
// respaldo visual, no reemplazan los numeros exactos.
function renderVentasPorGrupo(etiquetaGrupo, ventas, fnGrupo, idChartMes, idChartDiario, idChartRunRate, idTabla) {
  if (!ventas.length) return;
  const hoy = new Date();
  const mesActualKey = claveMes(hoy);

  // Meses presentes en los datos -- "mes anterior" es el mas reciente que
  // no sea el mes actual (no se asume que sean julio/agosto, se detecta
  // solo). Si el mes actual todavia no tiene ninguna fila cargada (recien
  // arranco el mes y no se subio el export nuevo todavia), igual se
  // compara contra el ultimo mes que si hay, en vez de mostrar $0.
  const mesesPresentes = Array.from(new Set(ventas.map(v => claveMes(v.Fecha)))).sort();
  const mesesSinActual = mesesPresentes.filter(m => m !== mesActualKey);
  const mesAnteriorKey = mesesSinActual.length ? mesesSinActual[mesesSinActual.length - 1] : null;
  const ultimos2Meses = mesAnteriorKey ? [mesAnteriorKey, mesActualKey] : [mesActualKey];

  const grupos = Array.from(new Set(ventas.map(fnGrupo))).sort();
  const diasEnMesActual = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  const diaDeHoy = Math.min(hoy.getDate(), diasEnMesActual);

  function totalDe(g, mesKey) {
    return ventas.filter(v => fnGrupo(v) === g && claveMes(v.Fecha) === mesKey).reduce((s, v) => s + v.Total, 0);
  }
  function comprobantesDe(g, mesKey) {
    return ventas.filter(v => fnGrupo(v) === g && claveMes(v.Fecha) === mesKey).length;
  }

  // ---- Tabla resumen: los numeros exactos, antes que nada. ----
  const tbody = document.getElementById(idTabla);
  tbody.innerHTML = '';
  grupos.forEach(g => {
    const totalActual = totalDe(g, mesActualKey);
    const totalAnterior = mesAnteriorKey ? totalDe(g, mesAnteriorKey) : 0;
    const comprobantes = comprobantesDe(g, mesActualKey);
    const ticketPromedio = comprobantes > 0 ? totalActual / comprobantes : 0;
    const proyeccion = diaDeHoy > 0 ? Math.round((totalActual / diaDeHoy) * diasEnMesActual) : 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${g}</td><td>${formatNumberArg(totalActual)}</td><td>${formatNumberArg(totalAnterior)}</td><td>${comprobantes}</td><td>${formatNumberArg(ticketPromedio)}</td><td>${formatNumberArg(proyeccion)}</td>`;
    tbody.appendChild(tr);
  });

  // ---- Grafico 1: total por grupo y mes (barras agrupadas, hasta 2 meses) ----
  const dataset1 = ultimos2Meses.map(mesKey => ({ label: nombreMes(mesKey), data: grupos.map(g => totalDe(g, mesKey)) }));
  renderBarChart(idChartMes, 'Total por ' + etiquetaGrupo + ' ($ARS)', grupos, dataset1, false, true);

  // ---- Grafico 2: evolucion diaria del mes actual, una linea por grupo ----
  const etiquetasDias = Array.from({ length: diasEnMesActual }, (_, i) => String(i + 1));
  const dataset2 = grupos.map(g => {
    const ventasGrupo = ventas.filter(v => fnGrupo(v) === g && claveMes(v.Fecha) === mesActualKey);
    const porDia = new Array(diasEnMesActual).fill(0);
    ventasGrupo.forEach(v => { porDia[v.Fecha.getDate() - 1] += v.Total; });
    return { label: g, data: porDia };
  });
  renderLineChart(idChartDiario, 'Evolucion diaria ($ARS) -- ' + nombreMes(mesActualKey), etiquetasDias, dataset2, true);

  // ---- Grafico 3: acumulado del mes vs proyeccion de cierre (run-rate) ----
  const acumulado = grupos.map(g => totalDe(g, mesActualKey));
  const proyeccion = acumulado.map(total => diaDeHoy > 0 ? Math.round((total / diaDeHoy) * diasEnMesActual) : 0);
  renderBarChart(idChartRunRate, 'Acumulado vs. proyeccion de cierre ($ARS) -- ' + nombreMes(mesActualKey), grupos, [
    { label: 'Acumulado (dia ' + diaDeHoy + ')', data: acumulado },
    { label: 'Proyeccion de cierre', data: proyeccion }
  ], false, true);
}

// ============================ PRODUCTOS ============================

// "Mas vendidos" = top 15 del mes actual por cantidad -- es la definicion
// unica que se usa tanto para el grafico de Productos como para acotar la
// alerta de stock (ver renderStock) a lo que realmente importa vigilar.
function topProductosVendidos(actual, n) {
  const datosActual = actual.map(f => ({
    id: String(f['ID Producto'] || ''),
    producto: f['Producto'],
    cantidad: Number(f['Cantidad']) || 0,
    total: Number(f['Total']) || 0
  }));
  return [...datosActual].sort((a, b) => b.cantidad - a.cantidad).slice(0, n);
}

function renderProductos(top15, anterior) {
  renderBarChart('chartTop15', 'Top 15 productos mas vendidos (cantidad)', top15.map(p => p.producto), [
    { label: 'Cantidad', data: top15.map(p => p.cantidad) }
  ], true);

  // Tabla comparativa: solo el top 15 del mes actual (misma definicion de
  // "mas vendidos" que el grafico), contra su cantidad/monto del mes
  // anterior -- ya no se listan los ~200 productos del catalogo entero.
  const porIdAnterior = {};
  anterior.forEach(f => {
    porIdAnterior[String(f['ID Producto'] || '')] = { cantidad: Number(f['Cantidad']) || 0, total: Number(f['Total']) || 0 };
  });
  const filasComparacion = top15.map(p => {
    const ant = porIdAnterior[p.id] || { cantidad: 0, total: 0 };
    return { nombre: p.producto, cantAct: p.cantidad, cantAnt: ant.cantidad, totAct: p.total, totAnt: ant.total };
  });

  const tbody = document.getElementById('bodyComparacionProductos');
  tbody.innerHTML = '';
  filasComparacion.forEach(f => {
    const dif = f.cantAct - f.cantAnt;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${f.nombre}</td><td>${f.cantAct}</td><td>${f.cantAnt}</td><td>${dif > 0 ? '+' : ''}${dif}</td><td>${formatNumberArg(f.totAct)}</td><td>${formatNumberArg(f.totAnt)}</td>`;
    tbody.appendChild(tr);
  });
}

// ============================ STOCK Y COMPRAS ============================

function renderStock(stock, ventasProducto, ventasPreparadas, top15) {
  const filasStock = stock.map(f => ({
    id: String(f['Id Producto'] || ''),
    producto: f['Producto'],
    categoria: f['Categoría'] || f['Categoria'] || '',
    minimo: Number(f['Minimo']) || 0,
    critico: Number(f['Critico']) || 0,
    disponible: Number(f['Disponible']) || 0
  }));

  // ---- Alerta de stock bajo -- SOLO de los productos que estan en el top
  // 15 de mas vendidos (mismo criterio que renderProductos), para no
  // enterrar la alerta entre cientos de productos que casi no se venden.
  const idsTop15 = new Set(top15.map(p => p.id));
  const filasStockRelevantes = filasStock.filter(f => idsTop15.has(f.id));
  const alertas = filasStockRelevantes
    .filter(f => f.disponible <= f.minimo)
    .map(f => ({ ...f, estado: f.disponible <= f.critico ? 'Critico' : 'Bajo minimo' }))
    .sort((a, b) => (a.estado === b.estado ? a.disponible - b.disponible : (a.estado === 'Critico' ? -1 : 1)));

  const tbodyAlerta = document.getElementById('bodyAlertaStock');
  tbodyAlerta.innerHTML = '';
  alertas.forEach(f => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${f.producto}</td><td>${f.categoria}</td><td>${f.disponible}</td><td>${f.minimo}</td><td>${f.critico}</td><td>${f.estado}</td>`;
    tr.style.background = f.estado === 'Critico' ? 'rgba(231,76,60,0.15)' : 'rgba(241,196,15,0.15)';
    tbodyAlerta.appendChild(tr);
  });

  const cantCriticos = alertas.filter(f => f.estado === 'Critico').length;
  const cantBajoMinimo = alertas.length - cantCriticos;
  const cantOk = filasStockRelevantes.length - alertas.length;
  renderBarChart('chartStockAlerta', 'Estado del stock -- top ' + filasStockRelevantes.length + ' mas vendidos', ['Critico', 'Bajo minimo', 'OK'], [
    { label: 'Cantidad de productos', data: [cantCriticos, cantBajoMinimo, cantOk] }
  ]);

  // ---- Sugerencia de compra: cruza ritmo de venta del mes actual con el
  // disponible, para estimar cuales se quedan sin stock antes de fin de
  // mes. Se guia por CANTIDADES, no por dinero (ver nota en la UI). ----
  const hoy = new Date();
  const diasEnMesActual = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  const diaDeHoy = Math.max(1, hoy.getDate());
  const diasRestantesDelMes = diasEnMesActual - diaDeHoy;

  const cantidadPorId = {};
  ventasProducto.forEach(f => {
    const id = String(f['ID Producto'] || '');
    cantidadPorId[id] = (cantidadPorId[id] || 0) + (Number(f['Cantidad']) || 0);
  });

  const sugerencias = filasStock
    .map(f => {
      const ventaMes = cantidadPorId[f.id] || 0;
      const ritmoDiario = ventaMes / diaDeHoy;
      if (ritmoDiario <= 0) return null;
      const diasDeStockRestantes = f.disponible / ritmoDiario;
      if (diasDeStockRestantes >= diasRestantesDelMes) return null; // no se queda sin stock este mes
      const cantidadSugerida = Math.ceil(ritmoDiario * diasRestantesDelMes - f.disponible);
      if (cantidadSugerida <= 0) return null;
      return { producto: f.producto, disponible: f.disponible, ritmoDiario, diasDeStockRestantes, cantidadSugerida };
    })
    .filter(Boolean)
    .sort((a, b) => a.diasDeStockRestantes - b.diasDeStockRestantes);

  const tbodySugerencia = document.getElementById('bodySugerenciaCompra');
  tbodySugerencia.innerHTML = '';
  sugerencias.forEach(f => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${f.producto}</td><td>${f.disponible}</td><td>${f.ritmoDiario.toFixed(2)}</td><td>${f.diasDeStockRestantes.toFixed(1)}</td><td>${f.cantidadSugerida}</td>`;
    tbodySugerencia.appendChild(tr);
  });
}

// ============================ TENDENCIAS SEMANALES ============================

// Numero de semana ISO (lunes a domingo) + año, para agrupar sin importar
// en que mes cae cada semana.
function claveSemanaISO(fecha) {
  const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  const diaSemana = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - diaSemana);
  const inicioAno = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const numeroSemana = Math.ceil((((d - inicioAno) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-S' + String(numeroSemana).padStart(2, '0');
}

function renderTendenciaSemanal(ventas) {
  if (!ventas.length) return;
  const semanas = Array.from(new Set(ventas.map(v => claveSemanaISO(v.Fecha)))).sort();

  const totalPorSemana = semanas.map(sem => ventas.filter(v => claveSemanaISO(v.Fecha) === sem).reduce((s, v) => s + v.Total, 0));
  renderLineChart('chartTendenciaSemanal', 'Ventas totales por semana ($ARS)', semanas, [{ label: 'Total', data: totalPorSemana }], true);

  const sucursales = Array.from(new Set(ventas.map(v => sucursalDeVendedor(v.Vendedor)))).sort();
  const datasetSucursal = sucursales.map(suc => ({
    label: suc,
    data: semanas.map(sem => ventas.filter(v => claveSemanaISO(v.Fecha) === sem && sucursalDeVendedor(v.Vendedor) === suc).reduce((s, v) => s + v.Total, 0))
  }));
  renderLineChart('chartTendenciaSemanalSucursal', 'Ventas por semana y sucursal ($ARS)', semanas, datasetSucursal, true);
}

// ============================ CHART.JS: helpers genericos ============================

const instanciasCharts = {};
const PALETA_COLORES = ['#4834d4', '#6ab04c', '#f0932b', '#eb4d4b', '#22a6b3', '#be2edd', '#7ed6df', '#e056fd'];

function destruirChartSiExiste(id) {
  if (instanciasCharts[id]) { instanciasCharts[id].destroy(); delete instanciasCharts[id]; }
}

// formatoMoneda: true para los graficos que muestran $ARS (ventas), false
// para los que muestran cantidades/unidades (top productos, stock) --
// asi el eje y los tooltips no le ponen "$" a un numero de unidades.
function formatearEjeValor(valor, formatoMoneda) {
  return formatoMoneda ? formatNumberArg(valor) : valor;
}

function renderBarChart(canvasId, titulo, etiquetas, datasets, horizontal, formatoMoneda) {
  destruirChartSiExiste(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const ejeCantidad = horizontal ? 'x' : 'y';
  instanciasCharts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: etiquetas,
      datasets: datasets.map((d, i) => ({ label: d.label, data: d.data, backgroundColor: PALETA_COLORES[i % PALETA_COLORES.length] }))
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true,
      plugins: {
        title: { display: true, text: titulo },
        tooltip: { callbacks: { label: ctx2 => ctx2.dataset.label + ': ' + formatearEjeValor(ctx2.parsed[ejeCantidad === 'y' ? 'y' : 'x'], formatoMoneda) } }
      },
      scales: { [ejeCantidad]: { beginAtZero: true, ticks: { callback: v => formatearEjeValor(v, formatoMoneda) } } }
    }
  });
}

function renderLineChart(canvasId, titulo, etiquetas, datasets, formatoMoneda) {
  destruirChartSiExiste(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  instanciasCharts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: etiquetas,
      datasets: datasets.map((d, i) => ({ label: d.label, data: d.data, borderColor: PALETA_COLORES[i % PALETA_COLORES.length], backgroundColor: PALETA_COLORES[i % PALETA_COLORES.length], tension: 0.25, fill: false }))
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: titulo },
        tooltip: { callbacks: { label: ctx2 => ctx2.dataset.label + ': ' + formatearEjeValor(ctx2.parsed.y, formatoMoneda) } }
      },
      scales: { y: { beginAtZero: true, ticks: { callback: v => formatearEjeValor(v, formatoMoneda) } } }
    }
  });
}
