import { Router } from "express";
import { z } from "zod";
import { db, q } from "../db.js";
import { requireAuth, requireVerified, type AuthedRequest } from "../middleware/auth.js";
import { requireWorkspace } from "../workspace.js";
import { audit } from "../util/audit.js";
import { randomToken } from "../util/ids.js";
import { encryptAtRest } from "../util/crypto.js";
import { resendDelivery } from "../services/webhooks.js";
import { WEBHOOK_EVENTS } from "../services/webhooks.js";
import { validateDestination } from "../util/url.js";

export const webhooksRouter = Router();
webhooksRouter.use(requireAuth);

function dto(row: Record<string, unknown>) {
  return {
    id: row.id,
    url: row.url,
    events: JSON.parse(row.events as string),
    active: row.active === 1,
    hasSecret: !!row.secret,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

webhooksRouter.get("/", requireVerified, requireWorkspace("viewer"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const rows = q.prepare(`SELECT * FROM webhooks WHERE workspace_id = ? ORDER BY created_at DESC`).all(workspaceId) as Array<Record<string, unknown>>;
  res.json({ webhooks: rows.map(dto) });
});

webhooksRouter.post("/", requireVerified, requireWorkspace("editor"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const parsed = z
    .object({
      url: z.string().max(2048),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
      secret: z.string().min(16).max(128).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Datos inválidos", details: parsed.error.flatten() });
    return;
  }
  const urlOk = validateDestination(parsed.data.url);
  if (!urlOk.ok) {
    res.status(422).json({ error: urlOk.error });
    return;
  }
  const secret = parsed.data.secret ?? randomToken(32);
  const info = db
    .prepare(`INSERT INTO webhooks (workspace_id, url, secret, events) VALUES (?, ?, ?, ?)`)
    .run(workspaceId, parsed.data.url, encryptAtRest(secret), JSON.stringify(parsed.data.events));
  audit({ userId: req.user!.id, ip: req.ip }, "webhook.create", "webhook", Number(info.lastInsertRowid), { url: parsed.data.url });
  const row = q.prepare(`SELECT * FROM webhooks WHERE id = ?`).get(Number(info.lastInsertRowid)) as Record<string, unknown>;
  res.status(201).json({ webhook: dto(row), secret });
});

webhooksRouter.patch("/:id", requireVerified, requireWorkspace("editor"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const row = q.prepare(`SELECT * FROM webhooks WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: "Webhook no encontrado" });
    return;
  }
  const parsed = z
    .object({
      url: z.string().max(2048).optional(),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
      active: z.boolean().optional(),
      secret: z.string().min(16).max(128).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Datos inválidos" });
    return;
  }
  if (parsed.data.url) {
    const urlOk = validateDestination(parsed.data.url);
    if (!urlOk.ok) {
      res.status(422).json({ error: urlOk.error });
      return;
    }
  }
  q.prepare(
    `UPDATE webhooks SET url = ?, events = ?, active = ?, secret = ?, updated_at = ? WHERE id = ?`,
  ).run(
    parsed.data.url ?? row.url,
    parsed.data.events ? JSON.stringify(parsed.data.events) : row.events,
    parsed.data.active !== undefined ? (parsed.data.active ? 1 : 0) : row.active,
    parsed.data.secret ? encryptAtRest(parsed.data.secret) : row.secret,
    new Date().toISOString(),
    id,
  );
  audit({ userId: req.user!.id, ip: req.ip }, "webhook.update", "webhook", id);
  res.json({ ok: true });
});

webhooksRouter.delete("/:id", requireVerified, requireWorkspace("editor"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const row = q.prepare(`SELECT id FROM webhooks WHERE id = ? AND workspace_id = ?`).get(id, workspaceId);
  if (!row) {
    res.status(404).json({ error: "Webhook no encontrado" });
    return;
  }
  q.prepare(`DELETE FROM webhooks WHERE id = ?`).run(id);
  audit({ userId: req.user!.id, ip: req.ip }, "webhook.delete", "webhook", id);
  res.json({ ok: true });
});

webhooksRouter.get("/:id/deliveries", requireVerified, requireWorkspace("viewer"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const row = q.prepare(`SELECT id FROM webhooks WHERE id = ? AND workspace_id = ?`).get(id, workspaceId);
  if (!row) {
    res.status(404).json({ error: "Webhook no encontrado" });
    return;
  }
  const deliveries = db
    .prepare(`SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 50`)
    .all(id);
  res.json({ deliveries });
});

webhooksRouter.post("/:id/deliveries/:deliveryId/resend", requireVerified, requireWorkspace("editor"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const deliveryId = Number(req.params.deliveryId);
  const row = q.prepare(`SELECT id FROM webhooks WHERE id = ? AND workspace_id = ?`).get(id, workspaceId);
  if (!row) {
    res.status(404).json({ error: "Webhook no encontrado" });
    return;
  }
  const delivery = q.prepare(`SELECT id FROM webhook_deliveries WHERE id = ? AND webhook_id = ?`).get(deliveryId, id);
  if (!delivery) {
    res.status(404).json({ error: "Entrega no encontrada" });
    return;
  }
  resendDelivery(deliveryId);
  audit({ userId: req.user!.id, ip: req.ip }, "webhook.resend", "webhook", id, { deliveryId });
  res.json({ ok: true });
});

// Test ping
webhooksRouter.post("/:id/test", requireVerified, requireWorkspace("editor"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const row = q.prepare(`SELECT * FROM webhooks WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: "Webhook no encontrado" });
    return;
  }
  const payload = JSON.stringify({ event: "ping", event_id: randomToken(16), timestamp: new Date().toISOString(), data: { message: "UVH webhook test" } });
  const info = db
    .prepare(`INSERT INTO webhook_deliveries (webhook_id, event, event_id, payload, status, next_attempt_at) VALUES (?, 'ping', ?, ?, 'pending', ?)`)
    .run(id, randomToken(16), payload, new Date().toISOString());
  void resendDelivery(Number(info.lastInsertRowid));
  res.json({ ok: true });
});
