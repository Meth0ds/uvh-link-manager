import { createApp } from "./app.js";
import { config } from "./config.js";
import { db, q, migrate } from "./db.js";
import { resendDelivery } from "./services/webhooks.js";

migrate();

const app = createApp();

// Bind to 0.0.0.0 so the managed preview can reach the API.
app.listen(config.port, "0.0.0.0", () => {
  console.log(`[uvh-api] listening on 0.0.0.0:${config.port} (${config.env})`);
});

// ---------------- Scheduler (replaces Laravel cron; in-process) ----------------
const RETENTION_DAYS = Number(process.env.ANALYTICS_RETENTION_DAYS ?? 180);
const EVENTS_PURGE_BATCH = 5000;
// Expired/revoked sessions older than this are deleted (configurable).
const SESSION_PURGE_DAYS = Number(process.env.SESSION_PURGE_DAYS ?? 30);
// Used/expired email tokens older than this are deleted.
const TOKEN_PURGE_DAYS = Number(process.env.TOKEN_PURGE_DAYS ?? 7);
// Successful webhook deliveries older than this are deleted (failed/pending are kept).
const DELIVERY_PURGE_DAYS = Number(process.env.DELIVERY_PURGE_DAYS ?? 90);
// Append-only audit trail retained for this long.
const AUDIT_PURGE_DAYS = Number(process.env.AUDIT_PURGE_DAYS ?? 365);

function runJobs(): void {
  const now = new Date().toISOString();
  try {
    // Scheduled links become active
    q.prepare(
      `UPDATE links SET state = 'active', updated_at = ? WHERE state = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?`,
    ).run(now, now);
    // Expired links
    q.prepare(
      `UPDATE links SET state = 'expired', updated_at = ? WHERE state = 'active' AND expires_at IS NOT NULL AND expires_at < ?`,
    ).run(now, now);
    // Purge old click events (retention)
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
    q.prepare(`DELETE FROM click_events WHERE occurred_at < ? LIMIT ${EVENTS_PURGE_BATCH}`).run(cutoff);
    // Purge old rollups beyond retention
    q.prepare(`DELETE FROM metric_rollups WHERE day < ?`).run(cutoff.slice(0, 10));
    // Retry pending webhook deliveries
    const pending = q
      .prepare(`SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ? LIMIT 20`)
      .all(now) as Array<{ id: number }>;
    for (const p of pending) {
      resendDelivery(p.id);
    }
    // Housekeeping: stop tables from growing unboundedly.
    const sessionCutoff = new Date(Date.now() - SESSION_PURGE_DAYS * 86400_000).toISOString();
    q.prepare(
      `DELETE FROM sessions WHERE (revoked_at IS NOT NULL OR expires_at < ?) AND expires_at < ?`,
    ).run(now, sessionCutoff);
    const tokenCutoff = new Date(Date.now() - TOKEN_PURGE_DAYS * 86400_000).toISOString();
    q.prepare(`DELETE FROM email_tokens WHERE (used_at IS NOT NULL OR expires_at < ?) AND created_at < ?`).run(
      now, tokenCutoff,
    );
    const deliveryCutoff = new Date(Date.now() - DELIVERY_PURGE_DAYS * 86400_000).toISOString();
    q.prepare(`DELETE FROM webhook_deliveries WHERE status = 'success' AND delivered_at < ?`).run(deliveryCutoff);
    const auditCutoff = new Date(Date.now() - AUDIT_PURGE_DAYS * 86400_000).toISOString();
    q.prepare(`DELETE FROM audit_events WHERE created_at < ?`).run(auditCutoff);
  } catch (err) {
    console.error("[scheduler] job failed", err);
  }
}

setInterval(runJobs, 60_000);
runJobs();

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[uvh-api] received ${sig}, shutting down`);
    process.exit(0);
  });
}
