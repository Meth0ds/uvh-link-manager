import { UI_TEXT } from "../core/localisation/template-messages";
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, signal, ChangeDetectionStrategy, viewChild } from "@angular/core";
import { DOCUMENT, Location } from "@angular/common";

import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { AuthShellComponent } from "./auth-shell.component";
import { ApiService, ApiRequestError } from "../core/services/api.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { PendingInvitationService } from "../core/services/pending-invitation.service";
import { authBearer } from "./auth-bearer";
import { LatestRequest } from "../core/services/latest-request";
import { AuthService } from "../core/services/auth.service";
import { decodeCredentialChange } from "../core/services/public-action-response-decoders";

@Component({
  selector: "app-reset-password",
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <div class="card" aria-label="Recuperar el acceso" i18n-aria-label="@@ui.0cdc3b3b8e6841">
        <span class="step-kicker"><ng-container i18n="@@ui.f24759f8d2b74c">RECUPERAR EL ACCESO</ng-container></span>
        <h2 id="reset-password-title">{{ hasResetLink ? uiText.ui_902e689d3d52a0 : uiText.ui_11e385a1023bde }}</h2>
        @if (hasResetLink) { <p class="sub"><ng-container i18n="@@ui.515fcbfca71ddd">Utiliza una frase larga y exclusiva para UVH. No necesitas recordar la contraseña anterior.</ng-container></p> }
        @if (pendingLink()) {
          <p class="sub"><ng-container i18n="@@ui.50e54db5686f9d">Tu URL seguirá guardada cuando vuelvas a iniciar sesión.</ng-container></p>
        } @else if (pendingInvitation()) {
          <p class="sub"><ng-container i18n="@@ui.dfdc3edb12715f">Tu invitación seguirá preparada cuando vuelvas a iniciar sesión.</ng-container></p>
        }

        @if (!hasResetLink) {
          <div class="alert error" role="alert"><ng-container i18n="@@ui.61a1485eebc5c3">Este enlace no es válido o ha caducado. Abre el correo de recuperación o solicita uno nuevo.</ng-container></div>
          <a #nextLink mat-flat-button routerLink="/auth/forgot-password"><ng-container i18n="@@ui.345ca6883d4196">Solicitar otro enlace</ng-container></a>
        } @else if (!done()) {
        <form #actionForm class="form" [formGroup]="form" (ngSubmit)="submit()" [attr.aria-busy]="busy()">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label><ng-container i18n="@@ui.902e689d3d52a0">Nueva contraseña</ng-container></mat-label>
            <input matInput [type]="hide() ? 'password' : 'text'" formControlName="password" autocomplete="new-password" maxlength="72" />
            <button mat-icon-button matSuffix type="button" (click)="hide.set(!hide())" [attr.aria-label]="hide() ? uiText.ui_5fe3b78d0838f4 : uiText.ui_20d93396e534a5">
              <mat-icon>{{ hide() ? 'visibility_off' : 'visibility' }}</mat-icon>
            </button>
            <mat-hint><ng-container i18n="@@ui.d52130b02e2036">Al menos 10 caracteres. Evita datos personales y frases habituales.</ng-container></mat-hint>
            @if (form.controls.password.invalid) { <mat-error><ng-container i18n="@@ui.e3acd3c0081b57">Utiliza entre 10 y 72 caracteres.</ng-container></mat-error> }
          </mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label><ng-container i18n="@@ui.9cd535f99c26ba">Confirmar contraseña</ng-container></mat-label>
            <input matInput [type]="hide() ? 'password' : 'text'" formControlName="confirm" autocomplete="new-password" maxlength="72" />
          </mat-form-field>

          @if (error()) {
            <div class="alert error" role="alert">{{ error() }}</div>
          }
          @if (form.hasError('mismatch') && form.controls.confirm.touched) {
            <div class="alert error" role="alert"><ng-container i18n="@@ui.dcce46a3ea026e">Las contraseñas no coinciden. Revisa el segundo campo.</ng-container></div>
          }

          <button #submitButton mat-flat-button color="primary" type="submit" class="submit" [disabled]="form.invalid || busy() || done()">
            {{ busy() ? uiText.ui_3c8dc4dc7a83dd : uiText.ui_4a0a1bd212fca9 }}
          </button>
        </form>
        }

        @if (done()) {
          <div class="alert ok" role="status"><ng-container i18n="@@ui.ca4b51b24c10d9">Contraseña actualizada. Ya puedes iniciar sesión.</ng-container></div>
          <a #nextLink class="back" [routerLink]="['/auth']" [queryParams]="loginQueryParams()"><ng-container i18n="@@ui.18ab5ce5fc3a86">Ir a iniciar sesión</ng-container></a>
        } @else {
          <a class="back" [routerLink]="['/auth']" [queryParams]="loginQueryParams()"><ng-container i18n="@@ui.161fc295cd82f8">← Volver al acceso</ng-container></a>
        }
      </div>
    </app-auth-shell>
    `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./auth-card.scss",
})
export class ResetPasswordComponent {
  readonly uiText = UI_TEXT;
  private fb = inject(FormBuilder);
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private intents = inject(PendingLinkIntentService);
  private invitations = inject(PendingInvitationService);
  private location = inject(Location);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  private readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly actionForm = viewChild<unknown, ElementRef<HTMLFormElement>>("actionForm", { read: ElementRef });
  private readonly submitButton = viewChild<unknown, ElementRef<HTMLButtonElement>>("submitButton", { read: ElementRef });
  private readonly nextLink = viewChild<unknown, ElementRef<HTMLAnchorElement>>("nextLink", { read: ElementRef });
  private readonly token: string;

  /** Expose only availability to the view, never interpolate the bearer. */
  get hasResetLink(): boolean { return this.token.length > 0 && !this.linkRejected(); }

  readonly busy = signal(false);
  readonly done = signal(false);
  readonly linkRejected = signal(false);
  readonly error = signal<string | null>(null);
  readonly hide = signal(true);
  readonly pendingLink = this.intents.pending;
  readonly pendingInvitation = this.invitations.pending;
  readonly loginQueryParams = computed(() => this.pendingLink()
    ? { returnTo: "/app/links" }
    : (this.pendingInvitation() ? { returnTo: "/invitations/accept" } : {}));

  form = this.fb.nonNullable.group(
    {
      password: ["", [Validators.required, Validators.minLength(10), Validators.maxLength(72)]],
      confirm: ["", [Validators.required]],
    },
    { validators: (g) => (g.get("password")?.value === g.get("confirm")?.value ? null : { mismatch: true }) },
  );

  constructor() {
    this.token = authBearer(this.route);
    this.location.replaceState("/auth/reset-password");
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.busy() || this.done() || !this.hasResetLink) return;
    const ownedFocus = this.actionForm()?.nativeElement.contains(this.document.activeElement) ?? false;
    const generation = this.auth.sessionGeneration();
    const request = this.requests.begin(this.token);
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.api.post("/api/v1/auth/reset-password", { token: this.token, password: this.form.value.password }, decodeCredentialChange);
      if (result.current) this.auth.accountSignedOut(generation);
      if (!this.requests.isCurrent(request, this.token)) return;
      this.done.set(true);
      this.form.reset();
    } catch (err) {
      if (this.requests.isCurrent(request, this.token)) {
        this.error.set(err instanceof ApiRequestError ? err.message : $localize`:@@ui.4a9afd65769978:No se pudo restablecer la contraseña`);
        if (err instanceof ApiRequestError && err.status === 400) this.linkRejected.set(true);
      }
    } finally {
      if (this.requests.isCurrent(request, this.token)) {
        this.busy.set(false);
        if (ownedFocus) {
          afterNextRender(() => {
            if (!this.requests.isCurrent(request, this.token) || this.document.activeElement !== this.document.body) return;
            const next = this.done() || this.linkRejected() ? this.nextLink() : this.submitButton();
            next?.nativeElement.focus({ preventScroll: true });
          }, { injector: this.injector });
        }
      }
    }
  }
}
