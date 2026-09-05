// ---------- TypeScript DTOs matching the UVH backend API ----------

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  isAdmin: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
  recoveryCodesRemaining?: number;
  pendingEmail?: string | null;
  pendingEmailExpiresAt?: string | null;
}

export interface DataExportStatus {
  id: number;
  status: "requested" | "processing" | "ready" | "downloaded" | "failed" | "cancelled" | "expired";
  confirmationExpiresAt: string | null;
  downloadExpiresAt: string | null;
  createdAt: string | null;
  confirmedAt: string | null;
  readyAt: string | null;
  downloadedAt: string | null;
}

export interface AccountDeletionImpact {
  canDelete: boolean;
  isPlatformAdmin: boolean;
  ownedWorkspaces: Array<{ id: number; name: string; slug: string }>;
  blockingPrivacyRequests: Array<{ id: number; type: PrivacyRightType; status: PrivacyRightStatus; due_at: string }>;
  request: { status: "requested"; confirmationExpiresAt: string } | null;
}

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

export interface Workspace {
  id: number;
  name: string;
  slug: string;
  role: WorkspaceRole | null;
  createdAt: string;
}

export type LinkState =
  | "scheduled"
  | "active"
  | "paused"
  | "expired"
  | "blocked"
  | "archived"
  | "deleted";

export interface LinkUtm {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
}

export interface LinkDto {
  id: number;
  alias: string;
  destination: string;
  fallbackDestination: string | null;
  state: LinkState;
  clickCount: number;
  maxClicks: number | null;
  singleUse: boolean;
  usedAt: string | null;
  scheduledAt: string | null;
  expiresAt: string | null;
  notes: string | null;
  passwordProtected: boolean;
  utm: LinkUtm;
  domainId: number | null;
  domain: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** Monotonic optimistic-lock token required for an edit. */
  version: number;
  shortUrl: string;
}

export interface RedirectRule {
  id?: number;
  priority?: number;
  country?: string | null;
  language?: string | null;
  device?: "desktop" | "mobile" | "tablet" | null;
  os?: string | null;
  timeFrom?: string | null;
  timeTo?: string | null;
  referrer?: string | null;
  campaign?: string | null;
  destination: string;
}

export interface LinksResponse {
  links: LinkDto[];
  total: number;
  page: number;
  perPage: number;
}

export interface LinkDetailResponse {
  link: LinkDto;
  rules: RedirectRule[];
}

export type DomainState =
  | "pending"
  | "verifying"
  | "verified"
  | "provisioning"
  | "active"
  | "error"
  | "disabled";

export interface DomainDto {
  id: number;
  domain: string;
  state: DomainState;
  verificationHost: string;
  verificationToken: string | null;
  cnameTarget: string | null;
  verifiedAt: string | null;
  ownershipVerifiedAt: string | null;
  routingVerifiedAt: string | null;
  dnsCheckStartedAt: string | null;
  dnsCheckCompletedAt: string | null;
  dnsError: string | null;
  edgeEligible: boolean;
  tlsReadyAt: string | null;
  tlsError: string | null;
  createdAt: string;
}

export interface ApiTokenDto {
  id: number;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface WebhookDto {
  id: number;
  url: string;
  events: string[];
  active: boolean;
  hasSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: number;
  webhook_id: number;
  event: string;
  event_id: string;
  status: "pending" | "processing" | "success" | "failed";
  attempts: number;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
}

export interface AnalyticsOverview {
  totals: { clicks: number; visitors: number };
  series: Array<{ day: string; clicks: number; visitors: number }>;
  topLinks: Array<{ id: number; alias: string; destination: string; clicks: number; visitors: number }>;
  countries: Array<{ key: string; value: number }>;
  devices: Array<{ key: string; value: number }>;
  browsers: Array<{ key: string; value: number }>;
  os: Array<{ key: string; value: number }>;
  referrers: Array<{ key: string; value: number }>;
  campaigns: Array<{ key: string; value: number }>;
}

export interface Member {
  id: number;
  email: string;
  name: string;
  role: WorkspaceRole;
  joined_at: string;
}

export interface Invitation {
  id: number;
  email: string;
  role: WorkspaceRole;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "expired";
  expires_at: string;
  created_at: string;
}

export interface WorkspaceDetail {
  workspace: Workspace;
  members: Member[];
  membersPage: { page: number; perPage: number; total: number };
  invitations: Invitation[];
  invitationsPage: { page: number; perPage: number; total: number };
}

/** Server-derived onboarding facts, not a persisted completion checklist. */
export interface WorkspaceGettingStarted {
  workspaceId: number;
  role: WorkspaceRole;
  facts: {
    linkPresent: boolean;
    /** UVH admitted a redirect; browser arrival at the destination is not proven. */
    redirectObserved: boolean;
    /** A domain record exists; this does not certify DNS/TLS readiness. */
    domainPresent: boolean;
    teammatePresent: boolean;
    /** Hidden from roles below admin, not equivalent to an empty invitation list. */
    invitationPending: boolean | null;
    mfaEnabled: boolean;
  };
  capabilities: { createLink: boolean; addDomain: boolean; inviteTeam: boolean };
}

export interface Session {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  revoked_at: string | null;
  /** Present only after this exact browser session passed MFA. */
  mfa_verified_at: string | null;
  current: boolean;
}

export interface AdminOverview {
  users: number;
  workspaces: number;
  links: number;
  clicks: number;
  openReports: number;
  blockedLinks: number;
  domains: number;
}

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  is_admin: boolean | number;
  email_verified_at: string | null;
  mfa_enabled: boolean | number;
  created_at: string;
  deleted_at: string | null;
  workspaces: number;
  links: number;
}

export interface AdminReport {
  id: number;
  link_id: number;
  reporter_email: string | null;
  reason: string;
  details: string | null;
  status: "open" | "reviewed" | "actioned" | "dismissed";
  created_at: string;
  alias: string;
  destination: string;
  link_state: string;
  workspace_id: number;
}

export type AccountRecoveryStatus = "requested" | "email_confirmed" | "in_review" | "approved" | "rejected" | "completed" | "expired" | "cancelled";

export interface AdminAccountRecovery {
  id: number;
  userId: number;
  name: string;
  email: string;
  status: AccountRecoveryStatus;
  approvalCount: number;
  targetIsAdmin: boolean;
  mfaEnabled: boolean;
  emailConfirmedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminDomain {
  id: number;
  workspace_id: number;
  domain: string;
  state: DomainState;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  workspace_name: string;
}

export interface AdminPage<T> {
  total: number;
  page: number;
  perPage: number;
  users?: T[];
  reports?: T[];
  recoveries?: T[];
  domains?: T[];
  events?: T[];
}

export interface AdminOperationCheck {
  key: string;
  label: string;
  status: "ok" | "warning" | "critical";
  detail: string | null;
}

export interface AdminOperations {
  state: "healthy" | "attention" | "critical";
  environment: string;
  generatedAt: string;
  checks: AdminOperationCheck[];
  metrics: {
    pendingJobs: number;
    oldestJobAgeSeconds: number | null;
    failedJobs: number;
    webhookDeliveries: Record<string, number>;
    oldestPendingWebhookAgeSeconds: number | null;
    mailOutbox: Record<string, number>;
    oldestPendingMailAgeSeconds: number | null;
    activeSessions: number;
    unverifiedUsers: number;
    domains: Record<string, number>;
    oldestDnsCheckAgeSeconds: number | null;
    oldestTlsProvisioningAgeSeconds: number | null;
    /** Bounded-cardinality counters; keys never contain routes or actor IDs. */
    events60m: Record<string, number>;
    queueHeartbeatAgeSeconds: number | null;
    schedulerHeartbeatAgeSeconds: number | null;
    activePrivacyRequests: number;
    overduePrivacyRequests: number;
  };
}

export type MailOutboxStatus = "pending" | "queued" | "processing" | "sent" | "failed" | "obsolete" | "comp_pending" | "compensating" | "compensated";

export interface AdminMailOutboxMessage {
  id: number;
  kind: string;
  resourceType: string | null;
  status: MailOutboxStatus;
  attempts: number;
  manualRetryCount: number;
  retryable: boolean;
  availableAt: string;
  queuedAt: string | null;
  lockedAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  lastManualRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PrivacyRightType = "access" | "rectification" | "erasure" | "objection" | "restriction" | "portability";
export type PrivacyRightStatus = "submitted" | "in_progress" | "waiting_user" | "completed" | "rejected" | "cancelled";

export interface PrivacyRightMessage {
  id: number;
  authorRole: "user" | "admin" | "system";
  body: string | null;
  createdAt: string;
}

export interface PrivacyRightRequest {
  id: number;
  type: PrivacyRightType;
  status: PrivacyRightStatus;
  identityVerifiedAt: string | null;
  acknowledgedAt: string | null;
  dueAt: string;
  extendedUntil: string | null;
  extensionReasonCode: "complexity" | "request_volume" | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  overdue: boolean;
  messages: PrivacyRightMessage[];
  userId?: number | null;
  name?: string;
  email?: string | null;
  assignedAdminName?: string | null;
}

/** Public, minimized projection; deliberately separate from internal AuditEvent. */
export interface WorkspaceActivityEvent {
  id: string;
  action: string;
  label: string;
  outcome: "completed" | "pending" | "failed" | "unknown";
  actor: { id: string | null; label: string };
  resource: { type: "link" | "domain" | "api_token" | "webhook" | "workspace"; id: string | null };
  createdAt: string;
}

export interface WorkspaceActivityPage {
  workspaceId: number;
  events: WorkspaceActivityEvent[];
  /** Opaque transport value: never decode, display, log or persist it. */
  nextCursor: string | null;
  coverage: "attributed_events_only";
}

export interface AuditEvent {
  id: number;
  user_id: number | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: string | Record<string, unknown> | null;
  ip_hash: string | null;
  created_at: string;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
