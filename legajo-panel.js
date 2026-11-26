// ============================ PANEL: legajo, reservas y planes, clientes, equipo ============================
// Se engancha en el panel de Ventas (panel.js). Solo administracion y oficina; el servidor lo controla.

const LegajoPanel = (function () {
  const $id = id => document.getElementById(id);
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pesos = centavos => formatNumberArg(Math.round((centavos || 0) / 100));
  const usd = centavos => 'USD ' + ((centavos || 0) / 100).toLocaleString('es-AR');
  const aviso = (tipo, mnsj) => MostrarAlerta({ tipo, title: 'Ventas', mnsj });
  const nombreDoc = t => (typeof Legajo !== 'undefined' && Legajo.NOMBRE_DOC[t]) || t;
  const esAdminAhora = () => { const s = sesionGuardada(); return !!s && s.rol === 'admin'; };
  const fecha = iso => iso ? new Date(iso).toLocaleDateString('es-AR') : '';

  async function api(metodo, ruta, cuerpo) {
    const r = await fetch(ruta, { method: metodo, credentials: 'same-origin', headers: cuerpo ? { 'Content-Type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.ok === false) throw new Error((j && j.error) || 'No se pudo completar');
    return j;
  }

  const enlaceDoc = d => `<a href="/api/panel/documentos/${d.id}" target="_blank" rel="noopener">📎 ${esc(nombreDoc(d.tipo))}</a>`;
  const faltantes = lista => lista && lista.length ? lista.map(t => `<span class="pv-badge alerta">Falta: ${esc(nombreDoc(t))}</span>`).join(' ') : '<span class="pv-badge ok">Documentación completa</span>';

  // Bloque dentro del detalle de una venta.
  function htmlLegajo(l) {
    if (!l) return '';
    const docs = l.documentos.map(d => `<div style="margin:4px 0;">${enlaceDoc(d)} <span class="pv-suave">${fecha(d.subido_en)} · ${esc(d.subido_por)}</span>${esAdminAhora() ? ` <button type="button" class="pv-btn peligro" data-lg="borrar-doc" data-id="${d.id}">Borrar (pedido del cliente)</button>` : ''}</div>`).join('');
    const papeles = l.papeles.map(p => `<a class="pv-btn" target="_blank" rel="noopener" href="/api/impresiones/${encodeURIComponent(l.opid)}/${p.tipo}">🖨️ ${esc(p.titulo)}</a>`).join(' ');
    return `<div class="pv-seccion"><h4>Legajo</h4><div>${faltantes(l.faltan)}</div>${docs || '<p class="pv-suave">Sin documentos cargados.</p>'}${papeles ? '<div style="margin-top:6px;">' + papeles + '</div>' : ''}</div>`;
  }

  // ---------- Reservas y planes ----------
  async function cargarPlanes() {
    const caja = $id('pvVista_planes');
    caja.innerHTML = '<p class="pv-suave">Cargando…</p>';
    try {
      const j = await api('GET', '/api/panel/planes');
      const ESTADO = { activa: 'Activa', activo: 'Activo', cumplida: 'Cumplida', completado: 'Completado', cancelada: 'Cancelada', cancelado: 'Cancelado', vencida: 'Vencida' };
      caja.innerHTML = j.planes.length ? j.planes.map(p => {
        const plata = p.moneda === 'ARS' ? pesos : usd;
        const abierto = p.estado === 'activa' || p.estado === 'activo';
        return `<div class="pv-seccion"><b>${p.clase === 'reserva' ? 'Reserva' : 'Plan propio'} ${p.id}</b> <span class="pv-badge ${abierto ? 'alerta' : 'ok'}">${ESTADO[p.estado] || esc(p.estado)}</span><br>
          ${esc(p.cliente)} · DNI ${esc(p.dni || '')} · ${esc(p.telefono || '')}<br>${esc(p.equipo)} · ${esc(p.local)} · ${esc(p.vendedor)} · ${fecha(p.fecha_hora)}<br>
          Pagado <b>${plata(p.pagado)}</b> de ${plata(p.total)}${p.vence_en ? ' · vence ' + esc(p.vence_en) : ''}
          <div style="margin:6px 0;">${p.pagos.map(x => `<div>${esc(x.metodo)} ${x.moneda === 'ARS' ? pesos(x.monto_centavos) : x.moneda + ' ' + x.monto_centavos / 100} <span class="pv-badge ${x.estado === 'anulado' ? 'error' : (x.verificacion === 'verificado' ? 'ok' : 'alerta')}">${x.estado === 'anulado' ? 'Anulado' : (x.verificacion === 'verificado' ? 'Verificado' : (x.verificacion === 'con_diferencia' ? 'Con diferencia' : 'Por verificar'))}</span>${x.estado !== 'anulado' && x.verificacion === 'pendiente' ? ` <button type="button" class="pv-btn bueno" data-lg="verificar" data-id="${x.id}">Verificar</button>` : ''}</div>`).join('') || '<span class="pv-suave">Sin pagos cargados</span>'}</div>
          <div>${abierto || p.opid ? faltantes(p.faltan) : ''} ${p.documentos.map(enlaceDoc).join(' ')}</div>
          ${abierto && esAdminAhora() ? `<button type="button" class="pv-btn peligro" data-lg="cancelar-plan" data-clase="${p.clase === 'reserva' ? 'reservas' : 'financiaciones'}" data-id="${p.id}">Cancelar</button>` : ''}</div>`;
      }).join('') : '<div class="pv-vacio">Todavía no hay reservas ni planes en el sistema nuevo.</div>';
    } catch (e) { caja.innerHTML = '<div class="pv-vacio">' + esc(e.message) + '</div>'; }
  }

  // ---------- Clientes: a quien ofrecerle un recambio ----------
  let ultimosClientes = [];
  function armarClientes() {
    const caja = $id('pvVista_clientes');
    if (caja.dataset.armado) return;
    caja.dataset.armado = '1';
    caja.innerHTML = `<div class="pv-filtros">
      <div class="form-group-total"><label>Compró (modelo)</label><input type="text" id="lgCliModelo" placeholder="Ej. iPhone 13"></div>
      <div class="form-group-total"><label>Entregó en canje</label><input type="text" id="lgCliCanje" placeholder="Ej. iPhone 11"></div>
      <div class="form-group-total"><label>Última compra hace más de</label><select id="lgCliMeses"><option value="0">Cualquier fecha</option><option value="6">6 meses</option><option value="12">12 meses</option><option value="18">18 meses</option><option value="24">24 meses</option></select></div>
      <div class="form-group-total"><label>Buscar (nombre, DNI, teléfono)</label><input type="text" id="lgCliQ"></div></div>
      <label style="display:flex; gap:8px; align-items:center;"><input type="checkbox" id="lgCliPermiso" checked> Solo quienes aceptaron recibir ofertas</label>
      <label style="display:block; margin-top:8px;">Mensaje (se usa al tocar WhatsApp; {nombre} se reemplaza)</label>
      <textarea id="lgCliMensaje" rows="2" style="width:100%; box-sizing:border-box; font-size:16px;">Hola {nombre}! Te escribimos de Jobs Company: podés cambiar tu equipo entregando el que tenés como parte de pago. ¿Te paso una cotización?</textarea>
      <div class="pv-acciones" style="margin:8px 0;"><button type="button" class="btn-total" data-lg="buscar-clientes" style="width:auto; padding:0 18px;">Buscar</button></div>
      <div id="lgCliUso" class="pv-suave"></div><div id="lgCliLista"></div>`;
  }
  async function cargarClientes() {
    armarClientes();
    const q = new URLSearchParams({ modelo: $id('lgCliModelo').value.trim(), entregado: $id('lgCliCanje').value.trim(), meses: $id('lgCliMeses').value, q: $id('lgCliQ').value.trim(), soloPermiso: $id('lgCliPermiso').checked ? '1' : '0' });
    const lista = $id('lgCliLista');
    lista.innerHTML = '<p class="pv-suave">Cargando…</p>';
    try {
      const j = await api('GET', '/api/panel/clientes?' + q);
      ultimosClientes = j.clientes;
      lista.innerHTML = `<p><b>${j.clientes.length}</b> cliente(s)</p>` + (j.clientes.length ? '<div class="pv-tabla-wrap"><table class="pv"><thead><tr><th>Cliente</th><th>Compró</th><th>Entregó</th><th>Última compra</th><th>Contacto</th></tr></thead><tbody>' + j.clientes.map((c, i) => `<tr><td>${esc(c.nombre)}<br><span class="pv-suave">DNI ${esc(c.dni || '')}</span></td><td>${esc(c.compro || '—')}</td><td>${esc(c.entrego || '—')}</td><td>${fecha(c.ultima_compra) || '—'}</td>
        <td>${c.se_puede_ofrecer ? `<button type="button" class="pv-btn bueno" data-lg="whatsapp" data-i="${i}">WhatsApp</button> <button type="button" class="pv-btn peligro" data-lg="no-contactar" data-id="${c.id}">No contactar</button>` : '<span class="pv-badge error">' + (c.no_contactar_en || c.no_contactar_venta ? 'No contactar' : 'Sin permiso para ofertas') + '</span>'}</td></tr>`).join('') + '</tbody></table></div>' : '');
      const u = await api('GET', '/api/panel/legajo/uso');
      const pct = u.bytes * 100 / u.limite;
      $id('lgCliUso').textContent = `Espacio de fotos usado: ${(u.bytes / 1048576).toFixed(1)} MB de 10 GB (${pct.toFixed(2)}%)` + (pct > 80 ? ' · ⚠️ queda poco lugar' : '');
    } catch (e) { lista.innerHTML = '<div class="pv-vacio">' + esc(e.message) + '</div>'; }
  }

  // ---------- Equipo y objetivos (solo admin) ----------
  let mesEquipo = '';
  async function cargarEquipo() {
    const caja = $id('pvVista_equipo');
    caja.innerHTML = '<p class="pv-suave">Cargando…</p>';
    try {
      const j = await api('GET', '/api/admin/equipo' + (mesEquipo ? '?mes=' + mesEquipo : ''));
      mesEquipo = j.mes;
      const opciones = (lista, valor, texto, elegido) => lista.map(x => `<option value="${x[valor]}"${String(x[valor]) === String(elegido) ? ' selected' : ''}>${esc(texto(x))}</option>`).join('');
      caja.innerHTML = `<div class="form-group-total" style="max-width:220px;"><label>Mes</label><input type="month" id="lgEqMes" value="${j.mes}"></div>` +
        j.locales.map(l => {
          const a = j.avance.find(x => x.local_id === l.id);
          const delegado = (j.delegados.find(d => d.local_id === l.id) || {}).usuario_id || '';
          return `<div class="pv-seccion" data-local="${l.id}"><h4>${esc(l.nombre)}</h4>
            <div class="pv-filtros"><div class="form-group-total"><label>Equipos</label><input type="number" min="0" data-obj="equipos" value="${a.objetivo.equipos}"></div><div class="form-group-total"><label>Accesorios</label><input type="number" min="0" data-obj="accesorios" value="${a.objetivo.accesorios}"></div><div class="form-group-total"><label>Servicios técnicos</label><input type="number" min="0" data-obj="servicios" value="${a.objetivo.servicios}"></div><div class="form-group-total" style="flex:2;"><label>Premio (texto)</label><input type="text" data-obj="premio" value="${esc(a.premio || '')}" placeholder="A definir"></div></div>
            <button type="button" class="pv-btn bueno" data-lg="guardar-objetivo">Guardar objetivo</button>
            <div class="form-group-total" style="max-width:320px; margin-top:8px;"><label>Delegado del local</label><select data-delegado><option value="">Sin delegado</option>${opciones(j.usuarios, 'id', u => u.usuario + (u.sucursal ? ' (' + u.sucursal + ')' : ''), delegado)}</select></div>
            <div class="pv-tabla-wrap"><table class="pv"><thead><tr><th>Vendedor</th><th class="num">Equipos</th><th class="num">Accesorios</th><th class="num">Servicios</th></tr></thead><tbody>${a.vendedores.map(v => `<tr><td>${esc(v.vendedor)}</td><td class="num">${v.equipos} / ${v.objetivo.equipos}</td><td class="num">${v.accesorios} / ${v.objetivo.accesorios}</td><td class="num">${v.servicios} / ${v.objetivo.servicios}</td></tr>`).join('') || '<tr><td colspan="4">No hay vendedores asignados a este local.</td></tr>'}</tbody></table></div></div>`;
        }).join('') +
        `<div class="pv-seccion"><h4>A qué local pertenece cada vendedor</h4>${j.vendedores.map(v => `<div style="display:flex; gap:8px; align-items:center; margin:6px 0;"><span style="min-width:150px;">${esc(v.nombre)}${v.activo ? '' : ' (de baja)'}</span><select data-vendedor="${v.id}"><option value="">Sin local</option>${opciones(j.locales, 'id', l => l.nombre, v.local_id)}</select></div>`).join('') || '<p class="pv-suave">Los vendedores aparecen acá con su primera venta, o se cargan al publicar.</p>'}</div>`;
    } catch (e) { caja.innerHTML = '<div class="pv-vacio">' + esc(e.message) + '</div>'; }
  }

  // ---------- eventos ----------
  async function click(boton) {
    const que = boton.getAttribute('data-lg'), id = boton.getAttribute('data-id');
    try {
      if (que === 'borrar-doc') {
        const motivo = window.prompt('Se borra el archivo definitivamente. Motivo (pedido del titular, etc.):');
        if (motivo === null) return;
        await api('POST', '/api/panel/documentos/' + id + '/borrar', { motivo });
        boton.parentElement.innerHTML = '<span class="pv-suave">Documento borrado (quedó registrado).</span>';
      } else if (que === 'verificar') { await api('POST', '/api/panel/pagos/' + id + '/verificar', { resultado: 'verificado' }); aviso('success', 'Pago verificado'); cargarPlanes(); }
      else if (que === 'cancelar-plan') {
        const motivo = window.prompt('Motivo de la cancelación (queda registrado). El reintegro y el stock se manejan aparte:');
        if (motivo === null) return;
        await api('POST', '/api/panel/' + boton.getAttribute('data-clase') + '/' + id + '/cancelar', { motivo }); aviso('success', 'Cancelado'); cargarPlanes();
      } else if (que === 'buscar-clientes') cargarClientes();
      else if (que === 'whatsapp') {
        const c = ultimosClientes[Number(boton.getAttribute('data-i'))];
        const numero = String(c.telefono || '').replace(/\D/g, '');
        if (!numero) return aviso('error', 'Este cliente no tiene teléfono');
        const texto = $id('lgCliMensaje').value.replace(/\{nombre\}/g, String(c.nombre).split(' ')[0]);
        window.open('https://wa.me/' + (numero.startsWith('54') ? numero : '549' + numero) + '?text=' + encodeURIComponent(texto), '_blank', 'noopener');
      } else if (que === 'no-contactar') {
        const motivo = window.prompt('Motivo (por ejemplo: pidió que no le escriban):');
        if (motivo === null) return;
        await api('POST', '/api/panel/clientes/' + id + '/no-contactar', { motivo }); cargarClientes();
      } else if (que === 'guardar-objetivo') {
        const caja = boton.closest('[data-local]');
        const v = k => caja.querySelector(`[data-obj="${k}"]`).value;
        await api('POST', '/api/admin/objetivos', { localId: Number(caja.getAttribute('data-local')), mes: mesEquipo, equipos: Number(v('equipos')), accesorios: Number(v('accesorios')), servicios: Number(v('servicios')), premio: v('premio') });
        aviso('success', 'Objetivo guardado'); cargarEquipo();
      }
    } catch (e) { aviso('error', e.message); }
  }

  async function cambio(el) {
    try {
      if (el.id === 'lgEqMes') { mesEquipo = el.value; return cargarEquipo(); }
      if (el.hasAttribute('data-delegado')) { await api('POST', '/api/admin/equipo/delegado', { localId: Number(el.closest('[data-local]').getAttribute('data-local')), usuarioId: el.value ? Number(el.value) : null }); aviso('success', 'Delegado actualizado'); return cargarEquipo(); }
      if (el.hasAttribute('data-vendedor')) { await api('POST', '/api/admin/equipo/vendedor', { vendedorId: Number(el.getAttribute('data-vendedor')), localId: el.value ? Number(el.value) : null }); aviso('success', 'Vendedor actualizado'); return cargarEquipo(); }
    } catch (e) { aviso('error', e.message); }
  }

  document.addEventListener('click', ev => { const b = ev.target.closest && ev.target.closest('#vistaVentas [data-lg]'); if (b) { ev.stopPropagation(); click(b); } }, true);
  document.addEventListener('change', ev => { if (ev.target.closest && ev.target.closest('#pvVista_equipo')) cambio(ev.target); });

  return { htmlLegajo, cargar: tab => { if (tab === 'planes') cargarPlanes(); else if (tab === 'clientes') cargarClientes(); else if (tab === 'equipo') cargarEquipo(); } };
})();
