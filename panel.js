// ============================ PANEL DE VENTAS (3.0, Etapa 3) ============================
// Solo para administracion y oficina. Lo que se ve aca viene de /api/panel/*, que el
// servidor protege por rol (un vendedor recibe 403 aunque abra esta pantalla a la
// fuerza). Nada se borra: se verifica, se marca "con diferencia" o se anula (anular
// = solo administrador, con motivo). Exporta a Excel lo que se esta viendo.

const PanelVentas = (function () {
  const $id = id => document.getElementById(id);
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pesos = centavos => formatNumberArg(Math.round((centavos || 0) / 100));
  const LIMITE = 50;

  const NOMBRE_COBRO = { completo: 'Cobro completo', parcial: 'Cobro parcial', excedido: 'Cobrado de más', sin_cobro_registrado: 'Sin cobro registrado' };
  const CLASE_COBRO = { completo: 'ok', parcial: 'alerta', excedido: 'error', sin_cobro_registrado: 'gris' };
  const NOMBRE_METODO = { efectivo: 'Efectivo', transferencia: 'Transferencia', usdt: 'USDT', debito: 'Débito', qr: 'QR', credito: 'Crédito', canje: 'Canje' };
  const NOMBRE_VERIF = { pendiente: 'Por verificar', verificado: 'Verificado', con_diferencia: 'Con diferencia' };

  let iniciado = false;
  let rol = null;
  let ventas = [];
  let abierta = null;       // id de la venta con el detalle desplegado
  let cargando = false;
  let hayMas = false;

  (function estilos() {
    const css = document.createElement('style');
    css.textContent = `
      #vistaVentas .pv-chips { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
      #vistaVentas .pv-chip { border:1px solid var(--ap-line,#ddd); border-radius:999px; padding:6px 12px; font-size:13px; cursor:pointer; background:transparent; color:inherit; }
      #vistaVentas .pv-chip b { margin-left:4px; }
      #vistaVentas .pv-filtros { display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; margin-bottom:10px; }
      #vistaVentas .pv-filtros > div { min-width:130px; flex:1; }
      #vistaVentas .pv-totales { font-size:14px; margin:6px 0 10px; opacity:.85; }
      #vistaVentas .pv-tabla-wrap { overflow-x:auto; }
      #vistaVentas table.pv { width:100%; border-collapse:collapse; font-size:13px; }
      #vistaVentas table.pv th, #vistaVentas table.pv td { padding:8px 10px; border-bottom:1px solid var(--ap-line,#ddd); text-align:left; vertical-align:top; }
      #vistaVentas table.pv tr.fila { cursor:pointer; }
      #vistaVentas table.pv tr.fila:hover { background:rgba(127,127,127,.08); }
      #vistaVentas table.pv tr.anulada td { opacity:.55; text-decoration:line-through; }
      #vistaVentas table.pv td.num, #vistaVentas table.pv th.num, #vistaVentas .pv-detalle td.num, #vistaVentas .pv-detalle th.num { text-align:right; white-space:nowrap; }
      #vistaVentas .pv-badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; white-space:nowrap; background:rgba(127,127,127,.18); }
      #vistaVentas .pv-badge.ok { background:rgba(52,199,89,.22); }
      #vistaVentas .pv-badge.alerta { background:rgba(255,149,0,.25); }
      #vistaVentas .pv-badge.error { background:rgba(255,59,48,.22); }
      #vistaVentas .pv-detalle { padding:12px 14px; background:rgba(127,127,127,.07); border-radius:10px; text-align:left; position:sticky; left:0; box-sizing:border-box; width:min(100%, calc(100vw - 90px)); overflow-x:auto; }
      #vistaVentas .pv-detalle h4 { margin:14px 0 6px; font-size:14px; }
      #vistaVentas .pv-detalle h4:first-child { margin-top:0; }
      #vistaVentas .pv-detalle table { width:100%; font-size:13px; border-collapse:collapse; }
      #vistaVentas .pv-detalle td, #vistaVentas .pv-detalle th { padding:5px 8px; border-bottom:1px solid var(--ap-line,#ddd); text-align:left; vertical-align:top; }
      #vistaVentas .pv-acciones { display:flex; gap:6px; flex-wrap:wrap; margin-top:4px; }
      #vistaVentas .pv-btn { border:1px solid var(--ap-line,#ccc); background:transparent; color:inherit; border-radius:8px; padding:4px 10px; font-size:12px; cursor:pointer; }
      #vistaVentas .pv-btn.peligro { color:#d33; border-color:#d33; }
      #vistaVentas .pv-btn.bueno { color:#1a8f3c; border-color:#1a8f3c; }
      #vistaVentas .pv-alerta { padding:8px 10px; border:1px solid var(--ap-line,#ddd); border-radius:10px; margin-bottom:6px; font-size:13px; display:flex; gap:10px; justify-content:space-between; align-items:center; }
      #vistaVentas .pv-vacio { padding:24px; text-align:center; opacity:.7; }
      #vistaVentas .pv-tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; border-bottom:1px solid var(--ap-line,#ddd); padding-bottom:8px; }
      #vistaVentas .pv-tab { border:0; background:transparent; color:inherit; padding:8px 12px; border-radius:8px; font-size:14px; cursor:pointer; }
      #vistaVentas .pv-tab.activa { background:var(--ap-accent,#0071e3); color:#fff; }
      #vistaVentas .pv-tab b { font-weight:600; }
      #vistaVentas .pv-vencida { color:#d33; font-weight:600; }
      #vistaVentas .pv-estrellas { color:#ffb400; letter-spacing:1px; white-space:nowrap; }
      #vistaVentas .pv-form-linea { display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; margin:6px 0; }
      #vistaVentas .pv-form-linea label { display:flex; flex-direction:column; font-size:12px; gap:2px; margin:0 !important; min-width:0; }
      #vistaVentas .pv-form-linea input, #vistaVentas .pv-form-linea select { height:34px !important; width:auto !important; max-width:100%; min-width:0; padding:0 8px !important; font-size:13px !important; font-weight:400 !important; border-radius:8px; border:1px solid var(--ap-line,#ccc); background:transparent; color:inherit; box-sizing:border-box; }
      #vistaVentas .pv-form-linea label[style*="flex:1"] input { width:100% !important; }
      #vistaVentas .pv-link { font-size:12px; word-break:break-all; padding:6px 8px; border-radius:8px; background:rgba(127,127,127,.12); margin:6px 0; }
      #vistaVentas .pv-suave { opacity:.7; font-size:12px; }
    `;
    document.head.appendChild(css);
  })();

  async function pApi(metodo, ruta, cuerpo) {
    const r = await fetch(ruta, { method: metodo, credentials: 'same-origin', headers: cuerpo ? { 'Content-Type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    let j = null; try { j = await r.json(); } catch (e) { /* no JSON */ }
    if (r.status === 401) throw new Error('Tu sesión venció: volvé a iniciar sesión.');
    if (r.status === 403) throw new Error('No tenés permiso para esto.');
    if (!r.ok || !j || j.ok === false) throw new Error((j && j.error) || 'No se pudo completar (error ' + r.status + ')');
    return j;
  }
  const aviso = (tipo, mnsj) => MostrarAlerta({ tipo, title: 'Ventas', mnsj });

  // ---------- armado de la pantalla ----------
  function armarEsqueleto() {
    $id('vistaVentas').innerHTML = `
      <div class="pv-tabs" id="pvTabs">
        <button type="button" class="pv-tab activa" data-tab="ventas">Ventas</button>
        <button type="button" class="pv-tab" data-tab="seguimiento">Seguimiento <b data-cuenta="seguimientos_vencidos"></b></button>
        <button type="button" class="pv-tab" data-tab="garantias">Garantías por vencer <b data-cuenta="garantias_por_vencer"></b></button>
        <button type="button" class="pv-tab" data-tab="reclamos">Reclamos <b data-cuenta="reclamos_abiertos"></b></button>
        <button type="button" class="pv-tab" data-tab="encuestas">Encuestas</button>
        <!-- Caja: oculta por ahora (no se lleva control de caja diario). Para volver a mostrarla, quitar el atributo hidden. -->
        <button type="button" class="pv-tab" hidden data-tab="caja">Caja <b data-cuenta="cierres_pendientes"></b></button>
        <button type="button" class="pv-tab" data-tab="comisiones">Comisiones</button>
        <button type="button" class="pv-tab" data-tab="stock">Stock</button>
      </div>
      <div id="pvVista_stock" style="display:none;"></div>
      <div id="pvVista_caja" style="display:none;"></div>
      <div id="pvVista_comisiones" style="display:none;"></div>
      <div id="pvVista_seguimiento" style="display:none;"></div>
      <div id="pvVista_garantias" style="display:none;"></div>
      <div id="pvVista_reclamos" style="display:none;"></div>
      <div id="pvVista_encuestas" style="display:none;"></div>
      <div id="pvVista_ventas">
      <div class="pv-chips" id="pvChips"></div>
      <div class="pv-filtros">
        <div class="form-group-total"><label>Desde</label><input type="date" id="pvDesde"></div>
        <div class="form-group-total"><label>Hasta</label><input type="date" id="pvHasta"></div>
        <div class="form-group-total" style="flex:2; min-width:180px;"><label>Buscar (cliente, DNI, código, IMEI)</label><input type="text" id="pvQ" autocomplete="off"></div>
        <div class="form-group-total"><label>Local</label><select id="pvLocal"><option value="">Todos</option></select></div>
        <div class="form-group-total"><label>Vendedor</label><select id="pvVendedor"><option value="">Todos</option></select></div>
        <div class="form-group-total"><label>Forma de pago</label><select id="pvMetodo"><option value="">Todas</option>${Object.keys(NOMBRE_METODO).map(k => `<option value="${k}">${NOMBRE_METODO[k]}</option>`).join('')}</select></div>
        <div class="form-group-total"><label>Cobro</label><select id="pvCobro"><option value="">Todos</option>${Object.keys(NOMBRE_COBRO).map(k => `<option value="${k}">${NOMBRE_COBRO[k]}</option>`).join('')}</select></div>
        <div class="form-group-total"><label>Venta</label><select id="pvEstadoVenta"><option value="">Todas</option><option value="registrada">Registradas</option><option value="anulada">Anuladas</option><option value="con_devolucion">Con devolución</option></select></div>
        <div class="form-group-total"><label>Pagos</label><select id="pvSolo"><option value="">Todos</option><option value="pendientes">Por verificar</option><option value="diferencia">Con diferencia</option></select></div>
      </div>
      <div class="pv-acciones" style="margin-bottom:6px;">
        <button type="button" class="btn-total" id="pvBuscar" style="width:auto; padding:0 18px;">Buscar</button>
        <button type="button" class="pv-btn" id="pvLimpiar">Limpiar filtros</button>
        <button type="button" class="pv-btn" id="pvExcel">Exportar a Excel</button>
        <button type="button" class="pv-btn" id="pvAlertasBtn">Alertas</button>
        <button type="button" class="pv-btn" id="pvAuditoriaBtn" style="display:none;">Auditoría</button>
      </div>
      <div class="pv-totales" id="pvTotales"></div>
      <div id="pvAlertas" style="display:none;"></div>
      <div class="pv-tabla-wrap"><table class="pv" id="pvTabla"></table></div>
      <div style="text-align:center; margin:12px 0;"><button type="button" class="pv-btn" id="pvMas" style="display:none;">Cargar más</button></div>
      </div>`;

    $id('pvTabs').addEventListener('click', ev => { const b = ev.target.closest('[data-tab]'); if (b) irA(b.getAttribute('data-tab')); });
    ['seguimiento', 'garantias', 'reclamos', 'encuestas'].forEach(t => $id('pvVista_' + t).addEventListener('click', clickPosventa));
    $id('pvVista_caja').addEventListener('click', clickCaja);
    $id('pvVista_caja').addEventListener('input', recalcularDiferenciaCaja);
    $id('pvVista_caja').addEventListener('change', ev => { if (ev.target.id === 'cjSuc' || ev.target.id === 'cjDia') cargarCaja(); });
    $id('pvVista_comisiones').addEventListener('change', ev => { if (ev.target.id === 'cmMes') cargarComisiones(); });
    $id('pvVista_stock').addEventListener('click', clickStock);
    $id('pvVista_stock').addEventListener('change', ev => { if (['stDeposito', 'stEstado'].includes(ev.target.id)) cargarStock(); });
    $id('pvVista_stock').addEventListener('keydown', ev => { if (ev.target.id === 'stQ' && ev.key === 'Enter') cargarStock(); });
    $id('pvBuscar').addEventListener('click', () => cargar(true));
    $id('pvQ').addEventListener('keydown', e => { if (e.key === 'Enter') cargar(true); });
    ['pvDesde', 'pvHasta', 'pvLocal', 'pvVendedor', 'pvMetodo', 'pvCobro', 'pvEstadoVenta', 'pvSolo'].forEach(id => $id(id).addEventListener('change', () => cargar(true)));
    $id('pvLimpiar').addEventListener('click', () => { limpiarFiltros(); cargar(true); });
    $id('pvMas').addEventListener('click', () => cargar(false));
    $id('pvExcel').addEventListener('click', exportar);
    $id('pvAlertasBtn').addEventListener('click', () => alternarAlertas());
    $id('pvAuditoriaBtn').addEventListener('click', verAuditoria);
    $id('pvTabla').addEventListener('click', clickTabla);
    $id('pvAlertas').addEventListener('click', clickAlertas);
    $id('pvChips').addEventListener('click', clickChip);
  }

  function limpiarFiltros() {
    ['pvDesde', 'pvHasta', 'pvQ', 'pvLocal', 'pvVendedor', 'pvMetodo', 'pvCobro', 'pvEstadoVenta', 'pvSolo'].forEach(id => { $id(id).value = ''; });
  }

  function filtrosActuales() {
    const p = new URLSearchParams();
    [['desde', 'pvDesde'], ['hasta', 'pvHasta'], ['q', 'pvQ'], ['local', 'pvLocal'], ['vendedor', 'pvVendedor'], ['metodo', 'pvMetodo'], ['estadoCobro', 'pvCobro'], ['estadoVenta', 'pvEstadoVenta'], ['solo', 'pvSolo']]
      .forEach(([k, id]) => { const v = ($id(id).value || '').trim(); if (v) p.set(k, v); });
    return p;
  }

  async function resumen() {
    const j = await pApi('GET', '/api/panel/resumen');
    rol = j.rol;
    const llenar = (id, lista) => { const s = $id(id); const actual = s.value; s.length = 1; lista.forEach(n => s.appendChild(new Option(n, n))); s.value = actual; };
    llenar('pvLocal', j.locales); llenar('pvVendedor', j.vendedores);
    const c = j.contadores;
    $id('pvChips').innerHTML = [
      ['sinCobro', 'Sin cobro registrado', c.sin_cobro], ['pendientes', 'Pagos por verificar', c.pendientes],
      ['diferencia', 'Con diferencia', c.con_diferencia], ['alertas', 'Alertas', c.alertas]
    ].map(([k, t, n]) => `<button type="button" class="pv-chip" data-chip="${k}">${t}<b>${n}</b></button>`).join('');
    $id('pvAuditoriaBtn').style.display = rol === 'admin' ? '' : 'none';
    document.querySelectorAll('#pvTabs [data-cuenta]').forEach(b => { const n = c[b.getAttribute('data-cuenta')]; b.textContent = n ? '(' + n + ')' : ''; });
  }

  // Los contadores miran TODAS las fechas, asi que al tocarlos se sacan los filtros.
  function clickChip(ev) {
    const b = ev.target.closest('[data-chip]');
    if (!b) return;
    const k = b.getAttribute('data-chip');
    if (k === 'alertas') return alternarAlertas(true);
    limpiarFiltros();
    $id('pvCobro').value = k === 'sinCobro' ? 'sin_cobro_registrado' : '';
    $id('pvSolo').value = k === 'pendientes' ? 'pendientes' : (k === 'diferencia' ? 'diferencia' : '');
    cargar(true);
  }

  // ---------- lista ----------
  const fechaCorta = f => { const m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/); return m ? m[3] + '/' + m[2] + ' ' + m[4] + ':' + m[5] : ''; };

  function filaVenta(v) {
    const anulada = v.estado_venta === 'anulada';
    const cobro = anulada ? '<span class="pv-badge error">Anulada</span>' : `<span class="pv-badge ${CLASE_COBRO[v.estado_cobro] || ''}">${NOMBRE_COBRO[v.estado_cobro] || esc(v.estado_cobro)}</span>`;
    const alertas = (v.pagos_con_diferencia ? ' <span class="pv-badge error" title="Pago con diferencia">⚠ diferencia</span>' : '') + (!anulada && v.pagos_sin_verificar ? ' <span class="pv-badge alerta" title="Pagos sin verificar">' + v.pagos_sin_verificar + ' por verificar</span>' : '');
    return `<tr class="fila ${anulada ? 'anulada' : ''}" data-venta="${v.venta_id}">
      <td>${fechaCorta(v.fecha_local)}</td><td><b>${esc(v.codigo)}</b></td>
      <td>${esc(v.cliente)}<br><span style="opacity:.7">${esc(v.cliente_dni || '')}</span></td>
      <td>${esc(v.productos)}</td><td>${esc(v.local)}<br><span style="opacity:.7">${esc(v.vendedor)}</span></td>
      <td class="num">${pesos(v.total_centavos)}</td><td class="num">${pesos(v.pagado_centavos)}</td><td>${cobro}${alertas}</td></tr>`;
  }

  function pintarTabla() {
    const t = $id('pvTabla');
    if (!ventas.length) { t.innerHTML = '<tbody><tr><td class="pv-vacio">No hay ventas con esos filtros.</td></tr></tbody>'; return; }
    t.innerHTML = '<thead><tr><th>Fecha</th><th>Código</th><th>Cliente</th><th>Productos</th><th>Local / Vendedor</th><th class="num">Total</th><th class="num">Cobrado</th><th>Estado</th></tr></thead><tbody>' +
      ventas.map(v => filaVenta(v) + (abierta === v.venta_id ? `<tr class="detalle-fila" data-detalle="${v.venta_id}"><td colspan="8"><div class="pv-detalle" id="pvDetalle">Cargando…</div></td></tr>` : '')).join('') + '</tbody>';
  }

  async function cargar(desdeCero) {
    if (cargando) return;
    cargando = true;
    try {
      if (desdeCero) { ventas = []; abierta = null; }
      const p = filtrosActuales();
      p.set('limit', LIMITE); p.set('offset', ventas.length);
      const j = await pApi('GET', '/api/panel/ventas?' + p.toString());
      ventas = ventas.concat(j.ventas);
      hayMas = j.ventas.length === LIMITE;
      $id('pvTotales').innerHTML = `<b>${j.totales.cantidad}</b> ventas · Total vendido <b>${pesos(j.totales.total_centavos)}</b> · Cobrado <b>${pesos(j.totales.pagado_centavos)}</b> <span style="opacity:.6">(sin contar anuladas)</span>`;
      $id('pvMas').style.display = hayMas ? '' : 'none';
      pintarTabla();
      if (desdeCero) resumen().catch(() => {});
    } catch (e) { aviso('error', e.message); } finally { cargando = false; }
  }

  // ---------- detalle de una venta ----------
  async function abrirDetalle(id) {
    abierta = abierta === id ? null : id;
    pintarTabla();
    if (abierta === null) return;
    try {
      const d = await pApi('GET', '/api/panel/ventas/' + id);
      const caja = $id('pvDetalle');
      if (caja) caja.innerHTML = htmlDetalle(d);
    } catch (e) { const caja = $id('pvDetalle'); if (caja) caja.textContent = e.message; }
  }

  function htmlDetalle(d) {
    const v = d.venta;
    const anulada = v.estado_venta === 'anulada';
    const compPorPago = {};
    d.comprobantes.forEach(c => { (compPorPago[c.pago_id] = compPorPago[c.pago_id] || []).push(c); });
    const esAdmin = rol === 'admin';
    const filasPagos = d.pagos.map(p => {
      const enMoneda = p.moneda === 'ARS' ? pesos(p.monto_centavos) : p.moneda + ' ' + (p.monto_centavos / 100).toLocaleString('es-AR');
      const sinCaptura = p.metodo === 'canje' && p.estado === 'vigente' && !(compPorPago[p.id] || []).length;
      const comps = (compPorPago[p.id] || []).map(c => `<a href="/api/panel/comprobantes/${c.id}" target="_blank" rel="noopener">📎 ${p.metodo === 'canje' ? 'Captura ENACOM · ' : ''}${esc(c.nombre_original || 'comprobante')}</a>`).join('<br>') || (sinCaptura ? '<span class="pv-badge alerta">Sin verificar en ENACOM</span>' : '<span style="opacity:.5">—</span>');
      const vig = p.estado === 'vigente';
      const verif = vig ? `<span class="pv-badge ${p.verificacion === 'verificado' ? 'ok' : (p.verificacion === 'con_diferencia' ? 'error' : 'alerta')}">${NOMBRE_VERIF[p.verificacion]}</span>${p.nota_verificacion ? '<br><span style="opacity:.7">' + esc(p.nota_verificacion) + '</span>' : ''}${p.verificado_por ? '<br><span style="opacity:.6">' + esc(p.verificado_por) + '</span>' : ''}` : `<span class="pv-badge error">Anulado</span><br><span style="opacity:.7">${esc(p.motivo_anulacion || '')}</span>`;
      const acciones = vig && !anulada ? `<div class="pv-acciones">
          <button class="pv-btn bueno" data-accion="verificar" data-pago="${p.id}">Verificar</button>
          <button class="pv-btn" data-accion="diferencia" data-pago="${p.id}">Con diferencia</button>
          ${esAdmin ? `<button class="pv-btn peligro" data-accion="anular-pago" data-pago="${p.id}">Anular</button>` : ''}</div>` : '';
      return `<tr><td>${NOMBRE_METODO[p.metodo] || esc(p.metodo)}${p.cuotas ? ' · ' + p.cuotas + ' cuotas' : ''}${p.cuenta ? '<br><span style="opacity:.7">' + esc(p.cuenta) + (p.cuenta_alias ? ' · ' + esc(p.cuenta_alias) : '') + '</span>' : ''}</td>
        <td class="num">${enMoneda}</td><td class="num">${pesos(p.equiv_ars_centavos)}</td><td>${esc(p.referencia || '')}</td><td>${comps}</td><td>${verif}${acciones}</td></tr>`;
    }).join('');
    const filasItems = d.items.map(i => `<tr><td>${esc(i.descripcion)}${i.bateria_pct ? ' · batería ' + i.bateria_pct + '%' : ''}</td><td>${esc(i.imei_serie || '')}</td><td class="num">${pesos(i.precio_centavos)}</td>
        <td>${i.garantia_meses ? i.garantia_meses + ' meses (hasta ' + esc(i.hasta || '') + ')' + (i.garantia_estado && i.garantia_estado !== 'vigente' ? ' · ' + esc(i.garantia_estado) : '') : '—'}</td></tr>`).join('');
    const canje = d.canjes.map(c => `<p style="margin:2px 0;">${esc(c.modelo)} ${esc(c.capacidad || '')} ${esc(c.color || '')} · IMEI ${esc(c.imei_serie)}${c.bateria_pct ? ' · batería ' + c.bateria_pct + '%' : ''} · valor ${pesos(c.valor_centavos)}${c.falla ? ' · falla: ' + esc(c.falla) : ''}</p>`).join('');
    const aud = d.auditoria ? `<h4>Historial (auditoría)</h4><table>${d.auditoria.map(a => `<tr><td>${fechaCorta(a.fecha_hora)}</td><td>${esc(a.accion)}</td><td>${esc(a.usuario || '')} (${esc(a.rol || '')})</td><td>${esc(a.nota || '')}</td></tr>`).join('')}</table>` : '';
    return `
      <h4>Cliente</h4><p style="margin:2px 0;">${esc(v.cliente)} · DNI ${esc(v.cliente_dni || '')} · ${esc(v.cliente_email || '')}${v.telefono ? ' · <a href="' + esc(enlaceWa(v.telefono, '')) + '" target="_blank" rel="noopener">📱 ' + esc(v.telefono) + '</a>' : ' · <span class="pv-suave">sin teléfono</span>'}${v.domicilio ? ' · ' + esc(v.domicilio) : ''}</p>
      ${anulada ? `<p style="margin:6px 0;"><span class="pv-badge error">Venta anulada</span> ${esc(v.motivo_anulacion || '')}</p>` : ''}
      <h4>Productos</h4><table><thead><tr><th>Producto</th><th>IMEI / Serie</th><th class="num">Precio</th><th>Garantía</th></tr></thead><tbody>${filasItems}</tbody></table>
      ${canje ? '<h4>Equipo recibido en canje</h4>' + canje : ''}
      <h4>Pagos</h4>${d.pagos.length ? `<table><thead><tr><th>Forma</th><th class="num">Monto</th><th class="num">Suma a la venta</th><th>N° operación</th><th>Comprobante</th><th>Verificación</th></tr></thead><tbody>${filasPagos}</tbody></table>` : '<p style="margin:2px 0; opacity:.7;">No se cargó ningún cobro.</p>'}
      ${htmlDevoluciones(d)}
      ${htmlPosventa(d)}
      ${aud}
      ${rol === 'admin' && v.estado_venta === 'registrada' ? `<div class="pv-acciones" style="margin-top:12px;"><button class="pv-btn peligro" data-accion="anular-venta" data-venta="${v.venta_id}" data-local="${esc(v.local || '')}">Anular venta</button></div>` : ''}`;
  }

  // Deposito al que vuelve el equipo de una venta anulada (con el stock en la base el servidor usa el de origen).
  function depositoDeLocal(l) {
    const t = String(l || '').toLowerCase();
    return /olmos/.test(t) ? 'OLMOS' : /nuevo centro/.test(t) ? 'NUEVO CENTRO' : /dino/.test(t) ? 'DINO' : /independencia/.test(t) ? 'INDEPENDENCIA' : '';
  }

  // ---------- acciones ----------
  async function accion(boton) {
    const a = boton.getAttribute('data-accion');
    if (!['verificar', 'diferencia', 'anular-pago', 'anular-venta'].includes(a)) return accionPosventa(boton);
    const pago = boton.getAttribute('data-pago');
    try {
      if (a === 'verificar') { await pApi('POST', '/api/panel/pagos/' + pago + '/verificar', { resultado: 'verificado' }); aviso('success', 'Pago verificado'); }
      else if (a === 'diferencia') {
        const nota = window.prompt('¿Cuál es la diferencia? (por ejemplo: en el banco entraron $480.000)');
        if (nota === null) return;
        await pApi('POST', '/api/panel/pagos/' + pago + '/verificar', { resultado: 'con_diferencia', nota }); aviso('warning', 'Pago marcado con diferencia: se avisó a administración');
      } else if (a === 'anular-pago') {
        const motivo = window.prompt('Motivo de la anulación del pago (queda registrado):');
        if (motivo === null) return;
        await pApi('POST', '/api/panel/pagos/' + pago + '/anular', { motivo }); aviso('success', 'Pago anulado');
      } else if (a === 'anular-venta') {
        const motivo = window.prompt('Motivo de la anulación de la VENTA (también se anulan sus pagos y su garantía):');
        if (motivo === null) return;
        const dep = depositoDeLocal(boton.getAttribute('data-local'));
        if (!window.confirm('¿Anular esta venta? No se puede deshacer. El equipo vuelve al stock' + (dep ? ' (' + dep + ' si el stock sigue en la planilla)' : '') + '.')) return;
        const j = await pApi('POST', '/api/panel/ventas/' + boton.getAttribute('data-venta') + '/anular', { motivo, deposito: dep || undefined }); aviso('warning', j.aviso || 'Venta anulada');
      }
    } catch (e) { return aviso('error', e.message); }
    const id = abierta;
    await cargar(true);
    if (id) abrirDetalle(id);
  }

  function clickTabla(ev) {
    const boton = ev.target.closest('[data-accion]');
    if (boton) { ev.stopPropagation(); return accion(boton); }
    if (ev.target.closest('a')) return;
    const fila = ev.target.closest('tr.fila');
    if (fila) abrirDetalle(Number(fila.getAttribute('data-venta')));
  }

  // ---------- alertas y auditoria ----------
  async function alternarAlertas(forzarAbrir) {
    const caja = $id('pvAlertas');
    if (caja.style.display !== 'none' && forzarAbrir !== true) { caja.style.display = 'none'; return; }
    try {
      const j = await pApi('GET', '/api/panel/alertas');
      caja.style.display = '';
      caja.innerHTML = '<h4 style="margin:6px 0;">Alertas pendientes</h4>' + (j.alertas.length
        ? j.alertas.map(a => `<div class="pv-alerta"><div><b>${esc(a.tipo.replace(/_/g, ' '))}</b> · ${fechaCorta(a.fecha_hora)}<br>${esc(a.detalle)}</div><button class="pv-btn bueno" data-alerta="${a.id}">Resolver</button></div>`).join('')
        : '<div class="pv-vacio">No hay alertas pendientes.</div>');
    } catch (e) { aviso('error', e.message); }
  }

  async function clickAlertas(ev) {
    const b = ev.target.closest('[data-alerta]');
    if (!b) return;
    try { await pApi('POST', '/api/panel/alertas/' + b.getAttribute('data-alerta') + '/resolver', {}); await alternarAlertas(true); resumen().catch(() => {}); } catch (e) { aviso('error', e.message); }
  }

  async function verAuditoria() {
    try {
      const j = await pApi('GET', '/api/panel/auditoria');
      const caja = $id('pvAlertas');
      caja.style.display = '';
      caja.innerHTML = '<h4 style="margin:6px 0;">Auditoría (últimos 300 movimientos)</h4><div class="pv-tabla-wrap"><table class="pv"><thead><tr><th>Fecha</th><th>Acción</th><th>Usuario</th><th>Detalle</th></tr></thead><tbody>' +
        j.auditoria.map(a => `<tr><td>${fechaCorta(a.fecha_hora)}</td><td>${esc(a.accion)}</td><td>${esc(a.usuario || '')} (${esc(a.rol || '')})</td><td>${esc(a.nota || '')}</td></tr>`).join('') + '</tbody></table></div>';
    } catch (e) { aviso('error', e.message); }
  }

  // ---------- Excel ----------
  async function exportar() {
    if (typeof XLSX === 'undefined') return aviso('error', 'No se cargó el componente de Excel: revisá la conexión.');
    try {
      const p = filtrosActuales(); p.set('exportar', '1');
      const j = await pApi('GET', '/api/panel/ventas?' + p.toString());
      const pe = c => Math.round((c || 0)) / 100;
      const hojaVentas = j.ventas.map(v => ({
        'Código': v.codigo, 'Fecha': v.fecha_local, 'Estado': v.estado_venta, 'Cliente': v.cliente, 'DNI': v.cliente_dni, 'Email': v.cliente_email,
        'Local': v.local, 'Vendedor': v.vendedor, 'Productos': v.productos, 'Total': pe(v.total_centavos), 'Cobrado': pe(v.pagado_centavos),
        'Estado de cobro': NOMBRE_COBRO[v.estado_cobro] || v.estado_cobro, 'Pagos por verificar': v.pagos_sin_verificar, 'Pagos con diferencia': v.pagos_con_diferencia
      }));
      const hojaPagos = j.pagos.map(x => ({
        'Código venta': x.codigo, 'Forma de pago': NOMBRE_METODO[x.metodo] || x.metodo, 'Moneda': x.moneda, 'Monto': pe(x.monto_centavos),
        'Cotización': x.cotizacion_usd_x100 ? x.cotizacion_usd_x100 / 100 : '', 'Suma a la venta ($)': pe(x.equiv_ars_centavos), 'Cuotas': x.cuotas || '',
        'Cuenta': x.cuenta || '', 'N° operación': x.referencia || '', 'Verificación': NOMBRE_VERIF[x.verificacion] || x.verificacion, 'Estado del pago': x.estado, 'Fecha': x.creado_en
      }));
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(hojaVentas), 'Ventas');
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(hojaPagos), 'Pagos');
      XLSX.writeFile(libro, 'ventas_' + new Date().toISOString().slice(0, 10) + '.xlsx');
      aviso('success', 'Exportadas ' + hojaVentas.length + ' ventas y ' + hojaPagos.length + ' pagos');
    } catch (e) { aviso('error', e.message); }
  }

  // ============================ POSVENTA ============================
  const ESTRELLAS = n => '★'.repeat(n) + '☆'.repeat(5 - n);
  const NOMBRE_SEG = { pendiente: 'Pendiente', contactado: 'Contactado', respondio: 'Respondió', cerrado: 'Cerrado', no_contactar: 'No contactar' };
  const NOMBRE_RECLAMO = { abierto: 'Abierto', en_revision: 'En revisión', reparado: 'Reparado', cambiado: 'Cambiado', rechazado: 'Rechazado', cerrado: 'Cerrado' };
  const hoyLocal = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const pila = n => String(n || '').split(' ')[0];
  // wa.me necesita el numero internacional. Se guarda tal cual lo cargo el vendedor
  // (351 1234567); para celulares argentinos wa.me quiere 54 + 9 + area + numero.
  const numeroWa = tel => {
    let n = String(tel || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!n) return '';
    if (n.startsWith('549')) return n;
    if (n.startsWith('54')) return '549' + n.slice(2);
    return n.length === 10 ? '549' + n : n;
  };
  const enlaceWa = (tel, texto) => 'https://wa.me/' + numeroWa(tel) + (texto ? '?text=' + encodeURIComponent(texto) : '');
  const enlaceMail = (email, asunto, texto) => 'mailto:' + (email || '') + '?subject=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(texto);
  const urlResenia = local => (typeof RESENIA !== 'undefined' && RESENIA[local] && RESENIA[local].url) || '';
  const textoEncuesta = (v, url) => 'Hola ' + pila(v.cliente) + '! Gracias por tu compra en ' + v.local + '. ¿Nos contás cómo te fue? Son 30 segundos: ' + url;
  const textoResenia = v => { const u = urlResenia(v.local); return 'Hola ' + pila(v.cliente) + '! ¿Cómo te está yendo con tu equipo? Si te gustó la atención, nos ayuda mucho una reseña en Google' + (u ? ': ' + u : '.') + ' ¡Gracias!'; };
  const opciones = (mapa, actual, vacio) => (vacio ? '<option value="">' + vacio + '</option>' : '') + Object.keys(mapa).map(k => `<option value="${k}"${k === actual ? ' selected' : ''}>${mapa[k]}</option>`).join('');

  // Seccion "Seguimiento posventa" dentro del detalle de una venta.
  function htmlPosventa(d) {
    const v = d.venta;
    if (v.estado_venta === 'anulada') return '';
    const p = d.posventa || { seguimiento: null, eventos: [], encuestas: [], reclamos: [] };
    const seg = p.seguimiento;
    let h = '<div class="pv-seccion"><h4>Seguimiento posventa</h4>';
    if (!seg) {
      h += `<button class="pv-btn bueno" data-accion="seg-crear" data-venta="${v.venta_id}">Hacerle seguimiento</button> <span class="pv-suave">El primer contacto queda programado a los 3 días.</span>`;
    } else {
      h += `<div class="pv-form-linea">
          <label>Estado<select data-campo="seg-estado">${opciones(NOMBRE_SEG, seg.estado)}</select></label>
          <label>Próxima acción<input type="date" data-campo="seg-proxima" value="${esc(seg.proxima_accion_en || '')}"></label>
          <label>Canal preferido<select data-campo="seg-canal">${opciones({ whatsapp: 'WhatsApp', mail: 'Mail', llamada: 'Llamada' }, seg.canal_preferido, 'Sin definir')}</select></label>
          <button class="pv-btn" data-accion="seg-guardar" data-seg="${seg.id}">Guardar</button></div>
        <p class="pv-suave" style="margin:2px 0;">Iniciado por ${esc(seg.creado_por || '')} el ${fechaCorta(seg.creado_en)}</p>
        <div class="pv-form-linea">
          <label>Contacto<select data-campo="ev-tipo">${opciones({ contacto: 'Hablé con el cliente', nota: 'Nota interna' }, 'contacto')}</select></label>
          <label>Canal<select data-campo="ev-canal">${opciones({ whatsapp: 'WhatsApp', mail: 'Mail', llamada: 'Llamada', presencial: 'Presencial' }, '', '—')}</select></label>
          <label style="flex:1; min-width:180px;">Qué pasó<input type="text" data-campo="ev-detalle" maxlength="1000" placeholder="Ej. Está contento, le llegó bien el mail"></label>
          <button class="pv-btn bueno" data-accion="seg-evento" data-seg="${seg.id}">Agregar a la bitácora</button></div>`;
      h += p.eventos.length ? `<table style="margin-top:6px;">${p.eventos.map(e => `<tr><td style="white-space:nowrap;">${fechaCorta(e.fecha_hora)}</td><td>${esc(e.tipo.replace(/_/g, ' '))}${e.canal ? ' · ' + esc(e.canal) : ''}</td><td>${esc(e.detalle || '')}</td><td class="pv-suave">${esc(e.usuario || '')}</td></tr>`).join('')}</table>` : '<p class="pv-suave">La bitácora está vacía.</p>';
      const resp = urlResenia(v.local);
      h += `<div class="pv-acciones" style="margin-top:8px;">
          <button class="pv-btn" data-accion="res-wa" data-seg="${seg.id}" data-href="${esc(enlaceWa(v.cliente_telefono, textoResenia(v)))}">Recordar reseña por WhatsApp</button>
          <button class="pv-btn" data-accion="res-mail" data-seg="${seg.id}" data-href="${esc(enlaceMail(v.cliente_email, 'Tu opinión nos ayuda', textoResenia(v)))}">Recordar reseña por mail</button>
          ${resp ? '' : '<span class="pv-suave">(este local no tiene link de reseña cargado)</span>'}</div>`;
    }
    // Encuesta: link de un solo uso.
    const enc = p.encuestas[0];
    h += '<h4>Encuesta de satisfacción</h4>';
    if (enc && enc.respondida_en) {
      h += `<p style="margin:2px 0;"><span class="pv-estrellas">${ESTRELLAS(enc.puntaje)}</span> ${enc.puntaje}/5 · ${fechaCorta(enc.respondida_en)}</p>${enc.comentario ? '<p style="margin:2px 0;">“' + esc(enc.comentario) + '”</p>' : ''}${enc.mejora_sugerida ? '<p style="margin:2px 0;"><b>A mejorar:</b> ' + esc(enc.mejora_sugerida) + '</p>' : ''}`;
    } else if (enc) {
      const url = location.origin + '/e/' + enc.token;
      h += `<p class="pv-suave" style="margin:2px 0;">Link generado el ${fechaCorta(enc.creada_en)}, todavía sin responder. Sirve una sola vez y vence a los 90 días.</p><div class="pv-link">${esc(url)}</div>
        <div class="pv-acciones"><button class="pv-btn" data-accion="enc-copiar" data-url="${esc(url)}">Copiar link</button>
          <button class="pv-btn" data-accion="enc-wa" data-seg="${seg ? seg.id : ''}" data-href="${esc(enlaceWa(v.cliente_telefono, textoEncuesta(v, url)))}">Enviar por WhatsApp</button>
          <button class="pv-btn" data-accion="enc-mail" data-seg="${seg ? seg.id : ''}" data-href="${esc(enlaceMail(v.cliente_email, 'Contanos cómo te fue', textoEncuesta(v, url)))}">Enviar por mail</button></div>`;
    } else {
      h += `<button class="pv-btn" data-accion="enc-crear" data-venta="${v.venta_id}">Generar link de encuesta</button>`;
    }
    // Reclamos de garantia.
    h += '<h4>Garantía y reclamos</h4>';
    h += p.reclamos.map(r => `<div style="margin:4px 0;"><span class="pv-badge ${['abierto', 'en_revision'].includes(r.estado) ? 'alerta' : 'ok'}">${NOMBRE_RECLAMO[r.estado]}</span> ${esc(r.producto)} · ${fechaCorta(r.abierto_en)} — ${esc(r.descripcion)}${r.resolucion ? ' → <b>' + esc(r.resolucion) + '</b>' : ''}
        ${['abierto', 'en_revision'].includes(r.estado) ? `<span class="pv-acciones" style="display:inline-flex;"><button class="pv-btn" data-accion="reclamo-revision" data-reclamo="${r.id}">En revisión</button><button class="pv-btn bueno" data-accion="reclamo-resolver" data-reclamo="${r.id}">Resolver</button></span>` : ''}</div>`).join('');
    const reclamables = d.items.filter(i => i.garantia_id && i.garantia_estado === 'vigente');
    h += reclamables.length ? `<div class="pv-acciones">${reclamables.map(i => `<button class="pv-btn" data-accion="reclamo-abrir" data-garantia="${i.garantia_id}" data-producto="${esc(i.descripcion)}">Abrir reclamo: ${esc(i.descripcion)}</button>`).join('')}</div>` : (p.reclamos.length ? '' : '<p class="pv-suave" style="margin:2px 0;">Sin reclamos.</p>');
    return h + '</div>';
  }

  // Acciones de posventa (se llaman desde el detalle de la venta y desde las pestanas).
  async function accionPosventa(boton) {
    const a = boton.getAttribute('data-accion');
    if (a === 'dev-abrir') {   // mostrar / ocultar el formulario de devolucion de ese producto
      const f = document.querySelector('.pv-devform[data-item="' + boton.getAttribute('data-item') + '"]');
      if (f) f.style.display = f.style.display === 'none' ? '' : 'none';
      return;
    }
    // Los enlaces de WhatsApp / mail se abren ANTES de cualquier espera (si no, el navegador bloquea la ventana).
    if (['enc-wa', 'enc-mail', 'res-wa', 'res-mail'].includes(a) && boton.getAttribute('data-href')) window.open(boton.getAttribute('data-href'), '_blank', 'noopener');
    const sec = boton.closest('.pv-seccion');
    const campo = n => { const e = sec && sec.querySelector('[data-campo=' + n + ']'); return e ? e.value : ''; };
    const seg = boton.getAttribute('data-seg');
    try {
      if (a === 'seg-crear') { await pApi('POST', '/api/panel/ventas/' + boton.getAttribute('data-venta') + '/seguimiento', {}); aviso('success', 'Seguimiento iniciado'); }
      else if (a === 'seg-guardar') { await pApi('POST', '/api/panel/seguimientos/' + seg, { estado: campo('seg-estado'), proximaAccion: campo('seg-proxima') || null, canal: campo('seg-canal') || null }); aviso('success', 'Seguimiento actualizado'); }
      else if (a === 'seg-evento') { await pApi('POST', '/api/panel/seguimientos/' + seg + '/eventos', { tipo: campo('ev-tipo'), canal: campo('ev-canal') || null, detalle: campo('ev-detalle') }); aviso('success', 'Agregado a la bitácora'); }
      else if (a === 'enc-crear') { await pApi('POST', '/api/panel/ventas/' + boton.getAttribute('data-venta') + '/encuesta', {}); aviso('success', 'Link de encuesta generado'); }
      else if (a === 'enc-copiar') {
        const url = boton.getAttribute('data-url');
        try { await navigator.clipboard.writeText(url); aviso('success', 'Link copiado'); } catch (e) { window.prompt('Copiá el link:', url); }
        return;
      } else if (['enc-wa', 'enc-mail'].includes(a)) { if (seg) await pApi('POST', '/api/panel/seguimientos/' + seg + '/eventos', { tipo: 'encuesta_enviada', canal: a === 'enc-wa' ? 'whatsapp' : 'mail', detalle: 'Se envió el link de la encuesta' }); }
      else if (['res-wa', 'res-mail'].includes(a)) { await pApi('POST', '/api/panel/seguimientos/' + seg + '/eventos', { tipo: 'recordatorio_resenia', canal: a === 'res-wa' ? 'whatsapp' : 'mail', detalle: 'Se le recordó dejar una reseña' }); aviso('success', 'Recordatorio anotado en la bitácora'); }
      else if (a === 'reclamo-abrir') {
        const desc = window.prompt('¿Qué falla tiene el equipo? (' + boton.getAttribute('data-producto') + ')');
        if (desc === null) return;
        await pApi('POST', '/api/panel/garantias/' + boton.getAttribute('data-garantia') + '/reclamo', { descripcion: desc }); aviso('success', 'Reclamo abierto');
      } else if (a === 'reclamo-revision') { await pApi('POST', '/api/panel/reclamos/' + boton.getAttribute('data-reclamo'), { estado: 'en_revision' }); aviso('success', 'Reclamo en revisión'); }
      else if (a === 'reclamo-resolver') {
        const estado = window.prompt('¿Cómo terminó? Escribí: reparado, cambiado, rechazado o cerrado', 'reparado');
        if (estado === null) return;
        const resolucion = window.prompt('Contá cómo se resolvió:');
        if (resolucion === null) return;
        await pApi('POST', '/api/panel/reclamos/' + boton.getAttribute('data-reclamo'), { estado: estado.trim().toLowerCase(), resolucion }); aviso('success', 'Reclamo resuelto');
      } else if (a === 'dev-enviar') {
        const f = boton.closest('.pv-devform');
        const v = n => (f.querySelector('[data-campo=' + n + ']') || {}).value;
        const reingresa = f.querySelector('[data-campo=dev-reingresa]').checked;
        const monto = num(v('dev-monto'));
        const j = await pApi('POST', '/api/panel/ventas/' + boton.getAttribute('data-venta') + '/devolucion', {
          itemId: Number(boton.getAttribute('data-item')), tipo: v('dev-tipo'), motivo: v('dev-motivo'),
          reintegroMonto: monto || 0, reintegroMetodo: monto ? v('dev-metodo') : undefined, reingresaStock: reingresa, deposito: reingresa ? v('dev-deposito') : undefined
        });
        if (j.reingreso && j.reingreso.estado === 'fallo') aviso('warning', 'Devolución registrada, pero el equipo NO volvió al stock (' + j.reingreso.detalle + '). Podés repetir el reingreso desde el detalle de la venta.');
        else aviso('success', 'Devolución registrada' + (j.reingreso ? ' y equipo reingresado al stock' : ''));
      } else if (a === 'dev-reingreso') {
        const dep = window.prompt('¿A qué depósito vuelve el equipo? (OLMOS, DINO, NUEVO CENTRO, INDEPENDENCIA, DEPO)', 'OLMOS');
        if (dep === null) return;
        const j = await pApi('POST', '/api/panel/devoluciones/' + boton.getAttribute('data-dev') + '/reingresar-stock', { deposito: dep });
        if (j.reingreso.estado === 'hecho') aviso('success', 'El equipo volvió al stock'); else aviso('warning', 'Sigue sin poder reingresarse: ' + j.reingreso.detalle);
      }
    } catch (e) { return aviso('error', e.message); }
    if (tabActual === 'ventas') { const id = abierta; await cargar(true); if (id) abrirDetalle(id); } else irA(tabActual);
  }

  let tabActual = 'ventas';
  let filtroSeg = 'abiertos';
  let verCerradosReclamos = false;

  function irA(tab) {
    tabActual = tab;
    document.querySelectorAll('#pvTabs .pv-tab').forEach(b => b.classList.toggle('activa', b.getAttribute('data-tab') === tab));
    ['ventas', 'seguimiento', 'garantias', 'reclamos', 'encuestas', 'caja', 'comisiones', 'stock'].forEach(t => { $id('pvVista_' + t).style.display = t === tab ? '' : 'none'; });
    resumen().catch(() => {});
    if (tab === 'stock') cargarStock();
    else if (tab === 'caja') cargarCaja();
    else if (tab === 'comisiones') cargarComisiones();
    else if (tab === 'seguimiento') cargarSeguimientos();
    else if (tab === 'garantias') cargarGarantias();
    else if (tab === 'reclamos') cargarReclamos();
    else if (tab === 'encuestas') cargarEncuestas();
  }

  async function verVenta(id, codigo) {
    irA('ventas');
    limpiarFiltros();
    $id('pvQ').value = codigo || '';
    await cargar(true);
    abrirDetalle(id);
  }

  function clickPosventa(ev) {
    const ver = ev.target.closest('[data-ver-venta]');
    if (ver) return verVenta(Number(ver.getAttribute('data-ver-venta')), ver.getAttribute('data-codigo'));
    const f = ev.target.closest('[data-filtro-seg]');
    if (f) { filtroSeg = f.getAttribute('data-filtro-seg'); return cargarSeguimientos(); }
    if (ev.target.closest('[data-toggle-reclamos]')) { verCerradosReclamos = !verCerradosReclamos; return cargarReclamos(); }
    const b = ev.target.closest('[data-accion]');
    if (b) return accionPosventa(b);
  }

  const contacto = x => [x.email ? `<a href="mailto:${esc(x.email)}">${esc(x.email)}</a>` : '', x.telefono ? `<a href="${esc(enlaceWa(x.telefono, ''))}" target="_blank" rel="noopener">${esc(x.telefono)}</a>` : ''].filter(Boolean).join('<br>') || '<span class="pv-suave">—</span>';
  const vacioHtml = t => `<div class="pv-vacio">${t}</div>`;

  async function cargarSeguimientos() {
    const caja = $id('pvVista_seguimiento');
    try {
      const q = filtroSeg === 'vencidos' ? '?vencidos=1' : (filtroSeg === 'cerrado' ? '?estado=cerrado' : (filtroSeg === 'no_contactar' ? '?estado=no_contactar' : ''));
      const j = await pApi('GET', '/api/panel/seguimientos' + q);
      const btn = (k, t) => `<button type="button" class="pv-btn" data-filtro-seg="${k}" style="${filtroSeg === k ? 'background:var(--ap-accent,#0071e3);color:#fff;' : ''}">${t}</button>`;
      caja.innerHTML = `<div class="pv-acciones" style="margin-bottom:10px;">${btn('abiertos', 'Abiertos')}${btn('vencidos', 'Para hoy o vencidos')}${btn('cerrado', 'Cerrados')}${btn('no_contactar', 'No contactar')}</div>` +
        (j.seguimientos.length ? `<div class="pv-tabla-wrap"><table class="pv"><thead><tr><th>Próxima acción</th><th>Venta</th><th>Cliente</th><th>Contacto</th><th>Productos</th><th>Estado</th><th>Encuesta</th><th class="num">Contactos</th></tr></thead><tbody>` +
          j.seguimientos.map(s => `<tr class="fila" data-ver-venta="${s.venta_id}" data-codigo="${esc(s.codigo)}"><td class="${s.proxima_accion_en && s.proxima_accion_en <= j.hoy && ['pendiente', 'contactado'].includes(s.estado) ? 'pv-vencida' : ''}">${esc(s.proxima_accion_en || '—')}</td><td><b>${esc(s.codigo)}</b><br><span class="pv-suave">${esc(s.local)}</span></td><td>${esc(s.cliente)}</td><td>${contacto(s)}</td><td>${esc(s.productos)}</td><td><span class="pv-badge ${s.estado === 'respondio' ? 'ok' : (s.estado === 'pendiente' ? 'alerta' : '')}">${NOMBRE_SEG[s.estado]}</span></td><td>${s.puntaje ? '<span class="pv-estrellas">' + ESTRELLAS(s.puntaje) + '</span>' : '<span class="pv-suave">—</span>'}</td><td class="num">${s.eventos}</td></tr>`).join('') + '</tbody></table></div>'
          : vacioHtml(filtroSeg === 'vencidos' ? 'No hay seguimientos para hoy ni vencidos. 👌' : 'No hay seguimientos en esta lista. Se inician desde el detalle de una venta.'));
    } catch (e) { aviso('error', e.message); }
  }

  async function cargarGarantias() {
    const caja = $id('pvVista_garantias');
    try {
      const j = await pApi('GET', '/api/panel/garantias-por-vencer');
      caja.innerHTML = '<p class="pv-suave">Garantías vigentes que vencen en los próximos 15 días (una buena excusa para hablarle al cliente).</p>' + (j.garantias.length
        ? `<div class="pv-tabla-wrap"><table class="pv"><thead><tr><th>Vence</th><th>Cliente</th><th>Contacto</th><th>Producto</th><th>IMEI / Serie</th><th>Venta</th><th></th></tr></thead><tbody>` +
          j.garantias.map(g => `<tr><td><b>${esc(g.hasta)}</b><br><span class="${g.dias_restantes <= 3 ? 'pv-vencida' : 'pv-suave'}">${g.dias_restantes === 0 ? 'vence hoy' : 'en ' + g.dias_restantes + ' días'}</span></td><td>${esc(g.cliente)}</td><td>${contacto(g)}</td><td>${esc(g.descripcion)}</td><td>${esc(g.imei_serie || '')}</td><td>${esc(g.venta)}</td>
            <td><a class="pv-btn" style="text-decoration:none;" href="${esc(enlaceMail(g.email, 'Tu garantía de Jobs Company está por vencer', 'Hola ' + pila(g.cliente) + '! Te escribimos para avisarte que la garantía de tu ' + g.descripcion + ' vence el ' + g.hasta + '. Si tenés algo para revisar, traelo antes de esa fecha. ¡Gracias por elegirnos!'))}">Avisar por mail</a></td></tr>`).join('') + '</tbody></table></div>'
        : vacioHtml('No hay garantías por vencer en los próximos 15 días.'));
    } catch (e) { aviso('error', e.message); }
  }

  async function cargarReclamos() {
    const caja = $id('pvVista_reclamos');
    try {
      const j = await pApi('GET', '/api/panel/reclamos' + (verCerradosReclamos ? '?todos=1' : ''));
      caja.innerHTML = `<div class="pv-acciones" style="margin-bottom:10px;"><button type="button" class="pv-btn" data-toggle-reclamos="1">${verCerradosReclamos ? 'Ver solo abiertos' : 'Ver también los resueltos'}</button></div><p class="pv-suave">Los reclamos se abren desde el detalle de la venta (sección “Garantía y reclamos”).</p>` +
        (j.reclamos.length ? `<div class="pv-tabla-wrap"><table class="pv"><thead><tr><th>Abierto</th><th>Cliente</th><th>Contacto</th><th>Equipo</th><th>Falla</th><th>Estado</th><th></th></tr></thead><tbody>` +
          j.reclamos.map(r => `<tr class="pv-seccion"><td>${fechaCorta(r.abierto_en)}</td><td>${esc(r.cliente)}<br><span class="pv-suave">${esc(r.codigo)}</span></td><td>${contacto(r)}</td><td>${esc(r.producto)}<br><span class="pv-suave">${esc(r.imei_serie || '')}</span></td><td>${esc(r.descripcion)}${r.tecnico ? '<br><span class="pv-suave">Técnico: ' + esc(r.tecnico) + '</span>' : ''}${r.resolucion ? '<br><b>' + esc(r.resolucion) + '</b>' : ''}</td>
            <td><span class="pv-badge ${['abierto', 'en_revision'].includes(r.estado) ? 'alerta' : 'ok'}">${NOMBRE_RECLAMO[r.estado]}</span></td>
            <td>${['abierto', 'en_revision'].includes(r.estado) ? `<div class="pv-acciones">${r.estado === 'abierto' ? `<button class="pv-btn" data-accion="reclamo-revision" data-reclamo="${r.id}">En revisión</button>` : ''}<button class="pv-btn bueno" data-accion="reclamo-resolver" data-reclamo="${r.id}">Resolver</button></div>` : ''}<a href="#" class="pv-suave" data-ver-venta="${r.venta_id}" data-codigo="${esc(r.codigo)}">Ver venta</a></td></tr>`).join('') + '</tbody></table></div>'
          : vacioHtml(verCerradosReclamos ? 'Todavía no hay reclamos.' : 'No hay reclamos abiertos. 👌'));
    } catch (e) { aviso('error', e.message); }
  }

  async function cargarEncuestas() {
    const caja = $id('pvVista_encuestas');
    try {
      const j = await pApi('GET', '/api/panel/encuestas');
      const e = j.estadisticas;
      caja.innerHTML = `<div class="pv-totales"><b>${e.respondidas}</b> respondidas${e.respondidas ? ' · promedio <b class="pv-estrellas">' + ESTRELLAS(Math.round(e.promedio)) + '</b> <b>' + e.promedio + '</b>/5' : ''} · <b>${e.sin_responder}</b> links esperando respuesta</div>` +
        (j.encuestas.length ? `<div class="pv-tabla-wrap"><table class="pv"><thead><tr><th>Fecha</th><th>Puntaje</th><th>Cliente</th><th>Qué dijo</th><th>A mejorar</th><th>Venta</th></tr></thead><tbody>` +
          j.encuestas.map(x => `<tr class="fila" data-ver-venta="${x.venta_id}" data-codigo="${esc(x.codigo)}"><td>${fechaCorta(x.respondida_en)}</td><td><span class="pv-estrellas">${ESTRELLAS(x.puntaje)}</span></td><td>${esc(x.cliente)}<br><span class="pv-suave">${esc(x.local)}</span></td><td>${esc(x.comentario || '')}</td><td>${esc(x.mejora_sugerida || '')}</td><td>${esc(x.codigo)}</td></tr>`).join('') + '</tbody></table></div>'
          : vacioHtml('Todavía nadie respondió la encuesta. El link se genera desde el detalle de cada venta.'));
    } catch (er) { aviso('error', er.message); }
  }

  // ============================ DEVOLUCIONES, CAJA Y COMISIONES ============================
  const num = v => { const n = Number(String(v == null ? '' : v).trim().replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
  const usd = c => 'USD ' + ((c || 0) / 100).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const DEPOSITOS = ['OLMOS', 'DINO', 'NUEVO CENTRO', 'INDEPENDENCIA', 'DEPO'];
  const NOMBRE_REINTEGRO = { efectivo: 'Efectivo', transferencia: 'Transferencia', usdt: 'USDT', credito_a_favor: 'Crédito a favor' };

  // Seccion "Devoluciones" dentro del detalle de una venta (oficina y administrador).
  function htmlDevoluciones(d) {
    const v = d.venta;
    const devueltos = new Set((d.devoluciones || []).map(x => x.venta_item_id));
    let h = '';
    if ((d.devoluciones || []).length) {
      h += '<div class="pv-seccion"><h4>Devoluciones</h4>' + d.devoluciones.map(x => {
        const it = d.items.find(i => i.id === x.venta_item_id);
        const reingreso = !x.reingresa_a_stock ? '<span class="pv-suave">no vuelve al stock</span>'
          : (x.reingreso_estado === 'hecho' ? `<span class="pv-badge ok">volvió al stock (${esc(x.deposito || '')})</span>`
            : `<span class="pv-badge error">NO volvió al stock</span> <span class="pv-suave">${esc(x.reingreso_detalle || '')}</span> <button class="pv-btn" data-accion="dev-reingreso" data-dev="${x.id}">Repetir reingreso</button>`);
        return `<div style="margin:6px 0;"><span class="pv-badge alerta">${x.tipo === 'cambio' ? 'Cambio' : 'Devolución'}</span> <b>${esc(it ? it.descripcion : '')}</b> · ${fechaCorta(x.fecha_hora)} · ${esc(x.registrado_por || '')}
          <br>${esc(x.motivo)}${x.monto_reintegrado_centavos ? ' · reintegro <b>' + pesos(x.monto_reintegrado_centavos) + '</b> (' + esc(NOMBRE_REINTEGRO[x.metodo_reintegro] || x.metodo_reintegro) + ')' : ' · sin reintegro de dinero'}<br>${reingreso}</div>`;
      }).join('') + '</div>';
    }
    if (v.estado_venta === 'anulada') return h;
    const devolvibles = d.items.filter(i => !devueltos.has(i.id));
    if (!devolvibles.length) return h;
    h += '<div class="pv-seccion"><h4>Registrar una devolución o cambio</h4>' + devolvibles.map(i => `
      <div style="margin:4px 0;"><button class="pv-btn" data-accion="dev-abrir" data-item="${i.id}">Devolver / cambiar: ${esc(i.descripcion)}</button>
        <div class="pv-devform" data-item="${i.id}" style="display:none; margin:6px 0 10px; padding:10px; border:1px solid var(--ap-line,#ddd); border-radius:10px;">
          <div class="pv-form-linea">
            <label>Tipo<select data-campo="dev-tipo">${opciones({ devolucion: 'Devolución', cambio: 'Cambio por otro producto' }, 'devolucion')}</select></label>
            <label style="flex:1; min-width:180px;">Motivo<input type="text" data-campo="dev-motivo" maxlength="500" placeholder="Ej. Falla de fábrica, no le gustó"></label>
          </div>
          <div class="pv-form-linea">
            <label>Dinero a devolver ($, vacío si no hay)<input type="text" inputmode="decimal" data-campo="dev-monto" placeholder="0"></label>
            <label>Cómo se le devuelve<select data-campo="dev-metodo">${opciones(NOMBRE_REINTEGRO, 'efectivo')}</select></label>
          </div>
          <div class="pv-form-linea">
            <label style="flex-direction:row; align-items:center; gap:6px;"><input type="checkbox" data-campo="dev-reingresa"${i.imei_serie ? '' : ' disabled'}> El equipo vuelve al stock${i.imei_serie ? '' : ' (sin IMEI/serie: no se puede)'}</label>
            <label>Depósito<select data-campo="dev-deposito">${DEPOSITOS.map(x => `<option>${x}</option>`).join('')}</select></label>
          </div>
          <button class="pv-btn peligro" data-accion="dev-enviar" data-venta="${v.venta_id}" data-item="${i.id}">Registrar devolución</button>
          <span class="pv-suave"> Queda en el historial: no se puede deshacer.</span>
        </div></div>`).join('') + '</div>';
    return h;
  }

  // ---------- Caja ----------
  let cajaDatos = null;

  function sucursalesCaja() { return (typeof DATA !== 'undefined' && DATA.sucursales && DATA.sucursales.length ? DATA.sucursales : ['Shopping', 'Independencia', 'Dino']); }

  async function cargarCaja() {
    const caja = $id('pvVista_caja');
    if (!$id('cjSuc')) {
      caja.innerHTML = `<div class="pv-filtros">
          <div class="form-group-total"><label>Sucursal</label><select id="cjSuc">${(typeof DATA !== 'undefined' && DATA.sucursales ? Array.from(new Set(['Shopping', 'Independencia', 'Dino'].concat(DATA.sucursales))) : ['Shopping', 'Independencia', 'Dino']).map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
          <div class="form-group-total"><label>Día</label><input type="date" id="cjDia" value="${hoyLocal()}" max="${hoyLocal()}"></div></div>
        <div id="cjContenido"></div><h4 style="margin:16px 0 6px;">Días sin cerrar</h4><div id="cjPendientes"></div><h4 style="margin:16px 0 6px;">Últimos cierres</h4><div id="cjCierres"></div>`;
    }
    try {
      const sucursal = $id('cjSuc').value, dia = $id('cjDia').value || hoyLocal();
      const j = await pApi('GET', '/api/panel/caja?sucursal=' + encodeURIComponent(sucursal) + '&dia=' + dia);
      cajaDatos = j;
      const c = j.caja;
      const filas = c.metodos.map(m => `<tr><td>${NOMBRE_METODO[m.metodo] || esc(m.metodo)}${m.moneda !== 'ARS' ? ' (' + m.moneda + ')' : ''}</td><td class="num">${m.cantidad}</td><td class="num">${m.moneda === 'ARS' ? pesos(m.total_moneda_centavos) : usd(m.total_moneda_centavos)}</td><td class="num">${m.moneda === 'ARS' ? '' : pesos(m.total_ars_centavos)}</td><td class="num">${pesos(m.verificado_ars_centavos)}</td><td class="num">${m.pendientes || ''}</td><td class="num">${m.con_diferencia ? '<span class="pv-vencida">' + m.con_diferencia + '</span>' : ''}</td></tr>`).join('');
      const dev = c.devoluciones.length ? `<h4 style="margin:12px 0 4px;">Devoluciones del día</h4><table class="pv"><tbody>${c.devoluciones.map(x => `<tr><td>${esc(x.codigo)}</td><td>${esc(x.descripcion)}</td><td>${x.tipo === 'cambio' ? 'Cambio' : 'Devolución'}</td><td>${esc(x.motivo)}</td><td class="num">${x.monto_reintegrado_centavos ? pesos(x.monto_reintegrado_centavos) + ' (' + esc(NOMBRE_REINTEGRO[x.metodo_reintegro] || '') + ')' : '—'}</td></tr>`).join('')}</tbody></table>` : '';
      const cierre = j.cierre;
      let bloqueCierre;
      if (cierre) {
        const dif = (ars, u) => (ars === 0 && u === 0) ? '<span class="pv-badge ok">Coincide</span>' : `<span class="pv-badge error">Diferencia ${ars ? pesos(ars) : ''}${ars && u ? ' · ' : ''}${u ? usd(u) : ''}</span>`;
        bloqueCierre = `<div class="pv-detalle" style="margin-top:12px;"><b>Caja cerrada</b> por ${esc(cierre.cerrado_por || '')} el ${fechaCorta(cierre.cerrado_en)}<br>
          Esperado ${pesos(cierre.efectivo_ars_esperado_centavos)} + ${usd(cierre.efectivo_usd_esperado_centavos)} · Contado ${pesos(cierre.efectivo_ars_contado_centavos)} + ${usd(cierre.efectivo_usd_contado_centavos)} ${dif(cierre.diferencia_ars_centavos, cierre.diferencia_usd_centavos)}
          ${cierre.nota ? '<br>Nota: ' + esc(cierre.nota) : ''}
          ${j.cambioPosterior ? '<br><span class="pv-vencida">⚠ Después de cerrar cambió algo de ese día (un cobro anulado o una devolución): hoy el sistema esperaría ' + pesos(c.esperado_ars_centavos) + ' + ' + usd(c.esperado_usd_centavos) + '. Revisá y, si hace falta, anulá este cierre y volvé a hacerlo.</span>' : ''}
          ${rol === 'admin' ? `<div class="pv-acciones" style="margin-top:8px;"><button class="pv-btn peligro" data-caja="anular" data-id="${cierre.id}">Anular cierre</button></div>` : ''}</div>`;
      } else {
        bloqueCierre = `<div class="pv-detalle" style="margin-top:12px;"><b>Cerrar la caja de ${esc(j.sucursal)} del ${esc(j.dia)}</b>
          <p class="pv-suave" style="margin:4px 0;">Contá el efectivo cobrado ese día (sin el fondo de cambio). Si no coincide con lo que espera el sistema, hay que explicar por qué.</p>
          <div class="pv-form-linea">
            <label>Efectivo contado en pesos ($)<input type="text" inputmode="decimal" id="cjContadoArs" placeholder="0" autocomplete="off"></label>
            <label>Efectivo contado en dólares (USD)<input type="text" inputmode="decimal" id="cjContadoUsd" placeholder="0" autocomplete="off"></label>
          </div>
          <div id="cjDif" class="pv-suave" style="margin:4px 0;"></div>
          <div class="pv-form-linea"><label style="flex:1; min-width:200px;">Nota (obligatoria si hay diferencia)<input type="text" id="cjNota" maxlength="500" autocomplete="off"></label></div>
          <button class="pv-btn bueno" data-caja="cerrar">Cerrar caja</button></div>`;
      }
      $id('cjContenido').innerHTML = `
        <div class="pv-tabla-wrap"><table class="pv"><thead><tr><th>Forma de pago</th><th class="num">Cant.</th><th class="num">Total</th><th class="num">Equiv. en $</th><th class="num">Verificado</th><th class="num">Por verif.</th><th class="num">Con dif.</th></tr></thead><tbody>${filas || '<tr><td colspan="7" class="pv-vacio">No hubo cobros ese día.</td></tr>'}</tbody></table></div>
        <div class="pv-totales" style="margin-top:10px;">Efectivo cobrado: <b>${pesos(c.efectivo_ars_cobrado_centavos)}</b> y <b>${usd(c.efectivo_usd_cobrado_centavos)}</b> · Reintegros en efectivo: <b>${pesos(c.reintegros_efectivo_ars_centavos)}</b><br>
          El sistema espera en el cajón: <b>${pesos(c.esperado_ars_centavos)}</b> y <b>${usd(c.esperado_usd_centavos)}</b></div>${dev}${bloqueCierre}`;
      const lista = await pApi('GET', '/api/panel/caja/cierres');
      $id('cjPendientes').innerHTML = lista.pendientes.length
        ? lista.pendientes.map(p => `<button type="button" class="pv-btn" style="margin:2px;" data-caja="ir" data-sucursal="${esc(p.sucursal)}" data-dia="${esc(p.dia)}">${esc(p.sucursal)} · ${esc(p.dia)}</button>`).join('')
        : '<span class="pv-suave">No hay días anteriores sin cerrar (últimos 30 días). 👌</span>';
      $id('cjCierres').innerHTML = lista.cierres.length ? `<div class="pv-tabla-wrap"><table class="pv"><thead><tr><th>Día</th><th>Sucursal</th><th class="num">Esperado $</th><th class="num">Contado $</th><th class="num">Diferencia $</th><th class="num">Dif. USD</th><th>Nota</th><th>Estado</th></tr></thead><tbody>` +
        lista.cierres.map(x => `<tr class="${x.estado === 'anulado' ? 'anulada' : ''}"><td>${esc(x.dia)}</td><td>${esc(x.sucursal)}</td><td class="num">${pesos(x.efectivo_ars_esperado_centavos)}</td><td class="num">${pesos(x.efectivo_ars_contado_centavos)}</td><td class="num ${x.diferencia_ars_centavos ? 'pv-vencida' : ''}">${pesos(x.diferencia_ars_centavos)}</td><td class="num">${x.diferencia_usd_centavos ? usd(x.diferencia_usd_centavos) : ''}</td><td>${esc(x.nota || '')}</td><td>${x.estado === 'anulado' ? 'Anulado: ' + esc(x.motivo_anulacion || '') : 'Cerrado por ' + esc(x.cerrado_por || '')}</td></tr>`).join('') + '</tbody></table></div>' : '<span class="pv-suave">Todavía no hay cierres.</span>';
    } catch (e) { aviso('error', e.message); }
  }

  function recalcularDiferenciaCaja(ev) {
    if (!['cjContadoArs', 'cjContadoUsd'].includes(ev.target.id) || !cajaDatos) return;
    const c = cajaDatos.caja;
    const ars = Math.round(num($id('cjContadoArs').value) * 100) - c.esperado_ars_centavos;
    const u = Math.round(num($id('cjContadoUsd').value) * 100) - c.esperado_usd_centavos;
    $id('cjDif').innerHTML = (ars === 0 && u === 0) ? '<span class="pv-badge ok">Coincide con el sistema</span>'
      : `Diferencia contra el sistema: <b class="pv-vencida">${pesos(ars)}</b>${u ? ' y <b class="pv-vencida">' + usd(u) + '</b>' : ''} ${ars < 0 ? '(falta plata)' : (ars > 0 ? '(sobra plata)' : '')}`;
  }

  async function clickCaja(ev) {
    const b = ev.target.closest('[data-caja]');
    if (!b) return;
    const a = b.getAttribute('data-caja');
    try {
      if (a === 'ir') { $id('cjSuc').value = b.getAttribute('data-sucursal'); $id('cjDia').value = b.getAttribute('data-dia'); return cargarCaja(); }
      if (a === 'cerrar') {
        const contado = $id('cjContadoArs').value.trim();
        if (contado === '') return aviso('error', 'Cargá cuánto efectivo contaste en pesos (0 si no hubo).');
        const hayDif = ((Math.round(num(contado) * 100) - cajaDatos.caja.esperado_ars_centavos) !== 0) || ((Math.round(num($id('cjContadoUsd').value) * 100) - cajaDatos.caja.esperado_usd_centavos) !== 0);
        if (!window.confirm((hayDif ? 'El conteo NO coincide con el sistema. ' : '') + '¿Cerrar la caja? Después solo el administrador puede anular el cierre.')) return;
        await pApi('POST', '/api/panel/caja/cierre', { sucursal: $id('cjSuc').value, dia: $id('cjDia').value, contadoArs: num(contado), contadoUsd: num($id('cjContadoUsd').value), nota: $id('cjNota').value });
        aviso('success', 'Caja cerrada');
      } else if (a === 'anular') {
        const motivo = window.prompt('Motivo de la anulación del cierre (queda registrado):');
        if (motivo === null) return;
        await pApi('POST', '/api/panel/caja/cierres/' + b.getAttribute('data-id') + '/anular', { motivo });
        aviso('success', 'Cierre anulado: ya se puede volver a cerrar ese día');
      }
    } catch (e) { return aviso('error', e.message); }
    resumen().catch(() => {});
    cargarCaja();
  }

  // ---------- Comisiones (calculadas desde las ventas) ----------
  async function cargarComisiones() {
    const caja = $id('pvVista_comisiones');
    if (!$id('cmMes')) caja.innerHTML = `<div class="pv-filtros"><div class="form-group-total"><label>Mes</label><input type="month" id="cmMes" value="${hoyLocal().slice(0, 7)}"></div></div>
      <p class="pv-suave">Equipos vendidos con garantía, contados una sola vez por IMEI/serie y <b>sin</b> las ventas anuladas ni los equipos devueltos. Sirve para comparar con la pantalla “Comisiones” actual antes de cambiar de sistema.</p><div id="cmContenido"></div>`;
    try {
      const j = await pApi('GET', '/api/panel/comisiones?mes=' + ($id('cmMes').value || hoyLocal().slice(0, 7)));
      const total = j.vendedores.reduce((s, v) => s + v.equipos, 0);
      $id('cmContenido').innerHTML = (j.vendedores.length
        ? `<div class="pv-tabla-wrap"><table class="pv"><thead><tr><th>Vendedor</th><th>Sucursal</th><th class="num">Equipos</th></tr></thead><tbody>${j.vendedores.map(v => `<tr><td>${esc(v.vendedor)}</td><td>${esc(v.sucursal)}</td><td class="num"><b>${v.equipos}</b></td></tr>`).join('')}<tr><td colspan="2"><b>Total</b></td><td class="num"><b>${total}</b></td></tr></tbody></table></div>`
        : vacioHtml('No hay ventas de equipos en ese mes.')) +
        (j.excluidos ? `<p class="pv-suave">No se cuentan ${j.excluidos} equipo(s) de ese mes por estar anulados o devueltos.</p>` : '') +
        (j.detalle.length ? `<details style="margin-top:10px;"><summary>Ver cada equipo contado (${j.detalle.length})</summary><div class="pv-tabla-wrap"><table class="pv"><thead><tr><th>Vendedor</th><th>Fecha</th><th>Venta</th><th>Producto</th><th>IMEI / Serie</th></tr></thead><tbody>${j.detalle.map(d => `<tr><td>${esc(d.vendedor)}</td><td>${esc(d.fecha)}</td><td>${esc(d.codigo)}</td><td>${esc(d.descripcion)}</td><td>${esc(d.imei_serie)}</td></tr>`).join('')}</tbody></table></div></details>` : '');
    } catch (e) { aviso('error', e.message); }
  }

  // ---------- Stock (en la base): resumen, lista, conteo fisico y exportacion ----------
  async function cargarStock() {
    const caja = $id('pvVista_stock');
    if (!$id('stDeposito')) {
      caja.innerHTML = `<p class="pv-suave">El stock que tiene cargado la base de datos. Hasta que se pase el stock a la base (interruptor del servidor), la fuente oficial sigue siendo el Sheet.</p>
        <div id="stResumen"></div>
        <div class="pv-filtros">
          <div class="form-group-total"><label>Depósito</label><select id="stDeposito"><option value="">Todos</option></select></div>
          <div class="form-group-total"><label>Estado</label><select id="stEstado"><option value="">Activos (en stock, reservados, financiación)</option><option value="en_stock">En stock</option><option value="reservado">Reservado</option><option value="financiacion_propia">Financiación propia</option><option value="vendido">Vendido</option></select></div>
          <div class="form-group-total" style="flex:2; min-width:180px;"><label>Buscar (modelo, color o IMEI)</label><input type="text" id="stQ" autocomplete="off"></div>
        </div>
        <div class="pv-acciones" style="margin-bottom:8px;"><button type="button" class="pv-btn" data-stock="buscar">Buscar</button>
          <a class="pv-btn" style="text-decoration:none;" href="/api/panel/stock/exportar">Descargar todo el stock (CSV con el formato de la hoja)</a></div>
        <div id="stLista"></div>
        <h4 style="margin:18px 0 6px;">Conteo físico</h4>
        <p class="pv-suave">Pegá los IMEI / series que contaste en un depósito (uno por línea o separados por coma). El sistema dice cuáles faltan, cuáles sobran y cuáles figuran en otro depósito.</p>
        <div class="pv-form-linea"><label>Depósito contado<select id="stConteoDep"></select></label></div>
        <textarea id="stConteoLista" rows="5" style="width:100%; box-sizing:border-box; border-radius:10px; padding:8px;" placeholder="353207337936086&#10;357154678417522&#10;..."></textarea>
        <div class="pv-acciones" style="margin-top:6px;"><button type="button" class="pv-btn bueno" data-stock="comparar">Comparar</button><button type="button" class="pv-btn" data-stock="comparar-avisar">Comparar y avisar de los faltantes</button></div>
        <div id="stConteoResultado" style="margin-top:10px;"></div>`;
    }
    try {
      const p = new URLSearchParams();
      [['deposito', 'stDeposito'], ['estado', 'stEstado'], ['q', 'stQ']].forEach(([k, id]) => { const v = ($id(id).value || '').trim(); if (v) p.set(k, v); });
      const j = await pApi('GET', '/api/panel/stock?' + p.toString());
      const llenar = (id, lista, vacio) => { const sel = $id(id); const actual = sel.value; sel.innerHTML = (vacio ? '<option value="">' + vacio + '</option>' : '') + lista.map(n => `<option>${esc(n)}</option>`).join(''); sel.value = actual; };
      llenar('stDeposito', j.depositos, 'Todos'); llenar('stConteoDep', j.depositos);
      const tot = j.porDeposito.reduce((a, d) => ({ e: a.e + d.en_stock, r: a.r + d.reservado, f: a.f + d.financiacion }), { e: 0, r: 0, f: 0 });
      $id('stResumen').innerHTML = `<div class="pv-tabla-wrap"><table class="pv"><thead><tr><th>Depósito</th><th class="num">En stock</th><th class="num">Reservados</th><th class="num">Financiación</th></tr></thead><tbody>${j.porDeposito.map(d => `<tr><td>${esc(d.deposito)}</td><td class="num">${d.en_stock}</td><td class="num">${d.reservado || ''}</td><td class="num">${d.financiacion || ''}</td></tr>`).join('')}<tr><td><b>Total</b></td><td class="num"><b>${tot.e}</b></td><td class="num"><b>${tot.r}</b></td><td class="num"><b>${tot.f}</b></td></tr></tbody></table></div>`;
      $id('stLista').innerHTML = j.unidades.length ? `<div class="pv-tabla-wrap"><table class="pv"><thead><tr><th>Fila</th><th>Modelo</th><th>Cap.</th><th>Color</th><th>Bat.</th><th>IMEI / Serie</th><th>Depósito</th><th>Estado</th><th>Observaciones</th></tr></thead><tbody>` +
        j.unidades.map(u => `<tr><td>${u.fila}</td><td>${esc(u.modelo)}</td><td>${esc(u.capacidad || '')}</td><td>${esc(u.color || '')}</td><td>${u.bateria_pct ? u.bateria_pct + '%' : ''}</td><td>${esc(/^SIN-IMEI-/.test(u.imei_serie) ? '(sin IMEI)' : u.imei_serie)}</td><td>${esc(u.deposito)}</td><td>${esc(u.estado_txt)}</td><td>${esc([u.observaciones, u.falla].filter(Boolean).join(' · '))}</td></tr>`).join('') + '</tbody></table></div>' + (j.unidades.length >= 300 ? '<p class="pv-suave">Se muestran los primeros 300: afiná la búsqueda.</p>' : '')
        : vacioHtml('No hay equipos con esos filtros (o todavía no se importó el stock a la base).');
    } catch (e) { aviso('error', e.message); }
  }

  async function clickStock(ev) {
    const b = ev.target.closest('[data-stock]');
    if (!b) return;
    const a = b.getAttribute('data-stock');
    if (a === 'buscar') return cargarStock();
    try {
      const avisar = a === 'comparar-avisar';
      if (avisar && !window.confirm('Se va a generar una alerta por cada equipo que falte. ¿Seguir?')) return;
      const j = await pApi('POST', '/api/panel/stock/conteo', { deposito: $id('stConteoDep').value, imeis: $id('stConteoLista').value, registrar: avisar });
      const lista = (titulo, items, fmt) => items.length ? `<h4 style="margin:10px 0 4px;">${titulo} (${items.length})</h4><table class="pv"><tbody>${items.map(x => `<tr><td>${fmt(x)}</td></tr>`).join('')}</tbody></table>` : '';
      $id('stConteoResultado').innerHTML = `<div class="pv-totales">Esperados en ${esc(j.deposito)}: <b>${j.esperados}</b> · Contados: <b>${j.contados}</b> · Coinciden: <b>${j.coinciden}</b> ${j.faltantes.length || j.sobrantes.length || j.otroDeposito.length ? '<span class="pv-badge error">Hay diferencias</span>' : '<span class="pv-badge ok">Todo coincide</span>'}${j.registrado ? ' · <b>alertas generadas</b>' : ''}</div>` +
        lista('Faltan (el sistema dice que están, no se contaron)', j.faltantes, f => `${esc(f.modelo)} ${esc(f.capacidad || '')} ${esc(f.color || '')} · ${esc(f.imei_serie)}`) +
        lista('Sobran (se contaron pero no figuran en el sistema)', j.sobrantes, s => esc(s.imei)) +
        lista('Figuran en OTRO depósito', j.otroDeposito, o => `${esc(o.imei)} · ${esc(o.modelo)} → el sistema lo tiene en ${esc(o.deposito_actual)}`);
      if (avisar) resumen().catch(() => {});
    } catch (e) { aviso('error', e.message); }
  }

  // ---------- entrada ----------
  async function iniciar() {
    if (!iniciado) { armarEsqueleto(); iniciado = true; }
    const hoy = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    if (!$id('pvDesde').value && !$id('pvHasta').value && !$id('pvCobro').value && !$id('pvSolo').value) $id('pvDesde').value = hoy;
    await resumen().catch(e => aviso('error', e.message));
    await cargar(true);
  }

  return { iniciar };
})();

function iniciarPanelVentas() { return PanelVentas.iniciar(); }
