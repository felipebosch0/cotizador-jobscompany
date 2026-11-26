// ============================ COBRO Y REGISTRO DE VENTA (3.0, Etapa 2) ============================
// Dos cosas, las dos opcionales para el vendedor y NUNCA bloqueantes:
//   1) Seccion "Cobro" del modal de Garantia: lineas de pago (efectivo, transferencia,
//      USDT, debito, QR, credito, canje) con "falta cobrar". Si no carga nada, la venta
//      igual se registra y en administracion figura "sin cobro registrado".
//   2) Al terminar la venta, se registra completa en la base (POST /api/ventas) ademas
//      de lo que ya se guarda en las planillas. Si la base no responde, la venta queda
//      guardada en el navegador y se reintenta sola (el opId evita duplicados).
// Las cuentas de cobro NO estan en este archivo: vienen del servidor, y solo con sesion.
// Usa variables/funciones globales de app.js (carrito, garantiaCombinada, DATA, etc.).

const Cobro = (function () {
  const VERSION_TEXTO_GARANTIA = 'garantia-2026-11';
  const CLAVE_PENDIENTES = 'ventasPendientes';
  const CLAVE_CON_ERROR = 'ventasConError';
  const MAX_PENDIENTES = 50;
  const MAX_BYTES_COMPROBANTE = 10 * 1024 * 1024;

  const METODOS = [
    ['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['usdt', 'USDT'],
    ['debito', 'Débito'], ['qr', 'QR'], ['credito', 'Crédito'], ['canje', 'Canje (equipo entregado)']
  ];

  let cuentas = null;     // null = sin cargar | false = no disponible | [] = cargadas
  let lineas = [];
  let planes = [];          // reservas y planes abiertos del cliente
  let planElegido = null;   // el que esta venta completa (lo ya pagado cuenta como cobrado)
  let secuencia = 0;

  const $id = id => document.getElementById(id);
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { const n = Number(String(v == null ? '' : v).replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
  const pesos = n => formatNumberArg(Math.round(n));   // ya incluye el signo $
  const dolar = () => Number(DATA && DATA.dolar && DATA.dolar.DolarVenta) || 0;

  // ---------- estilos de la seccion (se inyectan, para no tocar los CSS) ----------
  (function estilos() {
    const css = document.createElement('style');
    css.textContent = `
      #gtCobroContenedor { border-top: 1px solid var(--ap-line, #ddd); margin-top: 18px; padding-top: 6px; }
      #gtCobroResumen { padding: 10px 12px; border-radius: 10px; font-size: 14px; background: rgba(127,127,127,.12); margin: 8px 0; }
      #gtCobroResumen.ok { background: rgba(52,199,89,.18); }
      #gtCobroResumen.alerta { background: rgba(255,149,0,.2); }
      #gtCobroResumen.error { background: rgba(255,59,48,.18); }
      .cobro-linea { border: 1px solid var(--ap-line, #ddd); border-radius: 12px; padding: 4px 12px 12px; margin-bottom: 10px; }
      .cobro-linea .fila { display: flex; gap: 8px; align-items: flex-end; }
      .cobro-linea .fila > div { flex: 1; min-width: 0; }
      .cobro-linea label { margin-top: 10px; }
      .cobro-linea .detalle { font-size: 12px; opacity: .75; margin: 6px 0 0; word-break: break-all; }
      .cobro-linea .quitar { background: none; border: 0; color: #d33; cursor: pointer; font-size: 13px; padding: 0; margin-top: 10px; }
    `;
    document.head.appendChild(css);
  })();

  // ---------- lineas ----------
  function nueva(datos) {
    return Object.assign({ id: ++secuencia, metodo: 'efectivo', moneda: 'ARS', monto: '', cotizacion: dolar() || '', cuotas: '', recargo: '', cuentaId: '', referencia: '', archivo: null }, datos || {});
  }

  // Lo que el carrito ya sabe que se cobra: el equipo en canje y las entregas en efectivo.
  function lineasIniciales() {
    const l = [];
    (typeof carrito !== 'undefined' ? carrito : []).forEach(it => {
      if (it.tipo === 'Trade In' && it.modelo) l.push(nueva({ metodo: 'canje', monto: -it.precio }));
      else if (it.precio < 0 && /^Entrega en efectivo \(USD/.test(it.descripcion || '')) {
        const m = String(it.descripcion).match(/USD\s*([\d.]+)/);
        l.push(nueva({ metodo: 'efectivo', moneda: 'USD', monto: m ? parseFloat(m[1]) : '' }));
      } else if (it.precio < 0 && /^Entrega en efectivo \(ARS\)/.test(it.descripcion || '')) {
        l.push(nueva({ metodo: 'efectivo', moneda: 'ARS', monto: -it.precio }));
      }
    });
    return l;
  }

  // Total de la venta ANTES de restar canje y entregas (que se cargan como pagos).
  function totalBruto() {
    return (typeof carrito !== 'undefined' ? carrito : []).reduce((s, it) => s + (it.precio > 0 ? it.precio : 0), 0);
  }

  const monedaDe = l => l.metodo === 'usdt' ? 'USDT' : (['efectivo', 'transferencia'].indexOf(l.metodo) !== -1 ? l.moneda : 'ARS');
  const eEnDolares = l => monedaDe(l) !== 'ARS';

  // Lo que la linea suma al total de la venta, en pesos.
  function imputadoArs(l) {
    const m = num(l.monto);
    return eEnDolares(l) ? m * (num(l.cotizacion) || dolar()) : m;
  }
  // Lo que el cliente realmente paga en esa linea, en su moneda (con recargo si es credito).
  function cobradoEnSuMoneda(l) {
    const m = num(l.monto);
    return l.metodo === 'credito' ? m * (1 + num(l.recargo) / 100) : m;
  }
  const creditoArs = () => planElegido ? planElegido.pagado : 0;
  const cobradoArs = () => lineas.reduce((s, l) => s + imputadoArs(l), 0) + creditoArs();

  function cuentasPara(l) {
    if (!cuentas) return [];
    const tipo = l.metodo === 'usdt' ? 'usdt' : (monedaDe(l) === 'USD' ? 'transferencia_usd' : 'transferencia_ars');
    return cuentas.filter(c => c.tipo === tipo);
  }
  const cuentaPorId = id => (cuentas || []).find(c => String(c.id) === String(id));
  const esTarjeta = l => l.metodo === 'debito' || l.metodo === 'credito';

  // ---------- pantalla ----------
  function renderLinea(l) {
    const necesitaCuenta = l.metodo === 'transferencia' || l.metodo === 'usdt';
    const monedaFija = l.metodo === 'efectivo' || l.metodo === 'transferencia';
    const lista = necesitaCuenta ? cuentasPara(l) : [];
    const cuenta = cuentaPorId(l.cuentaId);
    const detalleCuenta = cuenta
      ? [cuenta.titular, cuenta.alias && 'Alias: ' + cuenta.alias, cuenta.cbu_cvu && 'CBU/CVU: ' + cuenta.cbu_cvu, cuenta.cuit && 'CUIT: ' + cuenta.cuit, cuenta.email_o_wallet, cuenta.red && 'Red: ' + cuenta.red].filter(Boolean).map(esc).join(' · ')
      : '';
    return `<div class="cobro-linea" data-id="${l.id}">
      <div class="fila">
        <div><label>Forma de pago</label>
          <select data-campo="metodo">${METODOS.map(([v, t]) => `<option value="${v}"${l.metodo === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        ${monedaFija ? `<div style="max-width:90px"><label>Moneda</label>
          <select data-campo="moneda"><option value="ARS"${l.moneda === 'ARS' ? ' selected' : ''}>$</option><option value="USD"${l.moneda === 'USD' ? ' selected' : ''}>USD</option></select></div>` : ''}
      </div>
      ${l.metodo === 'canje'
        ? (typeof Legajo !== 'undefined' && Legajo.activo() ? `<p class="detalle">Se descuenta el valor del equipo entregado: <strong>${pesos(num(l.monto))}</strong></p>` : `<p class="detalle">Se descuenta el valor del equipo entregado: <strong>${pesos(num(l.monto))}</strong></p>
        <div><label>Captura de ENACOM (verificación del IMEI, recomendada)</label>
          <p class="detalle">Revisá que el equipo no esté bloqueado en <a href="https://imei.enacom.gob.ar/" target="_blank" rel="noopener">imei.enacom.gob.ar</a> y sacale una captura del resultado.</p>
          <input type="file" data-campo="archivo" accept="image/jpeg,image/png,image/webp,application/pdf">
          <button type="button" class="quitar" style="margin-top:6px" data-accion="pegar-captura">📋 Pegar captura del portapapeles</button> <span class="detalle">(o apretá Ctrl+V)</span>
          ${l.archivo ? `<p class="detalle">${esc(l.archivo.name)} (${Math.round(l.archivo.size / 1024)} KB)</p>` : ''}
          ${l.archivo ? '' : '<p class="detalle" style="color:#b26a00">Sin captura: queda marcado en el panel como “sin verificar en ENACOM”.</p>'}</div>`)
        : `<div class="fila">
            <div><label>Monto${eEnDolares(l) ? ' (' + monedaDe(l) + ')' : ' ($)'}</label>
              <input type="text" inputmode="decimal" data-campo="monto" value="${esc(l.monto)}" placeholder="0" autocomplete="off"></div>
            ${eEnDolares(l) ? `<div><label>Cotización</label><input type="text" inputmode="decimal" data-campo="cotizacion" value="${esc(l.cotizacion)}" autocomplete="off"></div>` : ''}
          </div>`}
      ${l.metodo === 'credito' ? `<div class="fila">
          <div><label>Cuotas</label><input type="text" inputmode="numeric" data-campo="cuotas" value="${esc(l.cuotas)}" placeholder="Ej. 6" autocomplete="off"></div>
          <div><label>Recargo %</label><input type="text" inputmode="decimal" data-campo="recargo" value="${esc(l.recargo)}" placeholder="0" autocomplete="off"></div>
        </div>
        <p class="detalle">El cliente paga ${pesos(cobradoEnSuMoneda(l))}; a la venta se le suman ${pesos(num(l.monto))}.</p>` : ''}
      ${esTarjeta(l) ? `<div><label>Foto del cupón firmado por el cliente</label><input type="file" data-campo="archivo" accept="image/jpeg,image/png,image/webp,application/pdf">
          ${l.archivo ? `<p class="detalle">✔ Adjunto: ${esc(l.archivo.name)}</p>` : `<p class="detalle" style="color:#b26a00">Sin foto del cupón${typeof Legajo !== 'undefined' && Legajo.activo() ? ': queda pendiente en “Documentos y papeles”' : ''}.</p>`}</div>` : ''}
      ${necesitaCuenta ? `<div><label>Cuenta a la que entró</label>
          <select data-campo="cuentaId"><option value="">Elegí la cuenta…</option>${lista.map(c => `<option value="${c.id}"${String(l.cuentaId) === String(c.id) ? ' selected' : ''}>${esc(c.etiqueta)} — ${esc(c.titular)}${c.alias ? ' · ' + esc(c.alias) : ''}</option>`).join('')}</select>
          ${cuentas === false ? '<p class="detalle">No se pudieron cargar las cuentas. Probá de nuevo más tarde o dejá el cobro para después.</p>'
            : (!lista.length ? '<p class="detalle">No hay cuentas cargadas para este tipo de pago.</p>' : '')}
          ${detalleCuenta ? `<p class="detalle">${detalleCuenta}</p>` : ''}</div>
        <div><label>N° de operación (opcional)</label><input type="text" data-campo="referencia" value="${esc(l.referencia)}" autocomplete="off"></div>
        <div><label>Comprobante (foto o PDF, opcional)</label><input type="file" data-campo="archivo" accept="image/jpeg,image/png,image/webp,application/pdf">
          ${l.archivo ? `<p class="detalle">${esc(l.archivo.name)} (${Math.round(l.archivo.size / 1024)} KB)</p>` : ''}</div>` : ''}
      <button type="button" class="quitar" data-accion="quitar">Quitar este pago</button>
    </div>`;
  }

  function renderResumen() {
    const el = $id('gtCobroResumen');
    if (!el) return;
    const total = totalBruto();
    const cobrado = cobradoArs();
    const falta = total - cobrado;
    let clase = '', texto;
    if (!lineas.length && !planElegido) {
      texto = `Total <strong>${pesos(total)}</strong> · Sin cobro cargado (podés dejarlo para después; en administración figura “sin cobro registrado”).`;
    } else if (Math.abs(falta) <= 100) {
      clase = 'ok'; texto = `Total <strong>${pesos(total)}</strong> · Cobrado <strong>${pesos(cobrado)}</strong> · ✔ Cobro completo`;
    } else if (falta > 0) {
      clase = 'alerta'; texto = `Total <strong>${pesos(total)}</strong> · Cobrado <strong>${pesos(cobrado)}</strong> · <strong>Falta cobrar ${pesos(falta)}</strong>`;
    } else {
      clase = 'error'; texto = `Total <strong>${pesos(total)}</strong> · Cobrado <strong>${pesos(cobrado)}</strong> · <strong>Se cobró de más: ${pesos(-falta)}</strong>`;
    }
    if (planElegido) texto += ` <br><span style="font-size:12px">Incluye ${pesos(planElegido.pagado)} ya pagados en ${esc(planElegido.nombre)}.</span>`;
    el.className = clase;
    el.innerHTML = texto;
  }

  function htmlPlanes() {
    if (!planes.length) return '';
    return `<div class="cobro-linea" data-id="plan"><label>¿Esta venta completa una reserva o un plan de este cliente?</label><select data-plan><option value="">No</option>${planes.map(p => `<option value="${p.clave}"${planElegido && planElegido.clave === p.clave ? ' selected' : ''}>${esc(p.nombre)} · ${esc(p.equipo)} · ya pagó ${pesos(p.pagado)}</option>`).join('')}</select></div>`;
  }

  async function cargarPlanes() {
    planes = []; planElegido = null;
    if (typeof Legajo === 'undefined' || !Legajo.activo() || !dniVenta) return;
    const j = await Legajo.planesAbiertos(dniVenta);
    planes = j.reservas.map(r => ({ clave: 'reserva:' + r.id, id: r.id, tipo: 'reserva', nombre: 'Reserva ' + r.id, equipo: r.equipo, pagado: r.pagado_centavos / 100 }))
      .concat(j.financiaciones.map(f => ({ clave: 'financiacion:' + f.id, id: f.id, tipo: 'financiacion', nombre: 'Plan ' + f.id, equipo: f.equipo, pagado: f.pagado_centavos / 100 })));
    if (planes.length) render();
  }

  function render() {
    const cont = $id('gtCobroLineas');
    if (!cont) return;
    cont.innerHTML = htmlPlanes() + lineas.map(renderLinea).join('');
    renderResumen();
  }

  function lineaDe(el) {
    const caja = el.closest('.cobro-linea');
    return caja ? lineas.find(l => String(l.id) === caja.getAttribute('data-id')) : null;
  }

  async function cargarCuentas() {
    if (Array.isArray(cuentas)) return;
    let sinBase = false;
    try {
      const r = await fetch('/api/cuentas-cobro', { credentials: 'same-origin' });
      const j = await r.json().catch(() => null);
      cuentas = j && j.ok ? j.cuentas : false;
      // Base no conectada o sesion del login viejo: no hay cobro y la venta sigue como siempre.
      sinBase = !!(r.status === 401 || (j && j.noConfigurado));
    } catch (e) { cuentas = false; }   // sin conexion: la seccion queda, pero sin cuentas
    if (sinBase) {
      lineas = [];
      const cont = $id('gtCobroContenedor');
      if (cont) cont.classList.add('oculto');
    }
    render();
  }

  function iniciar() {
    lineas = lineasIniciales();
    const cont = $id('gtCobroContenedor');
    if (!cont) return;
    cont.classList.remove('oculto');
    planes = []; planElegido = null;
    render();
    cargarCuentas();
    cargarPlanes();
  }

  // ---------- validacion (antes de tocar stock o reportes) ----------
  function validar() {
    const fallo = mnsj => { MostrarAlerta({ tipo: 'error', title: 'Cobro', mnsj }); return false; };
    for (const l of lineas) {
      const nombre = (METODOS.find(m => m[0] === l.metodo) || [l.metodo, l.metodo])[1];
      if (l.metodo === 'canje' && !(typeof tradeInDelCarrito === 'function' && tradeInDelCarrito())) return fallo('No hay ningún equipo en canje (Trade In) en el carrito: quitá ese pago.');
      if (l.metodo !== 'canje' && !(num(l.monto) > 0)) return fallo(`Completá el monto del pago (${nombre}) o quitalo.`);
      if (eEnDolares(l) && !(num(l.cotizacion) > 0)) return fallo(`Completá la cotización del dólar en el pago (${nombre}).`);
      if (l.metodo === 'credito') {
        const c = Math.round(num(l.cuotas));
        if (!(c >= 1 && c <= 24)) return fallo('Completá la cantidad de cuotas del crédito (entre 1 y 24).');
        if (num(l.recargo) < -100 || num(l.recargo) > 200) return fallo('El recargo del crédito no es válido.');
      }
      if ((l.metodo === 'transferencia' || l.metodo === 'usdt') && !l.cuentaId) return fallo(`Elegí la cuenta a la que entró la ${l.metodo === 'usdt' ? 'transferencia en USDT' : 'transferencia'}.`);
      if (l.archivo && l.archivo.size > MAX_BYTES_COMPROBANTE) return fallo('El comprobante pesa más de 10 MB. Sacale una foto más liviana.');
    }
    if (lineas.length && cobradoArs() - totalBruto() > 100) return fallo('Los pagos cargados superan el total de la venta: revisá los montos.');
    return true;
  }

  // ---------- armado de la venta ----------
  const categoriaAccesorio = g => {
    const t = (g.nombreProducto + ' ' + (g.marca || '')).toLowerCase();
    if (/pencil/.test(t)) return 'apple_pencil';
    if (/magic mouse|\bmouse\b/.test(t)) return 'magic_mouse';
    if (/jbl/.test(t)) return 'jbl';
    if (/playstation|sony|\bps5\b|\bps4\b/.test(t)) return 'playstation';
    return 'accesorio';
  };

  function itemsDeLaVenta() {
    const items = garantiaCombinada.map(g => {
      if (g.tipo === 'accesorio') {
        return { tipo: 'accesorio', categoria: categoriaAccesorio(g), descripcion: g.nombreProducto, modelo: g.nombreProducto, imeiSerie: g.imei, precio: g.precio, garantiaMeses: 12, garantiaMarca: g.marca, versionTexto: VERSION_TEXTO_GARANTIA };
      }
      const bat = g.bateria ? parseInt(String(g.bateria), 10) : null;
      return {
        tipo: 'equipo', categoria: categoriaGarantia(g.modelo),
        descripcion: [g.modelo, g.capacidad, g.color].filter(Boolean).join(' '),
        modelo: g.modelo, capacidad: g.capacidad, condicion: g.condicion, color: g.color, imeiSerie: g.imei,
        bateriaPct: bat, precio: g.precio,
        garantiaMeses: g.condicion === 'seminuevo' ? 3 : 12, garantiaMarca: g.condicion === 'seminuevo' ? 'Jobs Company' : 'Apple',
        versionTexto: VERSION_TEXTO_GARANTIA
      };
    });
    // Lo que no tiene garantia propia (fundas, vidrios, cargadores…) va un renglon por producto.
    const conGarantiaEquipo = garantiaCombinada.some(g => g.tipo !== 'accesorio');
    const sueltos = (typeof carrito !== 'undefined' ? carrito : [])
      .filter(it => it.precio > 0 && !it.tieneGarantiaPropia && !(conGarantiaEquipo && it.esEquipoPrincipal) && it.tipo !== 'Trade In');
    let resto = Math.round((totalBruto() - items.reduce((s, i) => s + i.precio, 0)) * 100) / 100;
    const cupo = 20 - items.length;
    sueltos.slice(0, Math.max(0, sueltos.length > cupo ? cupo - 1 : cupo)).forEach(it => {
      const precio = Math.min(resto, it.precio);
      if (precio <= 0) return;
      items.push({ tipo: 'accesorio', categoria: categoriaAccesorio({ nombreProducto: it.nombreProducto || it.descripcion || '' }), descripcion: String(it.descripcion || it.tipo).slice(0, 300), modelo: it.nombreProducto || null, precio });
      resto = Math.round((resto - precio) * 100) / 100;
    });
    if (resto > 0) items.push({ tipo: 'accesorio', categoria: 'accesorio', descripcion: sueltos.length ? 'Otros productos del carrito' : 'Ajuste de la venta', precio: resto });
    return items;
  }

  function pagosDeLaVenta() {
    return lineas.map(l => {
      const p = { metodo: l.metodo, moneda: monedaDe(l) === 'USDT' ? 'USD' : monedaDe(l), referencia: l.referencia || null };
      if (l.metodo === 'canje') return p;
      if (l.metodo === 'credito') { p.cuotas = Math.round(num(l.cuotas)); p.recargoPct = num(l.recargo); p.monto = cobradoEnSuMoneda(l); p.equivArs = num(l.monto); return p; }
      p.monto = num(l.monto);
      if (eEnDolares(l)) p.cotizacion = num(l.cotizacion);
      if (l.cuentaId) p.cuentaId = Number(l.cuentaId);
      return p;
    });
  }

  function armarPayload() {
    const sesion = typeof sesionGuardada === 'function' ? sesionGuardada() : null;
    const ti = typeof tradeInDelCarrito === 'function' ? tradeInDelCarrito() : null;
    const cv = typeof canjeVenta !== 'undefined' ? canjeVenta : null;   // datos del paso "equipo en canje"
    return {
      opId: opIdVenta,
      cliente: { nombre: clienteVenta, dni: dniVenta, email: emailVenta, aceptaMails: !!enviarMailVenta, aceptaOfertas: !!(typeof legajoVenta !== 'undefined' && legajoVenta && legajoVenta.aceptaOfertas), telefono: telefonoVenta, domicilio: cv && cv.domicilio },
      sucursal: sucursalActual, local: localVenta,
      vendedor: (garantiaCombinada[0] && garantiaCombinada[0].vendedor) || (typeof legajoVenta !== 'undefined' && legajoVenta && legajoVenta.vendedor) || (sesion && sesion.nombre) || '',
      reservaId: planElegido && planElegido.tipo === 'reserva' ? planElegido.id : undefined,
      financiacionId: planElegido && planElegido.tipo === 'financiacion' ? planElegido.id : undefined,
      // Total BRUTO: el canje y las entregas en efectivo no se restan, se cargan como pagos.
      cotizacionUsd: dolar(), totalPesos: totalBruto(),
      pauta: !!pautaVenta, garantiaImpresa: garantiaCombinada.length > 0,
      items: itemsDeLaVenta(),
      tradeIn: ti ? {
        imeiSerie: (cv && cv.imeiSerie) || 'SIN DATO', modelo: ti.modelo, valor: -ti.precio,
        capacidad: cv && cv.capacidad, color: cv && cv.color, bateriaPct: cv && cv.bateriaPct, falla: cv && cv.falla
      } : null,
      pagos: pagosDeLaVenta()
    };
  }

  // ---------- envio, cola y reintentos ----------
  function leerCola(clave) { try { return JSON.parse(localStorage.getItem(clave) || '[]'); } catch (e) { return []; } }
  function guardarCola(clave, lista) { try { localStorage.setItem(clave, JSON.stringify(lista)); } catch (e) { /* sin espacio: no se frena nada */ } }

  async function enviar(payload) {
    try {
      const r = await fetch('/api/ventas', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      let j = null; try { j = await r.json(); } catch (e) { /* respuesta no JSON */ }
      return { status: r.status, j };
    } catch (e) {
      return { status: 0, j: null };   // sin conexion
    }
  }

  function encolar(payload) {
    const cola = leerCola(CLAVE_PENDIENTES).filter(x => x.payload.opId !== payload.opId);
    cola.push({ payload, desde: Date.now() });
    guardarCola(CLAVE_PENDIENTES, cola.slice(-MAX_PENDIENTES));
  }

  async function achicar(f) {
    if (!f || !/^image\//.test(f.type) || typeof Legajo === 'undefined') return f;
    try {
      const blob = await Legajo.comprimir(f, 1600);
      return blob.size < f.size ? new File([blob], String(f.name || 'foto').replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' }) : f;
    } catch (e) { return f; }   // si no se puede achicar, sube la original
  }

  async function subirComprobantes(pagoIds, archivos) {
    const fallidos = [];
    for (let i = 0; i < archivos.length; i++) {
      const f = archivos[i];
      if (!f || !pagoIds[i]) continue;
      try {
        const r = await fetch('/api/pagos/' + pagoIds[i] + '/comprobante', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Nombre-Archivo': encodeURIComponent(f.name || '') },
          body: f
        });
        if (!r.ok) fallidos.push(f.name);
      } catch (e) { fallidos.push(f.name); }
    }
    return fallidos;
  }

  // Se llama al terminar la venta (ver avanzarColaGarantia). No espera a nadie ni lanza errores.
  async function registrarVenta() {
    let payload;
    try { payload = armarPayload(); } catch (e) { console.log('[cobro] no se pudo armar la venta', e); return; }
    const originales = lineas.map(l => l.archivo || null);
    const resp = await enviar(payload);
    const archivos = await Promise.all(originales.map(achicar));

    if (resp.j && resp.j.ok) {
      const fallidos = await subirComprobantes(resp.j.pagoIds || [], archivos);
      if (fallidos.length) MostrarAlerta({ tipo: 'warning', title: 'Comprobante', mnsj: 'La venta quedó registrada, pero no se pudo subir el comprobante (' + fallidos.join(', ') + '). Pedile a administración que lo cargue.' });
      return;
    }
    if (resp.status === 400) {
      // Datos que el servidor rechaza: reintentar no lo arregla. Se guarda aparte para que no se pierda.
      guardarCola(CLAVE_CON_ERROR, leerCola(CLAVE_CON_ERROR).concat([{ payload, error: resp.j && resp.j.error, desde: Date.now() }]).slice(-MAX_PENDIENTES));
      MostrarAlerta({ tipo: 'warning', title: 'Venta', mnsj: 'La venta salió y se imprimió, pero no se pudo registrar en la base: ' + ((resp.j && resp.j.error) || 'datos inválidos') + '. Avisale al administrador.' });
      return;
    }
    if (resp.status === 503 && resp.j && resp.j.noConfigurado) return;   // la base no esta conectada: todo sigue como antes
    encolar(payload);
    if (resp.status === 401) return;   // sesion del login viejo o vencida: se reintenta sola, sin avisar a cada venta
    let sinComprobante = '';
    if (archivos.some(Boolean)) {
      try { await Legajo.retenerComprobantes(payload.opId, archivos); sinComprobante = ' Los comprobantes también quedan guardados y se suben solos.'; }
      catch (e) { sinComprobante = ' Los comprobantes adjuntos no se pudieron guardar: cargalos después.'; }
    }
    MostrarAlerta({ tipo: 'warning', title: 'Venta', mnsj: 'La venta salió y se imprimió. No se pudo registrar en la base ahora: queda guardada en este equipo y se reintenta sola.' + sinComprobante });
  }

  let reintentando = false;
  async function reintentarPendientes() {
    if (reintentando) return;
    const cola = leerCola(CLAVE_PENDIENTES);
    if (!cola.length) return;
    reintentando = true;
    try {
      const quedan = [];
      for (const item of cola) {
        const resp = await enviar(item.payload);
        if (resp.j && resp.j.ok) { if (typeof Legajo !== 'undefined') Legajo.asignarPagos(item.payload.opId, resp.j.pagoIds || []); continue; }   // ya esta en la base
        if (resp.status === 400) { guardarCola(CLAVE_CON_ERROR, leerCola(CLAVE_CON_ERROR).concat([{ payload: item.payload, error: resp.j && resp.j.error, desde: item.desde }]).slice(-MAX_PENDIENTES)); continue; }
        quedan.push(item);
      }
      guardarCola(CLAVE_PENDIENTES, quedan);
    } finally { reintentando = false; }
  }

  // ---------- planilla de pagos impresa (se completa sola) ----------
  function resumenParaPlanilla() {
    const suma = filtro => lineas.filter(filtro).reduce((s, l) => s + num(l.monto), 0);
    const cuentasDe = filtro => lineas.filter(filtro).map(l => (cuentaPorId(l.cuentaId) || {}).etiqueta).filter(Boolean).join(' / ');
    const fmtUsd = n => n ? 'USD ' + formatNumberArg(n) : '';
    const efArs = suma(l => l.metodo === 'efectivo' && l.moneda === 'ARS');
    const deb = suma(l => l.metodo === 'debito'), qr = suma(l => l.metodo === 'qr');
    const otros = [efArs && 'Efectivo ' + pesos(efArs), deb && 'Débito ' + pesos(deb), qr && 'QR ' + pesos(qr)].filter(Boolean).join(' + ');
    const trfPesos = suma(l => l.metodo === 'transferencia' && l.moneda === 'ARS');
    const credito = lineas.filter(l => l.metodo === 'credito');
    return {
      usdBillete: fmtUsd(suma(l => l.metodo === 'efectivo' && l.moneda === 'USD')),
      transfPesos: trfPesos ? pesos(trfPesos) : '',
      cuentaPesos: cuentasDe(l => l.metodo === 'transferencia' && l.moneda === 'ARS'),
      transfUsd: fmtUsd(suma(l => l.metodo === 'transferencia' && l.moneda === 'USD')),
      cuentaUsd: cuentasDe(l => l.metodo === 'transferencia' && l.moneda === 'USD'),
      credito: credito.length ? pesos(credito.reduce((s, l) => s + cobradoEnSuMoneda(l), 0)) : '',
      cuotas: credito.map(l => l.cuotas).filter(Boolean).join(' / '),
      usdt: suma(l => l.metodo === 'usdt') ? 'USDT ' + formatNumberArg(suma(l => l.metodo === 'usdt')) : '',
      cuentaUsdt: cuentasDe(l => l.metodo === 'usdt'),
      otros,
      cupones: lineas.filter(esTarjeta).map(l => l.metodo === 'credito'
        ? 'Crédito · ' + (l.cuotas || '?') + (Number(l.cuotas) === 1 ? ' cuota' : ' cuotas') + ' · ' + pesos(cobradoEnSuMoneda(l))
        : 'Débito · ' + pesos(num(l.monto)))
    };
  }

  // ---------- captura de ENACOM pegada desde el portapapeles ----------
  // Se adjunta al pago del canje (la linea que todavia no tiene archivo).
  function adjuntarCapturaAlCanje(blob) {
    const l = lineas.find(x => x.metodo === 'canje');
    if (!l) return false;
    const ext = blob.type === 'image/jpeg' ? 'jpg' : (blob.type === 'image/webp' ? 'webp' : 'png');
    l.archivo = new File([blob], 'captura-enacom.' + ext, { type: blob.type || 'image/png' });
    render();
    return true;
  }
  async function pegarCapturaDelPortapapeles() {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('sin permiso');
      for (const item of await navigator.clipboard.read()) {
        const tipo = item.types.find(t => t.startsWith('image/'));
        if (tipo) { adjuntarCapturaAlCanje(await item.getType(tipo)); MostrarAlerta({ tipo: 'success', title: 'ENACOM', mnsj: 'Captura pegada' }); return; }
      }
      MostrarAlerta({ tipo: 'error', title: 'ENACOM', mnsj: 'No hay ninguna imagen en el portapapeles. Sacá la captura y probá de nuevo.' });
    } catch (e) {
      MostrarAlerta({ tipo: 'warning', title: 'ENACOM', mnsj: 'El navegador no dejó leer el portapapeles. Apretá Ctrl+V con esta pantalla abierta, o elegí la imagen con el botón de archivo.' });
    }
  }

  // ---------- enganche con la pantalla ----------
  function conectar() {
    // Ctrl+V con la pantalla de pagos abierta: si lo pegado es una imagen, va a la captura del canje.
    document.addEventListener('paste', ev => {
      const modal = $id('modalPagos');
      if (!modal || getComputedStyle(modal).display === 'none') return;
      const t = ev.target;
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName) && t.type !== 'file') return;   // no pisar el texto de los campos
      const img = Array.from((ev.clipboardData && ev.clipboardData.items) || []).find(i => i.kind === 'file' && i.type.startsWith('image/'));
      if (!img) return;
      if (adjuntarCapturaAlCanje(img.getAsFile())) { ev.preventDefault(); MostrarAlerta({ tipo: 'success', title: 'ENACOM', mnsj: 'Captura pegada' }); }
    });
    const cont = $id('gtCobroLineas');
    if (!cont) return;
    const agregar = $id('gtCobroAgregar');
    if (agregar) agregar.addEventListener('click', () => { lineas.push(nueva()); render(); });

    cont.addEventListener('click', ev => {
      if (ev.target.getAttribute('data-accion') === 'pegar-captura') { pegarCapturaDelPortapapeles(); return; }
      if (ev.target.getAttribute('data-accion') !== 'quitar') return;
      const l = lineaDe(ev.target);
      if (l) { lineas = lineas.filter(x => x !== l); render(); }
    });
    cont.addEventListener('input', ev => {
      const campo = ev.target.getAttribute('data-campo');
      const l = lineaDe(ev.target);
      if (!campo || !l || campo === 'archivo' || ev.target.tagName === 'SELECT') return;
      l[campo] = ev.target.value;
      renderResumen();
      if (campo === 'monto' && l.metodo === 'credito') { const p = ev.target.closest('.cobro-linea').querySelector('p.detalle'); if (p) p.innerHTML = `El cliente paga ${pesos(cobradoEnSuMoneda(l))}; a la venta se le suman ${pesos(num(l.monto))}.`; }
    });
    cont.addEventListener('change', ev => {
      if (ev.target.hasAttribute('data-plan')) { planElegido = planes.find(p => p.clave === ev.target.value) || null; render(); return; }
      const campo = ev.target.getAttribute('data-campo');
      const l = lineaDe(ev.target);
      if (!campo || !l) return;
      if (campo === 'archivo') { l.archivo = ev.target.files && ev.target.files[0] || null; render(); return; }
      l[campo] = ev.target.value;
      if (campo === 'metodo') {
        if (l.metodo === 'usdt') l.moneda = 'USD';
        l.cuentaId = ''; l.cuotas = ''; l.recargo = ''; l.archivo = null;
        if (l.metodo === 'canje') { const ti = typeof tradeInDelCarrito === 'function' ? tradeInDelCarrito() : null; l.monto = ti ? -ti.precio : ''; }
      }
      if (campo === 'moneda') l.cuentaId = '';
      render();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    conectar();
    reintentarPendientes();
    setInterval(reintentarPendientes, 60 * 1000);
  });

  function limpiar() { lineas = []; }

  return { iniciar, validar, limpiar, registrarVenta, resumenParaPlanilla, reintentarPendientes };
})();
