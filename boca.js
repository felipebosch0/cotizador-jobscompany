// ============================================================
// Modo Boca: boton de la pelota en la barra de arriba. Activa los colores
// azul y oro (boca.css) y suelta una lluvia de pelotas y papelitos con un
// cartel. Si el modo ya estaba activo, tocar el boton lo apaga. El estado
// se guarda en este equipo (localStorage). Todo esto es solo decoracion.
// ============================================================
(function () {
  const CLAVE = 'modoBoca';

  function leer() { try { return localStorage.getItem(CLAVE) === '1'; } catch (e) { return false; } }
  function guardar(v) { try { localStorage.setItem(CLAVE, v ? '1' : '0'); } catch (e) { /* sin almacenamiento */ } }

  function aplicar(activo) {
    document.body.classList.toggle('boca', activo);
    const boton = document.getElementById('toggleBoca');
    if (boton) {
      boton.title = activo ? 'Apagar modo Boca' : 'Modo Boca';
      boton.setAttribute('aria-pressed', String(activo));
    }
  }

  function festejar() {
    const viejo = document.getElementById('bocaFiesta');
    if (viejo) viejo.remove();
    const capa = document.createElement('div');
    capa.id = 'bocaFiesta';
    capa.setAttribute('aria-hidden', 'true');

    const emojis = ['⚽', '\u{1F499}', '\u{1F49B}', '\u{1F3C6}'];
    const colores = ['#0b3d91', '#ffc400', '#ffffff'];
    const azar = (min, max) => min + Math.random() * (max - min);
    for (let i = 0; i < 90; i++) {
      const pieza = document.createElement('span');
      pieza.className = 'boca-pieza';
      if (i % 3 === 0) {
        pieza.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        pieza.style.fontSize = azar(20, 38) + 'px';
      } else {
        pieza.classList.add('papel');
        pieza.style.background = colores[Math.floor(Math.random() * colores.length)];
        pieza.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.12)';
      }
      pieza.style.left = azar(0, 100) + 'vw';
      pieza.style.animationDuration = azar(2.4, 4.4) + 's';
      pieza.style.animationDelay = azar(0, 1.4) + 's';
      pieza.style.setProperty('--deriva', azar(-120, 120) + 'px');
      pieza.style.setProperty('--giro', azar(-900, 900) + 'deg');
      capa.appendChild(pieza);
    }

    const cartel = document.createElement('div');
    cartel.className = 'boca-cartel';
    cartel.innerHTML = '¡VAMOS BOCA!<small>\u{1F499}\u{1F49B} JOBS COMPANY \u{1F49B}\u{1F499}</small>';
    capa.appendChild(cartel);

    document.body.appendChild(capa);
    setTimeout(() => capa.remove(), 6200);
  }

  function iniciar() {
    aplicar(leer());
    const boton = document.getElementById('toggleBoca');
    if (!boton) return;
    boton.addEventListener('click', () => {
      const activar = !document.body.classList.contains('boca');
      aplicar(activar);
      guardar(activar);
      if (activar) festejar();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
