import { Router } from "express";
import { db, q } from "../db.js";
import { requireAuth, requireVerified, type AuthedRequest } from "../middleware/auth.js";
import { requireWorkspace } from "../workspace.js";
import { requireApiToken } from "../middleware/apitoken.js";

export const analyticsRouter = Router();

function periodRange(period: string, from?: string, to?: string): { start: string; end: string } {
  const end = to ? new Date(to) : new Date();
  const days = period === "24h" ? 1 : period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 7;
  const start = from ? new Date(from) : new Date(end.getTime() - days * 86400_000);
  return { start: start.toISOString(), end: end.toISOString() };
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
  const period = String(req.query.period ?? "7d");
  const from = req.query.from ? String(req.query.from) : undefined;
  const to = req.query.to ? String(req.query.to) : undefined;
  const { start, end } = periodRange(period, from, to);
  if (linkId) {
    const link = q.prepare(`SELECT id FROM links WHERE id = ? AND workspace_id = ?`).get(linkId, workspaceId);
    if (!link) {
      res.status(404).json({ error: "Enlace no encontrado" });
      return;
    }
  }
  res.json(buildOverview(workspaceId, linkId, start, end));
});

// Public read analytics endpoint (API tokens)
analyticsRouter.get("/public/overview", requireApiToken("analytics:read"), (req: AuthedRequest, res) => {
  const workspaceId = req.apiAuth!.workspaceId;
  const linkId = req.query.linkId ? Number(req.query.linkId) : null;
  const period = String(req.query.period ?? "7d");
  const { start, end } = periodRange(period);
  if (linkId) {
    const link = q.prepare(`SELECT id FROM links WHERE id = ? AND workspace_id = ?`).get(linkId, workspaceId);
    if (!link) {
      res.status(404).json({ error: "Enlace no encontrado" });
      return;
    }
  }
  res.json(buildOverview(workspaceId, linkId, start, end));
});
