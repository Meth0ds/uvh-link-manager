import type { WorkspaceRole, WorkspaceUsage, WorkspaceUsagePolicy, WorkspaceUsageQuota } from "../../core/models";
import { boolean, integer, literal, nullableInteger, record, text } from "../../core/services/response-decoder-helpers";

const ROLES = new Set<WorkspaceRole>(["owner", "admin", "editor", "viewer"]);
const POLICIES = new Set<WorkspaceUsagePolicy>(["enforced", "not_configured", "unavailable"]);

function invalid(): never {
  throw new Error("Invalid workspace usage response");
}

function timestamp(value: unknown): string {
  const decoded = text(value, "workspace usage timestamp", 64);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(decoded);
  if (!match || !Number.isFinite(Date.parse(decoded))) invalid();
  const parts = match.slice(1).map(Number);
  const calendar = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
  // Date.parse normalizes impossible dates such as 30 February. Compare the
  // written calendar components before accepting the value for DatePipe.
  if (calendar.getUTCFullYear() !== parts[0] || calendar.getUTCMonth() !== parts[1] - 1
    || calendar.getUTCDate() !== parts[2] || calendar.getUTCHours() !== parts[3]
    || calendar.getUTCMinutes() !== parts[4] || calendar.getUTCSeconds() !== parts[5]) invalid();
  return decoded;
}

function quota(value: unknown, expectedPolicy?: WorkspaceUsagePolicy): WorkspaceUsageQuota {
  const source = record(value, "workspace usage quota");
  const used = integer(source["used"], "workspace usage quota");
  const limit = nullableInteger(source["limit"], "workspace usage quota");
  const remaining = nullableInteger(source["remaining"], "workspace usage quota");
  const policy = literal(source["policy"], POLICIES, "workspace usage quota");
  const reached = source["reached"] === null ? null : boolean(source["reached"], "workspace usage quota");
  const canManage = boolean(source["canManage"], "workspace usage quota");
  if (expectedPolicy !== undefined && policy !== expectedPolicy) invalid();

  // Validate redundant fields rather than trusting whichever value is most
  // convenient to render. A malformed snapshot is rejected atomically.
  if (policy === "enforced") {
    if (limit === null || remaining !== Math.max(0, limit - used) || reached !== (used >= limit)) invalid();
  } else if (limit !== null || remaining !== null || reached !== null) invalid();

  return { used, limit, remaining, policy, reached, canManage };
}

/** Decode and bind every role-sensitive aggregate to the selected workspace. */
export function decodeWorkspaceUsage(value: unknown, workspaceId: number, expectedRole: WorkspaceRole): WorkspaceUsage {
  const source = record(value, "workspace usage");
  const decodedWorkspaceId = integer(source["workspaceId"], "workspace usage", 1);
  const role = literal(source["role"], ROLES, "workspace usage");
  if (decodedWorkspaceId !== workspaceId || role !== expectedRole) invalid();
  const resources = record(source["resources"], "workspace usage resources");
  const analytics = record(source["analytics"], "workspace usage analytics");

  const links = quota(resources["links"]);
  if (links.policy !== "enforced" && links.policy !== "unavailable") invalid();
  const domains = quota(resources["domains"], "enforced");
  const members = quota(resources["members"], "not_configured");
  const webhooks = quota(resources["webhooks"], "enforced");
  const tokens = resources["tokens"] === null ? null : quota(resources["tokens"], "enforced");
  const invitations = resources["invitations"] === null ? null : quota(resources["invitations"], "enforced");
  const editor = role === "owner" || role === "admin" || role === "editor";
  const admin = role === "owner" || role === "admin";

  // These visibility and capability invariants mirror backend authorization.
  // A role mismatch must clear the whole page, not leak a partial snapshot.
  if ((tokens !== null) !== editor || (invitations !== null) !== admin
    || links.canManage !== editor || domains.canManage !== editor || webhooks.canManage !== editor
    || members.canManage !== admin || tokens?.canManage === false || invitations?.canManage === false) invalid();

  return {
    workspaceId: decodedWorkspaceId,
    role,
    measuredAt: timestamp(source["measuredAt"]),
    resources: { links, domains, members, tokens, webhooks, invitations },
    analytics: {
      retentionDays: integer(analytics["retentionDays"], "workspace usage analytics", 1, 36_500),
      maximumQueryRangeDays: integer(analytics["maximumQueryRangeDays"], "workspace usage analytics", 1, 36_500),
      basis: literal(analytics["basis"], new Set(["configured_policy"] as const), "workspace usage analytics"),
      purgeVerified: boolean(analytics["purgeVerified"], "workspace usage analytics"),
    },
    basis: literal(source["basis"], new Set(["snapshot_not_reservation"] as const), "workspace usage"),
  };
}
