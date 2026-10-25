import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackupRunner } from './backup-runner.mjs';

test('backup reuses its catalog during verification instead of rereading it', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'uvh-backup-runner-')));
  const home = join(root, 'home'), backupDir = join(root, 'backups');
  mkdirSync(home, { recursive: true }); mkdirSync(backupDir, { recursive: true });
  let reads = 0, saved;
  const runner = createBackupRunner({
    home,
    io: {
      clean: async () => {}, head: async () => 'a'.repeat(40),
      backup: async () => {},
      encrypt: async (folder, destination) => { writeFileSync(destination, 'encrypted'); return { iv: '00', tag: '00', digest: 'd'.repeat(64), bytes: 9 }; },
      unpack: async () => {}, verify: async () => {},
    },
    getConfig: () => ({ backupDir }), data: {}, now: () => '2026-10-25T00:00:00.000Z', clock: () => Date.now(),
    event: () => {}, save: () => {}, publish: () => {},
    backups: () => { reads++; return []; },
    saveBackups: value => { saved = value; }, destinations: () => [], saveDestinations: () => {},
  });
  try {
    const entry = await runner.backup('daily');
    assert.equal(reads, 1);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].restoredAt, '2026-10-25T00:00:00.000Z');
    assert.equal(entry.id, saved[0].id);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
