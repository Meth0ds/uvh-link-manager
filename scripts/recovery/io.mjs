import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, lstatSync, readFileSync, writeFileSync, rmSync, copyFileSync, statfsSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { join, relative, dirname } from 'node:path';
import { fail, directory, regular, atomic } from './store.mjs';
import { COMPONENTS, createManifest, digestFile as digestComponent, validateManifest } from './backup-format.mjs';

/** Binary output is streamed to private files; it never enters process logs. */
export async function fileProcess(file, args, { cwd, input, output, timeoutMs = 600000, env = process.env } = {}) {
  const child = spawn(file, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '', timedOut = false;
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2048); });
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 && !timedOut ? resolve() : reject(new Error(timedOut ? 'Tiempo máximo agotado.' : `La herramienta ${file} falló (${code}). Revisa el diagnóstico local.`)));
  });
  // Attach all rejection handlers immediately; pipeline failures must reap the child.
  const streams = [completion];
  if (input) streams.push(pipeline(createReadStream(input), child.stdin)); else child.stdin.end();
  if (output) streams.push(pipeline(child.stdout, createWriteStream(output, { flags: 'wx', mode: 0o600 }))); else child.stdout.resume();
  try { await Promise.all(streams); }
  catch (error) { child.kill('SIGKILL'); await Promise.allSettled(streams); throw error; }
  finally { clearTimeout(timer); }
}
  async function digestFile(path) { return digestComponent(path); }
function safeTree(path) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) fail('unsafe_storage', 'El almacenamiento contiene enlaces o archivos especiales; revisa antes de copiar.');
  if (stat.isDirectory()) for (const name of readdirSync(path)) safeTree(join(path, name));
}
export function createRecoveryIO({ root, home, key, run, compose, stopFrontend, startFrontend, probe, externalNode }) {
  let activeImage = null;
  const dbArgs = ['exec', '-T', 'postgres'];
  function env() {
    const data = {};
    for (const line of readFileSync(join(root, '.env.docker.local'), 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) data[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
    return data;
  }
  function database() {
    const values = env(), user = values.POSTGRES_USER ?? 'uvh_local', db = values.POSTGRES_DB ?? 'uvh_local';
    if (![user, db].every(value => /^[a-zA-Z0-9_]{1,50}$/.test(value))) fail('invalid_database', 'Base o usuario local no compatible.');
    return { user, db };
  }
  async function cmd(file, args, options = {}) {
    const result = await run(file, args, { cwd: root, timeoutMs: 600000, ...options });
    if (result.code !== 0) fail('command_failed', `Falló ${file}. Consulta el diagnóstico local sin compartir secretos.`);
    return result.output.trim();
  }
  async function git(args, options) { return cmd('git', args, options); }
  async function cp(args, options = {}) { return cmd('docker', compose(args), { ...options, env: { ...process.env, ...(activeImage ? { UVH_LOCAL_PHP_IMAGE: activeImage } : {}) } }); }
  async function binary(args, options) { return fileProcess('docker', compose(args), { cwd: root, env: { ...process.env, ...(activeImage ? { UVH_LOCAL_PHP_IMAGE: activeImage } : {}) }, ...options }); }
  async function head() { return git(['rev-parse', 'HEAD']); }
  async function clean() {
    if (await git(['status', '--porcelain', '--untracked-files=all'])) fail('dirty_checkout', 'Hay cambios locales. Guárdalos en Git y deja main limpio antes de continuar.');
    if ((await git(['branch', '--show-current'])) !== 'main') fail('wrong_branch', 'Cambia a main antes de actualizar.');
    const gitDir = await git(['rev-parse', '--absolute-git-dir']);
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG', 'index.lock']) if (existsSync(join(gitDir, marker))) fail('git_operation', 'Termina la operación Git pendiente.');
  }
  async function preflight(sha) {
    await clean();
    if (!/^[a-f0-9]{40}$/.test(sha)) fail('invalid_sha', 'Commit no válido.');
    const remote = await git(['remote', 'get-url', 'origin']);
    if (remote !== 'https://github.com/Meth0ds/uvh-link-manager.git') fail('wrong_origin', 'origin debe ser el repositorio HTTPS oficial de UVH.');
    await cmd(externalNode(), ['--version']);
    await cmd('docker', ['info', '--format', '{{.ServerVersion}}']);
    await cmd('docker', ['compose', 'version']);
    const space = statfsSync(home);
    if (space.bavail * space.bsize < 2 * 1024 ** 3) fail('disk_space', 'Se requieren al menos 2 GiB libres para preparar la actualización.');
    const remoteHead = (await git(['ls-remote', 'origin', 'refs/heads/main'])).split(/\s/)[0];
    if (remoteHead !== sha) fail('candidate_changed', 'main cambió. Vuelve a comprobar las actualizaciones.');
    await git(['fetch', '--no-tags', 'origin', 'refs/heads/main']);
    await git(['merge-base', '--is-ancestor', await head(), sha]);
    const raw = await git(['show', `${sha}:shared/recovery-protocol.json`]);
    let protocol; try { protocol = JSON.parse(raw); } catch { fail('invalid_protocol', 'El candidato no declara un protocolo válido.'); }
    if (protocol.minimumController !== 1) fail('incompatible_controller', 'Actualiza primero UVH Control.');
    return { from: await head(), to: sha, migrations: (await git(['diff', '--name-only', 'HEAD', sha, '--', 'backend-laravel/database/migrations'])).split('\n').filter(Boolean),
      files: (await git(['diff', '--name-only', 'HEAD', sha])).split('\n').filter(Boolean) };
  }
  async function dependencies(path) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    // npm.cmd requires cmd on Windows; use npm-cli.js with Node instead.
    const node = externalNode();
    const npmCli = join(dirname(node), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
    for (const folder of ['frontend', 'panel']) {
      if (process.platform === 'win32' || existsSync(npmCli)) await cmd(node, [npmCli, 'ci', '--ignore-scripts'], { cwd: join(path, folder) });
      else await cmd(npm, ['ci', '--ignore-scripts'], { cwd: join(path, folder) });
    }
    // The current Docker tool image runs Composer against a private staging mount.
    await cmd('docker', ['run', '--rm', '--mount', `type=bind,source=${path}/backend-laravel,target=/app`, '--workdir', '/app', activeImage ?? 'uvh-php:8.4', 'composer', 'install', '--no-interaction', '--prefer-dist', '--no-scripts']);
  }
  async function prepare(sha, stage) {
    directory(stage);
    await git(['clone', '--no-hardlinks', '--no-checkout', root, stage]);
    await git(['checkout', '--detach', sha], { cwd: stage });
    await dependencies(stage);
    await cmd(externalNode(), [join(stage, 'frontend/node_modules/@angular/cli/bin/ng.js'), 'build'], { cwd: join(stage, 'frontend') });
    await cmd(externalNode(), [join(stage, 'panel/node_modules/@angular/cli/bin/ng.js'), 'build'], { cwd: join(stage, 'panel') });
  }
  async function quiesce() {
    const framework = join(root, 'backend-laravel/storage/framework');
    mkdirSync(framework, { recursive: true, mode: 0o700 });
    // Laravel's file maintenance protocol also pauses workers; it works with a broken app/DB.
    atomic(join(framework, 'down'), { except: [], redirect: null, retry: 30, refresh: null, secret: null, status: 503, template: null });
    // Compose stop waits for in-flight workers, then kills only this project's containers.
    await cp(['stop', '--timeout', '120', 'queue', 'queue-destinations', 'schedule', 'app']);
    await stopFrontend();
    const running = await cp(['ps', '--status', 'running', '--services']);
    if (running.split(/\s+/).some(name => ['app', 'queue', 'queue-destinations', 'schedule'].includes(name))) fail('quiesce_failed', 'No se confirmó la parada de todos los escritores.');
  }
  async function backup(folder, sha) {
    const { user, db } = database();
    await binary([...dbArgs, 'pg_dump', '-U', user, '-d', db, '-Fc', '--no-owner', '--no-acl'], { output: join(folder, 'database.dump') });
    const storage = join(root, 'backend-laravel/storage/app'); safeTree(storage);
    if (!existsSync(storage)) mkdirSync(storage, { recursive: true });
    await fileProcess('tar', ['-cf', join(folder, 'storage.tar'), '-C', storage, '.']);
    await git(['bundle', 'create', join(folder, 'source.bundle'), 'HEAD', 'main']);
    const config = {};
    for (const name of ['.env.docker.local', 'backend-laravel/.env']) if (existsSync(join(root, name))) {
      regular(join(root, name), 1024 * 1024); config[name] = readFileSync(join(root, name)).toString('base64');
    }
    writeFileSync(join(folder, 'configuration.json'), JSON.stringify(config), { mode: 0o600, flag: 'wx' });
    const migrations = await cp([...dbArgs, 'psql', '-U', user, '-d', db, '-Atc', 'SELECT migration FROM migrations ORDER BY id']);
    const images = await cp(['images', '--format', 'json']);
    const apiImage = await cmd('docker', ['image', 'inspect', activeImage ?? env().UVH_LOCAL_PHP_IMAGE ?? 'uvh-php:8.4', '--format', '{{.Id}}']);
    const release = { schema: 1, sha, db, user, migrations, images, apiImage };
    writeFileSync(join(folder, 'release.json'), JSON.stringify(release), { mode: 0o600, flag: 'wx' });
    await createManifest(folder, release);
  }
  async function encrypt(folder, dest) {
    const archive = join(folder, 'payload.tar');
    await fileProcess('tar', ['-cf', archive, '-C', folder, ...COMPONENTS, 'manifest.json']);
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    await pipeline(createReadStream(archive), cipher, createWriteStream(dest, { flags: 'wx', mode: 0o600 }));
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), digest: await digestFile(dest), bytes: lstatSync(dest).size };
  }
  async function unpack(entry, source, folder) {
    if (await digestFile(source) !== entry.digest) fail('backup_integrity', 'La copia no coincide con su huella. No se ha restaurado nada.');
    const tar = join(folder, 'payload.tar'), decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(entry.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(entry.tag, 'hex'));
    await pipeline(createReadStream(source), decipher, createWriteStream(tar, { flags: 'wx', mode: 0o600 }));
    // Authentication is complete before any archive is extracted.
    const names = (await cmd('tar', ['-tf', tar])).split(/\r?\n/).filter(Boolean).sort();
    const expected = [...COMPONENTS, 'manifest.json'].sort();
    const legacy = [...COMPONENTS].sort();
    if (JSON.stringify(names) !== JSON.stringify(expected) && JSON.stringify(names) !== JSON.stringify(legacy)) fail('invalid_archive', 'Contenido de copia inesperado.');
    await fileProcess('tar', ['-xf', tar, '-C', folder]);
    for (const name of names) regular(join(folder, name));
    const release = JSON.parse(readFileSync(join(folder, 'release.json'), 'utf8'));
    if (release.sha !== entry.sha || release.schema !== 1 || !/^[a-f0-9]{40}$/.test(release.sha)) fail('invalid_release', 'La copia no corresponde a la versión indicada.');
    const manifest = await validateManifest(folder);
    if (!manifest.legacy && manifest.sourceSha !== release.sha) fail('invalid_manifest', 'El manifiesto no corresponde a la versión de la copia.');
    await git(['bundle', 'verify', join(folder, 'source.bundle')]);
    return { ...release, manifest };
  }
  async function verify(folder) {
    const { user } = database(), name = `uvh_recovery_${randomBytes(6).toString('hex')}_test`;
    await cp([...dbArgs, 'createdb', '-U', user, name]);
    try {
      await binary([...dbArgs, 'pg_restore', '-U', user, '-d', name, '--exit-on-error', '--no-owner', '--no-acl'], { input: join(folder, 'database.dump') });
      await cp([...dbArgs, 'psql', '-U', user, '-d', name, '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT count(*) FROM migrations; SELECT count(*) FROM users; SELECT count(*) FROM links;']);
    } finally { await cp([...dbArgs, 'dropdb', '-U', user, name]); }
    const listing = (await cmd('tar', ['-tf', join(folder, 'storage.tar')])).split(/\r?\n/).filter(Boolean);
    if (listing.some(name => !name.startsWith('./') || name.split('/').includes('..') || /[\\\x00-\x1f]/.test(name))) fail('invalid_storage', 'Rutas de almacenamiento no válidas.');
    const test = directory(join(folder, 'storage-check'));
    await fileProcess('tar', ['-xf', join(folder, 'storage.tar'), '-C', test]); safeTree(test);
  }
  async function restore(folder, expectedHead) {
    const release = JSON.parse(readFileSync(join(folder, 'release.json'), 'utf8'));
    if (!/^sha256:[a-f0-9]{64}$/.test(release.apiImage ?? '')) fail('invalid_image', 'La copia no identifica su imagen PHP.');
    await cmd('docker', ['image', 'inspect', release.apiImage, '--format', '{{.Id}}']);
    await clean();
    if (await head() !== expectedHead) fail('checkout_changed', 'El checkout cambió; la recuperación requiere revisión.');
    // Import the source object before moving main, without overwriting local changes.
    await git(['fetch', join(folder, 'source.bundle'), 'HEAD']);
    await git(['reset', '--keep', release.sha]);
    activeImage = release.apiImage;
    const { user, db } = database();
    if (db !== release.db || user !== release.user) fail('destination_changed', 'La identidad de la base no coincide con la copia.');
    const config = JSON.parse(readFileSync(join(folder, 'configuration.json'), 'utf8'));
    for (const [name, value] of Object.entries(config)) {
      if (!['.env.docker.local', 'backend-laravel/.env'].includes(name) || typeof value !== 'string') fail('invalid_configuration', 'Configuración de copia no válida.');
      if (existsSync(join(root, name))) regular(join(root, name));
      writeFileSync(join(root, name), Buffer.from(value, 'base64'), { mode: 0o600 });
    }
    await binary([...dbArgs, 'pg_restore', '-U', user, '-d', db, '--clean', '--if-exists', '--exit-on-error', '--no-owner', '--no-acl'], { input: join(folder, 'database.dump') });
    const storage = join(root, 'backend-laravel/storage/app'); safeTree(storage);
    const old = `${storage}.recovery-${randomBytes(6).toString('hex')}`;
    if (existsSync(storage)) { const { renameSync } = await import('node:fs'); renameSync(storage, old); }
    mkdirSync(storage, { recursive: true, mode: 0o700 });
    await fileProcess('tar', ['-xf', join(folder, 'storage.tar'), '-C', storage]); safeTree(storage);
    await dependencies(root);
    return release.sha;
  }
  async function restoreSelective(folder, paths) {
    const storage = join(root, 'backend-laravel/storage/app'), extracted = directory(join(folder, 'storage-selective'));
    const allowed = paths.map(value => value.replace(/^\.\//, '')).filter(value => value && !value.includes('..') && !/[\\\x00-\x1f]/.test(value));
    if (!allowed.length || allowed.length !== paths.length) fail('invalid_restore_paths', 'La selección de archivos no es válida.');
    await fileProcess('tar', ['-xf', join(folder, 'storage.tar'), '-C', extracted]); safeTree(extracted);
    for (const path of allowed) {
      const source = join(extracted, path), destination = join(storage, path);
      const sourceRelative = relative(extracted, source), destinationRelative = relative(storage, destination);
      if (sourceRelative.startsWith('..') || destinationRelative.startsWith('..') || !existsSync(source) || !lstatSync(source).isFile()) fail('invalid_restore_paths', 'La selección contiene un archivo no restaurable.');
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 }); copyFileSync(source, destination); regular(destination);
    }
    return allowed;
  }
  async function apply(sha, from) {
    activeImage = null;
    await clean(); if (await head() !== from) fail('checkout_changed', 'El checkout cambió desde la autorización.');
    await git(['merge', '--ff-only', sha]);
    await dependencies(root);
    await cp(['build', 'php']);
    await cp(['run', '--rm', 'php', 'php', 'artisan', 'migrate', '--force', '--no-interaction']);
  }
  async function start() {
    // Keep Laravel's maintenance sentinel until both layers have been validated.
    await cp(['up', '-d', 'app', 'queue', 'queue-destinations', 'schedule']);
    await startFrontend();
  }
  async function health() {
    const deadline = Date.now() + 600000;
    let successes = 0;
    while (Date.now() < deadline) {
      try {
        for (const component of ['app', 'scheduler', 'queue', 'queue-destinations']) await cp(['run', '--rm', 'php', 'php', 'artisan', 'uvh:healthcheck', component], { timeoutMs: 15000 });
        const services = (await cp(['ps', '--status', 'running', '--services'], { timeoutMs: 10000 })).split(/\s+/);
        for (const name of ['app', 'postgres', 'queue', 'queue-destinations', 'schedule']) if (!services.includes(name)) fail('service_unhealthy', `El servicio ${name} no está en ejecución.`);
        const result = await probe('http://127.0.0.1:4201/');
        if (!['ok', 'slow'].includes(result.status)) throw new Error('frontend unavailable');
        if (++successes >= 3) return;
      } catch { successes = 0; }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    fail('service_unhealthy', 'El entorno no confirmó tres comprobaciones de salud consecutivas en diez minutos.');
  }
  async function reopen() { await cp(['exec', '-T', 'app', 'php', 'artisan', 'up']); }
  return { head, clean, preflight, prepare, quiesce, backup, encrypt, unpack, verify, restore, restoreSelective, apply, start, health, reopen,
    digestFile, applicationReady: async () => { await cp(['exec', '-T', 'app', 'php', 'artisan', 'uvh:healthcheck', 'app'], { timeoutMs: 10000 }); return true; }, available: async () => { await cmd('docker', ['info', '--format', '{{.ServerVersion}}']); return true; },
    admins: async () => { const { user, db } = database(); return (await cp([...dbArgs, 'psql', '-U', user, '-d', db, '-Atc', "SELECT id FROM users WHERE is_admin = true AND deleted_at IS NULL AND email_verified_at IS NOT NULL AND mfa_enabled = true ORDER BY id"])).split(/\s+/).filter(value => /^[0-9]+$/.test(value)); } };
}
