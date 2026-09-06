import type { AccountDeletionImpact, AuthUser, DataExportStatus, Session, Workspace, WorkspaceRole } from "../models";
import type { LoginOutcome, LoginResponse, MfaSessionStatus } from "./auth.service";

type JsonRecord = Record<string, unknown>;

const WORKSPACE_ROLES = new Set<WorkspaceRole>(["owner", "admin", "editor", "viewer"]);
const EXPORT_STATUSES = new Set<DataExportStatus["status"]>(["requested", "processing", "ready", "downloaded", "failed", "cancelled", "expired"]);
const PRIVACY_TYPES = new Set(["access", "rectification", "erasure", "objection", "restriction", "portability"]);
const PRIVACY_STATUSES = new Set(["submitted", "in_progress", "waiting_user", "completed", "rejected", "cancelled"]);

function invalid(contract: string): never {
  throw new Error(`Invalid ${contract} response`);
}

function record(value: unknown, contract: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(contract);
  return value as JsonRecord;
}

function integer(value: unknown, contract: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) invalid(contract);
  return value as number;
}

function text(value: unknown, contract: string): string {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f\u007f]/.test(value)) invalid(contract);
  return value;
}

function boolean(value: unknown, contract: string): boolean {
  if (typeof value !== "boolean") invalid(contract);
  return value;
}

function nullableText(value: unknown, contract: string): string | null {
  if (value === null) return null;
  return text(value, contract);
}

function literal<T extends string>(value: unknown, allowed: Set<T>, contract: string): T {
  if (typeof value !== "string" || !allowed.has(value as T)) invalid(contract);
  return value as T;
}

function authUser(value: unknown): AuthUser {
  const source = record(value, "auth user");
  const decoded: AuthUser = {
    id: integer(source["id"], "auth user", 1),
    email: text(source["email"], "auth user"),
    name: text(source["name"], "auth user"),
    isAdmin: boolean(source["isAdmin"], "auth user"),
    emailVerified: boolean(source["emailVerified"], "auth user"),
    mfaEnabled: boolean(source["mfaEnabled"], "auth user"),
  };

  if (source["recoveryCodesRemaining"] !== undefined) {
    decoded.recoveryCodesRemaining = integer(source["recoveryCodesRemaining"], "auth user");
  }
  if (source["pendingEmail"] !== undefined) {
    decoded.pendingEmail = nullableText(source["pendingEmail"], "auth user");
  }
  if (source["pendingEmailExpiresAt"] !== undefined) {
    decoded.pendingEmailExpiresAt = nullableText(source["pendingEmailExpiresAt"], "auth user");
  }
  return decoded;
}

function workspace(value: unknown): Workspace {
  const source = record(value, "workspace");
  const role = source["role"];
  if (role !== null && (typeof role !== "string" || !WORKSPACE_ROLES.has(role as WorkspaceRole))) invalid("workspace");
  return {
    id: integer(source["id"], "workspace", 1),
    name: text(source["name"], "workspace"),
    slug: text(source["slug"], "workspace"),
    role: role as WorkspaceRole | null,
    createdAt: text(source["createdAt"], "workspace"),
  };
}

/** Decode the identity envelope before it can replace the local session. */
export function decodeAuthUserResponse(value: unknown): { user: AuthUser } {
  const source = record(value, "auth identity");
  return { user: authUser(source["user"]) };
}

/** Decode every workspace before publishing the new tenant list atomically. */
export function decodeWorkspacesResponse(value: unknown): { workspaces: Workspace[] } {
  const source = record(value, "workspaces");
  const items = source["workspaces"];
  if (!Array.isArray(items)) invalid("workspaces");
  return { workspaces: items.map(workspace) };
}

/** Login is a strict tagged union; mixed or incomplete branches are rejected. */
export function decodeLoginOutcome(value: unknown): LoginOutcome {
  const source = record(value, "login");
  if (source["mfaRequired"] === true) {
    return {
      mfaRequired: true,
      challenge: text(source["challenge"], "login MFA challenge"),
      recoveryAvailable: boolean(source["recoveryAvailable"], "login MFA challenge"),
    };
  }
  if (source["mfaRequired"] !== undefined && source["mfaRequired"] !== false) invalid("login");
  return { mfaRequired: false, user: authUser(source["user"]) };
}

export function decodeLoginResponse(value: unknown): LoginResponse {
  const outcome = decodeLoginOutcome(value);
  if (outcome.mfaRequired) invalid("authenticated login");
  return outcome;
}

export function decodeMfaSessionStatus(value: unknown): MfaSessionStatus {
  const source = record(value, "MFA session");
  return {
    enabled: boolean(source["enabled"], "MFA session"),
    fresh: boolean(source["fresh"], "MFA session"),
    verifiedAt: nullableText(source["verifiedAt"], "MFA session"),
    expiresAt: nullableText(source["expiresAt"], "MFA session"),
  };
}

export function decodeMfaReauthentication(value: unknown): { ok: true; verifiedAt: string; expiresAt: string } {
  const source = record(value, "MFA reauthentication");
  if (source["ok"] !== true) invalid("MFA reauthentication");
  return {
    ok: true,
    verifiedAt: text(source["verifiedAt"], "MFA reauthentication"),
    expiresAt: text(source["expiresAt"], "MFA reauthentication"),
  };
}

function dataExport(value: unknown): DataExportStatus {
  const source = record(value, "data export");
  return {
    id: integer(source["id"], "data export", 1),
    status: literal(source["status"], EXPORT_STATUSES, "data export"),
    confirmationExpiresAt: nullableText(source["confirmationExpiresAt"], "data export"),
    downloadExpiresAt: nullableText(source["downloadExpiresAt"], "data export"),
    createdAt: nullableText(source["createdAt"], "data export"),
    confirmedAt: nullableText(source["confirmedAt"], "data export"),
    readyAt: nullableText(source["readyAt"], "data export"),
    downloadedAt: nullableText(source["downloadedAt"], "data export"),
  };
}

export function decodeDataExportStatusResponse(value: unknown): { export: DataExportStatus | null } {
  const source = record(value, "data export envelope");
  return { export: source["export"] === null ? null : dataExport(source["export"]) };
}

export function decodeRequiredDataExportResponse(value: unknown): { export: DataExportStatus } {
  const decoded = decodeDataExportStatusResponse(value);
  if (decoded.export === null) invalid("required data export");
  return { export: decoded.export };
}

export function decodeAccountDeletionImpact(value: unknown): AccountDeletionImpact {
  const source = record(value, "account deletion impact");
  const owned = source["ownedWorkspaces"];
  const blocking = source["blockingPrivacyRequests"];
  if (!Array.isArray(owned) || !Array.isArray(blocking)) invalid("account deletion impact");
  const request = source["request"];
  let decodedRequest: AccountDeletionImpact["request"] = null;
  if (request !== null) {
    const item = record(request, "account deletion request");
    if (item["status"] !== "requested") invalid("account deletion request");
    decodedRequest = { status: "requested", confirmationExpiresAt: text(item["confirmationExpiresAt"], "account deletion request") };
  }
  return {
    canDelete: boolean(source["canDelete"], "account deletion impact"),
    isPlatformAdmin: boolean(source["isPlatformAdmin"], "account deletion impact"),
    ownedWorkspaces: owned.map((value) => {
      const item = record(value, "owned workspace");
      return { id: integer(item["id"], "owned workspace", 1), name: text(item["name"], "owned workspace"), slug: text(item["slug"], "owned workspace") };
    }),
    blockingPrivacyRequests: blocking.map((value) => {
      const item = record(value, "blocking privacy request");
      return {
        id: integer(item["id"], "blocking privacy request", 1),
        type: literal(item["type"], PRIVACY_TYPES, "blocking privacy request") as AccountDeletionImpact["blockingPrivacyRequests"][number]["type"],
        status: literal(item["status"], PRIVACY_STATUSES, "blocking privacy request") as AccountDeletionImpact["blockingPrivacyRequests"][number]["status"],
        due_at: text(item["due_at"], "blocking privacy request"),
      };
    }),
    request: decodedRequest,
  };
}

export function decodeAccountDeletionRequest(value: unknown): { status: "requested"; confirmationExpiresAt: string } {
  const source = record(value, "account deletion request");
  if (source["status"] !== "requested") invalid("account deletion request");
  return { status: "requested", confirmationExpiresAt: text(source["confirmationExpiresAt"], "account deletion request") };
}

function session(value: unknown): Session {
  const source = record(value, "session");
  const nullableString = (field: string): string | null => {
    const fieldValue = source[field];
    if (fieldValue !== null && typeof fieldValue !== "string") invalid("session");
    return fieldValue as string | null;
  };
  return {
    id: text(source["id"], "session"),
    user_agent: nullableString("user_agent"),
    created_at: text(source["created_at"], "session"),
    last_used_at: text(source["last_used_at"], "session"),
    expires_at: text(source["expires_at"], "session"),
    revoked_at: nullableString("revoked_at"),
    mfa_verified_at: nullableString("mfa_verified_at"),
    current: boolean(source["current"], "session"),
  };
}

export function decodeSessionsResponse(value: unknown): { sessions: Session[] } {
  const source = record(value, "sessions");
  if (!Array.isArray(source["sessions"])) invalid("sessions");
  return { sessions: source["sessions"].map(session) };
}

export function decodeSessionRevocation(value: unknown): { ok: true; current?: boolean } {
  const source = record(value, "session revocation");
  if (source["ok"] !== true || (source["current"] !== undefined && typeof source["current"] !== "boolean")) invalid("session revocation");
  return source["current"] === undefined ? { ok: true } : { ok: true, current: source["current"] as boolean };
}

export function decodeMfaSetup(value: unknown): { secret: string; uri: string } {
  const source = record(value, "MFA setup");
  const uri = text(source["uri"], "MFA setup");
  if (!uri.startsWith("otpauth://totp/")) invalid("MFA setup");
  return { secret: text(source["secret"], "MFA setup"), uri };
}

export function decodeRecoveryCodes(value: unknown): { recoveryCodes: string[] } {
  const source = record(value, "MFA recovery codes");
  if (!Array.isArray(source["recoveryCodes"])) invalid("MFA recovery codes");
  return { recoveryCodes: source["recoveryCodes"].map((code) => text(code, "MFA recovery codes")) };
}
