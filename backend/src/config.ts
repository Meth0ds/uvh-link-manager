import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return v === "1" || v === "true" || v === "yes";
}

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? process.env.BACKEND_PORT ?? 3001),
  // DB
  dbPath:
    process.env.DATABASE_PATH ??
    path.join(__dirname, "..", "data", "uvh.sqlite"),
  // Secrets
  appSecret: process.env.APP_SECRET ?? "uvh-dev-secret-change-me",
  // Auth / sessions
  sessionCookieName: process.env.SESSION_COOKIE ?? "uvh_session",
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  cookieDomain: process.env.COOKIE_DOMAIN ?? undefined, // NEVER ".uvh.es" — panel cookie stays on app host
  // App
  appUrl: process.env.APP_URL ?? "http://localhost:4200",
  publicHost: process.env.PUBLIC_HOST ?? "uvh.es",
  // Email
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  mailFrom: process.env.MAIL_FROM ?? "UVH <no-reply@uvh.es>",
  // Anti-abuse
  verifiedRequiredToCreate: bool(process.env.VERIFIED_REQUIRED_TO_CREATE, true),
};

export const isProd = config.env === "production";
