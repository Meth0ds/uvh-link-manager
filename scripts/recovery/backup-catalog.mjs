/** Pure backup catalog rules. Filesystem deletion stays in the engine. */
export function planRetention(entries, { dailyRetention = 7, weeklyRetention = 4, updateRetention = 3, protectedIds = new Set() } = {}) {
  const counters = { daily: 0, weekly: 0, 'pre-update': 0 }, keep = [], remove = [];
  const pendingByTag = new Set();
  const ordered = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestGood = ordered.find(entry => entry.restoredAt);
  if (latestGood) protectedIds = new Set([...protectedIds, latestGood.id]);
  for (const entry of ordered) {
    const limit = entry.tag === 'daily' ? dailyRetention : entry.tag === 'weekly' ? weeklyRetention : entry.tag === 'pre-update' ? updateRetention : null;
    const required = limit === null || (counters[entry.tag] = (counters[entry.tag] ?? 0) + 1) <= limit;
    // Keep one recent unverified copy per class for diagnosis, but do not let
    // failed verification attempts grow the catalog without bound. Copies
    // attached to an open incident remain protected through `protectedIds`.
    const pending = !entry.restoredAt && !pendingByTag.has(entry.tag);
    if (pending) pendingByTag.add(entry.tag);
    if (required || entry.protected || protectedIds.has(entry.id) || pending) keep.push(entry);
    else remove.push(entry);
  }
  return { keep, remove };
}
