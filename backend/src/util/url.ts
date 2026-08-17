/** Reserved aliases and paths that must never be used as short links. */
export const RESERVED_ALIASES = new Set([
  "app", "api", "admin", "login", "registro", "register", "soporte", "support",
  "security", "privacy", "terms", "denunciar", "report", "robots.txt",
  "sitemap.xml", "favicon.ico", "health", "legal", "auth", "settings",
]);

const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/**
 * Validate a destination URL. Accepts only absolute http/https URLs.
 * Rejects javascript:, data:, file:, ftp:, embedded credentials, control
 * characters, CR/LF and invalid hosts. Uses structured URL parsing.
 */
export function validateDestination(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    return { ok: false, error: "URL inválida" };
  }
  if (CONTROL_RE.test(raw)) return { ok: false, error: "La URL contiene caracteres de control" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "La URL no es válida" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Solo se permiten URLs http/https" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Las URLs no pueden incluir credenciales" };
  }
  const host = url.hostname;
  if (!host || host.length === 0) return { ok: false, error: "Host inválido" };
  // Reject whitespace/control in host, invalid chars
  if (/[\s\u0000-\u001f]/.test(host)) return { ok: false, error: "Host inválido" };
  if (!host.includes(".") && host !== "localhost") return { ok: false, error: "Host inválido" };
  return { ok: true, url };
}

/** Normalize an alias: lowercase, trim, strip leading/trailing slashes. */
export function normalizeAlias(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
}

export function isReservedAlias(alias: string): boolean {
  return RESERVED_ALIASES.has(alias);
}

export function isValidCustomAlias(alias: string): boolean {
  // URL-safe, 1..64 chars, letters/digits/dash/underscore
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(alias);
}
