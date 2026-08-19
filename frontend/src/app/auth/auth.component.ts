import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatTabsModule } from "@angular/material/tabs";
import { AuthShellComponent } from "./auth-shell.component";
import { AuthService } from "../core/services/auth.service";
import { ApiRequestError, ApiService } from "../core/services/api.service";

type Step = "login" | "register" | "mfa" | "recovery" | "verify-pending";
type RegisterStep = 1 | 2;

const TERMS_VERSION = "2026-08-19";

interface CaptchaChallenge {
  challenge: string;
  prompt: string;
}

@Component({
  selector: "app-auth",
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatTabsModule,
    MatIconModule,
    MatProgressBarModule,
    AuthShellComponent,
  ],
  templateUrl: "./auth.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./auth.component.scss",
})
export class AuthComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly step = signal<Step>("login");
  readonly registerStep = signal<RegisterStep>(1);
  readonly busy = signal(false);
  readonly captchaBusy = signal(false);
  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);
  readonly verificationEmail = signal<string | null>(null);
  readonly registeredEmail = signal<string | null>(null);
  readonly changeEmailMode = signal(false);
  readonly verificationBusy = signal(false);
  readonly mfaChallenge = signal<string | null>(null);
  readonly captcha = signal<CaptchaChallenge | null>(null);
  readonly hidePassword = signal(true);
  readonly tabIndex = signal(0);

  readonly passwordScore = computed(() => {
    const password = this.registerForm.controls.password.value;
    if (!password) return 0;
    let score = 0;
    if (password.length >= 10) score += 25;
    if (password.length >= 14) score += 15;
    if (/[a-z]/.test(password)) score += 15;
    if (/[A-Z]/.test(password)) score += 15;
    if (/\d/.test(password)) score += 15;
    if (/[^A-Za-z0-9]/.test(password)) score += 15;
    return Math.min(score, 100);
  });

  readonly passwordStrength = computed(() => {
    const score = this.passwordScore();
    if (score >= 85) return "Fuerte";
    if (score >= 60) return "Buena";
    if (score >= 30) return "Mejorable";
    return "Débil";
  });

  readonly passwordClass = computed(() => {
    const score = this.passwordScore();
    return score >= 85 ? "strong" : score >= 60 ? "good" : score >= 30 ? "fair" : "weak";
  });

  readonly passwordsMatch = computed(() => {
    const password = this.registerForm.controls.password.value;
    const confirmation = this.registerForm.controls.confirmPassword.value;
    return !confirmation || password === confirmation;
  });

  /** Notices produced after registration/resend, excluding the static success copy. */
  readonly pendingNotice = computed(() => {
    const notice = this.info();
    return notice && !notice.startsWith("¡Cuenta creada") ? notice : null;
  });

  readonly loginForm = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ["", [Validators.required, Validators.maxLength(128)]],
  });

  readonly registerForm = this.fb.nonNullable.group(
    {
      name: ["", [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
      email: ["", [Validators.required, Validators.email, Validators.maxLength(254)]],
      password: ["", [Validators.required, Validators.minLength(10), Validators.maxLength(128)]],
      confirmPassword: ["", [Validators.required, Validators.maxLength(128)]],
      captchaAnswer: ["", [Validators.required, Validators.pattern(/^\d{1,4}$/)]],
      acceptTerms: [false, [Validators.requiredTrue]],
      // Honeypot: real users never see or fill this field. The server rejects
      // it, adding a cheap signal against unsophisticated registration bots.
      company: ["", [Validators.maxLength(120)]],
    },
    {
      validators: (group) => {
        const password = group.get("password")?.value;
        const confirmation = group.get("confirmPassword")?.value;
        return password === confirmation ? null : { mismatch: true };
      },
    },
  );

  readonly mfaForm = this.fb.nonNullable.group({
    code: ["", [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  readonly recoveryForm = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email, Validators.maxLength(254)]],
    code: ["", [Validators.required, Validators.maxLength(128)]],
  });

  constructor() {
    if (this.route.snapshot.queryParamMap.get("reason") === "session-expired") {
      this.info.set("Tu sesión ya no está activa. Inicia sesión de nuevo para continuar.");
    }
  }

  onTabChange(index: number): void {
    this.tabIndex.set(index);
    this.step.set(index === 0 ? "login" : "register");
    this.registerStep.set(1);
    this.changeEmailMode.set(false);
    this.verificationEmail.set(null);
    this.error.set(null);
    this.info.set(null);
    if (index === 1 && !this.captcha()) void this.refreshCaptcha();
  }

  async refreshCaptcha(): Promise<void> {
    if (this.captchaBusy()) return;
    this.captchaBusy.set(true);
    this.captcha.set(null);
    this.registerForm.controls.captchaAnswer.reset();
    try {
      const challenge = await this.api.get<CaptchaChallenge>("/api/v1/auth/captcha");
      this.captcha.set(challenge);
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo cargar la verificación humana");
    } finally {
      this.captchaBusy.set(false);
    }
  }

  nextRegisterStep(): void {
    const fields = [this.registerForm.controls.name, this.registerForm.controls.email];
    fields.forEach((control) => control.markAsTouched());
    if (fields.some((control) => control.invalid)) return;

    this.error.set(null);
    this.info.set(null);
    this.registerStep.set(2);
    if (!this.captcha()) void this.refreshCaptcha();
  }

  previousRegisterStep(): void {
    this.error.set(null);
    this.info.set(null);
    this.registerStep.set(1);
  }

  async onLogin(): Promise<void> {
    if (this.loginForm.invalid || this.busy()) {
      this.loginForm.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.verificationEmail.set(null);
    try {
      const outcome = await this.auth.login(
        this.loginForm.controls.email.value.toLowerCase(),
        this.loginForm.controls.password.value,
      );
      if (outcome.mfaRequired) {
        this.mfaChallenge.set(outcome.challenge);
        this.step.set("mfa");
        this.info.set("Introduce el código de 6 dígitos de tu aplicación de autenticación.");
      } else {
        await this.router.navigateByUrl(this.returnTo());
      }
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        err.status === 403 &&
        err.message === "Verifica tu email para continuar"
      ) {
        // Login never creates a session for an unverified account. Keep the
        // address locally only to offer the safe public resend action.
        this.verificationEmail.set(this.loginForm.controls.email.value.trim().toLowerCase());
      }
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo iniciar sesión");
    } finally {
      this.busy.set(false);
    }
  }

  async onMfa(): Promise<void> {
    if (this.mfaForm.invalid || this.busy()) {
      this.mfaForm.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.verifyMfa(this.mfaChallenge()!, this.mfaForm.controls.code.value);
      await this.router.navigateByUrl(this.returnTo());
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "Código incorrecto");
    } finally {
      this.busy.set(false);
    }
  }

  async onRecovery(): Promise<void> {
    if (this.recoveryForm.invalid || this.busy()) {
      this.recoveryForm.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.recoverMfa(
        this.recoveryForm.controls.email.value.toLowerCase(),
        this.recoveryForm.controls.code.value,
      );
      await this.router.navigateByUrl(this.returnTo());
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "Código de recuperación incorrecto");
    } finally {
      this.busy.set(false);
    }
  }

  async onRegister(): Promise<void> {
    this.registerForm.markAllAsTouched();
    if (this.registerStep() !== 2 || this.registerForm.invalid || this.busy() || !this.captcha()) return;
    if (this.registerForm.controls.company.value.trim() !== "") {
      this.error.set("No se pudo crear la cuenta");
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      const email = this.registerForm.controls.email.value.trim().toLowerCase();
      const antiBot = {
        captchaChallenge: this.captcha()!.challenge,
        captchaAnswer: this.registerForm.controls.captchaAnswer.value.trim(),
        website: this.registerForm.controls.company.value,
      };
      if (this.changeEmailMode()) {
        const currentEmail = this.registeredEmail();
        if (!currentEmail) {
          this.error.set("No hay un registro pendiente que actualizar");
          return;
        }
        if (currentEmail.toLowerCase() === email) {
          this.error.set("Introduce una dirección de email distinta");
          return;
        }
        await this.auth.changeRegistrationEmail(
          currentEmail,
          email,
          this.registerForm.controls.password.value,
          antiBot,
        );
      } else {
        await this.auth.register(
          this.registerForm.controls.name.value,
          email,
          this.registerForm.controls.password.value,
          {
            ...antiBot,
            acceptTerms: this.registerForm.controls.acceptTerms.value,
            termsVersion: TERMS_VERSION,
          },
        );
      }
      this.registeredEmail.set(email);
      this.verificationEmail.set(email);
      this.changeEmailMode.set(false);
      this.step.set("verify-pending");
      this.info.set("¡Cuenta creada! Para continuar debes confirmar tu email. Revisa tu bandeja de entrada.");
      this.captcha.set(null);
      this.registerForm.controls.captchaAnswer.reset();
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo crear la cuenta");
      // A failed challenge is disposable. Refreshing avoids making the user
      // guess against a stale challenge and keeps the final state deterministic.
      void this.refreshCaptcha();
    } finally {
      this.busy.set(false);
    }
  }

  async resendVerification(): Promise<void> {
    const email = this.verificationEmail() ?? this.loginForm.controls.email.value.trim().toLowerCase();
    if (!email || this.verificationBusy()) return;
    this.verificationBusy.set(true);
    this.error.set(null);
    try {
      await this.auth.resendVerification(email);
      this.info.set("Si la cuenta necesita verificación, recibirás un nuevo correo en breve. Revisa también spam.");
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo reenviar el correo");
    } finally {
      this.verificationBusy.set(false);
    }
  }

  changeRegistrationEmail(): void {
    const email = this.registeredEmail() ?? this.verificationEmail();
    if (!email) return;
    this.tabIndex.set(1);
    this.step.set("register");
    this.registerStep.set(1);
    this.changeEmailMode.set(true);
    this.registerForm.controls.email.setValue(email);
    this.captcha.set(null);
    this.registerForm.controls.captchaAnswer.reset();
    this.error.set(null);
    this.info.set("Corrige el email y confirma el cambio con tu contraseña. Te enviaremos la verificación a la nueva dirección.");
  }

  closeRegistration(): void {
    void this.auth.logout();
    this.changeEmailMode.set(false);
    this.registeredEmail.set(null);
    this.verificationEmail.set(null);
    this.captcha.set(null);
    this.registerStep.set(1);
    this.registerForm.reset({
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      captchaAnswer: "",
      acceptTerms: false,
      company: "",
    });
    this.tabIndex.set(0);
    this.step.set("login");
    this.error.set(null);
    this.info.set("Sesión cerrada. Puedes volver cuando quieras.");
  }

  goForgot(): void {
    void this.router.navigate(["/auth/forgot-password"]);
  }

  goRecovery(): void {
    this.step.set("recovery");
    this.error.set(null);
    this.info.set("Usa uno de tus códigos de recuperación de MFA.");
  }

  backToLogin(): void {
    this.tabIndex.set(0);
    this.step.set("login");
    this.changeEmailMode.set(false);
    this.error.set(null);
    this.info.set(null);
  }

  private returnTo(): string {
    const rt = this.route.snapshot.queryParamMap.get("returnTo") ?? "";
    // Only internal single-slash paths: reject protocol-relative URLs,
    // backslashes, control characters and unbounded query payloads.
    if (
      rt.startsWith("/") &&
      !rt.startsWith("//") &&
      !rt.includes("\\") &&
      !/[\u0000-\u001f\u007f]/.test(rt) &&
      rt.length <= 1024
    ) {
      return rt;
    }
    return "/app";
  }
}
