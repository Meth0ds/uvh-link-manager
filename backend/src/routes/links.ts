import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db, q, tx } from "../db.js";
import { config } from "../config.js";
import { requireAuth, requireVerified, type AuthedRequest } from "../middleware/auth.js";
import { requireWorkspace, roleAtLeast } from "../workspace.js";
import { linkCreateLimiter } from "../middleware/ratelimit.js";
import { createLink, updateLink, setLinkState, validateLinkInput, LinkError, type LinkInput } from "../services/links.js";
import { audit } from "../util/audit.js";
import { isValidCustomAlias, isReservedAlias, normalizeAlias } from "../util/url.js";
import { dispatchWebhooks } from "../services/webhooks.js";

export const linksRouter = Router();
linksRouter.use(requireAuth);

const ruleSchema = z.object({
  priority: z.number().int().min(0).max(1000).optional(),
  country: z.string().max(2).nullable().optional(),
  language: z.string().max(8).nullable().optional(),
  device: z.enum(["desktop", "mobile", "tablet"]).nullable().optional(),
  os: z.string().max(40).nullable().optional(),
  timeFrom: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  timeTo: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  referrer: z.string().max(200).nullable().optional(),
  campaign: z.string().max(100).nullable().optional(),
  destination: z.string().min(1).max(2048),
});

const linkSchema = z.object({
  destination: z.string().min(1).max(2048),
  alias: z.string().max(64).nullable().optional(),
  domainId: z.number().int().positive().nullable().optional(),
  fallbackDestination: z.string().max(2048).nullable().optional(),
  password: z.string().max(256).nullable().optional(),
  maxClicks: z.number().int().min(1).max(10_000_000).nullable().optional(),
  singleUse: z.boolean().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  utm: z
    .object({
      source: z.string().max(100).nullable().optional(),
      medium: z.string().max(100).nullable().optional(),
      campaign: z.string().max(100).nullable().optional(),
      term: z.string().max(100).nullable().optional(),
      content: z.string().max(100).nullable().optional(),
    })
    .nullable()
    .optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  rules: z.array(ruleSchema).max(20).optional(),
});

function linkRowToDto(row: Record<string, unknown>) {
  return {
    id: row.id,
    alias: row.alias,
    destination: row.destination,
    fallbackDestination: row.fallback_destination ?? null,
    state: row.state,
    clickCount: row.click_count,
    maxClicks: row.max_clicks,
    singleUse: row.single_use === 1,
    usedAt: row.used_at,
    scheduledAt: row.scheduled_at,
    expiresAt: row.expires_at,
    notes: row.notes,
    passwordProtected: !!row.password_hash,
    utm: {
      source: row.utm_source ?? null,
      medium: row.utm_medium ?? null,
      campaign: row.utm_campaign ?? null,
      term: row.utm_term ?? null,
      content: row.utm_content ?? null,
    },
    domainId: row.domain_id,
    domain: row.domain ?? null,
    tags: JSON.parse((row.tags as string) ?? "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    shortUrl: buildShortUrl(row as { domain: string | null; alias: string }),
  };
}

function buildShortUrl(row: { domain: string | null; alias: string }): string {
  const host = row.domain ?? config.publicHost;
  return `https://${host}/${row.alias}`;
}

function attachTagsAndDomain(rows: Array<Record<string, unknown>>) {
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const tags = q
      .prepare(
        `SELECT t.name FROM tags t JOIN link_tags lt ON lt.tag_id = t.id WHERE lt.link_id = ?`,
      )
      .all(r.id) as Array<{ name: string }>;
    const domain = r.domain_id
      ? (q.prepare(`SELECT domain FROM custom_domains WHERE id = ?`).get(r.domain_id) as { domain: string } | undefined)
      : undefined;
    out.push({ ...r, tags: JSON.stringify(tags.map((t) => t.name)), domain: domain?.domain ?? null });
  }
  return out;
}

// List with search / filters / sorting / pagination
linksRouter.get("/", requireVerified, requireWorkspace("viewer"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const search = req.query.q ? String(req.query.q) : "";
  const state = req.query.state ? String(req.query.state) : "";
  const tag = req.query.tag ? String(req.query.tag) : "";
  const domainId = req.query.domainId ? String(req.query.domainId) : "";
  const sort = String(req.query.sort ?? "created_at_desc");
  const page = Math.max(1, Number(req.query.page ?? 1));
  const perPage = Math.min(100, Math.max(1, Number(req.query.perPage ?? 20)));

  const where: string[] = ["l.workspace_id = ?", "l.deleted_at IS NULL"];
  const params: unknown[] = [workspaceId];
  if (search) {
    where.push("(l.alias LIKE ? OR l.destination LIKE ? OR l.notes LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (state) {
    where.push("l.state = ?");
    params.push(state);
  }
  if (domainId) {
    where.push("l.domain_id = ?");
    params.push(Number(domainId));
  }
  if (tag) {
    where.push("l.id IN (SELECT lt.link_id FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE t.name = ?)");
    params.push(tag);
  }
  const orderMap: Record<string, string> = {
    created_at_desc: "l.created_at DESC",
    created_at_asc: "l.created_at ASC",
    clicks_desc: "l.click_count DESC",
    alias_asc: "l.alias ASC",
  };
  const order = orderMap[sort] ?? orderMap.created_at_desc;

  const totalRow = q
    .prepare(`SELECT COUNT(*) AS c FROM links l WHERE ${where.join(" AND ")}`)
    .get(...params) as { c: number };
  const rows = q
    .prepare(
      `SELECT l.* FROM links l WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(...params, perPage, (page - 1) * perPage) as Array<Record<string, unknown>>;
  res.json({ links: attachTagsAndDomain(rows).map(linkRowToDto), total: totalRow.c, page, perPage });
});

// Alias availability check (backend enforced)
linksRouter.post("/check-alias", requireVerified, requireWorkspace("viewer"), (req: AuthedRequest, res) => {
  const parsed = z.object({ alias: z.string().min(1).max(64), domainId: z.number().int().positive().nullable().optional() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Alias inválido" });
    return;
  }
  const alias = normalizeAlias(parsed.data.alias);
  if (isReservedAlias(alias)) {
    res.json({ available: false, reason: "reserved" });
    return;
  }
  if (!isValidCustomAlias(alias)) {
    res.json({ available: false, reason: "invalid" });
    return;
  }
  const domainId = parsed.data.domainId ?? null;
  if (domainId != null) {
    const workspaceId = res.locals.workspaceId as number;
    const dom = q.prepare(`SELECT id FROM custom_domains WHERE id = ? AND workspace_id = ? AND state IN ('verified','active')`).get(domainId, workspaceId);
    if (!dom) {
      // Domains of other tenants are not our namespace: report unavailable
      // without leaking cross-tenant alias state.
      res.json({ available: false, reason: "domain" });
      return;
    }
  }
  const exists = q.prepare(`SELECT id FROM links WHERE domain_id IS ? AND alias = ? AND deleted_at IS NULL`).get(
    domainId, alias,
  );
  res.json({ available: !exists });
});

// Create
linksRouter.post("/", requireVerified, requireWorkspace("editor"), linkCreateLimiter, async (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Datos inválidos", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  if (body.domainId) {
    const dom = q.prepare(`SELECT id FROM custom_domains WHERE id = ? AND workspace_id = ? AND state IN ('verified','active')`).get(body.domainId, workspaceId);
    if (!dom) {
      res.status(403).json({ error: "Dominio no verificado o sin acceso" });
      return;
    }
  }
  const input: LinkInput = {
    destination: body.destination,
    alias: body.alias,
    domainId: body.domainId,
    fallbackDestination: body.fallbackDestination,
    passwordHash: body.password ? await bcrypt.hash(body.password, 12) : null,
    maxClicks: body.maxClicks,
    singleUse: body.singleUse,
    scheduledAt: body.scheduledAt,
    expiresAt: body.expiresAt,
    notes: body.notes,
    utm: body.utm ?? undefined,
    tags: body.tags,
    rules: body.rules,
  };
  const valid = validateLinkInput(input);
  if (!valid.ok) {
    res.status(422).json({ error: valid.error });
    return;
  }
  try {
    const created = createLink(workspaceId, req.user!.id, input);
    audit({ userId: req.user!.id, ip: req.ip }, "link.create", "link", created.id);
    dispatchWebhooks(workspaceId, "link.created", { linkId: created.id, alias: created.alias });
    const row = attachTagsAndDomain([q.prepare(`SELECT * FROM links WHERE id = ?`).get(created.id) as Record<string, unknown>])[0]!;
    res.status(201).json({ link: linkRowToDto(row) });
  } catch (err) {
    if (err instanceof LinkError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// Detail
linksRouter.get("/:id", requireVerified, requireWorkspace("viewer"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const row = q.prepare(`SELECT * FROM links WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`).get(id, workspaceId) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: "Enlace no encontrado" });
    return;
  }
  const rules = q.prepare(`SELECT * FROM redirect_rules WHERE link_id = ? ORDER BY priority ASC, id ASC`).all(id);
  res.json({ link: linkRowToDto(attachTagsAndDomain([row])[0]!), rules });
});

// Update
linksRouter.patch("/:id", requireVerified, requireWorkspace("editor"), async (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const parsed = linkSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Datos inválidos", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  const current = q.prepare(`SELECT * FROM links WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`).get(id, workspaceId) as Record<string, unknown> | undefined;
  if (!current) {
    res.status(404).json({ error: "Enlace no encontrado" });
    return;
  }
  // Moving a link to a custom domain requires owning that domain in THIS
  // workspace — same guard as creation. Without it, any editor could park
  // their links on another workspace's verified domain (IDOR/domain abuse).
  if (body.domainId) {
    const dom = q.prepare(`SELECT id FROM custom_domains WHERE id = ? AND workspace_id = ? AND state IN ('verified','active')`).get(body.domainId, workspaceId);
    if (!dom) {
      res.status(403).json({ error: "Dominio no verificado o sin acceso" });
      return;
    }
  }
  const input: LinkInput = {
    destination: body.destination ?? (current.destination as string),
    alias: body.alias ?? (current.alias as string),
    domainId: body.domainId ?? (current.domain_id as number | null),
    fallbackDestination: body.fallbackDestination !== undefined ? body.fallbackDestination : (current.fallback_destination as string | null),
    passwordHash: body.password !== undefined ? (body.password ? await bcrypt.hash(body.password, 12) : null) : undefined,
    maxClicks: body.maxClicks !== undefined ? body.maxClicks : (current.max_clicks as number | null),
    singleUse: body.singleUse !== undefined ? body.singleUse : (current.single_use as number) === 1,
    scheduledAt: body.scheduledAt !== undefined ? body.scheduledAt : (current.scheduled_at as string | null),
    expiresAt: body.expiresAt !== undefined ? body.expiresAt : (current.expires_at as string | null),
    notes: body.notes !== undefined ? body.notes : (current.notes as string | null),
    utm: body.utm !== undefined ? (body.utm ?? undefined) : {
      source: current.utm_source as string | null,
      medium: current.utm_medium as string | null,
      campaign: current.utm_campaign as string | null,
      term: current.utm_term as string | null,
      content: current.utm_content as string | null,
    },
    tags: body.tags,
    rules: body.rules,
  };
  const valid = validateLinkInput(input);
  if (!valid.ok) {
    res.status(422).json({ error: valid.error });
    return;
  }
  try {
    const updated = updateLink(id, workspaceId, input);
    audit({ userId: req.user!.id, ip: req.ip }, "link.update", "link", id);
    dispatchWebhooks(workspaceId, "link.updated", { linkId: id, alias: updated.alias });
    const row = attachTagsAndDomain([q.prepare(`SELECT * FROM links WHERE id = ?`).get(id) as Record<string, unknown>])[0]!;
    res.json({ link: linkRowToDto(row) });
  } catch (err) {
    if (err instanceof LinkError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// State transitions
linksRouter.post("/:id/state", requireVerified, requireWorkspace("editor"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const parsed = z.object({ state: z.enum(["active", "paused", "archived", "blocked", "expired"]), reason: z.string().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Estado inválido" });
    return;
  }
  const link = q.prepare(`SELECT state FROM links WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`).get(id, workspaceId) as { state: string } | undefined;
  if (!link) {
    res.status(404).json({ error: "Enlace no encontrado" });
    return;
  }
  // Blocking is the platform's abuse control (admin area, MFA-gated). Editors
  // must not be able to block links or to undo an admin block.
  if ((parsed.data.state === "blocked" || link.state === "blocked") && !req.user!.isAdmin) {
    res.status(403).json({ error: "Solo un administrador de la plataforma puede bloquear o desbloquear enlaces" });
    return;
  }
  tx(() => {
    q.prepare(`UPDATE links SET state = ?, updated_at = ? WHERE id = ?`).run(parsed.data.state, new Date().toISOString(), id);
  });
  audit(
    { userId: req.user!.id, ip: req.ip },
    "link.state_change",
    "link",
    id,
    { from: link.state, to: parsed.data.state, reason: parsed.data.reason ?? null },
  );
  res.json({ ok: true, state: parsed.data.state });
});

// Soft delete
linksRouter.delete("/:id", requireVerified, requireWorkspace("editor"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const link = q.prepare(`SELECT id FROM links WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`).get(id, workspaceId);
  if (!link) {
    res.status(404).json({ error: "Enlace no encontrado" });
    return;
  }
  tx(() => {
    q.prepare(`UPDATE links SET deleted_at = ?, state = 'deleted', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), new Date().toISOString(), id);
  });
  audit({ userId: req.user!.id, ip: req.ip }, "link.delete", "link", id);
  dispatchWebhooks(workspaceId, "link.deleted", { linkId: id });
  res.json({ ok: true });
});

// Restore
linksRouter.post("/:id/restore", requireVerified, requireWorkspace("editor"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const link = q.prepare(`SELECT id FROM links WHERE id = ? AND workspace_id = ? AND deleted_at IS NOT NULL`).get(id, workspaceId);
  if (!link) {
    res.status(404).json({ error: "Enlace no encontrado" });
    return;
  }
  tx(() => {
    q.prepare(`UPDATE links SET deleted_at = NULL, state = 'active', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  });
  audit({ userId: req.user!.id, ip: req.ip }, "link.restore", "link", id);
  res.json({ ok: true });
});

// Activity (audit trail for a link)
linksRouter.get("/:id/activity", requireVerified, requireWorkspace("viewer"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const id = Number(req.params.id);
  const link = q.prepare(`SELECT id FROM links WHERE id = ? AND workspace_id = ?`).get(id, workspaceId);
  if (!link) {
    res.status(404).json({ error: "Enlace no encontrado" });
    return;
  }
  const events = q
    .prepare(`SELECT * FROM audit_events WHERE resource_type = 'link' AND resource_id = ? ORDER BY created_at DESC LIMIT 50`)
    .all(String(id));
  res.json({ events });
});

// Role helper exposure for frontend capability checks
linksRouter.get("/meta/role", requireVerified, requireWorkspace("viewer"), (_req: AuthedRequest, res) => {
  res.json({ role: res.locals.role, canWrite: roleAtLeast(res.locals.role, "editor") });
});
