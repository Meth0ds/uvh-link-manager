import { TestBed, fakeAsync, flushMicrotasks } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from "@angular/common/http/testing";
import { Router } from "@angular/router";
import type { AuthUser } from "../models";
import { apiInterceptor } from "../interceptors/api.interceptor";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";
import { WorkspaceService } from "./workspace.service";
import { NotificationsComponent } from "../../panel/notifications/notifications.component";

const account = (id: number): AuthUser => ({ id, name: `User ${id}`, email: `user${id}@example.test`, isAdmin: false, emailVerified: true, mfaEnabled: false });
const page = { notifications: [], unread: 0, nextCursor: null };
const methods = ["post", "patch", "delete", "postBlob"] as const;
type Method = typeof methods[number];

describe("Mutation intent across CSRF waits", () => {
  let api: ApiService;
  let auth: AuthService;
  let workspaces: WorkspaceService;
  let http: HttpTestingController;
  let cookie: string;

  beforeEach(() => {
    cookie = "";
    spyOnProperty(document, "cookie", "get").and.callFake(() => cookie);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(),
      { provide: Router, useValue: { navigateByUrl: jasmine.createSpy("navigateByUrl").and.resolveTo(true) } },
    ] });
    api = TestBed.inject(ApiService);
    auth = TestBed.inject(AuthService);
    workspaces = TestBed.inject(WorkspaceService);
    http = TestBed.inject(HttpTestingController);
    auth.user.set(account(1));
    workspaces.select(10);
  });

  afterEach(() => http.verify());

  function start(method: Method, path: string): { failure: unknown; value: unknown; pending: Promise<void> } {
    const result = { failure: undefined as unknown, value: undefined as unknown, pending: Promise.resolve() };
    result.pending = api[method](path, { intendedBy: "A" })
      .then((value) => { result.value = value; }, (error: unknown) => { result.failure = error; });
    return result;
  }

  async function nextNativeRequest(path: string): Promise<TestRequest> {
    const deadline = performance.now() + 1_000;
    while (performance.now() < deadline) {
      const requests = http.match(path);
      if (requests.length) {
        expect(requests.length).toBe(1);
        return requests[0];
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Native blob decoding did not reach ${path}`);
  }

  function replaceAccount(): void {
    auth.accountSignedOut();
    auth.user.set(account(2));
    workspaces.select(20);
    cookie = "uvh_csrf=B";
  }

  function unexpectedWrites(path: string): void {
    // Drain a forbidden send to avoid a misleading fixture failure at teardown.
    const writes = http.match(path);
    expect(writes.length).withContext("no old intent may reach the replacement context").toBe(0);
    for (const write of writes) write.flush(write.request.responseType === "blob" ? new Blob(["old-write"]) : { ok: true });
    flushMicrotasks();
  }

  for (const method of methods) {
    for (const scope of ["account", "workspace"] as const) {
      it(`does not dispatch ${method} for an old ${scope} after the CSRF bootstrap`, fakeAsync(() => {
        const path = scope === "account" ? "/api/v1/notifications/preferences" : "/api/v1/links/7";
        const operation = start(method, path);
        const bootstrap = http.expectOne("/api/v1/csrf");
        if (scope === "account") replaceAccount();
        else { workspaces.select(20); cookie = "uvh_csrf=A"; }
        bootstrap.flush({ csrfToken: "fixture" });
        flushMicrotasks();
        unexpectedWrites(path);
        expect(operation.failure).toEqual(jasmine.objectContaining({ reason: "request_context_changed" }));
        expect(operation.value).toBeUndefined();
      }));
    }
  }

  for (const method of ["post", "patch", "delete"] as const) {
    for (const scope of ["account", "workspace"] as const) {
      it(`does not retry ${method} into a new ${scope} after CSRF rejection`, fakeAsync(() => {
        cookie = "uvh_csrf=A";
        const path = scope === "account" ? "/api/v1/notifications/preferences" : "/api/v1/links/7";
        const operation = start(method, path);
        flushMicrotasks();
        const original = http.expectOne(path);
        expect(original.request.headers.get("X-CSRF-Token")).toBe("A");
        original.flush({ error: "CSRF", reason: "csrf_rejected" }, { status: 403, statusText: "Forbidden" });
        flushMicrotasks();
        const refresh = http.expectOne("/api/v1/csrf");
        if (scope === "account") replaceAccount();
        else workspaces.select(20);
        cookie = "uvh_csrf=new";
        refresh.flush({ csrfToken: "fixture" });
        flushMicrotasks();
        unexpectedWrites(path);
        expect(operation.failure).toEqual(jasmine.objectContaining({ reason: "request_context_changed" }));
      }));
    }
  }

  it("does not dispatch a queued tenant write after A to B to A workspace selection", fakeAsync(() => {
    const operation = start("patch", "/api/v1/links/7");
    const bootstrap = http.expectOne("/api/v1/csrf");
    workspaces.select(20);
    workspaces.select(10);
    cookie = "uvh_csrf=A";
    bootstrap.flush({ csrfToken: "A" });
    flushMicrotasks();
    unexpectedWrites("/api/v1/links/7");
    expect(operation.failure).toEqual(jasmine.objectContaining({ reason: "request_context_changed" }));
  }));

  it("checks context even when a cookie already existed before the first microtask", fakeAsync(() => {
    cookie = "uvh_csrf=A";
    const operation = start("post", "/api/v1/notifications/read-all");
    replaceAccount();
    flushMicrotasks();
    unexpectedWrites("/api/v1/notifications/read-all");
    expect(operation.failure).toEqual(jasmine.objectContaining({ reason: "request_context_changed" }));
    http.expectNone("/api/v1/csrf");
  }));

  it("coalesces bootstrap while allowing the new account's own intent", fakeAsync(() => {
    const old = start("patch", "/api/v1/notifications/preferences");
    const bootstrap = http.expectOne("/api/v1/csrf");
    replaceAccount();
    cookie = "";
    const current = start("post", "/api/v1/notifications/read-all");
    http.expectNone("/api/v1/csrf");
    cookie = "uvh_csrf=B";
    bootstrap.flush({ csrfToken: "B" });
    flushMicrotasks();
    unexpectedWrites("/api/v1/notifications/preferences");
    const write = http.expectOne("/api/v1/notifications/read-all");
    expect(write.request.headers.get("X-CSRF-Token")).toBe("B");
    write.flush({ unread: 0 });
    flushMicrotasks();
    expect(old.failure).toEqual(jasmine.objectContaining({ reason: "request_context_changed" }));
    expect(current.failure).toBeUndefined();
    expect(current.value).toEqual({ unread: 0 });
  }));

  it("does not invalidate account commands when only workspace selection changes", fakeAsync(() => {
    const operation = start("patch", "/api/v1/notifications/preferences");
    const bootstrap = http.expectOne("/api/v1/csrf");
    workspaces.select(20);
    cookie = "uvh_csrf=A";
    bootstrap.flush({ csrfToken: "A" });
    flushMicrotasks();
    const write = http.expectOne("/api/v1/notifications/preferences");
    expect(write.request.headers.has("X-Workspace-Id")).toBeFalse();
    write.flush({ preferences: [] });
    flushMicrotasks();
    expect(operation.failure).toBeUndefined();
  }));

  it("keeps a dispatched write subscribed after the context changes", fakeAsync(() => {
    cookie = "uvh_csrf=A";
    const operation = start("post", "/api/v1/notifications/read-all");
    flushMicrotasks();
    const write = http.expectOne("/api/v1/notifications/read-all");
    replaceAccount();
    expect(write.cancelled).toBeFalse();
    write.flush({ unread: 0 });
    flushMicrotasks();
    expect(operation.failure).toBeUndefined();
    expect(operation.value).toEqual({ unread: 0 });
  }));

  it("retries exactly once in the same context and preserves body and idempotency key", fakeAsync(() => {
    cookie = "uvh_csrf=A";
    let failure: unknown;
    void api.post("/api/v1/links", { alias: "example" }, undefined, { "Idempotency-Key": "fixture-key" }).catch((error: unknown) => { failure = error; });
    flushMicrotasks();
    const first = http.expectOne("/api/v1/links");
    expect(first.request.headers.get("X-Workspace-Id")).toBe("10");
    first.flush({ reason: "csrf_rejected" }, { status: 403, statusText: "Forbidden" });
    flushMicrotasks();
    cookie = "uvh_csrf=fresh";
    http.expectOne("/api/v1/csrf").flush({ csrfToken: "fresh" });
    flushMicrotasks();
    const second = http.expectOne("/api/v1/links");
    expect(second.request.body).toEqual({ alias: "example" });
    expect(second.request.headers.get("Idempotency-Key")).toBe("fixture-key");
    expect(second.request.headers.get("X-CSRF-Token")).toBe("fresh");
    second.flush({ reason: "csrf_rejected" }, { status: 403, statusText: "Forbidden" });
    flushMicrotasks();
    expect(failure).toEqual(jasmine.objectContaining({ status: 403 }));
    http.expectNone("/api/v1/csrf");
    http.expectNone("/api/v1/links");
  }));

  for (const status of [403, 409, 429, 503]) {
    it(`does not retry non-CSRF rejection ${status}`, fakeAsync(() => {
      cookie = "uvh_csrf=A";
      const operation = start("post", "/api/v1/links");
      flushMicrotasks();
      http.expectOne("/api/v1/links").flush({ error: "Rejected", reason: "other" }, { status, statusText: "Rejected" });
      flushMicrotasks();
      expect(operation.failure).toEqual(jasmine.objectContaining({ status }));
      http.expectNone("/api/v1/csrf");
      http.expectNone("/api/v1/links");
    }));
  }

  for (const scope of ["account", "workspace"] as const) {
    it(`does not retry a blob POST into a changed ${scope} after decoding a JSON blob error`, async () => {
      cookie = "uvh_csrf=A";
      const path = scope === "account" ? "/api/v1/auth/data-export/download" : "/api/v1/analytics/export";
      const operation = start("postBlob", path);
      await Promise.resolve();
      const original = http.expectOne(path);
      original.flush(new Blob(['{"reason":"csrf_rejected"}'], { type: "application/json" }), { status: 403, statusText: "Forbidden" });
      // Blob.text() is native browser I/O; allow that task to finish, not a fakeAsync mock.
      const refresh = await nextNativeRequest("/api/v1/csrf");
      if (scope === "account") replaceAccount();
      else workspaces.select(20);
      cookie = "uvh_csrf=new";
      refresh.flush({ csrfToken: "new" });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const writes = http.match(path);
      expect(writes.length).toBe(0);
      for (const write of writes) write.flush(new Blob(["wrong-context"]));
      await operation.pending;
      expect(operation.failure).toEqual(jasmine.objectContaining({ reason: "request_context_changed" }));
    });
  }

  it("catches an observed account replacement from /me while CSRF is pending", fakeAsync(() => {
    const operation = start("patch", "/api/v1/notifications/preferences");
    const bootstrap = http.expectOne("/api/v1/csrf");
    void auth.me();
    http.expectOne("/api/v1/auth/me").flush({ user: account(2) });
    flushMicrotasks();
    expect(auth.user()?.id).toBe(2);
    http.expectOne("/api/v1/workspaces").flush({ workspaces: [] });
    flushMicrotasks();
    cookie = "uvh_csrf=B";
    bootstrap.flush({ csrfToken: "B" });
    flushMicrotasks();
    unexpectedWrites("/api/v1/notifications/preferences");
    expect(operation.failure).toEqual(jasmine.objectContaining({ reason: "request_context_changed" }));
  }));

  it("does not abort a tenant mutation when selecting the already selected workspace", fakeAsync(() => {
    const operation = start("patch", "/api/v1/links/7");
    const bootstrap = http.expectOne("/api/v1/csrf");
    workspaces.select(10);
    cookie = "uvh_csrf=A";
    bootstrap.flush({ csrfToken: "A" });
    flushMicrotasks();
    const write = http.expectOne("/api/v1/links/7");
    expect(write.request.headers.get("X-Workspace-Id")).toBe("10");
    write.flush({ ok: true });
    flushMicrotasks();
    expect(operation.failure).toBeUndefined();
  }));

  for (const flow of ["login", "verifyMfa", "recoverMfa"] as const) {
    it(`allows the real public ${flow} transition with its own generation and decoded user`, fakeAsync(() => {
      auth.user.set(null);
      let failure: unknown;
      const pending = flow === "login" ? auth.login("user2@example.test", "fixture-password", "fixture-captcha")
        : auth[flow]("fixture-challenge", "123456");
      void pending.catch((error: unknown) => { failure = error; });
      const bootstrap = http.expectOne("/api/v1/csrf");
      cookie = "uvh_csrf=new";
      bootstrap.flush({ csrfToken: "new" });
      flushMicrotasks();
      const path = flow === "login" ? "/api/v1/auth/login" : flow === "verifyMfa" ? "/api/v1/auth/mfa/verify" : "/api/v1/auth/mfa/recovery";
      const write = http.expectOne(path);
      expect(write.request.headers.has("X-Workspace-Id")).toBeFalse();
      write.flush({ user: account(2) });
      flushMicrotasks();
      http.expectOne("/api/v1/workspaces").flush({ workspaces: [] });
      flushMicrotasks();
      expect(failure).toBeUndefined();
      expect(auth.user()?.id).toBe(2);
      expect(auth.authenticated()).toBeTrue();
    }));
  }

  it("allows anonymous registration and its generic decoded response", fakeAsync(() => {
    auth.user.set(null);
    let failure: unknown;
    void auth.register("User", "user@example.test", "fixture-password", {
      captchaToken: "fixture-captcha", acceptTerms: true, termsVersion: "v1", privacyVersion: "v1",
    }).catch((error: unknown) => { failure = error; });
    cookie = "uvh_csrf=anonymous";
    http.expectOne("/api/v1/csrf").flush({ csrfToken: "anonymous" });
    flushMicrotasks();
    http.expectOne("/api/v1/auth/register").flush({ user: null });
    flushMicrotasks();
    expect(failure).toBeUndefined();
    expect(auth.user()).toBeNull();
  }));

  it("allows a public bearer action independently of workspace changes", fakeAsync(() => {
    auth.user.set(null);
    const operation = start("post", "/api/v1/auth/reset-password");
    const bootstrap = http.expectOne("/api/v1/csrf");
    workspaces.select(20);
    cookie = "uvh_csrf=anonymous";
    bootstrap.flush({ csrfToken: "anonymous" });
    flushMicrotasks();
    const write = http.expectOne("/api/v1/auth/reset-password");
    expect(write.request.headers.has("X-Workspace-Id")).toBeFalse();
    write.flush({ ok: true });
    flushMicrotasks();
    expect(operation.failure).toBeUndefined();
  }));

  it("releases a live inbox after a logout failure even when the user signal never changed", fakeAsync(() => {
    cookie = "uvh_csrf=A";
    const component = TestBed.runInInjectionContext(() => new NotificationsComponent());
    const old = http.expectOne("/api/v1/notifications");
    TestBed.tick();
    let failure: unknown;
    void auth.logout().catch((error: unknown) => { failure = error; });
    flushMicrotasks();
    http.expectOne("/api/v1/auth/logout").flush({ error: "Temporarily unavailable" }, { status: 503, statusText: "Unavailable" });
    flushMicrotasks();
    TestBed.tick();
    if (!old.cancelled) old.flush(page);
    const replacements = http.match("/api/v1/notifications");
    expect(replacements.length).toBe(1);
    for (const read of replacements) read.flush(page);
    flushMicrotasks();
    expect(auth.user()?.id).toBe(1);
    expect(failure).toEqual(jasmine.objectContaining({ status: 503 }));
    expect(component.loading()).toBeFalse();
    expect(component.busy()).toBeFalse();
  }));
});
