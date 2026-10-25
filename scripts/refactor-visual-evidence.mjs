#!/usr/bin/env node
/** Actual compiled Angular + independent gateway. Fictional data, no DB writes. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, join, extname, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '../frontend/node_modules/@playwright/test/index.mjs';
import AxeBuilder from '../frontend/node_modules/@axe-core/playwright/dist/index.mjs';
import { PNG } from '../frontend/node_modules/pngjs/lib/png.js';
import { serveRecoveryGateway } from './recovery/gateway.mjs';
import { RecoveryError } from './recovery/store.mjs';

if (!process.argv[2]) throw new Error('Uso: node scripts/refactor-visual-evidence.mjs <checkout-base> [destino-evidencia]');
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const baseline = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? join(projectRoot, 'docs/release-evidence/2026-10-25-refactor'));
process.chdir(projectRoot);
mkdirSync(join(output, 'screenshots'), { recursive: true });
async function staticSite(folder) {
  const root = resolve(folder);
  const server = createServer((request, response) => {
    try {
      let file = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
      if (relative(root, file).startsWith('..')) throw Error('Invalid path');
      if (!existsSync(file) || !statSync(file).isFile()) file = join(root, 'index.html');
      const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
      const content = readFileSync(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(content);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
const sites = [await staticSite(join(baseline, 'frontend/dist/design-preview/browser')), await staticSite('frontend/dist/design-preview/browser')];
const stamp = '2026-10-24T08:00:00Z', sha = 'a'.repeat(40), token = 'e'.repeat(64);
let state = {
  schema: 1, enabled: true, maintenance: { maintenance: true, reason: 'update', since: stamp, updatedAt: stamp },
  operation: { id: randomUUID(), action: 'install', state: 'running', phase: 'verifying_backup', startedAt: stamp, error: null, events: [{ at: stamp, message: 'Comprobando la copia antes de continuar.' }] },
  history: [{ action: 'backup', state: 'completed', startedAt: stamp }], github: null,
  diagnosis: { services: [{ name: 'app', status: 'running' }, { name: 'postgres', status: 'running' }] },
  backups: [{ id: randomUUID(), sha, tag: 'daily', createdAt: stamp, restoredAt: stamp, bytes: 7340032 }],
  policy: { daily: true, dailyRetention: 7, weeklyRetention: 4, updateRetention: 3 }, destinations: [], recommendation: null, controllerProtocol: 1,
};
const admitted = [];
const engine = {
  bridge: '', bridgeKey: '', blocking: () => state.maintenance.maintenance,
  publicState: () => ({ ...state.maintenance, available: !state.maintenance.maintenance, phase: state.operation.phase }),
  snapshot: () => state, events: () => state.operation.events, validate() {},
  auth: {
    login: ({ code }) => { if (code !== 'FIXTURE-CODE') throw new RecoveryError('authentication_failed', 'Credencial no válida.', 403); return { token, emergency: false }; },
    session: value => { if (value !== token) throw new RecoveryError('session_required', 'Inicia sesión.', 401); return { actor: '1', emergency: false }; },
    confirm: () => randomUUID(), consume: () => ({ actor: '1', emergency: false }), logout() {},
  },
  admit: async (action, target) => { admitted.push({ action, target }); return state.operation; },
};
const gateway = await serveRecoveryGateway({ engine, port: 0, upstreamPort: 9, font: resolve('frontend/node_modules/@fontsource/manrope/files/manrope-latin-400-normal.woff2') });
const gatewayOrigin = `http://127.0.0.1:${gateway.server.address().port}`;
const browser = await chromium.launch();
const results = [], comparisons = [];
function compare(name, hashes) {
  const before = PNG.sync.read(readFileSync(join(output, 'screenshots', name + '-before.png')));
  const after = PNG.sync.read(readFileSync(join(output, 'screenshots', name + '-after.png')));
  let changedPixels = 0, maxChannelDelta = 0;
  const sameSize = before.width === after.width && before.height === after.height;
  if (sameSize) for (let offset = 0; offset < before.data.length; offset += 4) {
    let changed = false;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(before.data[offset + channel] - after.data[offset + channel]);
      if (delta) changed = true;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
    }
    if (changed) changedPixels++;
  }
  // A tiny number of border pixels can differ by two 8-bit levels when a
  // deferred stylesheet is inserted after the first frame. Geometry, missing
  // content and larger colour changes still fail the comparison.
  comparisons.push({ name, identical: hashes[0] === hashes[1], sameSize, changedPixels, maxChannelDelta, equivalent: sameSize && changedPixels <= 20 && maxChannelDelta <= 2 });
}
async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  const bytes = await page.screenshot({ path: join(output, 'screenshots', name + '.png'), fullPage: true, animations: 'disabled' });
  return createHash('sha256').update(bytes).digest('hex');
}
try {
  for (const theme of ['light', 'dark']) for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme, reducedMotion: 'reduce', timezoneId: 'Europe/Madrid' });
    await context.addInitScript(theme => localStorage.setItem('uvh.theme', theme), theme);
    const scenarios = width === 1440 && theme === 'light' ? ['local', 'external', 'progress', 'external-error', 'intervention'] : ['local'];
    for (const scenario of scenarios) {
      const hashes = [];
      for (let version = 0; version < sites.length; version++) {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${sites[version].origin}/app/admin?scenario=${scenario}`);
        await expect(page.locator('app-admin')).toBeVisible();
        const picker = page.getByRole('combobox', { name: 'Sección de administración', exact: true });
        if (await picker.isVisible()) {
          await picker.click();
          await page.getByRole('option', { name: 'Actualizaciones', exact: true }).click();
        } else await page.getByRole('tab', { name: 'Actualizaciones', exact: true }).click();
        await expect(page.locator('app-backup-center')).toBeVisible();
        const { violations } = await new AxeBuilder({ page }).include('app-admin').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
        const name = `admin-${scenario}-${theme}-${width}-${version ? 'after' : 'before'}`;
        hashes.push(await capture(page, name));
        if (scenario === 'local') for (const [section, selector] of [['backups', 'app-backup-center'], ['access', '.access-card']]) {
          await page.locator(selector).scrollIntoViewIfNeeded();
          await capture(page, `admin-${section}-${theme}-${width}-${version ? 'after' : 'before'}`);
        }
        if (version === 1 && width === 1440) {
          const tab = page.getByRole('tab', { name: 'Actualizaciones', exact: true });
          await expect(tab).toHaveAccessibleDescription('Plataforma');
          await tab.focus(); await page.keyboard.press('ArrowDown');
          await expect(page.getByRole('tab', { name: 'Sistema', exact: true })).toBeFocused();
          await expect(tab).toHaveAttribute('aria-selected', 'true');
        }
        console.log(name);
        results.push({ name, errors, overflow, violations: violations.map(item => ({ id: item.id, impact: item.impact, targets: item.nodes.map(node => node.target) })) });
        await page.close();
      }
      compare(`admin-${scenario}-${theme}-${width}`, hashes);
      if (scenario === 'local') for (const section of ['backups', 'access']) {
        const name = `admin-${section}-${theme}-${width}`;
        compare(name, ['before', 'after'].map(version => createHash('sha256').update(readFileSync(join(output, 'screenshots', `${name}-${version}.png`))).digest('hex')));
      }
    }
    // The settings view renders the same forms after coordinator extraction.
    const hashes = [];
    for (let version = 0; version < sites.length; version++) {
      const page = await context.newPage();
      await page.goto(`${sites[version].origin}/app/settings`);
      await expect(page.locator('app-settings')).toBeVisible();
      await expect(page.locator('app-settings input[formControlName="name"]')).toBeVisible();
      hashes.push(await capture(page, `settings-${theme}-${width}-${version ? 'after' : 'before'}`));
      await page.close();
    }
    compare(`settings-${theme}-${width}`, hashes);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${gatewayOrigin}/__uvh/maintenance`);
    await expect(page.locator('#connection')).toHaveText('Información actualizada automáticamente.');
    await capture(page, `maintenance-${theme}-${width}`);
    await page.goto(`${gatewayOrigin}/__uvh/admin`);
    await capture(page, `recovery-login-${theme}-${width}`);
    await page.locator('#code').fill('FIXTURE-CODE');
    await page.locator('#login-form button').click();
    await expect(page.locator('#content')).toBeVisible();
    await expect(page.locator('#backups article')).toHaveCount(1);
    const refresh = async () => {
      await Promise.all([page.waitForResponse(response => response.url().endsWith('/__uvh/api/state')), page.locator('#refresh').dispatchEvent('click')]);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const first = page.locator('#backups button').first();
    await first.focus();
    await refresh();
    await expect(first).toBeFocused();
    // A draft in the active form survives a successful refresh.
    await page.locator('#daily-retention').fill('11');
    await refresh();
    await expect(page.locator('#daily-retention')).toHaveValue('11');
    await capture(page, `recovery-${theme}-${width}`);
    if (theme === 'light' && width === 1440) {
      await page.getByRole('button', { name: 'Restaurar archivos', exact: true }).click();
      await page.locator('#selective-paths').fill('private/document.txt\nprivate/image.png');
      await capture(page, 'selective-restore-dialog');
      await page.locator('#selective-dialog button[value="confirm"]').click();
      await expect(page.locator('#confirm-dialog')).toBeVisible();
      await capture(page, 'restore-confirmation');
      await page.locator('#confirm-dialog button[value="confirm"]').click();
      await expect.poll(() => admitted.length).toBe(1);
      assert.deepEqual(admitted[0], { action: 'restore-selective', target: { id: state.backups[0].id, paths: ['private/document.txt', 'private/image.png'] } });
      state.operation = { ...state.operation, state: 'requires_intervention', phase: 'restoring', error: { code: 'service_unhealthy', message: 'No se pudo comprobar la salud. El entorno permanece protegido.' } };
      await page.locator('#refresh').click();
      await expect(page.locator('#operation-detail')).toContainText('permanece protegido');
      await capture(page, 'recovery-requires-intervention');
    }
    results.push({ name: `independent-${theme}-${width}`, errors });
    await context.close();
  }
} finally {
  await browser.close(); await gateway.close();
  for (const site of sites) await site.close();
}
const accessibilityComparisons = results.filter(item => item.name.endsWith('-before')).map(before => {
  const after = results.find(item => item.name === before.name.replace(/-before$/, '-after'));
  const signatures = violations => new Set((violations ?? []).flatMap(issue => issue.targets.map(target => JSON.stringify({ id: issue.id, impact: issue.impact, target: target.map(selector => selector.replace(/\[_ng(?:content|host)-[^\]]+\]/g, '')) }))));
  const previous = signatures(before.violations), current = signatures(after?.violations);
  const added = [...current].filter(item => !previous.has(item)), removed = [...previous].filter(item => !current.has(item));
  return { name: before.name.replace(/-before$/, ''), identical: Boolean(after) && !added.length && !removed.length, noRegression: Boolean(after) && !added.length, added, removed };
});
writeFileSync(join(output, 'visual-results.json'), JSON.stringify({ at: new Date().toISOString(), results, comparisons, accessibilityComparisons }, null, 2));
const files = readdirSync(join(output, 'screenshots')).sort().map(name => ({ file: 'screenshots/' + name, sha256: createHash('sha256').update(readFileSync(join(output, 'screenshots', name))).digest('hex') }));
writeFileSync(join(output, 'screenshots.sha256'), files.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n');
console.log(JSON.stringify({ captures: files.length, identicalComparisons: comparisons.filter(item => item.identical).length, totalComparisons: comparisons.length, runtimeErrors: results.flatMap(item => item.errors).length }, null, 2));
assert.ok(results.every(item => !item.errors.length), 'Browser runtime errors need investigation.');
assert.ok(results.every(item => !item.overflow), 'Horizontal overflow needs investigation.');
assert.ok(accessibilityComparisons.every(item => item.noRegression), 'Accessibility regressions need investigation.');
assert.ok(comparisons.every(item => item.equivalent), 'Visual differences need investigation.');
