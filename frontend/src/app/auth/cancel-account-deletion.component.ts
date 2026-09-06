import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from "@angular/core";
import { Location } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { AuthShellComponent } from "./auth-shell.component";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { authBearer } from "./auth-bearer";
import { LatestRequest } from "../core/services/latest-request";

@Component({
  selector: "app-cancel-account-deletion",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <main class="card center" aria-live="polite">
        <mat-icon class="icon" [class.ok]="done()" [class.bad]="error()">{{ done() ? 'restore' : (error() ? 'error_outline' : 'undo') }}</mat-icon>
        <h2>{{ done() ? 'Eliminación cancelada' : (error() ? 'No se pudo cancelar' : 'Conservar mi cuenta') }}</h2>
        <p class="sub">{{ message() }}</p>
        @if (!done() && !error()) {
          <button mat-flat-button color="primary" type="button" (click)="cancel()" [disabled]="busy()">{{ busy() ? 'Restaurando…' : 'Cancelar eliminación' }}</button>
        } @else {
          <a mat-flat-button color="primary" routerLink="/auth">{{ done() ? 'Iniciar sesión de nuevo' : 'Volver al acceso' }}</a>
        }
      </main>
    </app-auth-shell>
  `,
  styleUrl: "./auth-card.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class CancelAccountDeletionComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  private readonly token: string;

  readonly busy = signal(false);
  readonly done = signal(false);
  readonly error = signal(false);
  readonly message = signal("La cuenta volverá a estar disponible. Tendrás que iniciar sesión de nuevo. Los tokens API revocados y las invitaciones canceladas no se restaurarán.");

  constructor() {
    this.token = authBearer(this.route);
    this.location.replaceState("/auth/cancel-account-deletion");
    if (!this.token) {
      this.error.set(true);
      this.message.set("Falta el token de cancelación.");
    }
  }

  async cancel(): Promise<void> {
    if (this.busy() || this.done() || this.error()) return;
    const request = this.requests.begin(this.token);
    this.busy.set(true);
    try {
      await this.api.post("/api/v1/auth/account-deletion/cancel", { token: this.token });
      if (!this.requests.isCurrent(request, this.token)) return;
      this.done.set(true);
      this.message.set("La cuenta vuelve a estar activa. Inicia sesión para revisar tus sesiones, MFA y accesos de integración.");
    } catch (error) {
      if (!this.requests.isCurrent(request, this.token)) return;
      this.error.set(true);
      this.message.set(error instanceof ApiRequestError ? error.message : "No se pudo cancelar la eliminación.");
    } finally {
      if (this.requests.isCurrent(request, this.token)) this.busy.set(false);
    }
  }
}
