import { Router } from "express";
import { z } from "zod";
import { db, q, tx } from "../db.js";
import { requireAuth, requireAdmin, type AuthedRequest } from "../middleware/auth.js";
import { adminLimiter } from "../middleware/ratelimit.js";
import { audit } from "../util/audit.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin, adminLimiter);

/** Admin actions require MFA to be enabled (defense in depth). */
adminRouter.use((req: AuthedRequest, res, next) => {
  if (!req.user!.mfaEnabled) {
    res.status(403).json({ error: "El área de administración requiere MFA activado en tu cuenta" });
    return;
  }
  next();
});

adminRouter.get("/overview", (req: AuthedRequest, res) => {
  const count = (sql: string) => (q.prepare(sql).get() as { c: number }).c;
  res.json({
    users: count(`SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL`),
    workspaces: count(`SELECT COUNT(*) AS c FROM workspaces`),
    links: count(`SELECT COUNT(*) AS c FROM links WHERE deleted_at IS NULL`),
    clicks: count(`SELECT COUNT(*) AS c FROM click_events`),
    openReports: count(`SELECT COUNT(*) AS c FROM abuse_reports WHERE status = 'open'`),
    blockedLinks: count(`SELECT COUNT(*) AS c FROM links WHERE state = 'blocked'`),
    domains: count(`SELECT COUNT(*) AS c FROM custom_domains`),
  });
});

adminRouter.get("/users", (req: AuthedRequest, res) => {
  const search = req.query.q ? String(req.query.q) : "";
  const where = search ? "WHERE (u.email LIKE ? OR u.name LIKE ?)" : "";
  const params = search ? [`%${search}%`, `%${search}%`] : [];
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.is_admin, u.email_verified_at, u.mfa_enabled, u.created_at, u.deleted_at,
              (SELECT COUNT(*) FROM memberships m WHERE m.user_id = u.id) AS workspaces,
              (SELECT COUNT(*) FROM links l WHERE l.created_by = u.id) AS links
       FROM users u ${where} ORDER BY u.created_at DESC LIMIT 100`,
    )
    .all(...params) as Array<Record<string, unknown>>;
  res.json({ users: rows });
});

adminRouter.patch("/users/:id", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const user = q.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!user) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }
  const parsed = z.object({ isAdmin: z.boolean().optional(), blocked: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Datos inválidos" });
    return;
  }
  if (parsed.data.isAdmin !== undefined) {
    q.prepare(`UPDATE users SET is_admin = ? WHERE id = ?`).run(parsed.data.isAdmin ? 1 : 0, id);
    audit({ userId: req.user!.id, ip: req.ip }, "admin.user_role", "user", id, { isAdmin: parsed.data.isAdmin });
  }
  if (parsed.data.blocked !== undefined) {
    // Block = soft delete (prevents login); unblock restores.
    q.prepare(`UPDATE users SET deleted_at = ? WHERE id = ?`).run(
      parsed.data.blocked ? new Date().toISOString() : null, id,
    );
    if (parsed.data.blocked) {
      q.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(new Date().toISOString(), id);
    }
    audit({ userId: req.user!.id, ip: req.ip }, "admin.user_block", "user", id, { blocked: parsed.data.blocked });
  }
  res.json({ ok: true });
});

adminRouter.get("/reports", (req: AuthedRequest, res) => {
  const status = req.query.status ? String(req.query.status) : "";
  const where = status ? "WHERE r.status = ?" : "";
  const params = status ? [status] : [];
  const rows = db
    .prepare(
      `SELECT r.*, l.alias, l.destination, l.state AS link_state, l.workspace_id
       FROM abuse_reports r JOIN links l ON l.id = r.link_id
       ${where} ORDER BY r.created_at DESC LIMIT 100`,
    )
    .all(...params) as Array<Record<string, unknown>>;
  res.json({ reports: rows });
});

adminRouter.patch("/reports/:id", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ status: z.enum(["open", "reviewed", "actioned", "dismissed"]) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Estado inválido" });
    return;
  }
  const row = q.prepare(`SELECT id FROM abuse_reports WHERE id = ?`).get(id);
  if (!row) {
    res.status(404).json({ error: "Denuncia no encontrada" });
    return;
  }
  q.prepare(`UPDATE abuse_reports SET status = ? WHERE id = ?`).run(parsed.data.status, id);
  audit({ userId: req.user!.id, ip: req.ip }, "admin.report_status", "abuse_report", id, { status: parsed.data.status });
  res.json({ ok: true });
});

adminRouter.post("/links/:id/block", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ reason: z.string().min(3).max(500) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Motivo requerido" });
    return;
  }
  const row = q.prepare(`SELECT id FROM links WHERE id = ?`).get(id);
  if (!row) {
    res.status(404).json({ error: "Enlace no encontrado" });
    return;
  }
  tx(() => {
    q.prepare(`UPDATE links SET state = 'blocked', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  });
  audit({ userId: req.user!.id, ip: req.ip }, "admin.link_block", "link", id, { reason: parsed.data.reason });
  res.json({ ok: true });
});

adminRouter.post("/links/:id/unblock", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const row = q.prepare(`SELECT id FROM links WHERE id = ?`).get(id);
  if (!row) {
    res.status(404).json({ error: "Enlace no encontrado" });
    return;
  }
  tx(() => {
    q.prepare(`UPDATE links SET state = 'active', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  });
  audit({ userId: req.user!.id, ip: req.ip }, "admin.link_unblock", "link", id);
  res.json({ ok: true });
});

adminRouter.get("/domains", (req: AuthedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT d.*, w.name AS workspace_name FROM custom_domains d JOIN workspaces w ON w.id = d.workspace_id ORDER BY d.created_at DESC LIMIT 100`,
    )
    .all() as Array<Record<string, unknown>>;
  res.json({ domains: rows });
});

adminRouter.get("/audit", (req: AuthedRequest, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const perPage = 50;
  const rows = db
    .prepare(`SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(perPage, (page - 1) * perPage);
  const total = (q.prepare(`SELECT COUNT(*) AS c FROM audit_events`).get() as { c: number }).c;
  res.json({ events: rows, total, page });
});
