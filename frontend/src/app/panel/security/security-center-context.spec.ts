import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { MatSnackBar } from "@angular/material/snack-bar";
import type { AuthUser, SecurityCenterSnapshot, Session } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { ActionDialogService } from "../action-dialog.service";
import { SecurityCenterComponent } from "./security-center.component";
const account = (id: number): AuthUser => ({ id, name: `Account ${id}`, email: `${id}@example.invalid`, isAdmin: false, emailVerified: true, mfaEnabled: false });
const session = (current = false): Session => ({ id: current ? "current" : "other", user_agent: "Firefox en escritorio", created_at: "2026-10-07T00:00:00Z", last_used_at: "2026-10-07T00:00:00Z", expires_at: "2099-01-01T00:00:00Z", revoked_at: null, mfa_verified_at: null, current });
const snapshot: SecurityCenterSnapshot = { summary: { mfaEnabled: false, recoveryCodesRemaining: 0, activeSessions: 2, currentSessionMfaVerifiedAt: null, pendingEmail: "old@example.invalid", pendingEmailExpiresAt: null, lastPasswordEventAt: null }, activity: [], activityTruncated: false };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
type Command = "one" | "others" | "all";
describe("Security center mounted context and intent", () => {
  let fixture: ComponentFixture<SecurityCenterComponent>; let component: SecurityCenterComponent; let context: SessionContextService;
  let auth: jasmine.SpyObj<AuthService>; let api: jasmine.SpyObj<ApiService>; let actions: jasmine.SpyObj<ActionDialogService>; let router: Router; let snack: jasmine.Spy;
  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get"]); api.get.and.resolveTo(snapshot);
    auth = jasmine.createSpyObj<AuthService>("AuthService", ["sessionGeneration", "listSessions", "revokeSession", "revokeOtherSessions", "revokeAllSessions"]);
    for (const key of ["userRefreshRequired", "userMutationUnconfirmed", "mfaRecoveryIssueUnconfirmed"] as const) {
      Object.defineProperty(auth, key, { value: signal(false) });
    }
    auth.listSessions.and.resolveTo({ sessions: [session(true), session()], truncated: false });
    auth.revokeSession.and.resolveTo(false); auth.revokeOtherSessions.and.resolveTo(1); auth.revokeAllSessions.and.resolveTo(2);
    actions = jasmine.createSpyObj<ActionDialogService>("ActionDialogService", ["confirm"]); actions.confirm.and.resolveTo(true);
    await TestBed.configureTestingModule({ imports: [SecurityCenterComponent], providers: [provideRouter([]), { provide: ApiService, useValue: api }, { provide: AuthService, useValue: auth }, { provide: ActionDialogService, useValue: actions }] }).compileComponents();
    context = TestBed.inject(SessionContextService); context.user.set(account(1)); Object.defineProperty(auth, "user", { value: context.user }); auth.sessionGeneration.and.callFake(() => context.generation());
    router = TestBed.inject(Router); spyOn(router, "navigate").and.resolveTo(true);
    fixture = TestBed.createComponent(SecurityCenterComponent); component = fixture.componentInstance; snack = spyOn(fixture.debugElement.injector.get(MatSnackBar), "open");
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  });
  afterEach(() => { if (!fixture.componentRef.hostView.destroyed) fixture.destroy(); });
  const pause = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  function replacement(advance = true) { if (advance) context.advance(); context.user.set(account(2)); }
  function command(kind: Command) { return kind === "one" ? component.revoke(session()) : kind === "others" ? component.closeOtherSessions() : component.closeAllSessions(); }
  function calls(kind: Command) { return kind === "one" ? auth.revokeSession : kind === "others" ? auth.revokeOtherSessions : auth.revokeAllSessions; }
  function holdCommand(kind: Command) {
    const pending = deferred<boolean | number>();
    if (kind === "one") auth.revokeSession.and.callFake(async () => await pending.promise as boolean);
    else if (kind === "others") auth.revokeOtherSessions.and.callFake(async () => await pending.promise as number);
    else auth.revokeAllSessions.and.callFake(async () => await pending.promise as number);
    return pending;
  }
  for (const kind of ["one", "others", "all"] as const) {
    for (const transition of ["generation", "identity", "destroy"] as const) {
      it(`retires ${kind} confirmation after ${transition}, even before effects flush`, async () => {
        const confirmation = deferred<boolean>(); actions.confirm.and.returnValue(confirmation.promise); const pending = command(kind);
        if (transition === "destroy") fixture.destroy(); else replacement(transition === "generation");
        confirmation.resolve(true); await pending;
        expect(calls(kind)).not.toHaveBeenCalled(); expect(snack).not.toHaveBeenCalled(); expect(router.navigate).not.toHaveBeenCalled();
      });
    }
    for (const outcome of ["success", "error"] as const) {
      it(`does not publish late ${kind} ${outcome} into another account`, async () => {
        const response = holdCommand(kind); const pending = command(kind); await pause(); expect(calls(kind)).toHaveBeenCalledTimes(1); replacement(); const reads = auth.listSessions.calls.count();
        if (outcome === "error") response.reject(new ApiRequestError("Old account refusal", 403)); else response.resolve(kind === "one" ? false : 2);
        await pending; expect(snack).not.toHaveBeenCalled(); expect(router.navigate).not.toHaveBeenCalled(); expect(auth.listSessions.calls.count()).toBe(reads);
      });
    }
  }
  it("rejects an old read if the observed account changes without an epoch change", async () => {
    const old = deferred<SecurityCenterSnapshot>(); api.get.and.returnValue(old.promise); const pending = component.load(); replacement(false);
    const obsolete = { ...snapshot, summary: { ...snapshot.summary, pendingEmail: "leaked@example.invalid" } }; old.resolve(obsolete); await pending; expect(component.snapshot()).not.toBe(obsolete);
  });
  it("clears sensitive rows and pending email on logout and sends no anonymous reads", async () => {
    context.advance(); context.user.set(null); fixture.detectChanges(); await pause(); fixture.detectChanges();
    expect(component.snapshot()).toBeNull(); expect(component.sessions()).toEqual([]); expect(component.revokingId()).toBeNull();
    const reads = api.get.calls.count(); await component.load(); expect(api.get.calls.count()).toBe(reads); expect((fixture.nativeElement as HTMLElement).textContent).not.toContain("old@example.invalid");
  });
  it("reloads the mounted view for a new session of the same account", async () => {
    const next = { ...snapshot, summary: { ...snapshot.summary, pendingEmail: "next@example.invalid" } }; api.get.and.resolveTo(next); context.advance(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(component.snapshot()).toBe(next); expect(api.get).toHaveBeenCalledTimes(2);
  });
  it("reloads posture after MFA changes within the same session", async () => {
    const next = { ...snapshot, summary: { ...snapshot.summary, mfaEnabled: true } }; api.get.and.resolveTo(next); context.user.update(user => user ? { ...user, mfaEnabled: true } : null); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); expect(component.snapshot()).toBe(next);
  });
  it("disables individual and bulk decisions while their registry is refreshing", async () => {
    const read = deferred<SecurityCenterSnapshot>(); api.get.and.returnValue(read.promise); const pending = component.load(); fixture.detectChanges();
    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(".session button,.bulk-actions button")]; expect(buttons.length).toBeGreaterThan(0); expect(buttons.every(button => button.disabled)).toBeTrue();
    await component.revoke(session()); expect(auth.revokeSession).not.toHaveBeenCalled(); read.resolve(snapshot); await pending;
  });
  it("does not release a newer command when the old one finally completes", async () => {
    const old = deferred<number>(); const fresh = deferred<number>(); let count = 0; auth.revokeOtherSessions.and.callFake(() => ++count === 1 ? old.promise : fresh.promise);
    const first = component.closeOtherSessions(); await pause(); replacement(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); const second = component.closeOtherSessions(); await pause(); expect(auth.revokeOtherSessions).toHaveBeenCalledTimes(2);
    old.resolve(1); await first; expect(component.revokingId()).toBe("bulk-others"); expect(snack).not.toHaveBeenCalled(); fresh.resolve(1); await second; expect(component.revokingId()).toBeNull();
  });
  for (const kind of ["one", "all"] as const) {
    it(`preserves exact own logout navigation for ${kind}`, async () => {
      const closed = () => { context.advance(); context.user.set(null); };
      if (kind === "one") auth.revokeSession.and.callFake(async () => { closed(); return true; }); else auth.revokeAllSessions.and.callFake(async () => { closed(); return 2; });
      await command(kind); expect(router.navigate).toHaveBeenCalledWith(["/auth"]);
    });
  }
  for (const outcome of ["false", "error"] as const) {
    it(`does not report confirmed logout as failed when navigation returns ${outcome}`, async () => {
      auth.revokeAllSessions.and.callFake(async () => { context.advance(); context.user.set(null); return 2; }); const navigation = router.navigate as jasmine.Spy;
      if (outcome === "false") navigation.and.resolveTo(false); else navigation.and.rejectWith(new Error("Navigation failed"));
      await component.closeAllSessions(); expect(snack).toHaveBeenCalled(); expect(snack.calls.mostRecent()?.args[0] ?? "").toContain("sesión quedó cerrada"); expect(snack.calls.mostRecent()?.args[0] ?? "").not.toContain("No se pudieron cerrar");
    });
  }
  it("does not clear replacement data after an older read fails", async () => {
    const old = deferred<SecurityCenterSnapshot>(); api.get.and.returnValue(old.promise); const pending = component.load(); replacement(false); api.get.and.resolveTo({ ...snapshot, activity: [] }); fixture.detectChanges(); await pause();
    old.reject(new ApiRequestError("Old snapshot failure", 503)); await pending; expect(component.error()).toBeNull(); expect(component.snapshot()).not.toBeNull();
  });
  it("does not publish a read into a destroyed view", async () => {
    const read = deferred<SecurityCenterSnapshot>(); api.get.and.returnValue(read.promise); const pending = component.load(); const before = component.snapshot(); fixture.destroy(); read.resolve({ ...snapshot }); await pending; expect(component.snapshot()).toBe(before);
  });
});
