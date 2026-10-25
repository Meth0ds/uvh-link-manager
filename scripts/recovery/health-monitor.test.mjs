import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHealthMonitor } from './health-monitor.mjs';

test('an admitted daily copy cannot consume the weekly checkpoint while it owns the lock', async () => {
  const time = Date.UTC(2026, 9, 26, 12), now = () => new Date(time).toISOString();
  const data = { maintenance: false, lastDaily: null, lastWeekly: null, diagnosis: null };
  const admitted = []; let busy = false;
  const monitor = createHealthMonitor({ clock: () => time, now, data, publish() {}, enabled: () => true,
    isBusy: () => busy, io: { diagnose: async () => ({ healthy: true }), admins: async () => ['1'] },
    auth: { configured: () => true, reconcile() {} }, save() {}, maintenance() {}, checked: async () => {},
    configured: () => ({ daily: true }), admit: async (_action, target) => { if (busy) throw Error('Fixture: shared lock held'); admitted.push(target.tag); busy = true; },
  });
  await monitor.tick();
  assert.deepEqual(admitted, ['daily']);
  assert.equal(data.lastWeekly, null);
  busy = false; // The daily operation finished before the next controller tick.
  await monitor.tick();
  assert.deepEqual(admitted, ['daily', 'weekly']);
  assert.equal(data.lastWeekly, now());
});
