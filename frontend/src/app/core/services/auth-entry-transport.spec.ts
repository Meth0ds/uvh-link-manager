import { TestBed, fakeAsync, flushMicrotasks } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from "@angular/common/http/testing";
import { Router } from "@angular/router";
import type { AuthUser, Workspace } from "../models";
import { apiInterceptor } from "../interceptors/api.interceptor";
import { ApiRequestError } from "./api.service";
import { AuthOperationSupersededError, AuthService, type LoginOutcome } from "./auth.service";
import { WorkspaceService } from "./workspace.service";

type Entry = "login" | "verify" | "recovery";
const challenge = "c".repeat(43);
const account = (id: number): AuthUser => ({ id, email: `account-${id}@example.test`, name: `Account ${id}`, isAdmin: true, emailVerified: true, mfaEnabled: true });
const workspace = (id: number): Workspace => ({ id, name: `Workspace ${id}`, slug: `workspace-${id}`, role: "owner", createdAt: "2026-10-04T00:00:00Z" });
const entryPath = (kind: Entry): string => kind === "login" ? "/api/v1/auth/login" : `/api/v1/auth/mfa/${kind}`;
const deadline = { verifiedAt: "2026-10-04T00:00:00Z", expiresAt: "2026-10-04T00:10:00Z" };

function observe<T>(promise: Promise<T>): { value?: T; error?: unknown } {
  const result: { value?: T; error?: unknown } = {};
  void promise.then((value) => { result.value = value; }, (error: unknown) => { result.error = error; });
  return result;
}

/** Consumer contracts through the facade, real API client and interceptors. */
describe("Auth entry and registration transport ownership", () => {
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
    // Initial fixture only; replacements below use an anonymous /me probe.
    auth.user.set(account(1));
    workspaces.setList([workspace(10)]);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  function request(path: string, session: boolean, method = "POST"): TestRequest {
    const pending = http.expectOne(path);
    expect(pending.request.method).toBe(method);
    expect(pending.request.withCredentials).toBeTrue();
    expect(pending.request.headers.has("X-Workspace-Id")).toBeFalse();
    expect(pending.request.headers.get("X-Uvh-Account-Id")).toBe(session ? "1" : null);
    if (method === "POST") expect(pending.request.headers.get("X-CSRF-Token")).toBe("fixture");
    return pending;
  }

  function finishWorkspaces(id: number): void {
    const pending = http.expectOne("/api/v1/workspaces");
    expect(pending.request.headers.get("X-Uvh-Account-Id")).toBe(String(id));
    pending.flush({ workspaces: [workspace(id * 10)] });
    flushMicrotasks();
  }

  function replaceIdentity(): void {
    // Discard the old account expectation first. A B cookie would correctly
    // reject an /me probe still carrying A's expected-account header.
    auth.sessionContextChanged(auth.sessionGeneration());
    const observed = observe(auth.me());
    const pending = http.expectOne("/api/v1/auth/me");
    expect(pending.request.headers.has("X-Uvh-Account-Id")).toBeFalse();
    pending.flush({ user: account(2) });
    flushMicrotasks();
    finishWorkspaces(2);
    expect(observed.error).toBeUndefined();
  }

  function enter(kind: Entry): Promise<LoginOutcome | void> {
    return kind === "login" ? auth.login("owner@example.test", "fixture-password", "captcha")
      : kind === "verify" ? auth.verifyMfa(challenge, "123456") : auth.recoverMfa(challenge, "ABCD-EFGH-JKLM-NPQR");
  }

  const registration = [
    { name: "register", path: "/api/v1/auth/register", success: { user: null },
      body: { name: "Owner", email: "owner@example.test", password: "fixture-password", captchaToken: "captcha", website: "", acceptTerms: true, termsVersion: "fixture-terms", privacyVersion: "fixture-privacy" },
      invoke: (service: AuthService) => service.register("Owner", "owner@example.test", "fixture-password", { captchaToken: "captcha", website: "", acceptTerms: true, termsVersion: "fixture-terms", privacyVersion: "fixture-privacy" }) },
    { name: "correct email", path: "/api/v1/auth/change-registration-email", success: { ok: true },
      body: { currentEmail: "old@example.test", newEmail: "new@example.test", captchaToken: "captcha", website: "" },
      invoke: (service: AuthService) => service.changeRegistrationEmail("old@example.test", "new@example.test", { captchaToken: "captcha", website: "" }) },
    { name: "resend", path: "/api/v1/auth/resend-verification", success: { ok: true },
      body: { email: "owner@example.test", captchaToken: "captcha" },
      invoke: (service: AuthService) => service.resendVerification("owner@example.test", "captcha") },
  ];

  for (const action of registration) {
    it(`keeps ${action.name} sessionless even with another local account and workspace`, fakeAsync(() => {
      const result = observe(action.invoke(auth));
      flushMicrotasks();
      const pending = request(action.path, false);
      expect(pending.request.body).toEqual(action.body);
      pending.flush(action.success);
      flushMicrotasks();
      expect(result.error).toBeUndefined();
      expect(auth.user()).toEqual(account(1));
      expect(auth.sessionGeneration()).toBe(0);
      expect(workspaces.currentId()).toBe(10);
      expect(localStorage.getItem("uvh.auth.invalidated")).toBeNull();
    }));

    it(`does not dispatch ${action.name} after identity changes during CSRF preparation`, fakeAsync(() => {
      cookie = "";
      const result = observe(action.invoke(auth));
      const csrf = http.expectOne("/api/v1/csrf");
      replaceIdentity();
      cookie = "uvh_csrf=fresh";
      csrf.flush({ csrfToken: "fresh" });
      flushMicrotasks();
      expect((result.error as ApiRequestError).reason).toBe("request_context_changed");
      http.expectNone(action.path);
      expect(auth.user()).toEqual(account(2));
      expect(workspaces.currentId()).toBe(20);
    }));
  }

  for (const kind of ["login", "verify", "recovery"] as const) {
    it(`publishes ${kind} identity only after its sessionless response is decoded`, fakeAsync(() => {
      const result = observe(enter(kind));
      expect(auth.sessionGeneration()).toBe(1);
      if (kind === "login") expect(auth.user()).toBeNull();
      flushMicrotasks();
      const pending = request(entryPath(kind), false);
      expect(pending.request.body).toEqual(kind === "login"
        ? { email: "owner@example.test", password: "fixture-password", captchaToken: "captcha" }
        : { challenge, code: kind === "verify" ? "123456" : "ABCD-EFGH-JKLM-NPQR" });
      pending.flush({ user: account(2) });
      flushMicrotasks();
      expect(auth.user()).toEqual(account(2));
      finishWorkspaces(2);
      expect(result.error).toBeUndefined();
      expect(auth.loaded()).toBeTrue();
      expect(auth.adminMfaReauthenticationRequired()).toBeFalse();
    }));

    it(`rejects malformed ${kind} identity before publication or workspace refresh`, fakeAsync(() => {
      const result = observe(enter(kind));
      const before = auth.user();
      flushMicrotasks();
      request(entryPath(kind), false).flush({ user: { ...account(2), isAdmin: "true" } });
      flushMicrotasks();
      expect((result.error as ApiRequestError).status).toBe(502);
      expect(auth.user()).toBe(before);
      http.expectNone("/api/v1/workspaces");
    }));

    for (const outcome of ["success", "401"] as const) {
      it(`preserves observed B when an old ${kind} returns ${outcome}`, fakeAsync(() => {
        const result = observe(enter(kind));
        flushMicrotasks();
        const pending = request(entryPath(kind), false);
        replaceIdentity();
        const generation = auth.sessionGeneration();
        if (outcome === "success") pending.flush({ user: account(3) });
        else pending.flush({ error: "Fixture refusal" }, { status: 401, statusText: "Unauthorized" });
        flushMicrotasks();
        if (outcome === "success") expect(result.error).toEqual(jasmine.any(AuthOperationSupersededError));
        else expect((result.error as ApiRequestError).status).toBe(401);
        expect(auth.user()).toEqual(account(2));
        expect(auth.sessionGeneration()).toBe(generation);
        expect(auth.sessionInvalidated()).toBeFalse();
        expect(workspaces.currentId()).toBe(20);
        http.expectNone("/api/v1/workspaces");
      }));
    }
  }

  it("returns a complete MFA challenge without publishing a user or refreshing workspaces", fakeAsync(() => {
    const result = observe(auth.login("owner@example.test", "fixture-password", "captcha"));
    flushMicrotasks();
    request(entryPath("login"), false).flush({ mfaRequired: true, challenge, recoveryAvailable: true });
    flushMicrotasks();
    expect(result.value).toEqual({ mfaRequired: true, challenge, recoveryAvailable: true });
    expect(auth.user()).toBeNull();
    expect(auth.loaded()).toBeTrue();
    expect(workspaces.list()).toEqual([]);
    http.expectNone("/api/v1/workspaces");
  }));

  it("keeps logout account-scoped and clears identity only after a valid acknowledgement", fakeAsync(() => {
    const result = observe(auth.logout());
    expect(auth.user()).toEqual(account(1));
    flushMicrotasks();
    const pending = request("/api/v1/auth/logout", true);
    expect(pending.request.body).toEqual({});
    pending.flush({ ok: true });
    flushMicrotasks();
    expect(result.error).toBeUndefined();
    expect(auth.user()).toBeNull();
    expect(workspaces.list()).toEqual([]);
    expect(localStorage.getItem("uvh.auth.invalidated")).not.toBeNull();
  }));

  for (const kind of ["status", "reauthenticate"] as const) {
    function invoke(): Promise<unknown> {
      return kind === "status" ? auth.mfaSessionStatus() : auth.reauthenticateMfa("fixture-password", "123456");
    }
    const path = kind === "status" ? "/api/v1/auth/mfa/session" : "/api/v1/auth/mfa/reauthenticate";
    const body = kind === "status" ? { enabled: true, fresh: true, ...deadline } : { ok: true, ...deadline };
    it(`keeps ${kind} scoped to the account and clears only its current step-up notice`, fakeAsync(() => {
      auth.requireAdminMfaReauthentication();
      const result = observe(invoke());
      flushMicrotasks();
      const pending = request(path, true, kind === "status" ? "GET" : "POST");
      if (kind === "reauthenticate") expect(pending.request.body).toEqual({ password: "fixture-password", factorCode: "123456" });
      pending.flush(body);
      flushMicrotasks();
      expect(result.error).toBeUndefined();
      expect(auth.adminMfaReauthenticationRequired()).toBeFalse();
      expect(auth.user()).toEqual(account(1));
      expect(workspaces.currentId()).toBe(10);
    }));

    it(`does not clear B's step-up notice after A's delayed ${kind} response`, fakeAsync(() => {
      const result = observe(invoke());
      flushMicrotasks();
      const pending = request(path, true, kind === "status" ? "GET" : "POST");
      replaceIdentity();
      auth.requireAdminMfaReauthentication();
      pending.flush(body);
      flushMicrotasks();
      expect(result.error).toEqual(jasmine.any(AuthOperationSupersededError));
      expect(auth.adminMfaReauthenticationRequired()).toBeTrue();
      expect(auth.user()).toEqual(account(2));
    }));
  }
});
