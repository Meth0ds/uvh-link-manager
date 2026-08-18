import { Router } from "express";
import { z } from "zod";
import { db, q } from "../db.js";
import { requireAuth, requireVerified, type AuthedRequest } from "../middleware/auth.js";
import { requireWorkspace } from "../workspace.js";
import { requireApiToken } from "../middleware/apitoken.js";
import { apiLimiter, apiTokenLimiter } from "../middleware/ratelimit.js";

export const analyticsRouter = Router();

const PERIODS = new Set(["24h", "7d", "30d", "90d"]);
// Maximum explicit from/to span, aligned with the default analytics retention
// (ANALYTICS_RETENTION_DAYS=180): asking for more cannot return more data, it
// only amplifies the cost of rollup and click-event scans.
const MAX_ANALYTICS_RANGE_MS = 180 * 86400_000;
// Strict datetime validation: malformed `from`/`to` previously produced a 500.
const dateParam = z.string().datetime().optional();

function parseRange(
  params: { period?: string; from?: string; to?: string },
): { ok: true; start: string; end: string } | { ok: false; error: string } {
  const period = params.period ?? "7d";
  if (!PERIODS.has(period)) return { ok: false, error: "period inválido (24h|7d|30d|90d)" };
  if (params.from !== undefined && !dateParam.safeParse(params.from).success) {
    return { ok: false, error: "from debe ser una fecha ISO válida" };
  }
  if (params.to !== undefined && !dateParam.safeParse(params.to).success) {
    return { ok: false, error: "to debe ser una fecha ISO válida" };
  }
  const days = period === "24h" ? 1 : period === "7d" ? 7 : period === "30d" ? 30 : 90;
  const end = params.to ? new Date(params.to) : new Date();
  const start = params.from ? new Date(params.from) : new Date(end.getTime() - days * 86400_000);
  if (start.getTime() > end.getTime()) {
    return { ok: false, error: "from debe ser anterior o igual a to" };
  }
  if (end.getTime() - start.getTime() > MAX_ANALYTICS_RANGE_MS) {
    return { ok: false, error: "El rango solicitado supera el máximo de 180 días" };
  }
  return { ok: true, start: start.toISOString(), end: end.toISOString() };
}

function mergeMaps(list: Array<string | null>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const raw of list) {
    if (!raw) continue;
    const m = JSON.parse(raw) as Record<string, number>;
    for (const [k, v] of Object.entries(m)) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

function top(map: Record<string, number>, n = 8): Array<{ key: string; value: number }> {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, value]) => ({ key, value }));
}

function buildOverview(workspaceId: number, linkId: number | null, start: string, end: string) {
  const linkWhere = linkId ? "AND link_id = ?" : "";
  const linkParams = linkId ? [linkId] : [];
  const wsWhere = linkId ? "" : "workspace_id = ? AND";
  const wsParams = linkId ? [] : [workspaceId];

  const rollups = db
    .prepare(
      `SELECT * FROM metric_rollups WHERE day >= ? AND day <= ? AND link_id IN
         (SELECT id FROM links WHERE ${wsWhere} id IS NOT NULL ${linkWhere})`,
    )
    .all(start.slice(0, 10), end.slice(0, 10), ...wsParams, ...linkParams) as Array<Record<string, unknown>>;

  const totalClicks = rollups.reduce((acc, r) => acc + (r.clicks as number), 0);
  const totalVisitors = rollups.reduce((acc, r) => acc + (r.visitors as number), 0);

  // Daily series from click_events (exact)
  const seriesRows = db
    .prepare(
      `SELECT substr(occurred_at, 1, 10) AS day, COUNT(*) AS clicks, COUNT(DISTINCT visitor_hash) AS visitors
       FROM click_events
       WHERE occurred_at >= ? AND occurred_at <= ? AND link_id IN
         (SELECT id FROM links WHERE ${wsWhere} id IS NOT NULL ${linkWhere})
       GROUP BY day ORDER BY day`,
    )
    .all(start, end, ...wsParams, ...linkParams) as Array<{ day: string; clicks: number; visitors: number }>;

  // Top links
  const topLinks = linkId
    ? []
    : (db
        .prepare(
          `SELECT l.id, l.alias, l.destination, m.clicks, m.visitors FROM (
             SELECT link_id, SUM(clicks) AS clicks, SUM(visitors) AS visitors
             FROM metric_rollups WHERE day >= ? AND day <= ?
             GROUP BY link_id ORDER BY clicks DESC LIMIT 8
           ) m JOIN links l ON l.id = m.link_id
           WHERE l.workspace_id = ?`,
        )
        .all(start.slice(0, 10), end.slice(0, 10), workspaceId) as Array<Record<string, unknown>>);

  return {
    totals: { clicks: totalClicks, visitors: totalVisitors },
    series: seriesRows,
    topLinks,
    countries: top(mergeMaps(rollups.map((r) => r.countries as string | null))),
    devices: top(mergeMaps(rollups.map((r) => r.devices as string | null))),
    browsers: top(mergeMaps(rollups.map((r) => r.browsers as string | null))),
    os: top(mergeMaps(rollups.map((r) => r.os as string | null))),
    referrers: top(mergeMaps(rollups.map((r) => r.referrers as string | null))),
    campaigns: top(mergeMaps(rollups.map((r) => r.campaigns as string | null))),
  };
}

analyticsRouter.get("/overview", requireVerified, requireWorkspace("viewer"), (req: AuthedRequest, res) => {
  const workspaceId = res.locals.workspaceId as number;
  const linkId = req.query.linkId ? Number(req.query.linkId) : null;
  const range = parseRange({
    period: req.query.period ? String(req.query.period) : undefined,
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
  });
  if (!range.ok) {
    res.status(422).json({ error: range.error });
    return;
  }
  const { start, end } = range;
  if (linkId) {
    const link = q.prepare(`SELECT id FROM links WHERE id = ? AND workspace_id = ?`).get(linkId, workspaceId);
    if (!link) {
      res.status(404).json({ error: "Enlace no encontrado" });
      return;
    }
  }
  res.json(buildOverview(workspaceId, linkId, start, end));
});

// Public read analytics endpoint (API tokens). Two rate-limit layers: per IP
// (before auth) and per token (after auth), so a leaked token is capped in
// aggregate even when requests fan out across many IPs.
analyticsRouter.get("/public/overview", apiLimiter, requireApiToken("analytics:read"), apiTokenLimiter, (req: AuthedRequest, res) => {
  const workspaceId = req.apiAuth!.workspaceId;
  const linkId = req.query.linkId ? Number(req.query.linkId) : null;
  const range = parseRange({
    period: req.query.period ? String(req.query.period) : undefined,
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
  });
  if (!range.ok) {
    res.status(422).json({ error: range.error });
    return;
  }
  const { start, end } = range;
  if (linkId) {
    const link = q.prepare(`SELECT id FROM links WHERE id = ? AND workspace_id = ?`).get(linkId, workspaceId);
    if (!link) {
      res.status(404).json({ error: "Enlace no encontrado" });
      return;
    }
  }
  res.json(buildOverview(workspaceId, linkId, start, end));
});
