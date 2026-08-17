import { db, q, tx } from "../db.js";
import { randomAlias } from "../util/ids.js";
import {
  isReservedAlias,
  isValidCustomAlias,
  normalizeAlias,
  validateDestination,
} from "../util/url.js";

export type LinkState = "scheduled" | "active" | "paused" | "expired" | "blocked" | "archived" | "deleted";

export interface LinkInput {
  destination: string;
  alias?: string | null;
  domainId?: number | null;
  fallbackDestination?: string | null;
  /** Already bcrypt-hashed by the route layer (bcrypt is async). */
  passwordHash?: string | null;
  maxClicks?: number | null;
  singleUse?: boolean;
  scheduledAt?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
  utm?: { source?: string | null; medium?: string | null; campaign?: string | null; term?: string | null; content?: string | null } | null;
  tags?: string[];
  rules?: Array<{
    priority?: number;
    country?: string | null;
    language?: string | null;
    device?: string | null;
    os?: string | null;
    timeFrom?: string | null;
    timeTo?: string | null;
    referrer?: string | null;
    campaign?: string | null;
    destination: string;
  }>;
}

function deriveState(input: LinkInput): LinkState {
  if (input.scheduledAt && new Date(input.scheduledAt).getTime() > Date.now()) return "scheduled";
  if (input.expiresAt && new Date(input.expiresAt).getTime() < Date.now()) return "expired";
  return "active";
}

/** Generate a unique alias with a bounded number of retries. Never overwrites. */
function generateUniqueAlias(domainId: number | null): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const alias = randomAlias(8);
    const exists = q
      .prepare(`SELECT id FROM links WHERE domain_id IS ? AND alias = ?`)
      .get(domainId, alias);
    if (!exists) return alias;
  }
  throw new Error("No se pudo generar un alias único");
}

export function validateLinkInput(input: LinkInput): { ok: true } | { ok: false; error: string } {
  const dest = validateDestination(input.destination);
  if (!dest.ok) return dest;
  if (input.fallbackDestination) {
    const fb = validateDestination(input.fallbackDestination);
    if (!fb.ok) return { ok: false, error: `Destino fallback: ${fb.error}` };
  }
  if (input.alias) {
    const alias = normalizeAlias(input.alias);
    if (isReservedAlias(alias)) return { ok: false, error: "Este alias está reservado" };
    if (!isValidCustomAlias(alias)) return { ok: false, error: "Alias inválido (solo letras, números, - y _)" };
  }
  if (input.maxClicks != null && (input.maxClicks < 1 || input.maxClicks > 10_000_000)) {
    return { ok: false, error: "Máximo de clics inválido" };
  }
  if (input.rules && input.rules.length > 0) {
    for (const rule of input.rules) {
      const r = validateDestination(rule.destination);
      if (!r.ok) return { ok: false, error: `Regla inválida: ${r.error}` };
    }
  }
  return { ok: true };
}

export function createLink(
  workspaceId: number,
  userId: number,
  input: LinkInput,
): { id: number; alias: string; state: LinkState } {
  const domainId = input.domainId ?? null;

  // Quota enforcement
  const quota = q.prepare(`SELECT links_limit FROM quotas WHERE workspace_id = ?`).get(workspaceId) as
    | { links_limit: number }
    | undefined;
  const used = q
    .prepare(`SELECT COUNT(*) AS c FROM links WHERE workspace_id = ? AND deleted_at IS NULL`)
    .get(workspaceId) as { c: number };
  if (quota && used.c >= quota.links_limit) {
    throw new LinkError("Cuota de enlaces alcanzada", 429);
  }

  let alias: string;
  if (input.alias) {
    alias = normalizeAlias(input.alias);
    const exists = q.prepare(`SELECT id FROM links WHERE domain_id IS ? AND alias = ?`).get(domainId, alias);
    if (exists) throw new LinkError("Este alias ya está en uso", 409);
  } else {
    alias = generateUniqueAlias(domainId);
  }

  const state = deriveState(input);
  const utm = input.utm ?? {};

  return tx(() => {
    const info = q
      .prepare(
        `INSERT INTO links
          (workspace_id, created_by, domain_id, alias, destination, fallback_destination, state,
           password_hash, max_clicks, single_use, scheduled_at, expires_at, notes,
           utm_source, utm_medium, utm_campaign, utm_term, utm_content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workspaceId, userId, domainId, alias, input.destination, input.fallbackDestination ?? null, state,
        input.passwordHash ?? null,
        input.maxClicks ?? null, input.singleUse ? 1 : 0,
        input.scheduledAt ?? null, input.expiresAt ?? null, input.notes ?? null,
        utm.source ?? null, utm.medium ?? null, utm.campaign ?? null, utm.term ?? null, utm.content ?? null,
      );
    const linkId = Number(info.lastInsertRowid);
    applyTags(linkId, workspaceId, input.tags ?? []);
    applyRules(linkId, input.rules ?? []);
    return { id: linkId, alias, state };
  });
}

export function updateLink(
  linkId: number,
  workspaceId: number,
  input: LinkInput,
): { id: number; alias: string; state: LinkState } {
  const link = q
    .prepare(`SELECT * FROM links WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`)
    .get(linkId, workspaceId) as Record<string, unknown> | undefined;
  if (!link) throw new LinkError("Enlace no encontrado", 404);

  const alias = input.alias ? normalizeAlias(input.alias) : (link.alias as string);
  if (input.alias) {
    if (isReservedAlias(alias)) throw new LinkError("Este alias está reservado", 422);
    if (!isValidCustomAlias(alias)) throw new LinkError("Alias inválido", 422);
    const dup = q
      .prepare(`SELECT id FROM links WHERE domain_id IS ? AND alias = ? AND id != ?`)
      .get(link.domain_id ?? null, alias, linkId);
    if (dup) throw new LinkError("Este alias ya está en uso", 409);
  }

  const state = deriveState(input);
  const utm = input.utm ?? {};
  return tx(() => {
    q.prepare(
      `UPDATE links SET
         destination = ?, fallback_destination = ?, state = ?,
         password_hash = ?, max_clicks = ?, single_use = ?,
         scheduled_at = ?, expires_at = ?, notes = ?,
         utm_source = ?, utm_medium = ?, utm_campaign = ?, utm_term = ?, utm_content = ?,
         updated_at = ?
       WHERE id = ?`,
    ).run(
      input.destination, input.fallbackDestination ?? null, state,
      input.passwordHash ?? link.password_hash,
      input.maxClicks ?? null, input.singleUse ? 1 : 0,
      input.scheduledAt ?? null, input.expiresAt ?? null, input.notes ?? null,
      utm.source ?? null, utm.medium ?? null, utm.campaign ?? null, utm.term ?? null, utm.content ?? null,
      new Date().toISOString(), linkId,
    );
    if (input.tags) applyTags(linkId, workspaceId, input.tags);
    if (input.rules) applyRules(linkId, input.rules);
    return { id: linkId, alias, state };
  });
}

export function setLinkState(linkId: number, workspaceId: number, next: LinkState, reason?: string): void {
  tx(() => {
    const link = q
      .prepare(`SELECT state, updated_at FROM links WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`)
      .get(linkId, workspaceId) as { state: LinkState } | undefined;
    if (!link) throw new LinkError("Enlace no encontrado", 404);
    if (link.state === next) return;
    q.prepare(`UPDATE links SET state = ?, updated_at = ? WHERE id = ?`).run(next, new Date().toISOString(), linkId);
    // Transition audit is written by the caller with actor context.
  });
  void reason;
}

export class LinkError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function applyTags(linkId: number, workspaceId: number, tags: string[]): void {
  q.prepare(`DELETE FROM link_tags WHERE link_id = ?`).run(linkId);
  for (const raw of tags) {
    const name = raw.trim().slice(0, 40);
    if (!name) continue;
    let tag = q.prepare(`SELECT id FROM tags WHERE workspace_id = ? AND name = ?`).get(workspaceId, name) as { id: number } | undefined;
    if (!tag) {
      const info = q.prepare(`INSERT INTO tags (workspace_id, name) VALUES (?, ?)`).run(workspaceId, name);
      tag = { id: Number(info.lastInsertRowid) };
    }
    q.prepare(`INSERT OR IGNORE INTO link_tags (link_id, tag_id) VALUES (?, ?)`).run(linkId, tag.id);
  }
}

export function applyRules(linkId: number, rules: LinkInput["rules"]): void {
  q.prepare(`DELETE FROM redirect_rules WHERE link_id = ?`).run(linkId);
  for (const rule of rules ?? []) {
    q.prepare(
      `INSERT INTO redirect_rules
        (link_id, priority, country, language, device, os, time_from, time_to, referrer, campaign, destination)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      linkId, rule.priority ?? 0, rule.country ?? null, rule.language ?? null, rule.device ?? null,
      rule.os ?? null, rule.timeFrom ?? null, rule.timeTo ?? null, rule.referrer ?? null,
      rule.campaign ?? null, rule.destination,
    );
  }
}
