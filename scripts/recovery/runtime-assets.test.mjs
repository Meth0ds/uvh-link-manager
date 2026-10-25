import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, cpSync, rmSync, realpathSync, unlinkSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recoveryAssets } from './runtime-assets.mjs';

test('runtime manifest includes transitive modules and frozen resources without test tooling', async () => {
  const scripts = fileURLToPath(new URL('../', import.meta.url));
  const files = recoveryAssets(scripts);
  assert.ok(files.includes('engine.mjs'));
  assert.ok(files.includes('s3-multipart.mjs'));
  assert.ok(files.includes('page-assets/admin.js'));
  assert.ok(files.every(name => !/test|drill|screenshot|benchmark|evidence|runtime-assets/.test(name)));
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'uvh-frozen-test-')));
  try {
    for (const name of files) cpSync(join(scripts, 'recovery', name), join(folder, name), { recursive: true });
    const { maintenancePage, adminScript } = await import(pathToFileURL(join(folder, 'pages.mjs')).href);
    assert.match(maintenancePage, /__uvh\/maintenance.js/);
    assert.match(adminScript, /uvh-recovery-ticket/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('runtime packaging refuses a linked page asset', () => {
  const scripts = fileURLToPath(new URL('../', import.meta.url));
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'uvh-asset-path-test-')));
  try {
    cpSync(join(scripts, 'uvh-control.mjs'), join(folder, 'uvh-control.mjs'));
    for (const name of recoveryAssets(scripts)) cpSync(join(scripts, 'recovery', name), join(folder, 'recovery', name), { recursive: true });
    const page = join(folder, 'recovery/page-assets/admin.js');
    unlinkSync(page); symlinkSync(join(scripts, 'recovery/page-assets/admin.js'), page);
    assert.throws(() => recoveryAssets(folder), /Recurso runtime no válido/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
