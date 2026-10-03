import { TestBed, fakeAsync, flushMicrotasks } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from "@angular/common/http/testing";
import { Router } from "@angular/router";
import type { AuthUser, Workspace } from "../models";
import { apiInterceptor } from "../interceptors/api.interceptor";
import { AuthOperationSupersededError, AuthService } from "./auth.service";
import { ApiService } from "./api.service";
import { WorkspaceService } from "./workspace.service";

const account = (id: number, name = `User ${id}`): AuthUser => ({ id, name, email: `user${id}@example.test`, isAdmin: false, emailVerified: true, mfaEnabled: false });
const workspace = (id: number): Workspace => ({ id, name: `Workspace ${id}`, slug: `workspace-${id}`, role: "owner", createdAt: "2026-10-03T00:00:00Z" });

describe("Observed auth identity and ownership of pending responses", () => {
  let auth: AuthService;
  let workspaces: WorkspaceService;
  let http: HttpTestingController;

  beforeEach(() => {
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(),
      { provide: Router, useValue: { navigateByUrl: jasmine.createSpy("navigateByUrl").and.resolveTo(true) } },
    ] });
    auth = TestBed.inject(AuthService);
    workspaces = TestBed.inject(WorkspaceService);
    http = TestBed.inject(HttpTestingController);
    auth.user.set(account(1));
    workspaces.setList([workspace(10)]);
  });
  afterEach(() => http.verify());

  function observe<T>(promise: Promise<T>) {
    const outcome = { value: undefined as T | undefined, error: undefined as unknown };
    void promise.then((value) => { outcome.value = value; }, (error: unknown) => { outcome.error = error; });
    return outcome;
  }
  function settleOld(read: TestRequest, user: AuthUser): void {
    if (!read.cancelled) read.flush({ user });
    flushMicrotasks();
  }
  function finishWorkspaceReads(id = 20): void {
    for (const read of http.match("/api/v1/workspaces")) {
      if (!read.cancelled) read.flush({ workspaces: [workspace(id)] });
    }
    flushMicrotasks();
  }
  function observeReplacement(): void {
    observe(auth.me());
    http.expectOne("/api/v1/auth/me").flush({ user: account(2) });
    flushMicrotasks();
    finishWorkspaceReads();
  }

  it("keeps the newer /me response when an older one arrives last", fakeAsync(() => {
    const old = observe(auth.me());
    const read = http.expectOne("/api/v1/auth/me");
    const current = observe(auth.me());
    http.expectOne("/api/v1/auth/me").flush({ user: account(1, "Fresh") });
    flushMicrotasks();
    settleOld(read, account(1, "Old"));
    expect(auth.user()?.name).toBe("Fresh");
    expect(current.value?.name).toBe("Fresh");
    expect(old.error).toEqual(jasmine.any(AuthOperationSupersededError));
  }));

  it("cancels an obsolete identity probe before its 401 can invalidate the newer identity", fakeAsync(() => {
    const old = observe(auth.me());
    const read = http.expectOne("/api/v1/auth/me");
    observe(auth.me());
    http.expectOne("/api/v1/auth/me").flush({ user: account(1, "Fresh") });
    flushMicrotasks();
    expect(read.cancelled).toBeTrue();
    if (!read.cancelled) read.flush({ error: "No autenticado" }, { status: 401, statusText: "Unauthorized" });
    flushMicrotasks();
    expect(auth.user()?.name).toBe("Fresh");
    expect(auth.sessionInvalidated()).toBeFalse();
    expect(old.error).toEqual(jasmine.any(AuthOperationSupersededError));
  }));

  for (const flow of ["profile", "request-email", "cancel-email"] as const) {
    it(`rejects a delayed ${flow} DTO from A after /me observes B`, fakeAsync(() => {
      const promise = flow === "profile" ? auth.updateProfile("Changed A")
        : flow === "request-email" ? auth.requestEmailChange("next@example.test", "fixture")
          : auth.cancelEmailChange("fixture");
      const old = observe(promise);
      flushMicrotasks();
      const path = flow === "profile" ? "/api/v1/auth/profile" : flow === "request-email" ? "/api/v1/auth/change-email" : "/api/v1/auth/change-email/cancel";
      const write = http.expectOne(path);
      const generation = auth.sessionGeneration();
      observeReplacement();
      expect(auth.sessionGeneration()).toBeGreaterThan(generation);
      write.flush({ user: account(1, "Changed A") });
      flushMicrotasks();
      expect(old.error).toEqual(jasmine.any(AuthOperationSupersededError));
      expect(auth.user()?.id).toBe(2);
      expect(workspaces.list().map((entry) => entry.id)).toEqual([20]);
    }));
  }

  for (const flow of ["profile", "request-email", "cancel-email"] as const) {
    it(`keeps a confirmed same-account ${flow} DTO against an earlier /me snapshot`, fakeAsync(() => {
      const old = observe(auth.me());
      const read = http.expectOne("/api/v1/auth/me");
      const promise = flow === "profile" ? auth.updateProfile("Confirmed")
        : flow === "request-email" ? auth.requestEmailChange("next@example.test", "fixture")
          : auth.cancelEmailChange("fixture");
      const writeResult = observe(promise);
      flushMicrotasks();
      const path = flow === "profile" ? "/api/v1/auth/profile" : flow === "request-email" ? "/api/v1/auth/change-email" : "/api/v1/auth/change-email/cancel";
      http.expectOne(path).flush({ user: account(1, "Confirmed") });
      flushMicrotasks();
      settleOld(read, account(1, "Before write"));
      expect(writeResult.value?.name).toBe("Confirmed");
      expect(auth.user()?.name).toBe("Confirmed");
      expect(old.error).toEqual(jasmine.any(AuthOperationSupersededError));
    }));
  }

  it("does not let obsolete init erase /me identity or leave startup unsettled", fakeAsync(() => {
    observe(auth.init());
    const read = http.expectOne("/api/v1/auth/me");
    observeReplacement();
    settleOld(read, account(1));
    finishWorkspaceReads();
    expect(auth.user()?.id).toBe(2);
    expect(auth.loaded()).toBeTrue();
    expect(auth.probeSettled()).toBeTrue();
    expect(workspaces.currentId()).toBe(20);
  }));

  it("clears the old workspace and role immediately on observed replacement", fakeAsync(() => {
    observe(auth.me());
    http.expectOne("/api/v1/auth/me").flush({ user: account(2) });
    flushMicrotasks();
    expect(workspaces.list()).toEqual([]);
    expect(workspaces.currentId()).toBeNull();
    expect(workspaces.currentRole()).toBeNull();
    finishWorkspaceReads();
    expect(workspaces.currentId()).toBe(20);
  }));

  it("does not allow an old workspace result to repopulate the new account", fakeAsync(() => {
    observe(auth.refreshWorkspaces());
    const old = http.expectOne("/api/v1/workspaces");
    observeReplacement();
    old.flush({ workspaces: [workspace(10)] });
    flushMicrotasks();
    expect(workspaces.list().map((entry) => entry.id)).toEqual([20]);
  }));

  it("preserves same-account generation, workspace and pending valid command", fakeAsync(() => {
    const generation = auth.sessionGeneration();
    const command = observe(auth.changePassword("current", "next"));
    flushMicrotasks();
    const write = http.expectOne("/api/v1/auth/change-password");
    const read = observe(auth.me());
    http.expectOne("/api/v1/auth/me").flush({ user: account(1, "Refreshed") });
    flushMicrotasks();
    write.flush({ ok: true });
    flushMicrotasks();
    expect(command.error).toBeUndefined();
    expect(read.value?.id).toBe(1);
    expect(auth.sessionGeneration()).toBe(generation);
    expect(workspaces.currentId()).toBe(10);
  }));

  it("initializes an anonymous root and keeps its own workspace response", fakeAsync(() => {
    auth.user.set(null);
    workspaces.setList([]);
    const init = observe(auth.init());
    http.expectOne("/api/v1/auth/me").flush({ user: account(2) });
    flushMicrotasks();
    expect(auth.loaded()).toBeTrue();
    expect(auth.probeSettled()).toBeTrue();
    finishWorkspaceReads();
    expect(init.error).toBeUndefined();
    expect(auth.user()?.id).toBe(2);
    expect(workspaces.currentId()).toBe(20);
  }));
  it("guards a decoded response already queued before read cancellation", fakeAsync(() => {
    const old = observe(auth.me());
    http.expectOne("/api/v1/auth/me").flush({ user: account(1, "Queued old") });
    const current = observe(auth.me());
    http.expectOne("/api/v1/auth/me").flush({ user: account(1, "Current") });
    flushMicrotasks();
    expect(old.error).toEqual(jasmine.any(AuthOperationSupersededError));
    expect(current.value?.name).toBe("Current");
    expect(auth.user()?.name).toBe("Current");
  }));

  it("cancels a pre-write probe before its 401 erases a confirmed profile", fakeAsync(() => {
    const old = observe(auth.me());
    const read = http.expectOne("/api/v1/auth/me");
    const write = observe(auth.updateProfile("Confirmed"));
    flushMicrotasks();
    http.expectOne("/api/v1/auth/profile").flush({ user: account(1, "Confirmed") });
    flushMicrotasks();
    expect(read.cancelled).toBeTrue();
    if (!read.cancelled) read.flush({ error: "No autenticado" }, { status: 401, statusText: "Unauthorized" });
    flushMicrotasks();
    expect(auth.user()?.name).toBe("Confirmed");
    expect(write.error).toBeUndefined();
    expect(old.error).toEqual(jasmine.any(AuthOperationSupersededError));
  }));

  for (const flow of ["password", "logout"] as const) {
    it(`does not publish an old ${flow} acknowledgement after observed replacement`, fakeAsync(() => {
      const old = observe(flow === "logout" ? auth.logout() : auth.changePassword("current", "next"));
      flushMicrotasks();
      const path = flow === "logout" ? "/api/v1/auth/logout" : "/api/v1/auth/change-password";
      const write = http.expectOne(path);
      observeReplacement();
      write.flush({ ok: true });
      flushMicrotasks();
      expect(old.error).toEqual(jasmine.any(AuthOperationSupersededError));
      expect(auth.user()?.id).toBe(2);
      expect(auth.sessionInvalidated()).toBeFalse();
    }));
  }

  it("releases the identity read and native storage listener with its injector", fakeAsync(() => {
    const old = observe(auth.me());
    const read = http.expectOne("/api/v1/auth/me");
    TestBed.resetTestingModule();
    expect(read.cancelled).toBeTrue();
    window.dispatchEvent(new StorageEvent("storage", { key: "uvh.auth.invalidated", newValue: "fixture" }));
    flushMicrotasks();
    expect(old.error).toEqual(jasmine.any(AuthOperationSupersededError));
    expect(auth.user()?.id).toBe(1);
    expect(auth.sessionInvalidated()).toBeFalse();
  }));

  for (const flow of ["me", "init"] as const) {
    it(`does not resurrect identity if invalidation is queued between decoded ${flow} and publication`, fakeAsync(() => {
      const api = TestBed.inject(ApiService);
      const original = api.get.bind(api);
      spyOn(api, "get").and.callFake(((...args: Parameters<typeof api.get>) => {
        const response = original(...args);
        // Independent session invalidation at the decoded HTTP boundary: the
        // nested async reader can resolve before its caller resumes publication.
        if (args[0] === "/api/v1/auth/me") void response.then(() => queueMicrotask(() => auth.accountSignedOut()));
        return response;
      }) as typeof api.get);
      const outcome = observe<AuthUser | void>(flow === "me" ? auth.me() : auth.init());
      http.expectOne("/api/v1/auth/me").flush({ user: account(1) });
      flushMicrotasks();
      finishWorkspaceReads(10);
      expect(auth.user()).toBeNull();
      expect(workspaces.list()).toEqual([]);
      expect(auth.loaded()).toBeTrue();
      if (flow === "me") expect(outcome.error).toEqual(jasmine.any(AuthOperationSupersededError));
      else expect(outcome.error).toBeUndefined();
    }));
  }

  for (const status of [401, 503]) {
    it(`settles startup if a newer /me supersedes init and then returns ${status}`, fakeAsync(() => {
      auth.user.set(null);
      workspaces.setList([]);
      observe(auth.init());
      const old = http.expectOne("/api/v1/auth/me");
      const probe = observe(auth.me());
      http.expectOne("/api/v1/auth/me").flush({ error: "Fixture probe failure" }, { status, statusText: "Rejected" });
      flushMicrotasks();
      expect(old.cancelled).toBeTrue();
      expect(probe.error).toEqual(jasmine.objectContaining({ status }));
      expect(auth.probeSettled()).toBeTrue();
      expect(auth.loaded()).toBe(status === 401);
      expect(auth.user()).toBeNull();
    }));
  }
  it("settles startup after explicit local signout supersedes its pending probe", fakeAsync(() => {
    auth.user.set(null);
    observe(auth.init());
    const old = http.expectOne("/api/v1/auth/me");
    auth.accountSignedOut();
    flushMicrotasks();
    expect(old.cancelled).toBeTrue();
    expect(auth.probeSettled()).toBeTrue();
    expect(auth.loaded()).toBeTrue();
    expect(auth.user()).toBeNull();
  }));

});
