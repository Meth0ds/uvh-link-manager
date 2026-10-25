import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore, directory, envelope, unwrap, atomic, hash } from './store.mjs';
import { createRecoveryAuth } from './auth.mjs';
import { createRecoveryEngine } from './engine.mjs';
import { createGithub } from './github.mjs';
import { serveRecoveryGateway, drainBridge } from './gateway.mjs';
import { copyToFolder, copyToS3 } from './destinations.mjs';
import { createKeyProvider } from './key-provider.mjs';
import { planRetention } from './backup-catalog.mjs';
import { COMPONENTS, createManifest, validateManifest } from './backup-format.mjs';
const roots = [], servers = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
function root() { const path = realpathSync(mkdtempSync(join(tmpdir(), 'uvh-recovery-test-'))); roots.push(path); return path; }
const SHA = 'a'.repeat(40), NEXT = 'b'.repeat(40), KEY = 'c'.repeat(64);
function authFixture() {
  const store = createStore(root()); let time = Date.now();
  const auth = createRecoveryAuth(store, KEY, () => time);
  const ticket = () => Buffer.from(JSON.stringify(envelope(KEY, { purpose: 'recovery-access', id: randomUUID(), actor: 1, expires: time + 60000 }))).toString('base64url');
  return { auth, store, ticket, advance: ms => { time += ms; } };
}
test('signed envelopes reject forged and malformed messages', () => {
  const signed = envelope(KEY, { maintenance: true }); assert.equal(unwrap(KEY, signed).maintenance, true);
  assert.throws(() => unwrap(KEY, { ...signed, body: '{"maintenance":false}' }), /autorizado/);
  assert.throws(() => unwrap(KEY, {}), /autorizado/);
});
test('key provider keeps a permission-checked fallback when no native store exists', () => {
  const path = join(root(), 'key'); const provider = createKeyProvider({ path, platform: 'unsupported', service: 'test', account: 'test' }); const first = provider.get(); const second = createKeyProvider({ path, platform: 'unsupported', service: 'test', account: 'test' }).get();
  assert.match(first, /^[a-f0-9]{64}$/); assert.equal(second, first); assert.equal(provider.backend, 'file');
});
test('backup catalog retention never removes the only verified recovery', () => {
  const entries = [1, 2, 3].map((value, index) => ({ id: String(value), tag: 'daily', createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), restoredAt: index === 0 ? null : new Date().toISOString(), protected: false }));
  const plan = planRetention(entries, { dailyRetention: 1, weeklyRetention: 1, updateRetention: 1 });
  assert.ok(plan.keep.some(entry => entry.id === '3')); assert.ok(plan.keep.some(entry => entry.id === '1')); assert.ok(!plan.remove.some(entry => entry.id === '1'));
  const failed = [...entries, { id: '4', tag: 'daily', createdAt: new Date(Date.UTC(2026, 0, 4)).toISOString(), restoredAt: null, protected: false }];
  const failedPlan = planRetention(failed, { dailyRetention: 1, weeklyRetention: 1, updateRetention: 1 });
  assert.ok(failedPlan.keep.some(entry => entry.id === '4')); assert.ok(failedPlan.remove.some(entry => entry.id === '1'));
});
test('canonical backup manifest detects component tampering and supports its version', async () => {
  const folder = root(); for (const name of COMPONENTS) writeFileSync(join(folder, name), name); const release = { schema: 1, sha: SHA };
  const manifest = await createManifest(folder, release); assert.equal(manifest.schema, 2); assert.equal((await validateManifest(folder)).sourceSha, SHA);
  writeFileSync(join(folder, 'database.dump'), 'tampered'); await assert.rejects(() => validateManifest(folder), /coincide/);
});
test('a missing modern backup component never downgrades the manifest to legacy', async () => {
  const folder = root();
  for (const name of COMPONENTS) writeFileSync(join(folder, name), name);
  await createManifest(folder, { schema: 1, sha: SHA });
  rmSync(join(folder, 'database.dump'));
  await assert.rejects(() => validateManifest(folder));
  rmSync(join(folder, 'manifest.json'));
  assert.equal((await validateManifest(folder)).legacy, true);
});
test('private directories reject symlinks', () => {
  const path = root(); directory(join(path, 'real')); symlinkSync(join(path, 'real'), join(path, 'link'));
  assert.throws(() => directory(join(path, 'link')), /seguro/);
});
test('admin tickets are authenticated, short lived and consumed durably', () => {
  const f = authFixture(), ticket = f.ticket(); const session = f.auth.login({ ticket }); assert.equal(session.emergency, false);
  assert.throws(() => f.auth.login({ ticket }), /Credencial/);
  const restarted = createRecoveryAuth(f.store, KEY); assert.throws(() => restarted.login({ ticket }), /Credencial/);
  const expired = f.ticket(); f.advance(60001); assert.throws(() => f.auth.login({ ticket: expired }), /Credencial/);
});
test('emergency codes work once even after restarting and cannot enroll codes', () => {
  const f = authFixture(), session = f.auth.login({ ticket: f.ticket() });
  const codes = f.auth.enroll(session.token); assert.equal(codes.length, 8);
  assert.ok(!readFileSync(join(f.store.path, 'credentials.json'), 'utf8').includes(codes[0]));
  const access = f.auth.login({ code: codes[0] }); assert.equal(access.emergency, true);
  assert.throws(() => f.auth.enroll(access.token), /Administración/);
  const restarted = createRecoveryAuth(f.store, KEY); assert.throws(() => restarted.login({ code: codes[0] }), /Credencial/);
  assert.ok(restarted.login({ code: codes[1] }).token);
});
test('failed login rate limit survives restart and expires', () => {
  const f = authFixture(); for (let i = 0; i < 5; i++) assert.throws(() => f.auth.login({ code: 'bad' }));
  assert.throws(() => f.auth.login({ ticket: f.ticket() }), /intentos/);
  const restarted = createRecoveryAuth(f.store, KEY); assert.throws(() => restarted.login({ code: 'bad' }), /intentos/);
  f.advance(15 * 60000 + 1); assert.ok(f.auth.login({ ticket: f.ticket() }).token);
});
test('confirmation is bound to session, action and target and only works once', () => {
  const f = authFixture(), a = f.auth.login({ ticket: f.ticket() }), b = f.auth.login({ ticket: f.ticket() });
  let id = f.auth.confirm(a.token, 'restore', { id: 'one' }); assert.throws(() => f.auth.consume(b.token, 'restore', { id: 'one' }, id));
  id = f.auth.confirm(a.token, 'restore', { id: 'one' }); assert.throws(() => f.auth.consume(a.token, 'restore', { id: 'two' }, id));
  id = f.auth.confirm(a.token, 'restore', { id: 'one' }); assert.equal(f.auth.consume(a.token, 'restore', { id: 'one' }, id).actor, '1');
  assert.throws(() => f.auth.consume(a.token, 'restore', { id: 'one' }, id));
});
test('emergency sessions cannot install or change backup policy', () => {
  const f = authFixture(), admin = f.auth.login({ ticket: f.ticket() }), code = f.auth.enroll(admin.token)[0], access = f.auth.login({ code });
  for (const action of ['install', 'policy', 'delete']) { const id = f.auth.confirm(access.token, action, {}); assert.throws(() => f.auth.consume(access.token, action, {}, id), /emergencia/); }
});
test('admin reconciliation revokes emergency credentials and live sessions', () => {
  const f = authFixture(), admin = f.auth.login({ ticket: f.ticket() }), codes = f.auth.enroll(admin.token), access = f.auth.login({ code: codes[0] });
  f.auth.reconcile([]); assert.throws(() => f.auth.session(access.token), /sesión/); assert.throws(() => f.auth.login({ code: codes[1] }), /Credencial/);
});
function fixture(overrides = {}) {
  const path = root(), home = directory(join(path, '.uvh-runtime/recovery')), calls = [];
  let current = SHA, healthy = true, held = false;
  const io = Object.fromEntries(['clean', 'prepare', 'quiesce', 'backup', 'verify', 'start', 'health', 'reopen'].map(name => [name, async (...args) => { calls.push(name); await overrides[name]?.(...args); }]));
  Object.assign(io, { head: async () => current, preflight: async to => { calls.push('preflight'); return { from: current, to }; },
    encrypt: async (folder, dest) => { writeFileSync(dest, 'encrypted fixture'); return { iv: '00', tag: '00', digest: hash('encrypted fixture'), bytes: 17 }; },
    unpack: async (entry, source) => { calls.push('unpack'); if (readFileSync(source, 'utf8') !== 'encrypted fixture') throw Error('corrupt'); },
    restore: async (folder, expected) => { calls.push('restore'); assert.equal(current, expected); await overrides.restore?.(); current = SHA; },
    restoreSelective: async (folder, paths) => { calls.push('restoreSelective'); assert.ok(paths.length > 0); },
    apply: async to => { calls.push('apply'); current = to; await overrides.apply?.(); },
    diagnose: async () => ({ sha: current, healthy, services: [] }), admins: async () => ['1'] });
  const exclusive = { acquire: async () => { if (held) throw Error('busy'); held = true; return {}; }, release: async () => { held = false; } };
  const github = { check: async () => { calls.push('github'); await overrides.github?.(); return { from: current, sha: NEXT, eligible: true, checks: [], commits: [], checkedAt: new Date().toISOString(), stale: false }; } };
  const engine = createRecoveryEngine({ root: path, home, io, exclusive, github, ...overrides.engine }); engine.enable();
  const ticket = Buffer.from(JSON.stringify(envelope(engine.bridgeKey, { purpose: 'recovery-access', id: randomUUID(), actor: 1, expires: Date.now() + 59000 }))).toString('base64url');
  const session = engine.auth.login({ ticket }); engine.enrol(session.token);
  return { engine, home, path, calls, io, exclusive, github, setHealthy: value => { healthy = value; } };
}
async function run(engine, action, target = {}, id = randomUUID()) { const item = await engine.admit(action, target, id, { actor: '1', emergency: false }); await engine.idle(); return engine.snapshot().operation; }

test('external folder destination is atomic and S3 destination verifies the signed request', async () => {
  const path = root(), source = join(path, 'copy.enc'), folder = join(path, 'external'); writeFileSync(source, 'backup-payload');
  const local = await copyToFolder(source, folder, randomUUID()); assert.equal(local.bytes, 14); assert.equal(readFileSync(join(folder, local.key), 'utf8'), 'backup-payload');
  let request; const remote = await copyToS3(source, { endpoint: 'https://objects.example.test', bucket: 'uvh', region: 'eu-west-1', prefix: 'backups', accessKey: 'access', secretKey: 'secret' }, randomUUID(), async (url, options) => { if (options.method === 'PUT') request = { url, options }; return new Response(options.method === 'GET' ? 'backup-payload' : '', { status: 200 }); });
  assert.equal(remote.bytes, 14); assert.match(request.options.headers.Authorization, /^AWS4-HMAC-SHA256/); assert.match(request.url, /objects\.example\.test\/uvh\/backups\//);
  await assert.rejects(() => copyToS3(source, { endpoint: 'http://objects.example.test', bucket: 'uvh', region: 'eu-west-1', accessKey: 'access', secretKey: 'secret' }, randomUUID(), async () => new Response('', { status: 200 })), /HTTPS/);
});

test('streamed folder copy removes its temporary file after an integrity mismatch', async () => {
  const path = root(), source = join(path, 'copy.enc'), folder = join(path, 'external'), id = randomUUID();
  writeFileSync(source, 'backup-payload');
  await assert.rejects(() => copyToFolder(source, folder, id, { digest: '0'.repeat(64) }), { code: 'destination_integrity' });
  assert.equal(existsSync(join(folder, `${id}.uvh.enc.uploading`)), false);
  assert.equal(existsSync(join(folder, `${id}.uvh.enc`)), false);
});
test('large external copies use multipart transfer with a final completion request', async () => {
  const path = root(), source = join(path, 'large.enc'), statePath = join(path, 'multipart', 'state.json'); writeFileSync(source, 'multipart-payload'); const calls = [];
  const result = await copyToS3(source, { endpoint: 'https://objects.example.test', bucket: 'uvh', region: 'eu-west-1', accessKey: 'access', secretKey: 'secret', multipartThreshold: 1 }, randomUUID(), async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST' && url.includes('uploads=')) return new Response('<UploadId>upload-1</UploadId>', { status: 200 });
    if (options.method === 'PUT') return new Response('', { status: 200, headers: { etag: '"part-1"' } });
    return new Response(options.method === 'GET' ? 'multipart-payload' : '<CompleteMultipartUploadResult/>', { status: 200 });
  }, { statePath });
  assert.equal(result.multipart, true); assert.equal(result.parts, 1); assert.equal(calls.filter(item => item.options.method === 'PUT').length, 1); assert.ok(calls.some(item => item.options.method === 'POST' && item.url.includes('uploadId='))); assert.equal(existsSync(statePath), false);
});
test('destination secrets never appear in operation snapshots or idempotency responses', async () => {
  const f = fixture(), target = { name: 'remote', type: 's3', endpoint: 'https://objects.example.test', bucket: 'uvh', region: 'eu-west-1', accessKey: 'access-secret', secretKey: 'payload-secret', prefix: 'backups' };
  const op = await run(f.engine, 'destination', target);
  assert.equal(op.target.secretKey, '[redacted]');
  assert.equal(op.target.accessKey, '[redacted]');
  assert.ok(!JSON.stringify(f.engine.snapshot()).includes('payload-secret'));
  const replay = await f.engine.admit('destination', target, op.requestId);
  assert.equal(replay.target.secretKey, '[redacted]');
});
test('backup quiesces all writers before snapshot and restores only after verification', async () => {
  const f = fixture(); const op = await run(f.engine, 'backup'); assert.equal(op.state, 'completed');
  const calls = f.calls; assert.ok(calls.indexOf('quiesce') < calls.indexOf('backup')); assert.ok(calls.indexOf('verify') < calls.indexOf('reopen'));
  assert.equal(f.engine.snapshot().backups.length, 1); assert.ok(f.engine.snapshot().backups[0].restoredAt); assert.equal(f.engine.blocking(), false);
});
test('daily and weekly backup categories survive encryption, publication and retention', async () => {
  const f = fixture();
  await run(f.engine, 'policy', { daily: true, dailyRetention: 1, weeklyRetention: 1, updateRetention: 1 });
  await run(f.engine, 'backup', { tag: 'daily' });
  await run(f.engine, 'backup', { tag: 'daily' });
  await run(f.engine, 'backup', { tag: 'weekly' });
  await run(f.engine, 'backup', { tag: 'weekly' });
  const copies = f.engine.snapshot().backups;
  assert.equal(copies.filter(entry => entry.tag === 'daily').length, 1);
  assert.equal(copies.filter(entry => entry.tag === 'weekly').length, 1);
  const catalog = unwrap(readFileSync(join(f.home, 'metadata-key'), 'utf8'), JSON.parse(readFileSync(join(f.home, 'backups.json'), 'utf8')));
  assert.ok(catalog.every(entry => entry.tag === '00'));
  assert.ok(catalog.every(entry => ['daily', 'weekly'].includes(entry.category)));
});
test('backup verification failure preserves maintenance and cannot produce an eligible backup', async () => {
  const f = fixture({ verify: async () => { throw Error('restore failed'); } }); const op = await run(f.engine, 'backup');
  assert.equal(op.state, 'requires_intervention'); assert.equal(f.engine.snapshot().backups[0].restoredAt, null); assert.ok(!f.calls.includes('reopen'));
});
test('backup creation failure keeps maintenance active and never reopens a partially protected service', async () => {
  const f = fixture({ backup: async () => { throw Error('database dump failed'); } }); const op = await run(f.engine, 'backup');
  assert.equal(op.state, 'requires_intervention'); assert.equal(f.engine.blocking(), true); assert.equal(f.engine.snapshot().backups.length, 0); assert.equal(readdirSync(join(f.home, 'backups')).length, 0); assert.ok(!f.calls.includes('reopen'));
});
test('install cannot start without a completed restoration drill', async () => {
  const f = fixture(); const op = await run(f.engine, 'install', { sha: NEXT }); assert.equal(op.state, 'failed'); assert.equal(op.error.code, 'restore_drill_required'); assert.ok(!f.calls.includes('apply'));
});
test('preparation failure leaves the healthy application open and never applies code', async () => {
  const f = fixture({ prepare: async () => { throw Error('download failed'); } }); await run(f.engine, 'backup');
  const op = await run(f.engine, 'install', { sha: NEXT }); assert.equal(op.state, 'failed'); assert.equal(f.engine.blocking(), false); assert.ok(!f.calls.includes('apply'));
});
test('quiesce failure blocks the application and prevents an unprotected install', async () => {
  let count = 0; const f = fixture({ quiesce: async () => { if (++count > 1) throw Error('writer did not stop'); } }); await run(f.engine, 'backup');
  const op = await run(f.engine, 'install', { sha: NEXT }); assert.equal(op.state, 'requires_intervention'); assert.equal(f.engine.blocking(), true); assert.ok(!f.calls.includes('apply'));
});
test('successful install creates and checks pre-update backup before applying code', async () => {
  const f = fixture(); await run(f.engine, 'backup'); f.calls.length = 0;
  const op = await run(f.engine, 'install', { sha: NEXT }); assert.equal(op.state, 'completed'); assert.ok(f.calls.indexOf('verify') < f.calls.indexOf('apply')); assert.equal(f.engine.blocking(), false);
});
test('failed update performs exactly one automatic recovery before reopening', async () => {
  const f = fixture({ apply: async () => { throw Error('migration failed'); } }); await run(f.engine, 'backup');
  const op = await run(f.engine, 'install', { sha: NEXT }); assert.equal(op.state, 'restored'); assert.equal(op.recoveryAttempted, true); assert.equal(f.calls.filter(name => name === 'restore').length, 1); assert.equal(f.engine.blocking(), false);
});
test('failed automatic recovery stays closed and never loops', async () => {
  const f = fixture({ apply: async () => { throw Error('apply failed'); }, restore: async () => { throw Error('restore failed'); } }); await run(f.engine, 'backup');
  const op = await run(f.engine, 'install', { sha: NEXT }); assert.equal(op.state, 'requires_intervention'); assert.equal(f.engine.blocking(), true); assert.equal(f.calls.filter(name => name === 'restore').length, 1);
});
test('failure while reopening after apply attempts one recovery and remains closed if validation still fails', async () => {
  let applied = false; const f = fixture({ apply: async () => { applied = true; }, reopen: async () => { if (applied) throw Error('health failed after restart'); } }); await run(f.engine, 'backup');
  const op = await run(f.engine, 'install', { sha: NEXT }); assert.equal(op.state, 'requires_intervention'); assert.equal(op.recoveryAttempted, true); assert.equal(f.calls.filter(name => name === 'restore').length, 1); assert.equal(f.engine.blocking(), true);
});
test('manual restore refuses to destroy the current state when its preventive backup fails', async () => {
  let backups = 0; const f = fixture({ backup: async () => { if (++backups > 1) throw Error('disk full'); } }); await run(f.engine, 'backup'); const entry = f.engine.snapshot().backups[0];
  const op = await run(f.engine, 'restore', { id: entry.id }); assert.equal(op.state, 'requires_intervention'); assert.equal(op.error.code, 'preventive_backup_failed'); assert.ok(!f.calls.includes('restore')); assert.equal(f.engine.blocking(), true);
});
test('selective restore only accepts relative private file paths', async () => {
  const f = fixture(); await run(f.engine, 'backup'); const entry = f.engine.snapshot().backups[0];
  const op = await run(f.engine, 'restore-selective', { id: entry.id, paths: ['documents/report.pdf'] }); assert.equal(op.state, 'completed'); assert.ok(f.calls.includes('restoreSelective'));
  const rejected = await run(f.engine, 'restore-selective', { id: entry.id, paths: ['../outside'] }); assert.equal(rejected.state, 'failed'); assert.equal(rejected.error.code, 'invalid_restore_paths');
});
test('a restored operation is not repeated when the response is lost', async () => {
  const f = fixture(), id = randomUUID(); await run(f.engine, 'backup', {}, id); const count = f.calls.length;
  const replay = await f.engine.admit('backup', {}, id); assert.equal(replay.state, 'completed'); assert.equal(f.calls.length, count);
  await assert.rejects(() => f.engine.admit('check', {}, id), /otra orden/);
});
test('shared operation lock prevents overlap and action target is strict', async () => {
  let resolve; const wait = new Promise(yes => { resolve = yes; }); const f = fixture({ backup: async () => wait });
  await f.engine.admit('backup', {}, randomUUID()); await assert.rejects(() => f.engine.admit('backup', {}, randomUUID()), /activa/);
  assert.throws(() => f.engine.validate('install', { sha: NEXT, command: 'rm' }), /Campos/); resolve(); await f.engine.idle();
});
test('restart turns in-flight operations into intervention and never resumes mutations', () => {
  const f = fixture(); f.engine.store.write('state', { schema: 1, maintenance: false, reason: null, history: [], operation: { state: 'running', events: [] } });
  const restarted = createRecoveryEngine({ root: f.path, home: f.home, io: f.io, exclusive: f.exclusive, github: f.github });
  assert.equal(restarted.snapshot().operation.state, 'requires_intervention'); assert.equal(restarted.blocking(), true); assert.equal(f.calls.length, 0);
});
test('a corrupt backup is rejected before restoration writes', async () => {
  const f = fixture(); await run(f.engine, 'backup'); const entry = f.engine.snapshot().backups[0]; writeFileSync(join(f.home, 'backups', entry.id + '.uvh.enc'), 'corrupt');
  const op = await run(f.engine, 'restore', { id: entry.id }); assert.equal(op.state, 'failed'); assert.ok(!f.calls.includes('restore'));
});
test('a single timeout does not trigger maintenance and GitHub failure is separate', async () => {
  let clock = Date.now(); const f = fixture({ github: async () => { throw Error('offline'); }, engine: { clock: () => clock } });
  f.setHealthy(false); await f.engine.tick(); assert.equal(f.engine.blocking(), false);
  clock += 30001; await f.engine.tick(); assert.equal(f.engine.blocking(), false);
  clock += 30001; await f.engine.tick(); assert.equal(f.engine.blocking(), true);
});
test('public gateway survives missing frontend and keeps APIs JSON during maintenance', async () => {
  const f = fixture(); f.engine.store.write('state', { schema: 1, maintenance: true, reason: 'incident', since: new Date().toISOString(), history: [], operation: null });
  const engine = createRecoveryEngine({ root: f.path, home: f.home, io: f.io, exclusive: f.exclusive, github: f.github });
  const gateway = await serveRecoveryGateway({ engine, port: 0, upstreamPort: 1 }); servers.push(gateway);
  const origin = `http://127.0.0.1:${gateway.server.address().port}`;
  const page = await fetch(origin + '/es/app'); assert.equal(page.status, 503); assert.ok((await page.text()).includes('Estamos preparando')); assert.equal(page.headers.get('retry-after'), '30');
  const api = await fetch(origin + '/api/v1/users'); assert.equal(api.status, 503); assert.equal((await api.json()).reason, 'local_maintenance');
  assert.equal((await fetch(origin + '/__uvh/admin')).status, 200); assert.equal((await fetch(origin + '/__uvh/api/state')).status, 401);
  const publicData = await (await fetch(origin + '/__uvh/status')).json(); assert.ok(!JSON.stringify(publicData).includes(f.path)); assert.equal(publicData.operation, undefined);
});
test('gateway rejects cross-origin login, generic local tokens, and authenticates emergency access', async () => {
  const f = fixture(); const ticket = Buffer.from(JSON.stringify(envelope(f.engine.bridgeKey, { purpose: 'recovery-access', id: randomUUID(), actor: 1, expires: Date.now() + 59000 }))).toString('base64url');
  const normal = f.engine.auth.login({ ticket }), code = f.engine.enrol(normal.token)[0];
  const gateway = await serveRecoveryGateway({ engine: f.engine, port: 0, upstreamPort: 1 }); servers.push(gateway); const origin = `http://127.0.0.1:${gateway.server.address().port}`;
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ code }) };
  assert.equal((await fetch(origin + '/__uvh/api/login', { ...options, headers: { ...options.headers, Origin: 'http://evil.test' } })).status, 403);
  const login = await (await fetch(origin + '/__uvh/api/login', options)).json(); assert.ok(login.token);
  assert.equal((await fetch(origin + '/__uvh/api/state', { headers: { 'X-UVH-Session': login.token } })).status, 401);
  assert.equal((await fetch(origin + '/__uvh/api/state', { headers: { 'X-UVH-Recovery': login.token } })).status, 200);
});
test('bridge rejects forged commands without calling the operation engine', async () => {
  const f = fixture(); directory(join(f.engine.bridge, 'requests')); directory(join(f.engine.bridge, 'responses')); const id = randomUUID();
  atomic(join(f.engine.bridge, 'requests', id + '.json'), { body: '{}', mac: 'bad' }); await drainBridge(f.engine);
  assert.equal(f.calls.length, 0); assert.ok(existsSync(join(f.engine.bridge, 'responses', id + '.json')));
});
function response(value, status = 200, headers = {}) { return new Response(JSON.stringify(value), { status, headers }); }
test('GitHub gates are tied to source SHA, event, repository and nonempty successful jobs', async () => {
  const urls = [];
  const client = createGithub({ fetcher: async url => {
    urls.push(url); if (url.endsWith('/commits/main')) return response({ sha: NEXT });
    if (url.includes('/jobs?')) return response({ total_count: 1, jobs: [{ status: 'completed', conclusion: 'success', steps: [{}] }] });
    if (url.includes('/compare/')) return response({ status: 'ahead', total_commits: 1, commits: [{ sha: NEXT, commit: { message: '<script>unsafe</script>' } }] });
    const file = url.split('/workflows/')[1].split('/')[0]; return response({ workflow_runs: [{ id: 1, head_sha: NEXT, head_branch: 'main', event: 'push', repository: { full_name: 'Meth0ds/uvh-link-manager' }, path: '.github/workflows/' + file, status: 'completed', conclusion: 'success' }] });
  } });
  const result = await client.check(SHA); assert.equal(result.eligible, true); assert.equal(result.commits[0].message, '<script>unsafe</script>'); assert.equal(urls.filter(url => url.includes('/jobs?')).length, 3);
});
test('GitHub refuses empty successful runs and never follows arbitrary download URLs', async () => {
  const client = createGithub({ fetcher: async url => {
    if (url.endsWith('/commits/main')) return response({ sha: SHA });
    if (url.includes('/jobs?')) return response({ total_count: 0, jobs: [] });
    const file = url.split('/workflows/')[1].split('/')[0]; return response({ workflow_runs: [{ id: 1, head_sha: SHA, head_branch: 'main', event: 'push', repository: { full_name: 'Meth0ds/uvh-link-manager' }, path: '.github/workflows/' + file, status: 'completed', conclusion: 'success' }] });
  } }); assert.equal((await client.check(SHA)).eligible, false);
});
