import { TestBed, fakeAsync, flushMicrotasks, tick } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from "@angular/common/http/testing";
import { Router } from "@angular/router";
import type { AuthUser, Session, Workspace } from "../models";
import { apiInterceptor } from "../interceptors/api.interceptor";
import { ApiRequestError } from "./api.service";
import { AuthOperationSupersededError, AuthService } from "./auth.service";
import { WorkspaceService } from "./workspace.service";

const id = "a".repeat(64);
const marker = "uvh.auth.invalidated";
type Command = "one" | "others" | "all";
const account = (id: number): AuthUser => ({
  id, email: `account-${id}@example.test`, name: `Account ${id}`, isAdmin: false,
  emailVerified: true, mfaEnabled: false,
});
const workspace = (id: number): Workspace => ({
  id, name: `Workspace ${id}`, slug: `workspace-${id}`, role: "owner", createdAt: "2026-10-04T00:00:00Z",
});
const session: Session = {
  id, user_agent: "Fixture device", created_at: "2026-10-04T00:00:00Z", last_used_at: "2026-10-04T00:00:00Z",
  expires_at: "2026-10-05T00:00:00Z", revoked_at: null, mfa_verified_at: null, current: true,
};
const route = (command: Command): string => command === "one"
  ? `/api/v1/auth/sessions/${id}/revoke` : `/api/v1/auth/sessions/revoke-${command}`;
const acknowledgement = (command: Command): object => command === "one" ? { ok: true, current: true } : { ok: true, revoked: 3 };

function observe<T>(promise: Promise<T>): { value?: T; error?: unknown } {
  const result: { value?: T; error?: unknown } = {};
  void promise.then((value) => { result.value = value; }, (error: unknown) => { result.error = error; });
  return result;
}

/** Characterize actual HTTP/facade ownership before extracting its transport. */
describe("Auth account session contracts", () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let workspaces: WorkspaceService;
  let cookie: string;

  beforeEach(() => {
    localStorage.clear();
    cookie = "uvh_csrf=fixture";
    spyOnProperty(document, "cookie", "get").and.callFake(() => cookie);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(),
      { provide: Router, useValue: { navigateByUrl: jasmine.createSpy("navigateByUrl").and.resolveTo(true) } },
    ] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    workspaces = TestBed.inject(WorkspaceService);
    // Initial fixture only. Every later replacement uses real /me adoption.
    auth.user.set(account(1));
    workspaces.setList([workspace(10)]);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  function command(kind: Command): Promise<boolean | number> {
    return kind === "one" ? auth.revokeSession(id) : kind === "others" ? auth.revokeOtherSessions() : auth.revokeAllSessions();
  }

  function expectOwnedRequest(url: string, method: "GET" | "POST"): TestRequest {
    const request = http.expectOne(url);
    expect(request.request.method).toBe(method);
    expect(request.request.withCredentials).toBeTrue();
    expect(request.request.headers.get("X-Uvh-Account-Id")).toBe("1");
    expect(request.request.headers.has("X-Workspace-Id")).toBeFalse();
    if (method === "POST") {
      expect(request.request.headers.get("X-CSRF-Token")).toBe("fixture");
      expect(request.request.body).toEqual({});
    }
    return request;
  }

  function expectOriginalIdentity(): void {
    expect(auth.user()).toEqual(account(1));
    expect(auth.sessionGeneration()).toBe(0);
    expect(auth.sessionInvalidated()).toBeFalse();
    expect(workspaces.currentId()).toBe(10);
    expect(workspaces.list()).toEqual([workspace(10)]);
    expect(localStorage.getItem(marker)).toBeNull();
  }

  function adoptReplacement(): void {
    // A legitimate new observation: first invalidate A, then headerless /me
    // reads B. A real server would reject an A expectation for a B cookie.
    auth.sessionExpired();
    const replacement = observe(auth.me());
    const me = http.expectOne("/api/v1/auth/me");
    expect(me.request.headers.has("X-Uvh-Account-Id")).toBeFalse();
    me.flush({ user: account(2) });
    flushMicrotasks();
    const list = http.expectOne("/api/v1/workspaces");
    expect(list.request.headers.get("X-Uvh-Account-Id")).toBe("2");
    list.flush({ workspaces: [workspace(20)] });
    flushMicrotasks();
    expect(replacement.error).toBeUndefined();
    expect(auth.sessionInvalidated()).toBeFalse();
  }

  it("decodes an empty registry and its complete default", fakeAsync(() => {
    const result = observe(auth.listSessions());
    expectOwnedRequest("/api/v1/auth/sessions", "GET").flush({ sessions: [] });
    flushMicrotasks();
    expect(result.value).toEqual({ sessions: [], truncated: false });
    expectOriginalIdentity();
  }));

  it("preserves bounded registry information and current device fields", fakeAsync(() => {
    const result = observe(auth.listSessions());
    expectOwnedRequest("/api/v1/auth/sessions", "GET").flush({ sessions: [session], truncated: true });
    flushMicrotasks();
    expect(result.value).toEqual({ sessions: [session], truncated: true });
    expectOriginalIdentity();
  }));

  it("rejects a malformed registry instead of exposing unvalidated devices", fakeAsync(() => {
    const result = observe(auth.listSessions());
    expectOwnedRequest("/api/v1/auth/sessions", "GET").flush({ sessions: [session], truncated: "false" });
    flushMicrotasks();
    expect(result.error).toEqual(jasmine.any(ApiRequestError));
    expect((result.error as ApiRequestError).status).toBe(502);
    expect(result.value).toBeUndefined();
    expectOriginalIdentity();
  }));

  it("cancels only the opted-in registry read without invalidating identity", fakeAsync(() => {
    const controller = new AbortController();
    const result = observe(auth.listSessions({ signal: controller.signal }));
    const request = expectOwnedRequest("/api/v1/auth/sessions", "GET");
    controller.abort();
    flushMicrotasks();
    expect(request.cancelled).toBeTrue();
    expect((result.error as ApiRequestError).details).toEqual({ reason: "cancelled" });
    expectOriginalIdentity();
  }));

  it("forwards a bounded registry timeout without logging the user out", fakeAsync(() => {
    const result = observe(auth.listSessions({ timeoutMs: 1000 }));
    const request = expectOwnedRequest("/api/v1/auth/sessions", "GET");
    tick(1000);
    flushMicrotasks();
    expect(request.cancelled).toBeTrue();
    expect((result.error as ApiRequestError).details).toEqual({ reason: "timeout" });
    expectOriginalIdentity();
  }));

  it("revokes a different device and preserves this identity", fakeAsync(() => {
    const result = observe(auth.revokeSession(id));
    flushMicrotasks();
    expectOwnedRequest(route("one"), "POST").flush({ ok: true, current: false });
    flushMicrotasks();
    expect(result.value).toBeFalse();
    expectOriginalIdentity();
  }));

  for (const current of [false, true]) {
    it(`expires this identity exactly once when current is ${current ? "known locally" : "confirmed by server"}`, fakeAsync(() => {
      const result = observe(auth.revokeSession(id, current));
      flushMicrotasks();
      expectOwnedRequest(route("one"), "POST").flush(current ? { ok: true } : { ok: true, current: true });
      flushMicrotasks();
      expect(result.value).toBeTrue();
      expect(auth.user()).toBeNull();
      expect(auth.sessionGeneration()).toBe(1);
      expect(auth.sessionInvalidated()).toBeTrue();
      expect(workspaces.list()).toEqual([]);
      expect(workspaces.currentId()).toBeNull();
      expect(localStorage.getItem(marker)).not.toBeNull();
    }));
  }

  it("respects an explicit server non-current result over a stale local current hint", fakeAsync(() => {
    const result = observe(auth.revokeSession(id, true));
    flushMicrotasks();
    expectOwnedRequest(route("one"), "POST").flush({ ok: true, current: false });
    flushMicrotasks();
    expect(result.error).toBeUndefined();
    expect(result.value).toBeFalse();
    expectOriginalIdentity();
  }));

  it("encodes the target identifier as one path segment", fakeAsync(() => {
    const target = "abc/def?g#h%&";
    const result = observe(auth.revokeSession(target));
    flushMicrotasks();
    expectOwnedRequest(`/api/v1/auth/sessions/${encodeURIComponent(target)}/revoke`, "POST").flush({ ok: true });
    flushMicrotasks();
    expect(result.value).toBeFalse();
    expectOriginalIdentity();
  }));

  for (const kind of ["others", "all"] as const) {
    for (const count of [0, 3]) {
      it(`accepts ${count} closures for ${kind} and applies only its own invalidation policy`, fakeAsync(() => {
        const result = observe(command(kind));
        flushMicrotasks();
        expectOwnedRequest(route(kind), "POST").flush({ ok: true, revoked: count });
        flushMicrotasks();
        expect(result.value).toBe(count);
        if (kind === "others") expectOriginalIdentity();
        else {
          expect(auth.user()).toBeNull();
          expect(auth.sessionGeneration()).toBe(1);
          expect(workspaces.list()).toEqual([]);
          expect(localStorage.getItem(marker)).not.toBeNull();
        }
      }));
    }
  }

  for (const kind of ["one", "others", "all"] as const) {
    const invalid = kind === "one" ? [{}, { ok: false }, { ok: true, current: "true" }]
      : [{}, { ok: false, revoked: 3 }, { ok: true, revoked: -1 }, { ok: true, revoked: "3" }];
    for (const [index, body] of invalid.entries()) {
      it(`rejects invalid ${kind} acknowledgement ${index} without false signout`, fakeAsync(() => {
        const result = observe(kind === "one" ? auth.revokeSession(id, true) : command(kind));
        flushMicrotasks();
        expectOwnedRequest(route(kind), "POST").flush(body);
        flushMicrotasks();
        expect(result.error).toEqual(jasmine.any(ApiRequestError));
        expect((result.error as ApiRequestError).status).toBe(502);
        expect(result.value).toBeUndefined();
        expectOriginalIdentity();
      }));
    }
    for (const status of [404, 503, 0]) {
      it(`does not replay ${kind} or invent a logout on HTTP ${status}`, fakeAsync(() => {
        const result = observe(command(kind));
        flushMicrotasks();
        const request = expectOwnedRequest(route(kind), "POST");
        if (status === 0) request.error(new ProgressEvent("error"));
        else request.flush({ error: "Fixture refusal" }, { status, statusText: "Fixture refusal" });
        flushMicrotasks();
        expect((result.error as ApiRequestError).status).toBe(status);
        expectOriginalIdentity();
      }));
    }
    it(`does not expire an observed replacement after an already dispatched ${kind} succeeds`, fakeAsync(() => {
      const result = observe(command(kind));
      flushMicrotasks();
      const request = expectOwnedRequest(route(kind), "POST");
      adoptReplacement();
      const generation = auth.sessionGeneration();
      const previousMarker = localStorage.getItem(marker);
      expect(request.cancelled).toBeFalse();
      request.flush(acknowledgement(kind));
      flushMicrotasks();
      expect(result.error).toEqual(jasmine.any(AuthOperationSupersededError));
      expect(auth.user()).toEqual(account(2));
      expect(auth.sessionGeneration()).toBe(generation);
      expect(auth.sessionInvalidated()).toBeFalse();
      expect(workspaces.list()).toEqual([workspace(20)]);
      expect(localStorage.getItem(marker)).toBe(previousMarker);
    }));
    it(`does not expire an observed replacement after a late ${kind} 401`, fakeAsync(() => {
      const result = observe(command(kind));
      flushMicrotasks();
      const request = expectOwnedRequest(route(kind), "POST");
      adoptReplacement();
      const generation = auth.sessionGeneration();
      const previousMarker = localStorage.getItem(marker);
      request.flush({ error: "Old session revoked" }, { status: 401, statusText: "Unauthorized" });
      flushMicrotasks();
      expect((result.error as ApiRequestError).status).toBe(401);
      expect(auth.user()).toEqual(account(2));
      expect(auth.sessionGeneration()).toBe(generation);
      expect(auth.sessionInvalidated()).toBeFalse();
      expect(workspaces.currentId()).toBe(20);
      expect(localStorage.getItem(marker)).toBe(previousMarker);
    }));
    it(`retires ${kind} intent if identity changes during CSRF preparation`, fakeAsync(() => {
      cookie = "";
      const result = observe(command(kind));
      const csrf = http.expectOne("/api/v1/csrf");
      auth.sessionExpired();
      cookie = "uvh_csrf=fresh";
      csrf.flush({ csrfToken: "fresh" });
      flushMicrotasks();
      expect((result.error as ApiRequestError).reason).toBe("request_context_changed");
      http.expectNone(route(kind));
    }));
    it(`retains the existing single CSRF retry for ${kind}`, fakeAsync(() => {
      const result = observe(command(kind));
      flushMicrotasks();
      expectOwnedRequest(route(kind), "POST").flush({ error: "Fixture CSRF", reason: "csrf_rejected" }, { status: 403, statusText: "Forbidden" });
      flushMicrotasks();
      const csrf = http.expectOne("/api/v1/csrf");
      cookie = "uvh_csrf=fresh";
      csrf.flush({ csrfToken: "fresh" });
      flushMicrotasks();
      const retry = http.expectOne(route(kind));
      expect(retry.request.headers.get("X-CSRF-Token")).toBe("fresh");
      expect(retry.request.headers.get("X-Uvh-Account-Id")).toBe("1");
      retry.flush(acknowledgement(kind));
      flushMicrotasks();
      expect(result.error).toBeUndefined();
      expect(result.value).toBe(kind === "one" ? true : 3);
    }));
  }

  it("retires an old registry result after a legitimate replacement observation", fakeAsync(() => {
    const result = observe(auth.listSessions());
    const request = expectOwnedRequest("/api/v1/auth/sessions", "GET");
    adoptReplacement();
    request.flush({ sessions: [session], truncated: true });
    flushMicrotasks();
    expect(result.error).toEqual(jasmine.any(AuthOperationSupersededError));
    expect(result.value).toBeUndefined();
    expect(auth.user()).toEqual(account(2));
    expect(workspaces.currentId()).toBe(20);
  }));
});
