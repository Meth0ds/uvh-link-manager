import { TestBed, fakeAsync, flushMicrotasks, tick } from "@angular/core/testing";
import type { ComponentFixture } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { Router, ActivatedRoute } from "@angular/router";
import { Location } from "@angular/common";
import { SpyLocation } from "@angular/common/testing";
import { MatSnackBar } from "@angular/material/snack-bar";
import { MatDialog } from "@angular/material/dialog";
import { EmailAccessDialogComponent } from "./email-access-dialog.component";
import { PasswordChangeDialogComponent } from "./password-change-dialog.component";
import { DataExportDialogComponent } from "./data-export-dialog.component";
import { AccountDeletionDialogComponent } from "./account-deletion-dialog.component";
import type { AuthUser, Session, DataExportStatus, PrivacyRightRequest } from "../../core/models";
import { AuthService } from "../../core/services/auth.service";
import { apiInterceptor } from "../../core/interceptors/api.interceptor";
import { ActionDialogService } from "../action-dialog.service";
import { SettingsComponent } from "./settings.component";

const user = (id = 1): AuthUser => ({ id, email: `account${id}@example.test`, name: `Account ${id}`, isAdmin: false, emailVerified: true, mfaEnabled: false });
const session = (id: string): Session => ({ id, current: true, user_agent: id, created_at: "2026-10-03T00:00:00Z", last_used_at: "2026-10-03T00:00:00Z", expires_at: "2099-10-03T00:00:00Z", revoked_at: null, mfa_verified_at: null });
const exported = (id: number): DataExportStatus => ({ id, status: "cancelled", failureReason: null, stage: null, downloadExpiresAt: null, createdAt: "2026-10-03T00:00:00Z", readyAt: null, downloadedAt: null });
const privacy = (id: number): PrivacyRightRequest => ({ id, type: "access", status: "waiting_user", identityVerifiedAt: null, acknowledgedAt: null, dueAt: "2026-11-03T00:00:00Z", extendedUntil: null, extensionReasonCode: null, completedAt: null, cancelledAt: null, createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z", overdue: false, messages: [{ id, authorRole: "user", body: `Private case for account ${id}`, createdAt: "2026-10-03T00:00:00Z" }] });

describe("Settings private account ownership with real auth transport", () => {
  let http: HttpTestingController;
  let auth: AuthService;
  let snack: jasmine.SpyObj<MatSnackBar>;
  let fixture: ComponentFixture<SettingsComponent>;
  beforeEach(() => {
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    snack = jasmine.createSpyObj("MatSnackBar", ["open"]);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(),
      { provide: Router, useValue: { navigate: jasmine.createSpy("navigate").and.resolveTo(true), navigateByUrl: jasmine.createSpy("navigateByUrl").and.resolveTo(true) } },
      { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
      { provide: Location, useClass: SpyLocation },
      { provide: MatSnackBar, useValue: snack },
      { provide: ActionDialogService, useValue: { confirm: jasmine.createSpy("confirm").and.resolveTo(true) } },
    ] });
    // MatSnackBarModule supplies a component injector instance: observe that
    // actual caller rather than a root spy the rendered view never uses.
    TestBed.overrideComponent(SettingsComponent, { add: { providers: [{ provide: MatSnackBar, useValue: snack }] } });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { fixture?.destroy(); http.verify(); });


  function finishReads(id = 1): void {
    for (const r of http.match("/api/v1/auth/sessions")) r.flush({ sessions: [session(`Account ${id} device`)], truncated: false });
    for (const r of http.match("/api/v1/auth/data-export")) r.flush({ export: exported(id) });
    for (const r of http.match("/api/v1/auth/account-deletion")) r.flush({ canDelete: false, isPlatformAdmin: false, ownedWorkspaces: [{ id, name: `Private workspace ${id}`, slug: `account${id}` }], blockingPrivacyRequests: [], request: null });
    for (const r of http.match((r) => r.url === "/api/v1/auth/privacy-requests" && r.method === "GET")) r.flush({ requests: [privacy(id)], total: id, page: Number(r.request.params.get("page")), perPage: Number(r.request.params.get("perPage")) });
    for (const r of http.match("/api/v1/notifications/preferences")) r.flush({ preferences: [] });
    flushMicrotasks();
    for (const r of http.match("/api/v1/auth/data-export/history")) r.flush({ exports: [exported(id)] });
    flushMicrotasks();
  }
  function mount(): SettingsComponent {
    auth.user.set(user()); auth.loaded.set(true);
    fixture = TestBed.createComponent(SettingsComponent); fixture.detectChanges();
    finishReads(); fixture.detectChanges(); snack.open.calls.reset();
    return fixture.componentInstance;
  }
  function changeAccount(id = 2): void {
    void auth.me();
    http.expectOne("/api/v1/auth/me").flush({ user: user(id) });
    flushMicrotasks();
    for (const r of http.match("/api/v1/workspaces")) r.flush({ workspaces: [] });
    flushMicrotasks(); fixture.detectChanges();
  }

  it("navigates after its own confirmed current-device revocation despite account cleanup", fakeAsync(() => {
    const c = mount();
    const current = session("a".repeat(64));
    void c.revokeSession(current);
    flushMicrotasks();
    http.expectOne(`/api/v1/auth/sessions/${current.id}/revoke`).flush({ ok: true, current: true });
    flushMicrotasks(); fixture.detectChanges();
    expect(auth.user()).toBeNull();
    expect(auth.sessionGeneration()).toBe(1);
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledOnceWith(["/auth"]);
    expect(c.sessions()).toEqual([]);
    expect(c.privacyRequests()).toEqual([]);
    expect(snack.open).not.toHaveBeenCalled();
  }));

  it("reloads devices after another session is revoked without closing this identity", fakeAsync(() => {
    const c = mount();
    const other = { ...session("b".repeat(64)), current: false };
    void c.revokeSession(other);
    flushMicrotasks();
    http.expectOne(`/api/v1/auth/sessions/${other.id}/revoke`).flush({ ok: true, current: false });
    flushMicrotasks();
    http.expectOne("/api/v1/auth/sessions").flush({ sessions: [session("Remaining device")], truncated: false });
    flushMicrotasks(); fixture.detectChanges();
    expect(auth.user()?.id).toBe(1);
    expect(auth.sessionGeneration()).toBe(0);
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    expect(c.sessions().map((s) => s.id)).toEqual(["Remaining device"]);
    expect(snack.open).toHaveBeenCalledOnceWith("Sesión revocada", "Cerrar", { duration: 2500 });
  }));

  it("does not navigate or clear identity for an invalid current-device acknowledgement", fakeAsync(() => {
    const c = mount();
    const current = session("c".repeat(64));
    void c.revokeSession(current);
    flushMicrotasks();
    http.expectOne(`/api/v1/auth/sessions/${current.id}/revoke`).flush({ ok: true, current: "true" });
    flushMicrotasks(); fixture.detectChanges();
    expect(auth.user()?.id).toBe(1);
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    expect(c.sessions().length).toBe(1);
    expect(snack.open.calls.count()).toBe(1);
    expect(snack.open.calls.mostRecent().args[0]).toBe("El servidor devolvió una respuesta no válida");
  }));

  it("preserves a legitimate observed replacement when an old current-device command settles", fakeAsync(() => {
    const c = mount();
    const current = session("d".repeat(64));
    void c.revokeSession(current);
    flushMicrotasks();
    const command = http.expectOne(`/api/v1/auth/sessions/${current.id}/revoke`);
    // Invalidate A, then actually observe B without an A expectation header.
    auth.sessionExpired(); fixture.detectChanges();
    changeAccount(); finishReads(2); fixture.detectChanges();
    expect(command.cancelled).toBeFalse();
    command.flush({ ok: true, current: true });
    flushMicrotasks(); fixture.detectChanges();
    expect(auth.user()?.id).toBe(2);
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    expect(c.sessions()[0]?.id).toBe("Account 2 device");
    expect(c.privacyRequests()[0]?.id).toBe(2);
    expect(snack.open).not.toHaveBeenCalled();
  }));

  it("allows the confirmed global signout but no view feedback after Settings is destroyed", fakeAsync(() => {
    const c = mount();
    const current = session("e".repeat(64));
    void c.revokeSession(current);
    flushMicrotasks();
    const command = http.expectOne(`/api/v1/auth/sessions/${current.id}/revoke`);
    fixture.destroy();
    expect(command.cancelled).toBeFalse();
    command.flush({ ok: true, current: true });
    flushMicrotasks();
    expect(auth.user()).toBeNull();
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    expect(snack.open).not.toHaveBeenCalled();
  }));

  it("clears every displayed private projection before loading an observed replacement account", fakeAsync(() => {
    const c = mount();
    changeAccount();
    expect(c.sessions()).toEqual([]);
    expect(c.exportStatus()).toBeNull();
    expect(c.exportHistory()).toEqual([]);
    expect(c.deletionImpact()).toBeNull();
    expect(c.privacyRequests()).toEqual([]);
    expect(c.privacyTotal()).toBe(0);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain("Private case for account 1");
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain("Account 1 device");
    finishReads(2); fixture.detectChanges();
    expect(c.sessions()[0]?.id).toBe("Account 2 device");
    expect(c.exportStatus()?.id).toBe(2);
    expect(c.exportHistory()[0]?.id).toBe(2);
    expect(c.privacyRequests()[0]?.id).toBe(2);
  }));

  it("clears private drafts and projections when the session becomes anonymous without issuing account reads", fakeAsync(() => {
    const c = mount();
    c.privacyPage.set(3); c.privacyResponseId.set(1);
    c.privacyForm.setValue({ type: "rectification", details: "Private draft from A" });
    c.privacyResponseForm.setValue({ message: "Private response from A" });
    auth.sessionExpired(); fixture.detectChanges(); flushMicrotasks();
    expect(c.sessions()).toEqual([]);
    expect(c.exportHistory()).toEqual([]);
    expect(c.deletionImpact()).toBeNull();
    expect(c.privacyRequests()).toEqual([]);
    expect(c.privacyResponseId()).toBeNull();
    expect(c.privacyForm.controls.details.value).toBe("");
    expect(c.privacyResponseForm.controls.message.value).toBe("");
    expect(c.privacyPage()).toBe(0);
    http.expectNone((r) => r.url.startsWith("/api/v1/auth/"));
  }));

  it("does not dispatch an export cancellation confirmed after observing another account", fakeAsync(() => {
    const c = mount();
    let answer!: (value: boolean) => void;
    TestBed.inject(ActionDialogService).confirm = () => new Promise<boolean>((resolve) => { answer = resolve; });
    void c.cancelDataExport();
    changeAccount(); finishReads(2);
    answer(true); flushMicrotasks();
    const writes = http.match("/api/v1/auth/data-export/cancel");
    expect(writes.length).toBe(0);
    for (const r of writes) r.flush({ ok: true });
    flushMicrotasks(); finishReads(2);
  }));

  it("does not dispatch a privacy cancellation confirmed after observing another account", fakeAsync(() => {
    const c = mount();
    let answer!: (value: boolean) => void;
    TestBed.inject(ActionDialogService).confirm = () => new Promise<boolean>((resolve) => { answer = resolve; });
    void c.cancelPrivacy(privacy(1));
    changeAccount(); finishReads(2);
    answer(true); flushMicrotasks();
    const writes = http.match("/api/v1/auth/privacy-requests/1/cancel");
    expect(writes.length).toBe(0);
    for (const r of writes) r.flush({ ok: true });
    flushMicrotasks(); finishReads(2);
  }));

  for (const action of ["submit", "respond"] as const) {
    it(`does not let a late privacy ${action} clear another account's draft or publish success`, fakeAsync(() => {
      const c = mount();
      if (action === "submit") {
        c.privacyForm.setValue({ type: "rectification", details: "First private draft" });
        void c.submitPrivacyRequest();
      } else {
        c.privacyResponseForm.setValue({ message: "First private response" });
        void c.respondPrivacy(privacy(1));
      }
      flushMicrotasks();
      const pending = http.expectOne(action === "submit" ? "/api/v1/auth/privacy-requests" : "/api/v1/auth/privacy-requests/1/respond");
      changeAccount(); finishReads(2);
      c.privacyForm.setValue({ type: "rectification", details: "New account draft" });
      c.privacyResponseId.set(2);
      c.privacyResponseForm.setValue({ message: "New account response" });
      snack.open.calls.reset();
      expect(pending.cancelled).toBeFalse();
      pending.flush({ ok: true }); flushMicrotasks();
      expect(c.privacyForm.controls.details.value).toBe("New account draft");
      expect(c.privacyResponseId()).toBe(2);
      expect(snack.open).not.toHaveBeenCalled();
      const reads = http.match((r) => r.url === "/api/v1/auth/privacy-requests" && r.method === "GET");
      expect(reads.length).toBe(0);
      for (const r of reads) r.flush({ requests: [], total: 0, page: 1, perPage: 5 });
      flushMicrotasks();
    }));
  }

  for (const end of ["identity", "destroy"] as const) {
    it(`does not publish clipboard completion after ${end} removes its recovery codes`, fakeAsync(() => {
      const c = mount();
      let copied!: () => void;
      spyOn(navigator.clipboard, "writeText").and.returnValue(new Promise<void>((resolve) => { copied = resolve; }));
      c.recoveryCodes.set(["ABCD-EFGH-JKLM-NPQR"]);
      c.copyRecoveryCodes();
      if (end === "identity") { changeAccount(); finishReads(2); }
      else fixture.destroy();
      snack.open.calls.reset(); copied(); flushMicrotasks();
      expect(snack.open).not.toHaveBeenCalled();
    }));
  }

  for (const kind of ["export", "privacy"] as const) {
    for (const end of ["destroy", "same-account-return"] as const) {
      it(`rejects a ${kind} confirmation after ${end}`, fakeAsync(() => {
        const c = mount();
        let answer!: (value: boolean) => void;
        TestBed.inject(ActionDialogService).confirm = () => new Promise<boolean>((resolve) => { answer = resolve; });
        if (kind === "export") void c.cancelDataExport(); else void c.cancelPrivacy(privacy(1));
        if (end === "destroy") fixture.destroy();
        else { auth.sessionExpired(); fixture.detectChanges(); changeAccount(1); finishReads(1); }
        answer(true); flushMicrotasks();
        http.expectNone((r) => r.method === "POST");
        expect(snack.open).not.toHaveBeenCalled();
      }));
    }
  }

  it("retires all old private reads while the replacement account remains loading", fakeAsync(() => {
    const c = mount();
    void c.loadSessions(); void c.loadExportStatus(); void c.loadExportHistory(); void c.loadDeletionImpact(); void c.loadPrivacyRequests();
    const paths = ["/api/v1/auth/sessions", "/api/v1/auth/data-export", "/api/v1/auth/data-export/history", "/api/v1/auth/account-deletion", "/api/v1/auth/privacy-requests"];
    const old = paths.map((path) => http.expectOne((r) => r.url === path));
    changeAccount();
    expect(old.every((r) => r.cancelled)).toBeTrue();
    expect(c.sessionsLoading()).toBeTrue(); expect(c.exportLoading()).toBeTrue();
    expect(c.deletionLoading()).toBeTrue(); expect(c.privacyLoading()).toBeTrue();
    expect(c.sessions()).toEqual([]); expect(c.privacyRequests()).toEqual([]);
    finishReads(2);
    expect(c.sessionsLoading()).toBeFalse(); expect(c.exportLoading()).toBeFalse();
    expect(c.deletionLoading()).toBeFalse(); expect(c.privacyLoading()).toBeFalse();
  }));

  it("does not let an old rejected export cancellation release a new account's pending operation", fakeAsync(() => {
    const c = mount();
    void c.cancelDataExport(); flushMicrotasks();
    const old = http.expectOne("/api/v1/auth/data-export/cancel");
    changeAccount(); finishReads(2);
    void c.cancelDataExport(); flushMicrotasks();
    const current = http.expectOne("/api/v1/auth/data-export/cancel");
    expect(old.request.headers.get("X-Uvh-Account-Id")).toBe("1");
    expect(current.request.headers.get("X-Uvh-Account-Id")).toBe("2");
    old.flush({ error: "Old failure" }, { status: 503, statusText: "Unavailable" }); flushMicrotasks();
    expect(c.exportBusy()).toBeTrue(); expect(snack.open).not.toHaveBeenCalled();
    expect(current.cancelled).toBeFalse();
    current.flush({ ok: true }); flushMicrotasks(); finishReads(2);
    expect(c.exportBusy()).toBeFalse();
    expect(snack.open).toHaveBeenCalledWith("Exportación cancelada", "Cerrar", jasmine.anything());
  }));

  for (const status of ["processing", "ready"] as const) {
    it(`stops an outgoing ${status} export's automatic reads on logout`, fakeAsync(() => {
      const c = mount();
      void c.loadExportStatus();
      http.expectOne("/api/v1/auth/data-export").flush({ export: { ...exported(1), status, stage: status === "processing" ? "collecting" : null, downloadExpiresAt: status === "ready" ? new Date(Date.now() + 5000).toISOString() : null } });
      flushMicrotasks();
      for (const r of http.match("/api/v1/auth/data-export/history")) r.flush({ exports: [exported(1)] });
      flushMicrotasks();
      auth.sessionExpired(); fixture.detectChanges(); flushMicrotasks();
      tick(10000);
      http.expectNone((r) => r.method === "GET");
      expect(c.exportStatus()).toBeNull();
      fixture.destroy();
    }));
  }

  for (const kind of ["email", "password", "export", "deletion"] as const) {
    it(`closes the real ${kind} credential overlay when its owner changes`, fakeAsync(() => {
      const c = mount();
      const allowed = { canDelete: true, isPlatformAdmin: false, ownedWorkspaces: [], blockingPrivacyRequests: [], request: null };
      if (kind === "email") c.openEmailDialog("change");
      if (kind === "password") c.openPasswordDialog();
      if (kind === "export") c.openDataExportDialog();
      if (kind === "deletion") {
        void c.loadDeletionImpact(); http.expectOne("/api/v1/auth/account-deletion").flush(allowed); flushMicrotasks();
        c.openAccountDeletion(); http.expectOne("/api/v1/auth/account-deletion").flush(allowed); flushMicrotasks();
      }
      const ref = TestBed.inject(MatDialog).openDialogs[0];
      expect(ref).toBeDefined();
      const component = ref.componentInstance as EmailAccessDialogComponent | PasswordChangeDialogComponent | DataExportDialogComponent | AccountDeletionDialogComponent;
      if (component instanceof AccountDeletionDialogComponent) component.credentialsForm.controls.password.setValue("Old private password");
      else if (component instanceof PasswordChangeDialogComponent) component.passwordForm.controls.current.setValue("Old private password");
      else component.passwordForm.controls.password.setValue("Old private password");
      changeAccount(); finishReads(2); tick(500);
      expect(TestBed.inject(MatDialog).openDialogs.length).toBe(0);
      if (component instanceof AccountDeletionDialogComponent) expect(component.credentialsForm.controls.password.value).toBe("");
      else if (component instanceof PasswordChangeDialogComponent) expect(component.passwordForm.controls.current.value).toBe("");
      else expect(component.passwordForm.controls.password.value).toBe("");
      expect(snack.open).not.toHaveBeenCalled();
      http.expectNone((r) => r.method === "POST");
    }));
  }

  it("clears private state and retires a confirmation through the actual expected-account conflict path", fakeAsync(() => {
    const c = mount();
    let answer!: (value: boolean) => void;
    TestBed.inject(ActionDialogService).confirm = () => new Promise<boolean>((resolve) => { answer = resolve; });
    void c.cancelDataExport();
    void auth.me().catch(() => undefined);
    const conflict = http.expectOne("/api/v1/auth/me");
    expect(conflict.request.headers.get("X-Uvh-Account-Id")).toBe("1");
    conflict.flush({ error: "Account changed", reason: "session_context_changed" }, { status: 409, statusText: "Conflict" });
    flushMicrotasks(); fixture.detectChanges();
    expect(auth.user()).toBeNull();
    expect(c.privacyRequests()).toEqual([]); expect(c.sessions()).toEqual([]);
    // With no locally asserted actor, the next probe may observe the cookie's
    // account. No client signal is set to bypass the real interceptor path.
    void auth.me();
    const probe = http.expectOne("/api/v1/auth/me");
    expect(probe.request.headers.has("X-Uvh-Account-Id")).toBeFalse();
    probe.flush({ user: user(2) }); flushMicrotasks();
    http.expectOne("/api/v1/workspaces").flush({ workspaces: [] }); flushMicrotasks();
    fixture.detectChanges(); finishReads(2);
    answer(true); flushMicrotasks();
    expect(auth.user()?.id).toBe(2);
    expect(c.privacyRequests()[0]?.id).toBe(2);
    http.expectNone((r) => r.method === "POST");
    expect(snack.open).not.toHaveBeenCalled();
  }));
});
