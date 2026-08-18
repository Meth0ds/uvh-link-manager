import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router, RouterLink, ActivatedRoute } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatTabsModule } from "@angular/material/tabs";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { AuthService } from "../core/services/auth.service";
import { ApiRequestError } from "../core/services/api.service";

type Step = "login" | "register" | "mfa" | "recovery" | "verify-pending";

@Component({
  selector: "app-auth",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTabsModule,
    MatIconModule,
    MatProgressBarModule,
  ],
  templateUrl: "./auth.component.html",
  styleUrl: "./auth.component.scss",
})
export class AuthComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly step = signal<Step>("login");
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);
  readonly mfaChallenge = signal<string | null>(null);
  readonly hidePassword = signal(true);

  readonly tabIndex = signal(0);

  loginForm = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ["", [Validators.required]],
  });

  registerForm = this.fb.nonNullable.group({
    name: ["", [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    email: ["", [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ["", [Validators.required, Validators.minLength(10), Validators.maxLength(128)]],
  });

  mfaForm = this.fb.nonNullable.group({
    code: ["", [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  recoveryForm = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
    code: ["", [Validators.required]],
  });

  private returnTo(): string {
    const rt = this.route.snapshot.queryParamMap.get("returnTo");
    // Only internal single-slash paths: reject protocol-relative ("//host")
    // and backslash variants that other consumers could treat as external.
    if (rt && rt.startsWith("/") && !rt.startsWith("//") && !rt.startsWith("/\\")) return rt;
    return "/app";
  }

  onTabChange(index: number): void {
    this.tabIndex.set(index);
    this.step.set(index === 0 ? "login" : "register");
    this.error.set(null);
    this.info.set(null);
  }

  async onLogin(): Promise<void> {
    if (this.loginForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
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
        this.router.navigateByUrl(this.returnTo());
      }
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo iniciar sesión");
    } finally {
      this.busy.set(false);
    }
  }

  async onMfa(): Promise<void> {
    if (this.mfaForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.verifyMfa(this.mfaChallenge()!, this.mfaForm.controls.code.value);
      this.router.navigateByUrl(this.returnTo());
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "Código incorrecto");
    } finally {
      this.busy.set(false);
    }
  }

  async onRecovery(): Promise<void> {
    if (this.recoveryForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.recoverMfa(
        this.recoveryForm.controls.email.value.toLowerCase(),
        this.recoveryForm.controls.code.value,
      );
      this.router.navigateByUrl(this.returnTo());
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "Código de recuperación incorrecto");
    } finally {
      this.busy.set(false);
    }
  }

  async onRegister(): Promise<void> {
    if (this.registerForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.register(
        this.registerForm.controls.name.value,
        this.registerForm.controls.email.value.toLowerCase(),
        this.registerForm.controls.password.value,
      );
      this.step.set("verify-pending");
      this.info.set("Te hemos enviado un correo para verificar tu email. Revisa tu bandeja de entrada.");
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo crear la cuenta");
    } finally {
      this.busy.set(false);
    }
  }

  goForgot(): void {
    this.router.navigate(["/auth/forgot-password"]);
  }
  goRecovery(): void {
    this.step.set("recovery");
    this.error.set(null);
    this.info.set("Usa uno de tus códigos de recuperación de MFA.");
  }
  backToLogin(): void {
    this.step.set("login");
    this.error.set(null);
    this.info.set(null);
  }
}
