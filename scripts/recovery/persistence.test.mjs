import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backupCategory, planRetention } from './backup-catalog.mjs';
import { createRecoveryRepository } from './state-repository.mjs';
import { createBridgePublisher } from './bridge-publisher.mjs';
import { createStore, unwrap, envelope } from './store.mjs';

const key = 'c'.repeat(64);
test('historical categories require unambiguous operation evidence and preserve the GCM tag', () => {
  const entry = { id: 'copy', tag: 'deadbeef', restoredAt: '2026-10-24', createdAt: '2026-10-23' };
  const weekly = { action: 'backup', backupId: 'copy', target: { tag: 'weekly' } };
  assert.equal(backupCategory(entry, [weekly]), 'weekly');
  assert.equal(backupCategory(entry, [weekly, { action: 'install', backupId: 'copy' }]), 'unknown');
  assert.equal(backupCategory(entry), 'unknown');
  assert.equal(entry.tag, 'deadbeef');
  assert.deepEqual(planRetention([{ ...entry, category: 'unknown' }]).remove, []);
});

test('catalog reads authenticate one document and never duplicate a destination read', () => {
  const reads = [];
  const store = { read: name => { reads.push(name); return envelope(key, [{ id: 'fixture' }]); } };
  const repository = createRecoveryRepository(store, key, () => []);
  assert.equal(repository.destinations()[0].id, 'fixture');
  assert.deepEqual(reads, ['destinations']);
});

test('bridge renews expiry without rebuilding projections and invalidates on credential writes', () => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'uvh-publication-test-')));
  try {
    const store = createStore(folder);
    let time = 1000, builds = 0, value = false, configured = false;
    const publish = createBridgePublisher({ bridge: folder, key, clock: () => time, revision: () => store.revision,
      snapshot: () => { builds++; return { configured, nested: { value } }; }, maintenance: () => ({ maintenance: value }) });
    const read = name => unwrap(key, JSON.parse(readFileSync(join(folder, name), 'utf8')));
    publish();
    assert.equal(read('snapshot.json').expires, 91000);
    time += 10000; publish();
    assert.equal(builds, 1);
    assert.equal(read('snapshot.json').expires, 101000);
    configured = true;
    store.write('credentials', {}); publish();
    assert.equal(builds, 2);
    assert.equal(read('snapshot.json').configured, true);
    value = true; store.write('state', {}); publish();
    assert.equal(read('maintenance.json').maintenance, true);
    unlinkSync(join(folder, 'maintenance.json')); publish();
    assert.equal(read('maintenance.json').maintenance, true);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
