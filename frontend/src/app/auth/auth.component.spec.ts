import { FormBuilder } from "@angular/forms";
import { provideRouter, Router } from "@angular/router";
import { ActivatedRoute } from "@angular/router";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { Component, EventEmitter, Input, Output, signal, type WritableSignal } from "@angular/core";
import { By } from "@angular/platform-browser";
import { AuthComponent } from "./auth.component";
import type { AuthFlowState } from "./auth-flow-state";
import { AuthService } from "../core/services/auth.service";
import { ApiRequestError, ApiService } from "../core/services/api.service";
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
  let probeSettled: WritableSignal<boolean>;
  let loaded: WritableSignal<boolean>;
  let routeParameters: Record<string, string>;

  function captchaWidget(selector: string): FakeHCaptchaWidgetComponent {
    return fixture.debugElement.query(By.css(selector)).componentInstance as FakeHCaptchaWidgetComponent;
  }

  function setFlow(flow: AuthFlowState): void {
    (component as unknown as { flow: WritableSignal<AuthFlowState> }).flow.set(flow);
  }

  function showRegistrationStep(): void {
    component.tabIndex.set(1);
    setFlow({ kind: "register", mode: "new", stage: 2 });
    fixture.detectChanges();
  }

  beforeEach(async () => {
    routeParameters = {};
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "delete"]);
    api.get.and.resolveTo({
      hcaptcha: { enabled: true, siteKey: "10000000-ffff-ffff-ffff-000000000001" },
    });
    // The optional handoff park: a spec that captures a link intent must not
    // trip over an unstubbed client, and nothing here depends on its answer.
    api.post.and.resolveTo({ pending: true, expiresAt: new Date(Date.now() + 60_000).toISOString() } as never);
    api.delete.and.resolveTo({ pending: false } as never);
    auth = jasmine.createSpyObj<AuthService>("AuthService", [
      "register",
      "changeRegistrationEmail",
      "resendVerification",
      "logout",
      "login",
      "verifyMfa",
      "recoverMfa",
      "sessionGeneration",
    ]);
    auth.register.and.resolveTo();
    auth.changeRegistrationEmail.and.resolveTo();
    auth.resendVerification.and.resolveTo();
    auth.logout.and.resolveTo();
    auth.sessionGeneration.and.returnValue(0);
    auth.login.and.resolveTo({ mfaRequired: true, challenge: "mfa-challenge", recoveryAvailable: true });
    authenticated = signal(false);
    probeSettled = signal(true);
    loaded = signal(true);
    Object.assign(auth, {
      loaded,
      probeSettled,
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
          useValue: { snapshot: { queryParamMap: { get: (key: string) => routeParameters[key] ?? null } } },
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

    void TestBed.inject(PendingLinkIntentService).clear();

    fixture = TestBed.createComponent(AuthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it("does not paint the login form until the session probe settles", () => {
    loaded.set(false);
    probeSettled.set(false);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css("#login-panel"))).toBeNull();

    probeSettled.set(true);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css("#login-panel"))).not.toBeNull();
  });

  it("never paints the login form for a visitor with a live session", () => {
    authenticated.set(true);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css("#login-panel"))).toBeNull();
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

  it("announces the pause and blocks new registrations without spending a CAPTCHA token", async () => {
    showRegistrationStep();
    component.registrationsPaused.set(true);
    component.registerForm.patchValue({ name: "Ana García", email: "ana@example.com", password: "Strong-password-123!", confirmPassword: "Strong-password-123!", acceptTerms: true, company: "" });
    fixture.detectChanges();
    await component.onRegister();
    expect(auth.register).not.toHaveBeenCalled();
    expect(component.error()).toBe("Registros temporalmente pausados. Inténtalo de nuevo más tarde.");
    const submit = fixture.nativeElement.querySelector("form.auth-step-panel button.submit") as HTMLButtonElement | null;
    expect(submit?.disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain("Registros temporalmente pausados");
  });

  it("switches to the paused state when the server answers a registration with reason registration_paused", async () => {
    await enableLocalFallback(null);
    showRegistrationStep();
    auth.register.and.rejectWith(new ApiRequestError("Registros temporalmente pausados. Inténtalo de nuevo más tarde.", 503, undefined, undefined, "registration_paused"));
    component.registerForm.patchValue({ name: "Ana García", email: "ana@example.com", password: "Strong-password-123!", confirmPassword: "Strong-password-123!", acceptTerms: true, company: "" });
    fixture.detectChanges();
    await component.onRegister();
    fixture.detectChanges();
    expect(component.registrationsPaused()).toBeTrue();
    expect(component.error()).toBeNull();
    expect(fixture.nativeElement.querySelector(".alert.info")?.textContent).toContain("Registros temporalmente pausados");
    const submit = fixture.nativeElement.querySelector("form.auth-step-panel button.submit") as HTMLButtonElement | null;
    expect(submit?.disabled).toBeTrue();
  });

  it("keeps correcting a pending registration while new ones are paused", async () => {
    component.tabIndex.set(1);
    setFlow({ kind: "register", stage: 2, mode: "correct-email", originalEmail: "old@example.com" });
    component.registrationsPaused.set(true);
    component.registerForm.controls.email.setValue("new@example.com");
    fixture.detectChanges();
    await component.onRegister();
    expect(auth.changeRegistrationEmail).toHaveBeenCalledWith("old@example.com", "new@example.com", jasmine.objectContaining({ captchaToken: "fresh-passcode" }));
    expect(fixture.nativeElement.textContent).not.toContain("Registros temporalmente pausados");
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
    component.onTabChange(1);
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
        termsVersion: "2026-10-09",
        privacyVersion: "2026-10-09",
      },
    );
    expect(component.step()).toBe("verify-pending");
    expect(component.verificationEmail()).toBe("ana@example.com");
    expect(component.info()).toContain("confirmar tu email");
  });

  it("does not promise a fresh day for an intent with one minute remaining", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    api.post.and.resolveTo({ pending: true, expiresAt } as never);
    const intents = TestBed.inject(PendingLinkIntentService);
    expect(intents.capture("A".repeat(43), expiresAt)).toBeTrue();
    expect(await intents.confirmed()).toBeTrue();
    showRegistrationStep();
    component.registerForm.patchValue({
      name: "Ana García", email: "ana@example.com", password: "Strong-password-123!",
      confirmPassword: "Strong-password-123!", acceptTerms: true, company: "",
    });

    await component.onRegister();
    fixture.detectChanges();

    expect(component.step()).toBe("verify-pending");
    expect(component.pendingLink()?.expiresAt).toBe(expiresAt);
    expect(component.info()).not.toContain("24 horas");
    expect(fixture.nativeElement.querySelector(".intent-context small").textContent).toContain("antes de que caduque");
    expect(fixture.nativeElement.querySelector(".pending-saved-link").textContent).toContain("si sigue disponible");
  });

  it("does not promise retention while the intent park is still unconfirmed", async () => {
    const park = deferred<{ pending: true; expiresAt: string }>();
    api.post.and.returnValue(park.promise as never);
    const intents = TestBed.inject(PendingLinkIntentService);
    expect(intents.capture("B".repeat(43))).toBeTrue();
    showRegistrationStep();
    component.registerForm.patchValue({
      name: "Ana García", email: "ana@example.com", password: "Strong-password-123!",
      confirmPassword: "Strong-password-123!", acceptTerms: true, company: "",
    });

    await component.onRegister();
    fixture.detectChanges();

    expect(component.step()).toBe("verify-pending");
    expect(component.pendingLink()?.expiresAt).toBeNull();
    expect(component.info()).not.toContain("24 horas");
    expect(fixture.nativeElement.querySelector(".pending-saved-link").textContent).toContain("si sigue disponible");
    park.resolve({ pending: true, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(await intents.confirmed()).toBeTrue();
  });

  it("offers a safe email correction and clears the sessionless registration state", () => {
    setFlow({ kind: "verify-pending", email: "wrong@example.com", source: "browser-registration" });

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

  it("corrects a browser-owned pending email despite an abandoned password mismatch", async () => {
    component.onTabChange(1);
    component.registerForm.patchValue({ name: "Ana García", email: "ana@example.com" });
    await component.nextRegisterStep();
    component.registerForm.patchValue({ password: "Strong-password-123!", confirmPassword: "different-password" });
    expect(component.registerForm.hasError("mismatch")).toBeTrue();
    component.onTabChange(0);
    fixture.detectChanges();
    component.loginForm.setValue({ email: "ana@example.com", password: "unused-password" });
    auth.login.and.rejectWith(new ApiRequestError("Revisa la solicitud", 403, undefined, undefined, "pending_registration"));
    await component.onLogin();
    fixture.detectChanges();

    component.changeRegistrationEmail();
    fixture.detectChanges();
    component.registerForm.controls.email.setValue("correct@example.com");
    await component.nextRegisterStep();
    fixture.detectChanges();
    const submit = fixture.nativeElement.querySelector('#register-panel button[type="submit"]') as HTMLButtonElement;
    expect(fixture.nativeElement.querySelector('[formControlName="password"]')).toBeNull();
    expect(submit.disabled).toBeFalse();
    await component.onRegister();

    expect(auth.changeRegistrationEmail).toHaveBeenCalledOnceWith("ana@example.com", "correct@example.com", {
      captchaToken: "fresh-passcode", website: "",
    });
    expect(auth.register).not.toHaveBeenCalled();
    expect(component.step()).toBe("verify-pending");
    expect(component.verificationEmail()).toBe("correct@example.com");
  });

  it("restores password matching and consent when returning from correction to new registration", async () => {
    component.loginForm.setValue({ email: "ana@example.com", password: "unused-password" });
    auth.login.and.rejectWith(new ApiRequestError("Revisa la solicitud", 403, undefined, undefined, "pending_registration"));
    await component.onLogin();
    component.changeRegistrationEmail();
    fixture.detectChanges();
    component.registerForm.controls.email.setValue("correct@example.com");
    await component.nextRegisterStep();
    fixture.detectChanges();
    expect(component.registerForm.valid).toBeTrue();

    component.onTabChange(1);
    fixture.detectChanges();
    component.registerForm.patchValue({ name: "Ana García", password: "short", confirmPassword: "different-password" });
    await component.nextRegisterStep();
    fixture.detectChanges();
    const submit = fixture.nativeElement.querySelector('#register-panel button[type="submit"]') as HTMLButtonElement;
    expect(fixture.nativeElement.querySelector('[formControlName="password"]')).not.toBeNull();
    expect(component.registerForm.controls.password.hasError("minlength")).toBeTrue();
    expect(component.registerForm.controls.acceptTerms.hasError("required")).toBeTrue();
    expect(component.registerForm.hasError("mismatch")).toBeTrue();
    expect(submit.disabled).toBeTrue();
    await component.onRegister();
    expect(auth.register).not.toHaveBeenCalled();
    expect(auth.changeRegistrationEmail).not.toHaveBeenCalled();
  });

  it("keeps the correct original email through back/next and successive corrections", async () => {
    component.onTabChange(1);
    component.registerForm.patchValue({ name: "Ana García", email: "first@example.com" });
    await component.nextRegisterStep();
    fixture.detectChanges();
    component.registerForm.patchValue({ password: "Strong-password-123!", confirmPassword: "Strong-password-123!", acceptTerms: true });
    await component.onRegister();
    fixture.detectChanges();

    component.changeRegistrationEmail();
    fixture.detectChanges();
    component.registerForm.controls.email.setValue("second@example.com");
    await component.nextRegisterStep();
    component.previousRegisterStep();
    expect(component.registerForm.controls.email.value).toBe("second@example.com");
    await component.nextRegisterStep();
    fixture.detectChanges();
    await component.onRegister();
    fixture.detectChanges();
    component.changeRegistrationEmail();
    fixture.detectChanges();
    component.registerForm.controls.email.setValue("third@example.com");
    await component.nextRegisterStep();
    fixture.detectChanges();
    await component.onRegister();
    fixture.detectChanges();

    expect(auth.changeRegistrationEmail.calls.allArgs()).toEqual([
      ["first@example.com", "second@example.com", { captchaToken: "fresh-passcode", website: "" }],
      ["second@example.com", "third@example.com", { captchaToken: "fresh-passcode", website: "" }],
    ]);
    expect(auth.register).toHaveBeenCalledTimes(1);
    expect(component.verificationEmail()).toBe("third@example.com");
    expect(component.verificationEditable()).toBeTrue();
  });

  it("shows generic verification recovery without retaining the previous browser edit context", async () => {
    component.loginForm.setValue({ email: "owned@example.com", password: "unused-password" });
    auth.login.and.rejectWith(new ApiRequestError("Revisa la solicitud", 403, undefined, undefined, "pending_registration"));
    await component.onLogin();
    component.changeRegistrationEmail();
    component.onTabChange(1);
    component.registerForm.controls.email.setValue("generic@example.com");
    component.openVerificationRecovery();
    fixture.detectChanges();

    expect(component.verificationRecovery()).toBeTrue();
    expect(component.verificationEditable()).toBeFalse();
    expect(component.registeredEmail()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain("¿Te equivocaste de dirección?");
    await component.resendVerification();
    expect(auth.resendVerification).toHaveBeenCalledOnceWith("generic@example.com", "fresh-passcode");
    expect(auth.changeRegistrationEmail).not.toHaveBeenCalled();
  });

  it("uses the legacy account address for resend after closing another pending registration", async () => {
    component.loginForm.setValue({ email: "owned@example.com", password: "unused-password" });
    auth.login.and.rejectWith(new ApiRequestError("Revisa la solicitud", 403, undefined, undefined, "pending_registration"));
    await component.onLogin();
    component.closeRegistration();
    fixture.detectChanges();
    component.loginForm.setValue({ email: "legacy@example.com", password: "correct-password" });
    auth.login.and.rejectWith(new ApiRequestError("Confirma tu email", 403, undefined, undefined, "email_verification_required"));
    await component.onLogin();
    fixture.detectChanges();

    expect(component.verificationEditable()).toBeFalse();
    expect(component.registeredEmail()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain("¿Te equivocaste de dirección?");
    await component.resendVerification();
    expect(auth.resendVerification).toHaveBeenCalledOnceWith("legacy@example.com", "fresh-passcode");
    expect(auth.changeRegistrationEmail).not.toHaveBeenCalled();
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

  it("does not label a password containing a forbidden word strong", () => {
    component.registerForm.patchValue({ name: "Ana", email: "ana@example.test", password: "Orbit-Login-Copper-73!" });
    expect(component.passwordStrength()).toBe("Débil");
    expect(component.passwordRequirements().find(item => item.label === "Sin datos personales ni patrones")?.met).toBeFalse();
  });

  it("updates password matching as confirmation changes", () => {
    component.registerForm.controls.password.setValue("Órbita-Mango-Cobre-47!");
    component.registerForm.controls.confirmPassword.setValue("otra-clave");
    expect(component.passwordsMatch()).toBeFalse();

    component.registerForm.controls.confirmPassword.setValue("Órbita-Mango-Cobre-47!");
    expect(component.passwordsMatch()).toBeTrue();
  });

  it("renders a visible alert for a diverging confirmation instead of only disabling the button", () => {
    component.tabIndex.set(1);
    setFlow({ kind: "register", mode: "new", stage: 2 });
    component.registerForm.controls.password.setValue("Órbita-Mango-Cobre-47!");
    component.registerForm.controls.confirmPassword.setValue("otra-clave-distinta");
    component.registerForm.controls.confirmPassword.markAsTouched();
    fixture.detectChanges();

    // The mismatch is a group-level error: a <mat-error> bound to the (valid)
    // confirm control never renders, so the feedback must survive on its own.
    const alert = fixture.nativeElement.querySelector(".alert.error") as HTMLElement | null;
    expect(alert?.textContent ?? "").toContain("Las contraseñas no coinciden");
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

  it("keeps a wrong password on login without a resend entry", async () => {
    const resendButton = (): HTMLButtonElement | undefined => Array.from(
      fixture.nativeElement.querySelectorAll("button") as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.trim() === "Reenviar enlace");
    component.loginForm.setValue({ email: "ana@example.com", password: "wrong-password" });
    fixture.detectChanges();
    expect(resendButton()).toBeUndefined();

    auth.login.and.rejectWith(new ApiRequestError("Credenciales incorrectas", 401));
    await component.onLogin();
    fixture.detectChanges();

    expect(component.verificationEmail()).toBeNull();
    expect(component.error()).toBe("Credenciales incorrectas");
    expect(component.step()).toBe("login");
    expect(resendButton()).toBeUndefined();
  });

  it("opens the browser registration context without promising account creation or delivery", async () => {
    component.loginForm.setValue({ email: "ana@example.com", password: "unused-password" });
    auth.login.and.rejectWith(new ApiRequestError("Confirma tu email para continuar", 403, undefined, undefined, "pending_registration"));

    await component.onLogin();
    fixture.detectChanges();

    expect(component.step()).toBe("verify-pending");
    expect(component.verificationEmail()).toBe("ana@example.com");
    expect(component.verificationEditable()).toBeTrue();
    expect(component.error()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain("Reenviar enlace");
    expect(fixture.nativeElement.textContent).toContain("Dirección indicada");
    expect(fixture.nativeElement.textContent).toContain("Si ya tienes una cuenta");
    expect(fixture.nativeElement.textContent).not.toContain("Correo enviado a");
  });

  it("opens verification for a legacy unverified account without offering registration edits", async () => {
    component.loginForm.setValue({ email: "ana@example.com", password: "correct-password" });
    auth.login.and.rejectWith(new ApiRequestError("Confirma tu email para continuar", 403, undefined, undefined, "email_verification_required"));

    await component.onLogin();
    fixture.detectChanges();

    expect(component.step()).toBe("verify-pending");
    expect(component.verificationEditable()).toBeFalse();
    expect(fixture.nativeElement.textContent).not.toContain("¿Te equivocaste de dirección?");
    expect(fixture.nativeElement.textContent).toContain("Reenviar enlace");
  });

  it("lets a visitor recover verification from the registration tab with an email only", () => {
    component.onTabChange(1);
    component.registerForm.controls.email.setValue("ANA@example.com");
    fixture.detectChanges();

    component.openVerificationRecovery();
    fixture.detectChanges();

    expect(component.step()).toBe("verify-pending");
    expect(component.verificationEmail()).toBe("ana@example.com");
    expect(component.verificationRecovery()).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain("Solicitar otro enlace de verificación");
    expect(fixture.nativeElement.textContent).not.toContain("Correo enviado a");
  });

  it("asks for the address when the resend entry is used without one", async () => {
    component.loginForm.setValue({ email: "", password: "" });

    await component.resendVerification();

    expect(auth.resendVerification).not.toHaveBeenCalled();
    expect(component.error()).toBe("Escribe tu email para reenviar la verificación.");
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

  for (const method of ["login", "mfa", "recovery"] as const) {
    for (const failure of ["cancelled", "rejected"] as const) {
      it(`offers navigation retry after ${method} succeeds but navigation is ${failure}`, async () => {
        component.loginForm.setValue({ email: "ana@example.com", password: "correct-password" });
        if (method !== "login") {
          await component.onLogin();
          if (method === "recovery") component.goRecovery();
          fixture.detectChanges();
        }
        if (failure === "cancelled") router.navigateByUrl.and.resolveTo(false);
        else router.navigateByUrl.and.rejectWith(new Error("route could not load"));
        if (method === "login") {
          auth.login.and.callFake(async () => {
            authenticated.set(true);
            return { mfaRequired: false, user: {
              id: 1, email: "ana@example.com", name: "Ana", isAdmin: false,
              emailVerified: true, mfaEnabled: false,
            } };
          });
          await component.onLogin();
        } else if (method === "mfa") {
          auth.verifyMfa.and.callFake(async () => { authenticated.set(true); });
          component.mfaForm.controls.code.setValue("123456");
          await component.onMfa();
        } else {
          auth.recoverMfa.and.callFake(async () => { authenticated.set(true); });
          component.recoveryForm.controls.code.setValue("ABCD-EFGH-JKLM-NPQR");
          await component.onRecovery();
        }
        fixture.detectChanges();
        await fixture.whenStable();
        expect(authenticated()).toBeTrue();
        expect(component.error()).toBeNull();
        expect(fixture.nativeElement.textContent).toContain("Tu sesión está iniciada");
        expect(fixture.nativeElement.querySelector(".navigation-retry")).not.toBeNull();
        expect(fixture.nativeElement.textContent).not.toContain("Comprobando tu sesión");
        expect(router.navigateByUrl).toHaveBeenCalledOnceWith("/app");
      });
    }
  }

  for (const failure of ["cancelled", "rejected"] as const) {
    it(`offers retry to an existing session when its initial navigation is ${failure}`, async () => {
      if (failure === "cancelled") router.navigateByUrl.and.resolveTo(false);
      else router.navigateByUrl.and.rejectWith(new Error("route could not load"));
      authenticated.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector(".navigation-retry")).not.toBeNull();
      expect(component.error()).toBeNull();
      expect(router.navigateByUrl).toHaveBeenCalledOnceWith("/app");
    });
  }

  async function failAuthenticatedNavigation(): Promise<void> {
    router.navigateByUrl.and.resolveTo(false);
    authenticated.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it("retries only navigation and keeps focus and the retry control while it is pending", async () => {
    await failAuthenticatedNavigation();
    const response = deferred<boolean>();
    router.navigateByUrl.and.returnValue(response.promise);
    const button = fixture.nativeElement.querySelector(".navigation-retry") as HTMLButtonElement;
    button.focus();
    button.click();
    fixture.detectChanges();
    expect(button.disabled).toBeTrue();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[aria-labelledby="navigation-title"]'));
    expect(fixture.nativeElement.textContent).toContain("Abriendo…");
    await component.retryNavigation();
    expect(router.navigateByUrl).toHaveBeenCalledTimes(2);
    expect(auth.login).not.toHaveBeenCalled();
    expect(auth.verifyMfa).not.toHaveBeenCalled();
    expect(auth.recoverMfa).not.toHaveBeenCalled();
    response.resolve(true);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.navigationBusy()).toBeFalse();
    expect(component.navigationFailure()).toBeNull();
  });

  it("keeps another navigation failure retryable without an automatic retry loop", async () => {
    await failAuthenticatedNavigation();
    await component.retryNavigation();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.navigationFailure()).toBe("/app");
    expect(router.navigateByUrl).toHaveBeenCalledTimes(2);
    expect((fixture.nativeElement.querySelector(".navigation-retry") as HTMLButtonElement).disabled).toBeFalse();
  });

  it("does not retry a destination after the session has been invalidated", async () => {
    await failAuthenticatedNavigation();
    authenticated.set(false);
    await component.retryNavigation();
    fixture.detectChanges();
    expect(component.navigationFailure()).toBeNull();
    expect(fixture.nativeElement.querySelector(".navigation-retry")).toBeNull();
    expect(fixture.nativeElement.querySelector("#login-panel")).not.toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a failed destination for a newer session generation", async () => {
    await failAuthenticatedNavigation();
    auth.sessionGeneration.and.returnValue(1);
    await component.retryNavigation();
    fixture.detectChanges();
    expect(component.navigationFailure()).toBeNull();
    expect(fixture.nativeElement.querySelector(".navigation-retry")).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
  });

  it("ignores navigation failure after the view is destroyed", async () => {
    await failAuthenticatedNavigation();
    const response = deferred<boolean>();
    router.navigateByUrl.and.returnValue(response.promise);
    const retry = component.retryNavigation();
    fixture.destroy();
    response.resolve(true);
    await retry;
    expect(component.navigationFailure()).toBe("/app");
    expect(router.navigateByUrl).toHaveBeenCalledTimes(2);
  });

  it("does not show a late navigation failure after a session is invalidated", async () => {
    await failAuthenticatedNavigation();
    const response = deferred<boolean>();
    router.navigateByUrl.and.returnValue(response.promise);
    const retry = component.retryNavigation();
    authenticated.set(false);
    auth.sessionGeneration.and.returnValue(1);
    response.resolve(false);
    await retry;
    fixture.detectChanges();
    expect(component.navigationBusy()).toBeFalse();
    expect(component.navigationFailure()).toBeNull();
    expect(fixture.nativeElement.querySelector("#login-panel")).not.toBeNull();
  });

  it("does not let an old navigation clear the busy state of a newer login", async () => {
    await failAuthenticatedNavigation();
    const older = deferred<boolean>();
    const newer = deferred<boolean>();
    const entered = deferred<void>();
    router.navigateByUrl.and.callFake(() => {
      if (router.navigateByUrl.calls.count() === 2) return older.promise;
      entered.resolve();
      return newer.promise;
    });
    const retry = component.retryNavigation();
    authenticated.set(false);
    auth.sessionGeneration.and.returnValue(1);
    component.onTabChange(0);
    component.loginForm.setValue({ email: "ana@example.com", password: "correct-password" });
    auth.login.and.callFake(async () => {
      authenticated.set(true);
      return { mfaRequired: false, user: {
        id: 1, email: "ana@example.com", name: "Ana", isAdmin: false,
        emailVerified: true, mfaEnabled: false,
      } };
    });
    fixture.detectChanges();
    const login = component.onLogin();
    await entered.promise;
    expect(router.navigateByUrl).toHaveBeenCalledTimes(3);
    older.resolve(false);
    await retry;
    expect(component.navigationBusy()).toBeTrue();
    expect(component.navigationFailure()).toBeNull();
    newer.resolve(true);
    await login;
    expect(component.navigationBusy()).toBeFalse();
    expect(component.error()).toBeNull();
  });

  for (const [input, destination] of [
    ["/app/settings?tab=security#sessions", "/app/settings?tab=security#sessions"],
    ["/auth/confirm-email#token=fixture", "/auth/confirm-email#token=fixture"],
    ["https://attacker.example", "/app"], ["//attacker.example", "/app"],
    ["/\\attacker.example", "/app"], ["/app\u0000", "/app"],
    [`/app/${"x".repeat(1025)}`, "/app"],
  ]) {
    it(`applies the shared destination rule to interactive login: ${JSON.stringify(input).slice(0, 70)}`, async () => {
      routeParameters["returnTo"] = input;
      auth.login.and.callFake(async () => {
        authenticated.set(true);
        return { mfaRequired: false, user: {
          id: 1, email: "ana@example.com", name: "Ana", isAdmin: false,
          emailVerified: true, mfaEnabled: false,
        } };
      });
      component.loginForm.setValue({ email: "ana@example.com", password: "correct-password" });
      await component.onLogin();
      expect(router.navigateByUrl).toHaveBeenCalledOnceWith(destination);
    });
  }

  for (const recoveryAvailable of [false, true]) {
    it(`offers recovery only when the login response allows it (${recoveryAvailable})`, async () => {
      auth.login.and.resolveTo({ mfaRequired: true, challenge: "login-challenge", recoveryAvailable });
      component.loginForm.setValue({ email: "ana@example.com", password: "Strong-password-123!" });

      await component.onLogin();
      fixture.detectChanges();

      const recoveryButton = fixture.nativeElement.querySelector("button.method-link") as HTMLButtonElement | null;
      expect(recoveryButton !== null).toBe(recoveryAvailable);
      component.goRecovery();
      expect(component.step()).toBe(recoveryAvailable ? "recovery" : "mfa");
      expect(auth.login).toHaveBeenCalledTimes(1);
      expect(auth.verifyMfa).not.toHaveBeenCalled();
      expect(auth.recoverMfa).not.toHaveBeenCalled();
    });
  }

  it("uses the original login challenge after changing MFA methods in both directions", async () => {
    component.loginForm.setValue({ email: "ana@example.com", password: "Strong-password-123!" });
    await component.onLogin();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector("button.method-link") as HTMLButtonElement).click();
    fixture.detectChanges();
    component.recoveryForm.controls.code.setValue("ABCD-EFGH-JKLM-NPQR");

    (fixture.nativeElement.querySelector("button.method-link") as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.step()).toBe("mfa");
    expect(component.recoveryForm.controls.code.value).toBe("");
    component.mfaForm.controls.code.setValue("123456");
    await component.onMfa();

    expect(auth.login).toHaveBeenCalledTimes(1);
    expect(auth.verifyMfa).toHaveBeenCalledOnceWith("mfa-challenge", "123456");
    expect(auth.recoverMfa).not.toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledOnceWith("/app");
  });

  it("uses only the new challenge and recovery policy after an expired recovery attempt", async () => {
    component.loginForm.setValue({ email: "ana@example.com", password: "Strong-password-123!" });
    await component.onLogin();
    component.goRecovery();
    component.recoveryForm.controls.code.setValue("ABCD-EFGH-JKLM-NPQR");
    auth.recoverMfa.and.rejectWith(new ApiRequestError("Sesión MFA caducada", 401));
    await component.onRecovery();
    fixture.detectChanges();
    expect(component.step()).toBe("login");

    auth.login.and.resolveTo({ mfaRequired: true, challenge: "replacement-challenge", recoveryAvailable: false });
    await component.onLogin();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("button.method-link")).toBeNull();
    component.goRecovery();
    expect(component.step()).toBe("mfa");
    component.mfaForm.controls.code.setValue("654321");
    await component.onMfa();

    expect(auth.login).toHaveBeenCalledTimes(2);
    expect(auth.recoverMfa).toHaveBeenCalledOnceWith("mfa-challenge", "ABCD-EFGH-JKLM-NPQR");
    expect(auth.verifyMfa).toHaveBeenCalledOnceWith("replacement-challenge", "654321");
    expect(router.navigateByUrl).toHaveBeenCalledOnceWith("/app");
  });

  it("submits a completed OTP only once while confirmation is pending", async () => {
    const response = deferred<void>();
    auth.verifyMfa.and.returnValue(response.promise);
    component.loginForm.setValue({ email: "ana@example.com", password: "Strong-password-123!" });
    await component.onLogin();
    fixture.detectChanges();
    const first = fixture.nativeElement.querySelector("app-otp-code-input input") as HTMLInputElement;
    first.value = "123456";
    first.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();
    component.onOtpCompleted();
    await component.onMfa();

    expect(first.disabled).toBeTrue();
    expect(auth.verifyMfa).toHaveBeenCalledOnceWith("mfa-challenge", "123456");
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    response.resolve();
    await fixture.whenStable();
    expect(router.navigateByUrl).toHaveBeenCalledOnceWith("/app");
  });

  it("does not navigate when an MFA result belongs to a locally abandoned challenge", async () => {
    const response = deferred<void>();
    auth.verifyMfa.and.returnValue(response.promise);
    setFlow({ kind: "mfa", challenge: "challenge-a", recoveryAvailable: false });
    component.mfaForm.controls.code.setValue("123456");

    const verification = component.onMfa();
    component.restartMfaLogin("Vuelve a iniciar sesión");
    response.resolve();
    await verification;

    expect(component.step()).toBe("login");
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it("does not navigate when a recovery result belongs to a locally abandoned challenge", async () => {
    const response = deferred<void>();
    auth.recoverMfa.and.returnValue(response.promise);
    setFlow({ kind: "recovery", challenge: "challenge-a", recoveryAvailable: false });
    component.recoveryForm.controls.code.setValue("ABCD-EFGH-JKLM-NPQR");

    const recovery = component.onRecovery();
    component.restartMfaLogin("Vuelve a iniciar sesión");
    response.resolve();
    await recovery;

    expect(component.step()).toBe("login");
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it("keeps the MFA method while its confirmation is in flight", async () => {
    const response = deferred<void>();
    auth.verifyMfa.and.returnValue(response.promise);
    setFlow({ kind: "mfa", challenge: "challenge-a", recoveryAvailable: true });
    component.mfaForm.controls.code.setValue("123456");
    fixture.detectChanges();
    const confirmation = component.onMfa();
    fixture.detectChanges();
    const alternative = fixture.nativeElement.querySelector(".method-link") as HTMLButtonElement;
    expect(alternative.disabled).toBeTrue();
    component.goRecovery();
    expect(component.step()).toBe("mfa");
    response.resolve();
    await confirmation;
    expect(router.navigateByUrl).toHaveBeenCalledOnceWith("/app");
  });

  it("keeps the recovery method while its confirmation is in flight", async () => {
    const response = deferred<void>();
    auth.recoverMfa.and.returnValue(response.promise);
    setFlow({ kind: "recovery", challenge: "challenge-a", recoveryAvailable: false });
    component.recoveryForm.controls.code.setValue("ABCD-EFGH-JKLM-NPQR");
    fixture.detectChanges();
    const confirmation = component.onRecovery();
    fixture.detectChanges();
    const alternative = fixture.nativeElement.querySelector("button.method-link") as HTMLButtonElement;
    expect(alternative.disabled).toBeTrue();
    expect(fixture.nativeElement.querySelector("a.method-link").getAttribute("href")).toBeNull();
    component.backToMfa();
    expect(component.step()).toBe("recovery");
    response.resolve();
    await confirmation;
    expect(router.navigateByUrl).toHaveBeenCalledOnceWith("/app");
  });

  it("keeps keyboard focus inside the pending MFA dialog when its controls are disabled", async () => {
    const response = deferred<void>();
    auth.verifyMfa.and.returnValue(response.promise);
    setFlow({ kind: "mfa", challenge: "challenge-a", recoveryAvailable: false });
    component.mfaForm.controls.code.setValue("123456");
    fixture.detectChanges();
    const confirmation = component.onMfa();
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(document.activeElement).toBe(dialog);
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    dialog.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(dialog);
    response.resolve();
    await confirmation;
  });

  it("retains dialog focus when OTP completion automatically starts verification", async () => {
    const response = deferred<void>();
    auth.verifyMfa.and.returnValue(response.promise);
    setFlow({ kind: "mfa", challenge: "challenge-a", recoveryAvailable: false });
    fixture.detectChanges();
    const first = fixture.nativeElement.querySelector("app-otp-code-input input") as HTMLInputElement;
    first.value = "123456";
    first.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();
    expect(component.busy()).toBeTrue();
    expect(auth.verifyMfa).toHaveBeenCalledOnceWith("challenge-a", "123456");
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[role="dialog"]'));
    response.resolve();
    await fixture.whenStable();
  });

  it("clears a rejected MFA code and restores focus to the first box for a new attempt", async () => {
    auth.verifyMfa.and.rejectWith(new ApiRequestError("Código incorrecto", 401));
    setFlow({ kind: "mfa", challenge: "challenge-a", recoveryAvailable: false });
    fixture.detectChanges();
    component.mfaForm.controls.code.setValue("123456");
    await component.onMfa();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.mfaForm.invalid).toBeTrue();
    expect(component.mfaForm.controls.code.value).toBe("");
    const boxes = fixture.nativeElement.querySelectorAll("app-otp-code-input input") as NodeListOf<HTMLInputElement>;
    expect(Array.from(boxes).map(input => input.value)).toEqual(["", "", "", "", "", ""]);
    expect(document.activeElement).toBe(boxes[0]);
    expect(component.error()).toBe("Código incorrecto");
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it("focuses the recovery field when changing methods", async () => {
    setFlow({ kind: "mfa", challenge: "challenge-a", recoveryAvailable: true });
    fixture.detectChanges();
    component.goRecovery();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[formControlName="code"]'));
  });

  it("focuses the login email after an expired MFA challenge", async () => {
    auth.verifyMfa.and.rejectWith(new ApiRequestError("Sesión MFA caducada", 401));
    setFlow({ kind: "mfa", challenge: "challenge-a", recoveryAvailable: false });
    component.mfaForm.controls.code.setValue("123456");
    fixture.detectChanges();
    await component.onMfa();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.step()).toBe("login");
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#login-panel input[type="email"]'));
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
    setFlow({ kind: "verify-pending", email: "ana@example.com", source: "browser-registration" });
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


    expect(fixture.nativeElement.textContent).toContain("Continúa con tu URL");
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
