import { TestBed, fakeAsync, flushMicrotasks, type ComponentFixture } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { provideRouter } from "@angular/router";
import type { AuthUser, ApiTokenDto } from "../../core/models";
import { AuthService } from "../../core/services/auth.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { apiInterceptor } from "../../core/interceptors/api.interceptor";
import { ActionDialogService } from "../action-dialog.service";
import { SecurityCenterComponent } from "../security/security-center.component";
import { TokensComponent } from "./tokens.component";

const account = (changes: Partial<AuthUser> = {}): AuthUser => ({ id: 1, name: "Persona", email: "qa@example.invalid", emailVerified: true, isAdmin: false, mfaEnabled: true, recoveryCodesRemaining: 10, ...changes });
const row = (id = 1, revoked = false): ApiTokenDto => ({ id, name: `Integración ${id}`, scopes: ["links:read"], expiresAt: null, revokedAt: revoked ? "2026-10-08T00:00:00Z" : null, createdAt: "2026-10-01T00:00:00Z", lastUsedAt: null });
const secret = `uvh_${"S".repeat(43)}`;
const snapshot = { summary: { mfaEnabled: true, recoveryCodesRemaining: 10, activeSessions: 0, currentSessionMfaVerifiedAt: null, pendingEmail: null, pendingEmailExpiresAt: null, lastPasswordEventAt: null }, activity: [], truncated: false };

describe("Token step-up account projection and authoritative secret retirement", () => {
  let auth: AuthService; let http: HttpTestingController; let context: SessionContextService; let workspaces: WorkspaceService;
  let fixture: ComponentFixture<TokensComponent>; let component: TokensComponent; let center: ComponentFixture<SecurityCenterComponent> | undefined;
  beforeEach(async () => {
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    await TestBed.configureTestingModule({ imports: [TokensComponent, SecurityCenterComponent], providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(), provideRouter([]),
      { provide: ActionDialogService, useValue: { confirm: jasmine.createSpy("confirm").and.resolveTo(true) } },
    ] }).compileComponents();
    auth = TestBed.inject(AuthService); http = TestBed.inject(HttpTestingController); context = TestBed.inject(SessionContextService); workspaces = TestBed.inject(WorkspaceService);
    auth.user.set(account()); auth.loaded.set(true); workspaces.select(1);
    workspaces.setList([1, 2].map(id => ({ id, name: `Workspace ${id}`, slug: `workspace-${id}`, role: "owner", createdAt: "2026-10-01T00:00:00Z" })));
    center = undefined;
  });
  afterEach(() => { fixture?.destroy(); center?.destroy(); http.verify(); });
  function mount(): void {
    fixture = TestBed.createComponent(TokensComponent); component = fixture.componentInstance; fixture.detectChanges(); registry();
  }
  function registry(rows = [row()], truncated = false): void {
    for (const read of http.match(r => r.url === "/api/v1/tokens" && r.method === "GET")) if (!read.cancelled) read.flush({ tokens: rows, truncated });
    flushMicrotasks(); fixture.detectChanges();
  }
  function issue(): void {
    component.name.set("Integración nueva"); component.selectedScopes.set(["links:read"]); component.password.set("fixture"); component.factorCode.set("ABCD-EFGH-JKLM-NPQR");
    void component.create(); flushMicrotasks();
  }
  function ack(): void { http.expectOne(r => r.method === "POST" && r.url === "/api/v1/tokens").flush({ token: row(2), plainToken: secret }); flushMicrotasks(); }
  function identity(changes: Partial<AuthUser> = {}): void {
    for (const read of http.match("/api/v1/auth/me")) if (!read.cancelled) read.flush({ user: account(changes) }); flushMicrotasks();
  }
  function issued(): void { mount(); issue(); ack(); identity({ recoveryCodesRemaining: 9 }); fixture.detectChanges(); TestBed.tick(); }
  function uncertain(status: number | "dto" = "dto"): void {
    issue(); const request = http.expectOne(r => r.method === "POST" && r.url === "/api/v1/tokens");
    if (status === "dto") request.flush({ token: row(2), plainToken: "invalid" });
    else request.flush({ error: "Unconfirmed" }, { status, statusText: "Unknown" }); flushMicrotasks();
  }
  for (const status of [0, 502, "dto"] as const) {
    it(`marks account projection unresolved after token issuance ${status}`, fakeAsync(() => {
      mount(); uncertain(status);
      expect(auth.userRefreshRequired()).toBeTrue(); expect(auth.userMutationUnconfirmed()).toBeTrue();
      expect(auth.mfaRecoveryIssueUnconfirmed()).toBeFalse(); expect(auth.user()?.recoveryCodesRemaining).toBe(10);
      expect(component.creationUnconfirmed()).toBeTrue(); http.expectNone("/api/v1/auth/me"); http.expectNone(r => r.method === "POST"); fixture.destroy();
    }));
  }
  it("retires identity reads begun before an uncertain step-up", fakeAsync(() => {
    mount(); void auth.me().catch(() => undefined); const old = http.expectOne("/api/v1/auth/me"); uncertain();
    expect(old.cancelled).toBeTrue(); if (!old.cancelled) old.flush({ user: account() }); flushMicrotasks();
    expect(auth.userRefreshRequired()).toBeTrue(); expect(auth.userMutationUnconfirmed()).toBeTrue(); fixture.destroy();
  }));
  for (const outcome of ["confirmed", "uncertain"] as const) {
    for (const leaving of ["destroy", "workspace"] as const) {
      it(`keeps account projection pending after ${outcome} issuance and view ${leaving}`, fakeAsync(() => {
        mount(); issue(); const write = http.expectOne(r => r.method === "POST");
        if (leaving === "destroy") fixture.destroy(); else { workspaces.select(2); fixture.detectChanges(); registry(); }
        write.flush({ token: row(2), plainToken: outcome === "confirmed" ? secret : "invalid" }); flushMicrotasks();
        expect(auth.userRefreshRequired()).toBeTrue(); expect(auth.userMutationUnconfirmed()).toBe(outcome === "uncertain");
        http.expectNone("/api/v1/auth/me"); http.expectNone(r => r.method === "POST"); fixture.destroy();
      }));
    }
  }
  for (const replacement of ["identity", "epoch"] as const) {
    it(`does not mark a replacement ${replacement} pending from the earlier step-up`, fakeAsync(() => {
      mount(); issue(); const write = http.expectOne(r => r.method === "POST");
      if (replacement === "identity") auth.user.set(account({ id: 2, email: "next@example.invalid" })); else context.advance();
      fixture.detectChanges(); registry(); write.flush({ token: row(2), plainToken: "invalid" }); flushMicrotasks();
      expect(auth.userRefreshRequired()).toBeFalse(); expect(auth.userMutationUnconfirmed()).toBeFalse(); http.expectNone("/api/v1/auth/me"); fixture.destroy();
    }));
  }
  it("does not imply recovery consumption for a password-only account", fakeAsync(() => {
    auth.user.set(account({ mfaEnabled: false, recoveryCodesRemaining: 0 })); mount(); uncertain();
    expect(auth.userRefreshRequired()).toBeFalse(); expect(auth.userMutationUnconfirmed()).toBeFalse(); fixture.destroy();
  }));
  it("does not mark projection pending after definitive validation rejection", fakeAsync(() => {
    mount(); issue(); http.expectOne(r => r.method === "POST").flush({ error: "Invalid" }, { status: 422, statusText: "Unprocessable" }); flushMicrotasks();
    expect(auth.userRefreshRequired()).toBeFalse(); expect(auth.userMutationUnconfirmed()).toBeFalse(); fixture.destroy();
  }));
  it("resolves the remaining count only after a valid identity read, without issuing another token", fakeAsync(() => {
    mount(); uncertain(); void auth.refreshUser().catch(() => undefined); http.expectOne("/api/v1/auth/me").flush({ error: "Unavailable" }, { status: 503, statusText: "Unavailable" }); flushMicrotasks();
    expect(auth.userRefreshRequired()).toBeTrue(); expect(auth.userMutationUnconfirmed()).toBeTrue();
    void auth.refreshUser(); identity({ recoveryCodesRemaining: 9 });
    expect(auth.user()?.recoveryCodesRemaining).toBe(9); expect(auth.userRefreshRequired()).toBeFalse(); expect(auth.userMutationUnconfirmed()).toBeFalse();
    expect(component.creationUnconfirmed()).toBeTrue(); http.expectNone(r => r.method === "POST"); fixture.destroy();
  }));
  it("prevents an overlapping profile DTO from validating a pre-step-up recovery count", fakeAsync(() => {
    mount(); void auth.updateProfile("Nombre nuevo").catch(() => undefined); flushMicrotasks(); const profile = http.expectOne("/api/v1/auth/profile"); uncertain();
    profile.flush({ user: account({ name: "Nombre nuevo" }) }); flushMicrotasks();
    expect(auth.userRefreshRequired()).toBeTrue();
    // Reconciliation must use a read after both responses, never the older DTO.
    identity({ name: "Nombre nuevo", recoveryCodesRemaining: 9 }); expect(auth.user()?.recoveryCodesRemaining).toBe(9); fixture.destroy();
  }));
  it("shows the account inspection action in the actual security center after uncertain issuance", fakeAsync(() => {
    mount(); center = TestBed.createComponent(SecurityCenterComponent); center.detectChanges();
    http.expectOne("/api/v1/auth/security-center").flush(snapshot); http.expectOne("/api/v1/auth/sessions").flush({ sessions: [], truncated: false }); flushMicrotasks(); center.detectChanges();
    expect(center.componentInstance.canDecide()).toBeTrue(); uncertain(); center.detectChanges(); flushMicrotasks(); center.detectChanges();
    expect(center.componentInstance.canDecide()).toBeFalse();
    expect((center.nativeElement as HTMLElement).textContent).toContain("No se pudo confirmar el resultado del envío");
    http.expectNone("/api/v1/auth/security-center"); fixture.destroy(); center.destroy();
  }));
  it("retires the issued secret after an explicit revocation in a fresh registry", fakeAsync(() => {
    issued(); void component.load(); registry([row(2, true), row()]);
    expect(component.plainToken()).toBeNull(); expect(component.issuedName()).toBe(""); expect(component.copyFeedback()).toBeNull(); fixture.destroy();
  }));
  for (const outcome of ["resolve", "reject"] as const) {
    it(`ignores clipboard ${outcome} after a read confirms the issued token revoked`, fakeAsync(() => {
      issued(); let resolve!: () => void; let reject!: (error: Error) => void;
      spyOn(navigator.clipboard, "writeText").and.returnValue(new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
      void component.copyPlain(); expect(component.copyBusy()).toBeTrue(); void component.load(); registry([row(2, true)]);
      if (outcome === "resolve") resolve(); else reject(new Error("Denied")); flushMicrotasks();
      expect(component.plainToken()).toBeNull(); expect(component.copyBusy()).toBeFalse(); expect(component.copyFeedback()).toBeNull(); fixture.destroy();
    }));
  }
  for (const missing of [false, true]) {
    it(`keeps the one-time secret when a registry ${missing ? "omits its row in a bounded window" : "still reports it active"}`, fakeAsync(() => {
      issued(); void component.load(); registry(missing ? [row()] : [row(2)], missing);
      expect(component.plainToken()).toBe(secret); fixture.destroy();
    }));
  }
  it("preserves the secret when a registry read fails", fakeAsync(() => {
    issued(); void component.load(); http.expectOne("/api/v1/tokens").flush({ error: "Unavailable" }, { status: 503, statusText: "Unavailable" }); flushMicrotasks();
    expect(component.plainToken()).toBe(secret); fixture.destroy();
  }));
  it("returns focus after the revoked issued section disappears", fakeAsync(() => {
    issued(); const root = fixture.nativeElement as HTMLElement; const section = root.querySelector(".plain-box") as HTMLElement; section.focus();
    void component.load(); registry([row(2, true)]); fixture.detectChanges(); TestBed.tick();
    expect(document.activeElement).toBe(root.querySelector("app-page-header button")); expect(root.querySelector(".plain-box")).toBeNull(); fixture.destroy();
  }));
  it("preserves refresh focus while retiring a revoked secret", fakeAsync(() => {
    issued(); const root = fixture.nativeElement as HTMLElement; const refresh = root.querySelector(".registry-heading button") as HTMLButtonElement; refresh.focus();
    void component.load(); registry([row(2, true)]); fixture.detectChanges(); TestBed.tick();
    expect(component.plainToken()).toBeNull(); expect(document.activeElement).toBe(refresh); fixture.destroy();
  }));
  for (const outcome of ["confirmed", "uncertain"] as const) {
    it(`marks account projection pending after ${outcome} MFA reauthentication`, fakeAsync(() => {
      auth.requireAdminMfaReauthentication();
      void auth.reauthenticateMfa("fixture", "ABCD-EFGH-JKLM-NPQR").catch(() => undefined); flushMicrotasks();
      http.expectOne("/api/v1/auth/mfa/reauthenticate").flush(outcome === "confirmed"
        ? { ok: true, verifiedAt: "2026-10-08T00:00:00Z", expiresAt: "2026-10-08T00:15:00Z" } : { ok: false }); flushMicrotasks();
      expect(auth.userRefreshRequired()).toBeTrue(); expect(auth.userMutationUnconfirmed()).toBe(outcome === "uncertain");
      expect(auth.adminMfaReauthenticationRequired()).toBe(outcome === "uncertain");
      expect(auth.mfaRecoveryIssueUnconfirmed()).toBeFalse(); http.expectNone(r => r.method === "POST");
    }));
  }
  it("retires an earlier identity read after an uncertain MFA reauthentication", fakeAsync(() => {
    void auth.me().catch(() => undefined); const old = http.expectOne("/api/v1/auth/me");
    void auth.reauthenticateMfa("fixture", "ABCD-EFGH-JKLM-NPQR").catch(() => undefined); flushMicrotasks();
    http.expectOne("/api/v1/auth/mfa/reauthenticate").flush({ ok: false }); flushMicrotasks();
    expect(old.cancelled).toBeTrue(); if (!old.cancelled) old.flush({ user: account() }); flushMicrotasks();
    expect(auth.userRefreshRequired()).toBeTrue();
  }));
  it("preserves a replacement epoch's MFA reauthentication notice", fakeAsync(() => {
    void auth.reauthenticateMfa("fixture", "ABCD-EFGH-JKLM-NPQR").catch(() => undefined); flushMicrotasks(); const write = http.expectOne("/api/v1/auth/mfa/reauthenticate");
    context.advance(); auth.requireAdminMfaReauthentication(); write.flush({ ok: true, verifiedAt: "2026-10-08T00:00:00Z", expiresAt: "2026-10-08T00:15:00Z" }); flushMicrotasks();
    expect(auth.adminMfaReauthenticationRequired()).toBeTrue(); expect(auth.userRefreshRequired()).toBeFalse();
  }));
});
