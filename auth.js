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
  { usuario: 'jose',      password: 'Independencia123',    rol: 'vendedor', nombre: 'jose',      sucursal: 'Independencia' },
  { usuario: 'yoko',      password: 'Shopping123',         rol: 'vendedor', nombre: 'yoko',      sucursal: 'Shopping' },
  { usuario: 'ele',       password: 'Shopping123',         rol: 'vendedor', nombre: 'ele',       sucursal: 'Shopping' },
  { usuario: 'flor',      password: 'Shopping123',         rol: 'vendedor', nombre: 'flor',      sucursal: 'Shopping' },
  { usuario: 'agus',      password: 'Shopping123',         rol: 'vendedor', nombre: 'agus',      sucursal: 'Shopping' },
  { usuario: 'agustina',  password: 'Shopping123',         rol: 'vendedor', nombre: 'agus',      sucursal: 'Shopping' },
  { usuario: 'ivonne',    password: 'Shopping123',         rol: 'vendedor', nombre: 'ivonne',    sucursal: 'Shopping' },
  { usuario: 'nai',       password: 'Shopping123',         rol: 'vendedor', nombre: 'naileth',   sucursal: 'Shopping' },
  { usuario: 'cris',      password: 'Shopping123',         rol: 'vendedor', nombre: 'cristina',  sucursal: 'Shopping' },
  { usuario: 'ro',        password: 'Shopping123',         rol: 'vendedor', nombre: 'ro',        sucursal: 'Shopping' },
  { usuario: 'ludmi',     password: 'Independencia123',    rol: 'vendedor', nombre: 'ludmi',     sucursal: 'Independencia' }
];

const SESION_STORAGE_KEY = 'cotizador_sesion';

function iniciarSesion(usuario, password) {
  const encontrado = USUARIOS.find(u => u.usuario === usuario && u.password === password);
  if (!encontrado) return { ok: false, error: 'Usuario o contrasena incorrectos' };

  const sesion = { usuario: encontrado.usuario, nombre: encontrado.nombre, rol: encontrado.rol, sucursal: encontrado.sucursal };
  localStorage.setItem(SESION_STORAGE_KEY, JSON.stringify(sesion));
  return { ok: true, sesion };
}

function cerrarSesion() {
  localStorage.removeItem(SESION_STORAGE_KEY);
}

// Lee la sesion guardada Y confirma que el usuario siga existiendo (por si
// se lo borro de USUARIOS entre una sesion y otra). Devuelve null si no
// hay sesion valida -- eso es lo que dispara la pantalla de login.
function sesionGuardada() {
  const data = localStorage.getItem(SESION_STORAGE_KEY);
  if (!data) return null;
  try {
    const sesion = JSON.parse(data);
    const sigueExistiendo = USUARIOS.some(u => u.usuario === sesion.usuario && u.rol === sesion.rol);
    return sigueExistiendo ? sesion : null;
  } catch (error) {
    return null;
  }
}

function esAdmin(sesion) {
  return !!sesion && sesion.rol === 'admin';
}
