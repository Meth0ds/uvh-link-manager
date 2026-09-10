import { boolean, httpUrl, nullableText, record, text } from "./response-decoder-helpers";

export interface PublicConfig {
  appUrl: string;
  publicHost: string;
  appHost: string;
  legalIdentity: { name: string; taxId: string; address: string; registry: string; hostingProvider: string; hostingRegion: string } | null;
  hcaptcha: { enabled: boolean; siteKey: string | null; developmentFallback: boolean };
}

const HCAPTCHA_SITE_KEY = /^[A-Za-z0-9_-]{20,200}$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * Reconstruct the small public projection instead of retaining arbitrary keys
 * from the wire response. This prevents accidental server-only configuration
 * fields from being propagated through application state.
 */
export function decodePublicConfig(value: unknown): PublicConfig {
  const source = record(value, "public config");
  const captcha = record(source["hcaptcha"], "public config hCaptcha");
  const enabled = boolean(captcha["enabled"], "public config hCaptcha");
  // Older APIs do not grant this capability. Missing or malformed config
  // must never silently turn a provider outage into authentication access.
  const developmentFallback = captcha["developmentFallback"] === undefined
    ? false : boolean(captcha["developmentFallback"], "public config hCaptcha fallback");
  const siteKey = nullableText(captcha["siteKey"], "public config hCaptcha", 200);
  if ((enabled && (!siteKey || !HCAPTCHA_SITE_KEY.test(siteKey))) || (!enabled && siteKey !== null)) {
    throw new Error("Invalid public config hCaptcha response");
  }

  const publicHost = text(source["publicHost"], "public config", 253).toLowerCase();
  const appHost = text(source["appHost"], "public config", 253).toLowerCase();
  if (!HOST.test(publicHost) || !HOST.test(appHost)) throw new Error("Invalid public config host response");
  const legalSource = source["legalIdentity"] === null ? null : record(source["legalIdentity"], "public legal identity");
  const legalIdentity = legalSource === null ? null : {
    name: text(legalSource["name"], "public legal identity", 200),
    taxId: text(legalSource["taxId"], "public legal identity", 40),
    address: text(legalSource["address"], "public legal identity", 500),
    registry: text(legalSource["registry"], "public legal identity", 500),
    hostingProvider: text(legalSource["hostingProvider"], "public legal identity", 200),
    hostingRegion: text(legalSource["hostingRegion"], "public legal identity", 200),
  };

  return {
    appUrl: httpUrl(source["appUrl"], "public config"),
    publicHost,
    appHost,
    legalIdentity,
    hcaptcha: { enabled, siteKey, developmentFallback },
  };
}
