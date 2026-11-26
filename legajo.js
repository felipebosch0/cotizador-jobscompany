// ============================ LEGAJO DIGITAL (pantallas del vendedor) ============================
// - Antes de cada operacion: DNI del cliente (frente y dorso), una sola vez por operacion.
// - Despues de imprimir: foto de los papeles firmados ("Documentos pendientes").
// - Nada se pierde sin internet: fotos, papeles y operaciones quedan en una cola del equipo
//   (IndexedDB) y se suben solas. No se descartan por antiguedad.
// - Delegado de local: cantidades y avance de su local.
// Solo se activa en las sucursales con el flujo nuevo prendido (lo dice el servidor).
// Usa globales de app.js (sucursalActual, LOCALES_VENTA, vendedoresDeSucursal, MostrarAlerta...).

const Legajo = (function () {
  let config = null;
  let sincronizando = false;
  let cuentas = null;
  const $id = id => document.getElementById(id);
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const aviso = (tipo, mnsj, titulo) => MostrarAlerta({ tipo, title: titulo || 'Legajo', mnsj });
  const NOMBRE_DOC = { dni_frente: 'DNI (frente)', dni_dorso: 'DNI (dorso)', enacom: 'Captura de ENACOM', garantia_firmada: 'Garantía firmada', declaracion_firmada: 'Declaración jurada firmada', reserva_firmada: 'Reserva firmada', financiacion_firmada: 'Plan firmado', recibo_firmado: 'Recibo firmado', cupon_tarjeta: 'Cupón de tarjeta firmado' };
  const nuevoId = () => 'lg-' + Date.now().toString(36) + '-' + Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(36)).join('').slice(0, 12);

  (function estilos() {
    const css = document.createElement('style');
    css.textContent = `
      .lg-modal { position: fixed; inset: 0; z-index: 10050; background: rgba(0,0,0,.55); display: flex; align-items: flex-start; justify-content: center; overflow: auto; -webkit-overflow-scrolling: touch; padding: 16px 10px 40px; }
      .lg-caja { width: 100%; max-width: 560px; background: var(--ap-card, #fff); color: var(--ap-text, #1d1d1f); border-radius: 18px; padding: 18px; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
      .lg-caja h3 { margin: 0 0 6px; }
      .lg-caja label { display: block; margin: 12px 0 4px; font-size: 13px; font-weight: 600; }
      .lg-caja input[type=text], .lg-caja input[type=tel], .lg-caja input[type=email], .lg-caja select, .lg-caja input[type=month], .lg-caja input[type=number] { width: 100%; box-sizing: border-box; font-size: 16px; min-height: 44px; padding: 8px 12px; border: 1px solid var(--ap-line, #ccc); border-radius: 10px; background: transparent; color: inherit; }
      .lg-boton { min-height: 44px; padding: 8px 16px; border-radius: 12px; border: 1px solid var(--ap-line, #ccc); background: transparent; color: inherit; font-size: 15px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
      .lg-boton.principal { background: var(--ap-accent, #0071e3); border-color: var(--ap-accent, #0071e3); color: #fff; font-weight: 600; width: 100%; justify-content: center; margin-top: 14px; }
      .lg-boton:disabled { opacity: .45; }
      .lg-fila { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .lg-foto { border: 1px dashed var(--ap-line, #bbb); border-radius: 14px; padding: 10px; margin-top: 10px; }
      .lg-foto.lista { border-style: solid; border-color: #34c759; }
      .lg-foto img { max-width: 100%; max-height: 180px; border-radius: 8px; display: block; margin-top: 8px; }
      .lg-suave { font-size: 12.5px; opacity: .72; margin: 4px 0; }
      .lg-aprendizaje { font-size: 13px; line-height: 1.4; margin: 10px 0 0; padding: 9px 12px; border-radius: 10px; background: rgba(255,149,0,.18); }
      #lgAccesos .lg-aprendizaje { flex-basis: 100%; margin: 0; }
      .lg-item { border: 1px solid var(--ap-line, #ddd); border-radius: 14px; padding: 10px 12px; margin-top: 10px; }
      .lg-barra { height: 8px; border-radius: 5px; background: rgba(127,127,127,.25); overflow: hidden; margin: 3px 0 8px; }
      .lg-barra i { display: block; height: 100%; background: #34c759; }
      #lgAccesos { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0 0; }
      #lgAccesos .lg-boton b { background: #ff9500; color: #fff; border-radius: 10px; padding: 0 7px; font-size: 12px; }
    `;
    document.head.appendChild(css);
  })();

  // ---------- configuracion ----------
  async function cargarConfig() {
    const sesion = typeof sesionGuardada === 'function' ? sesionGuardada() : null;
    if (!sesion) return null;
    try {
      const r = await fetch('/api/config', { credentials: 'same-origin' });
      if (r.ok) { config = await r.json(); localStorage.setItem('legajoConfig', JSON.stringify(config)); }
    } catch (e) { /* sin conexion: se usa la ultima configuracion conocida */ }
    if (!config) { try { config = JSON.parse(localStorage.getItem('legajoConfig') || 'null'); } catch (e) { config = null; } }
    pintarAccesos();
    if (typeof renderCarrito === 'function') renderCarrito();
    return config;
  }

  // El flujo nuevo esta prendido en la sucursal que se esta usando.
  function activo(sucursal) {
    const lista = (config && config.flujoNuevo) || [];
    const s = String(sucursal || (typeof sucursalActual !== 'undefined' ? sucursalActual : '')).toLowerCase();
    return lista.indexOf('*') !== -1 || lista.indexOf(s) !== -1;
  }

  // Mientras aprenden: las fotos del DNI y la forma de pago de la seña no frenan la operacion.
  function enAprendizaje(sucursal) {
    const lista = (config && config.modoAprendizaje) || [];
    const s = String(sucursal || (typeof sucursalActual !== 'undefined' ? sucursalActual : '')).toLowerCase();
    return activo(sucursal) && (lista.indexOf('*') !== -1 || lista.indexOf(s) !== -1);
  }

  // ---------- fotos: se achican en el equipo antes de subirlas ----------
  async function comprimir(archivo, ladoMaximo) {
    if (archivo.type === 'application/pdf') {
      if (archivo.size > 3 * 1024 * 1024) throw new Error('El PDF pesa más de 3 MB. Sacale una foto al papel.');
      return archivo;
    }
    let imagen;
    try { imagen = await createImageBitmap(archivo, { imageOrientation: 'from-image' }); }
    catch (e) {
      imagen = await new Promise((ok, mal) => { const i = new Image(); const url = URL.createObjectURL(archivo); i.onload = () => { URL.revokeObjectURL(url); ok(i); }; i.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer esa imagen')); }; i.src = url; });
    }
    let lado = ladoMaximo, calidad = 0.74, blob = null;
    for (let intento = 0; intento < 4; intento++) {
      const escala = Math.min(1, lado / Math.max(imagen.width, imagen.height));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.max(1, Math.round(imagen.width * escala)); lienzo.height = Math.max(1, Math.round(imagen.height * escala));
      const g = lienzo.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, lienzo.width, lienzo.height); g.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
      blob = await new Promise(ok => lienzo.toBlob(ok, 'image/jpeg', calidad));
      lienzo.width = lienzo.height = 0;   // libera memoria (importante en el iPad)
      if (blob && blob.size <= 300 * 1024) break;
      calidad -= 0.08; lado = Math.round(lado * 0.88);
    }
    if (imagen.close) imagen.close();
    if (!blob) throw new Error('No se pudo preparar la foto');
    return blob;
  }

  // Foto de un comprobante o cupon, achicada, lista para la cola.
  async function prepararAdjunto(archivo) {
    const blob = await comprimir(archivo, 1600);
    return { mime: blob.type || 'image/jpeg', nombre: archivo.name, datos: await blob.arrayBuffer() };
  }

  // ---------- cola en el equipo (IndexedDB) ----------
  const BASE = 'legajo-cola';
  function abrirBase() {
    return new Promise((ok, mal) => {
      const p = indexedDB.open(BASE, 1);
      p.onupgradeneeded = () => p.result.createObjectStore('cola', { keyPath: 'id' });
      p.onsuccess = () => ok(p.result); p.onerror = () => mal(p.error);
    });
  }
  async function enBase(modo, fn) {
    const db = await abrirBase();
    return new Promise((ok, mal) => {
      const tx = db.transaction('cola', modo); const r = fn(tx.objectStore('cola'));
      tx.oncomplete = () => { db.close(); ok(r && r.result); }; tx.onerror = () => { db.close(); mal(tx.error); };
    });
  }
  const leerCola = async () => ((await enBase('readonly', s => s.getAll())) || []).sort((a, b) => a.orden - b.orden);
  const guardarEnCola = item => enBase('readwrite', s => s.put(item));
  const sacarDeCola = id => enBase('readwrite', s => s.delete(id));
  let ultimoOrden = 0;
  const siguienteOrden = () => (ultimoOrden = Math.max(Date.now(), ultimoOrden + 1));

  async function mandar(item) {
    if (item.clase === 'foto') {
      const q = new URLSearchParams({ opid: item.opid, tipo: item.tipo, sucursal: item.sucursal });
      if (item.dni) q.set('dni', item.dni);
      return fetch('/api/documentos/' + encodeURIComponent(item.id) + '?' + q, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': item.mime }, body: new Blob([item.datos], { type: item.mime }) });
    }
    if (item.clase === 'impresion') {
      const q = new URLSearchParams({ titulo: item.titulo, sucursal: item.sucursal });
      return fetch('/api/impresiones/' + encodeURIComponent(item.opid) + '/' + item.tipo + '?' + q, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'text/html;charset=utf-8' }, body: item.html });
    }
    if (item.clase === 'comprobante') {
      return fetch('/api/pagos/' + item.pagoId + '/comprobante', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': item.mime, 'X-Nombre-Archivo': encodeURIComponent(item.nombre || '') }, body: new Blob([item.datos], { type: item.mime }) });
    }
    return fetch(item.ruta, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.cuerpo) });
  }

  // Sube lo pendiente. Lo que el servidor rechaza queda marcado (no se borra ni se reintenta en vano).
  async function sincronizar() {
    if (sincronizando) return;
    sincronizando = true;
    try {
      for (const item of await leerCola()) {
        if (item.error) continue;
        if (item.clase === 'comprobante' && !item.pagoId) continue;   // espera a que la venta quede registrada
        let r;
        try { r = await mandar(item); } catch (e) { break; }   // sin conexion: se sigue despues
        if (r.status === 401 || r.status === 503 || r.status >= 500) break;
        let j = null; try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
        if (r.ok) {
          await sacarDeCola(item.id);
          if (item.clase === 'operacion' && item.comprobante && j && j.pagoIds && j.pagoIds[0]) {
            await guardarEnCola(Object.assign({ id: nuevoId(), orden: siguienteOrden(), clase: 'comprobante', pagoId: j.pagoIds[0] }, item.comprobante));
            sincronizando = false; return sincronizar();
          }
        } else {
          await guardarEnCola(Object.assign(item, { error: (j && j.error) || ('Rechazado (' + r.status + ')') }));
          aviso('warning', 'No se pudo subir un archivo o una operación: ' + ((j && j.error) || r.status) + '. Avisale al administrador.');
        }
      }
    } catch (e) { console.log('[legajo] cola: ' + e.message); }
    finally { sincronizando = false; pintarContador(); }
  }

  // Guarda en el equipo y recien ahi intenta subir. Si el equipo no deja guardar, sube en el momento.
  async function encolar(item) {
    const completo = Object.assign({ orden: siguienteOrden(), sucursal: sucursalActual }, item);
    try { await guardarEnCola(completo); }
    catch (e) {
      const r = await mandar(completo);
      if (!r.ok) throw new Error('No se pudo guardar. Revisá la conexión y volvé a intentar.');
      return;
    }
    sincronizar();
  }

  async function guardarFoto({ opid, tipo, dni, archivo }) {
    const blob = await comprimir(archivo, tipo.startsWith('dni') || tipo === 'enacom' ? 1600 : 2000);
    await encolar({ id: nuevoId(), clase: 'foto', opid, tipo, dni: dni || null, mime: blob.type || 'image/jpeg', datos: await blob.arrayBuffer() });
  }

  function guardarImpresion(opid, tipo, titulo, html) {
    if (!activo() || !opid) return;
    encolar({ id: nuevoId(), clase: 'impresion', opid, tipo, titulo, html: String(html) }).catch(e => console.log('[legajo] impresion: ' + e.message));
  }

  // Los comprobantes de una venta que quedo en cola se guardan hasta saber el numero de pago.
  async function retenerComprobantes(opid, archivos) {
    for (let i = 0; i < archivos.length; i++) {
      const f = archivos[i];
      if (!f) continue;
      await encolar({ id: nuevoId(), clase: 'comprobante', opid, indice: i, mime: f.type, nombre: f.name, datos: await f.arrayBuffer(), pagoId: null });
    }
  }
  async function asignarPagos(opid, pagoIds) {
    try {
      for (const item of await leerCola()) {
        if (item.clase === 'comprobante' && item.opid === opid && !item.pagoId && pagoIds[item.indice]) await guardarEnCola(Object.assign(item, { pagoId: pagoIds[item.indice] }));
      }
    } catch (e) { return; }
    sincronizar();
  }

  async function pendientesEnEquipo() { try { return (await leerCola()).length; } catch (e) { return 0; } }

  // ---------- ventanas ----------
  function abrirCaja(html) {
    const fondo = document.createElement('div');
    fondo.className = 'lg-modal';
    fondo.innerHTML = '<div class="lg-caja">' + html + '</div>';
    document.body.appendChild(fondo);
    document.body.dataset.lgModal = '1';
    fondo.cerrar = () => { fondo.remove(); if (!document.querySelector('.lg-modal')) delete document.body.dataset.lgModal; };
    return fondo;
  }

  // Control para sacar o elegir una foto. onArchivo(file) se llama cuando hay una.
  function campoFoto(clave, titulo, nota) {
    return `<div class="lg-foto" data-foto="${clave}"><strong>${esc(titulo)}</strong>${nota ? '<p class="lg-suave">' + nota + '</p>' : ''}
      <div class="lg-fila" style="margin-top:6px;">
        <label class="lg-boton" style="margin:0;">📷 Sacar foto<input type="file" accept="image/*" capture="environment" hidden></label>
        <label class="lg-boton" style="margin:0;">🖼️ Elegir archivo<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden></label>
      </div><div data-vista></div></div>`;
  }
  function conectarFoto(caja, clave, onArchivo) {
    const bloque = caja.querySelector(`[data-foto="${clave}"]`);
    bloque.querySelectorAll('input[type=file]').forEach(inp => inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const vista = bloque.querySelector('[data-vista]');
      vista.innerHTML = f.type.startsWith('image/') ? '<img alt="foto"><p class="lg-suave">Revisá que se lea bien. Si no, sacala de nuevo.</p>' : '<p class="lg-suave">' + esc(f.name) + '</p>';
      const img = vista.querySelector('img'); if (img) { img.src = URL.createObjectURL(f); img.onload = () => URL.revokeObjectURL(img.src); }
      bloque.classList.add('lista');
      onArchivo(f);
    }));
  }

  async function cargarCuentas() {
    if (cuentas) return cuentas;
    try { const r = await fetch('/api/cuentas-cobro', { credentials: 'same-origin' }); const j = await r.json(); cuentas = j.cuentas || []; } catch (e) { return []; }
    return cuentas;
  }

  // ---------- paso "DNI del cliente" (una vez por operacion) ----------
  // opciones: { opid, titulo, nombre, dni, telefono, email, pedirContacto, pedirLocal, pago: {monto, obligatorio}, imprime }
  // Devuelve null si se cierra. "imprime": deja abierta la ventana de impresion en el mismo toque (iPad).
  function pedirDatos(opciones) {
    const o = Object.assign({ titulo: 'DNI del cliente' }, opciones);
    return new Promise(resolver => {
      const sesion = sesionGuardada() || {};
      const practica = enAprendizaje();
      const locales = (typeof LOCALES_VENTA !== 'undefined' && LOCALES_VENTA[sucursalActual]) || [];
      const vendedores = typeof vendedoresDeSucursal === 'function' ? vendedoresDeSucursal(sucursalActual) : [];
      const caja = abrirCaja(`
        <div class="lg-fila" style="justify-content:space-between;"><h3>${esc(o.titulo)}</h3><button type="button" class="lg-boton" data-cerrar aria-label="Cerrar">✕</button></div>
        <label>Nombre y apellido</label><input type="text" data-c="nombre" autocomplete="off" value="${esc(o.nombre || '')}">
        <label>DNI (solo números)</label><input type="text" data-c="dni" inputmode="numeric" autocomplete="off" value="${esc(o.dni || '')}">
        <div data-ya class="lg-suave"></div>
        ${practica ? '<p class="lg-aprendizaje">🎓 <b>Modo aprendizaje:</b> si ahora no podés sacar las fotos, seguí y cargalas después en “Documentos y papeles”.</p>' : ''}
        ${campoFoto('frente', 'Foto del DNI: frente')}
        ${campoFoto('dorso', 'Foto del DNI: dorso')}
        ${o.pedirContacto ? `<label>Teléfono (con código de área, sin 0 ni 15)</label><input type="tel" data-c="telefono" autocomplete="off" value="${esc(o.telefono || '')}"><label>Email (opcional)</label><input type="email" data-c="email" autocomplete="off" value="${esc(o.email || '')}">` : ''}
        ${o.pedirLocal ? `<label>Vendedor</label><select data-c="vendedor">${vendedores.map(v => `<option${v.toLowerCase() === String(sesion.nombre || '').toLowerCase() ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
          ${locales.length > 1 ? `<label>Local</label><select data-c="local"><option value="">Elegí el local…</option>${locales.map(l => `<option>${esc(l.nombre)}</option>`).join('')}</select>` : ''}` : ''}
        ${o.pago ? `<label>${o.pago.obligatorio ? 'Cómo pagó la seña' : 'Entrega inicial (opcional)'}</label>
          <select data-c="metodo">${o.pago.obligatorio ? '' : '<option value="">No entrega nada ahora</option>'}<option value="efectivo">Efectivo en pesos</option><option value="efectivo_usd">Efectivo en dólares</option><option value="transferencia">Transferencia en pesos</option><option value="debito">Débito</option><option value="qr">QR</option>${o.pago.obligatorio && practica ? '<option value="">No cargar ahora</option>' : ''}</select>
          <div data-montoin${o.pago.obligatorio ? ' hidden' : ' hidden'}><label>Monto (en la moneda elegida)</label><input type="text" data-c="monto" inputmode="decimal" autocomplete="off"></div>
          <div data-cuentain hidden><label>Cuenta a la que entró</label><select data-c="cuenta"><option value="">Elegí la cuenta…</option></select>${campoFoto('comprobante', 'Comprobante (opcional)')}</div>
          <div data-cuponin hidden>${campoFoto('cupon', 'Foto del cupón firmado por el cliente')}</div>` : ''}
        <label style="display:flex; gap:10px; align-items:center; font-weight:400;"><input type="checkbox" data-c="ofertas" style="width:22px; height:22px;"> El cliente acepta recibir ofertas de recambio y novedades</label>
        <p class="lg-suave">Los datos y las fotos se usan para registrar la operación y la garantía. El cliente puede pedir verlos, corregirlos o darlos de baja.</p>
        <p class="lg-aprendizaje" data-faltan hidden></p>
        <button type="button" class="lg-boton principal" data-seguir>Siguiente</button>`);
      let avisado = false;
      const fotos = {};
      let yaEnSistema = { frente: false, dorso: false };
      const c = n => caja.querySelector(`[data-c="${n}"]`);
      const val = n => (c(n) ? c(n).value : '').replace(/[<>]/g, '').trim();
      const dniLimpio = () => val('dni').replace(/[.\s-]/g, '');
      conectarFoto(caja, 'frente', f => { fotos.frente = f; });
      conectarFoto(caja, 'dorso', f => { fotos.dorso = f; });
      if (o.pago) {
        conectarFoto(caja, 'comprobante', f => { fotos.comprobante = f; });
        conectarFoto(caja, 'cupon', f => { fotos.cupon = f; });
        const alCambiar = async () => {
          const m = val('metodo');
          caja.querySelector('[data-montoin]').hidden = !m || (o.pago.obligatorio && m !== 'efectivo_usd');
          caja.querySelector('[data-cuentain]').hidden = m !== 'transferencia';
          caja.querySelector('[data-cuponin]').hidden = m !== 'debito';
          if (m === 'transferencia') {
            const lista = (await cargarCuentas()).filter(x => x.tipo === 'transferencia_ars');
            c('cuenta').innerHTML = '<option value="">Elegí la cuenta…</option>' + lista.map(x => `<option value="${x.id}">${esc(x.etiqueta)} — ${esc(x.titular)}</option>`).join('');
          }
        };
        c('metodo').addEventListener('change', alCambiar); alCambiar();
      }
      const revisarDni = async () => {
        const dni = dniLimpio(), ya = caja.querySelector('[data-ya]');
        yaEnSistema = { frente: false, dorso: false }; ya.textContent = '';
        if (!/^\d{7,8}$/.test(dni)) return;
        try {
          const j = await (await fetch('/api/documentos/dni/' + dni, { credentials: 'same-origin' })).json();
          if (j.ok && dni === dniLimpio()) {
            yaEnSistema = { frente: j.frente, dorso: j.dorso };
            if (j.frente && j.dorso) ya.innerHTML = '✔ <b>Este DNI ya está cargado</b> (' + new Date(j.fecha).toLocaleDateString('es-AR') + '). No hace falta sacar las fotos; si cambió, sacalas de nuevo.';
          }
        } catch (e) { ya.textContent = 'Sin conexión: sacá las fotos igual, se suben solas.'; }
      };
      c('dni').addEventListener('change', revisarDni); c('dni').addEventListener('blur', revisarDni);
      if (o.dni) revisarDni();
      caja.querySelector('[data-cerrar]').addEventListener('click', () => { caja.cerrar(); resolver(null); });
      const boton = caja.querySelector('[data-seguir]');
      boton.addEventListener('click', async () => {
        const nombre = val('nombre').replace(/\s+/g, ' '), dni = dniLimpio();
        if (nombre.length < 3) return aviso('error', 'Completá el nombre y apellido del cliente');
        if (!/^\d{7,8}$/.test(dni)) return aviso('error', 'El DNI tiene que tener 7 u 8 números');
        const sinFotos = (!fotos.frente && !yaEnSistema.frente) || (!fotos.dorso && !yaEnSistema.dorso);
        if (sinFotos && !practica) return aviso('error', 'Faltan las fotos del DNI (frente y dorso)');
        const salida = { nombre, dni, aceptaOfertas: c('ofertas').checked, telefono: val('telefono').replace(/[\s().+-]/g, ''), email: val('email').toLowerCase(), vendedor: val('vendedor') };
        if (o.pedirContacto && !/^\d{10,13}$/.test(salida.telefono)) return aviso('error', 'Completá el teléfono con código de área, sin 0 ni 15');
        if (salida.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(salida.email)) return aviso('error', 'El email no es válido');
        if (o.pedirLocal) {
          salida.local = locales.length > 1 ? val('local') : (locales[0] && locales[0].nombre) || '';
          if (!salida.local) return aviso('error', 'Elegí el local donde se hace la venta');
        }
        if (o.pago) {
          const m = val('metodo');
          if (m) {
            const dolar = DATA.dolar.DolarVenta;
            const escrito = Number(val('monto').replace(/\./g, '').replace(',', '.')) || 0;
            const monto = (o.pago.obligatorio && m !== 'efectivo_usd') ? o.pago.monto : escrito;
            if (!(monto > 0)) return aviso('error', 'Completá el monto');
            const p = m === 'efectivo_usd' ? { metodo: 'efectivo', moneda: 'USD', monto, cotizacion: dolar } : { metodo: m, moneda: 'ARS', monto };
            if (m === 'transferencia') { if (!val('cuenta')) return aviso('error', 'Elegí la cuenta a la que entró la transferencia'); p.cuentaId = Number(val('cuenta')); }
            salida.pagos = [p];
            const adjunto = m === 'transferencia' ? fotos.comprobante : (m === 'debito' ? fotos.cupon : null);
            if (adjunto) {
              try { salida.comprobante = await prepararAdjunto(adjunto); } catch (e) { return aviso('error', e.message); }
            }
          } else salida.pagos = [];
        }
        const sinSenia = !!(o.pago && o.pago.obligatorio && !val('metodo'));
        if ((sinFotos || sinSenia) && !avisado) {
          avisado = true;
          const nota = caja.querySelector('[data-faltan]');
          nota.innerHTML = [sinFotos ? 'Faltan las <b>fotos del DNI</b>: van a quedar pendientes en “Documentos y papeles”.' : '', sinSenia ? 'La <b>seña no va a quedar registrada</b>: cuando completes la venta, cargala como un pago más.' : ''].filter(Boolean).join('<br>');
          nota.hidden = false;
          boton.textContent = 'Seguir igual';
          nota.scrollIntoView({ block: 'nearest' });
          return;
        }
        // La ventana de impresion se abre ACA, dentro del toque: Safari bloquea las que se abren despues.
        if (o.imprime && typeof prepararVentanaImpresion === 'function') prepararVentanaImpresion();
        boton.disabled = true;
        try {
          if (fotos.frente) await guardarFoto({ opid: o.opid, tipo: 'dni_frente', dni, archivo: fotos.frente });
          if (fotos.dorso) await guardarFoto({ opid: o.opid, tipo: 'dni_dorso', dni, archivo: fotos.dorso });
        } catch (e) { boton.disabled = false; if (typeof cerrarVentanaPreparada === 'function') cerrarVentanaPreparada(); return aviso('error', e.message); }
        caja.cerrar(); resolver(salida);
      });
    });
  }

  // ---------- reservas, planes y cuotas en la base ----------
  function registrarOperacion(ruta, cuerpo, comprobante) {
    return encolar({ id: nuevoId(), clase: 'operacion', ruta, cuerpo, comprobante: comprobante || null }).catch(e => aviso('warning', 'No se pudo registrar en la base: ' + e.message));
  }

  async function planesAbiertos(dni) {
    try {
      const j = await (await fetch('/api/planes?sucursal=' + encodeURIComponent(sucursalActual) + (dni ? '&dni=' + encodeURIComponent(dni) : ''), { credentials: 'same-origin' })).json();
      return j.ok ? j : { reservas: [], financiaciones: [] };
    } catch (e) { return { reservas: [], financiaciones: [] }; }
  }

  // ---------- documentos pendientes, reimpresion y cuotas ----------
  async function abrirPendientes() {
    const caja = abrirCaja('<div class="lg-fila" style="justify-content:space-between;"><h3>Documentos y papeles</h3><button type="button" class="lg-boton" data-cerrar>✕</button></div><div class="lg-fila"><button type="button" class="lg-boton" data-ver="faltan">Faltan documentos</button><button type="button" class="lg-boton" data-ver="todas">Todas (reimprimir)</button><button type="button" class="lg-boton" data-ver="planes">Reservas y planes</button></div><div data-lista></div>');
    caja.querySelector('[data-cerrar]').addEventListener('click', () => { caja.cerrar(); pintarContador(); });
    let vista = 'faltan';
    const lista = caja.querySelector('[data-lista]');
    async function pintar() {
      lista.innerHTML = '<p class="lg-suave">Cargando…</p>';
      const enEquipo = await pendientesEnEquipo();
      const cabecera = enEquipo ? `<p class="lg-suave">⏳ ${enEquipo} archivo(s) u operación(es) esperando subir desde este equipo. No borres los datos del navegador.</p>` : '';
      try {
        if (vista === 'planes') {
          const p = await planesAbiertos();
          lista.innerHTML = cabecera + ((p.reservas.length + p.financiaciones.length) ? '' : '<p class="lg-suave">No hay reservas ni planes abiertos.</p>') +
            p.reservas.map(r => `<div class="lg-item"><b>Reserva · ${esc(r.cliente)}</b><br>${esc(r.equipo)}<br><span class="lg-suave">Seña ${formatNumberArg(r.pagado_centavos / 100)} de ${formatNumberArg(r.total_centavos / 100)} · vence ${esc(r.vence_en)}</span></div>`).join('') +
            p.financiaciones.map(f => `<div class="lg-item"><b>Plan propio · ${esc(f.cliente)}</b><br>${esc(f.equipo)}<br><span class="lg-suave">Pagó USD ${(f.pagado_usd_centavos / 100).toFixed(2)} de USD ${(f.monto_total_usd_centavos / 100).toFixed(2)}</span><br><button type="button" class="lg-boton" data-cuota="${f.id}">Registrar cuota</button></div>`).join('');
          return;
        }
        const j = await (await fetch('/api/pendientes?sucursal=' + encodeURIComponent(sucursalActual) + (vista === 'todas' ? '&todas=1' : ''), { credentials: 'same-origin' })).json();
        if (!j.ok) throw new Error(j.error || 'No se pudo leer');
        lista.innerHTML = cabecera + (j.operaciones.length ? j.operaciones.map(op => `<div class="lg-item"><b>${esc(op.referencia)} · ${esc(op.cliente)}</b><br>${esc(op.producto || '')}<br><span class="lg-suave">${new Date(op.fecha).toLocaleString('es-AR')}</span>
          <div class="lg-fila" style="margin-top:6px;">${op.faltan.filter(t => t !== 'cupon_tarjeta').map(t => `<button type="button" class="lg-boton" data-subir="${t}" data-opid="${esc(op.opid)}">📷 ${esc(NOMBRE_DOC[t] || t)}</button>`).join('') + (op.cupones || []).map(c => c.puede ? `<button type="button" class="lg-boton" data-cupon="${c.pagoId}">📷 Cupón ${esc(textoCupon(c))}</button>` : `<span class="lg-suave">Falta el cupón ${esc(textoCupon(c))}: lo sube quien cargó la venta o administración.</span>`).join('') || '<span class="lg-suave">✔ Documentación completa</span>'}</div>
          <div class="lg-fila" style="margin-top:6px;">${op.papeles.map(p => `<a class="lg-boton" target="_blank" rel="noopener" href="/api/impresiones/${encodeURIComponent(op.opid)}/${p.tipo}">🖨️ Reimprimir ${esc(p.titulo)}</a>`).join('')}</div></div>`).join('') : '<p class="lg-suave">No hay nada pendiente. 🎉</p>') +
          '<p class="lg-suave">Para reimprimir: se abre el papel y desde ahí usás Compartir → Imprimir.</p>';
      } catch (e) { lista.innerHTML = cabecera + '<p class="lg-suave">No se pudo cargar: ' + esc(e.message) + '</p>'; }
    }
    caja.addEventListener('click', ev => {
      const v = ev.target.closest('[data-ver]'); if (v) { vista = v.getAttribute('data-ver'); return pintar(); }
      const s = ev.target.closest('[data-subir]'); if (s) return subirFaltante(s.getAttribute('data-opid'), s.getAttribute('data-subir'), pintar);
      const k = ev.target.closest('[data-cupon]'); if (k) return subirCupon(Number(k.getAttribute('data-cupon')), pintar);
      const q = ev.target.closest('[data-cuota]'); if (q) return cargarCuota(Number(q.getAttribute('data-cuota')), pintar);
    });
    pintar();
  }

  function subirFaltante(opid, tipo, alTerminar) {
    const esDni = tipo.startsWith('dni');
    const caja = abrirCaja(`<div class="lg-fila" style="justify-content:space-between;"><h3>${esc(NOMBRE_DOC[tipo] || tipo)}</h3><button type="button" class="lg-boton" data-cerrar>✕</button></div>
      ${esDni ? '<label>DNI (solo números)</label><input type="text" data-c="dni" inputmode="numeric" autocomplete="off">' : ''}
      ${campoFoto('doc', 'Foto', tipo === 'enacom' ? 'Consultá en <a href="https://imei.enacom.gob.ar/" target="_blank" rel="noopener">imei.enacom.gob.ar</a> y subí la captura.' : 'Que se vea toda la hoja, con la firma.')}
      <button type="button" class="lg-boton principal" data-guardar disabled>Guardar</button>`);
    let archivo = null;
    const boton = caja.querySelector('[data-guardar]');
    conectarFoto(caja, 'doc', f => { archivo = f; boton.disabled = false; });
    caja.querySelector('[data-cerrar]').addEventListener('click', () => caja.cerrar());
    boton.addEventListener('click', async () => {
      const dni = esDni ? caja.querySelector('[data-c=dni]').value.replace(/[.\s-]/g, '') : null;
      if (esDni && !/^\d{7,8}$/.test(dni)) return aviso('error', 'Escribí el número de DNI');
      boton.disabled = true;
      try { await guardarFoto({ opid, tipo, dni, archivo }); } catch (e) { boton.disabled = false; return aviso('error', e.message); }
      caja.cerrar(); aviso('success', 'Foto guardada');
      setTimeout(alTerminar, 1200);
    });
  }

  const textoCupon = c => (c.metodo === 'credito' ? 'crédito' : 'débito') + ' $' + formatNumberArg(c.monto_centavos / 100).replace(/^\$\s*/, '');

  // El cupon firmado se adjunta al pago con tarjeta (queda al lado del pago en el panel).
  function subirCupon(pagoId, alTerminar) {
    const caja = abrirCaja(`<div class="lg-fila" style="justify-content:space-between;"><h3>${esc(NOMBRE_DOC.cupon_tarjeta)}</h3><button type="button" class="lg-boton" data-cerrar>✕</button></div>
      ${campoFoto('doc', 'Foto', 'Que se lea el importe y se vea la firma.')}
      <button type="button" class="lg-boton principal" data-guardar disabled>Guardar</button>`);
    let archivo = null;
    const boton = caja.querySelector('[data-guardar]');
    conectarFoto(caja, 'doc', f => { archivo = f; boton.disabled = false; });
    caja.querySelector('[data-cerrar]').addEventListener('click', () => caja.cerrar());
    boton.addEventListener('click', async () => {
      boton.disabled = true;
      try { await encolar(Object.assign({ id: nuevoId(), clase: 'comprobante', pagoId }, await prepararAdjunto(archivo))); }
      catch (e) { boton.disabled = false; return aviso('error', e.message); }
      caja.cerrar(); aviso('success', 'Foto guardada');
      setTimeout(alTerminar, 1200);
    });
  }

  function cargarCuota(finId, alTerminar) {
    const caja = abrirCaja(`<div class="lg-fila" style="justify-content:space-between;"><h3>Registrar cuota</h3><button type="button" class="lg-boton" data-cerrar>✕</button></div>
      <p class="lg-suave">Esto la anota en la base. Si el plan también está en la planilla, registrá el pago desde Reservas/Financiación (se anota en los dos lados).</p>
      <label>Cómo pagó</label><select data-c="metodo"><option value="efectivo">Efectivo en pesos</option><option value="efectivo_usd">Efectivo en dólares</option><option value="debito">Débito</option><option value="qr">QR</option></select>
      <label>Monto (en la moneda elegida)</label><input type="text" data-c="monto" inputmode="decimal">
      <div data-cuponin hidden>${campoFoto('cupon', 'Foto del cupón firmado por el cliente')}</div>
      <button type="button" class="lg-boton principal" data-guardar>Guardar cuota</button>`);
    const opId = nuevoId();
    let cupon = null;
    conectarFoto(caja, 'cupon', f => { cupon = f; });
    const metodo = caja.querySelector('[data-c=metodo]');
    metodo.addEventListener('change', () => { caja.querySelector('[data-cuponin]').hidden = metodo.value !== 'debito'; });
    caja.querySelector('[data-cerrar]').addEventListener('click', () => caja.cerrar());
    caja.querySelector('[data-guardar]').addEventListener('click', async () => {
      const m = caja.querySelector('[data-c=metodo]').value;
      const monto = Number(caja.querySelector('[data-c=monto]').value.replace(/\./g, '').replace(',', '.')) || 0;
      if (!(monto > 0)) return aviso('error', 'Completá el monto');
      const pago = m === 'efectivo_usd' ? { metodo: 'efectivo', moneda: 'USD', monto, cotizacion: DATA.dolar.DolarVenta } : { metodo: m, moneda: 'ARS', monto };
      let adjunto = null;
      if (m === 'debito' && cupon) { try { adjunto = await prepararAdjunto(cupon); } catch (e) { return aviso('error', e.message); } }
      await registrarOperacion('/api/financiaciones/' + finId + '/pagos', { opId, cotizacionUsd: DATA.dolar.DolarVenta, pagos: [pago] }, adjunto);
      caja.cerrar(); setTimeout(alTerminar, 1200);
    });
  }

  // Si el pago de una cuota se cargo en la planilla, se anota tambien en el plan de la base.
  async function anotarCuotaDePlanilla(datos, montoArs) {
    if (!activo() || !datos) return;
    const p = await planesAbiertos();
    const igual = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    const candidatos = p.financiaciones.filter(f => igual(f.cliente, datos.cliente) && igual(f.equipo, datos.equipo));
    if (candidatos.length !== 1) return;   // planes viejos (solo planilla) o dudosos: no se adivina
    registrarOperacion('/api/financiaciones/' + candidatos[0].id + '/pagos', { opId: nuevoId(), cotizacionUsd: DATA.dolar.DolarVenta, pagos: [{ metodo: 'efectivo', moneda: 'ARS', monto: montoArs }] });
  }

  // ---------- delegado ----------
  async function abrirMiEquipo() {
    const caja = abrirCaja('<div class="lg-fila" style="justify-content:space-between;"><h3>Mi equipo</h3><button type="button" class="lg-boton" data-cerrar>✕</button></div><label>Mes</label><input type="month" data-c="mes"><div data-cuerpo></div>');
    caja.querySelector('[data-cerrar]').addEventListener('click', () => caja.cerrar());
    const mes = caja.querySelector('[data-c=mes]'), cuerpo = caja.querySelector('[data-cuerpo]');
    const barra = (hecho, meta) => `<div class="lg-barra"><i style="width:${meta ? Math.min(100, Math.round(hecho * 100 / meta)) : 0}%"></i></div>`;
    const metrica = (nombre, hecho, meta) => `<div class="lg-suave" style="margin:2px 0;">${nombre}: <b>${hecho}</b>${meta ? ' de ' + meta + (hecho >= meta ? ' ✔' : ' · faltan ' + (meta - hecho)) : ' (sin objetivo)'}</div>${barra(hecho, meta)}`;
    async function pintar() {
      cuerpo.innerHTML = '<p class="lg-suave">Cargando…</p>';
      try {
        const j = await (await fetch('/api/delegado/avance' + (mes.value ? '?mes=' + mes.value : ''), { credentials: 'same-origin' })).json();
        if (!j.ok) throw new Error(j.error);
        mes.value = j.mes;
        cuerpo.innerHTML = `<div class="lg-item"><b>${esc(j.local)}</b>${metrica('Equipos', j.total.equipos, j.objetivo.equipos)}${metrica('Accesorios', j.total.accesorios, j.objetivo.accesorios)}${metrica('Servicios técnicos', j.total.servicios, j.objetivo.servicios)}${j.premio ? '<p class="lg-suave">Premio: ' + esc(j.premio) + '</p>' : ''}</div>` +
          j.vendedores.map(v => `<div class="lg-item"><b>${esc(v.vendedor)}</b>${metrica('Equipos', v.equipos, v.objetivo.equipos)}${metrica('Accesorios', v.accesorios, v.objetivo.accesorios)}${metrica('Servicios', v.servicios, v.objetivo.servicios)}</div>`).join('') +
          `<p class="lg-suave">Cuenta lo registrado en el sistema nuevo${j.datosDesde ? ' desde el ' + esc(j.datosDesde) : ' (todavía no hay ventas de este local)'}.</p>`;
      } catch (e) { cuerpo.innerHTML = '<p class="lg-suave">' + esc(e.message || 'No se pudo cargar') + '</p>'; }
    }
    mes.addEventListener('change', pintar);
    pintar();
  }

  // ---------- accesos en la pantalla principal ----------
  async function pintarContador() {
    const b = document.querySelector('#lgBtnPendientes b');
    if (!b) return;
    const n = await pendientesEnEquipo();
    b.textContent = n ? '⏳' + n : '';
    b.hidden = !n;
  }

  function pintarAccesos() {
    const ref = $id('btnCVentas');
    if (!ref || !ref.parentElement) return;
    let cont = $id('lgAccesos');
    if (!cont) { cont = document.createElement('div'); cont.id = 'lgAccesos'; ref.parentElement.insertAdjacentElement('afterend', cont); }
    cont.innerHTML = (activo() ? '<button type="button" class="lg-boton" id="lgBtnPendientes">📎 Documentos y papeles <b hidden></b></button>' : '') +
      (config && config.delegadoDe ? '<button type="button" class="lg-boton" id="lgBtnEquipo">👥 Mi equipo</button>' : '') +
      (activo() ? '<button type="button" class="lg-boton" id="lgBtnCambiar">🔁 Cambiar de vendedor</button>' : '') +
      (enAprendizaje() ? '<p class="lg-aprendizaje">🎓 <b>Modo aprendizaje:</b> si te trabás con las fotos o los pagos, podés seguir. Lo que puedas, completalo después.</p>' : '');
    if ($id('lgBtnPendientes')) $id('lgBtnPendientes').addEventListener('click', abrirPendientes);
    if ($id('lgBtnEquipo')) $id('lgBtnEquipo').addEventListener('click', abrirMiEquipo);
    if ($id('lgBtnCambiar')) $id('lgBtnCambiar').addEventListener('click', () => cambiarDeVendedor('¿Cerrar tu sesión para que entre otra persona?'));
    pintarContador();
  }

  // Cierra la sesion sin tocar la cola de fotos del equipo.
  function cambiarDeVendedor(pregunta) {
    if (pregunta && !window.confirm(pregunta)) return;
    if (typeof cerrarSesion === 'function') cerrarSesion();
    setTimeout(() => location.reload(), 150);
  }

  // iPad compartido: sin uso, la sesion se cierra sola (antes las de administracion).
  let ultimoUso = Date.now();
  ['pointerdown', 'keydown', 'touchstart'].forEach(e => document.addEventListener(e, () => { ultimoUso = Date.now(); }, { passive: true }));
  function revisarInactividad() {
    const sesion = typeof sesionGuardada === 'function' ? sesionGuardada() : null;
    if (!sesion || !activo() || !matchMedia('(pointer: coarse)').matches) return;
    const minutos = sesion.rol === 'vendedor' ? 15 : 5;
    const ocupado = document.querySelector('.lg-modal') || (typeof carrito !== 'undefined' && carrito.length) || (typeof flujoVentaActivo !== 'undefined' && flujoVentaActivo);
    // Con una venta a medio cargar se espera el doble antes de cerrar.
    if (Date.now() - ultimoUso > minutos * 60000 * (ocupado ? 2 : 1)) cambiarDeVendedor(null);
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { cargarConfig().then(sincronizar); }, 300);
    window.addEventListener('online', sincronizar);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizar(); });
    setInterval(sincronizar, 45 * 1000);
    setInterval(revisarInactividad, 30 * 1000);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  });

  return { cargarConfig, activo, enAprendizaje, pedirDatos, guardarFoto, guardarImpresion, retenerComprobantes, asignarPagos, sincronizar, pendientesEnEquipo, registrarOperacion, planesAbiertos, anotarCuotaDePlanilla, abrirPendientes, abrirMiEquipo, campoFoto, conectarFoto, comprimir, nuevoId, pintarAccesos, NOMBRE_DOC };
})();
