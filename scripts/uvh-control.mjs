#!/usr/bin/env node
// UVH Control: local-only controller. No production access and no test runner.
import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline/promises';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync,
  lstatSync, realpathSync, readdirSync, openSync, closeSync, readSync, fstatSync,
  linkSync, rmdirSync,
} from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, extname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMITS = Object.freeze({ status: 60000, logs: 60000, stop: 180000,
  'repair-docker': 180000, start: 600000, restart: 600000, migrate: 900000 });
const MODES = new Set(['start', 'stop', 'restart', 'migrate', 'repair-docker']);
const OUTPUT_LIMIT = 1024 * 1024;
const SERVICES = ['postgres', 'app', 'queue', 'schedule'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const sleep = (ms, signal) => new Promise((resolveSleep, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const timer = setTimeout(done, ms);
  function done() { signal?.removeEventListener('abort', abort); resolveSleep(); }
  function abort() { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); }
  signal?.addEventListener('abort', abort, { once: true });
});
export class ControlError extends Error {
  constructor(message, status = 500) { super(message); this.status = status; }
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
export function safeText(value, secrets = []) {
  let text = String(value ?? '').slice(-OUTPUT_LIMIT);
  for (const secret of secrets) if (secret.length >= 4) text = text.split(secret).join('[REDACTADO]');
  return text.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTADO]')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTADO]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTADO]')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:)[^\s/@]+@/gi, '$1[REDACTADO]@');
}
function regularFile(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new ControlError('Archivo local no seguro.');
  return info;
}
function readJson(path, max = OUTPUT_LIMIT) {
  if (!existsSync(path)) return null;
  if (regularFile(path).size > max) throw new ControlError('Archivo local demasiado grande.');
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new ControlError('Metadata local dañada. Revisa el runtime antes de continuar.', 409); }
}
function atomicJson(path, value) {
  if (existsSync(path)) regularFile(path);
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    renameSync(temp, path);
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}
export function tailFile(path, count = 100) {
  if (!existsSync(path)) return '';
  const fd = openSync(path, 'r');
  try {
    regularFile(path);
    const size = fstatSync(fd).size;
    const length = Math.min(size, OUTPUT_LIMIT);
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, size - length);
    const text = buffer.subarray(0, read).toString('utf8');
    return `${size > length ? '[Registro truncado]\n' : ''}${text.split(/\r?\n/).slice(-count).join('\n')}`;
  } finally { closeSync(fd); }
}

// Detached groups belong to this child invocation, not to a name-based lookup.
export async function runProcess(file, args = [], options = {}) {
  const { signal, timeoutMs = 60000, cwd, env = process.env } = options;
  signal?.throwIfAborted();
  return new Promise((resolveRun, reject) => {
    const child = spawn(file, args, { cwd, env, shell: false, detached: process.platform !== 'win32',
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', bytes = 0, truncated = false, failure = null, forceTimer, cleanupTimer;
    const collect = (chunk) => {
      bytes += chunk.length;
      if (bytes <= OUTPUT_LIMIT) output += chunk.toString('utf8');
      else truncated = true;
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const kill = (force) => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])],
          { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { failure = new ControlError('No se pudo verificar el cierre del subproceso.', 409); });
      } else {
        try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM'); }
        catch (error) { if (error.code !== 'ESRCH') failure = error; }
      }
    };
    const abort = () => {
      failure ??= signal?.reason ?? new ControlError('Tiempo máximo agotado.');
      kill(false);
      forceTimer = setTimeout(() => kill(true), 1500);
      cleanupTimer = setTimeout(() => {
        const error = new ControlError('Cierre del subproceso no verificable. Operación bloqueada para revisión.', 409);
        error.uncertain = true;
        finish(error);
      }, 5000);
    };
    const timer = setTimeout(() => { failure = new ControlError('Tiempo máximo del subproceso agotado.'); abort(); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    let finished = false;
    if (signal?.aborted) abort();
    function finish(error, code) {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(forceTimer); clearTimeout(cleanupTimer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolveRun({ code: code ?? 1, output: output.trimEnd() + (truncated ? '\n[Salida truncada]' : '') });
    }
    child.once('error', (error) => finish(error));
    child.once('close', async (code) => {
      if (child.pid && process.platform !== 'win32') {
        const groupAlive = () => { try { process.kill(-child.pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
        if (groupAlive()) {
          kill(false);
          const deadline = Date.now() + 3000;
          while (groupAlive() && Date.now() < deadline) {
            if (Date.now() > deadline - 1500) kill(true);
            await sleep(50);
          }
          if (groupAlive()) {
            failure = new ControlError('Quedan descendientes sin cierre verificable. Revisión necesaria.', 409);
            failure.uncertain = true;
          }
        }
      }
      finish(failure, code);
    });
  });
}

export async function inspectProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return { birth: `linux:${fields[19]}`, commandLine: readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim(),
        cwd: realpathSync(`/proc/${pid}/cwd`) };
    }
    if (process.platform === 'win32') {
      const result = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if (!$p) {exit 1}; @{birth=$p.CreationDate.ToUniversalTime().ToString('o');commandLine=$p.CommandLine}|ConvertTo-Json -Compress`], { timeoutMs: 5000 });
      return result.code === 0 ? JSON.parse(result.output) : null;
    }
    const result = await runProcess('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command='],
      { timeoutMs: 5000, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } });
    const match = result.output.trim().match(/^(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+([\s\S]+)$/);
    return result.code === 0 && match ? { birth: match[1], commandLine: match[2] } : null;
  } catch { return null; }
}
function sameIdentity(a, b) { return a && b && a.birth === b.birth && a.commandLine === b.commandLine; }
export function portOccupied(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: '127.0.0.1', port, timeout: 800 });
    socket.once('connect', () => { socket.destroy(); resolvePort(true); });
    socket.once('error', () => resolvePort(false));
    socket.once('timeout', () => { socket.destroy(); resolvePort(false); });
  });
}
export async function probeEndpoint(url, signal) {
  const began = performance.now();
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(12000), ...(signal ? [signal] : [])]) });
    await response.body?.cancel();
    const latencyMs = Math.round(performance.now() - began);
    return { url, status: response.ok ? (latencyMs >= 3000 ? 'slow' : 'ok') : 'error', httpStatus: response.status, latencyMs };
  } catch {
    signal?.throwIfAborted();
    return { url, status: 'unavailable', httpStatus: null, latencyMs: Math.round(performance.now() - began) };
  }
}

export function createController(options = {}) {
  const root = realpathSync(options.root ?? process.env.UVH_CONTROL_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  const panelDir = options.panelDir ?? process.env.UVH_CONTROL_PANEL_DIR ?? join(root, 'panel/dist/panel/browser');
  const runtime = join(root, '.uvh-runtime');
  const envFile = join(root, '.env.docker.local');
  const composeFile = join(root, 'docker-compose.local.yml');
  const frontendFile = join(runtime, 'frontend.process.json');
  const lockFile = join(runtime, 'control.lock');
  const gateDir = join(runtime, 'control.gate');
  const journalFile = join(runtime, 'operations.json');
  const runner = options.run ?? runProcess;
  const inspect = options.inspect ?? inspectProcess;
  const occupied = options.occupied ?? portOccupied;
  const probe = options.probe ?? probeEndpoint;
  const context = new AsyncLocalStorage();
  const token = randomBytes(32).toString('hex');
  const confirmations = new Map();
  let operation = null, admitting = false, journal = [], statusPending = null, cachedStatus = null;
  const limits = options.limits ?? LIMITS;
  function ensureRuntime() {
    mkdirSync(runtime, { recursive: true, mode: 0o700 });
    const stat = lstatSync(runtime);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && stat.uid !== process.getuid()))
      throw new ControlError('Directorio runtime no seguro.');
  }
  function environment() {
    const values = {};
    if (existsSync(envFile)) {
      if (regularFile(envFile).size > 65536) throw new ControlError('Entorno local demasiado grande.');
      for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
    return values;
  }
  function redact(value) {
    const secrets = Object.entries(environment()).filter(([key]) => /PASSWORD|SECRET|TOKEN|KEY/i.test(key)).map(([, value]) => value);
    return safeText(value, secrets);
  }
  function database() {
    const value = environment().POSTGRES_DB ?? 'uvh_local';
    if (!/^[A-Za-z0-9_.-]{1,63}$/.test(value)) throw new ControlError('Nombre de base local no válido.');
    return value;
  }
  function prepareEnvironment() {
    ensureRuntime();
    if (!existsSync(envFile)) {
      const example = join(root, '.env.docker.local.example'); regularFile(example);
      writeFileSync(envFile, readFileSync(example), { flag: 'wx', mode: 0o600 });
    }
  }
  async function command(file, args, extra = {}) {
    const ctx = context.getStore();
    ctx?.signal.throwIfAborted();
    const timeoutMs = ctx ? Math.max(1, ctx.deadline - Date.now()) : 60000;
    let result;
    try { result = await runner(file, args, { cwd: root, signal: ctx?.signal, timeoutMs, ...extra }); }
    catch (error) {
      if (error.code === 'ENOENT') throw new ControlError(`La herramienta ${file} no está instalada o no se encuentra en PATH.`);
      throw error;
    }
    ctx?.signal.throwIfAborted();
    return { ...result, output: redact(result.output) };
  }
  function composeArgs(args) { return ['compose', '-f', composeFile, '--env-file', envFile, '--profile', 'laravel', ...args]; }
  async function compose(args) {
    if (!existsSync(envFile)) throw new ControlError('Entorno local no configurado. Inicia el entorno primero.');
    const result = await command('docker', composeArgs(args));
    if (result.code !== 0) throw new ControlError(result.output || 'Docker Compose devolvió un error.');
    return result.output;
  }
  async function dockerVersion() {
    try { const result = await command('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 8000 }); return result.code === 0 ? result.output.trim() : null; }
    catch (error) { context.getStore()?.signal.throwIfAborted(); if (error.uncertain) throw error; return null; }
  }
  async function dockerReady() {
    if (await dockerVersion()) return;
    let result;
    if (process.platform === 'darwin') result = await command('/usr/bin/open', ['-a', 'Docker']);
    else if (process.platform === 'win32') {
      const path = join(process.env.ProgramFiles ?? '', 'Docker/Docker/Docker Desktop.exe');
      if (!existsSync(path)) throw new ControlError('Abre Docker Desktop e inténtalo de nuevo.');
      const child = spawn(path, [], { detached: true, stdio: 'ignore', windowsHide: true });
      await new Promise((yes, no) => { child.once('spawn', yes); child.once('error', no); }); child.unref();
      result = { code: 0 };
    } else result = await command('systemctl', ['--user', 'start', 'docker-desktop']);
    if (result.code !== 0) throw new ControlError('No se pudo abrir Docker Desktop. Ábrelo manualmente.');
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await sleep(2000, context.getStore()?.signal);
      if (await dockerVersion()) return;
    }
    throw new ControlError('Docker no estuvo disponible en tres minutos. Revisa Docker Desktop.');
  }
  async function withGate(callback) {
    ensureRuntime();
    try { mkdirSync(gateDir, { mode: 0o700 }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new ControlError('Admisión concurrente o control.gate interrumpido. Revisa el runtime si persiste.', 409);
      throw error;
    }
    try { return await callback(); } finally { rmdirSync(gateDir); }
  }
  async function lockState() {
    const lock = readJson(lockFile, 16384);
    if (!lock) return null;
    if (!Number.isSafeInteger(lock.pid) || !lock.identity || typeof lock.nonce !== 'string')
      throw new ControlError('Lock legado o dañado: revisa su propietario antes de continuar.', 409);
    const info = await inspect(lock.pid);
    if (!info && alive(lock.pid)) throw new ControlError('No se pudo comprobar al propietario del lock.', 409);
    return { lock, live: sameIdentity(info, lock.identity) };
  }
  async function acquire(mode, requestId) {
    return withGate(async () => {
      const previous = await lockState();
      if (previous?.live || previous?.lock.uncertain) throw new ControlError('Ya hay una operación en curso o pendiente de revisión.', 409);
      if (previous) unlinkSync(lockFile);
      const interrupted = loadJournal().find((entry) => entry.status === 'running');
      if (interrupted) throw new ControlError('Operación interrumpida: consulta sus servicios y revisa el bloqueo antes de continuar.', 409);
      const identity = await inspect(process.pid);
      if (!identity) throw new ControlError('No se pudo verificar la identidad del controlador.');
      const lock = { schema: 1, pid: process.pid, identity, nonce: randomUUID(), mode, requestId, startedAt: new Date().toISOString() };
      const owner = `${lockFile}.${lock.nonce}`;
      try { writeFileSync(owner, JSON.stringify(lock), { flag: 'wx', mode: 0o600 }); linkSync(owner, lockFile); }
      finally { if (existsSync(owner)) unlinkSync(owner); }
      return lock;
    });
  }
  async function release(lock, uncertain = false) {
    await withGate(async () => {
      const existing = readJson(lockFile, 16384);
      if (existing?.nonce !== lock.nonce) throw new ControlError('Cambió el propietario del bloqueo.', 409);
      if (uncertain) atomicJson(lockFile, { ...existing, uncertain: true });
      else unlinkSync(lockFile);
    });
  }
  function loadJournal() {
    const saved = readJson(journalFile);
    if (saved !== null && (!Array.isArray(saved) || saved.length > 50)) throw new ControlError('Historial local no válido.', 409);
    return saved ?? [];
  }
  async function state() {
    const saved = loadJournal();
    const owner = await lockState();
    const recent = saved.map((entry) => entry.status === 'running' && (!owner?.live || owner.lock.requestId !== entry.requestId)
      ? { ...entry, status: 'unknown', phase: 'Controlador interrumpido; consulta el estado antes de actuar.' } : entry);
    return { ok: true, schema: 1, operation: operation ?? recent.find((entry) => entry.status === 'running') ?? null,
      recentOperations: recent.slice().reverse() };
  }
  async function bounded(mode, task) {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      const error = new ControlError(`Tiempo máximo agotado (${limits[mode] / 1000}s).`); error.timedOut = true; abort.abort(error);
    }, limits[mode]);
    try { return await context.run({ signal: abort.signal, deadline: Date.now() + limits[mode] }, task); }
    finally { clearTimeout(timer); }
  }
  async function trackedFrontend() {
    const metadata = readJson(frontendFile, 16384);
    if (!metadata) return null;
    if (metadata.schema !== 1 || metadata.root !== root || !Number.isSafeInteger(metadata.pid)
      || typeof metadata.nonce !== 'string' || !metadata.identity) throw new ControlError('Identidad frontend ambigua o legada. No se terminará ningún proceso.', 409);
    const info = await inspect(metadata.pid);
    if (!info && alive(metadata.pid)) throw new ControlError('No se pudo inspeccionar el frontend registrado.', 409);
    const ownCommand = info?.commandLine.includes('--frontend-supervisor') && info.commandLine.includes(metadata.nonce)
      && info.commandLine.includes(root);
    return ownCommand && sameIdentity(metadata.identity, info) ? metadata : null;
  }
  function externalNode() {
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      const path = join(dir, process.platform === 'win32' ? 'node.exe' : 'node');
      if (existsSync(path)) return realpathSync(path);
    }
    throw new ControlError('Node.js de desarrollo no está en PATH. El panel funciona sin Node; iniciar Angular sí lo necesita.');
  }
  async function startFrontend() {
    if (await trackedFrontend()) return 'Frontend ya iniciado.';
    if (await occupied(options.frontendPort ?? 4200)) throw new ControlError('El puerto 4200 está ocupado por otro proceso. No se modificó.');
    const cli = join(root, 'frontend/node_modules/@angular/cli/bin/ng.js');
    if (!existsSync(cli)) throw new ControlError('Faltan dependencias del frontend. Ejecuta npm ci dentro de frontend y vuelve a iniciar.');
    const nonce = randomUUID();
    const child = spawn(externalNode(), [fileURLToPath(import.meta.url), '--frontend-supervisor', nonce, root],
      { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
    await new Promise((yes, no) => { child.once('spawn', yes); child.once('error', no); }); child.unref();
    // The child publishes its own real OS identity before launching Angular.
    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        await sleep(100, context.getStore()?.signal);
        const tracked = await trackedFrontend();
        if (tracked?.nonce === nonce) return 'Frontend iniciado. La compilación puede tardar; comprueba la salud HTTP.';
        if (!alive(child.pid)) throw new ControlError('El supervisor frontend no pudo arrancar. Revisa los registros.');
      }
    } catch (error) {
      // This handle is our newly spawned child; never look up a PID by name.
      child.kill('SIGTERM');
      const closed = await Promise.race([new Promise((yes) => child.once('close', () => yes(true))), sleep(5000).then(() => false)]);
      if (!closed) { error.uncertain = true; }
      throw error;
    }
    const error = new ControlError('No se pudo confirmar el arranque del frontend; operación pendiente de revisión.', 409); error.uncertain = true; throw error;
  }
  async function stopFrontend() {
    const tracked = await trackedFrontend();
    if (!tracked) return 'Frontend ya detenido o PID obsoleto; no se ha terminado ningún proceso ajeno.';
    if (process.platform === 'win32') {
      // Console SIGTERM is not graceful on Windows. Ask our nonce-bound
      // supervisor to close and reap its own tree instead of killing it.
      atomicJson(join(runtime, `frontend-stop-${tracked.nonce}.json`), { nonce: tracked.nonce });
    } else process.kill(tracked.pid, 'SIGTERM');
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && await trackedFrontend()) await sleep(150, context.getStore()?.signal);
    if (await trackedFrontend()) {
      // A supervisor may have children; never blindly SIGKILL it and orphan Angular.
      throw new ControlError('El frontend no confirmó su cierre. No se forzó un PID ni se reinició el entorno.', 409);
    }
    const current = readJson(frontendFile, 16384);
    if (current?.nonce === tracked.nonce && !alive(tracked.pid))
      throw new ControlError('El supervisor murió sin confirmar el cierre de sus hijos. Revisa el frontend antes de continuar.', 409);
    return 'Frontend detenido.';
  }
  async function repair() {
    if (process.platform !== 'win32') throw new ControlError('La reparación IPC solo se aplica a Docker Desktop en Windows.', 400);
    if ((await command('net.exe', ['session'])).code !== 0) throw new ControlError('Requiere una terminal de administrador. El panel no eleva privilegios automáticamente.', 403);
    const base = process.env.LOCALAPPDATA;
    if (!base || !isAbsolute(base)) throw new ControlError('LOCALAPPDATA no válido.');
    const targets = [join(base, 'Docker/run'), join(base, 'docker-secrets-engine')];
    for (const path of targets) if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new ControlError('Runtime IPC con enlace inesperado. No se modificó.');
    await command('taskkill.exe', ['/IM', 'Docker Desktop.exe', '/IM', 'com.docker.backend.exe', '/IM', 'com.docker.build.exe', '/F']);
    const restart = [];
    try {
      for (const name of ['com.docker.service', 'WslService']) {
        const query = await command('sc.exe', ['query', name]);
        if (/\bRUNNING\b/.test(query.output)) {
          restart.push(name);
          if ((await command('sc.exe', ['stop', name])).code !== 0) throw new ControlError(`No se pudo detener ${name}.`);
          const deadline = Date.now() + 15000;
          while (/\bRUNNING\b/.test((await command('sc.exe', ['query', name])).output)) {
            if (Date.now() >= deadline) throw new ControlError(`No se confirmó la parada de ${name}.`);
            await sleep(500, context.getStore()?.signal);
          }
        }
      }
      const wsl = await command('wsl.exe', ['--terminate', 'docker-desktop']);
      if (wsl.code !== 0) throw new ControlError('No se pudo confirmar la parada de Docker en WSL.');
      for (const path of targets) {
        if (!existsSync(path)) continue;
        if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new ControlError('Runtime IPC inesperado.');
        renameSync(path, `${path}.stale-${Date.now()}-${randomUUID()}`);
      }
    } finally {
      // Restoration is separately bounded even after the operation was aborted.
      const restorationErrors = [];
      for (const name of restart.reverse()) {
        try {
          const result = await runner('sc.exe', ['start', name], { timeoutMs: 15000 });
          if (result.code !== 0) restorationErrors.push(name);
        } catch { restorationErrors.push(name); }
      }
      if (restorationErrors.length) {
        const error = new ControlError(`No se pudo restaurar ${restorationErrors.join(', ')}. Revisión manual necesaria.`);
        error.uncertain = true; throw error;
      }
    }
    return 'Directorios IPC archivados. No se eliminaron imágenes, volúmenes ni contenedores.';
  }
  async function execute(mode) {
    const phase = (text) => { if (operation) operation.phase = text; };
    if (mode === 'stop' || mode === 'restart') {
      phase('Deteniendo el entorno');
      const frontend = await stopFrontend();
      let stopped = '';
      if (existsSync(envFile)) stopped = await compose(['stop']);
      if (mode === 'stop') return `${frontend}\n${stopped}`;
    }
    if (mode === 'start' || mode === 'restart') {
      phase('Preparando Docker'); prepareEnvironment(); await dockerReady();
      phase('Iniciando servicios'); const result = await compose(['up', '-d', ...SERVICES]);
      phase('Iniciando Angular'); return `${result}\n${await startFrontend()}`;
    }
    if (mode === 'migrate') {
      phase('Aplicando migraciones locales'); await dockerReady();
      return compose(['run', '--rm', 'php', 'php', 'artisan', 'migrate', '--force', '--no-interaction']);
    }
    if (mode === 'repair-docker') { phase('Reparando runtime IPC'); return repair(); }
    throw new ControlError('Modo no válido.', 400);
  }
  async function admit(mode, requestId, confirmationId) {
    if (!MODES.has(mode) || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId ?? '')) throw new ControlError('Solicitud de operación no válida.', 400);
    const replay = loadJournal().find((entry) => entry.requestId === requestId);
    if (replay) {
      if (replay.mode !== mode) throw new ControlError('requestId ya pertenece a otra operación.', 409);
      const snapshot = await state();
      return snapshot.recentOperations.find((entry) => entry.requestId === requestId);
    }
    if (admitting || operation) throw new ControlError('Ya hay una operación en curso.', 409);
    admitting = true;
    let lock;
    try {
      if (mode === 'migrate' || mode === 'repair-docker') {
        const confirmation = confirmations.get(confirmationId);
        confirmations.delete(confirmationId);
        if (!confirmation || confirmation.mode !== mode || confirmation.expires < Date.now() || confirmation.destination !== database())
          throw new ControlError('Confirmación ausente, caducada o destino cambiado.', 403);
      }
      lock = await acquire(mode, requestId);
      // A second controller may have written history while we awaited admission.
      const records = loadJournal();
      const concurrentReplay = records.find((entry) => entry.requestId === requestId);
      if (concurrentReplay) {
        await release(lock); lock = null;
        if (concurrentReplay.mode !== mode) throw new ControlError('requestId ya pertenece a otra operación.', 409);
        return (await state()).recentOperations.find((entry) => entry.requestId === requestId);
      }
      const item = { id: randomUUID(), requestId, mode, status: 'running', phase: 'Preparando operación',
        startedAt: new Date().toISOString(), finishedAt: null, output: '', error: null };
      operation = item; journal = [...records, item].slice(-50); atomicJson(journalFile, journal);
      const pending = bounded(mode, () => execute(mode));
      void pending.then((output) => finish(item, lock, 'succeeded', output),
        (error) => finish(item, lock, error.uncertain ? 'unknown' : error.timedOut ? 'timedOut' : 'failed', '', error))
        .catch((error) => { item.status = 'unknown'; item.error = redact(error.message); operation = item; });
      return item;
    } catch (error) {
      if (lock) await release(lock);
      operation = null; throw error;
    } finally { admitting = false; }
  }
  async function finish(item, lock, status, output = '', error) {
    item.status = status; item.finishedAt = new Date().toISOString();
    item.output = redact(output).slice(-16384); item.error = error ? redact(error.message) : null;
    item.phase = status === 'succeeded' ? 'Operación completada' : status === 'unknown' ? 'Revisión necesaria' : 'Operación finalizada con error';
    // Persist while we still hold authority. A journal failure keeps the lock.
    journal = loadJournal().map((entry) => entry.id === item.id ? item : entry);
    atomicJson(journalFile, journal);
    await release(lock, status === 'unknown');
    operation = status === 'unknown' ? item : null; cachedStatus = null;
  }
  function confirm(mode, destination) {
    if (!['migrate', 'repair-docker'].includes(mode) || destination !== database()) throw new ControlError('Confirmación no válida para el destino local.', 400);
    for (const [id, item] of confirmations) if (item.expires < Date.now()) confirmations.delete(id);
    if (confirmations.size >= 32) throw new ControlError('Demasiadas confirmaciones pendientes.', 429);
    const id = randomUUID(); confirmations.set(id, { mode, destination, expires: Date.now() + 60000 });
    return { ok: true, confirmationId: id, expiresIn: 60 };
  }
  async function collectStatus() {
    const signal = context.getStore()?.signal;
    const [backend, frontend] = await Promise.all([probe('http://127.0.0.1:8000/health', signal), probe('http://127.0.0.1:4200/', signal)]);
    const version = await dockerVersion();
    let docker = { status: version ? 'running' : 'unavailable', version };
    if (!version) {
      try { if ((await command('docker', ['--version'], { timeoutMs: 5000 })).code !== 0) docker.status = 'missing'; }
      catch { signal?.throwIfAborted(); docker.status = 'missing'; }
    }
    let rows = [], serviceError = null;
    if (version && existsSync(envFile)) {
      try {
        const raw = await compose(['ps', '--all', '--format', 'json']);
        rows = raw.trim().startsWith('[') ? JSON.parse(raw) : raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
        if (!Array.isArray(rows)) throw new Error('Formato Compose no válido');
      } catch (error) { signal?.throwIfAborted(); serviceError = redact(error.message); }
    }
    const services = SERVICES.map((name) => {
      const row = rows.find((entry) => entry.Service === name);
      return { name, status: row ? (row.State === 'running' ? 'running' : 'stopped') : version && existsSync(envFile) && !serviceError ? 'stopped' : 'unknown',
        detail: row ? String(row.Status ?? row.State) : serviceError ?? (!existsSync(envFile) ? 'Entorno no configurado' : 'Sin servicio iniciado'),
        health: row?.Health === 'healthy' ? 'healthy' : row?.Health === 'unhealthy' ? 'unhealthy' : null };
    });
    let tracked = null, trackingError = null;
    try { tracked = await trackedFrontend(); } catch (error) { trackingError = redact(error.message); }
    services.push({ name: 'frontend', status: tracked ? 'running' : trackingError ? 'unknown' : 'stopped',
      detail: tracked ? `Supervisor propio · PID ${tracked.pid}` : trackingError ?? 'Sin proceso registrado', health: null });
    const migrations = { status: 'unknown', database: database(), applied: null, pending: null };
    if (version && existsSync(envFile)) {
      try {
        const user = environment().POSTGRES_USER ?? 'uvh_local';
        if (!/^[A-Za-z0-9_.-]{1,63}$/.test(user)) throw new Error('Usuario de base no válido');
        const names = readdirSync(join(root, 'backend-laravel/database/migrations')).filter((name) => name.endsWith('.php')).map((name) => name.slice(0, -4));
        const result = await compose(['exec', '-T', 'postgres', 'psql', '-U', user, '-d', database(), '-Atc', 'SELECT migration FROM migrations ORDER BY id']);
        const applied = new Set(result.split(/\r?\n/).filter(Boolean));
        migrations.applied = names.filter((name) => applied.has(name)).length;
        migrations.pending = names.length - migrations.applied; migrations.status = migrations.pending ? 'pending' : 'current';
      } catch { signal?.throwIfAborted(); }
    }
    const checkedAt = new Date().toISOString();
    const endpointLabel = (value) => `${value.status === 'slow' ? 'LENTO' : value.status === 'ok' ? 'OK' : 'NO DISPONIBLE'} · ${value.latencyMs}ms${value.httpStatus ? ` · HTTP ${value.httpStatus}` : ''}`;
    const text = [`Actualizado: ${checkedAt}`, `Docker: ${docker.status}${version ? ` · ${version}` : ''}`,
      ...services.map((item) => `${item.name}: ${item.status} · ${item.detail}`), `Backend /health: ${endpointLabel(backend)}`,
      `Frontend web: ${endpointLabel(frontend)}`, `Migraciones: ${migrations.status} · base ${database()}`].join('\n');
    return { ok: true, schema: 1, checkedAt, text: redact(text), docker, services, endpoints: { backend, frontend }, migrations,
      capabilities: { platform: process.platform, repair: process.platform === 'win32', elevationRequired: true }, configured: existsSync(envFile) };
  }
  async function status() {
    if (cachedStatus && Date.now() - cachedStatus.at < 3000) return cachedStatus.value;
    if (!statusPending) {
      statusPending = bounded('status', collectStatus).then((value) => { cachedStatus = { at: Date.now(), value }; return value; })
        .finally(() => { statusPending = null; });
    }
    return statusPending;
  }
  async function logs(target) {
    if (!['backend', 'frontend'].includes(target)) throw new ControlError('target debe ser backend|frontend.', 400);
    return bounded('logs', async () => {
      const text = target === 'backend' ? await compose(['logs', '--no-color', '--tail', '120', ...SERVICES])
        : ['out', 'err'].map((kind) => `--- frontend.${kind}.log ---\n${tailFile(join(runtime, `frontend.${kind}.log`)) || '(vacío)'}`).join('\n');
      return { ok: true, text: redact(text), checkedAt: new Date().toISOString(), truncated: text.includes('[Registro truncado]') || text.includes('[Salida truncada]') };
    });
  }
  async function shutdown() {
    if (operation?.status === 'running') throw new ControlError('Hay una operación activa. Espera antes de cerrar.', 409);
  }
  async function serve({ port = 4580, open = true } = {}) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ControlError('Puerto no válido.', 400);
    const staticRoot = realpathSync(panelDir);
    regularFile(join(staticRoot, 'index.html'));
    let origin;
    const server = createServer(async (req, res) => {
      const nonce = randomBytes(18).toString('base64');
      const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'`,
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };
      for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
      const json = (code, payload) => { if (!res.destroyed && !res.writableEnded) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); } };
      try {
        if (req.headers.host !== new URL(origin).host || (req.headers.origin !== undefined && req.headers.origin !== origin)
          || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) throw new ControlError('Origen local no autorizado.', 403);
        const url = new URL(req.url, origin);
        if (url.origin !== origin) throw new ControlError('URL no autorizada.', 403);
        if (url.pathname === '/api/session' && req.method === 'GET') { json(200, { ok: true, schema: 1, token }); return; }
        if (url.pathname.startsWith('/api/')) {
          const supplied = req.headers['x-uvh-session'];
          if (typeof supplied !== 'string' || supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token)))
            throw new ControlError('Sesión local requerida.', 401);
          if (req.method === 'GET' && url.pathname === '/api/status') json(200, await status());
          else if (req.method === 'GET' && url.pathname === '/api/state') json(200, await state());
          else if (req.method === 'GET' && url.pathname === '/api/logs') json(200, await logs(url.searchParams.get('target')));
          else if (req.method === 'POST' && ['/api/op', '/api/confirm'].includes(url.pathname)) {
            const body = await readBody(req);
            if (url.pathname === '/api/confirm') json(200, confirm(body.mode, body.destination));
            else {
              if (Object.keys(body).some((key) => !['mode', 'requestId', 'confirmationId'].includes(key))) throw new ControlError('Campos no admitidos.', 400);
              json(202, { ok: true, operation: await admit(body.mode, body.requestId, body.confirmationId) });
            }
          } else json(404, { ok: false, error: 'Ruta o método no encontrado.' });
          return;
        }
        if (req.method !== 'GET') throw new ControlError('Método no permitido.', 405);
        const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).slice(1);
        if (!name || name.includes('\\') || name.includes('\0') || name.split('/').includes('..')) throw new ControlError('Ruta no encontrada.', 404);
        const full = realpathSync(join(staticRoot, name));
        const rel = relative(staticRoot, full);
        if (rel.startsWith('..') || isAbsolute(rel) || !MIME[extname(name)]) throw new ControlError('Ruta no encontrada.', 404);
        const info = regularFile(full);
        if (info.size > 10 * OUTPUT_LIMIT) throw new ControlError('Asset demasiado grande.');
        let data = readFileSync(full);
        if (name === 'index.html') data = Buffer.from(data.toString('utf8').replace('<app-root', `<app-root ngCspNonce="${nonce}"`));
        res.writeHead(200, { 'Content-Type': MIME[extname(name)], 'Content-Length': data.length }); res.end(data);
      } catch (error) { json(error.code === 'ENOENT' ? 404 : error.status ?? 500, { ok: false, error: redact(error.code === 'ENOENT' ? 'No encontrado.' : error.message) }); }
    });
    server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
    await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
    origin = `http://127.0.0.1:${server.address().port}`;
    if (open) openBrowser(`${origin}/`);
    return { server, origin };
  }
  return { root, status, logs, state, admit, confirm, serve, shutdown, database, bounded, execute, acquire, release, trackedFrontend };
}

async function readBody(req) {
  if ((req.headers['content-type'] ?? '').split(';')[0] !== 'application/json') throw new ControlError('Content-Type debe ser application/json.', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new ControlError('Cuerpo demasiado grande.', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object');
    return value;
  } catch { throw new ControlError('JSON no válido.', 400); }
}
function openBrowser(url) {
  const file = process.platform === 'darwin' ? '/usr/bin/open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
  child.once('error', () => process.stderr.write('No se pudo abrir el navegador automáticamente. Abre la URL indicada.\n')); child.unref();
}
async function frontendSupervisor(nonce, requestedRoot) {
  if (!/^[a-f0-9-]{36}$/.test(nonce ?? '')) throw new ControlError('Supervisor no válido.');
  const root = realpathSync(requestedRoot), runtime = join(root, '.uvh-runtime');
  const identity = await inspectProcess(process.pid);
  if (!identity) throw new ControlError('No se pudo registrar el supervisor.');
  const file = join(runtime, 'frontend.process.json');
  const fds = ['out', 'err'].map((kind) => {
    const path = join(runtime, `frontend.${kind}.log`); if (existsSync(path)) regularFile(path);
    return openSync(path, 'a', 0o600);
  });
  const cli = join(root, 'frontend/node_modules/@angular/cli/bin/ng.js');
  const child = spawn(process.execPath, [cli, 'serve', '--host', '127.0.0.1', '--port', '4200'],
    { cwd: join(root, 'frontend'), env: { ...process.env, PORT: '4200' }, detached: process.platform !== 'win32',
      stdio: ['ignore', ...fds], windowsHide: true });
  for (const fd of fds) closeSync(fd);
  await new Promise((yes, no) => { child.once('spawn', yes); child.once('error', no); });
  try { atomicJson(file, { schema: 1, pid: process.pid, startedAt: identity.birth, identity, root, nonce }); }
  catch (error) {
    if (process.platform === 'win32') child.kill();
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch (killError) { if (killError.code !== 'ESRCH') throw killError; } }
    throw error;
  }
  let stopping = false;
  const stopFile = join(runtime, `frontend-stop-${nonce}.json`);
  let windowsStopTask = Promise.resolve();
  function stop() {
    if (stopping) return; stopping = true;
    if (process.platform === 'win32') {
      windowsStopTask = (async () => {
        await runProcess('taskkill.exe', ['/PID', String(child.pid), '/T'], { timeoutMs: 2000 });
        if (child.exitCode === null) {
          await sleep(500);
          if (child.exitCode === null) await runProcess('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeoutMs: 3000 });
        }
      })();
      windowsStopTask.catch((error) => { process.stderr.write(`${safeText(error.message)}\n`); process.exitCode = 1; });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') process.exitCode = 1; }
      const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') process.exitCode = 1; } }, 1500);
      timer.unref(); child.once('close', () => clearTimeout(timer));
    }
  }
  const stopPoll = process.platform === 'win32' ? setInterval(() => {
    try { if (readJson(stopFile, 1024)?.nonce === nonce) stop(); }
    catch (error) { process.stderr.write(`${safeText(error.message)}\n`); }
  }, 150) : null;
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  await new Promise((yes) => child.once('close', yes));
  if (stopPoll) clearInterval(stopPoll);
  await windowsStopTask;
  if (existsSync(stopFile) && readJson(stopFile, 1024)?.nonce === nonce) unlinkSync(stopFile);
  if (process.platform !== 'win32') {
    const groupAlive = () => { try { process.kill(-child.pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
    const deadline = Date.now() + 3000;
    while (groupAlive() && Date.now() < deadline) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await sleep(50);
    }
    if (groupAlive()) throw new ControlError('Quedan hijos del frontend sin cierre verificable. Revisión manual necesaria.');
  }
  const saved = readJson(file, 16384); if (saved?.nonce === nonce) unlinkSync(file);
}
async function main() {
  const [mode = 'serve', ...rest] = process.argv.slice(2);
  if (mode === '--frontend-supervisor') { await frontendSupervisor(...rest); return; }
  if (['--help', '-h'].includes(mode)) {
    process.stdout.write('UVH Control\n  serve [--port N] [--no-browser]\n  status | start | stop | restart\n  migrate | repair-docker [--yes]\n  logs backend|frontend [--follow]\n'); return;
  }
  const controller = createController();
  if (mode === 'serve') {
    let port = 4580, open = true;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--port') port = Number(rest[++i]);
      else if (rest[i] === '--no-browser') open = false;
      else throw new ControlError('Opción no válida de serve.', 400);
    }
    if (port < 1) throw new ControlError('El puerto CLI debe estar entre 1 y 65535.', 400);
    const { server, origin } = await controller.serve({ port, open });
    process.stdout.write(`UVH · Control local en ${origin}/ (solo loopback)\n`);
    const close = async () => {
      try { await controller.shutdown(); server.close(); }
      catch (error) { process.stderr.write(`${error.message}\n`); }
    };
    process.on('SIGINT', close); process.on('SIGTERM', close); return;
  }
  if (mode === 'status') {
    if (rest.length) throw new ControlError('status no acepta opciones.', 400);
    process.stdout.write(`${(await controller.status()).text}\n`); return;
  }
  if (mode === 'logs') {
    const [target, flag] = rest;
    if (rest.length > 2 || (flag && flag !== '--follow')) throw new ControlError('Usa logs backend|frontend [--follow].', 400);
    let previous = null;
    do {
      const value = await controller.logs(target);
      if (value.text !== previous) process.stdout.write(`${value.text}\n`); previous = value.text;
      if (flag === '--follow') await sleep(2000);
    } while (flag === '--follow'); return;
  }
  if (!MODES.has(mode) || rest.some((arg) => arg !== '--yes') || (rest.length && !['migrate', 'repair-docker'].includes(mode))) throw new ControlError('Modo u opciones no válidos. Consulta --help.', 400);
  let confirmationId;
  if (['migrate', 'repair-docker'].includes(mode)) {
    if (!rest.includes('--yes')) {
      if (!process.stdin.isTTY) throw new ControlError('Operación sensible: usa una terminal interactiva o --yes explícito.', 400);
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await readline.question(`${mode} afecta al entorno local (base ${controller.database()}). Puede modificar datos o cerrar Docker. Escribe CONTINUAR: `);
        if (answer !== 'CONTINUAR') throw new ControlError('Operación cancelada.', 400);
      } finally { readline.close(); }
    }
    confirmationId = controller.confirm(mode, controller.database()).confirmationId;
  }
  const item = await controller.admit(mode, randomUUID(), confirmationId);
  while (item.status === 'running') await sleep(100);
  if (item.status !== 'succeeded') throw new ControlError(item.error ?? 'Operación pendiente de revisión.');
  process.stdout.write(`${item.output}\n`);
}  const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct || process.env.UVH_CONTROL_SEA === '1') main().catch((error) => {
  process.stderr.write(`${safeText(error.message)}\n`); process.exitCode = error.status === 400 ? 2 : 1;
});
