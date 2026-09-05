import { FormBuilder } from "@angular/forms";
import { provideRouter, Router } from "@angular/router";
import { ActivatedRoute } from "@angular/router";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { Component, EventEmitter, Input, Output, signal } from "@angular/core";
import { AuthComponent } from "./auth.component";
import { AuthService } from "../core/services/auth.service";
import { ApiService } from "../core/services/api.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { HCaptchaWidgetComponent } from "./hcaptcha-widget.component";

@Component({ selector: "app-hcaptcha-widget", standalone: true, template: "" })
class FakeHCaptchaWidgetComponent {
  @Input() siteKey = "";
  @Output() readonly tokenChange = new EventEmitter<string>();
  reset(): void { this.tokenChange.emit(""); }
}

describe("AuthComponent registration flow", () => {
  let fixture: ComponentFixture<AuthComponent>;
  let component: AuthComponent;
  let api: jasmine.SpyObj<ApiService>;
  let auth: jasmine.SpyObj<AuthService>;

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
    Object.assign(auth, {
      loaded: signal(true),
      authenticated: signal(false),
    });

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
          useValue: { navigate: jasmine.createSpy("navigate"), navigateByUrl: jasmine.createSpy("navigateByUrl") },
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

  it("loads only the public hCaptcha sitekey for both access modes", async () => {
    component.registerForm.controls.name.setValue("Ana García");
    component.registerForm.controls.email.setValue("ana@example.com");
    await component.nextRegisterStep();

    expect(component.registerStep()).toBe(2);
    expect(api.get).toHaveBeenCalledWith("/api/v1/config");
    expect(component.hcaptchaSiteKey()).toBe("10000000-ffff-ffff-ffff-000000000001");
    expect(JSON.stringify(api.get.calls.mostRecent().returnValue)).not.toContain("HCAPTCHA_SECRET");
  });

  it("requires consent and matching passwords before submitting", async () => {
    component.registerStep.set(2);
    component.onRegisterCaptchaToken("registration-passcode");
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
    component.registerStep.set(2);
    component.onRegisterCaptchaToken("registration-passcode");
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
        captchaToken: "registration-passcode",
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

  it("offers a safe email correction and logout from the success state", async () => {
    component.registeredEmail.set("wrong@example.com");
    component.verificationEmail.set("wrong@example.com");
    component.step.set("verify-pending");

    component.changeRegistrationEmail();
    expect(component.changeEmailMode()).toBeTrue();
    expect(component.registerStep()).toBe(1);
    expect(component.registerForm.controls.email.value).toBe("wrong@example.com");

    await component.closeRegistration();
    expect(auth.logout).toHaveBeenCalled();
    expect(component.step()).toBe("login");
    expect(component.verificationEmail()).toBeNull();
  });

  it("does not submit when the honeypot contains a value", async () => {
    component.registerStep.set(2);
    component.onRegisterCaptchaToken("registration-passcode");
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

  it("requires an hCaptcha passcode and sends it with login", async () => {
    component.loginForm.setValue({ email: "ana@example.com", password: "correct-password" });

    await component.onLogin();
    expect(auth.login).not.toHaveBeenCalled();
    expect(component.error()).toContain("Completa hCaptcha");

    component.onLoginCaptchaToken("login-passcode");
    await component.onLogin();

    expect(auth.login).toHaveBeenCalledWith("ana@example.com", "correct-password", "login-passcode");
    expect(component.step()).toBe("mfa");
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
    expect(fixture.nativeElement.textContent).toContain("Crea tu espacio de trabajo");
  });
});
