/** Pure backup catalog rules. Filesystem deletion stays in the engine. */
const CATEGORIES = new Set(['daily', 'weekly', 'manual', 'pre-update', 'pre-restore']);

export function backupCategory(entry, operations = []) {
  if (CATEGORIES.has(entry.category)) return entry.category;
  // Older catalogues used `tag` for GCM authentication. Never change it or
  // infer a schedule from timestamps: only an operation receipt is evidence.
  const evidence = new Set();
  for (const operation of operations) {
    if (!operation) continue;
    if (operation.preventiveBackup === entry.id) evidence.add('pre-restore');
    if (operation.backupId !== entry.id) continue;
    if (operation.action === 'install') evidence.add('pre-update');
    if (operation.action === 'backup') evidence.add(['daily', 'weekly'].includes(operation.target?.tag) ? operation.target.tag : 'manual');
  }
  return evidence.size === 1 ? [...evidence][0] : 'unknown';
}

export function planRetention(entries, { dailyRetention = 7, weeklyRetention = 4, updateRetention = 3, protectedIds = new Set() } = {}) {
  const counters = { daily: 0, weekly: 0, 'pre-update': 0 }, keep = [], remove = [];
  const pendingByTag = new Set();
  const ordered = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestGood = ordered.find(entry => entry.restoredAt);
  if (latestGood) protectedIds = new Set([...protectedIds, latestGood.id]);
  for (const entry of ordered) {
    const category = entry.category ?? entry.tag;
    const limit = category === 'daily' ? dailyRetention : category === 'weekly' ? weeklyRetention : category === 'pre-update' ? updateRetention : null;
    const required = limit === null || (counters[category] = (counters[category] ?? 0) + 1) <= limit;
    // Keep one recent unverified copy per class for diagnosis, but do not let
    // failed verification attempts grow the catalog without bound. Copies
    // attached to an open incident remain protected through `protectedIds`.
    const pending = !entry.restoredAt && !pendingByTag.has(category);
    if (pending) pendingByTag.add(category);
    if (required || entry.protected || protectedIds.has(entry.id) || pending) keep.push(entry);
    else remove.push(entry);
  }
  return { keep, remove };
}
