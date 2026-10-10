#!/usr/bin/env node
// Disposable real-PostgreSQL drill. Never reads a production env file or data.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
mkdirSync(join(root, '.uvh-runtime'), { recursive: true });
const work = mkdtempSync(join(root, '.uvh-runtime/upcloud-postgres-drill-'));
const tls = join(work, 'tls');
const secrets = join(work, 'secrets');
mkdirSync(tls, { mode: 0o700 });
mkdirSync(secrets, { mode: 0o700 });
const project = `uvh-pg-drill-${randomBytes(5).toString('hex')}`;
const compose = join(work, 'compose.json');
const image = 'uvh-postgres:upcloud-drill';

function run(command, args, expectFailure = false) {
  const r = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (expectFailure) {
    assert.notEqual(r.status, 0, `Unexpected success: ${command} ${args.join(' ')}`);
  } else {
    assert.equal(r.status, 0, `${command} failed:\n${r.stdout}\n${r.stderr}`);
  }
  return r;
}
function dc(...args) { return run('docker', ['compose', '-p', project, '-f', compose, ...args]); }

for (const role of ['admin', 'password', 'migration_password', 'backup_password']) {
  const name = role === 'admin' ? 'uvh_db_admin_password' : `uvh_db_${role}`;
  // Test credentials are readable only through explicitly mounted secret
  // files; their parent directory is private to this user on the host.
  writeFileSync(join(secrets, name), randomBytes(36).toString('base64url'), { mode: 0o644 });
}
run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=UVH disposable PostgreSQL CA',
  '-keyout', join(tls, 'ca.key'), '-out', join(tls, 'ca.pem')]);
run('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=postgres',
  '-keyout', join(tls, 'server.key'), '-out', join(tls, 'server.csr')]);
writeFileSync(join(tls, 'server.ext'), 'subjectAltName=DNS:postgres\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n');
run('openssl', ['x509', '-req', '-days', '2', '-in', join(tls, 'server.csr'), '-CA', join(tls, 'ca.pem'),
  '-CAkey', join(tls, 'ca.key'), '-CAserial', join(tls, 'ca.srl'), '-CAcreateserial', '-extfile', join(tls, 'server.ext'), '-out', join(tls, 'server.crt')]);
run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=Untrusted disposable CA',
  '-keyout', join(tls, 'wrong.key'), '-out', join(tls, 'wrong.pem')]);

const files = Object.fromEntries(['uvh_db_admin_password', 'uvh_db_password', 'uvh_db_migration_password', 'uvh_db_backup_password']
  .map(name => [name, { file: join(secrets, name) }]));
writeFileSync(compose, JSON.stringify({
  services: {
    'prepare-tls': {
      image, user: '0:0', entrypoint: ['/bin/sh', '-ec'],
      command: ['cp /seed/server.crt /seed/server.key /seed/ca.pem /seed/wrong.pem /tls/; chown -R 70:70 /tls; chmod 600 /tls/server.key; chmod 644 /tls/*.pem /tls/server.crt'],
      volumes: [`${tls}:/seed:ro`, 'tls:/tls'], network_mode: 'none',
    },
    postgres: {
      image, mem_limit: '256m', shm_size: '64m',
      environment: { POSTGRES_DB: 'uvh', POSTGRES_USER: 'postgres', POSTGRES_PASSWORD_FILE: '/run/secrets/uvh_db_admin_password',
        POSTGRES_INITDB_ARGS: '--auth-local=peer --auth-host=scram-sha-256' },
      secrets: Object.keys(files), volumes: ['data:/var/lib/postgresql/data', 'tls:/tls:ro'],
      depends_on: { 'prepare-tls': { condition: 'service_completed_successfully' } },
      healthcheck: { test: ['CMD-SHELL', 'pg_isready -U postgres -d uvh'], interval: '1s', timeout: '3s', retries: 40 },
      networks: { private: { aliases: ['postgres-wrong'] } },
    },
  },
  volumes: { data: {}, tls: {} }, secrets: files,
  networks: { private: { ipam: { config: [{ subnet: '172.30.0.0/24' }] } } },
}, null, 2));

function sql(role, secret, statements, options = {}, expectFailure = false) {
  const connection = `host=${options.host ?? 'postgres'} dbname=uvh user=${role} sslmode=${options.sslmode ?? 'verify-full'} sslrootcert=${options.ca ?? '/tls/ca.pem'}`;
  const args = ['compose', '-p', project, '-f', compose, 'exec', '-T', 'postgres', 'sh', '-ec',
    'export PGPASSWORD="$(cat "/run/secrets/$1")"; shift; exec psql --no-psqlrc --set ON_ERROR_STOP=1 "$@"', 'uvh-test', secret,
    connection, '--tuples-only', '--no-align'];
  for (const statement of statements) args.push('-c', statement);
  return run('docker', args, expectFailure);
}

let started = false;
try {
  console.log('Building the PostgreSQL configuration drill image');
  run('docker', ['build', '-t', image, '-f', 'docker/postgres/Dockerfile.upcloud', '.']);
  started = true;
  dc('up', '-d', '--wait', '--wait-timeout', '90');
  sql('uvh_migrator', 'uvh_db_migration_password', [
    'CREATE TABLE public.role_probe (id bigserial PRIMARY KEY, value text NOT NULL);',
  ]);
  const tlsResult = sql('uvh_app', 'uvh_db_password', [
    "INSERT INTO public.role_probe(value) VALUES ('persisted');",
    'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();',
  ]);
  assert.match(tlsResult.stdout, /\nt\n/);
  sql('uvh_app', 'uvh_db_password', ['CREATE TABLE public.forbidden (id int);'], {}, true);
  sql('uvh_app', 'uvh_db_password', ['DROP TABLE public.role_probe;'], {}, true);
  sql('uvh_app', 'uvh_db_password', ["CREATE ROLE forbidden LOGIN;"], {}, true);
  sql('uvh_backup', 'uvh_db_backup_password', ['SET default_transaction_read_only=off;',
    "INSERT INTO public.role_probe(value) VALUES ('forbidden');"], {}, true);
  assert.match(sql('uvh_backup', 'uvh_db_backup_password', ['SELECT value FROM public.role_probe;']).stdout, /persisted/);
  for (const options of [{ sslmode: 'disable' }, { ca: '/tls/wrong.pem' }, { host: 'postgres-wrong' }]) {
    sql('uvh_app', 'uvh_db_password', ['SELECT 1;'], options, true);
  }
  sql('postgres', 'uvh_db_admin_password', ['SELECT 1;'], {}, true);
  dc('exec', '-T', 'postgres', 'sh', '-ec',
    'export PGPASSWORD="$(cat /run/secrets/uvh_db_backup_password)"; pg_dump --no-owner --no-acl --format=custom "host=postgres dbname=uvh user=uvh_backup sslmode=verify-full sslrootcert=/tls/ca.pem" > /tmp/probe.dump; pg_restore --list /tmp/probe.dump > /tmp/probe.list; grep -q role_probe /tmp/probe.list');
  const hashes = dc('exec', '-T', '--user', 'postgres', 'postgres', 'psql', '--no-psqlrc', '-U', 'postgres', '-d', 'uvh', '-Atc',
    "SELECT count(*) FROM pg_authid WHERE rolname IN ('uvh_app','uvh_migrator','uvh_backup') AND rolpassword LIKE 'SCRAM-SHA-256$%';");
  assert.equal(hashes.stdout.trim(), '3');
  const container = dc('ps', '-q', 'postgres').stdout.trim();
  const bindings = JSON.parse(run('docker', ['inspect', '--format', '{{json .HostConfig.PortBindings}}', container]).stdout);
  assert.ok(!bindings || Object.keys(bindings).length === 0, 'Database port must remain private');
  dc('restart', 'postgres');
  dc('up', '-d', '--wait', '--wait-timeout', '60', 'postgres');
  assert.equal(sql('uvh_app', 'uvh_db_password', ['SELECT count(*) FROM public.role_probe;']).stdout.trim(), '1');
  console.log('PASS: TLS verification, cleartext/CA/host rejection, SCRAM, role isolation, dump and persistence');
} finally {
  if (started) dc('down', '--volumes', '--remove-orphans');
  console.log(`Disposable drill evidence directory: ${work}`);
}
