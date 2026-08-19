// ---------- TypeScript DTOs matching the UVH backend API ----------

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  isAdmin: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
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
  | "active"
  | "error"
  | "disabled";

export interface DomainDto {
  id: number;
  domain: string;
  state: DomainState;
  verificationToken: string;
  verifiedAt: string | null;
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
  payload: string;
  status: "pending" | "success" | "failed";
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
  invitations: Invitation[];
}

export interface Session {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  revoked_at: string | null;
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

export interface AuditEvent {
  id: number;
  user_id: number | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: string | null;
  ip_hash: string | null;
  created_at: string;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
