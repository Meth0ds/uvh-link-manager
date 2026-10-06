import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest, createServer as httpServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createController, runProcess, safeText, inspectProcess, probeEndpoint } from './uvh-control.mjs';
const roots = [], servers = [];
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise((yes) => server.close(yes)); }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(settings = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'uvh-control-test-'))); roots.push(root);
  for (const dir of ['.uvh-runtime', 'panel', 'frontend/node_modules/@angular/cli/bin', 'backend-laravel/database/migrations']) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, '.env.docker.local'), 'POSTGRES_DB=uvh_test\nPOSTGRES_USER=uvh_test\nPOSTGRES_PASSWORD=fixture-secret\n');
  writeFileSync(join(root, 'docker-compose.local.yml'), 'services: {}');
  writeFileSync(join(root, 'panel/index.html'), '<html><app-root></app-root></html>');
  writeFileSync(join(root, 'panel/main.js'), 'console.log("fixture")');
  writeFileSync(join(root, 'backend-laravel/database/migrations/001.php'), 'fixture');
  const calls = [];
  const run = async (file, args, opts) => {
    calls.push([file, args]);
    assert.equal(file, 'docker', `Unexpected external command: ${file}`);
    if (settings.delay && args.includes('stop')) await new Promise((yes, no) => {
      const timer = setTimeout(yes, settings.delay);
      opts.signal.addEventListener('abort', () => { clearTimeout(timer); no(opts.signal.reason); }, { once: true });
    });
    if (settings.failStop && args.includes('stop')) return { code: 1, output: 'simulated compose stop failure' };
    if (args[0] === 'info') return { code: 0, output: '99.fake' };
    if (args.includes('ps')) return { code: 0, output: JSON.stringify({ Service: 'postgres', State: 'running', Status: 'Up', Health: 'healthy' }) };
    if (args.includes('psql')) return { code: 0, output: '001' };
    return { code: 0, output: 'fixture command OK' };
  };
  const controller = createController({ root, panelDir: join(root, 'panel'), run, occupied: async () => true,
    probe: async (url) => ({ url, status: 'ok', httpStatus: 200, latencyMs: 12 }), ...settings });
  return { root, controller, calls };
}
async function done(controller, mode, confirmationId) {
  const item = await controller.admit(mode, randomUUID(), confirmationId);
  while (item.status === 'running') await new Promise((yes) => setTimeout(yes, 10));
  // Wait for release, not only result publication.
  for (let i = 0; i < 100 && (await controller.state()).operation; i++) await new Promise((yes) => setTimeout(yes, 10));
  return item;
}
async function http(settings = {}) {
  const value = fixture(settings), live = await value.controller.serve({ port: 0, open: false }); servers.push(live.server);
  const session = await (await fetch(`${live.origin}/api/session`)).json();
  const request = (path, options = {}) => fetch(`${live.origin}${path}`, { ...options,
    headers: { 'X-UVH-Session': session.token, 'Content-Type': 'application/json', ...options.headers } });
  return { ...value, ...live, request };
}
describe('isolated lifecycle and diagnostics', () => {
  it('failed stop is preserved; restart never starts after a failed stop', async () => {
    const { controller, calls } = fixture({ failStop: true });
    assert.equal((await done(controller, 'stop')).status, 'failed');
    assert.equal((await done(controller, 'restart')).status, 'failed');
    assert.equal(calls.filter(([, args]) => args.includes('up')).length, 0);
  });
  it('successful stop retains diagnostics and releases the lock', async () => {
    const { controller, root } = fixture(); const item = await done(controller, 'stop');
    assert.equal(item.status, 'succeeded'); assert.match(item.output, /Frontend ya detenido/);
    assert.equal(existsSync(join(root, '.uvh-runtime/control.lock')), false);
  });
  it('restart calls up once and refuses the occupied frontend without registering it', async () => {
    const { controller, calls, root } = fixture(); const item = await done(controller, 'restart');
    assert.equal(item.status, 'failed'); assert.match(item.error, /4200/);
    assert.equal(calls.filter(([, args]) => args.includes('up')).length, 1);
    assert.equal(existsSync(join(root, '.uvh-runtime/frontend.process.json')), false);
  });
  it('status is structured, migration-aware and read-only', async () => {
    const { controller, root } = fixture(); const status = await controller.status();
    assert.equal(status.schema, 1); assert.equal(status.services.length, 5);
    assert.equal(status.migrations.pending, 0); assert.equal(status.endpoints.backend.latencyMs, 12);
    rmSync(join(root, '.env.docker.local'));
    const other = createController({ root, run: async () => ({ code: 1, output: '' }), probe: async (url) => ({ url, status: 'unavailable', httpStatus: null, latencyMs: 1 }) });
    await other.status(); assert.equal(existsSync(join(root, '.env.docker.local')), false);
  });
  it('does not trust or delete legacy frontend identity', async () => {
    const { controller, root } = fixture(); const file = join(root, '.uvh-runtime/frontend.process.json');
    writeFileSync(file, JSON.stringify({ schema: 1, pid: process.pid, startedAt: new Date().toISOString(), root }));
    const before = readFileSync(file, 'utf8');
    await assert.rejects(controller.trackedFrontend(), /ambigua/);
    assert.equal(readFileSync(file, 'utf8'), before);
  });
  it('reused and dead PIDs never grant authority', async () => {
    const { controller, root } = fixture(); const identity = await inspectProcess(process.pid);
    writeFileSync(join(root, '.uvh-runtime/frontend.process.json'), JSON.stringify({ schema: 1, root, pid: process.pid, identity: { ...identity, birth: 'reused' }, nonce: randomUUID() }));
    assert.equal(await controller.trackedFrontend(), null);
    writeFileSync(join(root, '.uvh-runtime/frontend.process.json'), JSON.stringify({ schema: 1, root, pid: 99999999, identity, nonce: randomUUID() }));
    assert.equal(await controller.trackedFrontend(), null);
  });
});
describe('authority and operation recovery', () => {
  it('live lock blocks another controller; only nonce owner can release', async () => {
    const { controller, root } = fixture(); const lock = await controller.acquire('stop', randomUUID());
    const second = createController({ root });
    await assert.rejects(second.acquire('start', randomUUID()), /operación en curso/);
    await assert.rejects(controller.release({ ...lock, nonce: 'wrong' }), /propietario/);
    await controller.release(lock);
  });
  it('dead owner is recovered, while uncertain work remains blocked', async () => {
    const { controller, root } = fixture(); const file = join(root, '.uvh-runtime/control.lock');
    writeFileSync(file, JSON.stringify({ pid: 99999999, identity: { birth: 'dead' }, nonce: randomUUID() }));
    const lock = await controller.acquire('stop', randomUUID()); await controller.release(lock, true);
    await assert.rejects(controller.acquire('stop', randomUUID()), /revisión/);
  });
  it('separate CLI processes cannot mutate the same checkout concurrently', async () => {
    const { root } = fixture();
    const bin = join(root, 'fake-bin'); mkdirSync(bin);
    const docker = join(bin, 'docker');
    // The shell fixture never delegates to a real Docker installation.
    writeFileSync(docker, '#!/bin/sh\n/bin/sleep 0.4\necho fixture-stop\n', { mode: 0o755 });
    const cli = fileURLToPath(new URL('./uvh-control.mjs', import.meta.url));
    const env = { ...process.env, UVH_CONTROL_ROOT: root, PATH: `${bin}:/usr/bin:/bin` };
    const first = spawn(process.execPath, [cli, 'stop'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const exit = new Promise((yes) => first.once('exit', yes));
    try {
      for (let i = 0; i < 100 && !existsSync(join(root, '.uvh-runtime/control.lock')); i++) await new Promise((yes) => setTimeout(yes, 10));
      assert.ok(existsSync(join(root, '.uvh-runtime/control.lock')));
      const second = spawnSync(process.execPath, [cli, 'stop'], { env, encoding: 'utf8', timeout: 5000 });
      assert.equal(second.status, 1); assert.match(second.stderr, /operación en curso/);
      assert.equal(await exit, 0);
    } finally { first.kill('SIGTERM'); }
  });
  it('long-lived controller records OS birth instead of operation time', async () => {
    const { controller } = fixture(); const identity = await inspectProcess(process.pid);
    await new Promise((yes) => setTimeout(yes, 30)); const lock = await controller.acquire('stop', randomUUID());
    assert.deepEqual(lock.identity, identity); await controller.release(lock);
  });
  it('one request id never executes a second mutation', async () => {
    const { controller, calls } = fixture(); const requestId = randomUUID();
    const a = await controller.admit('stop', requestId), b = await controller.admit('stop', requestId);
    assert.equal(a.id, b.id);
    while (a.status === 'running') await new Promise((yes) => setTimeout(yes, 10));
    assert.equal(calls.filter(([, args]) => args.includes('stop')).length, 1);
    await assert.rejects(controller.admit('start', requestId), /otra operación/);
  });
  it('confirmation is bound to mode and destination and consumed once', async () => {
    const { controller } = fixture(); await assert.rejects(controller.admit('migrate', randomUUID()), /Confirmación/);
    assert.throws(() => controller.confirm('migrate', 'production'), /destino/);
    const ticket = controller.confirm('migrate', controller.database());
    const item = await done(controller, 'migrate', ticket.confirmationId); assert.equal(item.status, 'succeeded');
    await assert.rejects(controller.admit('migrate', randomUUID(), ticket.confirmationId), /Confirmación/);
  });
  it('timeout aborts work before releasing the lock', async () => {
    const { controller, root } = fixture({ delay: 5000, limits: { stop: 30 } });
    const item = await done(controller, 'stop'); assert.equal(item.status, 'timedOut');
    assert.equal(existsSync(join(root, '.uvh-runtime/control.lock')), false);
  });
  it('confirmation expires and destination changes invalidate authority', async () => {
    const { controller, root } = fixture();
    const ticket = controller.confirm('migrate', controller.database());
    writeFileSync(join(root, '.env.docker.local'), 'POSTGRES_DB=another_database\n');
    await assert.rejects(controller.admit('migrate', randomUUID(), ticket.confirmationId), /destino cambiado/);
  });
  it('a state poll does not detach the mutable operation from persisted history', async () => {
    const { controller } = fixture({ delay: 100 });
    const item = await controller.admit('stop', randomUUID());
    await controller.state(); await controller.state();
    while (item.status === 'running') await new Promise((yes) => setTimeout(yes, 10));
    const result = await controller.state();
    assert.equal(result.recentOperations[0].status, 'succeeded');
  });
  it('interrupted persisted operation becomes unknown, not failed or retried', async () => {
    const { controller, root } = fixture(); const item = { id: randomUUID(), requestId: randomUUID(), mode: 'stop', status: 'running' };
    writeFileSync(join(root, '.uvh-runtime/operations.json'), JSON.stringify([item]));
    assert.equal((await controller.state()).recentOperations[0].status, 'unknown');
    assert.equal((await controller.admit('stop', item.requestId)).status, 'unknown');
  });
});
describe('real HTTP security boundary', () => {
  it('requires session, blocks hostile Host and Origin, and sets security headers', async () => {
    const { origin, request } = await http();
    assert.equal((await fetch(`${origin}/api/state`)).status, 401);
    assert.equal((await request('/api/state', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const hostileHost = await new Promise((yes, no) => { const req = httpRequest(`${origin}/api/session`, { headers: { Host: 'evil.example' } }, (res) => { res.resume(); yes(res.statusCode); }); req.on('error', no); req.end(); });
    assert.equal(hostileHost, 403);
    assert.equal((await request('/api/session', { headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
    const page = await request('/'); assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(await page.text(), /ngCspNonce=/);
  });
  it('checks body, method, operation and confirmation before invoking commands', async () => {
    const { request, calls } = await http();
    assert.equal((await request('/api/op', { method: 'POST', body: '{}' })).status, 400);
    assert.equal((await request('/api/op', { method: 'POST', body: '{bad' })).status, 400);
    assert.equal((await request('/api/op', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await request('/api/op', { method: 'POST', body: JSON.stringify({ mode: 'migrate', requestId: randomUUID() }) })).status, 403);
    assert.equal(calls.length, 0);
    assert.equal((await request('/api/logs?target=other')).status, 400);
    assert.equal((await request('/api/state', { method: 'DELETE' })).status, 404);
    assert.equal((await request('/missing')).status, 404);
  });
  it('returns 202 promptly, responds during a mutation and rejects concurrency with 409', async () => {
    const { request } = await http({ delay: 300 });
    const start = performance.now();
    const response = await request('/api/op', { method: 'POST', body: JSON.stringify({ mode: 'stop', requestId: randomUUID() }) });
    assert.equal(response.status, 202); assert.ok(performance.now() - start < 250);
    assert.equal((await request('/api/state')).status, 200);
    assert.equal((await request('/api/op', { method: 'POST', body: JSON.stringify({ mode: 'start', requestId: randomUUID() }) })).status, 409);
    await new Promise((yes) => setTimeout(yes, 350));
  });
  it('rejects oversized bodies and arbitrary fields', async () => {
    const { request, calls } = await http();
    assert.equal((await request('/api/op', { method: 'POST', body: JSON.stringify({ mode: 'stop', requestId: randomUUID(), command: 'rm' }) })).status, 400);
    assert.equal((await request('/api/op', { method: 'POST', body: JSON.stringify({ mode: 'stop', padding: 'x'.repeat(5000) }) })).status, 413);
    assert.equal(calls.length, 0);
  });
  it('cannot follow static symlinks out of its asset root', async () => {
    const { request, root } = await http();
    writeFileSync(join(root, 'secret.txt'), 'never serve me');
    symlinkSync(join(root, 'secret.txt'), join(root, 'panel/leak.txt'));
    assert.equal((await request('/leak.txt')).status, 404);
    assert.equal((await request('/%2e%2e%2fsecret.txt')).status, 404);
  });
});
describe('real process and text adapters', () => {
  it('caps captured output and redacts credential patterns and known values', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(2*1024*1024))']);
    assert.match(result.output, /Salida truncada/); assert.ok(result.output.length <= 1024 * 1024 + 100);
    assert.equal(safeText('PASSWORD=abc Authorization: Bearer xyz secretvalue', ['secretvalue']), 'PASSWORD=[REDACTADO] Authorization: [REDACTADO] [REDACTADO] [REDACTADO]');
  });
  it('aborts a real child and waits for close', async () => {
    const abort = new AbortController();
    const pending = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: abort.signal });
    setTimeout(() => abort.abort(new Error('test abort')), 50);
    await assert.rejects(pending, /test abort/);
  });
  it('supervises a real fake Angular process and shuts down only its own child', async () => {
    const { controller, root } = fixture();
    const cli = fileURLToPath(new URL('./uvh-control.mjs', import.meta.url));
    const pidFile = join(root, 'fake-angular.pid');
    writeFileSync(join(root, 'frontend/node_modules/@angular/cli/bin/ng.js'), `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));setInterval(()=>{},1000);`);
    const supervisor = spawn(process.execPath, [cli, '--frontend-supervisor', randomUUID(), root], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      for (let i = 0; i < 100 && !(await controller.trackedFrontend()); i++) await new Promise((yes) => setTimeout(yes, 30));
      assert.ok(await controller.trackedFrontend());
      for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise((yes) => setTimeout(yes, 30));
      assert.ok(existsSync(pidFile));
      const angularPid = Number(readFileSync(pidFile));
      const item = await done(controller, 'stop'); assert.equal(item.status, 'succeeded');
      assert.equal(existsSync(join(root, '.uvh-runtime/frontend.process.json')), false);
      assert.throws(() => process.kill(angularPid, 0), { code: 'ESRCH' });
    } finally { supervisor.kill('SIGTERM'); }
  });
  it('CLI sensitive operations fail closed without interactive consent', () => {
    const { root } = fixture();
    const cli = fileURLToPath(new URL('./uvh-control.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [cli, 'migrate'], { env: { ...process.env, UVH_CONTROL_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 2); assert.match(result.stderr, /--yes/);
  });
  it('measures slow success separately from HTTP and network failure', async () => {
    const server = httpServer((req, res) => {
      if (req.url === '/slow') setTimeout(() => { res.end('OK'); }, 3050);
      else if (req.url === '/redirect') { res.writeHead(302, { Location: '/slow' }); res.end(); }
      else { res.writeHead(503); res.end(); }
    });
    await new Promise((yes) => server.listen(0, '127.0.0.1', yes)); servers.push(server);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const slow = await probeEndpoint(`${origin}/slow`); assert.equal(slow.status, 'slow'); assert.ok(slow.latencyMs >= 3000); assert.equal(slow.httpStatus, 200);
    assert.equal((await probeEndpoint(`${origin}/error`)).status, 'error');
    assert.equal((await probeEndpoint(`${origin}/redirect`)).status, 'unavailable');
  });
  it('health does not turn redirects or network errors into success', async () => {
    const endpoint = await probeEndpoint('http://127.0.0.1:1/');
    assert.equal(endpoint.status, 'unavailable'); assert.equal(endpoint.httpStatus, null);
  });
});
