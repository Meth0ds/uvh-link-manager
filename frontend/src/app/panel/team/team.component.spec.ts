import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { Router } from "@angular/router";
import { MatSnackBar } from "@angular/material/snack-bar";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { Invitation, WorkspaceDetail } from "../../core/models";
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
