import { TestBed, fakeAsync, flushMicrotasks, tick, type ComponentFixture } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Location } from "@angular/common";
import { SpyLocation } from "@angular/common/testing";
import { provideRouter, Router } from "@angular/router";
import type { AuthUser, Session } from "../../core/models";
import { AuthService } from "../../core/services/auth.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { apiInterceptor } from "../../core/interceptors/api.interceptor";
import { ActionDialogService } from "../action-dialog.service";
import { SettingsComponent } from "../settings/settings.component";
import { SecurityCenterComponent } from "./security-center.component";

type View = SettingsComponent | SecurityCenterComponent;
type Kind = "settings" | "center";
const account = (id = 1): AuthUser => ({ id, name: `Account ${id}`, email: `${id}@example.invalid`, emailVerified: true, isAdmin: false, mfaEnabled: true, recoveryCodesRemaining: 10 });
const codes = [..."ABCDEFGHJK"].map(last => `ABCD-EFGH-JKLM-NPQ${last}`);
const snapshot = { summary: { mfaEnabled: true, recoveryCodesRemaining: 10, activeSessions: 2, currentSessionMfaVerifiedAt: null, pendingEmail: null, pendingEmailExpiresAt: null, lastPasswordEventAt: null }, activity: [], truncated: false };
const session = (id: string, deadline: number, current = false): Session => ({ id, current, user_agent: `Device ${id}`, expires_at: new Date(deadline).toISOString(), created_at: "2026-10-01T00:00:00Z", last_used_at: "2026-10-01T00:00:00Z", revoked_at: null, mfa_verified_at: null });

describe("Mounted account read lifetime with real auth and HTTP", () => {
  let http: HttpTestingController; let auth: AuthService; let context: SessionContextService;
  let fixture: ComponentFixture<View>; let hidden: boolean; let rows: Session[];
  beforeEach(async () => {
    hidden = false;
    spyOnProperty(document, "hidden", "get").and.callFake(() => hidden);
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    await TestBed.configureTestingModule({ imports: [SettingsComponent, SecurityCenterComponent], providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(), provideRouter([]),
      { provide: Location, useClass: SpyLocation },
      { provide: ActionDialogService, useValue: { confirm: jasmine.createSpy("confirm").and.resolveTo(true) } },
    ] }).compileComponents();
    http = TestBed.inject(HttpTestingController); auth = TestBed.inject(AuthService); context = TestBed.inject(SessionContextService);
    spyOn(TestBed.inject(Router), "navigate").and.resolveTo(true);
    (TestBed.inject(Location) as SpyLocation).setInitialPath("/app/settings/security");
  });
  afterEach(() => { fixture?.destroy(); http.verify(); });
  function ancillary(): void {
    const replies: Record<string, object> = {
      "/api/v1/auth/data-export": { export: null }, "/api/v1/auth/data-export/history": { exports: [] },
      "/api/v1/auth/account-deletion": { canDelete: true, isPlatformAdmin: false, ownedWorkspaces: [], blockingPrivacyRequests: [], request: null },
      "/api/v1/auth/privacy-requests": { requests: [], total: 0, page: 1, perPage: 5 },
      "/api/v1/notifications/preferences": { preferences: [] },
    };
    for (const [path, reply] of Object.entries(replies)) for (const r of http.match(request => request.url === path)) r.flush(reply);
  }
  function settleReads(): void {
    for (const r of http.match("/api/v1/auth/security-center")) r.flush(snapshot);
    for (const r of http.match("/api/v1/auth/sessions")) r.flush({ sessions: rows, truncated: true });
    ancillary(); flushMicrotasks(); ancillary(); flushMicrotasks(); fixture.detectChanges();
  }
  function mount(kind: Kind, deadline = Date.now() + 2_000): View {
    auth.user.set(account()); auth.loaded.set(true);
    rows = [session("a".repeat(64), Date.now() + 1_000_000, true), session("b".repeat(64), deadline)];
    fixture = kind === "center" ? TestBed.createComponent(SecurityCenterComponent) : TestBed.createComponent(SettingsComponent);
    fixture.detectChanges(); settleReads(); return fixture.componentInstance;
  }
  function reload(view: View): void { if (view instanceof SettingsComponent) void view.loadSessions(); else void view.load(); }
  function uncertainIssue(): void {
    void auth.mfaRegenerateRecoveryCodes("fixture", "123456").catch(() => undefined); flushMicrotasks();
    http.expectOne("/api/v1/auth/mfa/recovery-codes/regenerate").flush({ recoveryCodes: [] }); flushMicrotasks();
    expect(auth.mfaRecoveryIssueUnconfirmed()).toBeTrue();
  }
  for (const kind of ["center", "settings"] as const) {
    it(`${kind} removes a row at its exact deadline and refreshes once`, fakeAsync(() => {
      const c = mount(kind); tick(1_999); http.expectNone("/api/v1/auth/sessions");
      tick(1); flushMicrotasks();
      expect(c.sessions().map(s => s.id)).toEqual(["a".repeat(64)]);
      const read = http.expectOne("/api/v1/auth/sessions"); read.flush({ sessions: rows, truncated: true });
      settleReads(); expect(c.sessionsTruncated()).toBeTrue();
      http.expectNone("/api/v1/auth/sessions"); fixture.destroy();
    }));
    it(`${kind} suppresses hidden expiry reads and catches up once on return`, fakeAsync(() => {
      const c = mount(kind); hidden = true; document.dispatchEvent(new Event("visibilitychange")); tick(2_001);
      http.expectNone("/api/v1/auth/sessions"); hidden = false; document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus"));
      flushMicrotasks(); expect(c.sessions().length).toBe(1); settleReads(); http.expectNone("/api/v1/auth/sessions"); fixture.destroy();
    }));
    it(`${kind} stops the old deadline while an explicit refresh is in progress`, fakeAsync(() => {
      const c = mount(kind); reload(c); flushMicrotasks();
      const read = http.expectOne("/api/v1/auth/sessions"); tick(2_001); http.expectNone("/api/v1/auth/sessions");
      rows[1] = session("b".repeat(64), Date.now() + 10_000); read.flush({ sessions: rows, truncated: false }); settleReads();
      tick(1_000); http.expectNone("/api/v1/auth/sessions"); expect(c.sessions().length).toBe(2); fixture.destroy();
    }));
    it(`${kind} drops a prior account's deadline when identity changes`, fakeAsync(() => {
      mount(kind); context.advance(); context.user.set(account(2)); fixture.detectChanges();
      rows = [session("c".repeat(64), Date.now() + 20_000, true)]; settleReads(); tick(2_001);
      http.expectNone("/api/v1/auth/sessions"); expect(fixture.componentInstance.sessions()[0].id).toBe("c".repeat(64)); fixture.destroy();
    }));
    it(`${kind} cancels deadline and return listeners on destruction`, fakeAsync(() => {
      mount(kind); fixture.destroy(); tick(2_001); window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange"));
      http.expectNone("/api/v1/auth/sessions");
    }));
    it(`${kind} waits for server rejection before expiring the current identity`, fakeAsync(() => {
      const c = mount(kind); rows = [session("a".repeat(64), Date.now() + 1_000, true)]; reload(c); settleReads();
      tick(1_000); flushMicrotasks(); expect(auth.user()?.id).toBe(1);
      http.expectOne("/api/v1/auth/sessions").flush({ error: "Tu sesión ya no está activa." }, { status: 401, statusText: "Unauthorized" });
      for (const r of http.match("/api/v1/auth/security-center")) if (!r.cancelled) r.flush(snapshot);
      flushMicrotasks(); fixture.detectChanges(); expect(auth.user()).toBeNull(); expect(c.sessions()).toEqual([]); fixture.destroy();
    }));
    it(`${kind} reports a failed expiry read without retry loops or false empty success`, fakeAsync(() => {
      const c = mount(kind); tick(2_000); flushMicrotasks();
      http.expectOne("/api/v1/auth/sessions").flush({ error: "Lectura temporalmente no disponible" }, { status: 503, statusText: "Unavailable" });
      for (const r of http.match("/api/v1/auth/security-center")) r.flush(snapshot);
      flushMicrotasks(); fixture.detectChanges(); expect(c.sessions()).toEqual([]);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain("Lectura temporalmente no disponible");
      tick(60_000); http.expectNone("/api/v1/auth/sessions"); fixture.destroy();
    }));
  }
  it("Center retires reads begun before a confirmed MFA acknowledgement", fakeAsync(() => {
    const c = mount("center") as SecurityCenterComponent; void c.load(); flushMicrotasks();
    const old = http.expectOne("/api/v1/auth/security-center"); const listed = http.expectOne("/api/v1/auth/sessions");
    void auth.mfaRegenerateRecoveryCodes("fixture", "123456"); flushMicrotasks();
    http.expectOne("/api/v1/auth/mfa/recovery-codes/regenerate").flush({ recoveryCodes: codes }); flushMicrotasks();
    expect(c.canDecide()).toBeFalse();
    if (!old.cancelled) old.flush({ ...snapshot, summary: { ...snapshot.summary, pendingEmail: "obsolete@example.invalid" } });
    if (!listed.cancelled) listed.flush({ sessions: rows, truncated: false });
    flushMicrotasks(); fixture.detectChanges(); ancillary();
    expect(c.snapshot()?.summary.pendingEmail).not.toBe("obsolete@example.invalid");
    expect((fixture.nativeElement as HTMLElement).textContent).toContain("El cambio está confirmado");
    http.expectNone((r) => r.method === "POST"); fixture.destroy();
  }));
  for (const kind of ["center", "settings"] as const) {
    it(`${kind} never labels uncertain write-only recovery delivery as available after /me`, fakeAsync(() => {
      mount(kind); uncertainIssue(); fixture.detectChanges();
      void auth.me(); http.expectOne("/api/v1/auth/me").flush({ user: account() }); flushMicrotasks(); fixture.detectChanges(); settleReads();
      expect(auth.userRefreshRequired()).toBeFalse(); expect(auth.mfaRecoveryIssueUnconfirmed()).toBeTrue();
      const element = fixture.nativeElement as HTMLElement;
      if (kind === "settings") expect(element.querySelector(".mfa-summary")?.textContent).not.toContain("10 disponibles");
      else expect(element.textContent).not.toContain("10 códigos de recuperación disponibles");
      expect(element.textContent).toContain("Entrega no confirmada"); http.expectNone((r) => r.method === "POST"); fixture.destroy();
    }));
  }
  it("Settings rejects a stale session read before its account-change effect flushes", fakeAsync(() => {
    const c = mount("settings") as SettingsComponent; void c.loadSessions(); flushMicrotasks(); const read = http.expectOne("/api/v1/auth/sessions");
    context.user.set(account(2)); read.flush({ sessions: [session("private-old", Date.now() + 20_000)], truncated: true }); flushMicrotasks();
    expect(c.sessions().some(s => s.id === "private-old")).toBeFalse(); fixture.detectChanges(); settleReads(); fixture.destroy();
  }));

  it("Center refreshes account data once without replaying uncertain MFA", fakeAsync(() => {
    const c = mount("center") as SecurityCenterComponent; uncertainIssue(); fixture.detectChanges();
    void c.refreshAccount(); void c.refreshAccount(); flushMicrotasks();
    expect(c.refreshingAccount()).toBeTrue(); http.expectOne("/api/v1/auth/me").flush({ user: account() });
    flushMicrotasks(); fixture.detectChanges(); settleReads();
    expect(c.refreshingAccount()).toBeFalse(); expect(c.canDecide()).toBeTrue();
    expect(auth.mfaRecoveryIssueUnconfirmed()).toBeTrue(); http.expectNone(r => r.method === "POST"); fixture.destroy();
  }));
  it("Center preserves unresolved security after a failed account refresh", fakeAsync(() => {
    const c = mount("center") as SecurityCenterComponent; uncertainIssue(); fixture.detectChanges();
    const toast = spyOn(fixture.debugElement.injector.get(MatSnackBar), "open");
    void c.refreshAccount(); flushMicrotasks(); http.expectOne("/api/v1/auth/me").flush({ error: "Reintenta la lectura" }, { status: 503, statusText: "Unavailable" });
    flushMicrotasks(); fixture.detectChanges();
    expect(c.refreshingAccount()).toBeFalse(); expect(auth.userRefreshRequired()).toBeTrue(); expect(c.canDecide()).toBeFalse();
    expect(toast.calls.mostRecent().args[0]).toBe("Reintenta la lectura"); http.expectNone(r => r.method === "POST"); fixture.destroy();
  }));
  it("Center suppresses an old account refresh's feedback after replacement", fakeAsync(() => {
    const c = mount("center") as SecurityCenterComponent; uncertainIssue(); fixture.detectChanges();
    const toast = spyOn(fixture.debugElement.injector.get(MatSnackBar), "open");
    void c.refreshAccount(); flushMicrotasks(); const old = http.expectOne("/api/v1/auth/me");
    context.advance(); context.user.set(account(2)); fixture.detectChanges(); old.flush({ user: account() }); flushMicrotasks();
    expect(context.user()?.id).toBe(2); expect(c.refreshingAccount()).toBeFalse(); expect(toast).not.toHaveBeenCalled(); fixture.destroy();
  }));
  it("Center keeps a superseded projection refresh quiet after another MFA ACK", fakeAsync(() => {
    const c = mount("center") as SecurityCenterComponent; uncertainIssue(); fixture.detectChanges();
    const toast = spyOn(fixture.debugElement.injector.get(MatSnackBar), "open");
    void c.refreshAccount(); flushMicrotasks(); const old = http.expectOne("/api/v1/auth/me");
    void auth.mfaRegenerateRecoveryCodes("fixture", "123456"); flushMicrotasks();
    http.expectOne("/api/v1/auth/mfa/recovery-codes/regenerate").flush({ recoveryCodes: codes }); flushMicrotasks(); fixture.detectChanges();
    expect(old.cancelled).toBeTrue(); expect(auth.userRefreshRequired()).toBeTrue(); expect(c.refreshingAccount()).toBeFalse(); expect(toast).not.toHaveBeenCalled(); fixture.destroy();
  }));
});
