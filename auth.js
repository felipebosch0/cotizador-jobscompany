// ============================================================
// LOGIN / AUTENTICACION (harness local).
//
// Esto es una simulacion para poder probar el flujo en el navegador. Las
// contrasenas estan en texto plano en este archivo, cualquiera que abra
// el archivo o la consola del navegador las puede ver -- ACEPTABLE ACA
// porque es un prototipo local que corre en tu maquina, pero NUNCA asi en
// produccion.
//
// En Apps Script (cotizador/Codigo.gs) el login real ya existe y es
// distinto: usuario/contrasena salen de la hoja CUENTAS del Google Sheet,
// la contrasena esta cifrada (no en texto plano) y la validacion la hace
// el servidor, no el navegador. Cuando se porte este login "con roles" a
// Apps Script, hay que sumarle un campo "rol" a la hoja CUENTAS (ahora
// mismo esa hoja solo tiene "nivel", un numero) y adaptar IniciarSesion en
// Codigo.gs para que tambien devuelva el rol.
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
  vendedor: {
    nombre: 'Vendedor',
    descripcion: 'Cotizador limitado a su sucursal asignada.',
    accesoTotal: false
  }
  // Agregar mas roles aca (ej. 'supervisor') a medida que haga falta.
};

// USUARIOS: hardcodeados con la lista real del negocio. Las contrasenas
// quedan en texto plano en este archivo -- cualquiera que abra la consola
// del navegador o vea el codigo fuente las puede leer. Aceptado por ahora,
// pero si en algun momento se necesita mas seguridad hay que mover esto a
// un backend (ver login real ya armado en cotizador-appscript/Codigo.gs,
// que cifra la contrasena y la valida en el servidor).
// sucursal: null = ve todas las sucursales (piensa como el admin).
const USUARIOS = [
  { usuario: 'admin',     password: 'Jobscompany468',      rol: 'admin',    nombre: 'Administrador', sucursal: null },
  { usuario: 'felipe',    password: 'Jobscompany468',      rol: 'admin',    nombre: 'felipe',    sucursal: null },
  { usuario: 'jose',      password: 'Jobs468',             rol: 'vendedor', nombre: 'jose',      sucursal: 'Shopping' },
  { usuario: 'yoko',      password: 'Shopping123',         rol: 'vendedor', nombre: 'yoko',      sucursal: 'Shopping' },
  { usuario: 'ele',       password: 'Shopping123',         rol: 'vendedor', nombre: 'ele',       sucursal: 'Shopping' },
  { usuario: 'flor',      password: 'Shopping123',         rol: 'vendedor', nombre: 'flor',      sucursal: 'Shopping' },
  { usuario: 'agus',      password: 'Shopping123',         rol: 'vendedor', nombre: 'Agus Mendoza',     sucursal: 'Shopping' },
  { usuario: 'agustina',  password: 'Shopping123',         rol: 'vendedor', nombre: 'Agus Mendoza',     sucursal: 'Shopping' },
  { usuario: 'manzanelli', password: 'Shopping123',        rol: 'vendedor', nombre: 'Agus Manzanelli',  sucursal: 'Shopping' },
  { usuario: 'ivonne',    password: 'Shopping123',         rol: 'vendedor', nombre: 'ivonne',    sucursal: 'Shopping' },
  { usuario: 'cris',      password: 'Shopping123',         rol: 'vendedor', nombre: 'cristina',  sucursal: 'Shopping' },
  { usuario: 'ro',        password: 'Shopping123',         rol: 'vendedor', nombre: 'ro',        sucursal: 'Shopping' },
  { usuario: 'ludmi',     password: 'Independencia123',    rol: 'vendedor', nombre: 'ludmi',     sucursal: 'Independencia' },
  // Dino: lista de precios propia (Independencia + USD 30 en iPhone). Usuario de
  // prueba -- reemplazar/agregar los vendedores reales de Dino aca.
  { usuario: 'dino',      password: 'Dino123',             rol: 'vendedor', nombre: 'dino',      sucursal: 'Dino' }
];

const SESION_STORAGE_KEY = 'cotizador_sesion';

// Los nombres de vendedor siempre se muestran (y se guardan en Stock/Reportes)
// con la primera letra de cada palabra en mayuscula: "yoko" -> "Yoko".
function capitalizarNombre(nombre) {
  return String(nombre || '').trim().replace(/(^|\s)(\S)/g, (m, sep, letra) => sep + letra.toUpperCase());
}

// Login: primero contra el servidor (/api/login, claves hasheadas y cookie
// firmada). Si el servidor todavia no tiene configurados los usuarios (responde
// 501) se usa el login viejo de este archivo, asi nada se corta mientras se
// hace el cambio. Cuando el servidor ande para todos, se borra USUARIOS.
async function iniciarSesion(usuario, password) {
  const usuarioNormalizado = String(usuario || '').trim().toLowerCase();
  try {
    const resp = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: usuarioNormalizado, password })
    });
    if (resp.status !== 501) {
      const json = await resp.json();
      if (!json.ok) return { ok: false, error: json.error || 'Usuario o contrasena incorrectos' };
      const sesion = Object.assign({ origen: 'servidor' }, json.sesion);
      localStorage.setItem(SESION_STORAGE_KEY, JSON.stringify(sesion));
      return { ok: true, sesion };
    }
  } catch (error) {
    // Sin conexion con el servidor: se cae al login local (solo si no hay
    // usuarios en el servidor; con ellos configurados el 501 no aparece).
  }
  return iniciarSesionLocal(usuarioNormalizado, password);
}

function iniciarSesionLocal(usuarioNormalizado, password) {
  // El usuario no distingue mayusculas (el teclado del celular pone la primera
  // en mayuscula sola: "Jose" tiene que entrar igual que "jose"); la
  // contrasena si se compara exacta.
  const encontrado = USUARIOS.find(u => u.usuario === usuarioNormalizado && u.password === password);
  if (!encontrado) return { ok: false, error: 'Usuario o contrasena incorrectos' };

  const sesion = { usuario: encontrado.usuario, nombre: encontrado.nombre, rol: encontrado.rol, sucursal: encontrado.sucursal };
  localStorage.setItem(SESION_STORAGE_KEY, JSON.stringify(sesion));
  return { ok: true, sesion };
}

function cerrarSesion() {
  localStorage.removeItem(SESION_STORAGE_KEY);
  // Borra la cookie del servidor (si no hay, no pasa nada).
  try { fetch('/api/logout', { method: 'POST', keepalive: true }); } catch (error) { /* sin conexion */ }
}

// Lee la sesion guardada. Una sesion del servidor se toma tal cual (la
// verdad la tiene la cookie, ver verificarSesionServidor); una del login
// viejo se confirma contra USUARIOS (por si se lo borro entre una sesion y
// otra). Devuelve null si no hay sesion valida -- eso dispara el login.
function sesionGuardada() {
  const data = localStorage.getItem(SESION_STORAGE_KEY);
  if (!data) return null;
  try {
    const sesion = JSON.parse(data);
    if (sesion.origen !== 'servidor') {
      const actual = USUARIOS.find(u => u.usuario === sesion.usuario && u.rol === sesion.rol);
      if (!actual) return null;
      // La sucursal se toma siempre de USUARIOS (no de lo guardado): si se
      // mueve a alguien de sucursal, la sesion que ya tenia abierta se actualiza.
      sesion.sucursal = actual.sucursal;
    }
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
  Shopping: ['jose', 'yoko', 'ele', 'flor', 'Agus Mendoza', 'Agus Manzanelli', 'ivonne', 'cristina', 'ro'],
  Independencia: ['ludmi'],
  Dino: ['dino']
};

function vendedoresDeSucursal(sucursal) {
  const vistos = {};
  (VENDEDORES_POR_SUCURSAL[sucursal] || []).forEach(n => { vistos[capitalizarNombre(n)] = true; });
  return Object.keys(vistos).sort((a, b) => a.localeCompare(b, 'es'));
}
