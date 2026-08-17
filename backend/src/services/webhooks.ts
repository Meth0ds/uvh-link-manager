import { createHmac, randomUUID } from "node:crypto";
import { db, q } from "../db.js";
import { assertSafeUrl } from "../util/ssrf.js";

export const WEBHOOK_EVENTS = [
  "link.created",
  "link.updated",
  "link.deleted",
  "link.threshold_reached",
  "domain.verified",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function dispatchWebhooks(workspaceId: number, event: WebhookEvent, data: Record<string, unknown>): void {
  const webhooks = db
    .prepare(`SELECT * FROM webhooks WHERE workspace_id = ? AND active = 1`)
    .all(workspaceId) as Array<{ id: number; events: string }>;
  const eventId = randomUUID();
  const payload = JSON.stringify({ event, event_id: eventId, timestamp: new Date().toISOString(), data });

  for (const wh of webhooks) {
    const subscribed = (JSON.parse(wh.events) as string[]).includes(event);
    if (!subscribed) continue;
    const info = db
      .prepare(
        `INSERT INTO webhook_deliveries (webhook_id, event, event_id, payload, status, next_attempt_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`,
      )
      .run(wh.id, event, eventId, payload, new Date().toISOString());
    const deliveryId = Number(info.lastInsertRowid);
    void attemptDelivery(deliveryId, 0);
  }
}

async function attemptDelivery(deliveryId: number, attempt: number): Promise<void> {
  const delivery = db
    .prepare(`SELECT * FROM webhook_deliveries WHERE id = ?`)
    .get(deliveryId) as
    | { webhook_id: number; payload: string; status: string }
    | undefined;
  if (!delivery || delivery.status !== "pending") return;
  const wh = q.prepare(`SELECT * FROM webhooks WHERE id = ?`).get(delivery.webhook_id) as
    | { url: string; secret: string; active: number }
    | undefined;
  if (!wh || wh.active !== 1) return;

  try {
    // SSRF guard: webhook URLs are user-provided and fetched server-side.
    await assertSafeUrl(wh.url);
    const signature = sign(delivery.payload, wh.secret);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(wh.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-UVH-Event": delivery.payload ? (JSON.parse(delivery.payload) as { event: string }).event : "",
        "X-UVH-Signature": `t=${Date.now()},v1=${signature}`,
        "X-UVH-Event-Id": (JSON.parse(delivery.payload) as { event_id: string }).event_id,
      },
      body: delivery.payload,
      signal: controller.signal,
      redirect: "manual", // never follow user-controlled redirects
    });
    clearTimeout(timer);
    if (res.status >= 200 && res.status < 300) {
      q.prepare(`UPDATE webhook_deliveries SET status = 'success', delivered_at = ?, attempts = attempts + 1 WHERE id = ?`).run(
        new Date().toISOString(), deliveryId,
      );
    } else {
      await scheduleRetry(deliveryId, attempt, `HTTP ${res.status}`);
    }
  } catch (err) {
    await scheduleRetry(deliveryId, attempt, err instanceof Error ? err.message : "Error de red");
  }
}

async function scheduleRetry(deliveryId: number, attempt: number, error: string): Promise<void> {
  const next = attempt + 1;
  if (next > 5) {
    q.prepare(`UPDATE webhook_deliveries SET status = 'failed', last_error = ?, attempts = ? WHERE id = ?`).run(
      error, next, deliveryId,
    );
    return;
  }
  const delay = Math.min(60_000, 2 ** (next - 1) * 1_000); // exponential backoff
  const nextAt = new Date(Date.now() + delay).toISOString();
  q.prepare(`UPDATE webhook_deliveries SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`).run(
    next, error, nextAt, deliveryId,
  );
  setTimeout(() => {
    void attemptDelivery(deliveryId, next);
  }, delay);
}

/** Manual resend of a failed delivery. */
export function resendDelivery(deliveryId: number): void {
  const delivery = q.prepare(`SELECT * FROM webhook_deliveries WHERE id = ?`).get(deliveryId) as
    | { status: string; attempts: number }
    | undefined;
  if (!delivery) return;
  q.prepare(`UPDATE webhook_deliveries SET status = 'pending', last_error = NULL WHERE id = ?`).run(deliveryId);
  void attemptDelivery(deliveryId, delivery.attempts);
}
