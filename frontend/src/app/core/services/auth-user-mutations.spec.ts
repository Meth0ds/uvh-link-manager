import { TestBed, fakeAsync, flushMicrotasks } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { Router } from "@angular/router";
import type { AuthUser } from "../models";
import { apiInterceptor } from "../interceptors/api.interceptor";
import { AuthOperationSupersededError, AuthService } from "./auth.service";
import { ApiRequestError } from "./api.service";

const account = (changes: Partial<AuthUser> = {}): AuthUser => ({
  id: 1, email: "user@example.test", name: "Before", isAdmin: false, emailVerified: true,
  mfaEnabled: false, recoveryCodesRemaining: 0, pendingEmail: null, pendingEmailExpiresAt: null, ...changes,
});
const pendingEmail = { pendingEmail: "next@example.test", pendingEmailExpiresAt: "2026-10-03T12:00:00Z" };

describe("Same-account User DTO mutation reconciliation", () => {
  let auth: AuthService;
  let http: HttpTestingController;
  beforeEach(() => {
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(),
      { provide: Router, useValue: { navigateByUrl: jasmine.createSpy("navigateByUrl").and.resolveTo(true) } },
    ] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    auth.user.set(account());
  });
  afterEach(() => http.verify());

  function observe<T>(promise: Promise<T>) {
    const result = { value: undefined as T | undefined, error: undefined as unknown };
    void promise.then((value) => { result.value = value; }, (error: unknown) => { result.error = error; });
    return result;
  }
  function reconcileIfRequested(user: AuthUser): void {
    for (const request of http.match("/api/v1/auth/me")) {
      if (!request.cancelled) request.flush({ user });
    }
    flushMicrotasks();
  }

  for (const mode of ["request", "cancel"] as const) {
    for (const oldResponse of ["profile", "email"] as const) {
      it(`preserves both commits when an older ${oldResponse} DTO arrives after ${mode} email/profile`, fakeAsync(() => {
        if (mode === "cancel") auth.user.set(account(pendingEmail));
        const profile = observe(auth.updateProfile("After"));
        const email = observe(mode === "request" ? auth.requestEmailChange("next@example.test", "fixture") : auth.cancelEmailChange("fixture"));
        flushMicrotasks();
        const profileRequest = http.expectOne("/api/v1/auth/profile");
        const emailRequest = http.expectOne(mode === "request" ? "/api/v1/auth/change-email" : "/api/v1/auth/change-email/cancel");
        // These snapshots follow commit order, independently of HTTP start order.
        // Capture the first commit's DTO, then delay its delivery until after the second.
        const final = account({ name: "After", ...(mode === "request" ? pendingEmail : {}) });
        if (oldResponse === "profile") {
          emailRequest.flush({ user: final });
          flushMicrotasks();
          profileRequest.flush({ user: account({ name: "After", ...(mode === "cancel" ? pendingEmail : {}) }) });
        } else {
          profileRequest.flush({ user: final });
          flushMicrotasks();
          emailRequest.flush({ user: account(mode === "request" ? pendingEmail : {}) });
        }
        flushMicrotasks();
        reconcileIfRequested(final);
        expect(auth.user()).toEqual(final);
        expect(profile.error).toBeUndefined();
        expect(email.error).toBeUndefined();
        expect(profile.value).toBeDefined();
        expect(email.value).toBeDefined();
      }));
    }
  }

  it("does not downgrade freshly observed MFA flags with a delayed profile snapshot", fakeAsync(() => {
    const profile = observe(auth.updateProfile("After"));
    flushMicrotasks();
    const request = http.expectOne("/api/v1/auth/profile");
    observe(auth.me());
    const final = account({ name: "After", mfaEnabled: true, recoveryCodesRemaining: 7 });
    http.expectOne("/api/v1/auth/me").flush({ user: final });
    flushMicrotasks();
    request.flush({ user: account({ name: "After" }) });
    flushMicrotasks();
    reconcileIfRequested(final);
    expect(auth.user()).toEqual(final);
    expect(profile.error).toBeUndefined();
  }));

  it("does not cancel a post-MFA refresh in favour of an older profile commit awaiting delivery", fakeAsync(() => {
    const profile = observe(auth.updateProfile("After"));
    flushMicrotasks();
    const command = http.expectOne("/api/v1/auth/profile");
    // Profile has committed and captured its DTO. MFA then commits, and its
    // caller begins /me before the delayed profile acknowledgement arrives.
    const mfaRefresh = observe(auth.refreshUser());
    const afterMfa = http.expectOne("/api/v1/auth/me");
    command.flush({ user: account({ name: "After" }) });
    flushMicrotasks();
    const final = account({ name: "After", mfaEnabled: true, recoveryCodesRemaining: 8 });
    if (!afterMfa.cancelled) afterMfa.flush({ user: final });
    flushMicrotasks();
    reconcileIfRequested(final);
    expect(auth.user()).toEqual(final);
    expect(profile.error).toBeUndefined();
    // An obsolete read may be superseded; the confirmed MFA never replays.
    expect(mfaRefresh.error === undefined || mfaRefresh.error instanceof AuthOperationSupersededError).toBeTrue();
  }));

  it("keeps a confirmed email request when the overlapping profile fails", fakeAsync(() => {
    const email = observe(auth.requestEmailChange("next@example.test", "fixture"));
    const profile = observe(auth.updateProfile("Invalid"));
    flushMicrotasks();
    http.expectOne("/api/v1/auth/change-email").flush({ user: account(pendingEmail) });
    flushMicrotasks();
    http.expectOne("/api/v1/auth/profile").flush({ error: "Nombre inválido" }, { status: 422, statusText: "Unprocessable Entity" });
    flushMicrotasks();
    reconcileIfRequested(account(pendingEmail));
    expect(auth.user()?.pendingEmail).toBe(pendingEmail.pendingEmail);
    expect(email.error).toBeUndefined();
    expect(profile.error).toBeDefined();
  }));

  it("waits for all overlapping commands and publishes one authoritative read atomically", fakeAsync(() => {
    const profile = observe(auth.updateProfile("After"));
    const email = observe(auth.requestEmailChange("next@example.test", "fixture"));
    flushMicrotasks();
    const write = http.expectOne("/api/v1/auth/profile");
    http.expectOne("/api/v1/auth/change-email").flush({ user: account(pendingEmail) });
    flushMicrotasks();
    http.expectNone("/api/v1/auth/me");
    expect(email.value).toBeUndefined();
    expect(auth.user()).toEqual(account());
    write.flush({ user: account({ name: "After" }) });
    flushMicrotasks();
    const final = account({ name: "After", ...pendingEmail });
    const read = http.expectOne("/api/v1/auth/me");
    expect(auth.userRefreshRequired()).toBeTrue();
    read.flush({ user: final });
    flushMicrotasks();
    expect(auth.user()).toEqual(final);
    expect(auth.userRefreshRequired()).toBeFalse();
    expect(profile.value).toBeDefined();
    expect(email.value).toBeDefined();
    http.expectNone((request) => request.method !== "GET");
  }));

  for (const failure of ["http", "malformed"] as const) {
    it(`does not turn successful commands into failures when the final read is ${failure}`, fakeAsync(() => {
      const profile = observe(auth.updateProfile("After"));
      const email = observe(auth.requestEmailChange("next@example.test", "fixture"));
      flushMicrotasks();
      http.expectOne("/api/v1/auth/profile").flush({ user: account({ name: "After" }) });
      http.expectOne("/api/v1/auth/change-email").flush({ user: account({ name: "After", ...pendingEmail }) });
      flushMicrotasks();
      const read = http.expectOne("/api/v1/auth/me");
      if (failure === "http") read.flush({ error: "Unavailable" }, { status: 503, statusText: "Unavailable" });
      else read.flush({ user: { id: 1, name: "Incomplete" } });
      flushMicrotasks();
      expect(profile.error).toBeUndefined();
      expect(email.error).toBeUndefined();
      expect(profile.value).toBeDefined();
      expect(email.value).toBeDefined();
      expect(auth.userRefreshRequired()).toBeTrue();
      expect(auth.user()).toEqual(account());
      observe(auth.refreshUser());
      http.expectOne("/api/v1/auth/me").flush({ user: account({ name: "After", ...pendingEmail }) });
      flushMicrotasks();
      expect(auth.userRefreshRequired()).toBeFalse();
      expect(auth.user()?.pendingEmail).toBe(pendingEmail.pendingEmail);
      http.expectNone((request) => request.method !== "GET");
    }));
  }

  it("uses server commit order for two writes of the same field", fakeAsync(() => {
    const firstStarted = observe(auth.updateProfile("First started, last committed"));
    const secondStarted = observe(auth.updateProfile("Second started, first committed"));
    flushMicrotasks();
    const writes = http.match("/api/v1/auth/profile");
    expect(writes.length).toBe(2);
    // Second-started command commits first; first-started command commits last.
    writes[0].flush({ user: account({ name: "First started, last committed" }) });
    flushMicrotasks();
    writes[1].flush({ user: account({ name: "Second started, first committed" }) });
    flushMicrotasks();
    http.expectOne("/api/v1/auth/me").flush({ user: account({ name: "First started, last committed" }) });
    flushMicrotasks();
    expect(auth.user()?.name).toBe("First started, last committed");
    expect(firstStarted.error).toBeUndefined();
    expect(secondStarted.error).toBeUndefined();
  }));

  it("does not perform a success refresh when both commands fail", fakeAsync(() => {
    const profile = observe(auth.updateProfile("Invalid"));
    const email = observe(auth.cancelEmailChange("wrong"));
    flushMicrotasks();
    http.expectOne("/api/v1/auth/profile").flush({ error: "Invalid" }, { status: 422, statusText: "Invalid" });
    http.expectOne("/api/v1/auth/change-email/cancel").flush({ error: "Wrong password" }, { status: 403, statusText: "Forbidden" });
    flushMicrotasks();
    http.expectNone("/api/v1/auth/me");
    expect(profile.error).toEqual(jasmine.any(ApiRequestError));
    expect(email.error).toEqual(jasmine.any(ApiRequestError));
    expect(auth.userRefreshRequired()).toBeFalse();
    expect(auth.user()).toEqual(account());
  }));

  it("reconciles a confirmed sibling when another command returns an undecodable acknowledgement", fakeAsync(() => {
    const email = observe(auth.requestEmailChange("next@example.test", "fixture"));
    const profile = observe(auth.updateProfile("After"));
    flushMicrotasks();
    http.expectOne("/api/v1/auth/change-email").flush({ user: account(pendingEmail) });
    http.expectOne("/api/v1/auth/profile").flush({ user: { id: 1 } });
    flushMicrotasks();
    http.expectOne("/api/v1/auth/me").flush({ user: account({ name: "After", ...pendingEmail }) });
    flushMicrotasks();
    expect(email.error).toBeUndefined();
    expect(profile.error).toEqual(jasmine.any(ApiRequestError));
    expect(auth.user()?.name).toBe("After");
    expect(auth.user()?.pendingEmail).toBe(pendingEmail.pendingEmail);
  }));

  it("does not refresh or resurrect a signed-out account when its remaining response arrives", fakeAsync(() => {
    const profile = observe(auth.updateProfile("After"));
    const email = observe(auth.cancelEmailChange("fixture"));
    flushMicrotasks();
    const write = http.expectOne("/api/v1/auth/profile");
    http.expectOne("/api/v1/auth/change-email/cancel").flush({ user: account() });
    flushMicrotasks();
    auth.accountSignedOut();
    write.flush({ user: account({ name: "After" }) });
    flushMicrotasks();
    expect(profile.error).toEqual(jasmine.any(AuthOperationSupersededError));
    expect(email.error).toEqual(jasmine.any(AuthOperationSupersededError));
    expect(auth.user()).toBeNull();
    expect(auth.userRefreshRequired()).toBeFalse();
    http.expectNone("/api/v1/auth/me");
  }));

  it("keeps the refresh notice if a replacement probe cancels reconciliation and then fails", fakeAsync(() => {
    observe(auth.updateProfile("After"));
    observe(auth.cancelEmailChange("fixture"));
    flushMicrotasks();
    http.expectOne("/api/v1/auth/profile").flush({ user: account({ name: "After" }) });
    http.expectOne("/api/v1/auth/change-email/cancel").flush({ user: account({ name: "After" }) });
    flushMicrotasks();
    const cancelled = http.expectOne("/api/v1/auth/me");
    const replacement = observe(auth.me());
    expect(cancelled.cancelled).toBeTrue();
    http.expectOne("/api/v1/auth/me").flush({ error: "Offline" }, { status: 503, statusText: "Offline" });
    flushMicrotasks();
    expect(replacement.error).toEqual(jasmine.any(ApiRequestError));
    expect(auth.userRefreshRequired()).toBeTrue();
    http.expectNone((request) => request.method !== "GET");
  }));

  it("keeps an isolated command on one HTTP round trip", fakeAsync(() => {
    const profile = observe(auth.updateProfile("After"));
    flushMicrotasks();
    http.expectOne("/api/v1/auth/profile").flush({ user: account({ name: "After" }) });
    flushMicrotasks();
    expect(auth.user()?.name).toBe("After");
    expect(profile.value?.name).toBe("After");
    expect(auth.userRefreshRequired()).toBeFalse();
    http.expectNone("/api/v1/auth/me");
  }));

  it("releases successful callers without publishing or refreshing after injector destruction", fakeAsync(() => {
    const profile = observe(auth.updateProfile("After"));
    const email = observe(auth.cancelEmailChange("fixture"));
    flushMicrotasks();
    const write = http.expectOne("/api/v1/auth/profile");
    http.expectOne("/api/v1/auth/change-email/cancel").flush({ user: account() });
    flushMicrotasks();
    TestBed.resetTestingModule();
    write.flush({ user: account({ name: "After" }) });
    flushMicrotasks();
    expect(profile.error).toEqual(jasmine.any(AuthOperationSupersededError));
    expect(email.error).toEqual(jasmine.any(AuthOperationSupersededError));
    expect(auth.user()).toEqual(account());
    http.expectNone("/api/v1/auth/me");
  }));
});
