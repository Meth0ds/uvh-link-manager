import { Component, computed, DestroyRef, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { Location } from "@angular/common";

import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { AuthShellComponent } from "./auth-shell.component";
import { ApiService, ApiRequestError } from "../core/services/api.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { PendingInvitationService } from "../core/services/pending-invitation.service";
import { authBearer } from "./auth-bearer";
import { LatestRequest } from "../core/services/latest-request";

/**
 * Activation of a pending registration: the email bearer plus the password
 * typed here, which becomes the account's credential.
 *
 * The password is established AFTER the mailbox proof and never taken from the
 * pending registration, because that proposal is not a credential: any
 * anonymous registration writes one. Whoever opens the mailbox decides the
 * definitive password, and a later anonymous registration cannot replace the
 * row it belongs to either, so the pre-hijack —the attacker registers the
 * victim's address and waits for the click— has nothing to install.
 */
@Component({
  selector: "app-verify-email",
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, MatProgressBarModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <div class="card center" aria-labelledby="verify-email-title">
        <span class="step-kicker">VERIFICACIÓN DE EMAIL</span>
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" aria-label="Procesando solicitud" />
        }
        <mat-icon class="icon" aria-hidden="true" [class.ok]="ok()" [class.bad]="!token && done()">
          {{ ok() ? 'verified_user' : (!token ? 'error_outline' : 'mark_email_read') }}
        </mat-icon>
        <h2 id="verify-email-title">{{ ok() ? 'Email verificado' : (!token ? 'Enlace no disponible' : 'Confirmar email') }}</h2>
        <p class="sub" role="status">{{ message() }}</p>
        @if (token && !ok()) {
          <form class="form" [formGroup]="form" (ngSubmit)="verify()" [attr.aria-busy]="busy()">
            <mat-form-field appearance="outline">
              <mat-label>Contraseña</mat-label>
              <input matInput [type]="hide() ? 'password' : 'text'" formControlName="password" autocomplete="new-password" maxlength="72" />
              <button mat-icon-button matSuffix type="button" (click)="hide.set(!hide())" [attr.aria-label]="hide() ? 'Mostrar contraseña' : 'Ocultar contraseña'">
                <mat-icon>{{ hide() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              <mat-hint>Es la contraseña definitiva de tu cuenta. Si ya elegiste una al registrarte, puedes repetirla.</mat-hint>
              @if (form.controls.password.invalid && form.controls.password.touched) { <mat-error>Utiliza entre 10 y 72 caracteres.</mat-error> }
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Repite la contraseña</mat-label>
              <input matInput [type]="hide() ? 'password' : 'text'" formControlName="confirm" autocomplete="new-password" maxlength="72" />
            </mat-form-field>
            @if (form.hasError('mismatch') && form.controls.confirm.touched) {
              <div class="alert error" role="alert">Las contraseñas no coinciden. Revisa el segundo campo.</div>
            }
            <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid || busy()">
              {{ busy() ? 'Confirmando…' : (attempted() ? 'Volver a intentarlo' : 'Confirmar mi email') }}
            </button>
          </form>
        }
        @if (done() && (ok() || !token)) {
          <a mat-flat-button color="primary" [routerLink]="['/auth']" [queryParams]="loginQueryParams()">
            {{ pendingLink() ? 'Iniciar sesión y crear mi enlace' : (pendingInvitation() ? 'Iniciar sesión y revisar invitación' : 'Iniciar sesión') }}
          </a>
        }
      </div>
    </app-auth-shell>
    `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./auth-card.scss",
})
export class VerifyEmailComponent {
  private fb = inject(FormBuilder);
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private intents = inject(PendingLinkIntentService);
  private invitations = inject(PendingInvitationService);
  private location = inject(Location);
  private readonly requests = new LatestRequest(inject(DestroyRef));

  readonly busy = signal(false);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly attempted = signal(false);
  readonly hide = signal(true);
  readonly message = signal("Confirma que tú creaste la cuenta y elige su contraseña. Si no reconoces este registro, no continúes.");
  readonly pendingLink = this.intents.pending;
  readonly pendingInvitation = this.invitations.pending;
  readonly token: string;
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
    this.location.replaceState("/auth/verify-email");
    if (!this.token) {
      this.done.set(true);
      this.message.set("El enlace no contiene una credencial válida. Solicita un correo de verificación nuevo.");
    }
  }

  async verify(): Promise<void> {
    if (!this.token || this.busy() || this.ok() || this.form.invalid) return;
    const request = this.requests.begin(this.token);
    this.busy.set(true);
    this.attempted.set(true);
    try {
      await this.api.post("/api/v1/auth/verify-email", { token: this.token, password: this.form.value.password });
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(true);
      this.done.set(true);
      this.message.set(
        this.pendingLink()
          ? "Tu email quedó confirmado. Inicia sesión para crear el enlace que has guardado."
          : this.pendingInvitation()
            ? "Tu email quedó confirmado. Inicia sesión para revisar la invitación pendiente."
            : "Tu email quedó confirmado. Ya puedes iniciar sesión y crear enlaces.",
      );
    } catch (err) {
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(false);
      this.message.set(err instanceof ApiRequestError ? err.message : "El enlace de verificación no es válido o ha caducado.");
    } finally {
      if (this.requests.isCurrent(request, this.token)) this.busy.set(false);
    }
  }
}
