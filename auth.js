// ============================================================
// LOGIN. Los usuarios y las claves (hasheadas) viven SOLO en el servidor.
// Este archivo es publico: nunca poner claves aca.
// ============================================================

// Estructura de roles preparada para el futuro. Hoy solo 'admin' tiene
// logica real (acceso total); 'vendedor' ya existe para poder asignar
// usuarios a una sucursal, pero no hay ninguna pantalla todavia que le
// niegue algo a un vendedor -- eso es lo que falta cuando haya que
// "limitar permisos" de verdad.
const ROLES = {
  admin: {
    nombre: 'Administrador',
    descripcion: 'Acceso completo a todas las funciones y a las 2 sucursales.',
    accesoTotal: true
  },
  // Oficina: ve todas las sucursales y el panel de Ventas (verifica pagos); no anula
  // ni toca stock. Los permisos de verdad los hace cumplir el servidor, no esta tabla.
  oficina: {
    nombre: 'Oficina',
    descripcion: 'Panel de ventas y verificacion de pagos, en todas las sucursales.',
    accesoTotal: false
  },
  vendedor: {
    nombre: 'Vendedor',
    descripcion: 'Cotizador limitado a su sucursal asignada.',
    accesoTotal: false
  }
  // Agregar mas roles aca (ej. 'supervisor') a medida que haga falta.
};

const SESION_STORAGE_KEY = 'cotizador_sesion';

// Los nombres de vendedor siempre se muestran (y se guardan en Stock/Reportes)
// con la primera letra de cada palabra en mayuscula: "yoko" -> "Yoko".
function capitalizarNombre(nombre) {
  return String(nombre || '').trim().replace(/(^|\s)(\S)/g, (m, sep, letra) => sep + letra.toUpperCase());
}

// Login: siempre contra el servidor (claves hasheadas y cookie firmada). Sin
// conexion no se puede entrar.
async function iniciarSesion(usuario, password) {
  const usuarioNormalizado = String(usuario || '').trim().toLowerCase();
  try {
    const resp = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: usuarioNormalizado, password })
    });
    if (resp.status === 501) return { ok: false, error: 'El ingreso no esta configurado en el servidor. Avisale al administrador.' };
    const json = await resp.json();
    if (!json.ok) return { ok: false, error: json.error || 'Usuario o contrasena incorrectos' };
    const sesion = Object.assign({ origen: 'servidor' }, json.sesion);
    localStorage.setItem(SESION_STORAGE_KEY, JSON.stringify(sesion));
    return { ok: true, sesion };
  } catch (error) {
    return { ok: false, error: 'No hay conexion con el servidor. Revisa internet y proba de nuevo.' };
  }
}

function cerrarSesion() {
  localStorage.removeItem(SESION_STORAGE_KEY);
  // Borra la cookie del servidor (si no hay, no pasa nada).
  try { fetch('/api/logout', { method: 'POST', keepalive: true }); } catch (error) { /* sin conexion */ }
}

// Lee la sesion guardada (la verdad la tiene la cookie, ver
// verificarSesionServidor). Una sesion del login viejo ya no sirve.
function sesionGuardada() {
  const data = localStorage.getItem(SESION_STORAGE_KEY);
  if (!data) return null;
  try {
    const sesion = JSON.parse(data);
    if (sesion.origen !== 'servidor') return null;
    sesion.nombre = capitalizarNombre(sesion.nombre);
    return sesion;
  } catch (error) {
    return null;
  }
}

// Una sesion del servidor vence (12 h) o se puede cortar desde ahi: al abrir
// la app se confirma con /api/me y, si ya no vale, se vuelve al login.
async function verificarSesionServidor() {
  const data = localStorage.getItem(SESION_STORAGE_KEY);
  if (!data) return;
  try {
    const delServidor = JSON.parse(data).origen === 'servidor';
    const resp = await fetch('/api/me');
    if (resp.ok) {
      // Si ya cambio la clave en otro lado, se saca la marca de cambio pendiente.
      const ok = await resp.json();
      const guardada = JSON.parse(data);
      if (ok.sesion && (!!ok.sesion.debeCambiarClave !== !!guardada.debeCambiarClave ||
                        !!ok.sesion.cambioClaveHabilitado !== !!guardada.cambioClaveHabilitado)) {
        guardada.debeCambiarClave = !!ok.sesion.debeCambiarClave;
        guardada.cambioClaveHabilitado = !!ok.sesion.cambioClaveHabilitado;
        localStorage.setItem(SESION_STORAGE_KEY, JSON.stringify(guardada));
        location.reload();
      }
      return;
    }
    if (resp.status !== 401) return;
    // Sesion vencida, o una del login viejo (sin cookie) ahora que el servidor
    // ya tiene usuarios: se vuelve al login para sacar la cookie.
    const json = await resp.json().catch(() => ({}));
    if (delServidor || json.configurado) { localStorage.removeItem(SESION_STORAGE_KEY); location.reload(); }
  } catch (error) { /* sin conexion: se sigue con lo que hay */ }
}

// Si el servidor exige sesion y la cookie ya no sirve, cualquier pedido de
// datos vuelve con 401: se limpia la sesion y se vuelve al login.
(function () {
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const resp = await fetchOriginal(...args);
    if (resp.status === 401) {
      const url = String(typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '');
      if (url.indexOf('/api/') === -1) {
        try {
          const json = await resp.clone().json();
          if (json && json.sinSesion) { localStorage.removeItem(SESION_STORAGE_KEY); location.reload(); }
        } catch (error) { /* no era JSON */ }
      }
    }
    return resp;
  };
})();

// Administracion y oficina ven el panel de Ventas y todas las sucursales.
function esAdminOOficina(sesion) {
  return !!sesion && (sesion.rol === 'admin' || sesion.rol === 'oficina');
}

function esAdmin(sesion) {
  return !!sesion && sesion.rol === 'admin';
}

// Lista de nombres de vendedores de una sucursal (sin duplicados -- hay mas
// de un usuario/password para la misma persona, ej. 'agus'/'agustina' son
// el mismo nombre). Se usa para el selector de "quien vendio esto" al
// imprimir garantia/reserva/financiacion/ingreso, para que no haga falta
// cambiar de usuario logueado para que quede bien acreditada la venta.
// Nombres de vendedor por sucursal (SIN claves) para el selector de "quien
// vendio esto". Si se suma un vendedor nuevo, agregarlo aca ademas de en
// los usuarios del servidor.
const VENDEDORES_POR_SUCURSAL = {
  Shopping: ['yoko', 'ele', 'flor', 'Agus Mendoza', 'Agus Manzanelli', 'ro'],
  Independencia: ['ludmi', 'Vicky'],
  Dino: ['jose', 'ivonne', 'cristina', 'dino']
};

function vendedoresDeSucursal(sucursal) {
  const vistos = {};
  (VENDEDORES_POR_SUCURSAL[sucursal] || []).forEach(n => { vistos[capitalizarNombre(n)] = true; });
  return Object.keys(vistos).sort((a, b) => a.localeCompare(b, 'es'));
}
