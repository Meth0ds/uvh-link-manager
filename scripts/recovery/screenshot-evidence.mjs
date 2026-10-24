#!/usr/bin/env node
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from '../../panel/node_modules/@playwright/test/index.mjs';
import { serveRecoveryGateway } from './gateway.mjs';
import { RecoveryError } from './store.mjs';

const output = resolve('docs/release-evidence/2026-10-23-local-recovery/screenshots');
mkdirSync(output, { recursive: true });
let maintenance = true;
let state = {
  schema: 1, enabled: true, maintenance: { maintenance: true, reason: 'update', since: '2026-10-23T08:45:00.000Z', updatedAt: '2026-10-23T08:47:12.000Z' },
  operation: { id: randomUUID(), action: 'install', state: 'running', phase: 'backup', error: null, events: [{ at: '2026-10-23T08:46:30.000Z', message: 'Creando y verificando una copia consistente.' }] },
  history: [{ id: randomUUID(), action: 'backup', state: 'completed', startedAt: '2026-10-22T08:00:00.000Z' }],
  github: { from: 'c1b1b20b1edf4161dc81ddae5acb3ea9a3d605aa', sha: 'd4e5f6a7890b1234567890abcdef1234567890ab', eligible: true, stale: false, checkedAt: '2026-10-23T08:42:00.000Z', checks: [{ workflow: 'ci.yml', state: 'passed' }, { workflow: 'codeql.yml', state: 'passed' }, { workflow: 'security.yml', state: 'passed' }], commits: [{ sha: 'd4e5f6a7890b1234567890abcdef1234567890ab', message: 'Add local recovery centre and maintenance gateway' }] },
  diagnosis: { services: [{ name: 'app', status: 'running' }, { name: 'postgres', status: 'running' }, { name: 'queue', status: 'running' }, { name: 'scheduler', status: 'running' }], endpoints: { backend: { status: 'ok', latencyMs: 21 }, frontend: { status: 'ok', latencyMs: 34 } } },
  backups: [{ id: randomUUID(), sha: 'c1b1b20b1edf4161dc81ddae5acb3ea9a3d605aa', createdAt: '2026-10-23T08:40:00.000Z', restoredAt: '2026-10-23T08:41:20.000Z', bytes: 7340032, tag: 'pre-update' }, { id: randomUUID(), sha: '9a8b7c6d5e4f32100123456789abcdef1234567890', createdAt: '2026-10-22T08:00:00.000Z', restoredAt: '2026-10-22T08:03:10.000Z', bytes: 6291456, tag: 'daily' }],
  recoveryConfigured: true, policy: { daily: true, dailyRetention: 7, weeklyRetention: 4, updateRetention: 3 }, destinations: [{ id: randomUUID(), name: 'Archivo externo', type: 'folder', configured: true }], recommendation: { reason: 'Copia más reciente con restauración comprobada.' }, updatedAt: '2026-10-23T08:47:12.000Z', controllerProtocol: 1,
};
const token = 'e'.repeat(64);
const fakeAuth = {
  login({ code, ticket }) { if (code !== 'DEMO-CODE' && !ticket) throw new RecoveryError('authentication_failed', 'Credencial no válida.', 403); return { token, expiresIn: 600, emergency: false }; },
  session(value) { if (value !== token) throw new RecoveryError('session_required', 'Inicia sesión de recuperación.', 401); return { actor: '1', emergency: false }; },
  logout() {}, enroll() { return ['DEMO-ONE']; }, revoke() {},
  confirm() { return randomUUID(); }, consume() { return { actor: '1', emergency: false }; },
};
const engine = {
  auth: fakeAuth, bridge: '', bridgeKey: '', blocking: () => maintenance,
  publicState: () => ({ schema: 1, maintenance, reason: maintenance ? 'update' : null, since: state.maintenance.since, updatedAt: state.updatedAt, phase: maintenance ? 'backup' : null, available: !maintenance }),
  snapshot: () => state, events: () => state.operation.events ?? [], validate() {},
  async admit(action) { state.operation = { ...state.operation, action, state: 'completed', phase: 'completed', error: null }; maintenance = false; state.maintenance = { ...state.maintenance, maintenance: false }; return state.operation; },
};
const gateway = await serveRecoveryGateway({ engine, port: 0, upstreamPort: 9 });
const origin = `http://127.0.0.1:${gateway.server.address().port}`;
const browser = await chromium.launch();
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  await page.goto(`${origin}/__uvh/maintenance`); await page.screenshot({ path: join(output, '01-maintenance-desktop.png'), fullPage: true });
  const compiledStyles = join(output, '.admin-updates.css');
  const compiled = spawnSync(resolve('frontend/node_modules/.bin/sass'), [resolve('frontend/src/app/panel/admin/admin-updates.component.scss'), compiledStyles], { encoding: 'utf8' });
  if (compiled.status !== 0) throw new Error(compiled.stderr || 'No se pudo compilar la hoja de evidencia.');
  const adminStyles = readFileSync(compiledStyles, 'utf8');
  const adminSnapshot = `<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>${adminStyles}</style></head><body style=\"margin:0;padding:32px;background:#f7f5ef;font:14px Manrope,Arial,sans-serif;\"><app-admin-updates><section class=\"updates\"><header class=\"updates-hero\"><div class=\"hero-copy\"><div class=\"eyebrow\">Continuidad del entorno local</div><h2>Actualizaciones y recuperación</h2><p class=\"hero-lead\">Comprueba si hay una versión nueva, protege tus datos y actualiza desde un centro independiente de la aplicación.</p></div><div class=\"hero-mark\"><span>UVH / CONTROL</span></div></header><div class=\"status-strip\"><span class=\"status-marker\"></span><div><strong>Controlador disponible</strong><small>23/10/2026, 10:47</small></div><span class=\"status-caption\">Listo para revisar y proteger el entorno.</span></div><div class=\"summary-grid\"><section class=\"summary-card version-card\"><div class=\"card-heading\"><span class=\"icon-box\">✓</span><div><p class=\"eyebrow\">Canal de versiones</p><h3>Versión y comprobaciones</h3></div></div><div class=\"version-pair\"><div><span class=\"label\">Instalada</span><code>c1b1b20b1edf</code></div><div class=\"arrow\">→</div><div><span class=\"label\">Disponible</span><code>d4e5f6a7890b</code></div></div><div class=\"checks\"><p><span>CI</span><strong class=\"is-good\">passed</strong></p><p><span>Quality</span><strong class=\"is-good\">passed</strong></p><p><span>Security</span><strong class=\"is-good\">passed</strong></p></div><button>↻ Buscar actualización</button></section><section class=\"summary-card backup-card\"><div class=\"card-heading\"><span class=\"icon-box warm\">◆</span><div><p class=\"eyebrow\">Copias verificadas</p><h3>Preparado para recuperar</h3></div></div><div class=\"backup-count\"><strong>7</strong><span>copias registradas</span></div><p class=\"muted\">La instalación exige una copia con restauración comprobada y códigos de emergencia configurados.</p><div class=\"readiness\">✓ <span>Acceso de emergencia configurado</span></div></section></div><section class=\"backup-center\"><div class=\"backup-center-head\"><div><p class=\"eyebrow\">Protección del entorno</p><h3>Centro de backups</h3><p class=\"muted\">La copia local está siempre disponible. Puedes añadir un destino externo cuando necesites una segunda ubicación.</p></div><button>＋ Crear copia ahora</button></div><div class=\"backup-metrics\"><div><span class=\"eyebrow\">Copia local</span><strong>7</strong><small>registradas</small></div><div><span class=\"eyebrow\">Destino externo</span><strong>1</strong><small>configurado</small></div><div><span class=\"eyebrow\">Retención</span><strong>7/4</strong><small>diarias / semanales</small></div></div><div class=\"destination-list\"><div class=\"destination-row\"><span class=\"status-marker\"></span><span><b>Archivo externo</b><small>Carpeta externa</small></span><strong class=\"is-good\">Preparado</strong></div></div></section><section class=\"access-card\"><div class=\"access-copy\"><p class=\"eyebrow\">Autorización administrativa</p><h3>Abrir el centro de recuperación</h3><p class=\"muted\">Se abre en una ventana independiente y permanece disponible durante el mantenimiento.</p></div><form><input placeholder=\"Contraseña\"><input placeholder=\"Segundo factor o código de recuperación\"><button>Acceder al centro</button></form></section></section></app-admin-updates></body></html>`;
  const adminPage = await desktop.newPage();
  await adminPage.setContent(adminSnapshot); await adminPage.screenshot({ path: join(output, '06-admin-dashboard-section-desktop.png'), fullPage: true });
  await adminPage.close();
  rmSync(compiledStyles, { force: true });
  await page.goto(`${origin}/__uvh/admin`); await page.screenshot({ path: join(output, '02-recovery-login-desktop.png'), fullPage: true });
  await page.locator('#code').fill('DEMO-CODE'); await page.locator('#login-form button').click(); await page.locator('#content:not([hidden])').waitFor(); await page.screenshot({ path: join(output, '03-recovery-dashboard-desktop.png'), fullPage: true });
  maintenance = true; state.maintenance = { ...state.maintenance, maintenance: true, reason: 'incident' }; state.operation = { ...state.operation, action: 'install', state: 'requires_intervention', phase: 'restoring', error: { code: 'service_unhealthy', message: 'No se pudo confirmar la salud después de la recuperación.' }, events: [...(state.operation.events ?? []), { at: '2026-10-24T08:50:00.000Z', message: 'El entorno permanece cerrado y requiere intervención.' }] };
  await page.waitForTimeout(5500); await page.screenshot({ path: join(output, '07-recovery-intervention-desktop.png'), fullPage: true });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`${origin}/__uvh/maintenance`); await mobilePage.screenshot({ path: join(output, '04-maintenance-mobile.png'), fullPage: true });
  await mobilePage.goto(`${origin}/__uvh/admin`); await mobilePage.locator('#code').fill('DEMO-CODE'); await mobilePage.locator('#login-form button').click(); await mobilePage.locator('#content:not([hidden])').waitFor(); await mobilePage.screenshot({ path: join(output, '05-recovery-dashboard-mobile.png'), fullPage: true });
  await desktop.close(); await mobile.close();
} finally { await browser.close(); await gateway.close(); }
console.log(`Screenshots written to ${output}`);
