#!/usr/bin/env node
/** Linux x64 SEA smoke in an isolated container; Docker itself is a fixture. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'uvh-sea-linux-')));
const container = 'uvh-sea-linux-' + randomUUID();
const image = 'php:8.4.27-cli@sha256:1d7cdadb6f25e13425abcd9e7648955b7c297b6fb70e5a8f95b77f28df3bf8d8';
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
function read(path, port = 4320) {
  return docker(['exec', container, 'php', '-r', `echo file_get_contents(${JSON.stringify(`http://127.0.0.1:${port}${path}`)});`]);
}
let started = false;
try {
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'docker-compose.local.yml'), 'services: {}');
  writeFileSync(join(root, '.env.docker.local'), 'POSTGRES_DB=uvh_smoke_test\nUVH_RECOVERY_ENABLED=true\n');
  writeFileSync(join(root, 'bin/docker'), '#!/bin/sh\ncase "$1" in\ninfo) echo 99.smoke ;;\n--version) echo Docker-smoke ;;\ncompose) echo "" ;;\n*) exit 99 ;;\nesac\n');
  chmodSync(join(root, 'bin/docker'), 0o755);
  docker(['run', '--rm', '-d', '--platform', 'linux/amd64', '--name', container,
    '--mount', `type=bind,source=${root},target=/fixture`, '--mount', `type=bind,source=${resolve('dist/uvh-control-linux-x64')},target=/usr/local/bin/uvh-control,readonly`,
    '--workdir', '/fixture', '-e', 'UVH_CONTROL_ROOT=/fixture', '-e', 'PATH=/fixture/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin',
    '--entrypoint', '/usr/local/bin/uvh-control', image, 'serve', '--no-browser', '--port', '4320']);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { ready = read('/').includes('<app-root'); } catch { /* Container may still be booting. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, docker(['logs', container]));
  const html = read('/');
  const script = html.match(/src="(main[^" ]+\.js)"/);
  assert.ok(script, 'Compiled Angular entrypoint missing.');
  assert.ok(read('/' + script[1]).length > 1000);
  const session = JSON.parse(read('/api/session'));
  const state = JSON.parse(docker(['exec', container, 'php', '-r', `
    $context = stream_context_create(['http' => ['header' => ${JSON.stringify('X-UVH-Session: ' + session.token)}]]);
    echo file_get_contents('http://127.0.0.1:4320/api/state', false, $context);
  `]));
  assert.equal(state.schema, 1);
  assert.ok(read('/__uvh/admin', 4200).includes('Centro de recuperación'));
  assert.ok(read('/__uvh/admin.js', 4200).includes('uvh-recovery-ticket'));
  assert.ok(read('/__uvh/style.css', 4200).length > 1000);
  console.log('PASS: Linux x64 SEA · isolated container · compiled Angular assets · protected session · independent frozen recovery resources.');
} finally {
  if (started) docker(['rm', '-f', container]);
  rmSync(root, { recursive: true, force: true });
}
