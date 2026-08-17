import { Router } from "express";
import { resolveTxt } from "node:dns/promises";
import { z } from "zod";
import { db, q } from "../db.js";
import { requireAuth, requireVerified, type AuthedRequest } from "../middleware/auth.js";
import { requireWorkspace } from "../workspace.js";
import { audit } from "../util/audit.js";
import { randomToken } from "../util/ids.js";
import { dispatchWebhooks } from "../services/webhooks.js";

export const domainsRouter = Router();
domainsRouter.use(requireAuth);

function dto(row: Record<string, unknown>) {
  return {
    id: row.id,
    domain: row.domain,
    state: row.state,
    verificationToken: row.verification_token,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  };
}

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

domainsRouter.get("/", requireVerified, requireWorkspace("viewer"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const rows = q.prepare(`SELECT * FROM custom_domains WHERE workspace_id = ? ORDER BY created_at DESC`).all(workspaceId) as Array<Record<string, unknown>>;
  res.json({ domains: rows.map(dto) });
});

domainsRouter.post("/", requireVerified, requireWorkspace("editor"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const parsed = z.object({ domain: z.string().max(253) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Dominio inválido" });
    return;
  }
  const domain = parsed.data.domain.toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!DOMAIN_RE.test(domain)) {
    res.status(422).json({ error: "Dominio inválido" });
    return;
  }
  const exists = q.prepare(`SELECT id, workspace_id FROM custom_domains WHERE domain = ?`).get(domain);
  if (exists) {
    res.status(409).json({ error: "Este dominio ya está registrado" });
    return;
  }
  const token = `uvh-verify=${randomToken(24)}`;
  const info = db
    .prepare(`INSERT INTO custom_domains (workspace_id, domain, verification_token, state) VALUES (?, ?, ?, 'pending')`)
    .run(workspaceId, domain, token);
  audit({ userId: req.user!.id, ip: req.ip }, "domain.create", "domain", Number(info.lastInsertRowid), { domain });
  res.status(201).json({
    domain: dto(q.prepare(`SELECT * FROM custom_domains WHERE id = ?`).get(Number(info.lastInsertRowid)) as Record<string, unknown>),
  });
});

async function checkTxt(domain: string, token: string): Promise<boolean> {
  try {
    const records = await resolveTxt(domain);
    return records.some((parts) => parts.join("").replace(/^"|"$/g, "").includes(token));
  } catch {
    return false;
  }
}

domainsRouter.post("/:id/verify", requireVerified, requireWorkspace("editor"), async (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const row = q.prepare(`SELECT * FROM custom_domains WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: "Dominio no encontrado" });
    return;
  }
  q.prepare(`UPDATE custom_domains SET state = 'verifying', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  const found = await checkTxt(row.domain as string, row.verification_token as string);
  if (found) {
    q.prepare(`UPDATE custom_domains SET state = 'verified', verified_at = ?, updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(), new Date().toISOString(), id,
    );
    audit({ userId: req.user!.id, ip: req.ip }, "domain.verified", "domain", id, { domain: row.domain });
    dispatchWebhooks(workspaceId, "domain.verified", { domainId: id, domain: row.domain });
    res.json({ ok: true, state: "verified" });
  } else {
    q.prepare(`UPDATE custom_domains SET state = 'error', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
    res.status(422).json({ ok: false, state: "error", error: "Registro TXT no encontrado. Añade el registro TXT y vuelve a intentarlo." });
  }
});

domainsRouter.post("/:id/activate", requireVerified, requireWorkspace("editor"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const row = q.prepare(`SELECT * FROM custom_domains WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: "Dominio no encontrado" });
    return;
  }
  if (row.state !== "verified") {
    res.status(422).json({ error: "El dominio debe estar verificado antes de activarlo" });
    return;
  }
  q.prepare(`UPDATE custom_domains SET state = 'active', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  audit({ userId: req.user!.id, ip: req.ip }, "domain.activate", "domain", id);
  res.json({ ok: true, state: "active" });
});

domainsRouter.post("/:id/disable", requireVerified, requireWorkspace("editor"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const row = q.prepare(`SELECT id FROM custom_domains WHERE id = ? AND workspace_id = ?`).get(id, workspaceId);
  if (!row) {
    res.status(404).json({ error: "Dominio no encontrado" });
    return;
  }
  q.prepare(`UPDATE custom_domains SET state = 'disabled', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  audit({ userId: req.user!.id, ip: req.ip }, "domain.disable", "domain", id);
  res.json({ ok: true, state: "disabled" });
});

domainsRouter.delete("/:id", requireVerified, requireWorkspace("editor"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const row = q.prepare(`SELECT id FROM custom_domains WHERE id = ? AND workspace_id = ?`).get(id, workspaceId);
  if (!row) {
    res.status(404).json({ error: "Dominio no encontrado" });
    return;
  }
  q.prepare(`DELETE FROM custom_domains WHERE id = ?`).run(id);
  audit({ userId: req.user!.id, ip: req.ip }, "domain.delete", "domain", id);
  res.json({ ok: true });
});

domainsRouter.post("/:id/revalidate", requireVerified, requireWorkspace("editor"), async (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const row = q.prepare(`SELECT * FROM custom_domains WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: "Dominio no encontrado" });
    return;
  }
  const found = await checkTxt(row.domain as string, row.verification_token as string);
  const next = found ? "verified" : "error";
  q.prepare(`UPDATE custom_domains SET state = ?, updated_at = ? WHERE id = ?`).run(next, new Date().toISOString(), id);
  audit({ userId: req.user!.id, ip: req.ip }, "domain.revalidate", "domain", id);
  res.json({ ok: true, state: next });
});
