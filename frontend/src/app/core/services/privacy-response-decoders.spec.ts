import { decodePrivacyRequestsPage, decodePrivacyRequestCreated, decodePrivacyAdminAction } from "./privacy-response-decoders";

const timestamp = "2026-09-06T10:00:00Z";
const request = {
  id: 1, type: "access", status: "submitted", identityVerifiedAt: null,
  acknowledgedAt: null, dueAt: timestamp, extendedUntil: null, extensionReasonCode: null,
  completedAt: null, cancelledAt: null, createdAt: timestamp, updatedAt: timestamp,
  overdue: false, messages: [{ id: 2, authorRole: "user", body: "My request", createdAt: timestamp }],
};

describe("privacy response decoders", () => {
  it("decodes account and minimized administrator pages", () => {
    const own = decodePrivacyRequestsPage({ requests: [request], total: 1, page: 1, perPage: 10 }, { page: 1, perPage: 10 });
    expect(own.requests[0].type).toBe("access");
    const admin = decodePrivacyRequestsPage({
      requests: [{ ...request, userId: 3, name: "User", email: "user@example.test", assignedAdminName: null }],
      total: 1, page: 1, perPage: 20,
    }, { page: 1, perPage: 20, admin: true });
    expect(admin.requests[0].userId).toBe(3);
  });

  it("rejects stale pagination and malformed legal records", () => {
    expect(() => decodePrivacyRequestsPage({ requests: [], total: 0, page: 2, perPage: 10 }, { page: 1, perPage: 10 })).toThrow();
    expect(() => decodePrivacyRequestsPage({ requests: [{ ...request, status: "unknown" }], total: 1, page: 1, perPage: 10 }, { page: 1, perPage: 10 })).toThrow();
  });
  it("requires a complete admission for the sent right and accepts server timezone timestamps", () => {
    expect(decodePrivacyRequestCreated({ request }, "access").id).toBe(1);
    expect(decodePrivacyRequestCreated({ request: { ...request, dueAt: "2026-10-06 10:00:00+00" } }, "access").dueAt).toContain("+00");
    for (const value of [{}, { request: { id: 1 } }, { request: { ...request, type: "erasure" } },
      { request: { ...request, status: "completed" } }, { request: { ...request, dueAt: "unknown" } }]) {
      expect(() => decodePrivacyRequestCreated(value, "access")).toThrow();
    }
  });

  it("requires an affirmative legal decision with the expected resulting status", () => {
    expect(() => decodePrivacyAdminAction({ ok: true, status: "completed" }, "completed")).not.toThrow();
    for (const value of [{}, { ok: "true", status: "completed" }, { ok: true }, { ok: true, status: "rejected" }]) {
      expect(() => decodePrivacyAdminAction(value, "completed")).toThrow();
    }
  });

  it("preserves multiline legal messages and rejects unsafe control characters", () => {
    const multiline = { ...request, messages: [{ id: 2, authorRole: "admin", body: "Respuesta motivada.\nSegunda línea.\tDetalle.", createdAt: timestamp }] };
    expect(decodePrivacyRequestCreated({ request: multiline }, "access").messages[0].body).toContain("\nSegunda línea.");
    expect(() => decodePrivacyRequestCreated({ request: { ...multiline, messages: [{ ...multiline.messages[0], body: "Unsafe\u0000content" }] } }, "access")).toThrow();
  });

});

