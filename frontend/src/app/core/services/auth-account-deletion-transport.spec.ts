import { TestBed, fakeAsync, flushMicrotasks, tick, type ComponentFixture } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from "@angular/common/http/testing";
import { MatDialogRef } from "@angular/material/dialog";
import { Router } from "@angular/router";
import type { AccountDeletionImpact, AuthUser, Workspace } from "../models";
import { apiInterceptor } from "../interceptors/api.interceptor";
import { ApiRequestError, type ApiReadOptions } from "./api.service";
import { AuthOperationSupersededError, AuthService } from "./auth.service";
import { WorkspaceService } from "./workspace.service";
import { AccountDeletionDialogComponent } from "../../panel/settings/account-deletion-dialog.component";

const endpoint = "/api/v1/auth/account-deletion";
const impact: AccountDeletionImpact = { canDelete: true, isPlatformAdmin: false, ownedWorkspaces: [], blockingPrivacyRequests: [], request: null };
const ack = { status: "requested", confirmationExpiresAt: "2099-10-04T00:00:00Z" } as const;
type Action = "impact" | "request";
const account = (id: number): AuthUser => ({ id, email: `fixture${id}@example.test`, name: `Account ${id}`, isAdmin: false, emailVerified: true, mfaEnabled: false });
const workspace = (id: number): Workspace => ({ id, name: `Workspace ${id}`, slug: `fixture-${id}`, role: "owner", createdAt: "2026-10-04T00:00:00Z" });
function observe<T>(promise: Promise<T>): { value?: T; error?: unknown; settled: boolean } {
  const state: { value?: T; error?: unknown; settled: boolean } = { settled: false };
  void promise.then((value) => { state.value = value; state.settled = true; }, (error: unknown) => { state.error = error; state.settled = true; });
  return state;
}

describe("Auth account deletion transport and caller contracts", () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let workspaces: WorkspaceService;
  let cookie: string;
  let fixture: ComponentFixture<AccountDeletionDialogComponent> | undefined;
  let ref: { disableClose: boolean; close: jasmine.Spy };
  beforeEach(() => {
    localStorage.clear(); cookie = "uvh_csrf=fixture"; fixture = undefined;
    ref = { disableClose: false, close: jasmine.createSpy("close") };
    spyOnProperty(document, "cookie", "get").and.callFake(() => cookie);
    TestBed.configureTestingModule({ imports: [AccountDeletionDialogComponent], providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(),
      { provide: MatDialogRef, useValue: ref },
      { provide: Router, useValue: { navigateByUrl: jasmine.createSpy().and.resolveTo(true) } },
    ] });
    auth = TestBed.inject(AuthService); http = TestBed.inject(HttpTestingController); workspaces = TestBed.inject(WorkspaceService);
    auth.user.set(account(1)); // Initial fixture only; replacement uses /me.
    workspaces.setList([workspace(10)]);
  });
  afterEach(() => { fixture?.destroy(); http.verify(); localStorage.clear(); });
  function invoke(action: Action, options?: ApiReadOptions): Promise<unknown> {
    return action === "impact" ? auth.accountDeletionImpact(options) : auth.requestAccountDeletion("fixture-password", "ELIMINAR MI CUENTA", "123456");
  }
  function owned(action: Action): TestRequest {
    const request = http.expectOne(endpoint);
    expect(request.request.method).toBe(action === "impact" ? "GET" : "POST");
    expect(request.request.withCredentials).toBeTrue();
    expect(request.request.headers.get("X-Uvh-Account-Id")).toBe("1");
    expect(request.request.headers.has("X-Workspace-Id")).toBeFalse();
    expect(request.request.headers.get("X-CSRF-Token")).toBe(action === "impact" ? null : "fixture");
    return request;
  }
  function original(mfa = false): void {
    expect(auth.user()).toEqual({ ...account(1), mfaEnabled: mfa }); expect(auth.sessionGeneration()).toBe(0);
    expect(auth.sessionInvalidated()).toBeFalse(); expect(workspaces.currentId()).toBe(10);
    expect(auth.userRefreshRequired()).toBeFalse(); expect(auth.userMutationUnconfirmed()).toBeFalse();
    expect(localStorage.getItem("uvh.auth.invalidated")).toBeNull();
  }
  function replacement(): void {
    auth.sessionExpired(); const next = observe(auth.me());
    const me = http.expectOne("/api/v1/auth/me"); expect(me.request.headers.has("X-Uvh-Account-Id")).toBeFalse();
    me.flush({ user: account(2) }); flushMicrotasks();
    http.expectOne("/api/v1/workspaces").flush({ workspaces: [workspace(20)] }); flushMicrotasks();
    expect(next.error).toBeUndefined(); expect(auth.user()).toEqual(account(2));
  }
  function preservesReplacement(): void {
    expect(auth.user()).toEqual(account(2)); expect(auth.sessionInvalidated()).toBeFalse(); expect(workspaces.currentId()).toBe(20);
  }
  for (const action of ["impact", "request"] as const) {
    it(`preserves ${action} transport and validated outcome`, fakeAsync(() => {
      const result = observe(invoke(action)); flushMicrotasks(); const request = owned(action);
      if (action === "request") expect(request.request.body).toEqual({ password: "fixture-password", confirmation: "ELIMINAR MI CUENTA", factorCode: "123456" });
      request.flush(action === "impact" ? impact : ack); flushMicrotasks();
      expect(result.value).toEqual(action === "impact" ? impact : ack); expect(result.error).toBeUndefined(); original();
    }));
    it(`rejects late ${action} success after legitimate replacement`, fakeAsync(() => {
      const result = observe(invoke(action)); flushMicrotasks(); const request = owned(action); replacement();
      const generation = auth.sessionGeneration(); expect(request.cancelled).toBeFalse();
      request.flush(action === "impact" ? impact : ack); flushMicrotasks();
      expect(result.error).toEqual(jasmine.any(AuthOperationSupersededError)); expect(result.value).toBeUndefined();
      expect(auth.sessionGeneration()).toBe(generation); preservesReplacement();
    }));
    it(`does not expire B on a late ${action} 401`, fakeAsync(() => {
      const result = observe(invoke(action)); flushMicrotasks(); const request = owned(action); replacement();
      const generation = auth.sessionGeneration(); request.flush({ error: "Old session revoked" }, { status: 401, statusText: "Unauthorized" }); flushMicrotasks();
      expect((result.error as ApiRequestError).status).toBe(401); expect(auth.sessionGeneration()).toBe(generation); preservesReplacement();
    }));
    it(`rejects malformed ${action} without replay or projection changes`, fakeAsync(() => {
      const result = observe(invoke(action)); flushMicrotasks(); owned(action).flush({ status: "scheduled", canDelete: "true" }); flushMicrotasks();
      expect((result.error as ApiRequestError).status).toBe(502); expect(result.value).toBeUndefined();
      http.expectNone(endpoint); original();
    }));
  }
  for (const factor of [undefined, "", "ABCD2345EFGH6789"]) {
    it(`preserves optional request factor ${String(factor)}`, fakeAsync(() => {
      const result = observe(auth.requestAccountDeletion("fixture-password", "ELIMINAR MI CUENTA", factor)); flushMicrotasks();
      const request = owned("request"); expect(request.request.body).toEqual({ password: "fixture-password", confirmation: "ELIMINAR MI CUENTA", ...(factor ? { factorCode: factor } : {}) });
      request.flush(ack); flushMicrotasks(); expect(result.error).toBeUndefined(); original();
    }));
  }
  for (const status of [400, 403, 409, 503, 0]) {
    it(`does not repeat request on ${status}`, fakeAsync(() => {
      const result = observe(invoke("request")); flushMicrotasks(); const request = owned("request");
      if (status === 0) request.error(new ProgressEvent("error"));
      else request.flush({ error: "Fixture refusal" }, { status, statusText: "Fixture refusal" });
      flushMicrotasks(); expect((result.error as ApiRequestError).status).toBe(status); http.expectNone(endpoint); original();
    }));
  }
  it("forwards impact AbortSignal without changing identity", fakeAsync(() => {
    const abort = new AbortController(); const result = observe(auth.accountDeletionImpact({ signal: abort.signal }));
    const request = owned("impact"); abort.abort(); flushMicrotasks();
    expect(request.cancelled).toBeTrue(); expect((result.error as ApiRequestError).details).toEqual({ reason: "cancelled" }); original();
  }));
  for (const budget of [1000, 20_000]) {
    it(`preserves impact ${budget}ms budget`, fakeAsync(() => {
      const result = observe(auth.accountDeletionImpact(budget === 1000 ? { timeoutMs: budget } : undefined)); const request = owned("impact");
      tick(budget - 1); expect(result.settled).toBeFalse(); tick(1); flushMicrotasks();
      expect(request.cancelled).toBeTrue(); expect((result.error as ApiRequestError).details).toEqual({ reason: "timeout" }); original();
    }));
  }
  it("preserves request45s budget without retry", fakeAsync(() => {
    const result = observe(invoke("request")); flushMicrotasks(); const request = owned("request");
    tick(44_999); expect(result.settled).toBeFalse(); tick(1); flushMicrotasks();
    expect(request.cancelled).toBeTrue(); expect((result.error as ApiRequestError).details).toEqual({ reason: "timeout" }); http.expectNone(endpoint); original();
  }));
  it("retires request intent during CSRF bootstrap", fakeAsync(() => {
    cookie = ""; const result = observe(invoke("request")); const csrf = http.expectOne("/api/v1/csrf");
    replacement(); cookie = "uvh_csrf=fresh"; csrf.flush({ csrfToken: "fresh" }); flushMicrotasks();
    expect((result.error as ApiRequestError).reason).toBe("request_context_changed"); http.expectNone(endpoint); preservesReplacement();
  }));
  for (const outcome of ["success", "refusal", "replacement"] as const) {
    it(`preserves CSRF renewal ${outcome} with at most two POSTs`, fakeAsync(() => {
      const result = observe(invoke("request")); flushMicrotasks(); const first = owned("request");
      first.flush({ error: "CSRF refusal", reason: "csrf_rejected" }, { status: 403, statusText: "Forbidden" }); flushMicrotasks();
      const csrf = http.expectOne("/api/v1/csrf");
      if (outcome === "replacement") replacement();
      cookie = "uvh_csrf=fresh"; csrf.flush({ csrfToken: "fresh" }); flushMicrotasks();
      if (outcome === "replacement") {
        expect((result.error as ApiRequestError).reason).toBe("request_context_changed"); preservesReplacement();
      } else {
        const retry = http.expectOne(endpoint); expect(retry.request.body).toEqual(first.request.body);
        expect(retry.request.headers.get("X-CSRF-Token")).toBe("fresh"); expect(retry.request.headers.get("X-Uvh-Account-Id")).toBe("1");
        expect(retry.request.headers.has("X-Workspace-Id")).toBeFalse(); expect(retry.request.withCredentials).toBeTrue();
        if (outcome === "success") { retry.flush(ack); flushMicrotasks(); expect(result.value).toEqual(ack); }
        else { retry.flush({ reason: "csrf_rejected" }, { status: 403, statusText: "Forbidden" }); flushMicrotasks(); expect((result.error as ApiRequestError).status).toBe(403); }
        original();
      }
      http.expectNone(endpoint); http.expectNone("/api/v1/csrf");
    }));
  }

  function mount(mfa = false): AccountDeletionDialogComponent {
    if (mfa) auth.user.set({ ...account(1), mfaEnabled: true }); // Initial fixture before mounting, same owner.
    fixture = TestBed.createComponent(AccountDeletionDialogComponent); fixture.detectChanges();
    return fixture.componentInstance;
  }
  function ready(mfa = false): AccountDeletionDialogComponent {
    const component = mount(mfa); owned("impact").flush(impact); flushMicrotasks(); fixture?.detectChanges();
    component.acknowledged.set(true); component.next(); flushMicrotasks(); fixture?.detectChanges();
    component.credentialsForm.setValue({ password: "fixture-password", confirmation: "ELIMINAR MI CUENTA" });
    return component;
  }
  it("dialog retries only the failed requirements read", fakeAsync(() => {
    const component = mount(); owned("impact").flush({ error: "Unavailable" }, { status: 503, statusText: "Unavailable" }); flushMicrotasks(); fixture?.detectChanges();
    expect(component.allowed()).toBeFalse(); expect(component.error()).toContain("comprobar");
    const retry = Array.from((fixture?.nativeElement as HTMLElement).querySelectorAll("button")).find((button) => button.textContent?.includes("Volver a comprobar"));
    expect(retry).toBeDefined(); retry?.click(); owned("impact").flush(impact); flushMicrotasks();
    expect(component.allowed()).toBeTrue(); expect(component.error()).toBeNull(); http.expectNone((r) => r.method === "POST");
  }));
  for (const blocked of [
    { ...impact, ownedWorkspaces: [{ id: 10, name: "Private workspace", slug: "fixture" }] },
    { ...impact, isPlatformAdmin: true },
    { ...impact, request: ack },
    { ...impact, blockingPrivacyRequests: [{ id: 1, type: "access", status: "submitted", due_at: "2099-10-04" }] },
  ] satisfies AccountDeletionImpact[]) {
    it(`dialog rejects contradictory canDelete with blocker ${JSON.stringify(blocked)}`, fakeAsync(() => {
      const component = mount(); owned("impact").flush(blocked); flushMicrotasks(); expect(component.impact()).toEqual(blocked); component.acknowledged.set(true); component.next();
      expect(component.allowed()).toBeFalse(); expect(component.step()).toBe(1); http.expectNone((r) => r.method === "POST");
    }));
  }
  for (const mfa of [false, true]) {
    it(`dialog validates credentials/factor, coalesces in-flight intent and clears secrets, MFA=${mfa}`, fakeAsync(() => {
      const component = ready(mfa); component.credentialsForm.controls.confirmation.setValue("wrong"); component.continueFromCredentials();
      http.expectNone((r) => r.method === "POST"); component.credentialsForm.controls.confirmation.setValue("ELIMINAR MI CUENTA");
      component.continueFromCredentials(); flushMicrotasks();
      if (mfa) {
        expect(component.step()).toBe(3); void component.submit(); http.expectNone((r) => r.method === "POST");
        component.factorForm.controls.factorCode.setValue("123456"); void component.submit(); flushMicrotasks();
      }
      const request = owned("request"); expect(ref.disableClose).toBeTrue(); void component.submit(); flushMicrotasks(); http.expectNone(endpoint);
      expect(request.request.body).toEqual({ password: "fixture-password", confirmation: "ELIMINAR MI CUENTA", ...(mfa ? { factorCode: "123456" } : {}) });
      request.flush(ack); flushMicrotasks();
      expect(component.step()).toBe(mfa ? 4 : 3); expect(component.credentialsForm.controls.password.value).toBe("");
      expect(component.factorForm.controls.factorCode.value).toBe(""); expect(ref.disableClose).toBeFalse(); original(mfa);
    }));
  }
  it("dialog cannot advance without acknowledgement", fakeAsync(() => {
    const component = mount(); owned("impact").flush(impact); flushMicrotasks(); component.next();
    expect(component.step()).toBe(1); http.expectNone((r) => r.method === "POST");
  }));
  it("dialog aborts requirements read on destroy and clears private input", fakeAsync(() => {
    const component = mount(); const request = owned("impact"); component.credentialsForm.controls.password.setValue("private fixture");
    fixture?.destroy(); flushMicrotasks(); expect(request.cancelled).toBeTrue();
    expect(component.credentialsForm.controls.password.value).toBe(""); expect(component.impact()).toBeNull(); http.expectNone((r) => r.method === "POST");
  }));
  it("dialog rejects malformed ACK and requires fresh inspection without write replay", fakeAsync(() => {
    const component = ready(); component.continueFromCredentials(); flushMicrotasks(); owned("request").flush({ status: "scheduled" }); flushMicrotasks();
    expect(component.step()).toBe(1); expect(component.impact()).toBeNull(); expect(component.acknowledged()).toBeFalse();
    expect(component.credentialsForm.controls.password.value).toBe(""); expect(component.error()).not.toBeNull();
    expect(ref.disableClose).toBeFalse(); http.expectNone(endpoint); original();
  }));
  for (const outcome of ["network", "malformed"] as const) {
    it(`failed requirements retry does not deny an already dispatched ${outcome} command`, fakeAsync(() => {
      const component = ready(); component.continueFromCredentials(); flushMicrotasks(); const request = owned("request");
      if (outcome === "network") request.error(new ProgressEvent("error"));
      else request.flush({ status: "scheduled" });
      flushMicrotasks(); expect(component.step()).toBe(1); expect(component.impact()).toBeNull();
      const read = observe(component.checkImpact()); owned("impact").flush({ error: "Unavailable" }, { status: 503, statusText: "Unavailable" });
      flushMicrotasks(); fixture?.detectChanges();
      expect(read.error).toBeUndefined(); expect(component.error()).not.toContain("No se ha enviado");
      expect((fixture?.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).not.toContain("No se ha enviado");
      expect(component.acknowledged()).toBeFalse(); expect(component.credentialsForm.controls.password.value).toBe("");
      expect(component.allowed()).toBeFalse(); http.expectNone(endpoint); original();
    }));
  }
  for (const outcome of ["success", "error"] as const) {
    it(`retired dialog does not publish late ${outcome} or retain credentials`, fakeAsync(() => {
      const component = ready(); component.continueFromCredentials(); flushMicrotasks(); const request = owned("request");
      const step = component.step(); fixture?.destroy(); expect(request.cancelled).toBeFalse();
      if (outcome === "success") request.flush(ack);
      else request.flush({ error: "Unavailable" }, { status: 503, statusText: "Unavailable" });
      flushMicrotasks(); expect(component.step()).toBe(step); expect(component.error()).toBeNull();
      expect(component.credentialsForm.controls.password.value).toBe(""); expect(ref.close).not.toHaveBeenCalled(); http.expectNone(endpoint); original();
    }));
  }
});
