import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from "@angular/core";
import { Location } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { AuthShellComponent } from "./auth-shell.component";
import { authBearer } from "./auth-bearer";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { AuthService } from "../core/services/auth.service";
import { LatestRequest } from "../core/services/latest-request";
import { decodePublicActionMessage } from "../core/services/public-action-response-decoders";

@Component({
  selector: "app-security-incident",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <main class="card center" aria-live="polite">
        @if (busy()) { <mat-progress-bar mode="indeterminate" aria-label="Revocando accesos" /> }
        <mat-icon class="icon" [class.ok]="ok()" [class.bad]="done() && !ok()">
          {{ ok() ? 'verified_user' : (done() ? 'error_outline' : 'gpp_maybe') }}
        </mat-icon>
        <h2>{{ ok() ? 'Accesos revocados' : (done() ? 'No se pudo usar el enlace' : 'Cerrar accesos de emergencia') }}</h2>
        <p class="sub">{{ message() }}</p>

        @if (!done()) {
          <div class="alert emergency-copy">
            Se cerrarán todas las sesiones, se revocarán los tokens API y se cancelarán cambios de email, exports y eliminaciones pendientes. Tu email y tu MFA no se modificarán.
          </div>
          <button mat-flat-button color="warn" type="button" class="submit" (click)="revoke()" [disabled]="busy() || !token">
            {{ busy() ? 'Cerrando accesos…' : 'Revocar todos los accesos' }}
          </button>
          <a class="back" routerLink="/auth">No hacer cambios</a>
        } @else if (ok()) {
          <a mat-flat-button color="primary" routerLink="/auth/forgot-password">Restablecer mi contraseña</a>
        } @else {
          <a mat-flat-button color="primary" routerLink="/auth/forgot-password">Iniciar recuperación segura</a>
        }
      </main>
    </app-auth-shell>
  `,
  styles: [`
    .emergency-copy { text-align: left; color: var(--uvh-ink); background: var(--uvh-warn-soft); border: 1px solid color-mix(in srgb, var(--uvh-warn) 35%, transparent); }
  `],
  styleUrl: "./auth-card.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class SecurityIncidentComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly location = inject(Location);
  private readonly route = inject(ActivatedRoute);
  private readonly requests = new LatestRequest(inject(DestroyRef));

  readonly token = authBearer(this.route);
  readonly busy = signal(false);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly message = signal("Usa este control sólo si no reconoces el cambio de contraseña comunicado por email.");

  constructor() {
    this.location.replaceState("/auth/security-incident");
    if (!this.token) {
      this.done.set(true);
      this.message.set("Falta el código de emergencia. Solicita una recuperación de contraseña para proteger la cuenta.");
    }
  }

  async revoke(): Promise<void> {
    if (!this.token || this.busy() || this.done()) return;
    const generation = this.auth.sessionGeneration();
    const request = this.requests.begin(this.token);
    this.busy.set(true);
    try {
      const result = await this.api.post<{ ok: true; message: string }>(
        "/api/v1/auth/security-incident/revoke",
        { token: this.token },
        decodePublicActionMessage,
      );
      this.auth.accountSignedOut(generation);
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(true);
      this.message.set(result.message);
    } catch (error) {
      if (this.requests.isCurrent(request, this.token)) {
        this.message.set(error instanceof ApiRequestError ? error.message : "No se pudo revocar el acceso. Inicia la recuperación de contraseña.");
      }
    } finally {
      if (this.requests.isCurrent(request, this.token)) {
        this.busy.set(false);
        this.done.set(true);
      }
    }
  }
}
