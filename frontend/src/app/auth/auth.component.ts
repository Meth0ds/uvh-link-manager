import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, ViewChild, afterNextRender, computed, effect, inject, isDevMode, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
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
import { LatestRequest } from "../core/services/latest-request";
import { safeReturnTo } from "../core/guards/auth.guard";
import { HCaptchaExecutionError, HCaptchaWidgetComponent } from "./hcaptcha-widget.component";
import { intentBearer } from "./auth-bearer";
import { OtpCodeInputComponent } from "./otp-code-input.component";
import type { AuthFlowState } from "./auth-flow-state";

interface PublicAuthConfig {
  registrationPaused?: boolean;
  hcaptcha?: {
    enabled?: boolean;
    siteKey?: string | null;
    developmentFallback?: boolean;
  };
}

/** Aviso público de pausa de registros; idéntico al que responde la API con 503. */
export const REGISTRATION_PAUSED_MESSAGE = "Registros temporalmente pausados. Inténtalo de nuevo más tarde.";

@Component({
  selector: "app-auth",
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressBarModule,
    AuthShellComponent,
    HCaptchaWidgetComponent,
    OtpCodeInputComponent,
  ],
  templateUrl: "./auth.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./auth.component.scss",
})
export class AuthComponent {
  @ViewChild("loginCaptcha") private loginCaptchaWidget?: HCaptchaWidgetComponent;
  @ViewChild("registerCaptcha") private registerCaptchaWidget?: HCaptchaWidgetComponent;
  @ViewChild("resendCaptcha") private resendCaptchaWidget?: HCaptchaWidgetComponent;
  @ViewChild("mfaDialog") private mfaDialog?: ElementRef<HTMLElement>;
  @ViewChild("loginEmail") private loginEmail?: ElementRef<HTMLInputElement>;
  @ViewChild("recoveryCode") private recoveryCode?: ElementRef<HTMLInputElement>;
  @ViewChild("navigationStatus") private navigationStatus?: ElementRef<HTMLElement>;

  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly intents = inject(PendingLinkIntentService);
  private readonly invitations = inject(PendingInvitationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private redirectedAuthenticatedVisitor = false;
  private interactiveAuthStarted = false;
  private flowRevision = 0;
  private verificationRevision = 0;
  private navigationRevision = 0;
  private readonly captchaConfigRequests = new LatestRequest(this.destroyRef);

  private readonly flow = signal<AuthFlowState>({ kind: "login" });
  readonly step = computed(() => this.flow().kind);
  readonly busy = signal(false);
  readonly navigationBusy = signal(false);
  private readonly failedNavigation = signal<{ destination: string; generation: number } | null>(null);
  readonly captchaConfigBusy = signal(true);
  readonly captchaConfigError = signal<string | null>(null);
  readonly hcaptchaSiteKey = signal("");
  readonly developmentCaptchaFallback = signal(false);
  readonly captchaReady = computed(() => !this.captchaConfigBusy()
    && (!!this.hcaptchaSiteKey() || this.developmentCaptchaFallback()));
  /** La plataforma no acepta registros nuevos; la corrección de un pendiente sigue disponible. */
  readonly registrationsPaused = signal(false);
  readonly loginCaptchaToken = signal("");
  readonly registerCaptchaToken = signal("");
  readonly resendCaptchaToken = signal("");

  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);
  readonly verificationEmail = computed(() => {
    const flow = this.flow();
    return flow.kind === "verify-pending" ? flow.email
      : flow.kind === "register" && flow.mode === "correct-email" ? flow.originalEmail : null;
  });
  readonly verificationEditable = computed(() => {
    const flow = this.flow();
    return flow.kind === "verify-pending" && flow.source === "browser-registration";
  });
  readonly verificationRecovery = computed(() => {
    const flow = this.flow();
    return flow.kind === "verify-pending" && flow.source === "recovery";
  });
  readonly registeredEmail = computed(() => {
    const flow = this.flow();
    return flow.kind === "register" && flow.mode === "correct-email" ? flow.originalEmail
      : flow.kind === "verify-pending" && flow.source === "browser-registration" ? flow.email : null;
  });
  readonly changeEmailMode = computed(() => {
    const flow = this.flow();
    return flow.kind === "register" && flow.mode === "correct-email";
  });
  readonly verificationBusy = signal(false);
  readonly mfaChallenge = computed(() => {
    const flow = this.flow();
    return flow.kind === "mfa" || flow.kind === "recovery" ? flow.challenge : null;
  });
  readonly mfaRecoveryAvailable = computed(() => {
    const flow = this.flow();
    return (flow.kind === "mfa" || flow.kind === "recovery") && flow.recoveryAvailable;
  });
  readonly hidePassword = signal(true);
  readonly tabIndex = signal(0);
  readonly pendingLink = this.intents.pending;
  readonly localMailInbox = isDevMode() && typeof window !== "undefined"
    && ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:8025"
    : null;

  /**
   * Hold the card back until the startup probe has answered. A visitor arriving
   * with a live session must never see the login form, not even for a frame;
   * `loaded` alone is not enough because a transient probe failure leaves it
   * retryable, and hiding the form forever would strand that visitor.
   */
  readonly showAuthCard = computed(() => !this.auth.authenticated() && (this.auth.loaded() || this.auth.probeSettled()));

  /** Notices produced after registration/resend, excluding the static success copy. */
  readonly pendingNotice = computed(() => {
    const notice = this.info();
    return notice && !notice.startsWith("Solicitud registrada.") ? notice : null;
  });

  readonly loginForm = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ["", [Validators.required, Validators.maxLength(72)]],
  });

  readonly registerForm = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email, Validators.maxLength(254)]],
    // Honeypot: kept out of the visible email form.
    company: ["", [Validators.maxLength(120)]],
  });

  readonly mfaForm = this.fb.nonNullable.group({
    code: ["", [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  readonly recoveryForm = this.fb.nonNullable.group({
    code: ["", [Validators.required, Validators.pattern(/^[A-Za-z2-9\s-]{16,24}$/)]],
  });

  constructor() {
    void this.loadCaptchaConfiguration();
    const routeIntent = intentBearer(this.route);
    const registerMode = this.route.snapshot.queryParamMap.get("mode") === "register";
    const capturedIntent = routeIntent ? this.intents.capture(routeIntent) : false;
    if (routeIntent) {
      // Drop the bearer from the address bar. The server holds it now, and a
      // URL that still carries it is the thing this change removes; the
      // navigate also clears the fragment, which `queryParams: {intent: null}`
      // alone would leave in place.
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { intent: null },
        queryParamsHandling: "merge",
        replaceUrl: true,
      });
    }
    if (capturedIntent || registerMode) {
      this.tabIndex.set(1);
      this.flow.set({ kind: "register", mode: "new" });
    }
    if (this.route.snapshot.queryParamMap.get("reason") === "session-expired") {
      this.info.set("Vuelve a iniciar sesión para continuar de forma segura.");
    }

    effect(() => {
      if (
        this.redirectedAuthenticatedVisitor
        || this.interactiveAuthStarted
        || !this.auth.loaded()
        || !this.auth.authenticated()
      ) return;
      void this.navigateAuthenticated(this.returnTo());
    });

  }

  onTabChange(index: number): void {
    this.invalidateFlow();
    this.tabIndex.set(index);
    this.flow.set(index === 0 ? { kind: "login" } : { kind: "register", mode: "new" });
    this.error.set(null);
    this.info.set(null);
  }

  onAuthTabKeydown(event: KeyboardEvent, currentIndex: number): void {
    let nextIndex: number | null = null;
    // Two tabs make forward and backward land on the same tab, but the
    // direction is still the WAI-ARIA contract: moving left must not read as
    // moving right once a third tab exists.
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % 2;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + 2) % 2;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = 1;
    if (nextIndex === null) return;

    event.preventDefault();
    this.onTabChange(nextIndex);
    const tabButtons = (event.currentTarget as HTMLElement | null)?.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    tabButtons?.item(nextIndex).focus();
  }

  async onLogin(): Promise<void> {
    if (this.loginForm.invalid || this.busy() || this.verificationBusy()) {
      this.loginForm.markAllAsTouched();
      return;
    }
    if (!this.captchaReady()) {
      this.error.set("La protección antiabuso todavía no está preparada. Reinténtalo en unos segundos.");
      return;
    }
    const revision = ++this.flowRevision;
    const destination = this.returnTo();
    this.interactiveAuthStarted = true;
    this.busy.set(true);
    this.error.set(null);
    try {
      // Invisible hCaptcha is executed at submit time. Keeping this token local
      // to the attempt prevents an expired or previously redeemed value from
      // being reused by a later click.
      const captchaToken = await this.executeCaptcha(this.loginCaptchaWidget);
      if (!this.isFlowCurrent(revision) || this.step() !== "login") return;
      this.loginCaptchaToken.set("");
      const outcome = await this.auth.login(
        this.loginForm.controls.email.value.toLowerCase(),
        this.loginForm.controls.password.value,
        captchaToken,
      );
      if (!this.isFlowCurrent(revision) || this.step() !== "login") return;
      if (outcome.mfaRequired) {
        this.mfaForm.reset();
        this.recoveryForm.reset();
        this.flow.set({ kind: "mfa", challenge: outcome.challenge, recoveryAvailable: outcome.recoveryAvailable });
        this.info.set(null);
      } else {
        await this.intents.refresh();
        if (!this.isFlowCurrent(revision) || this.step() !== "login") return;
        await this.navigateAuthenticated(destination === "/app" && this.intents.hasPending() ? "/app/links" : destination);
      }
    } catch (err) {
      if (!this.isFlowCurrent(revision) || this.step() !== "login") return;
      this.interactiveAuthStarted = false;
      if (err instanceof ApiRequestError && err.status === 403
        && (err.reason === "pending_registration" || err.reason === "email_verification_required")) {
        const email = this.loginForm.controls.email.value.trim().toLowerCase();
        this.flow.set({ kind: "verify-pending", email,
          source: err.reason === "pending_registration" ? "browser-registration" : "unverified-account" });
        this.info.set(null);
        this.loginCaptchaToken.set("");
        this.loginCaptchaWidget?.reset();
        return;
      }
      this.error.set(
        err instanceof ApiRequestError || err instanceof HCaptchaExecutionError
          ? err.message
          : "No se pudo iniciar sesión",
      );
      this.loginCaptchaToken.set("");
      this.loginCaptchaWidget?.reset();
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }

  /** The failed destination belongs only to the session that tried to open it. */
  navigationFailure(): string | null {
    const failure = this.failedNavigation();
    return failure && this.auth.authenticated() && failure.generation === this.auth.sessionGeneration()
      ? failure.destination : null;
  }

  async retryNavigation(): Promise<void> {
    const destination = this.navigationFailure();
    if (!destination || this.navigationBusy()) return;
    await this.navigateAuthenticated(destination);
  }

  /** Navigation failures must never be handled as credential/factor failures. */
  private async navigateAuthenticated(destination: string): Promise<void> {
    const revision = this.flowRevision;
    const navigation = ++this.navigationRevision;
    const generation = this.auth.sessionGeneration();
    this.redirectedAuthenticatedVisitor = true;
    this.navigationStatus?.nativeElement.focus({ preventScroll: true });
    this.navigationBusy.set(true);
    let navigated = false;
    try {
      navigated = await this.router.navigateByUrl(destination);
    } catch {
      // A cancelled route and a failed route load have the same retry contract.
    }
    if (this.destroyRef.destroyed || navigation !== this.navigationRevision) return;
    this.navigationBusy.set(false);
    if (!this.isFlowCurrent(revision) || !this.auth.authenticated() || generation !== this.auth.sessionGeneration()) return;
    if (navigated) {
      this.failedNavigation.set(null);
      return;
    }
    this.failedNavigation.set({ destination, generation });
    afterNextRender(() => {
      if (this.isFlowCurrent(revision) && this.navigationFailure() === destination && !this.navigationBusy()) {
        this.navigationStatus?.nativeElement.focus({ preventScroll: true });
      }
    }, { injector: this.injector });
  }

  /** Auto-submit once the sixth digit lands; onMfa's busy() guard dedupes. */
  onOtpCompleted(): void {
    if (this.step() === "mfa" && !this.busy()) {
      void this.onMfa();
    }
  }

  onOtpModalKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (this.busy()) return;
      event.preventDefault();
      this.restartMfaLogin();
      return;
    }
    if (event.key !== "Tab") return;
    // While the dialog is open it is the only tabbable region (aria-modal):
    // wrap focus at its edges so the keyboard cannot wander into the shell.
    const scrim = event.currentTarget as HTMLElement;
    const focusables = Array.from(
      scrim.querySelectorAll<HTMLElement>("app-otp-code-input input:not([disabled]), button:not([disabled]), a[href]"),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) {
      // Pending verification disables every control; retain a focusable dialog
      // instead of letting Tab escape into the page behind aria-modal.
      event.preventDefault();
      this.mfaDialog?.nativeElement.focus();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !scrim.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !scrim.contains(active))) {
      event.preventDefault();
      first.focus();
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
    this.mfaDialog?.nativeElement.focus({ preventScroll: true });
    try {
      const challenge = this.mfaChallenge();
      if (!challenge) {
        this.restartMfaLogin("La verificación ha caducado. Introduce de nuevo tus credenciales.");
        return;
      }
      await this.auth.verifyMfa(challenge, this.mfaForm.controls.code.value);
      if (!this.isFlowCurrent(revision) || this.step() !== "mfa" || this.mfaChallenge() !== challenge) return;
      await this.navigateAuthenticated(destination);
    } catch (err) {
      if (!this.isFlowCurrent(revision) || this.step() !== "mfa") return;
      const message = err instanceof ApiRequestError ? err.message : "Código incorrecto";
      if (message === "Sesión MFA caducada") this.restartMfaLogin("La verificación ha caducado. Introduce de nuevo tus credenciales.");
      else {
        this.mfaForm.reset();
        this.error.set(message);
      }
    } finally {
      if (!this.destroyRef.destroyed) {
        this.busy.set(false);
        if (this.isFlowCurrent(revision) && this.step() === "mfa" && this.error()) this.focusAuthStep("mfa");
      }
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
      await this.navigateAuthenticated(destination);
    } catch (err) {
      if (!this.isFlowCurrent(revision) || this.step() !== "recovery") return;
      const message = err instanceof ApiRequestError ? err.message : "Código de recuperación incorrecto";
      if (message === "Sesión MFA caducada") this.restartMfaLogin("La verificación ha caducado. Introduce de nuevo tus credenciales.");
      else this.error.set(message);
    } finally {
      if (!this.destroyRef.destroyed) {
        this.busy.set(false);
        if (this.isFlowCurrent(revision) && this.step() === "recovery" && this.error()) this.focusAuthStep("recovery");
      }
    }
  }

  async onRegister(): Promise<void> {
    this.registerForm.markAllAsTouched();
    if (this.step() !== "register" || this.registerForm.invalid || this.busy()) return;
    if (this.registerForm.controls.company.value.trim() !== "") {
      this.error.set("No se pudo crear la cuenta");
      return;
    }
    // La corrección de un registro pendiente no es un registro nuevo y sigue
    // disponible durante la pausa; solo el alta se anuncia como pausada.
    if (!this.changeEmailMode() && this.registrationsPaused()) {
      this.error.set(REGISTRATION_PAUSED_MESSAGE);
      return;
    }
    if (!this.captchaReady()) {
      this.error.set("La protección antiabuso todavía no está preparada. Reinténtalo en unos segundos.");
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
      && this.changeEmailMode() === changeEmail
      && this.registerForm.controls.email.value.trim().toLowerCase() === email;
    try {
      const captchaToken = await this.executeCaptcha(this.registerCaptchaWidget);
      if (!stillCurrent()) return;
      this.registerCaptchaToken.set("");
      const antiBot = {
        captchaToken,
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
        await this.auth.changeRegistrationEmail(currentEmail, email, antiBot);
      } else {
        if (this.intents.hasPending()) {
          await this.intents.confirmed();
          if (!stillCurrent()) return;
        }
        await this.auth.register(email, antiBot);
      }
      if (!stillCurrent()) return;
      this.flow.set({ kind: "verify-pending", email, source: "browser-registration" });
      this.info.set(
        "Solicitud registrada. Abre el correo para confirmar tu email y elegir tu nombre y contraseña. Si ya tienes una cuenta, inicia sesión o recupera tu contraseña.",
      );
      this.registerCaptchaToken.set("");
    } catch (err) {
      if (!stillCurrent()) return;
      if (err instanceof ApiRequestError && err.reason === "registration_paused") {
        // La pausa se activó con la página abierta: el banner ya lo anuncia,
        // así que no se repite como error.
        this.registrationsPaused.set(true);
        this.error.set(null);
      } else {
        this.error.set(
          err instanceof ApiRequestError || err instanceof HCaptchaExecutionError
            ? err.message
            : "No se pudo crear la cuenta",
        );
      }
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
    const captchaWidget = pendingStep ? this.resendCaptchaWidget : this.loginCaptchaWidget;
    // Login and resend share the login widget: serialize both operations so
    // its single-use result cannot be redeemed by two requests.
    if (this.verificationBusy() || this.busy()) return;
    if (!email) {
      this.error.set("Escribe tu email para reenviar la verificación.");
      return;
    }
    if (!this.captchaReady()) {
      this.error.set("La protección antiabuso todavía no está preparada. Reinténtalo en unos segundos.");
      return;
    }
    const revision = ++this.verificationRevision;
    this.verificationBusy.set(true);
    this.error.set(null);
    try {
      const captchaToken = await this.executeCaptcha(captchaWidget);
      if (!this.isVerificationCurrent(revision, pendingStep, email)) return;
      await this.auth.resendVerification(email, captchaToken);
      if (!this.isVerificationCurrent(revision, pendingStep, email)) return;
      this.info.set("Si la cuenta necesita verificación, recibirás un nuevo correo en breve. Revisa también spam.");
    } catch (err) {
      if (this.isVerificationCurrent(revision, pendingStep, email)) {
        this.error.set(
          err instanceof ApiRequestError || err instanceof HCaptchaExecutionError
            ? err.message
            : "No se pudo reenviar el correo",
        );
      }
    } finally {
      // A return inside finally would suppress a thrown error or an earlier
      // return value. Stale views simply skip their cleanup instead.
      if (!this.destroyRef.destroyed && revision === this.verificationRevision) {
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
  }

  openVerificationRecovery(): void {
    const emailControl = this.registerForm.controls.email;
    emailControl.markAsTouched();
    if (emailControl.invalid) return;

    this.invalidateFlow();
    this.flow.set({ kind: "verify-pending", email: emailControl.value.trim().toLowerCase(), source: "recovery" });
    this.error.set(null);
    this.info.set(null);
  }

  changeRegistrationEmail(): void {
    const flow = this.flow();
    if (flow.kind !== "verify-pending" || flow.source !== "browser-registration" || !flow.email) return;
    const email = flow.email;
    this.invalidateFlow();
    this.tabIndex.set(1);
    this.flow.set({ kind: "register", mode: "correct-email", originalEmail: email });
    this.registerForm.controls.email.setValue(email);
    this.registerCaptchaToken.set("");
    this.error.set(null);
    this.info.set("Indica la dirección correcta. Si puede completar el registro, recibirás una verificación para elegir tu contraseña.");
  }

  closeRegistration(): void {
    // Registration is intentionally sessionless; no server session exists to
    // revoke here.
    this.invalidateFlow();
    this.loginCaptchaToken.set("");
    this.registerCaptchaToken.set("");
    this.registerForm.reset({
      email: "",
      company: "",
    });
    this.tabIndex.set(0);
    this.flow.set({ kind: "login" });
    this.error.set(null);
    this.info.set("Has cerrado el registro pendiente. Puedes volver cuando quieras.");
  }

  goForgot(): void {
    this.invalidateFlow();
    void this.router.navigate(["/auth/forgot-password"], { queryParams: { returnTo: this.returnTo() } });
  }

  goRecovery(): void {
    const flow = this.flow();
    if (this.busy() || (flow.kind !== "mfa" && flow.kind !== "recovery") || !flow.challenge || !flow.recoveryAvailable) return;
    this.invalidateFlow();
    this.flow.set({ ...flow, kind: "recovery" });
    this.error.set(null);
    this.info.set(null);
    this.focusAuthStep("recovery");
  }

  backToMfa(): void {
    if (this.busy()) return;
    const flow = this.flow();
    if ((flow.kind !== "mfa" && flow.kind !== "recovery") || !flow.challenge) {
      this.restartMfaLogin("La verificación ha caducado. Introduce de nuevo tus credenciales.");
      return;
    }
    this.invalidateFlow();
    this.flow.set({ ...flow, kind: "mfa" });
    this.recoveryForm.reset();
    this.error.set(null);
    this.info.set(null);
  }

  restartMfaLogin(message?: string): void {
    this.invalidateFlow();
    this.mfaForm.reset();
    this.recoveryForm.reset();
    this.tabIndex.set(0);
    this.flow.set({ kind: "login" });
    this.error.set(null);
    this.info.set(message ?? null);
    this.loginCaptchaToken.set("");
    this.loginCaptchaWidget?.reset();
    this.focusAuthStep("login");
  }

  /** A pending render must not focus a step that has since been abandoned. */
  private focusAuthStep(step: "login" | "mfa" | "recovery"): void {
    const revision = this.flowRevision;
    afterNextRender(() => {
      if (!this.isFlowCurrent(revision) || this.step() !== step || this.busy()) return;
      const target = step === "login" ? this.loginEmail?.nativeElement
        : step === "recovery" ? this.recoveryCode?.nativeElement
        : this.mfaDialog?.nativeElement.querySelector<HTMLInputElement>("app-otp-code-input input");
      if (!target) return;
      const active = target.ownerDocument.activeElement;
      const dialog = this.mfaDialog?.nativeElement;
      // Preserve a deliberate choice made after the response arrived.
      if (active !== target.ownerDocument.body && active !== dialog) return;
      target.focus();
    }, { injector: this.injector });
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

  private async executeCaptcha(widget?: HCaptchaWidgetComponent): Promise<string> {
    try {
      if (!widget || !this.hcaptchaSiteKey()) {
        throw new HCaptchaExecutionError("La protección antiabuso no está disponible.");
      }
      // Do not make local developers wait for a second timeout when the
      // visible widget has already reported an outage. Other environments
      // still execute the normal retry and require a fresh provider token.
      if (this.developmentCaptchaFallback() && widget.state() === "error") {
        throw new HCaptchaExecutionError("hCaptcha no se pudo cargar.");
      }
      return await widget.execute();
    } catch (error) {
      // This marker is deliberately not a provider token. The backend must
      // authorize it again using local/debug/opt-in/loopback gates. Never
      // retry a failed login here: only widget failures enter this path.
      if (!(error instanceof HCaptchaExecutionError) || !this.developmentCaptchaFallback()
        || this.destroyRef.destroyed || this.captchaConfigBusy()) throw error;
      widget?.reset();
      return "uvh-local-captcha-unavailable";
    }
  }

  private async loadCaptchaConfiguration(): Promise<void> {
    if (this.captchaConfigBusy() && this.hcaptchaSiteKey()) return;
    const request = this.captchaConfigRequests.begin("hcaptcha-config");
    this.captchaConfigBusy.set(true);
    this.captchaConfigError.set(null);
    this.developmentCaptchaFallback.set(false);
    try {
      const config = await this.api.get<PublicAuthConfig>(
        "/api/v1/config",
        undefined,
        decodePublicConfig,
        { signal: request.signal },
      );
      if (!this.captchaConfigRequests.isCurrent(request, "hcaptcha-config")) return;
      this.registrationsPaused.set(config.registrationPaused === true);
      const siteKey = config.hcaptcha?.enabled ? config.hcaptcha.siteKey : null;
      const fallback = config.hcaptcha?.developmentFallback === true;
      if ((!siteKey && !fallback) || (siteKey && !/^[A-Za-z0-9_-]{20,200}$/.test(siteKey))) {
        throw new Error("hCaptcha no está configurado");
      }
      this.hcaptchaSiteKey.set(siteKey ?? "");
      this.developmentCaptchaFallback.set(fallback);
    } catch {
      if (this.captchaConfigRequests.isCurrent(request, "hcaptcha-config")) {
        this.hcaptchaSiteKey.set("");
        this.captchaConfigError.set("No se pudo cargar hCaptcha.");
      }
    } finally {
      if (this.captchaConfigRequests.isCurrent(request, "hcaptcha-config")) this.captchaConfigBusy.set(false);
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

  private returnTo(): string {
    const destination = safeReturnTo(this.route.snapshot.queryParamMap.get("returnTo") ?? "", "");
    if (destination) return destination;
    if (this.intents.hasPending()) return "/app/links";
    if (this.invitations.pending()) return "/invitations/accept";
    return "/app";
  }
}
