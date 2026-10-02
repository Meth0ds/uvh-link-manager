import { HttpClient } from "@angular/common/http";
import { TestBed } from "@angular/core/testing";
import { of, Subject } from "rxjs";
import { AuthOperationSupersededError, AuthService } from "./auth.service";
import { WorkspaceService } from "./workspace.service";

describe("account mutation confirmation contracts", () => {
  let http: jasmine.SpyObj<HttpClient>;
  let auth: AuthService;
  let workspaces: WorkspaceService;
  let announce: jasmine.Spy;

  const actions = [
    { name: "register", path: "/api/v1/auth/register", success: { user: null }, authenticated: false,
      invoke: (service: AuthService) => service.register("Owner", "owner@example.test", "fixture-password", {
        captchaToken: "fixture-token", acceptTerms: true, termsVersion: "fixture", privacyVersion: "fixture",
      }) },
    { name: "correct registration email", path: "/api/v1/auth/change-registration-email", success: { ok: true }, authenticated: false,
      invoke: (service: AuthService) => service.changeRegistrationEmail("old@example.test", "new@example.test", { captchaToken: "fixture-token" }) },
    { name: "logout", path: "/api/v1/auth/logout", success: { ok: true }, authenticated: true,
      invoke: (service: AuthService) => service.logout() },
    { name: "change password", path: "/api/v1/auth/change-password", success: { ok: true }, authenticated: true,
      invoke: (service: AuthService) => service.changePassword("fixture-current", "fixture-next", "123456") },
    { name: "acknowledge export", path: "/api/v1/auth/data-export/download/acknowledge", success: { ok: true }, authenticated: true,
      invoke: (service: AuthService) => service.acknowledgeDataExportDownload() },
    { name: "cancel export", path: "/api/v1/auth/data-export/cancel", success: { ok: true }, authenticated: true,
      invoke: (service: AuthService) => service.cancelDataExport() },
  ];

  beforeEach(() => {
    http = jasmine.createSpyObj<HttpClient>("HttpClient", ["get", "post"]);
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    // Observe the cross-tab invalidation signal without modifying browser storage.
    announce = spyOn(Storage.prototype, "setItem");
    spyOn(Storage.prototype, "removeItem");
    auth = TestBed.inject(AuthService);
    workspaces = TestBed.inject(WorkspaceService);
  });

  function seedAccount(): void {
    auth.user.set({ id: 1, email: "owner@example.test", name: "Owner", isAdmin: false, emailVerified: true, mfaEnabled: false });
    workspaces.setList([{ id: 7, name: "Fixture", slug: "fixture", role: "owner", createdAt: "2026-10-01T10:00:00Z" }]);
    announce.calls.reset();
  }

  for (const action of actions) {
    for (const [name, payload] of [
      ["null", null], ["HTML", "<html>upstream-secret</html>"], ["empty", {}],
      ["false", { ok: false }], ["string", { ok: "true" }],
    ] as const) {
      it(`rejects ${name} for ${action.name} before claiming success`, async () => {
        if (action.authenticated) seedAccount();
        const identity = auth.user();
        const workspaceList = workspaces.list();
        http.post.and.returnValue(of(payload));
        await expectAsync(action.invoke(auth)).toBeRejectedWith(jasmine.objectContaining({
          status: 502, message: "El servidor devolvió una respuesta no válida",
        }));
        expect(auth.user()).toBe(identity);
        expect(workspaces.list()).toBe(workspaceList);
        expect(announce).not.toHaveBeenCalled();
        expect(http.post).toHaveBeenCalledTimes(1);
        expect(http.post.calls.mostRecent().args[0]).toBe(action.path);
      });
    }

    it(`accepts the documented confirmation for ${action.name}`, async () => {
      if (action.authenticated) seedAccount();
      http.post.and.returnValue(of(action.success));
      await expectAsync(action.invoke(auth)).toBeResolved();
      if (action.name === "logout") {
        expect(auth.user()).toBeNull();
        expect(workspaces.list()).toEqual([]);
        expect(workspaces.currentId()).toBeNull();
        expect(announce).toHaveBeenCalledTimes(1);
        expect(announce.calls.mostRecent().args[0]).toBe("uvh.auth.invalidated");
      } else {
        expect(auth.user()?.id ?? null).toBe(action.authenticated ? 1 : null);
        expect(announce).not.toHaveBeenCalled();
      }
      expect(http.post).toHaveBeenCalledTimes(1);
    });

    if (action.authenticated) {
      it(`ignores a late ${action.name} confirmation after another account transition`, async () => {
        seedAccount();
        const response = new Subject<unknown>();
        http.post.and.returnValue(response.asObservable());
        const pending = action.invoke(auth);
        await Promise.resolve();
        await Promise.resolve();
        expect(http.post).toHaveBeenCalledTimes(1);
        auth.accountSignedOut();
        seedAccount();
        auth.user.update(user => user && { ...user, id: 2 });
        response.next(action.success);
        response.complete();
        await expectAsync(pending).toBeRejectedWith(jasmine.any(AuthOperationSupersededError));
        expect(auth.user()?.id).toBe(2);
        expect(workspaces.currentId()).toBe(7);
        expect(announce).not.toHaveBeenCalled();
      });
    }
  }

  for (const payload of [{ user: {} }, { user: "null" }, { user: false }, { ok: true }]) {
    it(`rejects registration without an explicit sessionless result ${JSON.stringify(payload)}`, async () => {
      http.post.and.returnValue(of(payload));
      await expectAsync(actions[0].invoke(auth)).toBeRejectedWith(jasmine.objectContaining({ status: 502 }));
      expect(auth.user()).toBeNull();
    });
  }
});
