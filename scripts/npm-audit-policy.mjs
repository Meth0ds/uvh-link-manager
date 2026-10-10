import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const exception = Object.freeze({
  advisory: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
  expiresAt: '2026-11-09T00:00:00Z',
  packages: ['braces', 'chokidar', 'karma', '@angular/build', 'karma-jasmine', 'karma-jasmine-html-reporter'],
});
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const demand = (condition, message) => { if (!condition) throw new Error(message); };

/** Fail closed on malformed npm v2 reports and unreviewed exception propagation. */
export function evaluateAudit(report, lock, now = new Date()) {
  demand(report?.auditReportVersion === 2 && !report.error && object(report.vulnerabilities), 'Invalid npm audit report');
  demand(lock?.lockfileVersion === 3 && object(lock.packages), 'Invalid npm lockfile');
  demand(Number.isFinite(now.getTime()), 'Invalid audit date');
  const counts = report.metadata?.vulnerabilities;
  demand(object(counts) && object(report.metadata?.dependencies), 'Incomplete audit metadata');
  const actual = Object.fromEntries(severities.map(level => [level, 0]));
  const findings = report.vulnerabilities;
  for (const [name, finding] of Object.entries(findings)) {
    demand(object(finding) && finding.name === name && severities.includes(finding.severity), `Invalid finding: ${name}`);
    demand(Array.isArray(finding.via) && finding.via.length > 0 && Array.isArray(finding.nodes) && finding.nodes.length > 0, `Incomplete finding: ${name}`);
    actual[finding.severity]++;
    for (const node of finding.nodes) {
      demand(typeof node === 'string' && object(lock.packages[node]), `Finding missing from lockfile: ${name}`);
      demand(node === `node_modules/${name}` || node.endsWith(`/node_modules/${name}`), `Unexpected finding node: ${name}`);
    }
    for (const via of finding.via) {
      if (typeof via === 'string') {
        demand(object(findings[via]), `Unresolved advisory propagation: ${name} -> ${via}`);
      } else {
        demand(object(via) && typeof via.url === 'string' && via.url.startsWith('https://github.com/advisories/GHSA-') && severities.includes(via.severity) && typeof via.name === 'string', `Invalid advisory: ${name}`);
      }
      const level = typeof via === 'string' ? findings[via].severity : via.severity;
      demand(severities.indexOf(finding.severity) >= severities.indexOf(level), `Understated advisory severity: ${name}`);
    }
  }
  for (const level of severities) {
    demand(Number.isInteger(counts[level]) && counts[level] === actual[level], `Inconsistent audit count: ${level}`);
  }
  demand(counts.total === Object.keys(findings).length, 'Inconsistent audit total');
  for (const field of ['prod', 'dev', 'optional', 'peer', 'peerOptional', 'total']) {
    demand(Number.isInteger(report.metadata.dependencies[field]) && report.metadata.dependencies[field] >= 0, `Incomplete dependency metadata: ${field}`);
  }

  const resolvesToException = (name, visited = new Set()) => {
    if (visited.has(name)) return false;
    const finding = findings[name];
    if (!exception.packages.includes(name) || finding.severity === 'critical') return false;
    // npm dev:true means there is no production reachability, including peers.
    if (finding.nodes.some(node => lock.packages[node].dev !== true)) return false;
    const next = new Set(visited).add(name);
    return finding.via.every(via => typeof via === 'string'
      ? resolvesToException(via, next)
      : name === 'braces' && via.name === 'braces' && via.url === exception.advisory && via.severity === 'high');
  };
  const blocked = [];
  const accepted = [];
  for (const [name, finding] of Object.entries(findings)) {
    if (severities.indexOf(finding.severity) < 2) continue;
    if (now >= new Date(exception.expiresAt) || !resolvesToException(name)) blocked.push(name);
    else accepted.push(name);
  }
  return { ok: blocked.length === 0, blocked, accepted, expiresAt: exception.expiresAt };
}

function main() {
  demand(process.argv.length <= 3, 'Use one quoted report path');
  const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '../frontend');
  const reportPath = resolve(frontend, process.argv[2] ?? '../.uvh-runtime/npm-audit/frontend-audit.json');
  mkdirSync(dirname(reportPath), { recursive: true });
  const audit = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--json', '--audit-level=moderate'], {
    cwd: frontend, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000,
  });
  // Preserve full output even on registry errors, parse failures or policy rejection.
  writeFileSync(reportPath, audit.stdout ?? '');
  writeFileSync(`${reportPath}.stderr.log`, audit.stderr ?? '');
  demand(!audit.error && !audit.signal && [0, 1].includes(audit.status), 'npm audit failed to produce a report');
  const result = evaluateAudit(JSON.parse(audit.stdout), JSON.parse(readFileSync(resolve(frontend, 'package-lock.json'), 'utf8')));
  console.log(JSON.stringify({ ...result, reportPath }, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Audit blocked: ${error.message}`); process.exitCode = 1; }
}
