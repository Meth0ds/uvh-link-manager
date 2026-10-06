import type { ApiTokenDto } from "./models";

export type ApiTokenState = "active" | "expired" | "revoked" | "unknown";

/** First browser clock tick at or after the wire expiry; do not round micros down. */
export function tokenExpiryTick(raw: string | null): number | null {
  if (raw === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(raw);
  if (!match) return null;
  const [, year, month, day, fraction = ""] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day)) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed + (/[1-9]/.test(fraction.slice(3)) ? 1 : 0) : null;
}

/** Presentation only: API authentication and revocation remain server decisions. */
export function apiTokenState(token: Pick<ApiTokenDto, "revokedAt" | "expiresAt">, now: number): ApiTokenState {
  if (token.revokedAt !== null) return "revoked";
  if (token.expiresAt === null) return "active";
  const expiry = tokenExpiryTick(token.expiresAt);
  return expiry === null ? "unknown" : expiry <= now ? "expired" : "active";
}

export const TOKEN_STATE_LABEL = {
  revoked: "Revocado",
  active: "Activo",
  expired: "Caducado",
  unknown: "Estado desconocido",
} as const;

export const TOKEN_ACTION_LABEL = { revoked: "Revocado", active: "Revocar" } as const;

/** Boolean callers keep the earlier active/revoked contract. */
export function tokenStateLabel(state: ApiTokenState | boolean): string {
  return TOKEN_STATE_LABEL[typeof state === "boolean" ? state ? "revoked" : "active" : state];
}

export function tokenActionLabel(revoked: boolean): string {
  return revoked ? TOKEN_ACTION_LABEL.revoked : TOKEN_ACTION_LABEL.active;
}

export function tokenStateIcon(state: ApiTokenState | boolean): string {
  const current = typeof state === "boolean" ? state ? "revoked" : "active" : state;
  return { active: "key", expired: "schedule", revoked: "key_off", unknown: "help_outline" }[current];
}

/** Expired credentials can still be revoked to retire them definitively. */
export function tokenActionAriaLabel(revoked: boolean, name: string): string {
  return revoked ? `Token revocado: ${name}` : `Revocar token: ${name}`;
}
