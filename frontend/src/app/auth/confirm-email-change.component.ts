import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from "@angular/core";
import { Location } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { AuthShellComponent } from "./auth-shell.component";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { AuthService } from "../core/services/auth.service";
import { authBearer } from "./auth-bearer";
import { LatestRequest } from "../core/services/latest-request";

@Component({
  selector: "app-confirm-email-change",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <section class="card center" aria-labelledby="confirm-email-change-title">
        <span class="step-kicker">CAMBIO DE DIRECCIÓN</span>
        @if (busy()) { <mat-progress-bar mode="indeterminate" aria-label="Procesando solicitud" /> }
        <mat-icon class="icon" aria-hidden="true" [class.ok]="ok()" [class.bad]="done() && !ok()">
          {{ ok() ? 'mark_email_read' : (done() ? 'error_outline' : 'mark_email_unread') }}
        </mat-icon>
        <h2 id="confirm-email-change-title">{{ ok() ? 'Email actualizado' : (done() ? 'No se pudo completar' : 'Confirmar nuevo email') }}</h2>
        <p class="sub" role="status">{{ message() }}</p>
        @if (!done()) {
          <button mat-flat-button color="primary" type="button" (click)="confirm()" [disabled]="busy()">
            {{ busy() ? 'Confirmando…' : 'Confirmar y cerrar sesiones' }}
          </button>
          <a class="back" routerLink="/auth">No cambiar mi email</a>
        } @else {
          <a mat-flat-button color="primary" routerLink="/auth">{{ ok() ? 'Iniciar sesión con el nuevo email' : 'Volver al acceso' }}</a>
        }
      </section>
    </app-auth-shell>
  `,
  styleUrl: "./auth-card.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ConfirmEmailChangeComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  private readonly token: string;

  readonly busy = signal(false);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly message = signal("Al confirmar, el nuevo email sustituirá al actual y todas las sesiones quedarán cerradas.");

  constructor() {
    this.token = authBearer(this.route);
    this.location.replaceState("/auth/confirm-email");
    if (!this.token) {
      this.done.set(true);
      this.message.set("Falta el token de confirmación.");
    }
  }

  async confirm(): Promise<void> {
    if (this.busy() || this.done() || !this.token) return;
    const generation = this.auth.sessionGeneration();
    const request = this.requests.begin(this.token);
    this.busy.set(true);
    try {
      await this.api.post("/api/v1/auth/confirm-email-change", { token: this.token });
      // The response clears the session cookie. Reconcile global auth even if
      // this view closed, but never erase a login from a newer generation.
      this.auth.accountSignedOut(generation);
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(true);
      this.message.set("La nueva dirección ha quedado verificada. Hemos cerrado todas las sesiones para proteger la cuenta.");
    } catch (error) {
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(false);
      this.message.set(error instanceof ApiRequestError ? error.message : "El enlace no es válido o ha caducado.");
    } finally {
      if (this.requests.isCurrent(request, this.token)) {
        this.busy.set(false);
        this.done.set(true);
      }
    }
  }
}
