#!/usr/bin/env node
// Inspect effective Compose configuration without starting any containers.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const work = mkdtempSync(join(tmpdir(), 'uvh-upcloud-config-'));
function inspect(file, mail = false) {
  const text = readFileSync(join(root, file), 'utf8');
  const values = Object.fromEntries([...text.matchAll(/\$\{(UVH_[A-Z_]+):\?/g)].map(([, key]) =>
    [key, key.endsWith('_IMAGE') ? `sha256:${'a'.repeat(64)}` : join(work, key)]));
  values[mail ? 'UVH_MAIL_ENV_FILE' : 'UVH_ENV_FILE'] = join(root,
    mail ? 'docker/mailu/mailu.env.example' : 'backend-laravel/.env.production.example');
  const env = join(work, `${mail ? 'mail' : 'app'}.env`);
  writeFileSync(env, Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n'));
  const config = JSON.parse(execFileSync('docker', ['compose', '--profile', 'tools', '--env-file', env,
    '-f', file, 'config', '--format', 'json'], { cwd: root, encoding: 'utf8' }));
  for (const [name, service] of Object.entries(config.services)) {
    assert.equal(service.build, undefined, `${file}/${name}: builds must occur outside the VPS`);
    assert.equal(service.pull_policy, 'never', `${file}/${name}: registry pulls are forbidden`);
    assert.equal(service.platform, 'linux/amd64', `${file}/${name}: wrong VPS architecture`);
    assert.match(service.image, /^sha256:[a-f0-9]{64}$/, `${file}/${name}: use verified image IDs`);
    assert.ok(Number(service.mem_limit) > 0, `${file}/${name}: missing memory ceiling`);
  }
  return config;
}
try {
  const app = inspect('docker-compose.upcloud.yml');
  const mail = inspect('docker-compose.upcloud-mail.yml', true);
  for (const [name, service] of Object.entries(app.services)) {
    if (name !== 'edge') assert.ok(!service.ports?.length, `${name}: private ports must stay private`);
  }
  assert.equal(app.services.app.environment.DB_USERNAME, 'uvh_app');
  assert.equal(app.services.migrate.environment.DB_USERNAME, 'uvh_migrator');
  assert.equal(app.services.app.environment.DB_SSLMODE, 'verify-full');
  for (const name of ['app', 'scheduler', ...Object.keys(app.services).filter(n => n.startsWith('queue-'))]) {
    const secrets = app.services[name].secrets.map(s => s.source);
    for (const key of ['uvh_db_admin_password', 'uvh_db_migration_password', 'uvh_db_backup_password']) {
      assert.ok(!secrets.includes(key), `${name} must not receive privileged database credentials`);
    }
  }
  assert.equal(app.services.nginx.environment.TRUSTED_PROXIES, '172.29.0.2/32,172.30.0.3/32');
  assert.equal(app.services.app.environment.TRUSTED_PROXIES, app.services.nginx.environment.TRUSTED_PROXIES);
  const assigned = new Set();
  for (const service of Object.values(app.services)) {
    for (const [network, settings] of Object.entries(service.networks)) {
      assert.ok(settings.ipv4_address, `All ${network} participants need deterministic allocation`);
      assert.ok(!assigned.has(`${network}:${settings.ipv4_address}`), 'Conflicting private endpoint');
      assigned.add(`${network}:${settings.ipv4_address}`);
    }
  }
  assert.equal(mail.networks['uvh-front'].external, true);
  assert.equal(mail.networks['uvh-front'].name, app.networks['uvh-front'].name);
  for (const [name, service] of Object.entries(mail.services)) {
    if (name !== 'front') assert.ok(!service.ports?.length, `Mail ${name} must not publish a port`);
    assert.ok(!service.networks['uvh-private'], 'Mail must not join the application/database network');
  }
  assert.deepEqual(mail.services.front.ports.map(p => p.target).sort((a, b) => a - b), [25, 465, 587, 993]);
  console.log('PASS: immutable images, private ports, independent DB roles, exact proxy trust, unique endpoints and isolated mail');
} finally {
  rmSync(work, { recursive: true, force: true });
}
