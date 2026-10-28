// ============================================================
// CAMBIO DE CLAVE.
//
// - Obligatorio la primera vez (el servidor marca debeCambiarClave en la
//   sesion cuando FORZAR_CAMBIO_CLAVE=1): el modal no se puede cerrar.
// - Voluntario despues, con la llave de la barra de arriba.
// - El admin tambien ve "Restablecer clave de un usuario" (borra la clave que
//   cambio, asi vuelve a la inicial).
// Todo el HTML se arma aca para no tocar index.html mas que con el <script>.
// ============================================================

function ccCrearModal() {
  if (document.getElementById('modalCambiarClave')) return document.getElementById('modalCambiarClave');
  const modal = document.createElement('div');
  modal.id = 'modalCambiarClave';
  modal.className = 'modal';
  modal.style.zIndex = '100000';
  modal.innerHTML =
    '<div class="modal-content" style="max-width:420px;">' +
      '<span class="close" id="ccCerrar">&times;</span>' +
      '<h3 id="ccTitulo">Cambiar contrasena</h3>' +
      '<p class="sm-t" id="ccAviso"></p>' +
      '<form id="ccForm" autocomplete="off">' +
        '<div class="form-group-total sp-t"><label>Clave actual</label><input type="password" id="ccActual" autocomplete="current-password"></div>' +
        '<div class="form-group-total sp-t"><label>Clave nueva</label><input type="password" id="ccNueva" autocomplete="new-password"></div>' +
        '<div class="form-group-total sp-t"><label>Repetir clave nueva</label><input type="password" id="ccRepetir" autocomplete="new-password"></div>' +
        '<p class="sm-t">Minimo 8 caracteres, con letras y numeros.</p>' +
        '<p id="ccError" class="oculto" style="color:#d93025;"></p>' +
        '<button type="submit" class="btn-total" id="ccGuardar">Guardar clave</button>' +
      '</form>' +
      '<div id="ccAdmin" class="oculto" style="margin-top:18px; border-top:1px solid var(--ap-line); padding-top:12px;">' +
        '<a href="#" id="ccReset" class="sm-t">Restablecer la clave de un usuario (admin)</a>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  document.getElementById('ccCerrar').addEventListener('click', () => ccCerrarModal());
  document.getElementById('ccForm').addEventListener('submit', ccGuardar);
  document.getElementById('ccReset').addEventListener('click', ccResetear);
  return modal;
}

function ccCerrarModal() {
  const m = document.getElementById('modalCambiarClave');
  if (m && m.dataset.forzado !== '1') m.style.display = 'none';
}

function ccMostrarError(texto) {
  const e = document.getElementById('ccError');
  e.textContent = texto;
  e.classList.toggle('oculto', !texto);
}

function abrirCambioClave(forzado) {
  const sesion = sesionGuardada();
  const modal = ccCrearModal();
  modal.dataset.forzado = forzado ? '1' : '0';
  document.getElementById('ccCerrar').style.display = forzado ? 'none' : '';
  document.getElementById('ccTitulo').textContent = forzado ? 'Elegi tu nueva contrasena' : 'Cambiar contrasena';
  document.getElementById('ccAviso').textContent = forzado
    ? 'Por seguridad tenes que cambiar la clave antes de seguir. La clave actual es la que usaste para entrar.'
    : '';
  document.getElementById('ccAdmin').classList.toggle('oculto', !(sesion && sesion.rol === 'admin'));
  ['ccActual', 'ccNueva', 'ccRepetir'].forEach(id => { document.getElementById(id).value = ''; });
  ccMostrarError('');
  modal.style.display = 'block';
  document.getElementById('ccActual').focus();
}

async function ccGuardar(e) {
  e.preventDefault();
  const actual = document.getElementById('ccActual').value;
  const nueva = document.getElementById('ccNueva').value;
  const repetir = document.getElementById('ccRepetir').value;
  if (!actual || !nueva) return ccMostrarError('Completa todos los campos');
  if (nueva !== repetir) return ccMostrarError('Las claves nuevas no coinciden');

  const boton = document.getElementById('ccGuardar');
  boton.disabled = true;
  try {
    const resp = await fetch('/api/cambiar-clave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actual, nueva })
    });
    const json = await resp.json();
    if (!json.ok) { ccMostrarError(json.error || 'No se pudo cambiar la clave'); return; }

    // La sesion guardada ya no tiene el cambio pendiente.
    const sesion = sesionGuardada();
    if (sesion) { sesion.debeCambiarClave = false; localStorage.setItem(SESION_STORAGE_KEY, JSON.stringify(sesion)); }
    document.getElementById('modalCambiarClave').dataset.forzado = '0';
    document.getElementById('modalCambiarClave').style.display = 'none';
    MostrarAlerta({ tipo: 'success', title: 'Contrasena', mnsj: 'Listo, tu clave se cambio.' });
  } catch (error) {
    ccMostrarError('No se pudo conectar. Proba de nuevo.');
  } finally {
    boton.disabled = false;
  }
}

async function ccResetear(e) {
  e.preventDefault();
  const usuario = (window.prompt('Usuario al que se le restablece la clave (ej: ro):') || '').trim();
  if (!usuario) return;
  try {
    const resp = await fetch('/api/admin/resetear-clave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario })
    });
    const json = await resp.json();
    if (json.ok) MostrarAlerta({ tipo: 'success', title: 'Contrasena', mnsj: usuario + ' vuelve a su clave inicial (y tendra que cambiarla al entrar).' });
    else ccMostrarError(json.error || 'No se pudo restablecer');
  } catch (error) {
    ccMostrarError('No se pudo conectar. Proba de nuevo.');
  }
}

// La llama la app al mostrarse (login nuevo o sesion guardada).
function revisarCambioClave(sesion) {
  if (!sesion || sesion.origen !== 'servidor') return;
  if (sesion.debeCambiarClave) abrirCambioClave(true);

  // Boton de la llave junto a "Cerrar sesion" (una sola vez). Queda oculto
  // mientras el servidor no habilite el cambio de clave (FORZAR_CAMBIO_CLAVE).
  if (sesion.cambioClaveHabilitado && !document.getElementById('btnCambiarClave')) {
    const salir = document.getElementById('btnLogout');
    if (!salir) return;
    const llave = document.createElement('i');
    llave.id = 'btnCambiarClave';
    llave.className = 'fas fa-key';
    llave.title = 'Cambiar contrasena';
    llave.style.cssText = 'cursor:pointer; font-size:1.3rem;';
    llave.addEventListener('click', () => abrirCambioClave(false));
    salir.parentNode.insertBefore(llave, salir);
  }
}
