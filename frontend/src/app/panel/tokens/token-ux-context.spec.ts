import { TestBed, fakeAsync, flushMicrotasks, type ComponentFixture } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { provideRouter } from "@angular/router";
import { MatSnackBar } from "@angular/material/snack-bar";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { apiInterceptor } from "../../core/interceptors/api.interceptor";
import type { ApiTokenDto, AuthUser, WorkspaceRole } from "../../core/models";
import { ActionDialogService } from "../action-dialog.service";
import { TokensComponent } from "./tokens.component";

const account = (id = 1): AuthUser => ({ id, name: "Persona", email: `${id}@example.invalid`, emailVerified: true, isAdmin: false, mfaEnabled: false });
const row = (id = 1): ApiTokenDto => ({ id, name: `Integración ${id}`, scopes: ["links:read"], expiresAt: null, revokedAt: null, createdAt: "2026-10-01T12:00:00Z", lastUsedAt: null });
const secret = `uvh_${"A".repeat(43)}`;
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe("Token actual UI and HTTP command context", () => {
  let fixture: ComponentFixture<TokensComponent>; let component: TokensComponent;
  let http: HttpTestingController; let auth: AuthService; let workspaces: WorkspaceService; let context: SessionContextService;
  let actions: jasmine.SpyObj<ActionDialogService>; let snack: jasmine.Spy;
  beforeEach(async () => {
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    actions = jasmine.createSpyObj("actions", ["confirm"]); actions.confirm.and.resolveTo(true);
    await TestBed.configureTestingModule({ imports: [TokensComponent], providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(), provideRouter([]),
      { provide: ActionDialogService, useValue: actions },
    ] }).compileComponents();
    http = TestBed.inject(HttpTestingController); auth = TestBed.inject(AuthService); workspaces = TestBed.inject(WorkspaceService); context = TestBed.inject(SessionContextService);
    auth.user.set(account()); auth.loaded.set(true); workspaces.select(1); membership("owner");
  });
  afterEach(() => { fixture?.destroy(); http.verify(); });
  function membership(role: WorkspaceRole): void {
    workspaces.setList([1, 2].map(id => ({ id, role, name: `Workspace ${id}`, slug: `workspace-${id}`, createdAt: "2026-10-01T12:00:00Z" })));
  }
  function settleReads(): void {
    for (const r of http.match("/api/v1/tokens")) { expect(r.request.method).toBe("GET"); r.flush({ tokens: [row()], truncated: false }); }
    flushMicrotasks(); fixture.detectChanges();
  }
  function mount(): void {
    fixture = TestBed.createComponent(TokensComponent); component = fixture.componentInstance; fixture.detectChanges();
    snack = spyOn(fixture.debugElement.injector.get(MatSnackBar), "open"); settleReads();
  }
  function prepare(): void { component.name.set("Integración nueva"); component.selectedScopes.set(["links:read"]); component.password.set("fixture"); }
  function issue(): void { prepare(); void component.create(); flushMicrotasks(); }
  function ack(): void { http.expectOne(r => r.url === "/api/v1/tokens" && r.method === "POST").flush({ token: row(2), plainToken: secret }); flushMicrotasks(); }
  function settleIdentity(): void { for (const r of http.match("/api/v1/auth/me")) r.flush({ user: account() }); flushMicrotasks(); }
  function replace(kind: "identity" | "generation" | "selection" | "role" | "destroy"): void {
    if (kind === "identity") auth.user.set(account(2));
    if (kind === "generation") context.advance();
    if (kind === "selection") { workspaces.select(2); workspaces.select(1); }
    if (kind === "role") membership("viewer");
    if (kind === "destroy") fixture.destroy();
  }
  for (const kind of ["identity", "generation", "selection", "role"] as const) {
    it(`rejects a registry response after ${kind} before effects flush`, fakeAsync(() => {
      mount(); void component.load(); const old = http.expectOne("/api/v1/tokens"); replace(kind);
      old.flush({ tokens: [row(99)], truncated: true }); flushMicrotasks();
      expect(component.tokens().some(t => t.id === 99)).toBeFalse();
      fixture.detectChanges(); settleReads(); fixture.destroy();
    }));
  }
  for (const kind of ["identity", "generation", "selection", "role", "destroy"] as const) {
    it(`retires revocation confirmation after ${kind}`, fakeAsync(() => {
      mount(); const answer = deferred<boolean>(); actions.confirm.and.returnValue(answer.promise);
      void component.revoke(row()); replace(kind); answer.resolve(true); flushMicrotasks();
      http.expectNone(r => r.method === "DELETE"); fixture.detectChanges(); settleReads(); fixture.destroy();
    }));
  }
  it("does not disclose an issued secret into a replacement account or refresh it", fakeAsync(() => {
    mount(); issue(); replace("identity"); ack();
    expect(component.plainToken()).toBeNull(); http.expectNone("/api/v1/auth/me"); expect(snack).not.toHaveBeenCalled();
    fixture.detectChanges(); settleReads(); fixture.destroy();
  }));
  it("clears mounted credentials and rows when permissions become viewer", fakeAsync(() => {
    mount(); component.plainToken.set(secret); component.password.set("fixture"); membership("viewer"); fixture.detectChanges(); flushMicrotasks();
    expect(component.plainToken()).toBeNull(); expect(component.password()).toBe(""); expect(component.tokens()).toEqual([]);
    http.expectNone("/api/v1/tokens"); fixture.destroy();
  }));
  it("does not erase a later draft when an earlier creation finishes", fakeAsync(() => {
    mount(); issue(); component.name.set("Siguiente integración"); component.selectedScopes.set(["analytics:read"]); component.expiresAt.set("2027-01-01T10:00"); ack(); settleIdentity();
    expect(component.name()).toBe("Siguiente integración"); expect(component.selectedScopes()).toEqual(["analytics:read"]); expect(component.expiresAt()).toBe("2027-01-01T10:00"); fixture.destroy();
  }));
  it("retires a registry read started before a successful issuance", fakeAsync(() => {
    mount(); void component.load(); const old = http.expectOne("/api/v1/tokens"); issue(); ack();
    if (!old.cancelled) old.flush({ tokens: [row()], truncated: false }); flushMicrotasks(); settleIdentity();
    expect(component.tokens().some(t => t.id === 2)).toBeTrue(); fixture.destroy();
  }));
  it("does not replace an unacknowledged one-time secret with another issuance", fakeAsync(() => {
    mount(); component.plainToken.set(secret); issue();
    http.expectNone(r => r.method === "POST"); expect(component.plainToken()).toBe(secret); fixture.destroy();
  }));
  it("does not let an old revocation completion release a new operation", fakeAsync(() => {
    mount(); void component.revoke(row()); flushMicrotasks(); const old = http.expectOne("/api/v1/tokens/1");
    workspaces.select(2); fixture.detectChanges(); settleReads();
    void component.revoke(row()); flushMicrotasks(); const current = http.expectOne("/api/v1/tokens/1");
    old.flush({ ok: true }); flushMicrotasks(); expect(component.revokingId()).toBe(1); expect(snack).not.toHaveBeenCalled();
    current.flush({ ok: true }); flushMicrotasks(); settleReads(); fixture.destroy();
  }));
  it("does not dispatch revocation during a retained registry refresh", fakeAsync(() => {
    mount(); void component.load(); const read = http.expectOne("/api/v1/tokens"); void component.revoke(row()); flushMicrotasks();
    expect(actions.confirm).not.toHaveBeenCalled(); http.expectNone(r => r.method === "DELETE"); read.flush({ tokens: [row()], truncated: false }); flushMicrotasks(); fixture.destroy();
  }));
  it("does not publish identity refresh failure after the issuing view is gone", fakeAsync(() => {
    mount(); issue(); ack(); const identity = http.expectOne("/api/v1/auth/me"); fixture.destroy();
    identity.flush({ error: "Read failed" }, { status: 503, statusText: "Unavailable" }); flushMicrotasks(); expect(snack).not.toHaveBeenCalled();
  }));
  for (const outcome of ["success", "error"] as const) {
    it(`does not publish clipboard ${outcome} after account replacement`, fakeAsync(() => {
      mount(); component.plainToken.set(secret); const pending = deferred<void>(); spyOn(navigator.clipboard, "writeText").and.returnValue(pending.promise);
      component.copyPlain(); auth.user.set(account(2));
      if (outcome === "success") pending.resolve(); else pending.reject(new Error("Clipboard denied"));
      flushMicrotasks(); expect(snack).not.toHaveBeenCalled(); fixture.detectChanges(); settleReads(); fixture.destroy();
    }));
  }
  it("opens creation on demand and returns keyboard focus after cancellation", fakeAsync(() => {
    mount(); const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector("form")).toBeNull();
    const open = root.querySelector("app-page-header button") as HTMLButtonElement; open.focus(); open.click(); fixture.detectChanges(); TestBed.tick();
    expect(root.querySelector("form")).not.toBeNull(); expect(document.activeElement).toBe(root.querySelector("input[name=tokenName]"));
    component.password.set("fixture"); component.factorCode.set("123456");
    const cancel = root.querySelector(".create-heading button") as HTMLButtonElement; cancel.focus(); cancel.click(); fixture.detectChanges(); TestBed.tick();
    expect(root.querySelector("form")).toBeNull(); expect(component.password()).toBe(""); expect(component.factorCode()).toBe(""); expect(document.activeElement).toBe(open); fixture.destroy();
  }));
  it("supports Enter submission and announces availability without the secret", fakeAsync(() => {
    mount(); component.openCreate(); fixture.detectChanges(); prepare(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement; const submit = root.querySelector("button[type=submit]") as HTMLButtonElement;
    submit.focus(); root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); flushMicrotasks();
    ack(); settleIdentity(); fixture.detectChanges(); TestBed.tick();
    expect(root.querySelector("form")).toBeNull(); expect(root.querySelector(".plain-value")?.textContent).toContain(secret);
    expect(document.activeElement).toBe(root.querySelector(".plain-box"));
    expect([...root.querySelectorAll('[role="status"], [aria-live]')].some(e => e.textContent?.includes(secret))).toBeFalse();
    const finish = root.querySelector(".plain-actions button:last-child") as HTMLButtonElement; finish.focus(); finish.click(); fixture.detectChanges(); TestBed.tick();
    expect(component.plainToken()).toBeNull(); expect(root.querySelector(".plain-box")).toBeNull(); expect(document.activeElement).toBe(root.querySelector("app-page-header button")); fixture.destroy();
  }));
  it("does not steal focus if the user moved away before issuance completed", fakeAsync(() => {
    mount(); component.openCreate(); fixture.detectChanges(); issue();
    const refresh = fixture.nativeElement.querySelector(".registry-heading button") as HTMLButtonElement; refresh.focus();
    ack(); settleIdentity(); fixture.detectChanges(); TestBed.tick(); expect(document.activeElement).toBe(refresh); fixture.destroy();
  }));
  for (const role of ["owner", "admin", "editor", "viewer"] as const) {
    it(`matches the backend editor boundary for ${role}`, fakeAsync(() => {
      membership(role); mount(); expect(component.canManage()).toBe(role !== "viewer");
      const root = fixture.nativeElement as HTMLElement;
      expect(!!root.querySelector("app-page-header button")).toBe(role !== "viewer");
      if (role === "viewer") { issue(); http.expectNone(r => r.method === "POST"); expect(root.querySelector(".token-row")).toBeNull(); }
      fixture.destroy();
    }));
  }
  it("blocks malformed names, scopes, byte lengths and elapsed or distant expiries before dispatch", fakeAsync(() => {
    mount(); prepare(); expect(component.canCreate()).toBeTrue();
    for (const name of ["a", "a\nb", "x".repeat(81)]) { component.name.set(name); expect(component.canCreate()).toBeFalse(); }
    component.name.set("🛰️ integración"); expect(component.canCreate()).toBeTrue();
    for (const scopes of [["links:read", "links:read"], ["unknown"], []]) { component.selectedScopes.set(scopes); expect(component.canCreate()).toBeFalse(); }
    component.selectedScopes.set(["links:read"]); component.password.set("é".repeat(37)); expect(component.canCreate()).toBeFalse(); component.password.set("fixture");
    for (const expiry of ["2020-01-01T10:00", "2040-01-01T10:00", "2026-02-30T10:00"]) { component.expiresAt.set(expiry); expect(component.canCreate()).toBeFalse(); void component.create(); }
    flushMicrotasks(); http.expectNone(r => r.method === "POST"); fixture.destroy();
  }));
  it("preserves a confirmed revocation through a failed follow-up without replaying the delete", fakeAsync(() => {
    mount(); void component.revoke(row()); flushMicrotasks(); http.expectOne("/api/v1/tokens/1").flush({ ok: true }); flushMicrotasks();
    expect(component.state(row())).toBe("revoked"); expect(component.tokens()[0].revokedAt).toBeNull();
    http.expectOne("/api/v1/tokens").flush({ error: "Registry unavailable" }, { status: 503, statusText: "Unavailable" }); flushMicrotasks();
    expect(component.state(row())).toBe("revoked"); expect(component.error()).toContain("Registry unavailable");
    http.expectNone(r => r.method === "DELETE"); fixture.destroy();
  }));
  it("hides the current one-time secret when that credential is revoked", fakeAsync(() => {
    mount(); issue(); ack(); settleIdentity(); void component.revoke(row(2)); flushMicrotasks();
    http.expectOne("/api/v1/tokens/2").flush({ ok: true }); flushMicrotasks(); expect(component.plainToken()).toBeNull(); settleReads(); fixture.destroy();
  }));
  it("bounds the local registry at 100 rows after creation", fakeAsync(() => {
    mount(); component.tokens.set(Array.from({ length: 100 }, (_, i) => row(i + 10))); issue(); ack(); settleIdentity();
    expect(component.tokens().length).toBe(100); expect(component.tokens()[0].id).toBe(2); expect(component.truncated()).toBeTrue(); fixture.destroy();
  }));
  it("requires a new successful read and explicit review after an uncertain issuance", fakeAsync(() => {
    mount(); issue(); http.expectOne(r => r.method === "POST").flush({ token: row(2), plainToken: "invalid" }); flushMicrotasks();
    expect(component.creationUnconfirmed()).toBeTrue(); expect(component.plainToken()).toBeNull();
    component.acknowledgeUnconfirmed(); expect(component.creationUnconfirmed()).toBeTrue();
    component.cancelCreate(); expect(component.issueError()).toContain("puede haberse creado"); issue(); http.expectNone(r => r.method === "POST");
    void component.load(); http.expectOne("/api/v1/tokens").flush({ tokens: [row(2), row()], truncated: false }); flushMicrotasks();
    expect(component.creationUnconfirmed()).toBeTrue(); component.acknowledgeUnconfirmed(); expect(component.creationUnconfirmed()).toBeFalse(); fixture.destroy();
  }));
  it("shows clipboard failure and permits manual acknowledgement without another write", fakeAsync(() => {
    mount(); issue(); ack(); settleIdentity(); spyOn(navigator.clipboard, "writeText").and.rejectWith(new Error("Clipboard denied"));
    void component.copyPlain(); flushMicrotasks(); expect(component.copyFeedback()).toContain("manualmente"); expect(component.plainToken()).toBe(secret);
    component.finishIssued(); expect(component.plainToken()).toBeNull(); http.expectNone(r => r.method === "POST"); fixture.destroy();
  }));
  it("does not dispatch creation and revocation simultaneously", fakeAsync(() => {
    mount(); issue(); void component.revoke(row()); flushMicrotasks(); expect(actions.confirm).not.toHaveBeenCalled();
    http.expectNone(r => r.method === "DELETE"); ack(); settleIdentity(); fixture.destroy();
  }));
  for (const reading of ["failed", "pending"] as const) {
    it(`keeps the ${reading} registry untrusted after an independent successful issuance`, fakeAsync(() => {
      mount(); void component.load(); const prior = http.expectOne("/api/v1/tokens");
      if (reading === "failed") { prior.flush({ error: "Registry unavailable" }, { status: 503, statusText: "Unavailable" }); flushMicrotasks(); }
      issue(); ack(); settleIdentity();
      if (reading === "failed") expect(component.error()).toBe("Registry unavailable");
      else expect(prior.cancelled).toBeTrue();
      expect(component.plainToken()).toBe(secret); expect(component.tokens().some(t => t.id === 2)).toBeTrue();
      void component.revoke(row()); flushMicrotasks(); expect(actions.confirm).not.toHaveBeenCalled();
      const writes = http.match(r => r.method === "DELETE"); expect(writes.length).toBe(0);
      for (const write of writes) write.flush({ ok: true }); flushMicrotasks(); settleReads(); fixture.destroy();
    }));
  }
  for (const [label, body] of [
    ["missing ACK", {}], ["false ACK", { ok: false }], ["string ACK", { ok: "true" }],
    ["null body", null], ["array body", [{ ok: true }]], ["HTML body", "<html>Gateway</html>"],
  ] as const) {
    it(`does not claim revocation for a successful HTTP response with ${label}`, fakeAsync(() => {
      mount(); void component.revoke(row()); flushMicrotasks(); http.expectOne("/api/v1/tokens/1").flush(body); flushMicrotasks();
      expect(component.state(row())).toBe("active");
      expect(snack).not.toHaveBeenCalledWith("Token revocado", "Cerrar", { duration: 2500 });
      expect(component.registryNeedsRefresh()).toBeTrue();
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector(".read-notice")?.textContent).toContain("lectura actualizada");
      expect(root.querySelector(".read-notice")?.textContent).not.toContain("ha creado");
      expect((root.querySelector(".token-actions button") as HTMLButtonElement).disabled).toBeTrue();
      expect((root.querySelector(".registry-heading button") as HTMLButtonElement).disabled).toBeFalse();
      settleReads(); fixture.destroy();
    }));
  }
  for (const status of [0, 502]) {
    it(`requires a new read after an uncertain HTTP ${status} revocation`, fakeAsync(() => {
      mount(); void component.revoke(row()); flushMicrotasks(); const write = http.expectOne("/api/v1/tokens/1");
      void component.load(); const previous = http.expectOne("/api/v1/tokens");
      write.flush({ error: "Unconfirmed" }, { status, statusText: "Unknown" }); flushMicrotasks();
      if (!previous.cancelled) previous.flush({ tokens: [row()], truncated: false }); flushMicrotasks();
      expect(component.registryNeedsRefresh()).toBeTrue(); expect(component.state(row())).toBe("active");
      actions.confirm.calls.reset(); void component.revoke(row()); flushMicrotasks();
      expect(actions.confirm).not.toHaveBeenCalled();
      const unexpected = http.match(r => r.method === "DELETE"); expect(unexpected.length).toBe(0);
      for (const request of unexpected) request.flush({ ok: true }); flushMicrotasks(); settleReads(); fixture.destroy();
    }));
  }
  it("does not authorize a retained registry after an uncertain issuance", fakeAsync(() => {
    mount(); issue(); http.expectOne(r => r.method === "POST").flush({ token: row(2), plainToken: "invalid" }); flushMicrotasks();
    expect(component.registryNeedsRefresh()).toBeTrue(); actions.confirm.calls.reset(); void component.revoke(row()); flushMicrotasks();
    expect(actions.confirm).not.toHaveBeenCalled();
    const unexpected = http.match(r => r.method === "DELETE"); expect(unexpected.length).toBe(0);
    for (const request of unexpected) request.flush({ ok: true }); flushMicrotasks(); settleReads(); fixture.destroy();
  }));
  for (const revoked of [false, true]) {
    it(`resolves uncertain revocation from a fresh ${revoked ? "revoked" : "active"} registry without replay`, fakeAsync(() => {
      mount(); void component.revoke(row()); flushMicrotasks(); http.expectOne("/api/v1/tokens/1").flush({ ok: false }); flushMicrotasks();
      settleReads();
      void component.load(); http.expectOne("/api/v1/tokens").flush({ error: "Unavailable" }, { status: 503, statusText: "Unavailable" }); flushMicrotasks();
      expect(component.registryNeedsRefresh()).toBeTrue();
      void component.load(); const token = { ...row(), revokedAt: revoked ? "2026-10-08T12:00:00Z" : null };
      http.expectOne("/api/v1/tokens").flush({ tokens: [token], truncated: false }); flushMicrotasks();
      expect(component.registryNeedsRefresh()).toBeFalse(); expect(component.state(token)).toBe(revoked ? "revoked" : "active");
      http.expectNone(r => r.method === "DELETE"); fixture.destroy();
    }));
  }
  it("preserves the one-time secret when revocation is not confirmed", fakeAsync(() => {
    mount(); issue(); ack(); settleIdentity(); void component.revoke(row(2)); flushMicrotasks();
    http.expectOne("/api/v1/tokens/2").flush({ ok: false }); flushMicrotasks();
    expect(component.plainToken()).toBe(secret); expect(component.state(row(2))).toBe("active");
    settleReads(); fixture.destroy();
  }));
  it("does not require uncertain-outcome recovery for a definitive rejected revocation", fakeAsync(() => {
    mount(); void component.revoke(row()); flushMicrotasks(); http.expectOne("/api/v1/tokens/1").flush({ error: "Forbidden" }, { status: 403, statusText: "Forbidden" }); flushMicrotasks();
    expect(component.registryNeedsRefresh()).toBeFalse(); expect(component.state(row())).toBe("active");
    expect(snack).toHaveBeenCalledWith("Forbidden", "Cerrar", { duration: 4000 });
    http.expectNone("/api/v1/tokens"); fixture.destroy();
  }));
  it("ignores an uncertain revocation response after an account replacement", fakeAsync(() => {
    mount(); void component.revoke(row()); flushMicrotasks(); const write = http.expectOne("/api/v1/tokens/1");
    replace("identity"); fixture.detectChanges(); settleReads(); write.flush({ ok: false }); flushMicrotasks();
    expect(component.registryNeedsRefresh()).toBeFalse(); expect(snack).not.toHaveBeenCalled(); fixture.destroy();
  }));
});
