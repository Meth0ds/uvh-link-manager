#!/usr/bin/env node
// Tests the real UpCloud Caddyfile and proxy rules. Only ACME issuance is
// replaced with disposable certificates; DNS renewal remains a launch gate.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
mkdirSync(join(root, '.uvh-runtime'), { recursive: true });
const work = mkdtempSync(join(root, '.uvh-runtime/upcloud-caddy-drill-'));
// These keys sign disposable fixtures only. The non-root Caddy test process
// needs to read the mounted fixture directory and its short-lived server key.
chmodSync(work, 0o755);
const origin = join(work, 'origin');
mkdirSync(origin);
const image = 'uvh-caddy:upcloud-validation';
const project = `uvh-edge-drill-${randomBytes(5).toString('hex')}`;
const compose = join(work, 'compose.json');
const token = join(work, 'token');
writeFileSync(token, 'A'.repeat(40));
copyFileSync(join(root, 'docker/caddy/access-operator.caddy.example'), join(origin, 'access.caddy'));

function run(command, args) {
  const r = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw r.error;
  assert.equal(r.status, 0, `${command} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
function dc(...args) { return run('docker', ['compose', '-p', project, '-f', compose, ...args]); }
function certificate(name, ca, extension) {
  run('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${name}`,
    '-keyout', join(work, `${name}.key`), '-out', join(work, `${name}.csr`)]);
  writeFileSync(join(work, `${name}.ext`), extension);
  run('openssl', ['x509', '-req', '-days', '2', '-in', join(work, `${name}.csr`), '-CA', join(work, `${ca}.pem`),
    '-CAkey', join(work, `${ca}.key`), '-CAserial', join(work, `${ca}.srl`), '-CAcreateserial',
    '-extfile', join(work, `${name}.ext`), '-out', join(work, `${name}.pem`)]);
}
for (const name of ['ca', 'wrong-ca']) {
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', `/CN=${name}`,
    '-keyout', join(work, `${name}.key`), '-out', join(work, `${name}.pem`)]);
}
certificate('server', 'ca', 'subjectAltName=DNS:uvh.es,DNS:app.uvh.es,DNS:www.uvh.es,DNS:webmail.uvh.es\nextendedKeyUsage=serverAuth\n');
certificate('client', 'ca', 'extendedKeyUsage=clientAuth\n');
certificate('wrong-client', 'wrong-ca', 'extendedKeyUsage=clientAuth\n');
chmodSync(join(work, 'server.key'), 0o644);
run('cp', [join(work, 'ca.pem'), join(origin, 'client-ca.pem')]);

const env = { ACME_EMAIL: 'legal@uvh.es', UVH_ACCESS_MODE: 'operator', UVH_OPERATOR_CIDRS: '198.51.100.9/32',
  UVH_CLOUDFLARE_CIDRS: '172.32.0.4/32' };
const args = ['run', '--rm', '--network', 'none', '-v', `${origin}:/etc/uvh-origin:ro`,
  '-v', `${token}:/run/secrets/uvh_cloudflare_dns_token:ro`];
for (const [key, value] of Object.entries(env)) args.push('-e', `${key}=${value}`);
console.log('Building and adapting the real UpCloud Caddyfile');
run('docker', ['build', '-t', image, '-f', 'docker/caddy/Dockerfile.upcloud', '.']);
const config = JSON.parse(run('docker', [...args, image, 'caddy', 'adapt', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']));
// The real TLS policies, mTLS trust pool, host matching and all proxy headers
// remain untouched. No network access or real DNS token is needed for this drill.
delete config.apps.tls.automation;
config.apps.tls.certificates = { load_files: [{ certificate: '/fixtures/server.pem', key: '/fixtures/server.key' }] };
for (const server of Object.values(config.apps.http.servers)) server.automatic_https = { disable: true };
writeFileSync(join(work, 'caddy.json'), JSON.stringify(config));
writeFileSync(join(work, 'index.php'), '<?php header("Content-Type: application/json"); echo json_encode(getallheaders());');
writeFileSync(join(work, 'request.php'), `<?php
$ch = curl_init('https://'.$argv[1].'/probe');
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8,
 CURLOPT_RESOLVE => [$argv[1].':443:172.32.0.2'], CURLOPT_CAINFO => '/fixtures/ca.pem',
 CURLOPT_HTTPHEADER => ['CF-Connecting-IP: 198.51.100.9', 'X-Forwarded-For: 203.0.113.77',
 'Forwarded: for=203.0.113.77', 'X-Forwarded-Proto: http', 'CF-IPCountry: XX',
 'Host: '.($argv[3] ?? $argv[1])]]);
if ($argv[2] !== 'none') {
 curl_setopt($ch, CURLOPT_SSLCERT, '/fixtures/'.$argv[2].'.pem');
 curl_setopt($ch, CURLOPT_SSLKEY, '/fixtures/'.$argv[2].'.key');
}
$body = curl_exec($ch);
echo json_encode(['error'=>curl_errno($ch), 'status'=>curl_getinfo($ch, CURLINFO_HTTP_CODE), 'body'=>$body]);
`);
const phpImage = 'uvh-php:8.4'; // Existing extension-verified local test image.
const php = { image: phpImage, entrypoint: ['php'], volumes: [`${work}:/fixtures:ro`] };
writeFileSync(compose, JSON.stringify({ services: {
  mock: { ...php, command: ['-S', '0.0.0.0:8080', '-t', '/fixtures'], networks: { private: { ipv4_address: '172.32.0.3', aliases: ['nginx'] } } },
  'mock-mail': { ...php, command: ['-S', '0.0.0.0:80', '-t', '/fixtures'], networks: { private: { ipv4_address: '172.32.0.6', aliases: ['mail-front'] } } },
  probe: { ...php, command: ['-r', 'sleep(3600);'], networks: { private: { ipv4_address: '172.32.0.4' } } },
  untrusted: { ...php, command: ['-r', 'sleep(3600);'], networks: { private: { ipv4_address: '172.32.0.5' } } },
  edge: { image, environment: env, command: ['caddy', 'run', '--config', '/fixtures/caddy.json'],
    volumes: [`${work}:/fixtures:ro`, `${origin}:/etc/uvh-origin:ro`, `${token}:/run/secrets/uvh_cloudflare_dns_token:ro`],
    networks: { private: { ipv4_address: '172.32.0.2' } }, depends_on: ['mock', 'mock-mail'],
    healthcheck: { test: ['CMD-SHELL', 'wget -q -O /dev/null http://127.0.0.1:2019/config/'], interval: '1s', timeout: '2s', retries: 30 } },
}, networks: { private: { ipam: { config: [{ subnet: '172.32.0.0/24' }] } } } }, null, 2));

function request(service, hostname, client = 'client', host = hostname) {
  return JSON.parse(dc('exec', '-T', service, 'php', '/fixtures/request.php', hostname, client, host));
}
try {
  dc('up', '-d', '--wait', '--wait-timeout', '60');
  for (const client of ['none', 'wrong-client']) {
    const result = request('probe', 'uvh.es', client);
    assert.notEqual(result.error, 0, 'Untrusted clients must fail TLS');
    assert.equal(result.status, 0);
  }
  for (const hostname of ['uvh.es', 'app.uvh.es', 'webmail.uvh.es']) {
    const result = request('probe', hostname);
    assert.equal(result.error, 0);
    assert.equal(result.status, 200);
    const headers = Object.fromEntries(Object.entries(JSON.parse(result.body)).map(([k, v]) => [k.toLowerCase(), v]));
    assert.equal(headers['x-forwarded-for'], '198.51.100.9');
    assert.equal(headers['x-forwarded-proto'], 'https');
    assert.equal(headers['x-real-ip'], '198.51.100.9');
    assert.equal(headers.forwarded, undefined);
    assert.equal(headers['cf-connecting-ip'], undefined);
    if (hostname !== 'webmail.uvh.es') assert.equal(headers['cf-ipcountry'], undefined);
  }
  assert.equal(request('untrusted', 'uvh.es').status, 503, 'An untrusted peer must not spoof the operator IP');
  assert.equal(request('probe', 'uvh.es', 'client', 'unexpected.uvh.es').status, 421, 'Host/SNI mismatch must fail');
  assert.equal(request('probe', 'www.uvh.es').status, 301);
  console.log('PASS: zone mTLS, wrong CA rejection, trusted proxy IP, spoof rejection, operator restriction, host rejection, webmail and www');
} finally {
  dc('down', '--volumes', '--remove-orphans');
  console.log(`Disposable drill evidence directory: ${work}`);
}
