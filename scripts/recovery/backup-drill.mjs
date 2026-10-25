#!/usr/bin/env node
/** Real isolated PostgreSQL roundtrip. Never opens the user's Compose or database. */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRecoveryIO } from './io.mjs';
import { createImageSelection } from './image-selection.mjs';
import { runProcess } from '../uvh-control.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'uvh-recovery-drill-'))), project = 'uvh-recovery-' + randomBytes(6).toString('hex');
const compose = (args, imageFiles = []) => ['compose', '-p', project, '-f', join(root, 'docker-compose.local.yml'), ...imageFiles, '--env-file', join(root, '.env.docker.local'), ...args];
const command = async (file, args, opts = {}) => { const result = await runProcess(file, args, { cwd: root, timeoutMs: 120000, ...opts }); if (result.code) throw Error(`${file} failed: ${result.output.slice(-2000)}`); return result.output.trim(); };
const docker = args => command('docker', compose(args));
let started = false;
try {
  mkdirSync(join(root, 'backend-laravel/storage/app/private'), { recursive: true });
  mkdirSync(join(root, '.uvh-runtime/recovery'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), '.env.docker.local\nbackend-laravel/.env\n.uvh-runtime/\nbackend-laravel/storage/app/\nfrontend/node_modules/\npanel/node_modules/\nbackend-laravel/vendor/\n');
  for (const name of ['frontend', 'panel']) {
    mkdirSync(join(root, name)); writeFileSync(join(root, name, 'package.json'), '{"name":"recovery-drill","version":"1.0.0"}');
    writeFileSync(join(root, name, 'package-lock.json'), '{"name":"recovery-drill","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"recovery-drill","version":"1.0.0"}}}');
  }
  writeFileSync(join(root, 'backend-laravel/composer.json'), '{"name":"uvh/recovery-drill","require":{}}');
  writeFileSync(join(root, '.env.docker.local'), `POSTGRES_DB=uvh_recovery_test\nPOSTGRES_USER=uvh_drill\nPOSTGRES_PASSWORD=${randomBytes(24).toString('hex')}\n`);
  writeFileSync(join(root, 'backend-laravel/.env'), 'APP_KEY=fixture-key-not-a-real-secret\n');
  writeFileSync(join(root, 'backend-laravel/storage/app/private/example.txt'), 'original asset');
  writeFileSync(join(root, 'docker-compose.local.yml'), `services:\n  postgres:\n    image: postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685\n    env_file: .env.docker.local\n    healthcheck:\n      test: [CMD-SHELL, "pg_isready -U uvh_drill -d uvh_recovery_test"]\n      interval: 1s\n      timeout: 2s\n      retries: 30\n`);
  await command('git', ['init', '-b', 'main']); await command('git', ['add', '.']);
  await command('git', ['-c', 'user.email=recovery@example.test', '-c', 'user.name=Recovery Drill', 'commit', '-m', 'isolated recovery fixture']);
  started = true; await docker(['up', '-d', '--wait']);
  const psql = sql => docker(['exec', '-T', 'postgres', 'psql', '-U', 'uvh_drill', '-d', 'uvh_recovery_test', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  await psql("CREATE TABLE migrations (id serial primary key, migration text); INSERT INTO migrations(migration) VALUES ('fixture'); CREATE TABLE users (id int primary key); INSERT INTO users VALUES (1); CREATE TABLE links (id int primary key); INSERT INTO links VALUES (11);");
  const io = createRecoveryIO({ root, home: join(root, '.uvh-runtime/recovery'), key: randomBytes(32).toString('hex'), run: runProcess, compose,
    stopFrontend: async () => {}, startFrontend: async () => {}, probe: async () => ({ status: 'ok' }), externalNode: () => process.execPath });
  const sha = await io.head(), folder = join(root, '.uvh-runtime/recovery/source'); mkdirSync(folder);
  await io.backup(folder, sha); const encrypted = join(root, '.uvh-runtime/recovery/backup.enc'); const metadata = { sha, ...await io.encrypt(folder, encrypted) };
  assert.ok(!readFileSync(encrypted).includes(Buffer.from('original asset')));
  const extracted = join(root, '.uvh-runtime/recovery/extracted'); mkdirSync(extracted); await io.unpack(metadata, encrypted, extracted); await io.verify(extracted);
  await psql('INSERT INTO links VALUES (22)'); writeFileSync(join(root, 'backend-laravel/storage/app/private/example.txt'), 'changed asset');
  await io.restore(extracted, sha);
  const images = createImageSelection({ home: join(root, '.uvh-runtime/recovery') });
  const release = JSON.parse(readFileSync(join(extracted, 'release.json'), 'utf8'));
  assert.equal(images.selected(), release.apiImage);
  const resolvedCompose = JSON.parse(await command('docker', compose(['config', '--format', 'json'], images.files())));
  assert.equal(resolvedCompose.services.app.image, release.apiImage);
  assert.equal(resolvedCompose.services.app.pull_policy, 'never');
  assert.equal(await psql('SELECT string_agg(id::text,\',\' ORDER BY id) FROM links'), '11');
  assert.equal(readFileSync(join(root, 'backend-laravel/storage/app/private/example.txt'), 'utf8'), 'original asset');
  const corrupted = join(root, '.uvh-runtime/recovery/corrupt.enc'), bytes = readFileSync(encrypted); bytes[0] ^= 0xff; writeFileSync(corrupted, bytes);
  const rejected = join(root, '.uvh-runtime/recovery/rejected'); mkdirSync(rejected);
  await assert.rejects(() => io.unpack(metadata, corrupted, rejected)); assert.equal(await psql('SELECT count(*) FROM links'), '1');
  process.stdout.write('PASS: PostgreSQL dump → authenticated encryption → isolated restore → data/source/storage recovery → tamper rejection.\n');
} finally {
  if (started) await docker(['down', '-v', '--remove-orphans']);
  rmSync(root, { recursive: true, force: true });
}
