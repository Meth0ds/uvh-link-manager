import {
  decodeAccountRecoveryDecision,
  decodeAdminAuditPage,
  decodeAdminDomainsPage,
  decodeAdminMailPage,
  decodeAdminOperations,
  decodeAdminOverview,
  decodeAdminRecoveriesPage,
  decodeAdminReportsPage,
  decodeAdminUsersPage,
} from "./admin-response-decoders";

const timestamp = "2026-09-06T10:00:00Z";
const page = (field: string, item: unknown) => ({ total: 1, page: 1, perPage: 20, [field]: [item] });
const context = { page: 1, perPage: 20 };

describe("admin response decoders", () => {
  it("decodes every administrative collection before publication", () => {
    expect(decodeAdminUsersPage(page("users", {
      id: 2, email: "admin@example.test", name: "Admin", is_admin: 1,
      email_verified_at: timestamp, mfa_enabled: true, created_at: timestamp,
      deleted_at: null, workspaces: 1, links: 3,
    }), context).users?.[0].is_admin).toBeTrue();

    expect(decodeAdminReportsPage(page("reports", {
      id: 3, link_id: 4, reporter_email: null, reason: "phishing", details: null,
      status: "open", created_at: timestamp, alias: "safe", destination: "https://example.test",
      link_state: "active", workspace_id: 5,
    }), context).reports?.[0].status).toBe("open");

    expect(decodeAdminRecoveriesPage(page("recoveries", {
      id: 6, userId: 7, name: "Account", email: "account@example.test", status: "in_review",
      approvalCount: 1, targetIsAdmin: false, mfaEnabled: true, emailConfirmedAt: timestamp,
      approvedAt: null, rejectedAt: null, completedAt: null, expiresAt: timestamp,
      createdAt: timestamp, updatedAt: timestamp,
    }), context).recoveries?.[0].approvalCount).toBe(1);

    expect(decodeAdminDomainsPage(page("domains", {
      id: 8, workspace_id: 5, domain: "go.example.test", state: "verified",
      verified_at: timestamp, created_at: timestamp, updated_at: timestamp, workspace_name: "Main",
    }), context).domains?.[0].state).toBe("verified");

    expect(decodeAdminAuditPage(page("events", {
      id: 9, user_id: null, action: "admin.review", resource_type: "report",
      resource_id: "3", metadata: { result: "reviewed" }, ip_hash: null, created_at: timestamp,
    }), context).events?.[0].action).toBe("admin.review");

    expect(decodeAdminMailPage(page("messages", {
      id: 10, kind: "verification", resourceType: "user", status: "queued", attempts: 0,
      manualRetryCount: 0, retryable: false, availableAt: timestamp, queuedAt: timestamp,
      lockedAt: null, sentAt: null, failedAt: null, lastManualRetryAt: null,
      lastError: null, createdAt: timestamp, updatedAt: timestamp,
    }), context).messages?.[0].status).toBe("queued");
  });

  it("decodes overview, operations and recovery decisions", () => {
    expect(decodeAdminOverview({ users: 1, workspaces: 2, links: 3, clicks: 4, openReports: 5, blockedLinks: 6, domains: 7 }).clicks).toBe(4);
    expect(decodeAccountRecoveryDecision({ ok: true, status: "approved", approvalCount: 2 })).toEqual({ status: "approved", approvalCount: 2 });
    expect(decodeAdminOperations({
      state: "healthy", environment: "testing", generatedAt: timestamp,
      checks: [{ key: "queue", label: "Queue", status: "ok", detail: null }],
      metrics: {
        pendingJobs: 0, oldestJobAgeSeconds: null, failedJobs: 0,
        webhookDeliveries: { pending: 0 }, oldestPendingWebhookAgeSeconds: null,
        mailOutbox: { queued: 1 }, oldestPendingMailAgeSeconds: null,
        activeSessions: 1, unverifiedUsers: 0, domains: { active: 1 },
        oldestDnsCheckAgeSeconds: null, oldestTlsProvisioningAgeSeconds: null,
        events60m: { login: 1 }, queueHeartbeatAgeSeconds: 2,
        schedulerHeartbeatAgeSeconds: 3, activePrivacyRequests: 0, overduePrivacyRequests: 0,
      },
    }).state).toBe("healthy");
  });

  it("rejects stale pages, unsafe destinations and invalid operational counts", () => {
    expect(() => decodeAdminUsersPage({ total: 0, page: 2, perPage: 20, users: [] }, context)).toThrow();
    expect(() => decodeAdminReportsPage(page("reports", {
      id: 3, link_id: 4, reporter_email: null, reason: "x", details: null, status: "open",
      created_at: timestamp, alias: "x", destination: "javascript:alert(1)", link_state: "active", workspace_id: 5,
    }), context)).toThrow();
    expect(() => decodeAdminOverview({ users: -1 })).toThrow();
  });
});

