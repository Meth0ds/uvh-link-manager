import { FormBuilder } from "@angular/forms";
import { provideRouter, Router } from "@angular/router";
import { ActivatedRoute } from "@angular/router";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { Component, EventEmitter, Input, Output, signal, type WritableSignal } from "@angular/core";
import { By } from "@angular/platform-browser";
import { AuthComponent } from "./auth.component";
import { AuthService } from "../core/services/auth.service";
import { ApiService } from "../core/services/api.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { HCaptchaExecutionError, HCaptchaWidgetComponent } from "./hcaptcha-widget.component";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

@Component({ selector: "app-hcaptcha-widget", standalone: true, template: "" })
class FakeHCaptchaWidgetComponent {
  readonly state = signal("ready");
  @Input() siteKey = "";
  @Input() invisible = false;
  @Output() readonly tokenChange = new EventEmitter<string>();
  readonly execute = jasmine.createSpy("execute").and.resolveTo("fresh-passcode");
  reset(): void { this.tokenChange.emit(""); }
}

describe("AuthComponent registration flow", () => {
  let fixture: ComponentFixture<AuthComponent>;
  let component: AuthComponent;
  let api: jasmine.SpyObj<ApiService>;
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;
  let authenticated: WritableSignal<boolean>;

  function captchaWidget(selector: string): FakeHCaptchaWidgetComponent {
    return fixture.debugElement.query(By.css(selector)).componentInstance as FakeHCaptchaWidgetComponent;
  }

  function showRegistrationStep(): void {
    component.tabIndex.set(1);
    component.step.set("register");
    component.registerStep.set(2);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get"]);
    api.get.and.resolveTo({
      hcaptcha: { enabled: true, siteKey: "10000000-ffff-ffff-ffff-000000000001" },
    });
    auth = jasmine.createSpyObj<AuthService>("AuthService", [
      "register",
      "changeRegistrationEmail",
      "resendVerification",
      "logout",
      "login",
      "verifyMfa",
      "recoverMfa",
    ]);
    auth.register.and.resolveTo();
    auth.changeRegistrationEmail.and.resolveTo();
    auth.resendVerification.and.resolveTo();
    auth.logout.and.resolveTo();
    auth.login.and.resolveTo({ mfaRequired: true, challenge: "mfa-challenge", recoveryAvailable: true });
    authenticated = signal(false);
    Object.assign(auth, {
      loaded: signal(true),
      authenticated,
    });
    router = jasmine.createSpyObj<Router>("Router", ["navigate", "navigateByUrl"]);
    router.navigate.and.resolveTo(true);
    router.navigateByUrl.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [AuthComponent],
      providers: [
        FormBuilder,
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => null } } },
        },
        {
          provide: Router,
          useValue: router,
        },
      ],
    })
      .overrideComponent(AuthComponent, {
        remove: { imports: [HCaptchaWidgetComponent] },
        add: { imports: [FakeHCaptchaWidgetComponent] },
      })
      .compileComponents();

    TestBed.inject(PendingLinkIntentService).clear();

    fixture = TestBed.createComponent(AuthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it("keeps the first step blocked until identity fields are valid", () => {
    component.registerForm.controls.name.setValue("A");
    component.registerForm.controls.email.setValue("not-an-email");
    component.nextRegisterStep();

    expect(component.registerStep()).toBe(1);
    expect(component.registerForm.controls.name.touched).toBeTrue();
    expect(component.registerForm.controls.email.touched).toBeTrue();
  });

  async function enableLocalFallback(siteKey: string | null = "10000000-ffff-ffff-ffff-000000000001"): Promise<void> {
    api.get.and.resolveTo({ hcaptcha: { enabled: !!siteKey, siteKey, developmentFallback: true } });
    await component.retryCaptchaConfiguration();
    fixture.detectChanges();
    component.loginForm.setValue({ email: "ana@example.com", password: "unit-test-password" });
  }

  it("uses the ordinary provider token when local fallback is available but not needed", async () => {
    await enableLocalFallback();
    await component.onLogin();
    expect(auth.login).toHaveBeenCalledWith("ana@example.com", "unit-test-password", "fresh-passcode");
    expect(component.step()).toBe("mfa");
  });

  it("allows an explicitly authorized local widget failure without skipping MFA", async () => {
    await enableLocalFallback();
    captchaWidget("app-hcaptcha-widget").execute.and.rejectWith(new HCaptchaExecutionError("Provider unavailable"));
    expect(fixture.nativeElement.querySelector(".development-notice").textContent).toContain("Solo desarrollo local");
    await component.onLogin();
    expect(auth.login).toHaveBeenCalledWith("ana@example.com", "unit-test-password", "uvh-local-captcha-unavailable");
    expect(component.step()).toBe("mfa");
  });

  it("supports local missing keys only after the API grants the capability", async () => {
    await enableLocalFallback(null);
    expect(component.captchaReady()).toBeTrue();
    await component.onLogin();
    expect(auth.login).toHaveBeenCalledWith("ana@example.com", "unit-test-password", "uvh-local-captcha-unavailable");
  });

  it("does not wait for another challenge after a visible local provider failure", async () => {
    await enableLocalFallback();
    const widget = captchaWidget("app-hcaptcha-widget");
    widget.state.set("error");
    await component.onLogin();
    expect(widget.execute).not.toHaveBeenCalled();
    expect(auth.login.calls.mostRecent().args[2]).toBe("uvh-local-captcha-unavailable");
  });

  it("preserves registration consent and the honeypot with the local fallback", async () => {
    await enableLocalFallback(null);
    showRegistrationStep();
    component.registerForm.patchValue({ name: "Ana García", email: "ana@example.com", password: "unique-test-password", confirmPassword: "unique-test-password", acceptTerms: true });
    component.registerForm.controls.company.setValue("bot");
    await component.onRegister();
    expect(auth.register).not.toHaveBeenCalled();
    component.registerForm.controls.company.setValue("");
    await component.onRegister();
    expect(auth.register).toHaveBeenCalledWith("Ana García", "ana@example.com", "unique-test-password", jasmine.objectContaining({ captchaToken: "uvh-local-captcha-unavailable", acceptTerms: true, website: "" }));
    expect(component.step()).toBe("verify-pending");
  });

  it("revokes the local capability when config refresh fails", async () => {
    await enableLocalFallback();
    api.get.and.rejectWith(new Error("API offline"));
    await component.retryCaptchaConfiguration();
    await component.onLogin();
    expect(component.developmentCaptchaFallback()).toBeFalse();
    expect(component.captchaReady()).toBeFalse();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it("does not reinterpret programming errors as provider outages", async () => {
    await enableLocalFallback();
    captchaWidget("app-hcaptcha-widget").execute.and.rejectWith(new Error("Unexpected failure"));
    await component.onLogin();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it("does not retry rejected credentials with a fallback marker", async () => {
    await enableLocalFallback();
    auth.login.and.rejectWith(new Error("Rejected credentials"));
    await component.onLogin();
    expect(auth.login).toHaveBeenCalledTimes(1);
    expect(auth.login.calls.mostRecent().args[2]).toBe("fresh-passcode");
  });

  it("loads only the public hCaptcha sitekey for both access modes", async () => {
    component.registerForm.controls.name.setValue("Ana García");
    component.registerForm.controls.email.setValue("ana@example.com");
    await component.nextRegisterStep();

    expect(component.registerStep()).toBe(2);
    // The existing cancellation guard now passes an AbortSignal as well as
    // the public decoder; keep the assertion aligned with that safer contract.
    expect(api.get).toHaveBeenCalledWith("/api/v1/config", undefined, jasmine.any(Function), jasmine.objectContaining({ signal: jasmine.any(AbortSignal) }));
    expect(component.hcaptchaSiteKey()).toBe("10000000-ffff-ffff-ffff-000000000001");
    expect(JSON.stringify(api.get.calls.mostRecent().returnValue)).not.toContain("HCAPTCHA_SECRET");
  });

  it("requires consent and matching passwords before submitting", async () => {
    showRegistrationStep();
    component.registerForm.patchValue({
      name: "Ana García",
      email: "ana@example.com",
      password: "Strong-password-123!",
      confirmPassword: "different-password",
    });

    await component.onRegister();

    expect(auth.register).not.toHaveBeenCalled();
    expect(component.registerForm.controls.acceptTerms.hasError("required")).toBeTrue();
    expect(component.registerForm.hasError("mismatch")).toBeTrue();
  });

  it("submits the CAPTCHA and consent, then shows email verification state", async () => {
    showRegistrationStep();
    component.registerForm.patchValue({
      name: "Ana García",
      email: "ana@example.com",
      password: "Strong-password-123!",
      confirmPassword: "Strong-password-123!",
      acceptTerms: true,
      company: "",
    });

    await component.onRegister();

    expect(auth.register).toHaveBeenCalledWith(
      "Ana García",
      "ana@example.com",
      "Strong-password-123!",
      {
        captchaToken: "fresh-passcode",
        website: "",
        acceptTerms: true,
        termsVersion: "2026-08-30",
        privacyVersion: "2026-08-30",
      },
    );
    expect(component.step()).toBe("verify-pending");
    expect(component.verificationEmail()).toBe("ana@example.com");
    expect(component.info()).toContain("confirmar tu email");
  });

  it("offers a safe email correction and clears the sessionless registration state", () => {
    component.registeredEmail.set("wrong@example.com");
    component.verificationEmail.set("wrong@example.com");
    component.step.set("verify-pending");

    component.changeRegistrationEmail();
    expect(component.changeEmailMode()).toBeTrue();
    expect(component.registerStep()).toBe(1);
    expect(component.registerForm.controls.email.value).toBe("wrong@example.com");

    component.closeRegistration();
    // Registration does not create a session. Calling logout here would add a
    // needless state-changing request and misleadingly imply one exists.
    expect(auth.logout).not.toHaveBeenCalled();
    expect(component.step()).toBe("login");
    expect(component.verificationEmail()).toBeNull();
    expect(component.registeredEmail()).toBeNull();
    expect(component.registerForm.controls.email.value).toBe("");
  });

  it("does not submit when the honeypot contains a value", async () => {
    showRegistrationStep();
    component.registerForm.patchValue({
      name: "Bot",
      email: "bot@example.com",
      password: "Strong-password-123!",
      confirmPassword: "Strong-password-123!",
      acceptTerms: true,
      company: "filled-by-bot",
    });

    await component.onRegister();

    expect(auth.register).not.toHaveBeenCalled();
    expect(component.error()).toBe("No se pudo crear la cuenta");
  });

  it("updates the password meter reactively and penalizes predictable passwords", () => {
    component.registerForm.patchValue({
      name: "Ana García",
      email: "ana@example.com",
      password: "password1234",
    });
    const weakScore = component.passwordScore();

    component.registerForm.controls.password.setValue("Órbita-Mango-Cobre-47!");

    expect(weakScore).toBeLessThan(40);
    expect(component.passwordScore()).toBeGreaterThan(weakScore);
    expect(component.passwordStrength()).toBe("Fuerte");
    expect(component.passwordRequirements().filter((item) => item.met).length).toBe(4);
  });

  it("updates password matching as confirmation changes", () => {
    component.registerForm.controls.password.setValue("Órbita-Mango-Cobre-47!");
    component.registerForm.controls.confirmPassword.setValue("otra-clave");
    expect(component.passwordsMatch()).toBeFalse();

    component.registerForm.controls.confirmPassword.setValue("Órbita-Mango-Cobre-47!");
    expect(component.passwordsMatch()).toBeTrue();
  });

  it("executes invisible hCaptcha at submit time and sends its fresh login token", async () => {
    component.loginForm.setValue({ email: "ana@example.com", password: "correct-password" });
    const captcha = captchaWidget("app-hcaptcha-widget");

    await component.onLogin();

    expect(captcha.invisible).toBeTrue();
    expect(captcha.execute).toHaveBeenCalledTimes(1);
    expect(auth.login).toHaveBeenCalledWith("ana@example.com", "correct-password", "fresh-passcode");
    expect(component.step()).toBe("mfa");
  });

  it("serializes login and resend while their shared challenge is pending", async () => {
    component.loginForm.setValue({ email: "ana@example.com", password: "correct-password" });
    const pending = deferred<string>();
    const captcha = captchaWidget("app-hcaptcha-widget");
    captcha.execute.and.returnValue(pending.promise);
    const resend = component.resendVerification();
    await component.onLogin();
    expect(captcha.execute).toHaveBeenCalledTimes(1);
    expect(auth.login).not.toHaveBeenCalled();
    pending.resolve("fresh-resend-token");
    await resend;
    expect(auth.resendVerification).toHaveBeenCalledWith("ana@example.com", "fresh-resend-token");
  });

  it("does not call login when the invisible challenge is closed", async () => {
    component.loginForm.setValue({ email: "ana@example.com", password: "correct-password" });
    const captcha = captchaWidget("app-hcaptcha-widget");
    captcha.execute.and.rejectWith(new HCaptchaExecutionError("Completa la protección antiabuso para continuar."));

    await component.onLogin();

    expect(auth.login).not.toHaveBeenCalled();
    expect(component.error()).toBe("Completa la protección antiabuso para continuar.");
  });

  it("keeps the newest hCaptcha configuration when an older retry finishes last", async () => {
    const older = deferred<{ hcaptcha: { enabled: boolean; siteKey: string } }>();
    const newer = deferred<{ hcaptcha: { enabled: boolean; siteKey: string } }>();
    component.hcaptchaSiteKey.set("");
    api.get.and.returnValues(older.promise, newer.promise);

    const firstRetry = component.retryCaptchaConfiguration();
    const secondRetry = component.retryCaptchaConfiguration();
    newer.resolve({ hcaptcha: { enabled: true, siteKey: "10000000-ffff-ffff-ffff-000000000002" } });
    await secondRetry;
    older.resolve({ hcaptcha: { enabled: true, siteKey: "10000000-ffff-ffff-ffff-000000000003" } });
    await firstRetry;

    expect(component.hcaptchaSiteKey()).toBe("10000000-ffff-ffff-ffff-000000000002");
    expect(component.captchaConfigBusy()).toBeFalse();
  });

  it("does not navigate when login finishes after the auth view was destroyed", async () => {
    const response = deferred<{ mfaRequired: false }>();
    auth.login.and.returnValue(response.promise as ReturnType<AuthService["login"]>);
    component.loginForm.setValue({ email: "ana@example.com", password: "correct-password" });

    const login = component.onLogin();
    fixture.destroy();
    response.resolve({ mfaRequired: false });
    await login;

    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it("navigates exactly once when an interactive login succeeds", async () => {
    auth.login.and.callFake(async () => {
      authenticated.set(true);
      return {
        mfaRequired: false,
        user: {
          id: 1, email: "ana@example.com", name: "Ana", isAdmin: false,
          emailVerified: true, mfaEnabled: false,
        },
      };
    });
    component.loginForm.setValue({ email: "ana@example.com", password: "correct-password" });

    await component.onLogin();
    fixture.detectChanges();

    expect(router.navigateByUrl).toHaveBeenCalledOnceWith("/app");
  });

  it("does not navigate when an MFA result belongs to a locally abandoned challenge", async () => {
    const response = deferred<void>();
    auth.verifyMfa.and.returnValue(response.promise);
    component.step.set("mfa");
    component.mfaChallenge.set("challenge-a");
    component.mfaForm.controls.code.setValue("123456");

    const verification = component.onMfa();
    component.restartMfaLogin("Vuelve a iniciar sesión");
    response.resolve();
    await verification;

    expect(component.step()).toBe("login");
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it("does not navigate when a recovery result belongs to a replaced step", async () => {
    const response = deferred<void>();
    auth.recoverMfa.and.returnValue(response.promise);
    component.step.set("recovery");
    component.mfaChallenge.set("challenge-a");
    component.recoveryForm.controls.code.setValue("ABCD-EFGH-JKLM-NPQR");

    const recovery = component.onRecovery();
    component.backToMfa();
    response.resolve();
    await recovery;

    expect(component.step()).toBe("mfa");
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it("does not restore a registration screen after its request was locally closed", async () => {
    const response = deferred<void>();
    auth.register.and.returnValue(response.promise);
    showRegistrationStep();
    component.registerForm.setValue({
      name: "Ana García", email: "ana@example.com", password: "Strong-password-123!",
      confirmPassword: "Strong-password-123!", acceptTerms: true, company: "",
    });

    const registration = component.onRegister();
    component.closeRegistration();
    response.resolve();
    await registration;

    expect(component.step()).toBe("login");
    expect(component.verificationEmail()).toBeNull();
    expect(component.info()).toContain("cerrado el registro pendiente");
  });

  it("keeps a closed registration state when an older resend finishes later", async () => {
    const response = deferred<void>();
    auth.resendVerification.and.returnValue(response.promise);
    component.step.set("verify-pending");
    component.verificationEmail.set("ana@example.com");
    fixture.detectChanges();

    const resend = component.resendVerification();
    component.closeRegistration();
    response.resolve();
    await resend;

    expect(component.verificationBusy()).toBeFalse();
    expect(component.info()).toContain("cerrado el registro pendiente");
    expect(component.info()).not.toContain("nuevo correo");
  });

  it("keeps the saved-link context visible while access is completed", () => {
    const intents = TestBed.inject(PendingLinkIntentService);
    intents.capture("a".repeat(43), new Date(Date.now() + 60_000).toISOString());
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("Tu URL está guardada");
    expect(fixture.nativeElement.textContent).toContain("Accede para retomar el enlace");
  });

  it("exposes login and registration as one keyboard-friendly tablist", () => {
    const root = fixture.nativeElement as HTMLElement;
    const tabs = root.querySelectorAll<HTMLElement>("[role='tab']");
    expect(tabs.length).toBe(2);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector(".mat-mdc-tab-header-pagination")).toBeNull();

    component.onTabChange(1);
    fixture.detectChanges();

    expect(tabs[0].getAttribute("aria-selected")).toBe("false");
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(fixture.nativeElement.textContent).toContain("Crea tu cuenta en UVH");
  });
});
