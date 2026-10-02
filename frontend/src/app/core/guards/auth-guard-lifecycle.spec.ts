import { HttpClient } from "@angular/common/http";
import { TestBed } from "@angular/core/testing";
import { ActivatedRouteSnapshot, GuardResult, provideRouter, Router, RouterStateSnapshot, UrlTree } from "@angular/router";
import { firstValueFrom, isObservable, of, Subject, throwError } from "rxjs";
import { AuthService } from "../services/auth.service";
import { adminGuard, authGuard } from "./auth.guard";

describe("authentication navigation lifecycle", () => {
  let http: jasmine.SpyObj<HttpClient>;
  let auth: AuthService;
  let router: Router;
  const owner = { id: 1, email: "operator@example.test", name: "Operator", isAdmin: true, emailVerified: true, mfaEnabled: true };
  const fresh = { enabled: true, fresh: true, verifiedAt: "2026-10-02T00:00:00Z", expiresAt: "2026-10-02T00:15:00Z" };

  async function invoke(guard = adminGuard, url = "/admin"): Promise<GuardResult> {
    const result = TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));
    return isObservable(result) ? firstValueFrom(result) : result;
  }

  beforeEach(() => {
    http = jasmine.createSpyObj<HttpClient>("HttpClient", ["get", "post"]);
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: HttpClient, useValue: http }] });
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    auth.loaded.set(true);
    auth.user.set(owner);
  });

  afterEach(() => TestBed.resetTestingModule());

  it("allows a current administrator with a confirmed fresh factor", async () => {
    http.get.and.returnValue(of(fresh));
    expect(await invoke()).toBeTrue();
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it("sends a current administrator to reauthentication when the privileged window expired", async () => {
    http.get.and.returnValue(of({ ...fresh, fresh: false }));
    const result = await invoke();
    expect(router.serializeUrl(result as UrlTree)).toBe("/auth/reauthenticate?returnTo=%2Fadmin");
  });

  for (const user of [null, { ...owner, isAdmin: false }]) {
    it(`rejects ${user === null ? "anonymous" : "non-administrator"} navigation before querying freshness`, async () => {
      auth.user.set(user);
      expect(router.serializeUrl(await invoke() as UrlTree)).toBe("/forbidden");
      expect(http.get).not.toHaveBeenCalled();
    });
  }

  for (const response of [null, {}, { ...fresh, enabled: false, fresh: false, verifiedAt: null, expiresAt: null }]) {
    it(`keeps administration closed for invalid or disabled MFA (${JSON.stringify(response)})`, async () => {
      http.get.and.returnValue(of(response));
      expect(router.serializeUrl(await invoke() as UrlTree)).toBe("/forbidden");
    });
  }

  it("keeps navigation closed when the freshness read fails", async () => {
    http.get.and.returnValue(throwError(() => new Error("fixture unavailable")));
    expect(router.serializeUrl(await invoke() as UrlTree)).toBe("/forbidden");
  });

  it("rejects a late freshness response after the account is signed out", async () => {
    const response = new Subject<unknown>();
    http.get.and.returnValue(response);
    const pending = invoke();
    auth.accountSignedOut();
    response.next(fresh);
    response.complete();
    expect(router.serializeUrl(await pending as UrlTree)).toBe("/forbidden");
    expect(auth.user()).toBeNull();
  });

  it("rechecks the administrator role if the live identity changed while freshness was loading", async () => {
    const response = new Subject<unknown>();
    http.get.and.returnValue(response);
    const pending = invoke();
    // Profile hydration can update the current role without replacing the session generation.
    auth.user.set({ ...owner, isAdmin: false });
    response.next(fresh);
    response.complete();
    expect(router.serializeUrl(await pending as UrlTree)).toBe("/forbidden");
  });

  it("redirects anonymous visitors with a safe internal return destination", async () => {
    auth.user.set(null);
    expect(router.serializeUrl(await invoke(authGuard, "/app/links") as UrlTree)).toBe("/auth?returnTo=%2Fapp%2Flinks");
    expect(http.get).not.toHaveBeenCalled();
  });

  it("allows the authenticated panel without an unnecessary MFA query", async () => {
    expect(await invoke(authGuard, "/app/links")).toBeTrue();
    expect(http.get).not.toHaveBeenCalled();
  });
});
