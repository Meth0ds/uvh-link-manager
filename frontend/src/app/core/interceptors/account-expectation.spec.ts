import { TestBed, fakeAsync, flushMicrotasks } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import type { AuthUser } from "../models";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";
import { WorkspaceService } from "../services/workspace.service";
import { apiInterceptor } from "./api.interceptor";

const account = (id: number): AuthUser => ({ id, name: `User ${id}`, email: `user${id}@example.test`, isAdmin: false, emailVerified: true, mfaEnabled: false });

describe("Cookie account expectation", () => {
  let auth: AuthService;
  let api: ApiService;
  let http: HttpTestingController;
  beforeEach(() => {
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    TestBed.configureTestingModule({ providers: [provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting()] });
    auth = TestBed.inject(AuthService);
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
    auth.user.set(account(1));
  });
  afterEach(() => http.verify());

  for (const path of ["/api/v1/auth/me", "/api/v1/auth/logout", "/api/v1/notifications/read-all", "/api/v1/workspaces", "/api/v1/links", "/api/v1/admin/overview"]) {
    it(`binds ${path} to the displayed account`, fakeAsync(() => {
      void api.get(path);
      const read = http.expectOne(path);
      expect(read.request.headers.get("X-Uvh-Account-Id")).toBe("1");
      read.flush({ ok: true });
      flushMicrotasks();
    }));
  }
  for (const path of ["/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/verify-email", "/api/v1/auth/reset-password", "/api/v1/public/links", "/api/v1/analytics/public/overview"]) {
    it(`leaves public authority independent at ${path}`, fakeAsync(() => {
      void api.get(path);
      const read = http.expectOne(path);
      expect(read.request.headers.has("X-Uvh-Account-Id")).toBeFalse();
      read.flush({ ok: true });
      flushMicrotasks();
    }));
  }
  it("lets an anonymous startup probe discover the cookie owner", fakeAsync(() => {
    auth.user.set(null);
    void api.get("/api/v1/auth/me");
    const read = http.expectOne("/api/v1/auth/me");
    expect(read.request.headers.has("X-Uvh-Account-Id")).toBeFalse();
    read.flush({ user: account(2) });
    flushMicrotasks();
  }));
  it("clears only the old local projection on a server account conflict", fakeAsync(() => {
    const announcement = spyOn(localStorage, "setItem").and.stub();
    TestBed.inject(WorkspaceService).select(10);
    announcement.calls.reset();
    let failure: unknown;
    void api.post("/api/v1/notifications/read-all").catch((error: unknown) => { failure = error; });
    flushMicrotasks();
    http.expectOne("/api/v1/notifications/read-all").flush({ error: "Session changed", reason: "session_context_changed" }, { status: 409, statusText: "Conflict" });
    flushMicrotasks();
    expect(auth.user()).toBeNull();
    expect(auth.sessionInvalidated()).toBeTrue();
    expect(TestBed.inject(WorkspaceService).currentId()).toBeNull();
    expect(failure).toEqual(jasmine.objectContaining({ status: 409, reason: "session_context_changed" }));
    expect(announcement).not.toHaveBeenCalled();
    http.expectNone("/api/v1/auth/logout");
    http.expectNone("/api/v1/csrf");
  }));
  it("does not clear a newer login after a delayed old conflict", fakeAsync(() => {
    void api.get("/api/v1/notifications").catch(() => undefined);
    const old = http.expectOne("/api/v1/notifications");
    auth.accountSignedOut();
    auth.user.set(account(2));
    old.flush({ reason: "session_context_changed" }, { status: 409, statusText: "Conflict" });
    flushMicrotasks();
    expect(auth.user()?.id).toBe(2);
    expect(auth.sessionInvalidated()).toBeFalse();
  }));
  for (const reason of ["other_conflict", undefined]) {
    it(`does not clear the account for an unrelated 409 (${reason ?? "missing reason"})`, fakeAsync(() => {
      void api.get("/api/v1/notifications").catch(() => undefined);
      http.expectOne("/api/v1/notifications").flush({ reason }, { status: 409, statusText: "Conflict" });
      flushMicrotasks();
      expect(auth.user()?.id).toBe(1);
      expect(auth.sessionInvalidated()).toBeFalse();
    }));
  }
  it("does not treat a public action conflict as cookie authority", fakeAsync(() => {
    void api.post("/api/v1/auth/reset-password").catch(() => undefined);
    flushMicrotasks();
    http.expectOne("/api/v1/auth/reset-password").flush({ reason: "session_context_changed" }, { status: 409, statusText: "Conflict" });
    flushMicrotasks();
    expect(auth.user()?.id).toBe(1);
  }));
  it("recognizes the session conflict envelope for a private blob download", async () => {
    const outcome = api.postBlob("/api/v1/auth/data-export/download").catch((error: unknown) => error);
    await Promise.resolve();
    http.expectOne("/api/v1/auth/data-export/download").flush(new Blob(['{"reason":"session_context_changed"}'], { type: "application/json" }), { status: 409, statusText: "Conflict" });
    await outcome;
    expect(auth.user()).toBeNull();
    expect(auth.sessionInvalidated()).toBeTrue();
  });
  it("does not clear a newer account while a conflict Blob is decoding", async () => {
    const outcome = api.postBlob("/api/v1/auth/data-export/download").catch((error: unknown) => error);
    await Promise.resolve();
    http.expectOne("/api/v1/auth/data-export/download").flush(new Blob(['{"reason":"session_context_changed"}'], { type: "application/json" }), { status: 409, statusText: "Conflict" });
    auth.accountSignedOut();
    auth.user.set(account(2));
    await outcome;
    expect(auth.user()?.id).toBe(2);
    expect(auth.sessionInvalidated()).toBeFalse();
  });

  for (const [description, body] of [
    ["invalid JSON", "<html>fixture proxy error</html>"],
    ["oversized JSON", JSON.stringify({ reason: "session_context_changed", padding: "x".repeat(4_096) })],
    ["unrelated conflict", JSON.stringify({ reason: "other_conflict" })],
  ]) {
    it(`preserves the account for a Blob with ${description}`, async () => {
      const outcome = api.postBlob("/api/v1/auth/data-export/download").catch((error: unknown) => error);
      await Promise.resolve();
      http.expectOne("/api/v1/auth/data-export/download").flush(new Blob([body], { type: "application/json" }), { status: 409, statusText: "Conflict" });
      await outcome;
      expect(auth.user()?.id).toBe(1);
      expect(auth.sessionInvalidated()).toBeFalse();
    });
  }

});
