import type { Invitation, Member, Workspace, WorkspaceDetail, WorkspaceGettingStarted, WorkspaceRole } from "../models";
import { boolean } from "./response-decoder-helpers";

type JsonRecord = Record<string, unknown>;

const ROLES = new Set<WorkspaceRole>(["owner", "admin", "editor", "viewer"]);
const INVITATION_STATUSES = new Set<Invitation["status"]>(["pending", "accepted", "rejected", "cancelled", "expired"]);

export interface WorkspaceDetailContext {
  workspaceId: number;
  memberPage: number;
  memberPerPage: number;
  invitationPage: number;
  invitationPerPage: number;
}

function invalid(contract: string): never {
  throw new Error(`Invalid ${contract} response`);
}

function record(value: unknown, contract: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(contract);
  return value as JsonRecord;
}

function integer(value: unknown, contract: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid(contract);
  return value as number;
}

function text(value: unknown, contract: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum
    || /[\u0000-\u001f\u007f]/.test(value)) {
    invalid(contract);
  }
  return value;
}

function role(value: unknown, contract: string): WorkspaceRole {
  if (typeof value !== "string" || !ROLES.has(value as WorkspaceRole)) invalid(contract);
  return value as WorkspaceRole;
}

function workspace(value: unknown, requiredRole?: WorkspaceRole): Workspace {
  const source = record(value, "workspace");
  const decodedRole = role(source["role"], "workspace");
  if (requiredRole !== undefined && decodedRole !== requiredRole) invalid("workspace");
  return {
    id: integer(source["id"], "workspace", 1),
    name: text(source["name"], "workspace", 80),
    slug: text(source["slug"], "workspace", 255),
    role: decodedRole,
    createdAt: text(source["createdAt"], "workspace", 64),
  };
}

function member(value: unknown): Member {
  const source = record(value, "workspace member");
  return {
    id: integer(source["id"], "workspace member", 1),
    email: text(source["email"], "workspace member", 320),
    name: text(source["name"], "workspace member", 255),
    role: role(source["role"], "workspace member"),
    joined_at: text(source["joined_at"], "workspace member", 64),
  };
}

function invitation(value: unknown): Invitation {
  const source = record(value, "workspace invitation");
  const status = source["status"];
  if (typeof status !== "string" || !INVITATION_STATUSES.has(status as Invitation["status"])) {
    invalid("workspace invitation");
  }
  return {
    id: integer(source["id"], "workspace invitation", 1),
    email: text(source["email"], "workspace invitation", 320),
    role: role(source["role"], "workspace invitation"),
    status: status as Invitation["status"],
    expires_at: text(source["expires_at"], "workspace invitation", 64),
    created_at: text(source["created_at"], "workspace invitation", 64),
  };
}

function page(value: unknown, contract: string): WorkspaceDetail["membersPage"] {
  const source = record(value, contract);
  return {
    page: integer(source["page"], contract, 1, 10_000),
    perPage: integer(source["perPage"], contract, 1, 100),
    total: integer(source["total"], contract),
  };
}

/** A newly created workspace always grants ownership to the creating account. */
export function decodeCreatedWorkspaceResponse(value: unknown): { workspace: Workspace } {
  const source = record(value, "created workspace");
  return { workspace: workspace(source["workspace"], "owner") };
}

/**
 * Decode members, invitations and both page descriptors before publishing any
 * role-derived UI. A malformed row rejects the complete tenant snapshot.
 */
export function decodeWorkspaceDetail(value: unknown, expected?: WorkspaceDetailContext): WorkspaceDetail {
  const source = record(value, "workspace detail");
  const membersPage = page(source["membersPage"], "workspace members page");
  const invitationsPage = page(source["invitationsPage"], "workspace invitations page");
  if (!Array.isArray(source["members"]) || source["members"].length > membersPage.perPage
    || source["members"].length > membersPage.total
    || !Array.isArray(source["invitations"]) || source["invitations"].length > invitationsPage.perPage
    || source["invitations"].length > invitationsPage.total) {
    invalid("workspace detail");
  }
  const decodedWorkspace = workspace(source["workspace"]);
  if (expected && (decodedWorkspace.id !== expected.workspaceId
    || membersPage.page !== expected.memberPage || membersPage.perPage !== expected.memberPerPage
    || invitationsPage.page !== expected.invitationPage || invitationsPage.perPage !== expected.invitationPerPage)) {
    invalid("workspace detail context");
  }
  return {
    workspace: decodedWorkspace,
    members: source["members"].map(member),
    membersPage,
    invitations: source["invitations"].map(invitation),
    invitationsPage,
  };
}

/**
 * The guide drives role-sensitive calls to action, so every fact and capability
 * is decoded before the snapshot is allowed to influence the interface.
 */
export function decodeWorkspaceGettingStarted(value: unknown, expectedWorkspaceId: number): WorkspaceGettingStarted {
  const source = record(value, "workspace getting started");
  const facts = record(source["facts"], "workspace getting started facts");
  const capabilities = record(source["capabilities"], "workspace getting started capabilities");
  const workspaceId = integer(source["workspaceId"], "workspace getting started", 1);
  if (workspaceId !== expectedWorkspaceId) invalid("workspace getting started context");

  const invitationPending = facts["invitationPending"];
  if (invitationPending !== null && typeof invitationPending !== "boolean") {
    invalid("workspace getting started facts");
  }

  return {
    workspaceId,
    role: role(source["role"], "workspace getting started"),
    facts: {
      linkPresent: boolean(facts["linkPresent"], "workspace getting started facts"),
      redirectObserved: boolean(facts["redirectObserved"], "workspace getting started facts"),
      domainPresent: boolean(facts["domainPresent"], "workspace getting started facts"),
      teammatePresent: boolean(facts["teammatePresent"], "workspace getting started facts"),
      invitationPending: invitationPending as boolean | null,
      mfaEnabled: boolean(facts["mfaEnabled"], "workspace getting started facts"),
    },
    capabilities: {
      createLink: boolean(capabilities["createLink"], "workspace getting started capabilities"),
      addDomain: boolean(capabilities["addDomain"], "workspace getting started capabilities"),
      inviteTeam: boolean(capabilities["inviteTeam"], "workspace getting started capabilities"),
    },
  };
}
