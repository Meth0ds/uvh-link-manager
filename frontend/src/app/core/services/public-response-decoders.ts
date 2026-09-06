import { boolean, httpUrl, nullableText, record, text } from "./response-decoder-helpers";

export interface PublicConfig {
  appUrl: string;
  publicHost: string;
  appHost: string;
  hcaptcha: { enabled: boolean; siteKey: string | null };
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
  const siteKey = nullableText(captcha["siteKey"], "public config hCaptcha", 200);
  if ((enabled && (!siteKey || !HCAPTCHA_SITE_KEY.test(siteKey))) || (!enabled && siteKey !== null)) {
    throw new Error("Invalid public config hCaptcha response");
  }

  const publicHost = text(source["publicHost"], "public config", 253).toLowerCase();
  const appHost = text(source["appHost"], "public config", 253).toLowerCase();
  if (!HOST.test(publicHost) || !HOST.test(appHost)) throw new Error("Invalid public config host response");

  return {
    appUrl: httpUrl(source["appUrl"], "public config"),
    publicHost,
    appHost,
    hcaptcha: { enabled, siteKey },
  };
}
