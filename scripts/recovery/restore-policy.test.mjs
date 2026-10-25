import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSelectivePaths } from './restore-policy.mjs';

test('selective restore policy accepts bounded private paths and rejects traversal forms', () => {
  assert.deepEqual(validateSelectivePaths(['documents/report.pdf']), ['documents/report.pdf']);
  for (const paths of [[], ['../outside'], ['/absolute'], ['windows\\file'], ['control\nfile'], [null], Array.from({ length: 101 }, () => 'file')]) {
    assert.throws(() => validateSelectivePaths(paths), { code: 'invalid_restore_paths' });
  }
});
