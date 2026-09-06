import { TestBed } from "@angular/core/testing";
import type { AuthUser, Workspace } from "../models";
import { ApiRequestError, ApiService } from "./api.service";
import { AuthOperationSupersededError, AuthService, type LoginOutcome } from "./auth.service";
import { WorkspaceService } from "./workspace.service";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function user(id: number): AuthUser {
  return {
    id,
    email: `user-${id}@example.test`,
    name: `User ${id}`,
    isAdmin: false,
    emailVerified: true,
    mfaEnabled: false,
  };
}

function workspace(id: number): Workspace {
  return { id, name: `Workspace ${id}`, slug: `workspace-${id}`, role: "owner", createdAt: "2026-09-05T00:00:00Z" };
}

describe("AuthService session generation", () => {
  let api: jasmine.SpyObj<ApiService>;
  let auth: AuthService;
  let workspaces: WorkspaceService;

  beforeEach(() => {
    localStorage.clear();
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "patch"]);
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    auth = TestBed.inject(AuthService);
    workspaces = TestBed.inject(WorkspaceService);
  });

  afterEach(() => localStorage.clear());

  it("allows init to retry after a transient transport failure", async () => {
    api.get.and.callFake(((path: string) => {
      if (path === "/api/v1/auth/me" && api.get.calls.count() === 1) {
        return Promise.reject(new ApiRequestError("Sin red", 0));
      }
      if (path === "/api/v1/auth/me") return Promise.resolve({ user: user(1) });
      return Promise.resolve({ workspaces: [workspace(10)] });
    }) as typeof api.get);

    await auth.init();
    expect(auth.loaded()).toBeFalse();

    await auth.init();
    expect(auth.loaded()).toBeTrue();
    expect(auth.user()?.id).toBe(1);
    expect(workspaces.currentId()).toBe(10);
  });

  it("does not let a late init resurrect a locally signed-out account", async () => {
    const me = deferred<{ user: AuthUser }>();
    api.get.and.returnValue(me.promise as never);

    const pending = auth.init();
    auth.accountSignedOut();
    me.resolve({ user: user(1) });
    await pending;

    expect(auth.user()).toBeNull();
    expect(auth.authenticated()).toBeFalse();
  });

  it("keeps the newer login when an older login fails later", async () => {
    const first = deferred<LoginOutcome>();
    const second = deferred<LoginOutcome>();
    api.post.and.returnValues(first.promise as never, second.promise as never);
    api.get.and.resolveTo({ workspaces: [workspace(20)] } as never);

    const older = auth.login("old@example.test", "password", "captcha");
    const newer = auth.login("new@example.test", "password", "captcha");
    second.resolve({ user: user(2) });
    await newer;
    first.reject(new ApiRequestError("Credenciales inválidas", 401));
    await expectAsync(older).toBeRejected();

    expect(auth.user()?.id).toBe(2);
    expect(workspaces.currentId()).toBe(20);
  });

  it("rejects an older successful login without overwriting the newer account", async () => {
    const first = deferred<LoginOutcome>();
    const second = deferred<LoginOutcome>();
    api.post.and.returnValues(first.promise as never, second.promise as never);
    api.get.and.resolveTo({ workspaces: [workspace(20)] } as never);

    const older = auth.login("old@example.test", "password", "captcha");
    const newer = auth.login("new@example.test", "password", "captcha");
    second.resolve({ user: user(2) });
    await newer;
    first.resolve({ user: user(1) });
    await expectAsync(older).toBeRejectedWith(jasmine.any(AuthOperationSupersededError));

    expect(auth.user()?.id).toBe(2);
  });

  it("does not let an old workspace failure erase a newer successful list", async () => {
    const first = deferred<{ workspaces: Workspace[] }>();
    const second = deferred<{ workspaces: Workspace[] }>();
    api.get.and.returnValues(first.promise as never, second.promise as never);

    const older = auth.refreshWorkspaces();
    const newer = auth.refreshWorkspaces();
    second.resolve({ workspaces: [workspace(30)] });
    await newer;
    first.reject(new ApiRequestError("Sin red", 0));
    await older;

    expect(workspaces.list().map((entry) => entry.id)).toEqual([30]);
  });

  it("does not let an old workspace success overwrite a newer successful list", async () => {
    const first = deferred<{ workspaces: Workspace[] }>();
    const second = deferred<{ workspaces: Workspace[] }>();
    api.get.and.returnValues(first.promise as never, second.promise as never);

    const older = auth.refreshWorkspaces();
    const newer = auth.refreshWorkspaces();
    second.resolve({ workspaces: [workspace(31)] });
    await newer;
    first.resolve({ workspaces: [workspace(30)] });
    await older;

    expect(workspaces.list().map((entry) => entry.id)).toEqual([31]);
  });

  it("ignores a stale 401 captured before a newer login", async () => {
    const login = deferred<LoginOutcome>();
    api.post.and.returnValue(login.promise as never);
    api.get.and.resolveTo({ workspaces: [workspace(40)] } as never);
    const oldGeneration = auth.sessionGeneration();

    const pending = auth.login("new@example.test", "password", "captcha");
    login.resolve({ user: user(4) });
    await pending;
    auth.sessionExpired(oldGeneration);

    expect(auth.user()?.id).toBe(4);
    expect(auth.sessionInvalidated()).toBeFalse();
  });

  it("does not let an older account confirmation sign out a newer login", async () => {
    const oldGeneration = auth.sessionGeneration();
    api.post.and.resolveTo({ user: user(6) } as never);
    api.get.and.resolveTo({ workspaces: [workspace(60)] } as never);

    await auth.login("new@example.test", "password", "captcha");
    const reconciled = auth.accountSignedOut(oldGeneration);

    expect(reconciled).toBeFalse();
    expect(auth.user()?.id).toBe(6);
    expect(auth.authenticated()).toBeTrue();
  });

  it("does not let a late profile response repopulate a signed-out account", async () => {
    const update = deferred<{ user: AuthUser }>();
    api.patch.and.returnValue(update.promise as never);
    auth.user.set(user(5));

    const pending = auth.updateProfile("Changed");
    auth.accountSignedOut();
    update.resolve({ user: { ...user(5), name: "Changed" } });
    await expectAsync(pending).toBeRejectedWith(jasmine.any(AuthOperationSupersededError));

    expect(auth.user()).toBeNull();
  });
});
