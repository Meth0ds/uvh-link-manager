import { Location } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { authBearer } from "./auth-bearer";
import { AuthShellComponent } from "./auth-shell.component";

@Component({
  selector: "app-account-recovery-confirm",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <main class="card center" aria-live="polite">
        @if (busy()) { <mat-progress-bar mode="indeterminate" aria-label="Confirmando solicitud" /> }
        <mat-icon class="icon" [class.ok]="ok()" [class.bad]="done() && !ok()" aria-hidden="true">
          {{ ok() ? 'task_alt' : (done() ? 'error_outline' : 'fact_check') }}
        </mat-icon>
        <h2>{{ ok() ? 'Expediente abierto' : (done() ? 'No se pudo confirmar' : 'Confirmar recuperación') }}</h2>
        <p class="sub">{{ message() }}</p>
        @if (!done()) {
          <div class="alert info">Este paso sólo acredita el acceso al email. No inicia sesión, no cambia la contraseña y no desactiva MFA.</div>
          <button mat-flat-button color="primary" class="submit" type="button" (click)="confirm()" [disabled]="busy() || !token">
            {{ busy() ? 'Confirmando…' : 'Confirmar y abrir expediente' }}
          </button>
          <a class="back" routerLink="/auth">No continuar</a>
        } @else {
          <a mat-flat-button color="primary" routerLink="/auth">Volver al acceso</a>
        }
      </main>
    </app-auth-shell>
  `,
  styleUrl: "./auth-card.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountRecoveryConfirmComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);

  readonly token = authBearer(this.route);
  readonly busy = signal(false);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly message = signal("Confirma que tú solicitaste recuperar una cuenta sin sus factores de acceso.");

  constructor() {
    this.location.replaceState("/auth/account-recovery/confirm");
    if (!this.token) {
      this.done.set(true);
      this.message.set("Falta el código de confirmación. Inicia una solicitud nueva.");
    }
  }

  async confirm(): Promise<void> {
    if (!this.token || this.busy() || this.done()) return;
    this.busy.set(true);
    try {
      const result = await this.api.post<{ ok: true; message: string }>("/api/v1/auth/account-recovery/confirm", { token: this.token });
      this.ok.set(true);
      this.message.set(result.message);
    } catch (error) {
      this.message.set(error instanceof ApiRequestError ? error.message : "No se pudo confirmar la solicitud");
    } finally {
      this.busy.set(false);
      this.done.set(true);
    }
  }
}
