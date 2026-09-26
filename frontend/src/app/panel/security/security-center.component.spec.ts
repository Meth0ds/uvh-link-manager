import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { MatSnackBar } from "@angular/material/snack-bar";
import type { SecurityCenterSnapshot, Session } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { ActionDialogService } from "../action-dialog.service";
import { SecurityCenterComponent } from "./security-center.component";

const snapshot: SecurityCenterSnapshot = {
  summary: {
    mfaEnabled: true,
    recoveryCodesRemaining: 4,
    activeSessions: 2,
    currentSessionMfaVerifiedAt: "2026-09-06T09:00:00Z",
    pendingEmail: null,
    pendingEmailExpiresAt: null,
    lastPasswordEventAt: "2026-09-05T10:00:00Z",
  },
  activity: [{ id: 1, action: "auth.sessions_revoked_others", createdAt: "2026-09-06T09:30:00Z" }],
  activityTruncated: false,
};

const session = (id: string, current = false, extra: Partial<Session> = {}): Session => ({
  id,
  user_agent: "Mozilla/5.0 (Macintosh)",
  created_at: "2026-09-05T12:00:00Z",
  last_used_at: "2026-09-06T08:00:00Z",
  expires_at: "2099-01-01T00:00:00Z",
  revoked_at: null,
  mfa_verified_at: null,
  current,
  ...extra,
});

describe("SecurityCenterComponent", () => {
  let fixture: ComponentFixture<SecurityCenterComponent>;
  let component: SecurityCenterComponent;
  let api: jasmine.SpyObj<ApiService>;
  let auth: jasmine.SpyObj<AuthService>;
  let snackbar: { open: jasmine.Spy };
  let router: Router;
  let actions: jasmine.SpyObj<ActionDialogService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get"]);
    api.get.and.resolveTo(snapshot);
    auth = jasmine.createSpyObj<AuthService>("AuthService", [
      "sessionGeneration", "listSessions", "revokeSession", "revokeOtherSessions", "revokeAllSessions",
    ]);
    auth.sessionGeneration.and.returnValue(1);
    auth.listSessions.and.resolveTo({ sessions: [session("current", true), session("other")], truncated: false });
    auth.revokeSession.and.resolveTo(false);
    auth.revokeOtherSessions.and.resolveTo(1);
    auth.revokeAllSessions.and.resolveTo(2);
    actions = jasmine.createSpyObj<ActionDialogService>("ActionDialogService", ["confirm", "prompt"]);
    actions.confirm.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [SecurityCenterComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: ActionDialogService, useValue: actions },
      ],
    }).compileComponents();
    // The real router backs the template's routerLink; only navigation is spied.
    router = TestBed.inject(Router);
    spyOn(router, "navigate").and.resolveTo(true);
    fixture = TestBed.createComponent(SecurityCenterComponent);
    component = fixture.componentInstance;
    // The imported MatSnackBarModule provides its own service in the component's
    // injector, shadowing a TestBed double; spy on the instance the component
    // actually resolves so the assertions track what it calls.
    snackbar = { open: spyOn(fixture.debugElement.injector.get(MatSnackBar), "open") };
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it("shows the posture and only the live sessions, with the bulk actions", async () => {
    auth.listSessions.and.resolveTo({
      sessions: [
        session("current", true),
        session("other"),
        session("dead", false, { revoked_at: "2026-09-06T00:00:00Z" }),
        session("expired", false, { expires_at: "2020-01-01T00:00:00Z" }),
      ],
      truncated: false,
    });
    await component.load();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain("2 sesiones activas · 4 códigos de recuperación disponibles");
    expect(element.querySelectorAll(".session").length).toBe(2);
    // The bulk close surface is part of the sessions panel contract.
    const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>(".bulk-actions button"));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(["Cerrar las demás", "Cerrar todas"]);
    // New bulk audit actions are labelled, not unknown rows.
    expect(element.textContent).toContain("Sesiones ajenas cerradas");
  });

  it("marks a bounded registry so an omitted device is not read as absent", async () => {
    auth.listSessions.and.resolveTo({ sessions: [session("current", true)], truncated: true });
    await component.load();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector(".bounded-note")?.textContent).toContain("La cuenta tiene más registros");
    expect(element.querySelector(".count")?.textContent?.trim()).toBe("1+");
  });

  it("revokes one device after explicit confirmation and reports it", async () => {
    const other = session("other");
    await component.revoke(other);

    expect(actions.confirm).toHaveBeenCalledWith(jasmine.objectContaining({ title: "Revocar sesión", destructive: true }));
    expect(auth.revokeSession).toHaveBeenCalledWith("other", false);
    expect(snackbar.open).toHaveBeenCalledWith("Sesión revocada", "Cerrar", jasmine.objectContaining({ duration: 2500 }));
    // The panel reflects the registry after the mutation, never before.
    expect(auth.listSessions).toHaveBeenCalledTimes(2);
  });

  it("leaves the panel when the revoked session is the current one", async () => {
    auth.revokeSession.and.resolveTo(true);
    await component.revoke(session("current", true));

    expect(router.navigate).toHaveBeenCalledWith(["/auth"]);
  });

  it("closes the other sessions under confirmation and reports the real count", async () => {
    auth.revokeOtherSessions.and.resolveTo(2);
    await component.closeOtherSessions();

    expect(actions.confirm).toHaveBeenCalledWith(jasmine.objectContaining({ title: "Cerrar las demás sesiones", destructive: true }));
    expect(auth.revokeOtherSessions).toHaveBeenCalledTimes(1);
    expect(snackbar.open).toHaveBeenCalledWith("Se cerraron 2 sesiones", "Cerrar", jasmine.objectContaining({ duration: 3000 }));
    expect(auth.listSessions).toHaveBeenCalledTimes(2);
  });

  it("reports honestly when there was nothing else to close", async () => {
    auth.revokeOtherSessions.and.resolveTo(0);
    await component.closeOtherSessions();

    expect(snackbar.open).toHaveBeenCalledWith("No había otras sesiones abiertas", "Cerrar", jasmine.objectContaining({ duration: 3000 }));
  });

  it("closes every session including this one and hands the browser to sign-in", async () => {
    await component.closeAllSessions();

    expect(actions.confirm).toHaveBeenCalledWith(jasmine.objectContaining({ title: "Cerrar todas las sesiones", destructive: true }));
    expect(auth.revokeAllSessions).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(["/auth"]);
  });

  it("sends nothing when the confirmation is declined", async () => {
    actions.confirm.and.resolveTo(false);
    await component.closeOtherSessions();
    await component.closeAllSessions();
    await component.revoke(session("other"));

    expect(auth.revokeOtherSessions).not.toHaveBeenCalled();
    expect(auth.revokeAllSessions).not.toHaveBeenCalled();
    expect(auth.revokeSession).not.toHaveBeenCalled();
  });

  it("surfaces an API refusal without claiming any session closed", async () => {
    auth.revokeOtherSessions.and.rejectWith(new ApiRequestError("Prohibido", 403));
    await component.closeOtherSessions();

    expect(snackbar.open).toHaveBeenCalledWith("Prohibido", "Cerrar", jasmine.objectContaining({ duration: 4000 }));
    expect(snackbar.open).not.toHaveBeenCalledWith(jasmine.stringContaining("Se cerraron"), "Cerrar", jasmine.anything());
    // A refused bulk close does not reload: the view still shows the registry.
    expect(auth.listSessions).toHaveBeenCalledTimes(1);
  });
});
