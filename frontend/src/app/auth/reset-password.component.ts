import { Component, computed, DestroyRef, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { Location } from "@angular/common";

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

@Component({
  selector: "app-reset-password",
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <div class="card" aria-labelledby="reset-password-title">
        <span class="step-kicker">RECUPERAR EL ACCESO</span>
        <h2 id="reset-password-title">Nueva contraseña</h2>
        <p class="sub">Utiliza una frase larga y exclusiva para UVH. No necesitas recordar la contraseña anterior.</p>
        @if (pendingLink()) {
          <p class="sub">Tu URL seguirá guardada cuando vuelvas a iniciar sesión.</p>
        } @else if (pendingInvitation) {
          <p class="sub">Tu invitación seguirá preparada cuando vuelvas a iniciar sesión.</p>
        }

        @if (!hasResetLink) {
          <div class="alert error" role="alert">Este enlace no contiene una autorización válida. Abre el correo de recuperación o solicita uno nuevo.</div>
          <a mat-flat-button routerLink="/auth/forgot-password">Solicitar otro enlace</a>
        } @else if (!done()) {
        <form class="form" [formGroup]="form" (ngSubmit)="submit()" [attr.aria-busy]="busy()">
          <mat-form-field appearance="outline">
            <mat-label>Nueva contraseña</mat-label>
            <input matInput [type]="hide() ? 'password' : 'text'" formControlName="password" autocomplete="new-password" maxlength="72" />
            <button mat-icon-button matSuffix type="button" (click)="hide.set(!hide())" [attr.aria-label]="hide() ? 'Mostrar contraseña' : 'Ocultar contraseña'">
              <mat-icon>{{ hide() ? 'visibility_off' : 'visibility' }}</mat-icon>
            </button>
            <mat-hint>Al menos 10 caracteres. Evita datos personales y frases habituales.</mat-hint>
            @if (form.controls.password.invalid) { <mat-error>Utiliza entre 10 y 72 caracteres.</mat-error> }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Confirmar contraseña</mat-label>
            <input matInput [type]="hide() ? 'password' : 'text'" formControlName="confirm" autocomplete="new-password" maxlength="72" />
          </mat-form-field>

          @if (error()) {
            <div class="alert error" role="alert">{{ error() }}</div>
          }
          @if (form.hasError('mismatch') && form.controls.confirm.touched) {
            <div class="alert error" role="alert">Las contraseñas no coinciden. Revisa el segundo campo.</div>
          }

          <button mat-flat-button color="primary" type="submit" class="submit" [disabled]="form.invalid || busy() || done()">
            {{ busy() ? 'Guardando…' : 'Guardar contraseña' }}
          </button>
        </form>
        }

        @if (done()) {
          <div class="alert ok" role="status">Contraseña actualizada. Ya puedes iniciar sesión.</div>
          <a class="back" [routerLink]="['/auth']" [queryParams]="loginQueryParams()">Ir a iniciar sesión</a>
        } @else {
          <a class="back" [routerLink]="['/auth']" [queryParams]="loginQueryParams()">← Volver al acceso</a>
        }
      </div>
    </app-auth-shell>
    `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./auth-card.scss",
})
export class ResetPasswordComponent {
  private fb = inject(FormBuilder);
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private intents = inject(PendingLinkIntentService);
  private invitations = inject(PendingInvitationService);
  private location = inject(Location);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  private readonly token: string;

  /** Expose only availability to the view, never interpolate the bearer. */
  get hasResetLink(): boolean { return this.token.length > 0; }

  readonly busy = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);
  readonly hide = signal(true);
  readonly pendingLink = this.intents.pending;
  readonly pendingInvitation = this.invitations.hasPending();
  readonly loginQueryParams = computed(() => this.pendingLink()
    ? { returnTo: "/app/links" }
    : (this.pendingInvitation ? { returnTo: "/invitations/accept" } : {}));

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
    const request = this.requests.begin(this.token);
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.post("/api/v1/auth/reset-password", { token: this.token, password: this.form.value.password });
      if (!this.requests.isCurrent(request, this.token)) return;
      this.done.set(true);
    } catch (err) {
      if (this.requests.isCurrent(request, this.token)) {
        this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo restablecer la contraseña");
      }
    } finally {
      if (this.requests.isCurrent(request, this.token)) this.busy.set(false);
    }
  }
}
