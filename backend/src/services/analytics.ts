import { db, q } from "../db.js";
import type { ClickMeta } from "../util/analytics.js";
import { dispatchWebhooks } from "./webhooks.js";

function bump(map: Record<string, number> | null, key: string | null): string {
  if (!key) return JSON.stringify(map ?? {});
  const m = map ?? {};
  m[key] = (m[key] ?? 0) + 1;
  return JSON.stringify(m);
}

/** Called asynchronously so the redirect response is never blocked. */
export function recordClick(linkId: number, meta: ClickMeta): void {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);

  q.prepare(
    `INSERT INTO click_events
      (link_id, occurred_at, country, device, browser, os, referrer_domain, campaign, visitor_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    linkId, now.toISOString(), meta.country, meta.device, meta.browser, meta.os,
    meta.referrerDomain, meta.campaign, meta.visitorHash,
  );

  const rollup = db
    .prepare(`SELECT * FROM metric_rollups WHERE link_id = ? AND day = ?`)
    .get(linkId, day) as Record<string, unknown> | undefined;

  if (!rollup) {
    q.prepare(
      `INSERT INTO metric_rollups
        (link_id, day, clicks, visitors, countries, devices, browsers, os, referrers, campaigns)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      linkId, day,
      meta.visitorHash ? 1 : 0,
      meta.country ? JSON.stringify({ [meta.country]: 1 }) : null,
      meta.device ? JSON.stringify({ [meta.device]: 1 }) : null,
      meta.browser ? JSON.stringify({ [meta.browser]: 1 }) : null,
      meta.os ? JSON.stringify({ [meta.os]: 1 }) : null,
      meta.referrerDomain ? JSON.stringify({ [meta.referrerDomain]: 1 }) : null,
      meta.campaign ? JSON.stringify({ [meta.campaign]: 1 }) : null,
    );
  } else {
    const visitors = meta.visitorHash ? 1 : 0;
    q.prepare(
      `UPDATE metric_rollups SET
         clicks = clicks + 1,
         visitors = visitors + ?,
         countries = ?, devices = ?, browsers = ?, os = ?, referrers = ?, campaigns = ?
       WHERE id = ?`,
    ).run(
      visitors,
      bump(rollup.countries ? JSON.parse(rollup.countries as string) : null, meta.country),
      bump(rollup.devices ? JSON.parse(rollup.devices as string) : null, meta.device),
      bump(rollup.browsers ? JSON.parse(rollup.browsers as string) : null, meta.browser),
      bump(rollup.os ? JSON.parse(rollup.os as string) : null, meta.os),
      bump(rollup.referrers ? JSON.parse(rollup.referrers as string) : null, meta.referrerDomain),
      bump(rollup.campaigns ? JSON.parse(rollup.campaigns as string) : null, meta.campaign),
      rollup.id,
    );
  }

  // Threshold webhooks (e.g. link.threshold_reached)
  const link = q.prepare(`SELECT workspace_id, max_clicks, click_count FROM links WHERE id = ?`).get(linkId) as
    | { workspace_id: number; max_clicks: number | null; click_count: number }
    | undefined;
  if (link && link.max_clicks != null && link.max_clicks > 0 && link.click_count === link.max_clicks) {
    dispatchWebhooks(link.workspace_id, "link.threshold_reached", { linkId, threshold: link.max_clicks });
  }
}
