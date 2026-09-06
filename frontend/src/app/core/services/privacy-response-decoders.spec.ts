import { decodePrivacyRequestsPage } from "./privacy-response-decoders";

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
});

