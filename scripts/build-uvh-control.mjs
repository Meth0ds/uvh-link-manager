#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, lstatSync, writeFileSync, renameSync, unlinkSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.uvh-runtime/sea'), BUILD = join(CACHE, 'build');
const VERSION = 'v24.21.0';
const TARGETS = {
  macos: { platform: 'darwin', arch: 'arm64', file: 'uvh-control-macos-arm64', extension: 'tar.gz' },
  windows: { platform: 'win32', arch: 'x64', file: 'uvh-control-windows-x64.exe', extension: 'zip' },
  linux: { platform: 'linux', arch: 'x64', file: 'uvh-control-linux-x64', extension: 'tar.xz' },
};
function run(file, args, cwd = ROOT) {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 10 * 1024 * 1024, shell: false });
  if (result.error || result.status !== 0) throw new Error(`Falló ${file}: ${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  return result.stdout.trim();
}
async function bytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
  if (!response.ok) throw new Error(`HTTP ${response.status} al descargar el runtime.`);
  return Buffer.from(await response.arrayBuffer());
}
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
async function archive(version, target, checksums) {
  const platform = target.platform === 'win32' ? 'win' : target.platform;
  const name = `node-${version}-${platform}-${target.arch}.${target.extension}`;
  const expected = checksums.get(name);
  if (!expected) throw new Error(`El runtime ${name} no existe en el manifiesto oficial.`);
  const dest = join(CACHE, name);
  if (!existsSync(dest) || digest(readFileSync(dest)) !== expected) {
    const value = await bytes(`https://nodejs.org/dist/${version}/${name}`);
    if (digest(value) !== expected) throw new Error(`Checksum no válido para ${name}.`);
    const temp = `${dest}.${randomUUID()}.tmp`;
    try { writeFileSync(temp, value, { flag: 'wx', mode: 0o600 }); renameSync(temp, dest); }
    finally { if (existsSync(temp)) unlinkSync(temp); }
  }
  return { dest, folder: name.replace(/\.(tar\.gz|tar\.xz|zip)$/, '') };
}
async function runtime(version, target, checksums) {
  const { dest, folder } = await archive(version, target, checksums);
  const extraction = join(CACHE, `extract-${randomUUID()}`); mkdirSync(extraction, { mode: 0o700 });
  // Archives are checksum-verified official distributions. bsdtar handles zip;
  // GNU tar needs unzip for the Windows target.
  if (target.extension === 'zip' && process.platform === 'linux') run('unzip', ['-q', dest, '-d', extraction]);
  else run('tar', ['-xf', dest, '-C', extraction]);
  const path = join(extraction, folder, target.platform === 'win32' ? 'node.exe' : 'bin/node');
  if (!lstatSync(path).isFile()) throw new Error('Runtime extraído no válido.');
  return path;
}
async function main() {
  if (!['darwin', 'linux'].includes(process.platform) || !['arm64', 'x64'].includes(process.arch)) throw new Error('Compila desde macOS/Linux ARM64 o x64. El ejecutable Windows se genera por compilación cruzada.');
  let only = null, version = VERSION;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--only=')) only = arg.slice(7);
    else if (arg.startsWith('--node=')) version = arg.slice(7);
    else throw new Error(`Opción no válida: ${arg}`);
  }
  if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error('Versión de Node no válida.');
  const wanted = only ? [only] : Object.keys(TARGETS);
  if (wanted.some((name) => !TARGETS[name])) throw new Error('Destino no válido.');
  mkdirSync(BUILD, { recursive: true }); mkdirSync(join(ROOT, 'dist'), { recursive: true });
  const checksums = new Map((await bytes(`https://nodejs.org/dist/${version}/SHASUMS256.txt`)).toString('utf8').trim().split('\n').map((line) => line.trim().split(/\s+/).reverse()));
  process.stdout.write('Compilando Angular Material…\n'); run('npm', ['run', 'build'], join(ROOT, 'panel'));
  const browser = join(ROOT, 'panel/dist/panel/browser'), assets = {}, manifest = [];
  function walk(dir, prefix = '') {
    for (const entry of readdirSync(dir).sort()) {
      const rel = prefix + entry, full = join(dir, entry), stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error('No se permiten symlinks en assets.');
      if (stat.isDirectory()) walk(full, `${rel}/`);
      else if (stat.isFile()) { assets[`panel/${rel}`] = full; manifest.push(rel); }
    }
  }
  walk(browser);
  const licenses = join(ROOT, 'panel/dist/panel/3rdpartylicenses.txt');
  if (!existsSync(licenses)) throw new Error('Faltan licencias del build Angular.');
  assets['panel/3rdpartylicenses.txt'] = licenses; manifest.push('3rdpartylicenses.txt');
  writeFileSync(join(BUILD, 'panel-manifest.json'), JSON.stringify(manifest.sort()));
  copyFileSync(join(ROOT, 'scripts/uvh-control-sea.cjs'), join(BUILD, 'bootstrap.cjs'));
  copyFileSync(join(ROOT, 'scripts/uvh-control.mjs'), join(BUILD, 'cli.mjs'));
  writeFileSync(join(BUILD, 'sea-config.json'), JSON.stringify({ main: 'bootstrap.cjs', output: 'uvh-control.blob', useSnapshot: false,
    useCodeCache: false, assets: { 'cli.mjs': 'cli.mjs', 'panel-manifest.json': 'panel-manifest.json', ...assets } }));
  const host = await runtime(version, { platform: process.platform, arch: process.arch, extension: process.platform === 'darwin' ? 'tar.gz' : 'tar.xz' }, checksums);
  run(host, ['--experimental-sea-config', 'sea-config.json'], BUILD);
  const postject = join(ROOT, 'panel/node_modules/postject/dist/cli.js');
  if (!existsSync(postject)) throw new Error('Falta postject fijado. Ejecuta npm ci en panel.');
  const reports = [];
  for (const name of wanted) {
    const target = TARGETS[name], base = await runtime(version, target, checksums);
    const final = join(ROOT, 'dist', target.file), temp = `${final}.${randomUUID()}.tmp`;
    try {
      copyFileSync(base, temp); chmodSync(temp, 0o755);
      if (name === 'macos' && process.platform === 'darwin') run('codesign', ['--remove-signature', temp]);
      const fuse = readFileSync(temp, 'latin1').match(/NODE_SEA_FUSE_[0-9a-f]+/)?.[0];
      if (!fuse) throw new Error('Runtime sin sentinel SEA.');
      run(process.execPath, [postject, temp, 'NODE_SEA_BLOB', join(BUILD, 'uvh-control.blob'), '--sentinel-fuse', fuse,
        ...(name === 'macos' ? ['--macho-segment-name', 'NODE_SEA'] : [])]);
      chmodSync(temp, 0o755);
      if (name === 'macos' && process.platform === 'darwin') run('codesign', ['-s', '-', temp]);
      renameSync(temp, final);
      reports.push({ file: target.file, sha256: digest(readFileSync(final)), bytes: lstatSync(final).size, runtime: version });
      process.stdout.write(`Generado dist/${target.file}\n`);
    } finally { if (existsSync(temp)) unlinkSync(temp); }
  }
  writeFileSync(join(ROOT, 'dist/uvh-control-checksums.json'), JSON.stringify(reports, null, 2));
  process.stdout.write('Ejecutables generados. La generación no acredita ejecución en otro sistema operativo.\n');
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
