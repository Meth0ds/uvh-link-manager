import { Component, computed, DestroyRef, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { Location } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { AuthShellComponent } from "./auth-shell.component";
import { ApiService, ApiRequestError } from "../core/services/api.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { PendingInvitationService } from "../core/services/pending-invitation.service";
import { authBearer } from "./auth-bearer";
import { LatestRequest } from "../core/services/latest-request";

@Component({
  selector: "app-verify-email",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, AuthShellComponent],
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
          <button mat-flat-button color="primary" type="button" (click)="verify()" [disabled]="busy()">
            {{ busy() ? 'Confirmando…' : (attempted() ? 'Volver a intentarlo' : 'Confirmar mi email') }}
          </button>
        }
        @if (done() && (ok() || !token)) {
          <a mat-flat-button color="primary" [routerLink]="['/auth']" [queryParams]="loginQueryParams()">
            {{ pendingLink() ? 'Iniciar sesión y crear mi enlace' : (pendingInvitation ? 'Iniciar sesión y revisar invitación' : 'Iniciar sesión') }}
          </a>
        }
      </div>
    </app-auth-shell>
    `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./auth-card.scss",
})
export class VerifyEmailComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private intents = inject(PendingLinkIntentService);
  private invitations = inject(PendingInvitationService);
  private location = inject(Location);
  private readonly requests = new LatestRequest(inject(DestroyRef));

  readonly busy = signal(true);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly attempted = signal(false);
  readonly message = signal("Confirma que tú creaste la cuenta. Si no reconoces este registro, no continúes.");
  readonly pendingLink = this.intents.pending;
  readonly pendingInvitation = this.invitations.hasPending();
  readonly token: string;
  readonly loginQueryParams = computed(() => this.pendingLink()
    ? { returnTo: "/app/links" }
    : (this.pendingInvitation ? { returnTo: "/invitations/accept" } : {}));

  constructor() {
    this.token = authBearer(this.route);
    this.location.replaceState("/auth/verify-email");
    this.busy.set(false);
    if (!this.token) {
      this.done.set(true);
      this.message.set("El enlace no contiene una credencial válida. Solicita un correo de verificación nuevo.");
    }
  }

  async verify(): Promise<void> {
    if (!this.token || this.busy() || this.ok()) return;
    const request = this.requests.begin(this.token);
    this.busy.set(true);
    this.attempted.set(true);
    try {
      await this.api.post("/api/v1/auth/verify-email", { token: this.token });
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(true);
      this.done.set(true);
      this.message.set(
        this.pendingLink()
          ? "Tu email quedó confirmado. Inicia sesión para crear el enlace que has guardado."
          : this.pendingInvitation
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
