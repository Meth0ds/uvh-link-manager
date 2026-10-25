import { randomUUID } from 'node:crypto';

export function createHealthMonitor({ clock, now, publish, enabled, isBusy, data, io, auth, save, maintenance, checked, configured, admit }) {
  let polling = false, lastGithub = 0, lastProbe = 0, failures = 0, successes = 0;
  async function tick() {
    if (polling) return; polling = true;
    try {
      publish();
      if (!enabled() || isBusy()) return;
      if (clock() - lastProbe >= 30000) {
        lastProbe = clock();
        try {
          const diagnosis = await io.diagnose(); data.diagnosis = diagnosis;
          if (diagnosis.healthy) { failures = 0; successes++; } else { successes = 0; failures++; }
          if (failures >= 3 && !data.maintenance) maintenance('incident');
          if (successes >= 3 && data.reason === 'incident' && (!data.operation || ['completed', 'restored', 'failed'].includes(data.operation.state))) { data.maintenance = false; data.reason = null; data.since = null; }
          const admins = await io.admins(); auth.reconcile(admins); save();
        } catch { successes = 0; if (++failures >= 3 && !data.maintenance) maintenance('incident'); }
      }
      if (clock() - lastGithub >= 900000) { lastGithub = clock(); try { await checked(); } catch { /* GitHub failure never takes the app down. */ } }
      if (configured().daily && !data.maintenance && auth.configured() && data.diagnosis?.healthy && (!data.lastDaily || clock() - Date.parse(data.lastDaily) >= 86400000)) {
        // A failed daily backup must not run in a tight retry loop.
        data.lastDaily = now(); save(); try { await admit('backup', { tag: 'daily' }, randomUUID()); } catch { /* Another operation owns the shared lock. */ }
      }
      // Admission can return before quiescing has published maintenance.
      // Do not spend the weekly checkpoint on a lock held by that daily copy.
      if (isBusy()) return;
      const weekday = new Date(clock()).getDay();
      if (configured().daily && weekday === 1 && !data.maintenance && auth.configured() && data.diagnosis?.healthy && (!data.lastWeekly || clock() - Date.parse(data.lastWeekly) >= 6 * 86400000)) {
        data.lastWeekly = now(); save(); try { await admit('backup', { tag: 'weekly' }, randomUUID()); } catch { /* Daily or another operation owns the shared lock. */ }
      }
    } finally { polling = false; }
  }
  return { tick, reset: () => { failures = 0; successes = 0; }, checked: () => { lastGithub = clock(); } };
}
