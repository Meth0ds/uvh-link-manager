import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { Router } from "@angular/router";
import { MatSnackBar } from "@angular/material/snack-bar";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { Invitation, MemberSearchHit, WorkspaceDetail } from "../../core/models";
import { ActionDialogService } from "../action-dialog.service";
import { TeamComponent } from "./team.component";

describe("TeamComponent invitation retry guards", () => {
  let fixture: ComponentFixture<TeamComponent>;
  let component: TeamComponent;
  let api: jasmine.SpyObj<ApiService>;
  const invitation: Invitation = {
    id: 7, email: "person@example.test", role: "editor", status: "pending",
    created_at: "2026-09-05T12:00:00Z", expires_at: "2026-09-12T12:00:00Z",
  };
  const detail: WorkspaceDetail = {
    workspace: { id: 1, name: "Team", slug: "team", role: "owner", createdAt: "2026-09-05T12:00:00Z" },
    members: [], membersPage: { page: 1, perPage: 25, total: 0 },
    invitations: [invitation], invitationsPage: { page: 1, perPage: 25, total: 1 },
  };

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "delete"]);
    api.get.and.resolveTo(detail);
    api.delete.and.resolveTo({ ok: true });
    await TestBed.configureTestingModule({
      imports: [TeamComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj("MatSnackBar", ["open"]) },
        { provide: Router, useValue: jasmine.createSpyObj("Router", ["navigate"]) },
        { provide: AuthService, useValue: { user: signal(null) } },
        { provide: WorkspaceService, useValue: { currentId: signal(1) } },
        { provide: ActionDialogService, useValue: {} },
      ],
    })
      // These are handler contracts, not visual/E2E evidence for Material UI.
      .overrideComponent(TeamComponent, { set: { template: "", imports: [] } })
      .compileComponents();
    fixture = TestBed.createComponent(TeamComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it("blocks repeated resend and Enter/create for the same recipient, but permits cancellation", async () => {
    api.post.and.rejectWith(new ApiRequestError("Espera", 429, undefined, 60));
    await component.resendInvite(invitation);
    await component.resendInvite(invitation);
    component.inviteEmail.set(" PERSON@example.test ");
    await component.invite();
    expect(api.post).toHaveBeenCalledTimes(1);
    await component.cancelInvite(invitation);
    expect(api.delete).toHaveBeenCalledWith("/api/v1/workspaces/1/invitations/7");
  });

  it("attaches a delayed error to the submitted email, not the edited form", async () => {
    let reject!: (reason: unknown) => void;
    api.post.and.returnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    component.inviteEmail.set("person@example.test");
    const request = component.invite();
    component.inviteEmail.set("other@example.test");
    reject(new ApiRequestError("Espera", 429, undefined, 60));
    await request;
    expect(component.invitationRetry.remaining(1, "person@example.test")).toBeGreaterThan(0);
    expect(component.invitationRetry.remaining(1, "other@example.test")).toBe(0);
    expect(component.inviteEmail()).toBe("other@example.test");
  });

  it("does not create a local lock without valid server advice or for a generic 503", async () => {
    for (const error of [new ApiRequestError("Espera", 429), new ApiRequestError("No disponible", 503, undefined, 60)]) {
      api.post.and.rejectWith(error);
      await component.resendInvite(invitation);
      expect(component.invitationRetry.remaining(1, invitation.email)).toBe(0);
    }
    expect(api.post).toHaveBeenCalledTimes(2);
  });
});

describe("TeamComponent ownership transfer picker", () => {
  let fixture: ComponentFixture<TeamComponent>;
  let component: TeamComponent;
  let api: jasmine.SpyObj<ApiService>;
  let actions: jasmine.SpyObj<ActionDialogService>;

  const ownerHit: MemberSearchHit = { id: 1, email: "owner@example.test", name: "Owner", role: "owner" };
  const candidate: MemberSearchHit = { id: 11, email: "ana@example.test", name: "Ana", role: "editor" };
  const searchResult = { members: [ownerHit, candidate], total: 2 };
  const detail: WorkspaceDetail = {
    workspace: { id: 1, name: "Team", slug: "team", role: "owner", createdAt: "2026-09-05T12:00:00Z" },
    members: [], membersPage: { page: 1, perPage: 25, total: 0 },
    invitations: [], invitationsPage: { page: 1, perPage: 25, total: 0 },
  };

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "delete"]);
    api.get.and.resolveTo(detail);
    api.post.and.resolveTo({ ok: true });
    actions = jasmine.createSpyObj<ActionDialogService>("ActionDialogService", ["confirm"]);
    actions.confirm.and.resolveTo(true);
    await TestBed.configureTestingModule({
      imports: [TeamComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj("MatSnackBar", ["open"]) },
        { provide: Router, useValue: jasmine.createSpyObj("Router", ["navigate"]) },
        { provide: AuthService, useValue: {
          user: signal(null),
          refreshWorkspaces: () => Promise.resolve(),
          refreshUser: () => Promise.resolve(),
        } },
        { provide: WorkspaceService, useValue: { currentId: signal(1) } },
        { provide: ActionDialogService, useValue: actions },
      ],
    })
      // Handler contracts: the picker's behaviour is asserted through its state.
      .overrideComponent(TeamComponent, { set: { template: "", imports: [] } })
      .compileComponents();
    fixture = TestBed.createComponent(TeamComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    api.get.calls.reset();
    api.get.and.resolveTo(searchResult);
  });

  afterEach(() => fixture.destroy());

  it("searches every member of the workspace, not just the loaded page", async () => {
    component.transferQuery.set("ana");
    await component.searchTransferCandidates();
    expect(api.get).toHaveBeenCalledOnceWith(
      "/api/v1/workspaces/1/members", { q: "ana", perPage: 10 },
      jasmine.any(Function), jasmine.objectContaining({ signal: jasmine.any(AbortSignal) }));
    expect(component.transferResults()).toEqual([candidate]);
    expect(component.transferTotal()).toBe(2);
  });

  it("lists a first window of candidates when the picker opens", async () => {
    component.beginOwnershipTransfer();
    expect(component.transferSearching()).toBeTrue();
    await fixture.whenStable();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(component.transferResults()).toEqual([candidate]);
  });

  it("drops a stale search that resolves after a newer one", async () => {
    const stale: MemberSearchHit = { id: 12, email: "stale@example.test", name: "Stale", role: "viewer" };
    let finishStale!: (value: typeof searchResult) => void;
    api.get.and.returnValue(new Promise<typeof searchResult>((resolve) => { finishStale = resolve; }));
    component.transferQuery.set("pri");
    const first = component.searchTransferCandidates();
    api.get.and.resolveTo({ members: [candidate], total: 1 });
    component.transferQuery.set("seg");
    await component.searchTransferCandidates();
    finishStale({ members: [stale], total: 1 });
    await first;
    expect(component.transferResults()).toEqual([candidate]);
    expect(component.transferSearching()).toBeFalse();
    expect(component.transferTarget()).toBeNull();
  });

  it("debounces typing into a single lookup", async () => {
    component.onTransferQuery("a");
    component.onTransferQuery("an");
    component.onTransferQuery("ana");
    expect(api.get).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get.calls.mostRecent().args[1]).toEqual({ q: "ana", perPage: 10 });
    expect(component.transferResults()).toEqual([candidate]);
  });

  it("never offers the current owner as a recipient", async () => {
    component.transferQuery.set("own");
    await component.searchTransferCandidates();
    expect(component.transferResults()).not.toContain(ownerHit);
    component.transferTarget.set(ownerHit);
    component.transferPassword.set("correct horse");
    await component.transferOwnership();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("transfers to the searched recipient, not to a row of the loaded page", async () => {
    // The recipient is a search hit; the loaded page does not even list them.
    api.get.and.resolveTo(detail);
    component.transferOpen.set(true);
    component.transferTarget.set(candidate);
    component.transferPassword.set("correct horse");
    await component.transferOwnership();
    expect(actions.confirm).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledOnceWith(
      "/api/v1/workspaces/1/transfer-ownership",
      { targetUserId: 11, password: "correct horse" });
  });
});
