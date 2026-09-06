import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from "@angular/core";
import { Location } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { AuthShellComponent } from "./auth-shell.component";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { AuthService } from "../core/services/auth.service";
import { authBearer } from "./auth-bearer";
import { LatestRequest } from "../core/services/latest-request";
import { decodeAccountDeletionConfirmation } from "../core/services/public-action-response-decoders";

@Component({
  selector: "app-confirm-account-deletion",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <main class="card center" aria-live="polite">
        <mat-icon class="icon" [class.ok]="done()" [class.bad]="error()">{{ done() ? 'event_available' : (error() ? 'error_outline' : 'person_remove') }}</mat-icon>
        <h2>{{ done() ? 'Eliminación programada' : (error() ? 'No se pudo programar' : 'Última confirmación') }}</h2>
        <p class="sub">{{ message() }}</p>
        @if (!done() && !error()) {
          <button mat-flat-button color="warn" type="button" (click)="confirm()" [disabled]="busy()">{{ busy() ? 'Programando…' : 'Cerrar acceso y programar eliminación' }}</button>
          <a class="back" routerLink="/app/settings">No eliminar mi cuenta</a>
        } @else {
          <a mat-flat-button color="primary" routerLink="/auth">Volver al acceso</a>
        }
      </main>
    </app-auth-shell>
  `,
  styleUrl: "./auth-card.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ConfirmAccountDeletionComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  private readonly token: string;

  readonly busy = signal(false);
  readonly done = signal(false);
  readonly error = signal(false);
  readonly message = signal("Al confirmar se cerrarán todas las sesiones y se cancelarán las invitaciones pendientes enviadas y recibidas. Recibirás un enlace para cancelar la eliminación durante los próximos 7 días; las invitaciones no se restaurarán.");

  constructor() {
    this.token = authBearer(this.route);
    this.location.replaceState("/auth/confirm-account-deletion");
    if (!this.token) {
      this.error.set(true);
      this.message.set("Falta el token de confirmación.");
    }
  }

  async confirm(): Promise<void> {
    if (this.busy() || this.done() || this.error()) return;
    const generation = this.auth.sessionGeneration();
    const request = this.requests.begin(this.token);
    this.busy.set(true);
    try {
      const result = await this.api.post<{ ok: true; executeAfter: string }>(
        "/api/v1/auth/account-deletion/confirm",
        { token: this.token },
        decodeAccountDeletionConfirmation,
      );
      this.auth.accountSignedOut(generation);
      if (!this.requests.isCurrent(request, this.token)) return;
      this.done.set(true);
      this.message.set(`El acceso está cerrado. La anonimización se ejecutará a partir de ${new Date(result.executeAfter).toLocaleString()}. Revisa tu email para conservar el enlace de cancelación.`);
    } catch (error) {
      if (!this.requests.isCurrent(request, this.token)) return;
      this.error.set(true);
      this.message.set(error instanceof ApiRequestError ? error.message : "No se pudo completar la confirmación.");
    } finally {
      if (this.requests.isCurrent(request, this.token)) this.busy.set(false);
    }
  }
}
