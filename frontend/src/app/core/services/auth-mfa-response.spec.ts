import { HttpClient } from "@angular/common/http";
import { TestBed } from "@angular/core/testing";
import { of, Subject } from "rxjs";
import { AuthOperationSupersededError, AuthService } from "./auth.service";

describe("MFA mutation response contracts", () => {
  let http: jasmine.SpyObj<HttpClient>;
  let auth: AuthService;

  beforeEach(() => {
    http = jasmine.createSpyObj<HttpClient>("HttpClient", ["get", "post"]);
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    auth = TestBed.inject(AuthService);
    auth.user.set({ id: 1, email: "owner@example.test", name: "Owner", isAdmin: false, emailVerified: true, mfaEnabled: true });
  });

  for (const action of ["cancel", "disable"] as const) {
    const invoke = (service: AuthService) => action === "cancel" ? service.mfaCancelSetup() : service.mfaDisable("password", "123456");

    for (const [name, payload] of [
      ["null", null],
      ["HTML", "<html>upstream-secret</html>"],
      ["missing acknowledgement", {}],
      ["false acknowledgement", { ok: false, message: "upstream-secret" }],
      ["string acknowledgement", { ok: "true" }],
    ] as const) {
      it(`rejects ${name} for ${action} before claiming the mutation succeeded`, async () => {
        http.post.and.returnValue(of(payload));
        await expectAsync(invoke(auth)).toBeRejectedWith(jasmine.objectContaining({
          name: "ApiRequestError", status: 502, message: "El servidor devolvió una respuesta no válida",
        }));
        expect(auth.user()?.mfaEnabled).toBeTrue();
        expect(http.post).toHaveBeenCalledTimes(1);
      });
    }

    it(`accepts a confirmed ${action} without silently replacing the current account`, async () => {
      http.post.and.returnValue(of({ ok: true }));
      await expectAsync(invoke(auth)).toBeResolved();
      expect(auth.user()?.id).toBe(1);
      expect(http.post).toHaveBeenCalledTimes(1);
    });

    it(`ignores a late ${action} acknowledgement after the session was replaced`, async () => {
      const response = new Subject<unknown>();
      http.post.and.returnValue(response.asObservable());
      const pending = invoke(auth);
      await Promise.resolve();
      await Promise.resolve();
      expect(http.post).toHaveBeenCalledTimes(1);
      auth.accountSignedOut();
      response.next({ ok: true });
      response.complete();
      await expectAsync(pending).toBeRejectedWith(jasmine.any(AuthOperationSupersededError));
      expect(auth.user()).toBeNull();
    });
  }
});
