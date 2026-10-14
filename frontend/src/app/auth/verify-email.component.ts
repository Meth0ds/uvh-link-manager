import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, signal, ChangeDetectionStrategy, viewChild } from "@angular/core";
import { DOCUMENT, Location } from "@angular/common";

import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { AuthShellComponent } from "./auth-shell.component";
import { PRIVACY_VERSION, TERMS_VERSION } from "../core/legal-documents";
import { ApiService, ApiRequestError } from "../core/services/api.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { PendingInvitationService } from "../core/services/pending-invitation.service";
import { authBearer } from "./auth-bearer";
import { LatestRequest } from "../core/services/latest-request";
import { decodeRegistrationActivation } from "../core/services/auth-response-decoders";
import { AuthService } from "../core/services/auth.service";
import { assessPassword, passwordStrengthLabel } from "./password-policy";

/**
 * Activation of a pending registration: the email bearer plus the identity,
 * legal acceptance and password typed here, which become the account's own.
 *
 * The initial request only supplies an email. Whoever opens its mailbox link
 * chooses the name and password and accepts the current legal versions here.
 * No identity, credential or workspace is inherited from an anonymous request.
 */
@Component({
  selector: "app-verify-email",
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatIconModule, MatProgressBarModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <div class="card center" aria-labelledby="verify-email-title">
        <span class="step-kicker">COMPLETAR REGISTRO</span>
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" aria-label="Procesando solicitud" />
        }
        <mat-icon class="icon" aria-hidden="true" [class.ok]="ok()" [class.bad]="failed() || ((!token || linkRejected()) && done())">
          {{ ok() ? 'verified_user' : (failed() || !token || linkRejected() ? 'error_outline' : 'mark_email_read') }}
        </mat-icon>
        <h2 id="verify-email-title">{{ ok() ? (newAccount() ? 'Cuenta creada correctamente' : 'Email verificado') : (!token || linkRejected() ? 'Enlace no disponible' : 'Completa tu registro') }}</h2>
        <p class="sub" [attr.role]="failed() ? 'alert' : 'status'">{{ message() }}</p>
        @if (token && !ok() && !linkRejected()) {
          <form #actionForm class="form" [formGroup]="form" (ngSubmit)="verify()" [attr.aria-busy]="busy()">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Nombre completo</mat-label>
              <input matInput formControlName="name" autocomplete="name" maxlength="80" />
              <mat-hint>El nombre que quieres mostrar en UVH.</mat-hint>
              @if (form.controls.name.invalid && form.controls.name.touched) { <mat-error>Utiliza entre 2 y 80 caracteres.</mat-error> }
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Contraseña</mat-label>
              <input matInput [type]="hide() ? 'password' : 'text'" formControlName="password" autocomplete="new-password" maxlength="72" />
              <button mat-icon-button matSuffix type="button" (click)="hide.set(!hide())" [attr.aria-label]="hide() ? 'Mostrar contraseña' : 'Ocultar contraseña'">
                <mat-icon>{{ hide() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              <mat-hint>Elige la contraseña con la que iniciarás sesión. Entre 10 y 72 caracteres.</mat-hint>
              @if (form.controls.password.invalid && form.controls.password.touched) { <mat-error>Utiliza entre 10 y 72 caracteres.</mat-error> }
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Repite la contraseña</mat-label>
              <input matInput [type]="hide() ? 'password' : 'text'" formControlName="confirm" autocomplete="new-password" maxlength="72" />
            </mat-form-field>
            @if (passwordValue()) {
              <p class="sub" role="status">Fortaleza estimada: {{ passwordStrength() }}. {{ passwordAssessment().feedback }}</p>
            }
            @if (form.hasError('mismatch') && form.controls.confirm.touched) {
              <div class="alert error" role="alert">Las contraseñas no coinciden. Revisa el segundo campo.</div>
            }
            <mat-checkbox formControlName="acceptTerms" color="primary">
              Acepto los <a routerLink="/legal/terminos" target="_blank" rel="noopener" (click)="$event.stopPropagation()">Términos de servicio</a> y confirmo que he leído la <a routerLink="/legal/privacidad" target="_blank" rel="noopener" (click)="$event.stopPropagation()">Política de privacidad</a> vigentes
            </mat-checkbox>
            @if (form.controls.acceptTerms.hasError('required') && form.controls.acceptTerms.touched) {
              <div class="alert error" role="alert">Debes aceptar los términos vigentes para activar la cuenta.</div>
            }
            <button #submitButton mat-flat-button color="primary" type="submit" [disabled]="form.invalid || busy()">
              {{ busy() ? 'Creando cuenta…' : (attempted() ? 'Volver a intentarlo' : 'Crear mi cuenta') }}
            </button>
          </form>
        }
        @if (done() && ok()) {
          @if (signedIn()) {
            <a #nextLink mat-flat-button color="primary" [routerLink]="continueTo()">{{ hasPendingLink() ? 'Continuar con mi enlace' : (pendingInvitation() ? 'Revisar invitación' : 'Ir al panel') }}</a>
          } @else if (auth.authenticated()) {
            <button mat-flat-button color="primary" type="button" (click)="switchAccount()" [disabled]="busy()">Cerrar la sesión actual y entrar con mi cuenta nueva</button>
          } @else {
            <a #nextLink mat-flat-button color="primary" [routerLink]="['/auth']" [queryParams]="loginQueryParams()">Iniciar sesión</a>
          }
        } @else if (!token || linkRejected()) {
          <a #nextLink mat-flat-button color="primary" routerLink="/auth" [queryParams]="{ mode: 'register' }">Solicitar otro enlace</a>
        }
      </div>
    </app-auth-shell>
    `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./auth-card.scss",
})
export class VerifyEmailComponent {
  private fb = inject(FormBuilder);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private intents = inject(PendingLinkIntentService);
  private invitations = inject(PendingInvitationService);
  private location = inject(Location);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly actionForm = viewChild<unknown, ElementRef<HTMLFormElement>>("actionForm", { read: ElementRef });
  private readonly submitButton = viewChild<unknown, ElementRef<HTMLButtonElement>>("submitButton", { read: ElementRef });
  private readonly nextLink = viewChild<unknown, ElementRef<HTMLAnchorElement>>("nextLink", { read: ElementRef });

  readonly busy = signal(false);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly attempted = signal(false);
  readonly failed = signal(false);
  readonly linkRejected = signal(false);
  readonly hide = signal(true);
  readonly newAccount = signal(false);
  readonly signedIn = signal(false);
  private readonly transferredLink = signal(false);
  readonly message = signal("Elige tu nombre y contraseña para crear la cuenta y confirmar tu email. Si no solicitaste este registro, no continúes.");
  readonly pendingLink = this.intents.pending;
  readonly pendingInvitation = this.invitations.pending;
  readonly token: string;
  readonly hasPendingLink = computed(() => this.transferredLink() || !!this.pendingLink());
  readonly continueTo = computed(() => this.hasPendingLink() ? "/app/links" : (this.pendingInvitation() ? "/invitations/accept" : "/app"));
  readonly loginQueryParams = computed(() => this.hasPendingLink()
    ? { returnTo: "/app/links" }
    : (this.pendingInvitation() ? { returnTo: "/invitations/accept" } : {}));

  form = this.fb.nonNullable.group(
    {
      name: ["", [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
      password: ["", [Validators.required, Validators.minLength(10), Validators.maxLength(72)]],
      confirm: ["", [Validators.required]],
      acceptTerms: [false, [Validators.requiredTrue]],
    },
    { validators: (g) => (g.get("password")?.value === g.get("confirm")?.value ? null : { mismatch: true }) },
  );

  readonly passwordValue = toSignal(this.form.controls.password.valueChanges, { initialValue: "" });
  private readonly nameValue = toSignal(this.form.controls.name.valueChanges, { initialValue: "" });
  readonly passwordAssessment = computed(() => assessPassword(this.passwordValue(), this.nameValue()));
  readonly passwordStrength = computed(() => passwordStrengthLabel(this.passwordAssessment().score));

  constructor() {
    this.token = authBearer(this.route);
    this.location.replaceState("/auth/verify-email");
    if (!this.token) {
      this.done.set(true);
      this.message.set("Este enlace de verificación no es válido. Solicita un correo de verificación nuevo.");
    }
  }

  async verify(): Promise<void> {
    if (!this.token || this.busy() || this.ok() || this.linkRejected() || this.form.invalid) return;
    const ownedFocus = this.actionForm()?.nativeElement.contains(this.document.activeElement) ?? false;
    const request = this.requests.begin(this.token);
    const generation = this.auth.sessionGeneration();
    this.busy.set(true);
    this.attempted.set(true);
    this.failed.set(false);
    try {
      // Identity, legal acceptance and password all cross here: the backend
      // installs them at activation and re-stamps the acceptance with this
      // request's timestamp, so nothing the anonymous registration proposed
      // becomes definitive.
      const activation = await this.api.post("/api/v1/auth/verify-email", {
        token: this.token,
        password: this.form.controls.password.value,
        name: this.form.controls.name.value.trim(),
        acceptTerms: true,
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
      }, decodeRegistrationActivation);
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(true);
      this.done.set(true);
      this.newAccount.set(activation.newAccount);
      this.transferredLink.set(activation.pendingLink);
      this.form.reset();
      if (activation.authenticated && activation.user) {
        const adopted = await this.auth.acceptRegistrationSession(activation.user, generation);
        if (!this.requests.isCurrent(request, this.token)) return;
        if (adopted && activation.pendingLink) {
          await this.intents.refresh();
          if (!this.requests.isCurrent(request, this.token)) return;
        }
        this.signedIn.set(adopted);
      }
      this.message.set(
        this.signedIn()
          ? (this.hasPendingLink() ? "Tu cuenta y tu sesión están listas. Continúa para revisar y crear el enlace que has guardado." : "Tu cuenta y tu sesión están listas. Ya puedes entrar al panel.")
          : (this.auth.authenticated() ? "La cuenta está lista. Este navegador tiene otra cuenta abierta; puedes cerrar esa sesión para entrar con la nueva." : "Tu email quedó confirmado. Inicia sesión para continuar con tu cuenta."),
      );
    } catch (err) {
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(false);
      this.failed.set(true);
      if (err instanceof ApiRequestError && err.status === 400) this.linkRejected.set(true);
      this.message.set(err instanceof ApiRequestError ? err.message : "El enlace de verificación no es válido o ha caducado.");
    } finally {
      if (this.requests.isCurrent(request, this.token)) {
        this.busy.set(false);
        if (ownedFocus) {
          afterNextRender(() => {
            if (!this.requests.isCurrent(request, this.token) || this.document.activeElement !== this.document.body) return;
            const next = this.ok() || this.linkRejected() ? this.nextLink() : this.submitButton();
            next?.nativeElement.focus({ preventScroll: true });
          }, { injector: this.injector });
        }
      }
    }
  }

  async switchAccount(): Promise<void> {
    if (this.busy() || !this.ok()) return;
    this.busy.set(true);
    try {
      await this.auth.logout();
      await this.router.navigate(["/auth"], { queryParams: this.loginQueryParams() });
    } catch {
      this.message.set("No se pudo cerrar la sesión actual. Inténtalo de nuevo.");
    } finally {
      this.busy.set(false);
    }
  }
}
