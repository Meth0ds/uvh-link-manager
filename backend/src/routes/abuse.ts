import { Router } from "express";
import { z } from "zod";
import { db, q } from "../db.js";
import { reportLimiter, linkCreateLimiter } from "../middleware/ratelimit.js";
import { normalizeAlias } from "../util/url.js";

export const abuseRouter = Router();

/**
 * Reputation provider adapter. When a provider is configured it would be
 * called here; until then we report "no external analysis" — we never invent
 * a "safe" status.
 */
export function reputationProviderConfigured(): boolean {
  return !!process.env.REPUTATION_PROVIDER_URL;
}

export function getReputationStatus(): { externalAnalysis: boolean; provider: string | null } {
  const configured = reputationProviderConfigured();
  return {
    externalAnalysis: configured,
    // Never expose the raw provider URL on a public endpoint: it may embed
    // credentials or reveal internal infrastructure.
    provider: configured ? "configured" : null,
  };
}

abuseRouter.get("/status", reportLimiter, (_req, res) => {
  res.json(getReputationStatus());
});

// Public report by alias or link id
abuseRouter.post("/report", reportLimiter, (req, res) => {
  const parsed = z
    .object({
      alias: z.string().min(1).max(64).optional(),
      linkId: z.number().int().optional(),
      reason: z.string().min(3).max(200),
      details: z.string().max(2000).optional(),
      email: z.string().email().max(254).optional().or(z.literal("")),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Datos inválidos", details: parsed.error.flatten() });
    return;
  }
  let linkId = parsed.data.linkId ?? null;
  if (!linkId && parsed.data.alias) {
    const alias = normalizeAlias(parsed.data.alias);
    const row = q.prepare(`SELECT id FROM links WHERE alias = ? AND domain_id IS NULL AND deleted_at IS NULL`).get(alias);
    linkId = row ? (row as { id: number }).id : null;
  }
  if (!linkId) {
    res.status(404).json({ error: "Enlace no encontrado" });
    return;
  }
  // The id must reference an existing, non-deleted link; otherwise the insert
  // would trip the FK and surface as an unhandled 500.
  const link = q.prepare(`SELECT id FROM links WHERE id = ? AND deleted_at IS NULL`).get(linkId);
  if (!link) {
    res.status(404).json({ error: "Enlace no encontrado" });
    return;
  }
  q.prepare(
    `INSERT INTO abuse_reports (link_id, reporter_email, reason, details) VALUES (?, ?, ?, ?)`,
  ).run(linkId, parsed.data.email ? parsed.data.email.toLowerCase() : null, parsed.data.reason, parsed.data.details ?? null);
  res.status(201).json({ ok: true });
});

// Limited public "create link" for the landing demo (rate limited + verified account required)
abuseRouter.post("/create", linkCreateLimiter, (req, res) => {
  // The landing demo shortener requires an authenticated, verified account.
  res.status(401).json({ error: "Crea una cuenta para acortar enlaces", requiresAuth: true });
});
