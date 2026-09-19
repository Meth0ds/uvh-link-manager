import type { SecurityCenterSnapshot } from "../models";
import { decodeSecurityCenter } from "./security-center-response";

describe("decodeSecurityCenter", () => {
  const snapshot: SecurityCenterSnapshot = {
    summary: {
      mfaEnabled: true,
      recoveryCodesRemaining: 7,
      activeSessions: 2,
      currentSessionMfaVerifiedAt: "2026-09-06T12:00:00Z",
      pendingEmail: null,
      pendingEmailExpiresAt: null,
      lastPasswordEventAt: "2026-09-05T11:00:00Z",
    },
    activity: [{ id: 12, action: "auth.mfa_enable", createdAt: "2026-09-06T12:00:00Z" }],
    activityTruncated: false,
  };

  it("copies the bounded account posture contract", () => {
    expect(decodeSecurityCenter(snapshot)).toEqual(snapshot);
  });

  it("rejects unknown activity and invalid counters atomically", () => {
    expect(() => decodeSecurityCenter({ ...snapshot, activity: [{ id: 1, action: "link.view", createdAt: "2026-09-06T12:00:00Z" }] })).toThrow();
    expect(() => decodeSecurityCenter({ ...snapshot, summary: { ...snapshot.summary, activeSessions: -1 } })).toThrow();
  });

  it("reports whether the bounded activity panel was cut short", () => {
    expect(decodeSecurityCenter({ ...snapshot, truncated: true }).activityTruncated).toBeTrue();
    // Absent reads as complete, as it did before the flag existed; a present
    // flag has to be a real boolean, not a truthy string.
    expect(decodeSecurityCenter(snapshot).activityTruncated).toBeFalse();
    expect(() => decodeSecurityCenter({ ...snapshot, truncated: "yes" })).toThrow();
  });

  it("rejects malformed timestamps and oversized activity", () => {
    expect(() => decodeSecurityCenter({ ...snapshot, summary: { ...snapshot.summary, lastPasswordEventAt: "yesterday" } })).toThrow();
    expect(() => decodeSecurityCenter({ ...snapshot, activity: Array.from({ length: 21 }, (_, id) => ({ id: id + 1, action: "auth.login", createdAt: "2026-09-06T12:00:00Z" })) })).toThrow();
  });
});
