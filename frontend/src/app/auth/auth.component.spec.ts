import { FormBuilder } from "@angular/forms";
import { provideRouter, Router } from "@angular/router";
import { ActivatedRoute } from "@angular/router";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { AuthComponent } from "./auth.component";
import { AuthService } from "../core/services/auth.service";
import { ApiService } from "../core/services/api.service";

describe("AuthComponent registration flow", () => {
  let fixture: ComponentFixture<AuthComponent>;
  let component: AuthComponent;
  let api: jasmine.SpyObj<ApiService>;
  let auth: jasmine.SpyObj<AuthService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get"]);
    api.get.and.resolveTo({ challenge: "challenge-1", prompt: "¿Cuánto es 12 + 3?", expiresIn: 300 });
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
    }).compileComponents();

    fixture = TestBed.createComponent(AuthComponent);
    component = fixture.componentInstance;
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

  it("loads an opaque CAPTCHA when advancing to the security step", async () => {
    component.registerForm.controls.name.setValue("Ana García");
    component.registerForm.controls.email.setValue("ana@example.com");
    component.nextRegisterStep();
    await fixture.whenStable();

    expect(component.registerStep()).toBe(2);
    expect(api.get).toHaveBeenCalledWith("/api/v1/auth/captcha");
    expect(component.captcha()?.challenge).toBe("challenge-1");
  });

  it("requires consent and matching passwords before submitting", async () => {
    component.registerStep.set(2);
    await component.refreshCaptcha();
    component.registerForm.patchValue({
      name: "Ana García",
      email: "ana@example.com",
      password: "Strong-password-123!",
      confirmPassword: "different-password",
      captchaAnswer: "15",
    });

    await component.onRegister();

    expect(auth.register).not.toHaveBeenCalled();
    expect(component.registerForm.controls.acceptTerms.hasError("required")).toBeTrue();
    expect(component.registerForm.hasError("mismatch")).toBeTrue();
  });

  it("submits the CAPTCHA and consent, then shows email verification state", async () => {
    component.registerStep.set(2);
    await component.refreshCaptcha();
    component.registerForm.patchValue({
      name: "Ana García",
      email: "ana@example.com",
      password: "Strong-password-123!",
      confirmPassword: "Strong-password-123!",
      captchaAnswer: "15",
      acceptTerms: true,
      company: "",
    });

    await component.onRegister();

    expect(auth.register).toHaveBeenCalledWith(
      "Ana García",
      "ana@example.com",
      "Strong-password-123!",
      {
        captchaChallenge: "challenge-1",
        captchaAnswer: "15",
        website: "",
        acceptTerms: true,
        termsVersion: "2026-08-19",
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
    await component.refreshCaptcha();
    component.registerForm.patchValue({
      name: "Bot",
      email: "bot@example.com",
      password: "Strong-password-123!",
      confirmPassword: "Strong-password-123!",
      captchaAnswer: "15",
      acceptTerms: true,
      company: "filled-by-bot",
    });

    await component.onRegister();

    expect(auth.register).not.toHaveBeenCalled();
    expect(component.error()).toBe("No se pudo crear la cuenta");
  });
});
