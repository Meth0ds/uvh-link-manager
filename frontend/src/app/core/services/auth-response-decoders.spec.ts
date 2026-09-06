import {
  decodeAccountDeletionImpact,
  decodeAccountDeletionRequest,
  decodeAuthUserResponse,
  decodeDataExportStatusResponse,
  decodeLoginOutcome,
  decodeLoginResponse,
  decodeMfaReauthentication,
  decodeMfaSessionStatus,
  decodeMfaSetup,
  decodeRecoveryCodes,
  decodeRequiredDataExportResponse,
  decodeSessionRevocation,
  decodeSessionsResponse,
  decodeWorkspacesResponse,
} from "./auth-response-decoders";
import type { AccountDeletionImpact, DataExportStatus } from "../models";

const user = {
  id: 7,
  email: "person@example.test",
  name: "Person",
  isAdmin: false,
  emailVerified: true,
  mfaEnabled: true,
  recoveryCodesRemaining: 4,
  pendingEmail: null,
  pendingEmailExpiresAt: null,
};

describe("authentication response decoders", () => {
  it("accepts and reconstructs a valid authenticated identity", () => {
    expect(decodeAuthUserResponse({ user, ignored: "not-published" })).toEqual({ user });
    expect(decodeLoginResponse({ user })).toEqual({ mfaRequired: false, user });
  });

  it("accepts only a complete MFA challenge branch", () => {
    expect(decodeLoginOutcome({
      mfaRequired: true,
      challenge: "opaque-challenge",
      recoveryAvailable: true,
    })).toEqual({ mfaRequired: true, challenge: "opaque-challenge", recoveryAvailable: true });

    expect(() => decodeLoginOutcome({ mfaRequired: true, challenge: "opaque-challenge" })).toThrow();
  });

  it("rejects malformed identity fields before they reach session state", () => {
    expect(() => decodeAuthUserResponse({ user: { ...user, id: "7" } })).toThrow();
    expect(() => decodeAuthUserResponse({ user: { ...user, isAdmin: 1 } })).toThrow();
    expect(() => decodeLoginResponse({ mfaRequired: true, challenge: "opaque", recoveryAvailable: false })).toThrow();
  });

  it("validates every workspace and rejects unknown roles atomically", () => {
    const valid = { id: 4, name: "Main", slug: "main", role: "owner" as const, createdAt: "2026-09-05T10:00:00Z" };
    expect(decodeWorkspacesResponse({ workspaces: [valid] })).toEqual({ workspaces: [valid] });
    expect(() => decodeWorkspacesResponse({ workspaces: [valid, { ...valid, role: "root" }] })).toThrow();
  });

  it("validates MFA session freshness and reauthentication timestamps", () => {
    expect(decodeMfaSessionStatus({ enabled: true, fresh: false, verifiedAt: null, expiresAt: null })).toEqual({
      enabled: true, fresh: false, verifiedAt: null, expiresAt: null,
    });
    expect(decodeMfaReauthentication({ ok: true, verifiedAt: "2026-09-06T00:00:00Z", expiresAt: "2026-09-06T00:10:00Z" }).ok).toBeTrue();
    expect(() => decodeMfaSessionStatus({ enabled: 1, fresh: false, verifiedAt: null, expiresAt: null })).toThrow();
  });

  it("validates nullable and required data-export envelopes", () => {
    const status = {
      id: 4,
      status: "ready",
      confirmationExpiresAt: null,
      downloadExpiresAt: "2026-09-07T00:00:00Z",
      createdAt: "2026-09-06T00:00:00Z",
      confirmedAt: "2026-09-06T00:01:00Z",
      readyAt: "2026-09-06T00:02:00Z",
      downloadedAt: null,
    } satisfies DataExportStatus;
    expect(decodeDataExportStatusResponse({ export: null })).toEqual({ export: null });
    expect(decodeRequiredDataExportResponse({ export: status })).toEqual({ export: status });
    expect(() => decodeRequiredDataExportResponse({ export: null })).toThrow();
    expect(() => decodeDataExportStatusResponse({ export: { ...status, status: "unknown" } })).toThrow();
  });

  it("validates account-deletion impact and request contracts", () => {
    const impact = {
      canDelete: false,
      isPlatformAdmin: false,
      ownedWorkspaces: [{ id: 2, name: "Owned", slug: "owned" }],
      blockingPrivacyRequests: [{ id: 3, type: "access", status: "submitted", due_at: "2026-10-06T00:00:00Z" }],
      request: { status: "requested", confirmationExpiresAt: "2026-09-06T01:00:00Z" },
    } satisfies AccountDeletionImpact;
    expect(decodeAccountDeletionImpact(impact)).toEqual(impact);
    expect(decodeAccountDeletionRequest(impact.request)).toEqual(impact.request);
    expect(() => decodeAccountDeletionImpact({ ...impact, blockingPrivacyRequests: [{ ...impact.blockingPrivacyRequests[0], type: "unknown" }] })).toThrow();
  });

  it("validates session rows and revocation outcomes", () => {
    const session = {
      id: "opaque-session",
      user_agent: null,
      created_at: "2026-09-06T00:00:00Z",
      last_used_at: "2026-09-06T00:00:00Z",
      expires_at: "2026-10-06T00:00:00Z",
      revoked_at: null,
      mfa_verified_at: null,
      current: true,
    };
    expect(decodeSessionsResponse({ sessions: [session] })).toEqual({ sessions: [session] });
    expect(decodeSessionRevocation({ ok: true, current: true })).toEqual({ ok: true, current: true });
    expect(() => decodeSessionsResponse({ sessions: [{ ...session, current: 1 }] })).toThrow();
  });

  it("validates MFA setup URIs and every recovery code", () => {
    expect(decodeMfaSetup({ secret: "BASE32", uri: "otpauth://totp/UVH:test" })).toEqual({
      secret: "BASE32", uri: "otpauth://totp/UVH:test",
    });
    expect(decodeRecoveryCodes({ recoveryCodes: ["ABCD-EFGH", "JKLM-NPQR"] })).toEqual({
      recoveryCodes: ["ABCD-EFGH", "JKLM-NPQR"],
    });
    expect(() => decodeMfaSetup({ secret: "BASE32", uri: "https://example.test" })).toThrow();
    expect(() => decodeRecoveryCodes({ recoveryCodes: ["valid", 42] })).toThrow();
  });
});
