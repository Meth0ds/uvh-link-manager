import type { SecurityCenterSnapshot } from "../models";
import { boolean, boundedArray, integer, literal, nullableText, record, text } from "./response-decoder-helpers";

const ACTIONS = new Set([
  "auth.login", "auth.logout", "auth.password_change", "auth.password_reset", "auth.session_revoke",
  "auth.mfa_enable", "auth.mfa_disable", "auth.mfa_reconfigured", "auth.mfa_recovery",
  "auth.mfa_recovery_regenerate", "auth.mfa_reauthenticated", "auth.email_change_requested",
  "auth.email_change_cancelled", "auth.email_change_confirmed", "auth.emergency_access_revoked",
  "auth.account_recovery_completed",
]);

function timestamp(value: unknown, contract: string, nullable = true): string | null {
  const decoded = nullable ? nullableText(value, contract, 64) : text(value, contract, 64);
  if (decoded !== null && (!/^\d{4}-\d{2}-\d{2}T/.test(decoded) || !Number.isFinite(Date.parse(decoded)))) {
    throw new Error(`Invalid ${contract} response`);
  }
  return decoded;
}

/** Copy only account posture and allowlisted activity; audit metadata is never accepted. */
export function decodeSecurityCenter(value: unknown): SecurityCenterSnapshot {
  const source = record(value, "security center");
  const summary = record(source["summary"], "security center summary");
  return {
    summary: {
      mfaEnabled: boolean(summary["mfaEnabled"], "security center MFA"),
      recoveryCodesRemaining: integer(summary["recoveryCodesRemaining"], "security center recovery codes"),
      activeSessions: integer(summary["activeSessions"], "security center active sessions"),
      currentSessionMfaVerifiedAt: timestamp(summary["currentSessionMfaVerifiedAt"], "security center timestamp"),
      pendingEmail: nullableText(summary["pendingEmail"], "security center pending email", 254),
      pendingEmailExpiresAt: timestamp(summary["pendingEmailExpiresAt"], "security center timestamp"),
      lastPasswordEventAt: timestamp(summary["lastPasswordEventAt"], "security center timestamp"),
    },
    activity: boundedArray(source["activity"], "security center activity", 20).map((item) => {
      const event = record(item, "security center event");
      return {
        id: integer(event["id"], "security center event", 1),
        action: literal(event["action"], ACTIONS, "security center action"),
        createdAt: timestamp(event["createdAt"], "security center event timestamp", false)!,
      };
    }),
  };
}
