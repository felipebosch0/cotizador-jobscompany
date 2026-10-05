// ============================================================
// COMPARADOR DE MODELOS (solo lectura)
//
// Pantalla completa para que los vendedores comparen hasta 3 modelos lado a
// lado: foto por color, resumen, secciones desplegables, "solo diferencias"
// y -- si el modelo esta en el cotizador -- su precio en la sucursal actual
// con un boton "Cotizar este". Los datos (comparador-data.js) salen de las
// fichas tecnicas oficiales de Apple y cada modelo trae el link a su fuente.
// ============================================================
(function () {
  const MAX_COLUMNAS = 3;
  const ABIERTAS_POR_DEFECTO = ['Resumen', 'Pantalla', 'Chip', 'Cámara', 'Energía y batería'];

  const CATEGORIAS = {
    iphone: { etiqueta: 'iPhone', titulo: 'Compará iPhone', subtitulo: 'Elegí hasta tres modelos y mirá en qué se diferencian.', pref: ['iphone-17-pro-max', 'iphone-17-pro'] },
    ipad: { etiqueta: 'iPad', titulo: 'Compará iPad', subtitulo: 'Elegí hasta tres modelos y mirá en qué se diferencian.', pref: ['ipad-pro-13-m5', 'ipad-air-13-m4'],
      resumen: [['Pantalla', 'Pantalla'], ['Chip', 'Chip'], ['Capacidad', 'Capacidad', null, true], ['Cámara', 'Cámara'], ['Conector', 'Conector'], ['Autenticación', 'Autenticación segura'], ['Apple Pencil', 'Apple Pencil']] },
    mac: { etiqueta: 'Mac', titulo: 'Compará Mac', subtitulo: 'Elegí hasta tres modelos y mirá en qué se diferencian.', pref: ['macbook-air-13-m5', 'macbook-pro-14-m5'],
      resumen: [['Chip', 'Lo más destacado', /^Chip/], ['Pantalla', 'Pantalla'], ['Memoria', 'Memoria'], ['Almacenamiento', 'Almacenamiento'], ['Puertos', 'Puertos'], ['Batería', 'Energía y batería'], ['Peso', 'Tamaño y peso', /\bkg\b/]] },
    watch: { etiqueta: 'Apple Watch', titulo: 'Compará Apple Watch', subtitulo: 'Elegí hasta tres modelos y mirá en qué se diferencian.', pref: ['apple-watch-series-11', 'apple-watch-ultra-3'],
      resumen: [['Pantalla', 'Pantalla'], ['Chip', 'Chip'], ['Caja', 'Caja'], ['Batería', 'Energía y batería', /^Hasta/], ['Conectividad', 'Conectividad'], ['Durabilidad', 'Durabilidad']] },
    airpods: { etiqueta: 'AirPods', titulo: 'Compará AirPods', subtitulo: 'Elegí hasta tres modelos y mirá en qué se diferencian.', pref: ['airpods-pro-3', 'airpods-4'],
      resumen: [['Chip', 'Chip'], ['Audio', 'Tecnología de audio'], ['Batería (auriculares)', 'Batería', /^Hasta/], ['Resistencia', 'Resistencia al polvo, al agua y al sudor'], ['Conectividad', 'Conectividad'], ['Peso', 'Tamaño y peso', /Peso/]] }
  };

  const estado = { categoria: 'iphone', seleccion: [], color: {}, soloDif: false, abiertas: new Set(ABIERTAS_POR_DEFECTO) };
  let raiz = null;
  let observador = null;

  const DATOS = () => (window.COMPARADOR_DATA || {});
  const modelos = () => DATOS()[estado.categoria] || [];
  const porId = id => modelos().find(m => m.id === id);
  const norm = s => String(s).toLowerCase().replace(/[\s.,:;() ]+/g, ' ').trim();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const usd = n => 'USD ' + Math.round(n).toLocaleString('es-AR');

  const ICON_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

  // ---------------------------------------------------------- datos derivados
  function seccionDe(m, titulo) {
    const s = m.secciones.find(x => x.titulo === titulo);
    return s ? s.items : [];
  }

  // Filas del "Resumen": lo que mas se pregunta en el mostrador.
  function resumenGenerico(m, spec) {
    const corto = t => { const x = t.replace(/\s+/g, ' ').trim(); return x.length > 110 ? x.slice(0, 107).replace(/\s+\S*$/, '') + '…' : x; };
    const filas = spec.map(([etq, sec, re, unir]) => {
      let items = seccionDe(m, sec);
      if (re) items = items.filter(x => re.test(x));
      return [etq, items.length ? corto(unir ? items.join(' · ') : items[0]) : '—'];
    });
    if (m.colores && m.colores.length) filas.push(['Colores', m.colores.map(c => c.nombre).join(', ')]);
    return filas;
  }

  function resumenDe(m) {
    const spec = CATEGORIAS[estado.categoria].resumen;
    if (spec) return resumenGenerico(m, spec);
    const filas = [];
    const pulgadas = [];
    seccionDe(m, 'Pantalla').forEach(x => { const r = x.match(/([\d.]+)\s*pulgadas/); if (r) pulgadas.push(r[1] + '″'); });
    const pant = seccionDe(m, 'Pantalla');
    const extras = [];
    if (pant.some(x => /ProMotion/i.test(x))) extras.push('ProMotion 120 Hz');
    if (pant.some(x => /siempre activa/i.test(x))) extras.push('Siempre activa');
    filas.push(['Pantalla', [pulgadas.join(' + '), ...extras].filter(Boolean).join(' · ') || '—']);

    const chip = seccionDe(m, 'Chip').map(x => x.match(/[Cc]hip\s+(A\d+\s*(?:Pro|Bionic)?)/)).find(Boolean);
    filas.push(['Chip', chip ? chip[1].trim() : '—']);

    // Preferimos la linea "Sistema de camara ..."; si no hay, la principal
    // cortada antes de los detalles (apertura, estabilizacion, etc).
    const camItems = seccionDe(m, 'Cámara');
    const cam = camItems.find(x => /^Sistema de cámara/i.test(x) && /\d+\s*MP/.test(x)) || camItems.find(x => /\d+\s*MP/.test(x));
    filas.push(['Cámara', cam ? cam.split(/[:,]/)[0].trim() : '—']);

    const bat = seccionDe(m, 'Energía y batería').filter(x => /^Reproducción de video:/i.test(x) && !/streaming/i.test(x));
    filas.push(['Batería (video)', bat.length ? bat.map(x => x.replace(/^Reproducción de video:\s*/i, '').replace(/^[Hh]asta/, 'Hasta')).join(' / ') : '—']);

    const peso = seccionDe(m, 'Tamaño y peso').find(x => /^peso/i.test(x));
    filas.push(['Peso', peso ? peso.replace(/^peso:?\s*/i, '') : '—']);

    const cap = seccionDe(m, 'Capacidad');
    filas.push(['Capacidades', cap.length ? cap.join(' · ') : '—']);

    const conector = seccionDe(m, 'Carga y expansión').concat(seccionDe(m, 'Botones y conectores externos')).find(x => /USB-C|Lightning/i.test(x));
    if (conector) filas.push(['Conector', /USB-C/i.test(conector) ? 'USB-C' : 'Lightning']);

    if (m.colores && m.colores.length) filas.push(['Colores', m.colores.map(c => c.nombre).join(', ')]);
    return filas;
  }

  // Precio en la sucursal actual (si el modelo esta cargado en el cotizador).
  function precioCotizador(m) {
    if (typeof DATA === 'undefined' || typeof sucursalActual === 'undefined') return null;
    const lista = (DATA.equiposPorSucursal || {})[sucursalActual] || [];
    const eq = lista.find(e => e.modelo.toLowerCase() === m.nombre.toLowerCase());
    if (!eq) return { modelo: null };
    let sellado = null, semi = null;
    Object.values(eq.capacidades).forEach(c => {
      if (c.sellado != null) sellado = sellado == null ? c.sellado : Math.min(sellado, c.sellado);
      const semis = [];
      if (c.seminuevo != null) semis.push(c.seminuevo);
      (c.seminuevoTiers || []).forEach(t => semis.push(t.precio));
      semis.forEach(v => { semi = semi == null ? v : Math.min(semi, v); });
    });
    return { modelo: eq.modelo, sellado, semi };
  }

  // ------------------------------------------------------------------ vista
  function construir() {
    raiz = document.createElement('div');
    raiz.id = 'comparador';
    raiz.className = 'oculto';
    raiz.setAttribute('role', 'dialog');
    raiz.setAttribute('aria-modal', 'true');
    raiz.setAttribute('aria-label', 'Comparar modelos');
    raiz.innerHTML = `
      <header class="cmp-top"><div class="cmp-top-in">
        <button type="button" class="cmp-close" data-cmp="cerrar">${ICON_BACK}Volver</button>
        <div class="cmp-title">Comparar</div>
        <div class="cmp-tabs" role="tablist" data-cmp-tabs></div>
      </div></header>
      <div class="cmp-wrap">
        <div class="cmp-head"><h1 data-cmp-h1></h1><p data-cmp-sub></p></div>
        <div class="cmp-scroller" data-cmp-scroller><div class="cmp-cols" data-cmp-cols></div></div>
        <div class="cmp-controls"><div class="cmp-seg" role="group" aria-label="Qué mostrar">
          <button type="button" data-cmp="todo" aria-pressed="true">Todo</button>
          <button type="button" data-cmp="dif" aria-pressed="false">Solo diferencias</button>
        </div></div>
        <div class="cmp-mini" data-cmp-mini><div class="cmp-mini-in" data-cmp-mini-in></div></div>
        <div data-cmp-secciones></div>
        <p class="cmp-source" data-cmp-fuente></p>
      </div>`;
    document.body.appendChild(raiz);

    raiz.addEventListener('click', onClick);
    raiz.addEventListener('change', onChange);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !raiz.classList.contains('oculto')) cerrar(); });
  }

  function el(sel) { return raiz.querySelector(sel); }

  function renderTabs() {
    const cont = el('[data-cmp-tabs]');
    const cats = Object.keys(CATEGORIAS).filter(k => (DATOS()[k] || []).length);
    cont.style.display = cats.length > 1 ? '' : 'none';
    cont.innerHTML = cats.map(k => `<button type="button" class="cmp-tab" role="tab" data-cmp-cat="${k}" aria-selected="${k === estado.categoria}">${CATEGORIAS[k].etiqueta}</button>`).join('');
  }

  function opcionesModelo(excluidos, seleccionado) {
    const opt = m => `<option value="${m.id}" ${m.id === seleccionado ? 'selected' : ''} ${excluidos.includes(m.id) && m.id !== seleccionado ? 'disabled' : ''}>${esc(m.nombre)}</option>`;
    if (estado.categoria !== 'iphone') return modelos().map(opt).join('');
    const grupos = {};
    modelos().forEach(m => {
      const anio = m.anio || (/\b12\b/.test(m.nombre) ? 2020 : 2019);
      (grupos[anio] = grupos[anio] || []).push(m);
    });
    return Object.keys(grupos).sort((a, b) => b - a).map(anio =>
      `<optgroup label="${anio}">` + grupos[anio].map(m =>
        `<option value="${m.id}" ${m.id === seleccionado ? 'selected' : ''} ${excluidos.includes(m.id) && m.id !== seleccionado ? 'disabled' : ''}>${esc(m.nombre)}</option>`).join('') + '</optgroup>').join('');
  }

  function colorActual(m) {
    const cols = m.colores || [];
    if (!cols.length) return null;
    return cols.find(c => c.id === estado.color[m.id]) || cols[0];
  }

  function fotoSrc(m) {
    const c = colorActual(m);
    return c ? `${m.imagen}${c.id}.${c.ext || 'jpg'}` : '';
  }

  function renderColumnas() {
    const cont = el('[data-cmp-cols]');
    const n = Math.max(estado.seleccion.length + (estado.seleccion.length < MAX_COLUMNAS ? 1 : 0), 1);
    cont.style.setProperty('--n', n);
    let html = estado.seleccion.map(id => {
      const m = porId(id); if (!m) return '';
      const c = colorActual(m);
      const p = precioCotizador(m);
      let precio = '';
      if (p && p.modelo) {
        const l = [];
        if (p.sellado != null) l.push(`Sellado desde <strong>${usd(p.sellado)}</strong>`);
        if (p.semi != null) l.push(`Semi nuevo desde <strong>${usd(p.semi)}</strong>`);
        precio = `<div class="cmp-price">${l.join('<br>')}</div><button type="button" class="cmp-cta" data-cmp-cotizar="${m.id}">Cotizar este</button>`;
      } else {
        precio = `<div class="cmp-price"><span class="cmp-nostock">No está cargado en esta sucursal</span></div>`;
      }
      return `<div class="cmp-col" data-cmp-col="${m.id}">
        ${estado.seleccion.length > 1 ? `<button type="button" class="cmp-remove" data-cmp-quitar="${m.id}" aria-label="Quitar ${esc(m.nombre)}">×</button>` : ''}
        <div class="cmp-photo">${c ? `<img src="${fotoSrc(m)}" alt="${esc(m.nombre)} ${esc(c.nombre)}" decoding="async">` : ''}</div>
        <div class="cmp-sw">${(m.colores || []).map(k => `<button type="button" class="cmp-dot" style="background:${k.hex}" data-cmp-color="${m.id}|${k.id}" aria-pressed="${c && k.id === c.id}" aria-label="${esc(k.nombre)}" title="${esc(k.nombre)}"></button>`).join('')}</div>
        <div class="cmp-colname" data-cmp-colname="${m.id}">${c ? esc(c.nombre) : ''}</div>
        <div class="cmp-selwrap"><select class="cmp-sel" data-cmp-modelo="${m.id}" aria-label="Modelo">${opcionesModelo(estado.seleccion, m.id)}</select></div>
        ${m.preliminar ? '<div><span class="cmp-badge">Información de lanzamiento</span></div>' : ''}
        ${precio}
      </div>`;
    }).join('');
    if (estado.seleccion.length < MAX_COLUMNAS) {
      html += `<div class="cmp-col"><div class="cmp-add"><div class="cmp-plus">+</div>
        <div class="cmp-selwrap"><select class="cmp-sel" data-cmp-agregar aria-label="Agregar modelo"><option value="">Agregar modelo</option>${opcionesModelo(estado.seleccion, '')}</select></div></div></div>`;
    }
    cont.innerHTML = html;

    // Barra compacta (aparece al bajar)
    const mini = el('[data-cmp-mini-in]');
    mini.style.setProperty('--n', estado.seleccion.length);
    mini.innerHTML = estado.seleccion.map(id => {
      const m = porId(id); const c = colorActual(m);
      return `<div class="cmp-mini-item">${c ? `<img src="${fotoSrc(m)}" alt="">` : ''}<span>${esc(m.nombre)}</span></div>`;
    }).join('');
  }

  // Texto de una celda: items del modelo en esa seccion (segun el modo).
  function renderSecciones() {
    const sel = estado.seleccion.map(porId).filter(Boolean);
    const cont = el('[data-cmp-secciones]');
    const n = sel.length;
    const comparar = n > 1;
    const bloques = [];

    // 1) Resumen (filas con etiqueta; se resalta lo que cambia)
    const resumenes = sel.map(resumenDe);
    const etiquetas = [];
    resumenes.forEach(r => r.forEach(([k]) => { if (!etiquetas.includes(k)) etiquetas.push(k); }));
    const valorDe = (i, k) => { const f = resumenes[i].find(x => x[0] === k); return f ? f[1] : '—'; };
    const filasRes = etiquetas.map(k => {
      const vals = sel.map((_, i) => valorDe(i, k));
      const difiere = comparar && new Set(vals.map(norm)).size > 1;
      return { k, vals, difiere };
    }).filter(f => !(estado.soloDif && comparar && !f.difiere));
    if (filasRes.length) {
      const celdas = sel.map((_, i) => `<div class="cmp-cell">${filasRes.map(f => `<div style="padding:9px 0;border-top:1px solid var(--cmp-line)"><span class="cmp-rowlabel">${esc(f.k)}</span><span class="cmp-val ${f.difiere ? 'dif' : ''}">${esc(f.vals[i])}</span></div>`).join('')}</div>`).join('');
      bloques.push(seccionHtml('Resumen', celdas, n));
    }

    // 2) Secciones completas
    const titulos = [];
    sel.forEach(m => m.secciones.forEach(s => { if (!titulos.includes(s.titulo)) titulos.push(s.titulo); }));
    const ORDEN = estado.categoria !== 'iphone' ? null : ['Acabado', 'Capacidad', 'Tamaño y peso', 'Pantalla', 'Resistencia a las salpicaduras, al agua y al polvo', 'Chip', 'Apple Intelligence', 'Cámara', 'Cámara frontal', 'Grabación de video', 'Energía y batería', 'MagSafe y carga inalámbrica', 'Carga y expansión', 'Conexión celular e inalámbrica', 'Botones y conectores externos', 'Face ID', 'Touch ID', 'Sensores', 'Tarjeta SIM', 'Seguridad y emergencias', 'En la caja'];
    if (ORDEN) titulos.sort((a, b) => ORDEN.indexOf(a) - ORDEN.indexOf(b));
    titulos.forEach(t => {
      const listas = sel.map(m => seccionDe(m, t));
      const conjuntos = listas.map(l => new Set(l.map(norm)));
      const comun = x => comparar && conjuntos.every(s => s.has(norm(x)));
      let hayContenido = false;
      const celdas = listas.map(items => {
        const visibles = items.filter(x => !(estado.soloDif && comun(x)));
        if (visibles.length) hayContenido = true;
        const lis = visibles.length
          ? visibles.map(x => `<li class="${comparar && !comun(x) ? 'dif' : ''}">${esc(x)}</li>`).join('')
          : `<li class="na">${items.length ? 'Igual que el resto' : 'No incluye'}</li>`;
        return `<div class="cmp-cell"><ul>${lis}</ul></div>`;
      }).join('');
      if (estado.soloDif && comparar && !hayContenido) return;
      bloques.push(seccionHtml(t, celdas, n));
    });

    cont.innerHTML = bloques.length ? bloques.join('') : '<div class="cmp-empty">Estos modelos no tienen diferencias en las secciones cargadas.</div>';

    const fuentes = sel.map(m => `<a href="${m.fuente}" target="_blank" rel="noopener">${esc(m.nombre)}</a>`).join(' · ');
    el('[data-cmp-fuente]').innerHTML = `Información de las fichas técnicas oficiales de Apple: ${fuentes}.<br>Los datos son de referencia para uso interno; ante cualquier duda, verificar en la ficha oficial.`;
  }

  function seccionHtml(titulo, celdas, n) {
    const abierta = estado.abiertas.has(titulo);
    return `<section class="cmp-sec ${abierta ? 'open' : ''}" data-cmp-sec="${esc(titulo)}">
      <button type="button" class="cmp-sec-btn" data-cmp-toggle="${esc(titulo)}" aria-expanded="${abierta}"><span>${esc(titulo)}</span>${ICON_CHEVRON}</button>
      <div class="cmp-sec-body"><div><div class="cmp-grid" style="--n:${n}">${celdas}</div></div></div></section>`;
  }

  function render() {
    const cat = CATEGORIAS[estado.categoria];
    el('[data-cmp-h1]').textContent = cat.titulo;
    el('[data-cmp-sub]').textContent = cat.subtitulo;
    renderTabs();
    renderColumnas();
    renderSecciones();
    raiz.querySelectorAll('[data-cmp="todo"],[data-cmp="dif"]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.cmp === 'dif') === estado.soloDif)));
    observarHero();
  }

  function observarHero() {
    if (observador) observador.disconnect();
    if (!('IntersectionObserver' in window)) return;
    const mini = el('[data-cmp-mini]');
    observador = new IntersectionObserver(([e]) => mini.classList.toggle('on', !e.isIntersecting && e.boundingClientRect.top < 0), { root: raiz, threshold: 0, rootMargin: '-60px 0px 0px 0px' });
    observador.observe(el('[data-cmp-scroller]'));
  }

  // ----------------------------------------------------------------- eventos
  function onClick(e) {
    const t = e.target.closest('[data-cmp],[data-cmp-cat],[data-cmp-quitar],[data-cmp-color],[data-cmp-toggle],[data-cmp-cotizar]');
    if (!t) return;
    if (t.dataset.cmp === 'cerrar') return cerrar();
    if (t.dataset.cmp === 'todo' || t.dataset.cmp === 'dif') { estado.soloDif = t.dataset.cmp === 'dif'; return renderSecciones(), raiz.querySelectorAll('[data-cmp="todo"],[data-cmp="dif"]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.cmp === 'dif') === estado.soloDif))); }
    if (t.dataset.cmpCat) { estado.categoria = t.dataset.cmpCat; estado.seleccion = seleccionInicial(); return render(); }
    if (t.dataset.cmpQuitar) { estado.seleccion = estado.seleccion.filter(id => id !== t.dataset.cmpQuitar); return render(); }
    if (t.dataset.cmpColor) {
      const [id, color] = t.dataset.cmpColor.split('|');
      estado.color[id] = color;
      const m = porId(id), c = colorActual(m), col = raiz.querySelector(`[data-cmp-col="${id}"]`);
      col.querySelector('.cmp-photo').innerHTML = `<img src="${fotoSrc(m)}" alt="${esc(m.nombre)} ${esc(c.nombre)}" decoding="async">`;
      col.querySelector(`[data-cmp-colname="${id}"]`).textContent = c.nombre;
      col.querySelectorAll('.cmp-dot').forEach(d => d.setAttribute('aria-pressed', String(d.dataset.cmpColor === t.dataset.cmpColor)));
      const idx = estado.seleccion.indexOf(id);
      const mini = raiz.querySelectorAll('.cmp-mini-item img')[idx]; if (mini) mini.src = fotoSrc(m);
      return;
    }
    if (t.dataset.cmpToggle) {
      const titulo = t.dataset.cmpToggle, sec = t.closest('.cmp-sec');
      const abre = !sec.classList.contains('open');
      sec.classList.toggle('open', abre);
      t.setAttribute('aria-expanded', String(abre));
      abre ? estado.abiertas.add(titulo) : estado.abiertas.delete(titulo);
      return;
    }
    if (t.dataset.cmpCotizar) return cotizar(t.dataset.cmpCotizar);
  }

  function onChange(e) {
    const s = e.target;
    if (s.dataset.cmpModelo !== undefined) {
      const i = estado.seleccion.indexOf(s.dataset.cmpModelo);
      if (i >= 0 && s.value) estado.seleccion[i] = s.value;
      render();
    } else if (s.dataset.cmpAgregar !== undefined && s.value) {
      estado.seleccion.push(s.value);
      render();
    }
  }

  function cotizar(id) {
    const m = porId(id); const p = m && precioCotizador(m);
    if (!p || !p.modelo) return;
    cerrar();
    if (typeof Venta === 'function') Venta();
    if (window.jQuery) {
      window.jQuery('#formVenta select[name="tipoVenta"]').val('venta equipo').change();
      window.jQuery('#formVenta select[name="modeloV"]').val(p.modelo).change();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function seleccionInicial() {
    const pref = CATEGORIAS[estado.categoria].pref || [];
    const ok = pref.filter(id => porId(id));
    return ok.length ? ok : modelos().slice(0, 2).map(m => m.id);
  }

  // ------------------------------------------------------------- publico
  function abrir() {
    if (!raiz) construir();
    if (!estado.seleccion.length) estado.seleccion = seleccionInicial();
    document.documentElement.style.overflow = 'hidden';
    raiz.classList.remove('oculto');
    render();
    raiz.scrollTop = 0;
    const cerrarBtn = raiz.querySelector('.cmp-close'); if (cerrarBtn) cerrarBtn.focus({ preventScroll: true });
  }

  function cerrar() {
    if (!raiz) return;
    raiz.classList.add('oculto');
    document.documentElement.style.overflow = '';
  }

  window.abrirComparador = abrir;
})();
