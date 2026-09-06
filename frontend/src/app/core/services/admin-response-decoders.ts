import type {
  AccountRecoveryStatus,
  AdminAccountRecovery,
  AdminDomain,
  AdminMailOutboxMessage,
  AdminOperations,
  AdminOverview,
  AdminReport,
  AdminUser,
  AuditEvent,
  DomainState,
  LinkState,
  MailOutboxStatus,
} from "../models";
import {
  boolean,
  boundedArray,
  countRecord,
  httpUrl,
  integer,
  invalid,
  literal,
  nullableInteger,
  nullableText,
  record,
  text,
} from "./response-decoder-helpers";

export interface AdminPageResponse<T> {
  total: number;
  page: number;
  perPage: number;
  users?: T[];
  reports?: T[];
  recoveries?: T[];
  domains?: T[];
  events?: T[];
  messages?: T[];
}

export interface AdminPageContext {
  page: number;
  perPage: number;
}

const REPORT_STATUSES = new Set<AdminReport["status"]>(["open", "reviewed", "actioned", "dismissed"]);
const RECOVERY_STATUSES = new Set<AccountRecoveryStatus>(["requested", "email_confirmed", "in_review", "approved", "rejected", "completed", "expired", "cancelled"]);
const DOMAIN_STATES = new Set<DomainState>(["pending", "verifying", "verified", "provisioning", "active", "error", "disabled"]);
const LINK_STATES = new Set<LinkState>(["scheduled", "active", "paused", "expired", "blocked", "archived", "deleted"]);
const MAIL_STATUSES = new Set<MailOutboxStatus>(["pending", "queued", "processing", "sent", "failed", "obsolete", "comp_pending", "compensating", "compensated"]);

function databaseBoolean(value: unknown, contract: string): boolean {
  if (value === 0 || value === 1) return value === 1;
  return boolean(value, contract);
}

function page<T>(value: unknown, field: keyof AdminPageResponse<T>, expected: AdminPageContext, decode: (item: unknown) => T): AdminPageResponse<T> {
  const source = record(value, `admin ${String(field)} page`);
  const responsePage = integer(source["page"], "admin page", 1, 10_000);
  const perPage = integer(source["perPage"], "admin page", 1, 100);
  const total = integer(source["total"], "admin page");
  const items = boundedArray(source[field as string], `admin ${String(field)} page`, perPage).map(decode);
  if (responsePage !== expected.page || perPage !== expected.perPage || items.length > total) invalid("admin page context");
  return { total, page: responsePage, perPage, [field]: items } as AdminPageResponse<T>;
}

export function decodeAdminOverview(value: unknown): AdminOverview {
  const source = record(value, "admin overview");
  return {
    users: integer(source["users"], "admin overview"),
    workspaces: integer(source["workspaces"], "admin overview"),
    links: integer(source["links"], "admin overview"),
    clicks: integer(source["clicks"], "admin overview"),
    openReports: integer(source["openReports"], "admin overview"),
    blockedLinks: integer(source["blockedLinks"], "admin overview"),
    domains: integer(source["domains"], "admin overview"),
  };
}

export function decodeAdminUsersPage(value: unknown, expected: AdminPageContext): AdminPageResponse<AdminUser> {
  return page(value, "users", expected, (item) => {
    const source = record(item, "admin user");
    return {
      id: integer(source["id"], "admin user", 1),
      email: text(source["email"], "admin user", 320),
      name: text(source["name"], "admin user", 255),
      is_admin: databaseBoolean(source["is_admin"], "admin user administrator flag"),
      email_verified_at: nullableText(source["email_verified_at"], "admin user timestamp", 64),
      mfa_enabled: databaseBoolean(source["mfa_enabled"], "admin user MFA flag"),
      created_at: text(source["created_at"], "admin user timestamp", 64),
      deleted_at: nullableText(source["deleted_at"], "admin user timestamp", 64),
      workspaces: integer(source["workspaces"], "admin user workspace count"),
      links: integer(source["links"], "admin user link count"),
    };
  });
}

export function decodeAdminReportsPage(value: unknown, expected: AdminPageContext): AdminPageResponse<AdminReport> {
  return page(value, "reports", expected, (item) => {
    const source = record(item, "admin report");
    return {
      id: integer(source["id"], "admin report", 1),
      link_id: integer(source["link_id"], "admin report", 1),
      reporter_email: nullableText(source["reporter_email"], "admin report email", 320),
      reason: text(source["reason"], "admin report reason", 255),
      details: nullableText(source["details"], "admin report details", 4000, true),
      status: literal(source["status"], REPORT_STATUSES, "admin report status"),
      created_at: text(source["created_at"], "admin report timestamp", 64),
      alias: text(source["alias"], "admin report alias", 64),
      destination: httpUrl(source["destination"], "admin report destination"),
      link_state: literal(source["link_state"], LINK_STATES, "admin report link state"),
      workspace_id: integer(source["workspace_id"], "admin report workspace", 1),
    };
  });
}

export function decodeAdminRecoveriesPage(value: unknown, expected: AdminPageContext): AdminPageResponse<AdminAccountRecovery> {
  return page(value, "recoveries", expected, (item) => {
    const source = record(item, "admin account recovery");
    return {
      id: integer(source["id"], "admin account recovery", 1),
      userId: integer(source["userId"], "admin account recovery", 1),
      name: text(source["name"], "admin account recovery", 255),
      email: text(source["email"], "admin account recovery", 320),
      status: literal(source["status"], RECOVERY_STATUSES, "admin account recovery status"),
      approvalCount: integer(source["approvalCount"], "admin account recovery approvals"),
      targetIsAdmin: boolean(source["targetIsAdmin"], "admin account recovery target flag"),
      mfaEnabled: boolean(source["mfaEnabled"], "admin account recovery MFA flag"),
      emailConfirmedAt: nullableText(source["emailConfirmedAt"], "admin account recovery timestamp", 64),
      approvedAt: nullableText(source["approvedAt"], "admin account recovery timestamp", 64),
      rejectedAt: nullableText(source["rejectedAt"], "admin account recovery timestamp", 64),
      completedAt: nullableText(source["completedAt"], "admin account recovery timestamp", 64),
      expiresAt: text(source["expiresAt"], "admin account recovery timestamp", 64),
      createdAt: text(source["createdAt"], "admin account recovery timestamp", 64),
      updatedAt: text(source["updatedAt"], "admin account recovery timestamp", 64),
    };
  });
}

export function decodeAccountRecoveryDecision(value: unknown): { status: AccountRecoveryStatus; approvalCount: number } {
  const source = record(value, "account recovery decision");
  if (source["ok"] !== true) invalid("account recovery decision");
  return {
    status: literal(source["status"], RECOVERY_STATUSES, "account recovery decision status"),
    approvalCount: integer(source["approvalCount"], "account recovery decision approvals"),
  };
}

export function decodeAdminDomainsPage(value: unknown, expected: AdminPageContext): AdminPageResponse<AdminDomain> {
  return page(value, "domains", expected, (item) => {
    const source = record(item, "admin domain");
    return {
      id: integer(source["id"], "admin domain", 1),
      workspace_id: integer(source["workspace_id"], "admin domain workspace", 1),
      domain: text(source["domain"], "admin domain", 253),
      state: literal(source["state"], DOMAIN_STATES, "admin domain state"),
      verified_at: nullableText(source["verified_at"], "admin domain timestamp", 64),
      created_at: text(source["created_at"], "admin domain timestamp", 64),
      updated_at: text(source["updated_at"], "admin domain timestamp", 64),
      workspace_name: text(source["workspace_name"], "admin domain workspace name", 80),
    };
  });
}

function auditEvent(item: unknown): AuditEvent {
  const source = record(item, "audit event");
  const metadata = source["metadata"];
  if (metadata !== null && typeof metadata !== "string" && (typeof metadata !== "object" || Array.isArray(metadata))) invalid("audit metadata");
  return {
    id: integer(source["id"], "audit event", 1),
    user_id: nullableInteger(source["user_id"], "audit actor", 1),
    action: text(source["action"], "audit action", 255),
    resource_type: nullableText(source["resource_type"], "audit resource type", 100),
    resource_id: nullableText(source["resource_id"], "audit resource id", 255),
    metadata: metadata as string | Record<string, unknown> | null,
    ip_hash: nullableText(source["ip_hash"], "audit IP hash", 255),
    created_at: text(source["created_at"], "audit timestamp", 64),
  };
}

export function decodeAdminAuditPage(value: unknown, expected: AdminPageContext): AdminPageResponse<AuditEvent> {
  return page(value, "events", expected, auditEvent);
}

export function decodeAdminOperations(value: unknown): AdminOperations {
  const source = record(value, "admin operations");
  const metrics = record(source["metrics"], "admin operations metrics");
  const nullableAge = (field: string): number | null => nullableInteger(metrics[field], "admin operations age");
  return {
    state: literal(source["state"], new Set(["healthy", "attention", "critical"]), "admin operations state"),
    environment: text(source["environment"], "admin operations environment", 100),
    generatedAt: text(source["generatedAt"], "admin operations timestamp", 64),
    checks: boundedArray(source["checks"], "admin operation checks", 32).map((item) => {
      const check = record(item, "admin operation check");
      return {
        key: text(check["key"], "admin operation check", 100),
        label: text(check["label"], "admin operation check", 255),
        status: literal(check["status"], new Set(["ok", "warning", "critical"]), "admin operation check status"),
        detail: nullableText(check["detail"], "admin operation check detail", 1000),
      };
    }),
    metrics: {
      pendingJobs: integer(metrics["pendingJobs"], "admin operations metrics"),
      oldestJobAgeSeconds: nullableAge("oldestJobAgeSeconds"),
      failedJobs: integer(metrics["failedJobs"], "admin operations metrics"),
      webhookDeliveries: countRecord(metrics["webhookDeliveries"], "webhook delivery metrics"),
      oldestPendingWebhookAgeSeconds: nullableAge("oldestPendingWebhookAgeSeconds"),
      mailOutbox: countRecord(metrics["mailOutbox"], "mail outbox metrics"),
      oldestPendingMailAgeSeconds: nullableAge("oldestPendingMailAgeSeconds"),
      activeSessions: integer(metrics["activeSessions"], "admin operations metrics"),
      unverifiedUsers: integer(metrics["unverifiedUsers"], "admin operations metrics"),
      domains: countRecord(metrics["domains"], "domain metrics"),
      oldestDnsCheckAgeSeconds: nullableAge("oldestDnsCheckAgeSeconds"),
      oldestTlsProvisioningAgeSeconds: nullableAge("oldestTlsProvisioningAgeSeconds"),
      events60m: countRecord(metrics["events60m"], "operational event metrics"),
      queueHeartbeatAgeSeconds: nullableAge("queueHeartbeatAgeSeconds"),
      schedulerHeartbeatAgeSeconds: nullableAge("schedulerHeartbeatAgeSeconds"),
      activePrivacyRequests: integer(metrics["activePrivacyRequests"], "admin operations metrics"),
      overduePrivacyRequests: integer(metrics["overduePrivacyRequests"], "admin operations metrics"),
    },
  };
}

export function decodeAdminMailPage(value: unknown, expected: AdminPageContext): AdminPageResponse<AdminMailOutboxMessage> {
  return page(value, "messages", expected, (item) => {
    const source = record(item, "admin mail message");
    return {
      id: integer(source["id"], "admin mail message", 1),
      kind: text(source["kind"], "admin mail kind", 255),
      resourceType: nullableText(source["resourceType"], "admin mail resource type", 100),
      status: literal(source["status"], MAIL_STATUSES, "admin mail status"),
      attempts: integer(source["attempts"], "admin mail attempts"),
      manualRetryCount: integer(source["manualRetryCount"], "admin mail manual retries", 0, 3),
      retryable: boolean(source["retryable"], "admin mail retryable flag"),
      availableAt: text(source["availableAt"], "admin mail timestamp", 64),
      queuedAt: nullableText(source["queuedAt"], "admin mail timestamp", 64),
      lockedAt: nullableText(source["lockedAt"], "admin mail timestamp", 64),
      sentAt: nullableText(source["sentAt"], "admin mail timestamp", 64),
      failedAt: nullableText(source["failedAt"], "admin mail timestamp", 64),
      lastManualRetryAt: nullableText(source["lastManualRetryAt"], "admin mail timestamp", 64),
      lastError: nullableText(source["lastError"], "admin mail error", 2048, true),
      createdAt: text(source["createdAt"], "admin mail timestamp", 64),
      updatedAt: text(source["updatedAt"], "admin mail timestamp", 64),
    };
  });
}
