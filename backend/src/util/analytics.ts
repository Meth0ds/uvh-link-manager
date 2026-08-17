import { createHash } from "node:crypto";
import UAParser from "ua-parser-js";
import { config } from "../config.js";

export interface ClickMeta {
  country: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  referrerDomain: string | null;
  campaign: string | null;
  visitorHash: string | null;
}

/**
 * Derive pseudonymous visitor identity without storing raw IPs.
 * Salted hash of (ip + user-agent) rotated daily.
 */
export function visitorHash(ip: string | undefined, userAgent: string | undefined): string | null {
  if (!ip || !userAgent) return null;
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256")
    .update(`${day}|${ip}|${userAgent}`)
    .digest("hex")
    .slice(0, 32);
}

export function countryFromHeaders(headers: Record<string, string | undefined>): string | null {
  // Country is only accepted from a trusted proxy/edge header (set via
  // TRUST_COUNTRY_HEADER=1). Without that, clients could trivially spoof
  // `cf-ipcountry` and poison per-country analytics.
  if (!config.trustCountryHeader) return null;
  const cf = headers[config.countryHeader];
  if (cf && /^[A-Z]{2}$/.test(cf)) return cf;
  return null;
}

export function referrerDomain(referrer: string | undefined): string | null {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function parseUserAgent(ua: string | undefined): {
  device: string | null;
  browser: string | null;
  os: string | null;
} {
  if (!ua) return { device: null, browser: null, os: null };
  const p = new UAParser(ua).getResult();
  const dev = p.device?.type ? p.device.type : "desktop";
  return {
    device: dev,
    browser: p.browser?.name ?? null,
    os: p.os?.name ?? null,
  };
}
