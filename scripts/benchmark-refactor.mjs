#!/usr/bin/env node
/** Isolated, reproducible I/O characterization. Never opens an application DB. */
import fs from 'node:fs';
import { syncBuiltinESMExports as syncBuiltins } from 'node:module';
import { join, resolve, basename } from 'node:path';
import { tmpdir, platform, arch } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const source = resolve(process.argv[2] ?? '.');
const output = process.argv[3];
const digest = value => createHash('sha256').update(value).digest('hex');
const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'uvh-refactor-benchmark-')));
const originalRead = fs.readFileSync, originalRename = fs.renameSync;
let counters = null;
fs.readFileSync = function (path, ...args) {
  const value = originalRead.call(this, path, ...args);
  if (counters && String(path).startsWith(root)) {
    counters.reads[basename(String(path))] = (counters.reads[basename(String(path))] ?? 0) + 1;
    counters.readBytes += Buffer.byteLength(value);
  }
  return value;
};
fs.renameSync = function (from, to, ...args) {
  const result = originalRename.call(this, from, to, ...args);
  if (counters && String(to).startsWith(root)) {
    counters.writes[basename(String(to))] = (counters.writes[basename(String(to))] ?? 0) + 1;
    counters.writtenBytes += fs.statSync(to).size;
  }
  return result;
};
syncBuiltins();
async function measure(task) {
  counters = { reads: {}, writes: {}, readBytes: 0, writtenBytes: 0 };
  const start = performance.now();
  try { await task(); return { ...counters, milliseconds: performance.now() - start }; }
  finally { counters = null; }
}
const report = { source, node: process.version, platform: platform(), arch: arch(), at: new Date().toISOString() };
try {
  const { createRecoveryEngine } = await import(pathToFileURL(join(source, 'scripts/recovery/engine.mjs')));
  const { envelope } = await import(pathToFileURL(join(source, 'scripts/recovery/store.mjs')));
  const home = join(root, 'runtime'); fs.mkdirSync(home);
  fs.writeFileSync(join(home, 'settings.json'), JSON.stringify({ enabled: true, daily: false }));
  const sha = 'a'.repeat(40), payload = 'encrypted fixture', clock = Date.parse('2026-10-24T12:00:00Z');
  const io = Object.fromEntries(['clean', 'prepare', 'quiesce', 'backup', 'verify', 'unpack', 'start', 'health', 'reopen'].map(name => [name, async () => {}]));
  io.head = async () => sha;
  io.encrypt = async (_folder, path) => { fs.writeFileSync(path, payload); return { iv: '00', tag: '00', bytes: payload.length, digest: digest(payload) }; };
  const engine = createRecoveryEngine({ root, home, io, clock: () => clock,
    github: { check: async () => ({ from: sha, sha, eligible: true }) },
    exclusive: { acquire: async () => ({}), release: async () => {} } });
  const ticket = Buffer.from(JSON.stringify(envelope(engine.bridgeKey, { purpose: 'recovery-access', id: randomUUID(), actor: 1, expires: clock + 59000 }))).toString('base64url');
  const access = engine.auth.login({ ticket }); engine.enrol(access.token);
  report.backup = await measure(async () => { await engine.admit('backup', { tag: 'manual' }, randomUUID()); await engine.idle(); });
  if (engine.snapshot().operation.state !== 'completed') throw Error('The benchmark backup did not complete.');
  report.backup.totalWrites = Object.values(report.backup.writes).reduce((a, b) => a + b, 0);
  const key = fs.readFileSync(join(home, 'metadata-key'), 'utf8');
  report.snapshots = [];
  for (const size of [10, 100, 1000]) {
    engine.store.write('backups', envelope(key, Array.from({ length: size }, (_, index) => ({ id: `fixture-${index}`, sha, tag: '00', category: 'manual', iv: '00', digest: digest(payload), bytes: 17, createdAt: new Date(clock - index * 86400000).toISOString(), restoredAt: new Date(clock).toISOString() }))));
    const samples = [];
    for (let warmup = 0; warmup < 30; warmup++) engine.snapshot();
    for (let trial = 0; trial < 300; trial++) {
      const start = performance.now(); engine.snapshot(); samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    engine.start(); engine.stop(); // Prime the authenticated projection.
    const publication = await measure(async () => { for (let cycle = 0; cycle < 30; cycle++) { engine.start(); engine.stop(); } });
    report.snapshots.push({ size, medianMs: samples[150], p95Ms: samples[285], renewal: publication });
  }
  const require = createRequire(new URL('../frontend/package.json', import.meta.url));
  const ts = require('typescript');
  const code = ts.transpileModule(fs.readFileSync(join(source, 'frontend/src/app/core/strict-wire.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const wire = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const Formatter = Intl.DateTimeFormat; let formatters = 0;
  Intl.DateTimeFormat = function (...args) { formatters++; return new Formatter(...args); };
  const conversions = [], start = performance.now();
  try {
    for (let rule = 0; rule < 20; rule++) for (const date of ['2026-01-15', '2026-07-15', '2026-03-29']) {
      const reference = new Date(`${date}T12:00:00Z`);
      conversions.push(wire.localTimeToUtcTime('09:30', 'Europe/Madrid', reference), wire.utcTimeToLocalTime('07:30', 'Europe/Madrid', reference));
    }
    report.times = { conversions: conversions.length, formatters, milliseconds: performance.now() - start, resultSha256: digest(JSON.stringify(conversions)) };
    const samples = [];
    for (let trial = 0; trial < 30; trial++) {
      const warmStart = performance.now();
      for (let rule = 0; rule < 20; rule++) for (const date of ['2026-01-15', '2026-07-15', '2026-03-29']) {
        const reference = new Date(`${date}T12:00:00Z`);
        wire.localTimeToUtcTime('09:30', 'Europe/Madrid', reference);
        wire.utcTimeToLocalTime('07:30', 'Europe/Madrid', reference);
      }
      samples.push(performance.now() - warmStart);
    }
    samples.sort((a, b) => a - b);
    report.times.warmMedianMs = samples[15];
    report.times.warmP95Ms = samples[28];
  } finally { Intl.DateTimeFormat = Formatter; }
  report.maxRssKiB = process.resourceUsage().maxRSS;
} finally {
  fs.readFileSync = originalRead; fs.renameSync = originalRename; syncBuiltins();
  fs.rmSync(root, { recursive: true, force: true });
}
const serialized = JSON.stringify(report, null, 2) + '\n';
if (output) fs.writeFileSync(output, serialized);
else process.stdout.write(serialized);
