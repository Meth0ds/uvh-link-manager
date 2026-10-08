import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { Router } from "@angular/router";
import { MatSnackBar } from "@angular/material/snack-bar";
import { MatSelect, MatSelectChange } from "@angular/material/select";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { Invitation, Member, WorkspaceDetail, WorkspaceRole } from "../../core/models";
import { ActionDialogService } from "../action-dialog.service";
import { TeamComponent } from "./team.component";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const member: Member = { id: 11, name: "Ana", email: "ana@example.test", role: "editor", joined_at: "2026-10-01T12:00:00Z" };
const invitation: Invitation = { id: 7, email: "person@example.test", role: "editor", status: "pending", created_at: "2026-10-01T12:00:00Z", expires_at: "2026-10-12T12:00:00Z" };
const snapshot = (id = 1, role: WorkspaceRole = "owner"): WorkspaceDetail => ({
  workspace: { id, name: "Equipo " + id, slug: "equipo-" + id, role, createdAt: "2026-10-01T12:00:00Z" },
  members: [member, { ...member, id: 12, name: "Luis", email: "luis@example.test", role: "admin" }],
  membersPage: { page: 1, perPage: 25, total: 2 }, invitations: [invitation, { ...invitation, id: 8, role: "admin" }],
  invitationsPage: { page: 1, perPage: 25, total: 2 },
});

describe("Team actual UI and asynchronous context", () => {
  let fixture: ComponentFixture<TeamComponent>;
  let component: TeamComponent;
  let api: jasmine.SpyObj<ApiService>;
  let snack: jasmine.SpyObj<MatSnackBar>;
  let actions: jasmine.SpyObj<ActionDialogService>;
  let refreshWorkspaces: jasmine.Spy;
  let generation: number;
  let selected: ReturnType<typeof signal<number | null>>;
  let role: ReturnType<typeof signal<WorkspaceRole>>;
  let revision: number;
  const switchTo = async (id: number) => {
    revision++; selected.set(id); fixture.detectChanges(); await fixture.whenStable();
  };
  beforeEach(async () => {
    generation = 0; revision = 0; selected = signal<number | null>(1); role = signal<WorkspaceRole>("owner");
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "patch", "delete"]);
    api.get.and.callFake(async <T>() => snapshot(selected() ?? 1, role()) as T);
    api.post.and.resolveTo({ ok: true }); api.patch.and.resolveTo({ ok: true }); api.delete.and.resolveTo({ ok: true });
    snack = jasmine.createSpyObj<MatSnackBar>("snack", ["open"]);
    actions = jasmine.createSpyObj<ActionDialogService>("actions", ["confirm"]); actions.confirm.and.resolveTo(true);
    refreshWorkspaces = jasmine.createSpy().and.resolveTo();
    await TestBed.configureTestingModule({ imports: [TeamComponent], providers: [
      { provide: ApiService, useValue: api }, { provide: MatSnackBar, useValue: snack },
      { provide: Router, useValue: jasmine.createSpyObj("router", ["navigate"]) },
      { provide: AuthService, useValue: { user: signal(null), sessionGeneration: () => generation, refreshWorkspaces, refreshUser: jasmine.createSpy().and.resolveTo() } },
      { provide: WorkspaceService, useValue: { currentId: selected, currentRole: role, selectionGeneration: () => revision } },
      { provide: ActionDialogService, useValue: actions },
    ] }).overrideProvider(MatSnackBar, { useValue: snack }).compileComponents();
    fixture = TestBed.createComponent(TeamComponent); component = fixture.componentInstance;
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); api.get.calls.reset();
    expect(fixture.debugElement.injector.get(MatSnackBar)).toBe(snack);
  });
  afterEach(() => fixture.destroy());
  it("preserves an email edited while an invitation is being sent", async () => {
    const pending = deferred<unknown>(); api.post.and.returnValue(pending.promise);
    component.inviteEmail.set("first@example.test"); const send = component.invite();
    component.inviteEmail.set("second@example.test"); pending.resolve({ ok: true }); await send;
    expect(component.inviteEmail()).toBe("second@example.test");
  });
  it("preserves an unsaved workspace name when a paged snapshot refreshes", async () => {
    component.renameValue.set("Borrador sin guardar"); await component.load();
    expect(component.renameValue()).toBe("Borrador sin guardar");
  });
  it("allows a new context mutation without letting the old completion release it", async () => {
    const first = deferred<unknown>(), second = deferred<unknown>(); api.post.and.returnValues(first.promise, second.promise);
    component.inviteEmail.set("first@example.test"); const old = component.invite();
    await switchTo(2); expect(component.saving()).toBeFalse();
    component.inviteEmail.set("new@example.test"); const current = component.invite();
    expect(api.post).toHaveBeenCalledTimes(2); expect(component.saving()).toBeTrue();
    first.resolve({ ok: true }); await old;
    expect(component.saving()).toBeTrue(); expect(snack.open).not.toHaveBeenCalled();
    second.resolve({ ok: true }); await current; expect(component.saving()).toBeFalse();
  });
  it("does not publish or refresh another workspace after member removal", async () => {
    const response = deferred<unknown>(); api.delete.and.returnValue(response.promise);
    const removal = component.removeMember(member); await Promise.resolve();
    expect(api.delete).toHaveBeenCalledTimes(1); await switchTo(2); api.get.calls.reset();
    response.resolve({ ok: true }); await removal;
    expect(snack.open).not.toHaveBeenCalled(); expect(api.get).not.toHaveBeenCalled();
  });
  it("does not publish an invitation failure after the view was destroyed", async () => {
    const response = deferred<unknown>(); api.post.and.returnValue(response.promise);
    component.inviteEmail.set("first@example.test"); const send = component.invite(); fixture.destroy();
    response.reject(new ApiRequestError("Error antiguo", 503)); await send;
    expect(snack.open).not.toHaveBeenCalled();
  });
  it("does not refresh a different account's workspace list after rename", async () => {
    const response = deferred<unknown>(); api.patch.and.returnValue(response.promise);
    component.renameValue.set("Nuevo nombre"); const rename = component.rename(); generation++;
    response.resolve({ ok: true }); await rename;
    expect(refreshWorkspaces).not.toHaveBeenCalled(); expect(snack.open).not.toHaveBeenCalled();
  });
  it("drops previous search hits while the new query is debounced", async () => {
    const response = deferred<{ members: Member[]; total: number }>(); api.get.and.returnValue(response.promise);
    component.transferQuery.set("ana"); const first = component.searchTransferCandidates();
    component.onTransferQuery("luis"); response.resolve({ members: [member], total: 1 }); await first;
    expect(component.transferResults()).toBeNull(); expect(component.transferSearching()).toBeTrue();
  });
  it("offers editor and viewer a way to leave without management fields", async () => {
    for (const r of ["editor", "viewer"] as const) {
      role.set(r); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
      const buttons = [...fixture.nativeElement.querySelectorAll("button")] as HTMLButtonElement[];
      expect(buttons.some(b => b.textContent?.trim() === "Abandonar")).withContext(r).toBeTrue();
      expect(fixture.nativeElement.querySelector(".rename-row input")).withContext(r).toBeNull();
    }
  });
  it("does not offer an admin privileged member or invitation actions", async () => {
    role.set("admin"); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll(".member-row");
    expect(rows[1].querySelector("mat-select")).toBeNull(); expect(rows[1].querySelector("button")).toBeNull();
    const inviteRows = [...fixture.nativeElement.querySelectorAll(".invite-row")] as HTMLElement[];
    const privileged = inviteRows.find(row => row.textContent?.includes("Invitado como Administrador"));
    expect(privileged).toBeDefined(); expect(privileged?.querySelector("button")).toBeNull();
    const selects = fixture.debugElement.queryAll(By.directive(MatSelect));
    const inviteSelect = selects[selects.length - 1].componentInstance as MatSelect;
    expect(inviteSelect.options.map(o => o.value)).not.toContain("admin");
  });
  it("gives role and removal controls the member's identity", () => {
    fixture.detectChanges(); const row = fixture.nativeElement.querySelector(".member-row");
    expect(row.querySelector('[role="combobox"]').getAttribute("aria-label")).toContain("Ana");
    expect(row.querySelector("button").getAttribute("aria-label")).toContain("Ana");
  });
  it("restores the visible role after a rejected change", async () => {
    api.patch.and.rejectWith(new ApiRequestError("No disponible", 503));
    const select = fixture.debugElement.queryAll(By.directive(MatSelect))[0].componentInstance as MatSelect;
    select.value = "viewer"; select.selectionChange.emit(new MatSelectChange(select, "viewer"));
    await fixture.whenStable(); fixture.detectChanges();
    expect(api.patch).toHaveBeenCalledOnceWith("/api/v1/workspaces/1/members/11", { role: "viewer" });
    expect(select.value).toBe("editor");
  });
  it("clears only the submitted email on a normal accepted invitation", async () => {
    component.inviteEmail.set("first@example.test"); await component.invite();
    expect(component.inviteEmail()).toBe(""); expect(snack.open).toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledOnceWith("/api/v1/workspaces/1/invitations", { email: "first@example.test", role: "editor" });
  });
  it("drops a mutation after selection leaves and returns to the same workspace", async () => {
    const response = deferred<unknown>(); api.delete.and.returnValue(response.promise);
    const cancel = component.cancelInvite(invitation); await switchTo(2); await switchTo(1); api.get.calls.reset();
    response.resolve({ ok: true }); await cancel;
    expect(api.get).not.toHaveBeenCalled(); expect(snack.open).not.toHaveBeenCalled();
  });
  it("does not apply a confirmation to a new workspace", async () => {
    const confirmation = deferred<boolean>(); actions.confirm.and.returnValue(confirmation.promise);
    const removal = component.removeMember(member); await switchTo(2); confirmation.resolve(true); await removal;
    expect(api.delete).not.toHaveBeenCalled();
  });
  it("does not offer admin promotion through a direct handler either", async () => {
    role.set("admin"); fixture.detectChanges(); await fixture.whenStable();
    await component.changeRole(member, "admin"); await component.removeMember(snapshot().members[1]);
    await component.resendInvite({ ...invitation, role: "admin" }); await component.cancelInvite({ ...invitation, role: "admin" });
    component.inviteEmail.set("new@example.test"); component.inviteRole.set("admin"); await component.invite();
    expect(api.patch).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
  });
  it("shows the accepted role and permits owners to assign administrators", async () => {
    api.get.and.resolveTo({ ...snapshot(), members: [{ ...member, role: "admin" }] });
    await component.changeRole(member, "admin"); await fixture.whenStable(); fixture.detectChanges();
    expect(api.patch).toHaveBeenCalledOnceWith("/api/v1/workspaces/1/members/11", { role: "admin" });
    expect(component.detail()?.members[0].role).toBe("admin");
  });
  it("captures transfer credentials before confirmation and keeps newer context panels", async () => {
    const confirmation = deferred<boolean>(); actions.confirm.and.returnValue(confirmation.promise);
    component.transferTarget.set(member); component.transferPassword.set("original");
    const transfer = component.transferOwnership(); component.transferPassword.set("edited");
    confirmation.resolve(true); await transfer;
    expect(api.post).toHaveBeenCalledOnceWith("/api/v1/workspaces/1/transfer-ownership", { targetUserId: member.id, password: "original" });
  });
  it("does not transfer while another mutation started during confirmation", async () => {
    const confirmation = deferred<boolean>(); actions.confirm.and.returnValue(confirmation.promise);
    component.transferTarget.set(member); component.transferPassword.set("original"); const transfer = component.transferOwnership();
    const response = deferred<unknown>(); api.post.and.returnValue(response.promise);
    component.inviteEmail.set("new@example.test"); const invitationSend = component.invite();
    confirmation.resolve(true); await transfer;
    expect(api.post).toHaveBeenCalledTimes(1); expect(api.post.calls.mostRecent().args[0]).toContain("/invitations");
    response.resolve({ ok: true }); await invitationSend;
  });
  it("does not close a new owner's transfer panel after an older confirmation resolves", async () => {
    const confirmation = deferred<boolean>(); actions.confirm.and.returnValue(confirmation.promise);
    component.transferTarget.set(member); component.transferPassword.set("original"); const transfer = component.transferOwnership();
    await switchTo(2); component.transferOpen.set(true); component.transferPassword.set("new-workspace-secret");
    confirmation.resolve(true); await transfer;
    expect(api.post).not.toHaveBeenCalled(); expect(component.transferOpen()).toBeTrue();
    expect(component.transferPassword()).toBe("new-workspace-secret");
  });
  it("drops an account-superseded read even before the reactive effect runs", async () => {
    const response = deferred<WorkspaceDetail>(); api.get.and.returnValue(response.promise);
    const read = component.load(); generation++; response.resolve(snapshot()); await read;
    expect(component.loading()).toBeTrue();
  });
  it("recovers a failed member search with one read", async () => {
    api.get.and.rejectWith(new ApiRequestError("No disponible", 503)); await component.searchTransferCandidates();
    expect(component.transferSearchError()).toBeTrue();
    api.get.calls.reset(); api.get.and.resolveTo({ members: [member], total: 1 }); await component.searchTransferCandidates();
    expect(api.get).toHaveBeenCalledTimes(1); expect(component.transferResults()).toEqual([member]);
    expect(component.transferSearchError()).toBeFalse();
  });
  it("does not let an old candidate be selected while a new query is pending", async () => {
    api.get.and.resolveTo({ members: [member], total: 1 }); await component.searchTransferCandidates();
    component.onTransferQuery("luis"); component.selectTransferTarget(member);
    expect(component.transferTarget()).toBeNull();
  });
  it("preserves a name draft across a failed refresh and retry", async () => {
    component.renameValue.set("Borrador sin guardar"); api.get.and.rejectWith(new ApiRequestError("No disponible", 503));
    await component.load(); api.get.and.resolveTo(snapshot()); await component.load();
    expect(component.renameValue()).toBe("Borrador sin guardar");
  });

  it("does not offer leaving when the team and navigation disagree about the current role", async () => {
    role.set("admin"); api.get.and.resolveTo(snapshot(1, "owner"));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const buttons = [...fixture.nativeElement.querySelectorAll("button")] as HTMLButtonElement[];
    expect(component.detail()?.workspace.role).toBe("owner");
    expect(buttons.some(b => b.textContent?.trim() === "Abandonar")).toBeFalse();
  });

});
