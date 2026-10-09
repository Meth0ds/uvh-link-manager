import { boolean, httpUrl, nullableText, record, text } from "./response-decoder-helpers";

export interface PublicConfig {
  appUrl: string;
  publicHost: string;
  appHost: string;
  registrationPaused: boolean;
  legalIdentity: { name: string; taxId: string; address: string; registryStatus: "registered" | "not_registered"; registry: string | null; hostingProvider: string; hostingRegion: string } | null;
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
  // Los despliegues anteriores no anuncian esta capacidad. Una respuesta sin
  // el campo nunca debe leerse como pausa: solo un `true` explícito pausa.
  const registrationPaused = source["registrationPaused"] === undefined
    ? false : boolean(source["registrationPaused"], "public config");

  const publicHost = text(source["publicHost"], "public config", 253).toLowerCase();
  const appHost = text(source["appHost"], "public config", 253).toLowerCase();
  if (!HOST.test(publicHost) || !HOST.test(appHost)) throw new Error("Invalid public config host response");
  const legalSource = source["legalIdentity"] === null ? null : record(source["legalIdentity"], "public legal identity");
  // Old APIs publish only complete registered identities. Absence of a registry
  // needs a new, explicit declaration; never infer it from a missing field.
  const registryStatus = legalSource && legalSource["registryStatus"] !== undefined ? legalSource["registryStatus"] : "registered";
  if (registryStatus !== "registered" && registryStatus !== "not_registered") throw new Error("Invalid public legal identity response");
  const registry = legalSource === null ? null : registryStatus === "registered"
    ? legalText(legalSource["registry"], 3, 500)
    : nullableText(legalSource["registry"], "public legal identity", 500);
  if (registryStatus === "not_registered" && registry !== null) throw new Error("Invalid public legal identity response");
  const legalIdentity: PublicConfig["legalIdentity"] = legalSource === null ? null : {
    name: legalText(legalSource["name"], 2, 200),
    taxId: legalText(legalSource["taxId"], 3, 40),
    address: legalText(legalSource["address"], 10, 500),
    registryStatus,
    registry,
    hostingProvider: legalText(legalSource["hostingProvider"], 2, 200),
    hostingRegion: legalText(legalSource["hostingRegion"], 2, 200),
  };

  return {
    appUrl: httpUrl(source["appUrl"], "public config"),
    publicHost,
    appHost,
    registrationPaused,
    legalIdentity,
    hcaptcha: { enabled, siteKey, developmentFallback },
  };
}

/** Match the server's publication bounds; unfinished data is not an identity. */
function legalText(value: unknown, minimum: number, maximum: number): string {
  const decoded = text(value, "public legal identity", maximum).trim();
  if (Array.from(decoded).length < minimum || /(?:\bpendiente\b|por completar|\btodo\b|\btbd\b|change.?me|example)/iu.test(decoded)) {
    throw new Error("Invalid public legal identity response");
  }
  return decoded;
}
