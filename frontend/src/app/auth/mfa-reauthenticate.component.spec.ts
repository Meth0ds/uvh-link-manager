import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router, convertToParamMap } from "@angular/router";
import { AuthService } from "../core/services/auth.service";
import { MfaReauthenticateComponent } from "./mfa-reauthenticate.component";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("MFA reauthentication session checks", () => {
  let loaded: ReturnType<typeof signal<boolean>>;
  let authenticated: ReturnType<typeof signal<boolean>>;
  let generation: number;
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;
  beforeEach(() => {
    loaded = signal(false); authenticated = signal(false); generation = 1;
    auth = jasmine.createSpyObj<AuthService>("AuthService", ["init", "mfaSessionStatus", "reauthenticateMfa", "clearAdminMfaReauthentication", "sessionGeneration"]);
    Object.assign(auth, { loaded, authenticated, user: () => ({ isAdmin: true }) });
    auth.init.and.resolveTo();
    auth.sessionGeneration.and.callFake(() => generation);
    auth.mfaSessionStatus.and.resolveTo({ enabled: true, fresh: false, verifiedAt: null, expiresAt: null });
    router = jasmine.createSpyObj<Router>("Router", ["navigate", "navigateByUrl"]);
    router.navigate.and.resolveTo(true); router.navigateByUrl.and.resolveTo(true);
    TestBed.configureTestingModule({ imports: [MfaReauthenticateComponent], providers: [
      { provide: AuthService, useValue: auth }, { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
    ] });
  });
  it("does not redirect an unknown session to login or submit its credentials", async () => {
    const component = TestBed.createComponent(MfaReauthenticateComponent).componentInstance;
    await settle();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(component.error()).toContain("sesión");
    component.form.setValue({ password: "fixture-password", factorCode: "123456" });
    await component.submit();
    expect(auth.reauthenticateMfa).not.toHaveBeenCalled();
  });
  it("does not expose a usable credential submission after the status probe fails", async () => {
    loaded.set(true); authenticated.set(true);
    auth.mfaSessionStatus.and.rejectWith(new Error("offline"));
    const component = TestBed.createComponent(MfaReauthenticateComponent).componentInstance;
    await settle();
    component.form.setValue({ password: "fixture-password", factorCode: "123456" });
    await component.submit();
    expect(auth.reauthenticateMfa).not.toHaveBeenCalled();
  });
  it("can recover a failed probe and rejects submission after a session change", async () => {
    const component = TestBed.createComponent(MfaReauthenticateComponent).componentInstance;
    await settle();
    loaded.set(true); authenticated.set(true);
    component.retryInitialization();
    await settle();
    expect(component.ready()).toBeTrue();
    expect(component.error()).toBeNull();
    component.form.setValue({ password: "fixture-password", factorCode: "123456" });
    generation = 2;
    await component.submit();
    expect(auth.reauthenticateMfa).not.toHaveBeenCalled();
  });

  it("lets a verified non-admin refresh MFA for account settings and return after success", async () => {
    loaded.set(true); authenticated.set(true);
    Object.assign(auth, { user: () => ({ isAdmin: false }) });
    TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { queryParamMap: convertToParamMap({ returnTo: "/app/settings" }) } } });
    auth.reauthenticateMfa.and.resolveTo({ verifiedAt: "2026-10-01T12:00:00Z", expiresAt: "2026-10-01T12:15:00Z" });
    const component = TestBed.createComponent(MfaReauthenticateComponent).componentInstance;
    await settle();
    expect(component.ready()).toBeTrue();
    expect(router.navigate).not.toHaveBeenCalled();
    component.form.setValue({ password: "fixture-password", factorCode: "123456" });
    await component.submit();
    expect(auth.reauthenticateMfa).toHaveBeenCalledOnceWith("fixture-password", "123456");
    expect(router.navigateByUrl).toHaveBeenCalledOnceWith("/app/settings");
    expect(component.form.controls.password.value).toBe("");
    expect(component.form.controls.factorCode.value).toBe("");
  });

  it("still refuses a non-admin who asks to return to the administrative console", async () => {
    loaded.set(true); authenticated.set(true);
    Object.assign(auth, { user: () => ({ isAdmin: false }) });
    TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { queryParamMap: convertToParamMap({ returnTo: "/app/admin/users" }) } } });
    const component = TestBed.createComponent(MfaReauthenticateComponent).componentInstance;
    await settle();
    expect(component.ready()).toBeFalse();
    expect(router.navigate).toHaveBeenCalledOnceWith(["/forbidden"]);
    expect(auth.mfaSessionStatus).not.toHaveBeenCalled();
  });

  it("does not offer credential submission for a non-admin without an active factor", async () => {
    loaded.set(true); authenticated.set(true);
    Object.assign(auth, { user: () => ({ isAdmin: false }) });
    TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { queryParamMap: convertToParamMap({ returnTo: "/app/settings" }) } } });
    auth.mfaSessionStatus.and.resolveTo({ enabled: false, fresh: false, verifiedAt: null, expiresAt: null });
    const component = TestBed.createComponent(MfaReauthenticateComponent).componentInstance;
    await settle();
    expect(component.ready()).toBeFalse();
    expect(router.navigate).toHaveBeenCalledOnceWith(["/forbidden"]);
    component.form.setValue({ password: "fixture-password", factorCode: "123456" });
    await component.submit();
    expect(auth.reauthenticateMfa).not.toHaveBeenCalled();
  });

});
