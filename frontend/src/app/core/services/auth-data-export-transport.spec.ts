import { TestBed, fakeAsync, flushMicrotasks, tick } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from "@angular/common/http/testing";
import { Router } from "@angular/router";
import type { AuthUser, DataExportStatus, Workspace } from "../models";
import { apiInterceptor } from "../interceptors/api.interceptor";
import { ApiRequestError, type ApiReadOptions } from "./api.service";
import { AuthOperationSupersededError, AuthService } from "./auth.service";
import { WorkspaceService } from "./workspace.service";

const endpoint = "/api/v1/auth/data-export";
type Action = "status" | "history" | "request" | "download" | "ack" | "cancel";
const actions: Action[] = ["status", "history", "request", "download", "ack", "cancel"];
const mutations: Action[] = ["request", "download", "ack", "cancel"];
const account = (id: number): AuthUser => ({ id, email: `fixture${id}@example.test`, name: `Account ${id}`, isAdmin: false, emailVerified: true, mfaEnabled: false });
const workspace = (id: number): Workspace => ({ id, name: `Workspace ${id}`, slug: `fixture-${id}`, role: "owner", createdAt: "2026-10-04T00:00:00Z" });
const row: DataExportStatus = { id: 7, status: "processing", stage: null, failureReason: null, downloadExpiresAt: null, createdAt: "2026-10-04T00:00:00Z", readyAt: null, downloadedAt: null };
const blob = new Blob(['{"fixture":true}'], { type: "application/json" });
const route = (action: Action): string => endpoint + ({ status: "", history: "/history", request: "", download: "/download", ack: "/download/acknowledge", cancel: "/cancel" }[action]);
function observe<T>(promise: Promise<T>): { value?: T; error?: unknown; settled: boolean } {
  const result: { value?: T; error?: unknown; settled: boolean } = { settled: false };
  void promise.then((value) => { result.value = value; result.settled = true; }, (error: unknown) => { result.error = error; result.settled = true; });
  return result;
}

/** Contracts before/after extraction use the facade, actual API and interceptor. */
describe("Auth export transport contracts", () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let workspaces: WorkspaceService;
  let cookie: string;
  beforeEach(() => {
    localStorage.clear(); cookie = "uvh_csrf=fixture";
    spyOnProperty(document, "cookie", "get").and.callFake(() => cookie);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(),
      { provide: Router, useValue: { navigateByUrl: jasmine.createSpy().and.resolveTo(true) } },
    ] });
    auth = TestBed.inject(AuthService); http = TestBed.inject(HttpTestingController); workspaces = TestBed.inject(WorkspaceService);
    auth.user.set(account(1)); // Initial fixture only; replacement uses /me.
    workspaces.setList([workspace(10)]);
  });
  afterEach(() => { http.verify(); localStorage.clear(); });
  function invoke(action: Action, options?: ApiReadOptions, factor: string | undefined = "ABCD2345EFGH6789"): Promise<DataExportStatus | DataExportStatus[] | Blob | null | void> {
    switch (action) {
      case "status": return auth.dataExportStatus(options);
      case "history": return auth.dataExportHistory(options);
      case "request": return auth.requestDataExport("fixture-password", factor);
      case "download": return auth.downloadDataExport("fixture-password", factor);
      case "ack": return auth.acknowledgeDataExportDownload();
      case "cancel": return auth.cancelDataExport();
    }
  }
  function owned(action: Action): TestRequest {
    const request = http.expectOne(route(action));
    expect(request.request.method).toBe(mutations.includes(action) ? "POST" : "GET");
    expect(request.request.withCredentials).toBeTrue();
    expect(request.request.headers.get("X-Uvh-Account-Id")).toBe("1");
    expect(request.request.headers.has("X-Workspace-Id")).toBeFalse();
    if (mutations.includes(action)) expect(request.request.headers.get("X-CSRF-Token")).toBe("fixture");
    else expect(request.request.headers.has("X-CSRF-Token")).toBeFalse();
    if (action === "download") expect(request.request.responseType).toBe("blob");
    return request;
  }
  function success(action: Action, request: TestRequest): void {
    if (action === "download") request.flush(blob);
    else request.flush(action === "history" ? { exports: [row] } : action === "status" || action === "request" ? { export: row } : { ok: true });
  }
  function rejectCsrf(action: Action, request: TestRequest): void {
    const rejection = { error: "Fixture CSRF refusal", reason: "csrf_rejected" };
    if (action === "download") {
      const body = new Blob([JSON.stringify(rejection)], { type: "application/json" });
      // Control native Blob.text scheduling for fakeAsync retry tests; the
      // separate async refusal test exercises the native reader without a spy.
      spyOn(body, "text").and.resolveTo(JSON.stringify(rejection));
      request.flush(body, { status: 403, statusText: "Forbidden" });
    } else request.flush(rejection, { status: 403, statusText: "Forbidden" });
    flushMicrotasks();
  }
  function original(): void {
    expect(auth.user()).toEqual(account(1)); expect(auth.sessionGeneration()).toBe(0);
    expect(auth.sessionInvalidated()).toBeFalse(); expect(auth.userRefreshRequired()).toBeFalse();
    expect(auth.userMutationUnconfirmed()).toBeFalse(); expect(workspaces.currentId()).toBe(10);
    expect(localStorage.getItem("uvh.auth.invalidated")).toBeNull();
  }
  function replacement(): void {
    auth.sessionExpired();
    const next = observe(auth.me());
    const me = http.expectOne("/api/v1/auth/me");
    expect(me.request.headers.has("X-Uvh-Account-Id")).toBeFalse();
    me.flush({ user: account(2) }); flushMicrotasks();
    http.expectOne("/api/v1/workspaces").flush({ workspaces: [workspace(20)] }); flushMicrotasks();
    expect(next.error).toBeUndefined(); expect(auth.sessionInvalidated()).toBeFalse();
  }
  for (const action of actions) {
    it(`preserves the ${action} request, response and facade ownership`, fakeAsync(() => {
      const result = observe(invoke(action)); flushMicrotasks(); const request = owned(action);
      if (action === "request" || action === "download") expect(request.request.body).toEqual({ password: "fixture-password", factorCode: "ABCD2345EFGH6789" });
      else if (mutations.includes(action)) expect(request.request.body).toEqual({});
      success(action, request); flushMicrotasks();
      expect(result.error).toBeUndefined(); expect(result.settled).toBeTrue();
      expect(result.value).toEqual(action === "history" ? [row] : action === "download" ? blob : action === "status" || action === "request" ? row : undefined);
      original();
    }));
    it(`does not deliver a late ${action} success to a legitimately observed replacement`, fakeAsync(() => {
      const result = observe(invoke(action)); flushMicrotasks(); const request = owned(action);
      replacement(); const generation = auth.sessionGeneration();
      expect(request.cancelled).toBeFalse(); success(action, request); flushMicrotasks();
      expect(result.error).toEqual(jasmine.any(AuthOperationSupersededError));
      expect(result.value).toBeUndefined(); expect(auth.user()).toEqual(account(2));
      expect(auth.sessionGeneration()).toBe(generation); expect(auth.sessionInvalidated()).toBeFalse();
      expect(workspaces.currentId()).toBe(20);
    }));
    it(`ignores a late ${action} 401 for the replacement identity`, fakeAsync(() => {
      const result = observe(invoke(action)); flushMicrotasks(); const request = owned(action);
      replacement(); const generation = auth.sessionGeneration();
      // Artifact error bodies can be non-JSON. The status gate must still
      // retain its originating generation and cannot expire the new owner.
      if (action === "download") request.error(new ProgressEvent("error"), { status: 401, statusText: "Unauthorized" });
      else request.flush({ error: "Old session revoked" }, { status: 401, statusText: "Unauthorized" });
      flushMicrotasks();
      expect((result.error as ApiRequestError).status).toBe(401);
      expect(auth.user()).toEqual(account(2)); expect(auth.sessionGeneration()).toBe(generation);
      expect(auth.sessionInvalidated()).toBeFalse(); expect(workspaces.currentId()).toBe(20);
    }));
  }
  for (const action of ["request", "download"] as const) {
    for (const factor of [undefined, ""]) {
      it(`omits an absent ${action} factor without changing the password`, fakeAsync(() => {
        // Invoke directly so an explicit undefined does not trigger the
        // test helper's default factor parameter.
        const result = observe<DataExportStatus | Blob>(action === "request" ? auth.requestDataExport("fixture-password", factor) : auth.downloadDataExport("fixture-password", factor));
        flushMicrotasks(); const request = owned(action);
        expect(request.request.body).toEqual({ password: "fixture-password" });
        success(action, request); flushMicrotasks(); expect(result.error).toBeUndefined(); original();
      }));
    }
  }
  for (const action of ["status", "history"] as const) {
    it(`forwards ${action} cancellation`, fakeAsync(() => {
      const abort = new AbortController(); const result = observe(invoke(action, { signal: abort.signal }));
      const request = owned(action); abort.abort(); flushMicrotasks();
      expect(request.cancelled).toBeTrue(); expect((result.error as ApiRequestError).details).toEqual({ reason: "cancelled" }); original();
    }));
    it(`forwards the ${action} custom deadline`, fakeAsync(() => {
      const result = observe(invoke(action, { timeoutMs: 1000 })); const request = owned(action);
      tick(999); expect(result.settled).toBeFalse(); tick(1); flushMicrotasks();
      expect(request.cancelled).toBeTrue(); expect((result.error as ApiRequestError).details).toEqual({ reason: "timeout" }); original();
    }));
    it(`preserves the default twenty-second ${action} budget`, fakeAsync(() => {
      const result = observe(invoke(action)); const request = owned(action);
      tick(19_999); expect(result.settled).toBeFalse(); tick(1); flushMicrotasks();
      expect(request.cancelled).toBeTrue(); expect((result.error as ApiRequestError).status).toBe(0); original();
    }));
  }
  for (const action of mutations) {
    for (const status of [403, 503, 0]) {
      it(`does not repeat ${action} or alter identity after status ${status}`, fakeAsync(() => {
        const result = observe(invoke(action)); flushMicrotasks(); const request = owned(action);
        if (status === 0 || action === "download") request.error(new ProgressEvent("error"), { status, statusText: "Fixture failure" });
        else request.flush({ error: "Fixture refusal" }, { status, statusText: "Fixture refusal" });
        flushMicrotasks(); expect((result.error as ApiRequestError).status).toBe(status);
        http.expectNone((request) => request.method === "POST"); original();
      }));
    }
    it(`preserves the ${action} ${action === "download" ? 120 : 45}-second budget without replay`, fakeAsync(() => {
      const result = observe(invoke(action)); flushMicrotasks(); const request = owned(action);
      const deadline = action === "download" ? 120_000 : 45_000;
      tick(deadline - 1); expect(result.settled).toBeFalse(); tick(1); flushMicrotasks();
      expect(request.cancelled).toBeTrue(); expect((result.error as ApiRequestError).details).toEqual({ reason: "timeout" });
      http.expectNone((request) => request.method === "POST"); original();
    }));
    it(`retires ${action} intent during CSRF bootstrap if identity changes`, fakeAsync(() => {
      cookie = ""; const result = observe(invoke(action)); const csrf = http.expectOne("/api/v1/csrf");
      auth.sessionExpired(); cookie = "uvh_csrf=fresh"; csrf.flush({ csrfToken: "fresh" }); flushMicrotasks();
      expect((result.error as ApiRequestError).reason).toBe("request_context_changed");
      http.expectNone(route(action));
    }));
    it(`retains exactly one successful CSRF retry for ${action}`, fakeAsync(() => {
      const result = observe(invoke(action)); flushMicrotasks(); const request = owned(action);
      rejectCsrf(action, request);
      const csrf = http.expectOne("/api/v1/csrf");
      cookie = "uvh_csrf=fresh"; csrf.flush({ csrfToken: "fresh" }); flushMicrotasks();
      const retry = http.expectOne(route(action));
      expect(retry.request.method).toBe("POST");
      expect(retry.request.headers.get("X-CSRF-Token")).toBe("fresh");
      expect(retry.request.headers.get("X-Uvh-Account-Id")).toBe("1");
      expect(retry.request.headers.has("X-Workspace-Id")).toBeFalse();
      expect(retry.request.withCredentials).toBeTrue();
      expect(retry.request.body).toEqual(request.request.body);
      expect(retry.request.responseType).toBe(request.request.responseType);
      success(action, retry); flushMicrotasks();
      expect(result.error).toBeUndefined(); expect(result.settled).toBeTrue();
      http.expectNone(route(action)); http.expectNone("/api/v1/csrf"); original();
    }));
    it(`does not attempt a third ${action} write after a second CSRF rejection`, fakeAsync(() => {
      const result = observe(invoke(action)); flushMicrotasks(); rejectCsrf(action, owned(action));
      cookie = "uvh_csrf=fresh"; http.expectOne("/api/v1/csrf").flush({ csrfToken: "fresh" }); flushMicrotasks();
      const retry = http.expectOne(route(action)); rejectCsrf(action, retry);
      expect((result.error as ApiRequestError).status).toBe(403);
      expect((result.error as ApiRequestError).reason).toBeUndefined();
      http.expectNone("/api/v1/csrf"); http.expectNone(route(action)); original();
    }));
    it(`retires ${action} retry intent during CSRF renewal after replacement`, fakeAsync(() => {
      const result = observe(invoke(action)); flushMicrotasks(); rejectCsrf(action, owned(action));
      const csrf = http.expectOne("/api/v1/csrf"); replacement(); const generation = auth.sessionGeneration();
      cookie = "uvh_csrf=fresh"; csrf.flush({ csrfToken: "fresh" }); flushMicrotasks();
      expect((result.error as ApiRequestError).reason).toBe("request_context_changed");
      http.expectNone(route(action)); expect(auth.user()).toEqual(account(2));
      expect(auth.sessionGeneration()).toBe(generation); expect(auth.sessionInvalidated()).toBeFalse();
      expect(workspaces.currentId()).toBe(20);
    }));
  }
  for (const action of ["ack", "cancel"] as const) {
    for (const payload of [{}, { ok: false }]) {
      it(`rejects malformed ${action} acknowledgement without a false successful outcome`, fakeAsync(() => {
        const result = observe(invoke(action)); flushMicrotasks(); owned(action).flush(payload); flushMicrotasks();
        expect((result.error as ApiRequestError).status).toBe(502); expect(result.settled).toBeTrue();
        http.expectNone((request) => request.method === "POST"); original();
      }));
    }
  }
  it("preserves empty and ten-row histories", fakeAsync(() => {
    const empty = observe(auth.dataExportHistory()); owned("history").flush({ exports: [] }); flushMicrotasks(); expect(empty.value).toEqual([]);
    const bounded = observe(auth.dataExportHistory()); const rows = Array.from({ length: 10 }, (_, i) => ({ ...row, id: i + 1 }));
    owned("history").flush({ exports: rows }); flushMicrotasks(); expect(bounded.value).toEqual(rows); original();
  }));
  it("rejects an oversized history as a whole", fakeAsync(() => {
    const result = observe(auth.dataExportHistory()); owned("history").flush({ exports: Array.from({ length: 11 }, () => row) }); flushMicrotasks();
    expect((result.error as ApiRequestError).status).toBe(502); expect(result.value).toBeUndefined(); original();
  }));
  it("preserves a validated absence status", fakeAsync(() => {
    const result = observe(auth.dataExportStatus()); owned("status").flush({ export: null }); flushMicrotasks();
    expect(result.value).toBeNull(); expect(result.error).toBeUndefined(); original();
  }));
  it("translates a JSON artifact refusal from a real Blob without replay", async () => {
    const settled = auth.downloadDataExport("fixture-password").catch((error: unknown) => error);
    await Promise.resolve();
    const request = owned("download");
    request.flush(new Blob([JSON.stringify({ error: "Fixture factor refusal", reason: "fixture_refusal" })], { type: "application/json" }), { status: 403, statusText: "Forbidden" });
    const error = await settled;
    expect(error).toEqual(jasmine.any(ApiRequestError));
    expect((error as ApiRequestError).status).toBe(403); expect((error as ApiRequestError).reason).toBe("fixture_refusal");
    http.expectNone((request) => request.method === "POST"); original();
  });
});
