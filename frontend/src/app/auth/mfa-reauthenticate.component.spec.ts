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

  for (const state of ["fresh", "submit"] as const) {
    for (const failure of ["cancelled", "rejected"] as const) {
      it(`offers a route-only retry after ${state} authorization and ${failure} navigation`, async () => {
        loaded.set(true); authenticated.set(true);
        auth.mfaSessionStatus.and.resolveTo({ enabled: true, fresh: state === "fresh", verifiedAt: null, expiresAt: null });
        if (failure === "cancelled") router.navigateByUrl.and.resolveTo(false);
        else router.navigateByUrl.and.rejectWith(new Error("route-load failed"));
        auth.reauthenticateMfa.and.resolveTo({ verifiedAt: "2026-10-02T12:00:00Z", expiresAt: "2026-10-02T12:15:00Z" });
        const fixture = TestBed.createComponent(MfaReauthenticateComponent);
        const component = fixture.componentInstance;
        await settle();
        if (state === "submit") {
          component.form.setValue({ password: "fixture-password", factorCode: "123456" });
          await component.submit();
        }
        fixture.detectChanges();
        expect(component.ready()).toBeFalse();
        expect(component.error()).toBeNull();
        expect(fixture.nativeElement.querySelector(".navigation-retry")).not.toBeNull();
        expect(fixture.nativeElement.querySelector("form")).toBeNull();
        expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
        router.navigateByUrl.and.resolveTo(true);
        await component.retryNavigation();
        expect(router.navigateByUrl).toHaveBeenCalledTimes(2);
        expect(auth.mfaSessionStatus).toHaveBeenCalledTimes(1);
        expect(auth.reauthenticateMfa).toHaveBeenCalledTimes(state === "submit" ? 1 : 0);
        component.form.setValue({ password: "fixture-password", factorCode: "123456" });
        await component.submit();
        expect(auth.reauthenticateMfa).toHaveBeenCalledTimes(state === "submit" ? 1 : 0);
      });
    }
  }

  for (const outcome of ["login", "non-admin", "no-factor"] as const) {
    for (const failure of ["cancelled", "rejected"] as const) {
      it(`can retry ${outcome} routing after a ${failure} navigation without rechecking credentials`, async () => {
        loaded.set(true); authenticated.set(outcome !== "login");
        if (outcome === "non-admin") {
          Object.assign(auth, { user: () => ({ isAdmin: false }) });
          TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { queryParamMap: convertToParamMap({ returnTo: "/app/admin/users" }) } } });
        }
        if (outcome === "no-factor") auth.mfaSessionStatus.and.resolveTo({ enabled: false, fresh: false, verifiedAt: null, expiresAt: null });
        if (failure === "cancelled") router.navigate.and.resolveTo(false);
        else router.navigate.and.rejectWith(new Error("route-load failed"));
        const fixture = TestBed.createComponent(MfaReauthenticateComponent);
        const component = fixture.componentInstance;
        await settle();
        fixture.detectChanges();
        expect(component.navigationFailed()).toBeTrue();
        expect(fixture.nativeElement.querySelector(".navigation-retry")).not.toBeNull();
        router.navigate.and.resolveTo(true);
        await component.retryNavigation();
        expect(router.navigate).toHaveBeenCalledTimes(2);
        expect(router.navigateByUrl).not.toHaveBeenCalled();
        expect(auth.reauthenticateMfa).not.toHaveBeenCalled();
        expect(auth.mfaSessionStatus).toHaveBeenCalledTimes(outcome === "no-factor" ? 1 : 0);
      });
    }
  }

  it("keeps failed navigation retryable and keyboard focus stable without consuming another factor", async () => {
    loaded.set(true); authenticated.set(true);
    auth.reauthenticateMfa.and.resolveTo({ verifiedAt: "2026-10-02T12:00:00Z", expiresAt: "2026-10-02T12:15:00Z" });
    router.navigateByUrl.and.resolveTo(false);
    const fixture = TestBed.createComponent(MfaReauthenticateComponent);
    const component = fixture.componentInstance;
    await settle();
    component.form.setValue({ password: "fixture-password", factorCode: "123456" });
    await component.submit();
    fixture.detectChanges(); await fixture.whenStable();
    const status = fixture.nativeElement.querySelector('[role="status"]') as HTMLElement;
    expect(document.activeElement).toBe(status);
    let resolve!: (value: boolean) => void;
    router.navigateByUrl.and.returnValue(new Promise<boolean>(accept => { resolve = accept; }));
    const button = fixture.nativeElement.querySelector(".navigation-retry") as HTMLButtonElement;
    button.focus();
    const retry = component.retryNavigation();
    fixture.detectChanges();
    expect(button.disabled).toBeTrue();
    expect(document.activeElement).toBe(status);
    await component.retryNavigation();
    component.form.setValue({ password: "fixture-password", factorCode: "654321" });
    await component.submit();
    expect(router.navigateByUrl).toHaveBeenCalledTimes(2);
    expect(auth.reauthenticateMfa).toHaveBeenCalledTimes(1);
    resolve(false); await retry;
    fixture.detectChanges(); await fixture.whenStable();
    expect(component.navigationFailed()).toBeTrue();
    expect(component.error()).toBeNull();
    expect(button.disabled).toBeFalse();
    expect(document.activeElement).toBe(status);
    expect(component.form.controls.factorCode.value).toBe("654321");
  });

  it("requires a new session check before retrying an old authorized destination", async () => {
    loaded.set(true); authenticated.set(true);
    auth.mfaSessionStatus.and.resolveTo({ enabled: true, fresh: true, verifiedAt: null, expiresAt: null });
    router.navigateByUrl.and.resolveTo(false);
    const component = TestBed.createComponent(MfaReauthenticateComponent).componentInstance;
    await settle();
    generation = 2;
    await component.retryNavigation();
    expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    expect(component.navigationFailed()).toBeFalse();
    expect(component.ready()).toBeFalse();
    expect(component.error()).toContain("sesión ha cambiado");
    auth.mfaSessionStatus.and.resolveTo({ enabled: true, fresh: false, verifiedAt: null, expiresAt: null });
    component.retryInitialization(); await settle();
    expect(auth.mfaSessionStatus).toHaveBeenCalledTimes(2);
    expect(component.ready()).toBeTrue();
    expect(component.error()).toBeNull();
  });

  it("releases busy state when the session changes during a navigation retry", async () => {
    loaded.set(true); authenticated.set(true);
    auth.mfaSessionStatus.and.resolveTo({ enabled: true, fresh: true, verifiedAt: null, expiresAt: null });
    router.navigateByUrl.and.resolveTo(false);
    const component = TestBed.createComponent(MfaReauthenticateComponent).componentInstance;
    await settle();
    let resolve!: (value: boolean) => void;
    router.navigateByUrl.and.returnValue(new Promise<boolean>(accept => { resolve = accept; }));
    const retry = component.retryNavigation();
    generation = 2;
    resolve(false); await retry;
    expect(component.navigationBusy()).toBeFalse();
    expect(component.busy()).toBeFalse();
    expect(component.initializing()).toBeFalse();
    expect(component.navigationFailed()).toBeFalse();
    expect(component.error()).toContain("sesión ha cambiado");
  });

  it("ignores a navigation result after the view is destroyed", async () => {
    loaded.set(true); authenticated.set(true);
    auth.mfaSessionStatus.and.resolveTo({ enabled: true, fresh: true, verifiedAt: null, expiresAt: null });
    router.navigateByUrl.and.resolveTo(false);
    const fixture = TestBed.createComponent(MfaReauthenticateComponent);
    const component = fixture.componentInstance;
    await settle();
    let resolve!: (value: boolean) => void;
    router.navigateByUrl.and.returnValue(new Promise<boolean>(accept => { resolve = accept; }));
    const retry = component.retryNavigation();
    fixture.destroy(); resolve(true); await retry;
    expect(component.navigationFailed()).toBeTrue();
    expect(router.navigateByUrl).toHaveBeenCalledTimes(2);
    expect(auth.reauthenticateMfa).not.toHaveBeenCalled();
  });

});
