import type { Workspace, WorkspaceDetail } from "../models";
import { decodeCreatedWorkspaceResponse, decodeWorkspaceDetail, decodeWorkspaceGettingStarted } from "./workspace-response-decoders";

const detail: WorkspaceDetail = {
  workspace: { id: 2, name: "Main", slug: "main", role: "admin", createdAt: "2026-09-06T10:00:00Z" },
  members: [{ id: 7, email: "member@example.test", name: "Member", role: "editor", joined_at: "2026-09-06T10:00:00Z" }],
  membersPage: { page: 1, perPage: 25, total: 1 },
  invitations: [{
    id: 8,
    email: "invited@example.test",
    role: "viewer",
    status: "pending",
    expires_at: "2026-09-13T10:00:00Z",
    created_at: "2026-09-06T10:00:00Z",
  }],
  invitationsPage: { page: 1, perPage: 25, total: 1 },
};

describe("workspace response decoders", () => {
  it("accepts a complete detail snapshot", () => {
    expect(decodeWorkspaceDetail(detail)).toEqual(detail);
  });

  it("rejects an unknown member role before publishing any team state", () => {
    expect(() => decodeWorkspaceDetail({
      ...detail,
      members: [{ ...detail.members[0], role: "super-admin" }],
    })).toThrow();
  });

  it("rejects inconsistent or unbounded page metadata", () => {
    expect(() => decodeWorkspaceDetail({ ...detail, membersPage: { page: 0, perPage: 25, total: 1 } })).toThrow();
    expect(() => decodeWorkspaceDetail({ ...detail, membersPage: { page: 1, perPage: 0, total: 1 } })).toThrow();
    expect(() => decodeWorkspaceDetail({ ...detail, membersPage: { page: 1, perPage: 1, total: 2 }, members: [detail.members[0], detail.members[0]] })).toThrow();
  });

  it("binds tenant and pagination metadata to the originating request", () => {
    const context = { workspaceId: 2, memberPage: 1, memberPerPage: 25, invitationPage: 1, invitationPerPage: 25 };
    expect(decodeWorkspaceDetail(detail, context)).toEqual(detail);
    expect(() => decodeWorkspaceDetail({ ...detail, workspace: { ...detail.workspace, id: 9 } }, context)).toThrow();
    expect(() => decodeWorkspaceDetail({ ...detail, membersPage: { ...detail.membersPage, page: 2 } }, context)).toThrow();
  });

  it("requires owner authority in a workspace-creation response", () => {
    const created = { id: 3, name: "Created", slug: "created", role: "owner", createdAt: "2026-09-06T10:00:00Z" } satisfies Workspace;
    expect(decodeCreatedWorkspaceResponse({ workspace: created })).toEqual({ workspace: created });
    expect(() => decodeCreatedWorkspaceResponse({ workspace: { ...created, role: "viewer" } })).toThrow();
  });

  it("decodes onboarding facts and binds them to the requested workspace", () => {
    const onboarding = {
      workspaceId: 2,
      role: "admin",
      facts: { linkPresent: true, redirectObserved: false, domainPresent: true, teammatePresent: false, invitationPending: null, mfaEnabled: true },
      capabilities: { createLink: true, addDomain: true, inviteTeam: true },
    } as const;
    expect(decodeWorkspaceGettingStarted(onboarding, 2)).toEqual(onboarding);
    expect(() => decodeWorkspaceGettingStarted(onboarding, 3)).toThrow();
    expect(() => decodeWorkspaceGettingStarted({ ...onboarding, capabilities: { ...onboarding.capabilities, inviteTeam: "yes" } }, 2)).toThrow();
  });
});
