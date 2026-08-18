import { db, q } from "../db.js";
import { hashIp } from "./crypto.js";

export interface AuditContext {
  userId?: number | null;
  ip?: string;
}

/**
 * Append-only audit trail. Records are never updated or deleted by the app.
 * Never log tokens, passwords, cookies or sensitive query strings.
 */
export function audit(
  ctx: AuditContext,
  action: string,
  resourceType?: string | null,
  resourceId?: string | number | null,
  metadata?: Record<string, unknown> | null,
): void {
  q.prepare(
    `INSERT INTO audit_events (user_id, action, resource_type, resource_id, metadata, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    ctx.userId ?? null,
    action,
    resourceType ?? null,
    resourceId == null ? null : String(resourceId),
    metadata ? JSON.stringify(metadata) : null,
    ctx.ip ? hashIp(ctx.ip) : null,
  );
}
