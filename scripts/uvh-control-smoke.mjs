import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from '../panel/node_modules/@playwright/test/index.mjs';
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Este smoke exige macOS ARM64.');
const root = mkdtempSync(join(tmpdir(), 'uvh-sea-smoke-'));
writeFileSync(join(root, 'docker-compose.local.yml'), 'services: {}');
writeFileSync(join(root, '.env.docker.local'), 'POSTGRES_DB=smoke_local\n');
const listener = createServer(); await new Promise((yes) => listener.listen(0, '127.0.0.1', yes));
const port = listener.address().port; await new Promise((yes) => listener.close(yes));
const fakeBin = join(root, 'bin'); mkdirSync(fakeBin);
// No Node on PATH: this deterministic Docker fixture is a /bin/sh executable.
const fakeDocker = join(fakeBin, 'docker');
writeFileSync(fakeDocker, '#!/bin/sh\ncase "$1" in\n info) echo 99.smoke ;;\n --version) echo Docker-smoke ;;\n compose) echo "" ;;\n *) exit 99 ;;\nesac\n');
chmodSync(fakeDocker, 0o755);
const binary = resolve('dist/uvh-control-macos-arm64');
const child = spawn(binary, ['serve', '--no-browser', '--port', String(port)], {
  cwd: root, env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin`, UVH_CONTROL_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', (chunk) => { logs += chunk; }); child.stderr.on('data', (chunk) => { logs += chunk; });
let browser;
try {
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(origin)).ok; } catch { ready = false; }
    if (ready) break;
    if (child.exitCode !== null) throw new Error(logs);
    await new Promise((yes) => setTimeout(yes, 100));
  }
  assert.ok(ready, logs); assert.equal(existsSync(join(root, 'panel')), false);
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  const session = await (await fetch(`${origin}/api/session`)).json();
  const state = await (await fetch(`${origin}/api/state`, { headers: { 'X-UVH-Session': session.token } })).json();
  assert.equal(state.schema, 1); assert.equal(state.operation, null);
  browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [], failures = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => failures.push(request.url()));
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
  await page.goto(origin);
  await page.getByText('Controlador conectado').waitFor();
  await page.locator('#btnStart:enabled').waitFor({ timeout: 20000 });
  assert.equal(await page.locator('mat-card').count(), 6);
  await page.getByRole('button', { name: 'Registros', exact: true }).click();
  await page.locator('#btnDockerLogs').waitFor(); await page.locator('#btnFrontendLogs').waitFor();
  await page.getByRole('button', { name: 'Mantenimiento', exact: true }).click();
  await page.locator('#btnMigrate').waitFor(); await page.locator('#btnRepair').waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  mkdirSync('panel/test-results/visual', { recursive: true });
  await page.screenshot({ path: 'panel/test-results/visual/sea-macos-maintenance.png', fullPage: true });
  console.log('PASS: macOS SEA · Angular real · assets embebidos · sesión protegida · sin Node en PATH · checkout privado');
} finally {
  await browser?.close();
  const exit = new Promise((yes) => child.once('exit', yes)); child.kill('SIGTERM'); await exit;
  rmSync(root, { recursive: true, force: true });
}
