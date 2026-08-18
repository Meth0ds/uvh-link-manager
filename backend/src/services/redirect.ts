import { db, q, tx } from "../db.js";
import { config } from "../config.js";
import { normalizeAlias, isReservedAlias } from "../util/url.js";
import { verify } from "../util/sign.js";
import { parseUserAgent, referrerDomain } from "../util/analytics.js";

export const UNLOCK_COOKIE = "uvh_unlock";

export type RedirectOutcome =
  | { kind: "redirect"; location: string; linkId: number; campaign: string | null; recordClick: boolean }
  | { kind: "password_required"; linkId: number }
  | { kind: "gone" }
  | { kind: "not_found" }
  | { kind: "unavailable"; reason: "paused" | "expired" | "blocked" | "archived" | "scheduled" | "domain" };

interface ResolveContext {
  host: string;
  alias: string;
  userAgent?: string;
  acceptLanguage?: string;
  referrer?: string;
  ip?: string;
  country?: string | null;
  unlockToken?: string | null;
}

/** Lowercase a Host header and strip any port (host scoping is by name). */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/:\d+$/, "");
}

/** Map a request Host header to a domain_id (null = default public host). */
export function resolveDomainId(host: string): number | null {
  const h = normalizeHost(host);
  const publicHost = config.publicHost.toLowerCase();
  if (h === publicHost || h === `www.${publicHost}`) return null;
  const row = q
    .prepare(`SELECT id FROM custom_domains WHERE domain = ? AND state IN ('verified','active')`)
    .get(h) as { id: number } | undefined;
  return row?.id ?? -1; // -1 => unknown host
}

function inTimeRange(timeFrom: string | null, timeTo: string | null, now: Date): boolean {
  if (!timeFrom && !timeTo) return true;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  if (timeFrom && timeTo) {
    const a = toMin(timeFrom);
    const b = toMin(timeTo);
    return a <= b ? minutes >= a && minutes <= b : minutes >= a || minutes <= b;
  }
  if (timeFrom) return minutes >= toMin(timeFrom);
  return minutes <= toMin(timeTo!);
}

export function resolveLink(ctx: ResolveContext): RedirectOutcome {
  const alias = normalizeAlias(ctx.alias);
  if (!alias || isReservedAlias(alias)) return { kind: "not_found" };

  const domainId = resolveDomainId(ctx.host);
  if (domainId === -1) return { kind: "unavailable", reason: "domain" };

  const link = q
    .prepare(`SELECT * FROM links WHERE domain_id IS ? AND alias = ? AND deleted_at IS NULL`)
    .get(domainId, alias) as Record<string, unknown> | undefined;
  if (!link) return { kind: "not_found" };

  const id = link.id as number;
  const state = link.state as string;
  const now = Date.now();

  if (state === "deleted") return { kind: "not_found" };
  if (state === "blocked") return { kind: "unavailable", reason: "blocked" };
  if (state === "paused") return { kind: "unavailable", reason: "paused" };
  if (state === "archived") return { kind: "unavailable", reason: "archived" };
  if (state === "scheduled" || (link.scheduled_at && new Date(link.scheduled_at as string).getTime() > now)) {
    return { kind: "unavailable", reason: "scheduled" };
  }
  if (state === "expired" || (link.expires_at && new Date(link.expires_at as string).getTime() < now)) {
    return { kind: "unavailable", reason: "expired" };
  }

  // Password gate. The unlock token is bound to the exact host it was issued
  // for, so a password unlock on one domain can never open the same alias on
  // another host.
  if (link.password_hash) {
    const unlocked = ctx.unlockToken
      ? verify<{ alias: string; host: string }>(ctx.unlockToken, (p) => JSON.parse(p) as { alias: string; host: string })
      : null;
    if (
      !unlocked ||
      unlocked.alias !== alias ||
      !unlocked.host ||
      normalizeHost(unlocked.host) !== normalizeHost(ctx.host)
    ) {
      return { kind: "password_required", linkId: id };
    }
  }

  const ua = parseUserAgent(ctx.userAgent);
  const referrer = referrerDomain(ctx.referrer);
  // Never let an attacker-controlled Referer crash the redirect hot path.
  let campaignFromReferrer: string | null = null;
  if (ctx.referrer) {
    try {
      campaignFromReferrer = new URL(ctx.referrer).searchParams.get("utm_campaign");
    } catch {
      campaignFromReferrer = null;
    }
  }
  // The Referer header is attacker-controlled and unbounded; a cap keeps
  // distinct values from amplifying the metric_rollups JSON blobs.
  if (campaignFromReferrer) campaignFromReferrer = campaignFromReferrer.slice(0, 100);
  const lang = ctx.acceptLanguage?.split(",")[0]?.split("-")[0]?.toLowerCase() ?? null;
  const country = ctx.country?.toLowerCase() ?? null;

  // Atomic consumption: single-use and max-clicks are enforced with guarded
  // UPDATEs inside an immediate transaction so concurrent requests cannot
  // double-consume. Analytics are recorded asynchronously after the redirect.
  let outcome: RedirectOutcome = { kind: "not_found" };
  tx(() => {
    const fresh = q.prepare(`SELECT * FROM links WHERE id = ?`).get(id) as Record<string, unknown>;
    if (fresh.single_use === 1) {
      if (fresh.used_at) {
        outcome = { kind: "gone" };
        return;
      }
      const r = q
        .prepare(`UPDATE links SET used_at = ?, click_count = click_count + 1, updated_at = ? WHERE id = ? AND used_at IS NULL`)
        .run(new Date().toISOString(), new Date().toISOString(), id);
      if (r.changes === 0) {
        outcome = { kind: "gone" };
        return;
      }
    } else if (fresh.max_clicks != null) {
      const r = q
        .prepare(`UPDATE links SET click_count = click_count + 1, updated_at = ? WHERE id = ? AND click_count < ?`)
        .run(new Date().toISOString(), id, fresh.max_clicks);
      if (r.changes === 0) {
        outcome = { kind: "gone" };
        return;
      }
    } else {
      q.prepare(`UPDATE links SET click_count = click_count + 1, updated_at = ? WHERE id = ?`).run(
        new Date().toISOString(), id,
      );
    }

    // Rules: deterministic order by priority then id; first match wins.
    const rules = q
      .prepare(`SELECT * FROM redirect_rules WHERE link_id = ? ORDER BY priority ASC, id ASC`)
      .all(id) as Array<Record<string, unknown>>;
    let location: string | null = null;
    for (const rule of rules) {
      if (rule.country && String(rule.country).toLowerCase() !== country) continue;
      if (rule.language && String(rule.language).toLowerCase() !== lang) continue;
      if (rule.device && String(rule.device).toLowerCase() !== ua.device?.toLowerCase()) continue;
      if (rule.os && !(ua.os ?? "").toLowerCase().includes(String(rule.os).toLowerCase())) continue;
      if (rule.referrer && !(referrer ?? "").toLowerCase().includes(String(rule.referrer).toLowerCase())) continue;
      if (rule.campaign && String(rule.campaign).toLowerCase() !== (campaignFromReferrer ?? "").toLowerCase()) continue;
      if (!inTimeRange(rule.time_from as string | null, rule.time_to as string | null, new Date())) continue;
      location = rule.destination as string;
      break;
    }
    if (!location && (link.fallback_destination as string | null)) {
      location = link.fallback_destination as string;
    }
    outcome = {
      kind: "redirect",
      location: location ?? (link.destination as string),
      linkId: id,
      campaign: (link.utm_campaign as string | null) ?? campaignFromReferrer,
      recordClick: true,
    };
  });
  return outcome;
}
