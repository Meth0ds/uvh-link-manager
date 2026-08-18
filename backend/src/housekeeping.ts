import { q, tx } from "./db.js";
import { intEnv } from "./config.js";
import { resendDelivery } from "./services/webhooks.js";

export interface HousekeepingOptions {
  /** Days of raw click events and daily rollups kept before purging. */
  analyticsRetentionDays: number;
  /** Revoked or expired sessions are deleted once older than this (days). */
  sessionPurgeDays: number;
  /** Used/expired email tokens older than this are deleted (days). */
  tokenPurgeDays: number;
  /** Successful webhook deliveries older than this are deleted (days). */
  deliveryPurgeDays: number;
  /** Audit events retained for this long (days). */
  auditPurgeDays: number;
  /** Max rows deleted per DELETE statement inside the purge loops. */
  purgeBatch: number;
  /** Minimum interval between two heavy purge passes (ms). */
  heavyIntervalMs: number;
}

/**
 * Read housekeeping options from the environment, validated strictly: an
 * invalid value throws at boot instead of being silently coerced (e.g.
 * AUDIT_PURGE_DAYS=-1 previously produced a cutoff in the future and could
 * wipe the whole audit trail).
 */
export function defaultOptions(): HousekeepingOptions {
  return {
    analyticsRetentionDays: intEnv("ANALYTICS_RETENTION_DAYS", 180, { min: 1 }),
    sessionPurgeDays: intEnv("SESSION_PURGE_DAYS", 30, { min: 1 }),
    tokenPurgeDays: intEnv("TOKEN_PURGE_DAYS", 7, { min: 1 }),
    deliveryPurgeDays: intEnv("DELIVERY_PURGE_DAYS", 90, { min: 1 }),
    auditPurgeDays: intEnv("AUDIT_PURGE_DAYS", 365, { min: 1 }),
    purgeBatch: 1000,
    heavyIntervalMs: intEnv("HOUSEKEEPING_INTERVAL_MINUTES", 60, { min: 1 }) * 60_000,
  };
}

/**
 * Delete rows matching `where` in bounded batches (SELECT ids LIMIT n →
 * DELETE WHERE id IN ...). node:sqlite does not ship SQLITE_ENABLE_UPDATE_
 * DELETE_LIMIT, so `DELETE ... LIMIT n` is a syntax error; the two-step form
 * is portable, and each DELETE stays inside its own short transaction so a
 * giant purge never blocks SQLite writers for one long write transaction.
 */
function purgeInBatches(
  table: string,
  idColumn: string,
  where: string,
  params: unknown[],
  batch: number,
): number {
  let total = 0;
  for (;;) {
    const ids = q
      .prepare(`SELECT ${idColumn} AS id FROM ${table} WHERE ${where} LIMIT ?`)
      .all(...params, batch) as Array<{ id: string | number }>;
    if (ids.length === 0) break;
    const marks = ids.map(() => "?").join(", ");
    const del = tx(() =>
      q.prepare(`DELETE FROM ${table} WHERE ${idColumn} IN (${marks})`).run(...ids.map((r) => r.id)),
    );
    total += Number(del.changes);
    if (ids.length < batch) break;
  }
  return total;
}

/**
 * Heavy housekeeping pass: purge old rows from every append-only table.
 * Sessions are deleted based on their own timestamp: revoked rows by
 * revoked_at, expired rows by expires_at. The previous query checked revoked
 * rows against expires_at, so a session revoked right after creation could
 * survive roughly twice the intended retention.
 */
export function runPurges(opts: HousekeepingOptions): void {
  const nowIso = new Date().toISOString();
  const cutoff = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

  const sessionCutoff = cutoff(opts.sessionPurgeDays);
  purgeInBatches(
    "sessions",
    "id",
    `(revoked_at IS NOT NULL AND revoked_at < ?) OR (revoked_at IS NULL AND expires_at < ?)`,
    [sessionCutoff, sessionCutoff],
    opts.purgeBatch,
  );

  const tokenCutoff = cutoff(opts.tokenPurgeDays);
  purgeInBatches(
    "email_tokens",
    "id",
    `created_at < ? AND (used_at IS NOT NULL OR expires_at < ?)`,
    [tokenCutoff, nowIso],
    opts.purgeBatch,
  );

  const deliveryCutoff = cutoff(opts.deliveryPurgeDays);
  purgeInBatches(
    "webhook_deliveries",
    "id",
    `status = 'success' AND delivered_at < ?`,
    [deliveryCutoff],
    opts.purgeBatch,
  );

  const auditCutoff = cutoff(opts.auditPurgeDays);
  purgeInBatches("audit_events", "id", `created_at < ?`, [auditCutoff], opts.purgeBatch);

  const retentionCutoff = cutoff(opts.analyticsRetentionDays);
  purgeInBatches("click_events", "id", `occurred_at < ?`, [retentionCutoff], opts.purgeBatch);
  purgeInBatches("metric_rollups", "id", `day < ?`, [retentionCutoff.slice(0, 10)], opts.purgeBatch);
}

let lastHeavyRunAt = 0;

/**
 * Scheduler tick: lightweight jobs run on every tick; the heavy purge pass is
 * throttled to heavyIntervalMs so large DELETEs do not compete with the
 * request hot path every minute.
 */
export function runHousekeeping(opts: HousekeepingOptions = defaultOptions()): void {
  const now = new Date().toISOString();
  try {
    // Scheduled links become active.
    q.prepare(
      `UPDATE links SET state = 'active', updated_at = ? WHERE state = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?`,
    ).run(now, now);
    // Expired links.
    q.prepare(
      `UPDATE links SET state = 'expired', updated_at = ? WHERE state = 'active' AND expires_at IS NOT NULL AND expires_at < ?`,
    ).run(now, now);
    // Retry pending webhook deliveries.
    const pending = q
      .prepare(
        `SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ? LIMIT 20`,
      )
      .all(now) as Array<{ id: number }>;
    for (const p of pending) {
      resendDelivery(p.id);
    }

    // Heavy pass, throttled.
    if (Date.now() - lastHeavyRunAt >= opts.heavyIntervalMs) {
      runPurges(opts);
      lastHeavyRunAt = Date.now();
    }
  } catch (err) {
    console.error("[housekeeping] job failed", err);
  }
}
