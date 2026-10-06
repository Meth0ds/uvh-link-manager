'use strict';
const { existsSync, mkdtempSync, mkdirSync, writeFileSync, realpathSync, lstatSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve, relative, isAbsolute } = require('node:path');
const { pathToFileURL } = require('node:url');
function findRoot(start) {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'docker-compose.local.yml'))) return dir;
    const parent = dirname(dir); if (parent === dir) break; dir = parent;
  }
  return null;
}
function validateRoot(value) {
  const root = realpathSync(value);
  if (!lstatSync(join(root, 'docker-compose.local.yml')).isFile()) throw new Error('Checkout local no válido.');
  return root;
}
async function main() {
  const sea = require('node:sea');
  const embedded = sea.isSea();
  const requested = process.env.UVH_CONTROL_ROOT;
  const root = validateRoot(requested ? resolve(requested) : findRoot(embedded ? dirname(process.execPath) : __dirname)
    ?? (() => { throw new Error('No se encontró docker-compose.local.yml. Coloca el ejecutable dentro del checkout o fija UVH_CONTROL_ROOT.'); })());
  let cliPath;
  if (embedded) {
    const privateDir = mkdtempSync(join(tmpdir(), 'uvh-control-'));
    // mkdtemp creates 0700; assets never overwrite another invocation.
    process.once('exit', () => rmSync(privateDir, { recursive: true, force: true }));
    const manifest = JSON.parse(sea.getAsset('panel-manifest.json', 'utf8'));
    if (!Array.isArray(manifest) || manifest.length > 1000 || !manifest.includes('index.html')) throw new Error('Manifiesto Angular incompleto. Recompila el ejecutable.');
    const panelDir = join(privateDir, 'panel'); mkdirSync(panelDir, { mode: 0o700 });
    const names = new Set();
    for (const name of manifest) {
      if (typeof name !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(name) || name.includes('..') || isAbsolute(name) || names.has(name)) throw new Error('Ruta de asset no válida.');
      const dest = join(panelDir, name), rel = relative(panelDir, dest);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Asset fuera del panel.');
      names.add(name); mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
      writeFileSync(dest, Buffer.from(sea.getAsset(`panel/${name}`)), { flag: 'wx', mode: 0o600 });
    }
    cliPath = join(privateDir, 'uvh-control.mjs');
    writeFileSync(cliPath, sea.getAsset('cli.mjs', 'utf8'), { flag: 'wx', mode: 0o600 });
    process.env.UVH_CONTROL_PANEL_DIR = panelDir;
    process.env.UVH_CONTROL_SEA = '1';
  } else {
    cliPath = join(__dirname, 'uvh-control.mjs');
    process.env.UVH_CONTROL_PANEL_DIR = join(root, 'panel/dist/panel/browser');
    // Source bootstrap explicitly delegates CLI entrypoint without relying on argv path.
    process.env.UVH_CONTROL_SEA = '1';
  }
  process.env.UVH_CONTROL_ROOT = root;
  await import(pathToFileURL(cliPath).href);
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
