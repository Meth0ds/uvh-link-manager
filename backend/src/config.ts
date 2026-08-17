import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Locate the backend package root (works from src/ in dev and dist/src/ when compiled). */
function findBackendRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return start;
}

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return v === "1" || v === "true" || v === "yes";
}

const env = process.env.NODE_ENV ?? "development";
const isProduction = env === "production";

const appSecret = process.env.APP_SECRET;
// Fail closed in production: refuse to boot without a strong secret.
if (isProduction) {
  if (!appSecret || appSecret === "uvh-dev-secret-change-me" || appSecret.length < 32) {
    throw new Error(
      "APP_SECRET es obligatorio en producción: define un secreto largo y aleatorio (mínimo 32 caracteres), distinto del valor de desarrollo.",
    );
  }
}

const appUrl = process.env.APP_URL ?? (isProduction ? "https://app.uvh.es" : "http://localhost:4200");

export const config = {
  env,
  port: Number(process.env.PORT ?? process.env.BACKEND_PORT ?? 3001),
  // DB
  dbPath: process.env.DATABASE_PATH ?? path.join(findBackendRoot(here), "data", "uvh.sqlite"),
  // Secrets
  appSecret: appSecret ?? "uvh-dev-secret-change-me", // dev/test fallback only
  // Auth / sessions
  sessionCookieName: process.env.SESSION_COOKIE ?? "uvh_session",
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
  // Secure cookies by default in production (always served over HTTPS there);
  // override with COOKIE_SECURE=false only for testing.
  cookieSecure: bool(process.env.COOKIE_SECURE, isProduction),
  cookieDomain: process.env.COOKIE_DOMAIN ?? undefined, // NEVER ".uvh.es" — panel cookie stays on app host
  // Analytics country: only trust a proxy-supplied header when explicitly
  // enabled, otherwise clients could spoof it to poison per-country stats.
  trustCountryHeader: bool(process.env.TRUST_COUNTRY_HEADER, false),
  countryHeader: process.env.COUNTRY_HEADER ?? "cf-ipcountry",
  // Hosts (uvh.es = public, app.uvh.es = panel/API)
  appUrl,
  appHost: process.env.APP_HOST ?? new URL(appUrl).hostname,
  publicHost: process.env.PUBLIC_HOST ?? "uvh.es",
  // Email
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  mailFrom: process.env.MAIL_FROM ?? "UVH <no-reply@uvh.es>",
  // Anti-abuse
  verifiedRequiredToCreate: bool(process.env.VERIFIED_REQUIRED_TO_CREATE, true),
};

export const isProd = isProduction;
