import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, lstatSync, readFileSync, writeFileSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
export class RecoveryError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
export const fail = (code, message, status) => { throw new RecoveryError(code, message, status); };
export const hash = value => createHash('sha256').update(value).digest('hex');
export function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function directory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) fail('unsafe_directory', 'Directorio de recuperación no seguro.');
  if (realpathSync(path) !== path) fail('unsafe_directory', 'No se permiten enlaces en la ruta de recuperación.');
  return path;
}
export function regular(path, limit = Infinity) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) fail('unsafe_file', 'Archivo de recuperación no válido.');
  return stat;
}
export function read(path, fallback = null, limit = 4 * 1024 * 1024) {
  if (!existsSync(path)) return fallback;
  regular(path, limit);
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { fail('corrupt_metadata', 'Metadata dañada. Conserva los archivos y revisa la recuperación.'); }
}
export function atomic(path, value) {
  if (existsSync(path)) regular(path);
  const temp = `${path}.${randomBytes(12).toString('hex')}.tmp`;
  try { writeFileSync(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); renameSync(temp, path); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}
export function secret(path) {
  directory(dirname(path));
  if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  regular(path, 64);
  const key = readFileSync(path, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(key)) fail('invalid_key', 'Clave de recuperación no válida.');
  return key;
}
export const sign = (key, body) => createHmac('sha256', key).update(body).digest('hex');
export function envelope(key, value) {
  const body = JSON.stringify(value);
  return { body, mac: sign(key, body) };
}
export function unwrap(key, value) {
  if (!value || typeof value.body !== 'string' || value.body.length > 4 * 1024 * 1024 || !equal(sign(key, value.body), value.mac)) fail('invalid_signature', 'Mensaje de recuperación no autorizado.', 403);
  return JSON.parse(value.body);
}
export function createStore(path) {
  directory(path);
  let revision = 0;
  return { path, get revision() { return revision; },
    read: (name, fallback) => read(join(path, `${name}.json`), fallback),
    write: (name, value) => { atomic(join(path, `${name}.json`), value); revision++; } };
}
