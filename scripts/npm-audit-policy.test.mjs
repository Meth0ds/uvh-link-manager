import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAudit, exception } from './npm-audit-policy.mjs';

const now = new Date('2026-10-10T00:00:00Z');
function fixture() {
  const report = {
    auditReportVersion: 2,
    vulnerabilities: {
      braces: { name: 'braces', severity: 'high', nodes: ['node_modules/braces'], via: [{ name: 'braces', severity: 'high', url: exception.advisory }] },
      karma: { name: 'karma', severity: 'high', nodes: ['node_modules/karma'], via: ['braces'] },
    },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 }, dependencies: { prod: 0, dev: 2, optional: 0, peer: 0, peerOptional: 0, total: 2 } },
  };
  const lock = { lockfileVersion: 3, packages: { 'node_modules/braces': { dev: true }, 'node_modules/karma': { dev: true } } };
  return { report, lock };
}
test('accepts only the reviewed advisory and dev-only test propagation', () => {
  const { report, lock } = fixture();
  assert.equal(evaluateAudit(report, lock, now).ok, true);
});
test('expires at the documented deadline', () => {
  const { report, lock } = fixture();
  assert.equal(evaluateAudit(report, lock, new Date(exception.expiresAt)).ok, false);
});
test('blocks an additional advisory within an otherwise exempt package', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.braces.via.push({ name: 'braces', severity: 'moderate', url: 'https://github.com/advisories/GHSA-new-advisory' });
  assert.deepEqual(evaluateAudit(report, lock, now).blocked, ['braces', 'karma']);
});
test('blocks production reachability and unknown lock nodes', () => {
  const { report, lock } = fixture();
  delete lock.packages['node_modules/braces'].dev;
  assert.equal(evaluateAudit(report, lock, now).ok, false);
  delete lock.packages['node_modules/braces'];
  assert.throws(() => evaluateAudit(report, lock, now), /missing from lockfile/);
});
test('rejects reports with missing fields or misleading summary counts', () => {
  const { report, lock } = fixture();
  delete report.metadata;
  assert.throws(() => evaluateAudit(report, lock, now), /metadata/);
  const valid = fixture();
  valid.report.metadata.vulnerabilities.high = 0;
  assert.throws(() => evaluateAudit(valid.report, valid.lock, now), /count/);
});
test('rejects unresolved and cyclic advisory propagation', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.karma.via = ['missing'];
  assert.throws(() => evaluateAudit(report, lock, now), /Unresolved/);
  report.vulnerabilities.karma.via = ['braces'];
  report.vulnerabilities.braces.via = ['karma'];
  assert.equal(evaluateAudit(report, lock, now).ok, false);
});
test('blocks new packages even if they propagate the same advisory', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.unreviewed = { name: 'unreviewed', severity: 'high', nodes: ['node_modules/unreviewed'], via: ['braces'] };
  lock.packages['node_modules/unreviewed'] = { dev: true };
  report.metadata.vulnerabilities.high++;
  report.metadata.vulnerabilities.total++;
  assert.deepEqual(evaluateAudit(report, lock, now).blocked, ['unreviewed']);
});
test('blocks a critical severity escalation', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.braces.severity = 'critical';
  report.vulnerabilities.karma.severity = 'critical';
  report.metadata.vulnerabilities.high = 0;
  report.metadata.vulnerabilities.critical = 2;
  assert.equal(evaluateAudit(report, lock, now).ok, false);
});
test('rejects an advisory whose severity was understated by its parent', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.karma.severity = 'low';
  report.metadata.vulnerabilities.high--;
  report.metadata.vulnerabilities.low++;
  assert.throws(() => evaluateAudit(report, lock, now), /Understated/);
});
