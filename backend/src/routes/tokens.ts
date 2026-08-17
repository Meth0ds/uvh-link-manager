import { Router } from "express";
import { z } from "zod";
import { db, q } from "../db.js";
import { requireAuth, requireVerified, type AuthedRequest } from "../middleware/auth.js";
import { requireWorkspace } from "../workspace.js";
import { audit } from "../util/audit.js";
import { randomToken, sha256Hex } from "../util/ids.js";
import { API_SCOPES } from "../middleware/apitoken.js";

export const tokensRouter = Router();
tokensRouter.use(requireAuth);

function dto(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    scopes: JSON.parse(row.scopes as string),
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

tokensRouter.get("/", requireVerified, requireWorkspace("editor"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const rows = q.prepare(`SELECT * FROM api_tokens WHERE workspace_id = ? ORDER BY created_at DESC`).all(workspaceId) as Array<Record<string, unknown>>;
  res.json({ tokens: rows.map(dto) });
});

tokensRouter.post("/", requireVerified, requireWorkspace("editor"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(80),
      scopes: z.array(z.enum(API_SCOPES)).min(1),
      expiresAt: z.string().datetime().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Datos inválidos", details: parsed.error.flatten() });
    return;
  }
  const plain = `uvh_${randomToken(32)}`;
  const info = db
    .prepare(`INSERT INTO api_tokens (workspace_id, name, token_hash, scopes, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .run(workspaceId, parsed.data.name, sha256Hex(plain), JSON.stringify(parsed.data.scopes), parsed.data.expiresAt ?? null);
  audit({ userId: req.user!.id, ip: req.ip }, "api_token.create", "api_token", Number(info.lastInsertRowid), { scopes: parsed.data.scopes });
  res.status(201).json({ token: dto(q.prepare(`SELECT * FROM api_tokens WHERE id = ?`).get(Number(info.lastInsertRowid)) as Record<string, unknown>), plainToken: plain });
});

tokensRouter.delete("/:id", requireVerified, requireWorkspace("editor"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const row = q.prepare(`SELECT id FROM api_tokens WHERE id = ? AND workspace_id = ?`).get(id, workspaceId);
  if (!row) {
    res.status(404).json({ error: "Token no encontrado" });
    return;
  }
  q.prepare(`UPDATE api_tokens SET revoked_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  audit({ userId: req.user!.id, ip: req.ip }, "api_token.revoke", "api_token", id);
  res.json({ ok: true });
});
