import { ChangeDetectionStrategy, Component, DestroyRef, ViewChild, computed, effect, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { AuthShellComponent } from "./auth-shell.component";
import { AuthService } from "../core/services/auth.service";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { decodePublicConfig } from "../core/services/public-response-decoders";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { PendingInvitationService } from "../core/services/pending-invitation.service";
import { HCaptchaWidgetComponent } from "./hcaptcha-widget.component";

type Step = "login" | "register" | "mfa" | "recovery" | "verify-pending";
type RegisterStep = 1 | 2;

const TERMS_VERSION = "2026-08-30";
const PRIVACY_VERSION = "2026-08-30";

interface PasswordAssessment {
  score: number;
  common: boolean;
  personal: boolean;
  patterned: boolean;
  feedback: string;
}

interface PublicAuthConfig {
  hcaptcha?: {
    enabled?: boolean;
    siteKey?: string | null;
  };
}

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function assessPassword(password: string, name: string, email: string): PasswordAssessment {
  if (!password) return { score: 0, common: false, personal: false, patterned: false, feedback: "Empieza con una frase larga que no uses en ningún otro sitio." };

  const lower = normalized(password);
  const commonTerms = ["password", "contrasena", "qwerty", "admin", "welcome", "bienvenido", "letmein", "iloveyou", "123456", "uvh"];
  const common = commonTerms.some((term) => lower.includes(term));
  const patterned = /(.)\1{2,}/u.test(password)
    || ["0123", "1234", "2345", "3456", "4567", "5678", "6789", "9876", "abcd", "bcde", "cdef", "qwer", "asdf"].some((sequence) => lower.includes(sequence));
  const personalTerms = [
    ...normalized(name).split(/[^a-z0-9]+/),
    normalized(email.split("@")[0] ?? ""),
  ].filter((term) => term.length >= 3);
  const personal = personalTerms.some((term) => lower.includes(term));
  const classes = [/[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  const uniqueRatio = new Set([...password]).size / Math.max(1, [...password].length);

  let score = Math.min(42, password.length * 3) + classes * 9 + Math.round(uniqueRatio * 12);
  if (password.length >= 14) score += 8;
  if (password.length >= 18) score += 8;
  if (common) score -= 38;
  if (patterned) score -= 24;
  if (personal) score -= 28;
  if (password.length < 10) score = Math.min(score, 24);
  score = Math.max(0, Math.min(100, score));

  let feedback = "Buena base. Una frase única y larga es más fácil de recordar y más difícil de adivinar.";
  if (common) feedback = "Evita palabras y contraseñas habituales: son las primeras que prueba un atacante.";
  else if (personal) feedback = "No incluyas tu nombre ni la parte visible de tu email.";
  else if (patterned) feedback = "Sustituye secuencias y repeticiones previsibles por palabras no relacionadas.";
  else if (password.length < 10) feedback = "Añade más caracteres: el mínimo es 10 y recomendamos una frase más larga.";
  else if (classes < 3 && password.length < 16) feedback = "Hazla más larga o combina tipos de caracteres para reducir patrones previsibles.";

  return { score, common, personal, patterned, feedback };
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
    MatIconModule,
    MatProgressBarModule,
    AuthShellComponent,
    HCaptchaWidgetComponent,
  ],
  templateUrl: "./auth.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./auth.component.scss",
})
export class AuthComponent {
  @ViewChild("loginCaptcha") private loginCaptchaWidget?: HCaptchaWidgetComponent;
  @ViewChild("registerCaptcha") private registerCaptchaWidget?: HCaptchaWidgetComponent;
  @ViewChild("resendCaptcha") private resendCaptchaWidget?: HCaptchaWidgetComponent;

  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly intents = inject(PendingLinkIntentService);
  private readonly invitations = inject(PendingInvitationService);
  private readonly destroyRef = inject(DestroyRef);
  private redirectedAuthenticatedVisitor = false;
  private interactiveAuthStarted = false;
  private flowRevision = 0;
  private verificationRevision = 0;
  private captchaConfigRevision = 0;

  readonly step = signal<Step>("login");
  readonly registerStep = signal<RegisterStep>(1);
  readonly busy = signal(false);
  readonly captchaConfigBusy = signal(true);
  readonly captchaConfigError = signal<string | null>(null);
  readonly hcaptchaSiteKey = signal("");
  readonly loginCaptchaToken = signal("");
  readonly registerCaptchaToken = signal("");
  readonly resendCaptchaToken = signal("");
  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);
  readonly verificationEmail = signal<string | null>(null);
  readonly registeredEmail = signal<string | null>(null);
  readonly changeEmailMode = signal(false);
  readonly verificationBusy = signal(false);
  readonly mfaChallenge = signal<string | null>(null);
  readonly mfaRecoveryAvailable = signal(false);
  readonly hidePassword = signal(true);
  readonly tabIndex = signal(0);
  readonly pendingLink = this.intents.pending;
  readonly intentStorageFallback = this.intents.usingSessionFallback;

  /** Notices produced after registration/resend, excluding the static success copy. */
  readonly pendingNotice = computed(() => {
    const notice = this.info();
    return notice && !notice.startsWith("¡Cuenta creada") ? notice : null;
  });

  readonly loginForm = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ["", [Validators.required, Validators.maxLength(72)]],
  });

  readonly registerForm = this.fb.nonNullable.group(
    {
      name: ["", [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
      email: ["", [Validators.required, Validators.email, Validators.maxLength(254)]],
      password: ["", [Validators.required, Validators.minLength(10), Validators.maxLength(72)]],
      confirmPassword: ["", [Validators.required, Validators.maxLength(72)]],
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
    code: ["", [Validators.required, Validators.pattern(/^[A-Za-z2-9\s-]{16,24}$/)]],
  });

  // Reactive Forms values are Observables, not signals. Converting them is
  // essential: a computed() that reads control.value directly never updates.
  private readonly passwordValue = toSignal(this.registerForm.controls.password.valueChanges, {
    initialValue: this.registerForm.controls.password.value,
  });
  private readonly confirmationValue = toSignal(this.registerForm.controls.confirmPassword.valueChanges, {
    initialValue: this.registerForm.controls.confirmPassword.value,
  });
  private readonly nameValue = toSignal(this.registerForm.controls.name.valueChanges, {
    initialValue: this.registerForm.controls.name.value,
  });
  private readonly emailValue = toSignal(this.registerForm.controls.email.valueChanges, {
    initialValue: this.registerForm.controls.email.value,
  });
  readonly passwordAssessment = computed(() => assessPassword(this.passwordValue(), this.nameValue(), this.emailValue()));
  readonly passwordScore = computed(() => this.passwordAssessment().score);
  readonly passwordStrength = computed(() => {
    const score = this.passwordScore();
    if (score >= 82) return "Fuerte";
    if (score >= 58) return "Buena";
    if (score >= 30) return "Mejorable";
    return "Débil";
  });
  readonly passwordClass = computed(() => {
    const score = this.passwordScore();
    return score >= 82 ? "strong" : score >= 58 ? "good" : score >= 30 ? "fair" : "weak";
  });
  readonly passwordsMatch = computed(() => !this.confirmationValue() || this.passwordValue() === this.confirmationValue());
  readonly passwordRequirements = computed(() => {
    const password = this.passwordValue();
    const assessment = this.passwordAssessment();
    return [
      { label: "10 o más caracteres", met: password.length >= 10 },
      { label: "Mayúsculas y minúsculas", met: /[a-z]/.test(password) && /[A-Z]/.test(password) },
      { label: "Número o símbolo", met: /\d/.test(password) || /[^A-Za-z0-9]/.test(password) },
      { label: "Sin datos personales ni patrones", met: !!password && !assessment.common && !assessment.personal && !assessment.patterned },
    ];
  });

  constructor() {
    void this.loadCaptchaConfiguration();
    const routeIntent = this.route.snapshot.queryParamMap.get("intent");
    const registerMode = this.route.snapshot.queryParamMap.get("mode") === "register";
    const capturedIntent = routeIntent ? this.intents.capture(routeIntent) : false;
    if (routeIntent) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { intent: null },
        queryParamsHandling: "merge",
        replaceUrl: true,
      });
    }
    if (capturedIntent || registerMode) {
      this.tabIndex.set(1);
      this.step.set("register");
    }
    if (this.route.snapshot.queryParamMap.get("reason") === "session-expired") {
      this.info.set("Tu sesión ya no está activa. Inicia sesión de nuevo para continuar.");
    }

    effect(() => {
      if (
        this.redirectedAuthenticatedVisitor
        || this.interactiveAuthStarted
        || !this.auth.loaded()
        || !this.auth.authenticated()
      ) return;
      this.redirectedAuthenticatedVisitor = true;
      void this.router.navigateByUrl(this.returnTo());
    });
  }

  onTabChange(index: number): void {
    this.invalidateFlow();
    this.tabIndex.set(index);
    this.step.set(index === 0 ? "login" : "register");
    this.registerStep.set(1);
    this.changeEmailMode.set(false);
    this.verificationEmail.set(null);
    this.error.set(null);
    this.info.set(null);
  }

  onAuthTabKeydown(event: KeyboardEvent, currentIndex: number): void {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % 2;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex + 1) % 2;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = 1;
    if (nextIndex === null) return;

    event.preventDefault();
    this.onTabChange(nextIndex);
    const tabButtons = (event.currentTarget as HTMLElement | null)?.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    tabButtons?.item(nextIndex).focus();
  }

  async nextRegisterStep(): Promise<void> {
    const fields = [this.registerForm.controls.name, this.registerForm.controls.email];
    fields.forEach((control) => control.markAsTouched());
    if (fields.some((control) => control.invalid)) return;

    this.error.set(null);
    this.info.set(null);
    this.registerStep.set(2);
  }

  previousRegisterStep(): void {
    this.invalidateFlow();
    this.error.set(null);
    this.info.set(null);
    this.registerStep.set(1);
  }

  async onLogin(): Promise<void> {
    if (this.loginForm.invalid || this.busy() || !this.loginCaptchaToken()) {
      this.loginForm.markAllAsTouched();
      if (!this.loginCaptchaToken()) this.error.set("Completa hCaptcha para continuar.");
      return;
    }
    const revision = ++this.flowRevision;
    const destination = this.returnTo();
    this.interactiveAuthStarted = true;
    this.busy.set(true);
    this.error.set(null);
    this.verificationEmail.set(null);
    try {
      const outcome = await this.auth.login(
        this.loginForm.controls.email.value.toLowerCase(),
        this.loginForm.controls.password.value,
        this.loginCaptchaToken(),
      );
      if (!this.isFlowCurrent(revision) || this.step() !== "login") return;
      if (outcome.mfaRequired) {
        this.mfaChallenge.set(outcome.challenge);
        this.mfaRecoveryAvailable.set(outcome.recoveryAvailable);
        this.mfaForm.reset();
        this.recoveryForm.reset();
        this.step.set("mfa");
        this.info.set(null);
      } else {
        this.redirectedAuthenticatedVisitor = true;
        await this.router.navigateByUrl(destination);
      }
    } catch (err) {
      if (!this.isFlowCurrent(revision) || this.step() !== "login") return;
      this.interactiveAuthStarted = false;
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
      this.loginCaptchaToken.set("");
      this.loginCaptchaWidget?.reset();
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }

  async onMfa(): Promise<void> {
    if (this.mfaForm.invalid || this.busy()) {
      this.mfaForm.markAllAsTouched();
      return;
    }
    const revision = ++this.flowRevision;
    const destination = this.returnTo();
    this.busy.set(true);
    this.error.set(null);
    try {
      const challenge = this.mfaChallenge();
      if (!challenge) {
        this.restartMfaLogin("La verificación ha caducado. Introduce de nuevo tus credenciales.");
        return;
      }
      await this.auth.verifyMfa(challenge, this.mfaForm.controls.code.value);
      if (!this.isFlowCurrent(revision) || this.step() !== "mfa" || this.mfaChallenge() !== challenge) return;
      this.redirectedAuthenticatedVisitor = true;
      await this.router.navigateByUrl(destination);
    } catch (err) {
      if (!this.isFlowCurrent(revision) || this.step() !== "mfa") return;
      const message = err instanceof ApiRequestError ? err.message : "Código incorrecto";
      if (message === "Sesión MFA caducada") this.restartMfaLogin("La verificación ha caducado. Introduce de nuevo tus credenciales.");
      else this.error.set(message);
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }

  async onRecovery(): Promise<void> {
    if (this.recoveryForm.invalid || this.busy()) {
      this.recoveryForm.markAllAsTouched();
      return;
    }
    const revision = ++this.flowRevision;
    const destination = this.returnTo();
    this.busy.set(true);
    this.error.set(null);
    try {
      const challenge = this.mfaChallenge();
      if (!challenge) {
        this.restartMfaLogin("La verificación ha caducado. Introduce de nuevo tus credenciales.");
        return;
      }
      await this.auth.recoverMfa(challenge, this.recoveryForm.controls.code.value);
      if (!this.isFlowCurrent(revision) || this.step() !== "recovery" || this.mfaChallenge() !== challenge) return;
      this.redirectedAuthenticatedVisitor = true;
      await this.router.navigateByUrl(destination);
    } catch (err) {
      if (!this.isFlowCurrent(revision) || this.step() !== "recovery") return;
      const message = err instanceof ApiRequestError ? err.message : "Código de recuperación incorrecto";
      if (message === "Sesión MFA caducada") this.restartMfaLogin("La verificación ha caducado. Introduce de nuevo tus credenciales.");
      else this.error.set(message);
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }

  async onRegister(): Promise<void> {
    this.registerForm.markAllAsTouched();
    if (this.registerStep() !== 2 || this.registerForm.invalid || this.busy() || !this.registerCaptchaToken()) {
      if (!this.registerCaptchaToken()) this.error.set("Completa hCaptcha para continuar.");
      return;
    }
    if (this.registerForm.controls.company.value.trim() !== "") {
      this.error.set("No se pudo crear la cuenta");
      return;
    }

    const revision = ++this.flowRevision;
    this.busy.set(true);
    this.error.set(null);
    const changeEmail = this.changeEmailMode();
    const currentEmail = this.registeredEmail();
    const email = this.registerForm.controls.email.value.trim().toLowerCase();
    const step = this.step();
    const stillCurrent = () => this.isFlowCurrent(revision)
      && this.step() === step
      && this.registerStep() === 2
      && this.changeEmailMode() === changeEmail
      && this.registerForm.controls.email.value.trim().toLowerCase() === email;
    try {
      const antiBot = {
        captchaToken: this.registerCaptchaToken(),
        website: this.registerForm.controls.company.value,
      };
      if (changeEmail) {
        if (!currentEmail) {
          if (stillCurrent()) this.error.set("No hay un registro pendiente que actualizar");
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
            privacyVersion: PRIVACY_VERSION,
          },
        );
      }
      if (!stillCurrent()) return;
      this.registeredEmail.set(email);
      this.verificationEmail.set(email);
      this.changeEmailMode.set(false);
      this.step.set("verify-pending");
      this.info.set(
        this.pendingLink()
          ? "¡Cuenta creada! Confirma tu email; tu URL seguirá preparada durante las próximas 24 horas."
          : "¡Cuenta creada! Para continuar debes confirmar tu email. Revisa tu bandeja de entrada.",
      );
      this.registerCaptchaToken.set("");
    } catch (err) {
      if (!stillCurrent()) return;
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo crear la cuenta");
      // hCaptcha tokens are short-lived and single-use. Never reuse one after
      // the server has attempted verification, even when credentials fail.
      this.registerCaptchaToken.set("");
      this.registerCaptchaWidget?.reset();
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }

  async resendVerification(): Promise<void> {
    const email = this.verificationEmail() ?? this.loginForm.controls.email.value.trim().toLowerCase();
    const pendingStep = this.step() === "verify-pending";
    const captchaToken = pendingStep ? this.resendCaptchaToken() : this.loginCaptchaToken();
    if (!email || !captchaToken || this.verificationBusy()) {
      if (!captchaToken) this.error.set("Completa hCaptcha para reenviar el correo.");
      return;
    }
    const revision = ++this.verificationRevision;
    this.verificationBusy.set(true);
    this.error.set(null);
    try {
      await this.auth.resendVerification(email, captchaToken);
      if (!this.isVerificationCurrent(revision, pendingStep, email)) return;
      this.info.set("Si la cuenta necesita verificación, recibirás un nuevo correo en breve. Revisa también spam.");
    } catch (err) {
      if (this.isVerificationCurrent(revision, pendingStep, email)) {
        this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo reenviar el correo");
      }
    } finally {
      if (this.destroyRef.destroyed || revision !== this.verificationRevision) return;
      if (pendingStep) {
        this.resendCaptchaToken.set("");
        this.resendCaptchaWidget?.reset();
      } else {
        this.loginCaptchaToken.set("");
        this.loginCaptchaWidget?.reset();
      }
      this.verificationBusy.set(false);
    }
  }

  changeRegistrationEmail(): void {
    const email = this.registeredEmail() ?? this.verificationEmail();
    if (!email) return;
    this.invalidateFlow();
    this.tabIndex.set(1);
    this.step.set("register");
    this.registerStep.set(1);
    this.changeEmailMode.set(true);
    this.registerForm.controls.email.setValue(email);
    this.registerCaptchaToken.set("");
    this.error.set(null);
    this.info.set("Corrige el email y confirma el cambio con tu contraseña. Te enviaremos la verificación a la nueva dirección.");
  }

  closeRegistration(): void {
    // Registration is intentionally sessionless; no server session exists to
    // revoke here.
    this.invalidateFlow();
    this.changeEmailMode.set(false);
    this.registeredEmail.set(null);
    this.verificationEmail.set(null);
    this.loginCaptchaToken.set("");
    this.registerCaptchaToken.set("");
    this.registerStep.set(1);
    this.registerForm.reset({
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      acceptTerms: false,
      company: "",
    });
    this.tabIndex.set(0);
    this.step.set("login");
    this.error.set(null);
    this.info.set("Has cerrado el registro pendiente. Puedes volver cuando quieras.");
  }

  goForgot(): void {
    this.invalidateFlow();
    void this.router.navigate(["/auth/forgot-password"], { queryParams: { returnTo: this.returnTo() } });
  }

  goRecovery(): void {
    if (!this.mfaChallenge() || !this.mfaRecoveryAvailable()) return;
    this.invalidateFlow();
    this.step.set("recovery");
    this.error.set(null);
    this.info.set(null);
  }

  backToMfa(): void {
    if (!this.mfaChallenge()) {
      this.restartMfaLogin("La verificación ha caducado. Introduce de nuevo tus credenciales.");
      return;
    }
    this.invalidateFlow();
    this.step.set("mfa");
    this.recoveryForm.reset();
    this.error.set(null);
    this.info.set(null);
  }

  restartMfaLogin(message?: string): void {
    this.invalidateFlow();
    this.mfaChallenge.set(null);
    this.mfaRecoveryAvailable.set(false);
    this.mfaForm.reset();
    this.recoveryForm.reset();
    this.tabIndex.set(0);
    this.step.set("login");
    this.error.set(null);
    this.info.set(message ?? null);
    this.loginCaptchaToken.set("");
    this.loginCaptchaWidget?.reset();
  }

  backToLogin(): void {
    this.invalidateFlow();
    this.tabIndex.set(0);
    this.step.set("login");
    this.changeEmailMode.set(false);
    this.error.set(null);
    this.info.set(null);
  }

  onLoginCaptchaToken(token: string): void {
    this.loginCaptchaToken.set(token);
    if (token && this.error() === "Completa hCaptcha para continuar.") this.error.set(null);
  }

  onRegisterCaptchaToken(token: string): void {
    this.registerCaptchaToken.set(token);
    if (token && this.error() === "Completa hCaptcha para continuar.") this.error.set(null);
  }

  onResendCaptchaToken(token: string): void {
    this.resendCaptchaToken.set(token);
    if (token && this.error() === "Completa hCaptcha para reenviar el correo.") this.error.set(null);
  }

  async retryCaptchaConfiguration(): Promise<void> {
    await this.loadCaptchaConfiguration();
  }

  private async loadCaptchaConfiguration(): Promise<void> {
    if (this.captchaConfigBusy() && this.hcaptchaSiteKey()) return;
    const revision = ++this.captchaConfigRevision;
    this.captchaConfigBusy.set(true);
    this.captchaConfigError.set(null);
    try {
      const config = await this.api.get<PublicAuthConfig>("/api/v1/config", undefined, decodePublicConfig);
      if (!this.isCaptchaConfigurationCurrent(revision)) return;
      const siteKey = config.hcaptcha?.enabled ? config.hcaptcha.siteKey : null;
      if (!siteKey || !/^[A-Za-z0-9_-]{20,200}$/.test(siteKey)) {
        throw new Error("hCaptcha no está configurado");
      }
      this.hcaptchaSiteKey.set(siteKey);
    } catch {
      if (this.isCaptchaConfigurationCurrent(revision)) {
        this.hcaptchaSiteKey.set("");
        this.captchaConfigError.set("No se pudo cargar hCaptcha.");
      }
    } finally {
      if (this.isCaptchaConfigurationCurrent(revision)) this.captchaConfigBusy.set(false);
    }
  }

  private invalidateFlow(): void {
    ++this.flowRevision;
    ++this.verificationRevision;
    this.verificationBusy.set(false);
  }

  private isFlowCurrent(revision: number): boolean {
    return !this.destroyRef.destroyed && revision === this.flowRevision;
  }

  private isVerificationCurrent(revision: number, pendingStep: boolean, email: string): boolean {
    const expectedStep = pendingStep ? "verify-pending" : "login";
    const currentEmail = this.verificationEmail() ?? this.loginForm.controls.email.value.trim().toLowerCase();
    return !this.destroyRef.destroyed
      && revision === this.verificationRevision
      && this.step() === expectedStep
      && currentEmail === email;
  }

  private isCaptchaConfigurationCurrent(revision: number): boolean {
    return !this.destroyRef.destroyed && revision === this.captchaConfigRevision;
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
    if (this.intents.hasPending()) return "/app/links";
    if (this.invitations.hasPending()) return "/invitations/accept";
    return "/app";
  }
}
