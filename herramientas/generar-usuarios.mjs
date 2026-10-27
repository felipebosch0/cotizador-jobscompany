// Arma los secretos del login del servidor a partir de los usuarios de auth.js.
//
//   node herramientas/generar-usuarios.mjs
//
// Escribe secretos.local.txt (NO se sube a git, ver .gitignore) con:
//   USUARIOS_JSON  -> usuarios con la clave ya "hasheada" (nadie la puede leer)
//   SESSION_SECRET -> texto al azar para firmar la sesion
// y despues se cargan en Cloudflare (ver las instrucciones que imprime).
//
// Las claves de cada usuario son las que hoy estan en auth.js, asi los
// vendedores siguen entrando con la de siempre. Para que un admin tenga clave
// nueva, cambiala en auth.js antes de correr esto (o pasa ADMIN_CLAVE=...).

import { readFileSync, writeFileSync } from 'node:fs';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import vm from 'node:vm';

const ITERACIONES = Number(process.env.ITERACIONES || 10000);

const fuente = readFileSync(new URL('../auth.js', import.meta.url), 'utf8');
const bloque = fuente.match(/const USUARIOS = \[[\s\S]*?\n\];/);
if (!bloque) throw new Error('No encontre const USUARIOS en auth.js');
const USUARIOS = vm.runInNewContext(bloque[0].replace('const USUARIOS =', 'USUARIOS =') + '; USUARIOS');

const b64url = buf => Buffer.from(buf).toString('base64url');

const lista = USUARIOS.map(u => {
  const clave = (u.rol === 'admin' && process.env.ADMIN_CLAVE) ? process.env.ADMIN_CLAVE : u.password;
  const sal = randomBytes(16);
  const hash = pbkdf2Sync(clave, sal, ITERACIONES, 32, 'sha256');
  return {
    usuario: u.usuario,
    hash: 'pbkdf2$' + ITERACIONES + '$' + b64url(sal) + '$' + b64url(hash),
    rol: u.rol, nombre: u.nombre, sucursal: u.sucursal
  };
});

const sessionSecret = randomBytes(48).toString('base64url');
writeFileSync(new URL('../secretos.local.txt', import.meta.url),
  'USUARIOS_JSON=' + JSON.stringify(lista) + '\nSESSION_SECRET=' + sessionSecret + '\n');

console.log('Listo: ' + lista.length + ' usuarios, ' + ITERACIONES + ' iteraciones. Se escribio secretos.local.txt');
console.log('Cargalos en Cloudflare (Workers > cotizador-jobscompany > Settings > Variables and Secrets), como tipo Secret:');
console.log('  USUARIOS_JSON, SESSION_SECRET   (el contenido de cada linea de secretos.local.txt)');
console.log('Cuando el login nuevo ande para todos, sumar REQUIRE_AUTH = 1.');
