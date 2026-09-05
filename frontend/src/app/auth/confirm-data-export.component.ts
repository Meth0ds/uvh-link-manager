import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { Location } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { AuthShellComponent } from "./auth-shell.component";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { authBearer } from "./auth-bearer";

@Component({
  selector: "app-confirm-data-export",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <main class="card center" aria-live="polite">
        @if (busy()) { <mat-progress-bar mode="indeterminate" /> }
        <mat-icon class="icon" [class.ok]="ok()" [class.bad]="done() && !ok()">
          {{ ok() ? 'inventory_2' : (done() ? 'error_outline' : 'inventory') }}
        </mat-icon>
        <h2>{{ ok() ? 'Exportación confirmada' : (done() ? 'No se pudo confirmar' : 'Preparar mi exportación') }}</h2>
        <p class="sub">{{ message() }}</p>
        @if (!done()) {
          <button mat-flat-button color="primary" type="button" (click)="confirm()" [disabled]="busy()">
            {{ busy() ? 'Confirmando…' : 'Confirmar y preparar archivo' }}
          </button>
          <a class="back" routerLink="/auth">Cancelar</a>
        } @else {
          <a mat-flat-button color="primary" routerLink="/auth">Volver a UVH</a>
        }
      </main>
    </app-auth-shell>
  `,
  styleUrl: "./auth-card.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ConfirmDataExportComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private readonly token: string;

  readonly busy = signal(false);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly message = signal("La generación comenzará únicamente cuando pulses el botón. Recibirás otro correo al terminar.");

  constructor() {
    this.token = authBearer(this.route);
    this.location.replaceState("/auth/confirm-export");
    if (!this.token) {
      this.done.set(true);
      this.message.set("Falta el token de confirmación.");
    }
  }

  async confirm(): Promise<void> {
    if (this.busy() || this.done() || !this.token) return;
    this.busy.set(true);
    try {
      await this.api.post("/api/v1/auth/data-export/confirm", { token: this.token });
      this.ok.set(true);
      this.message.set("Estamos preparando el archivo en segundo plano. Recibirás un enlace de descarga de un solo uso cuando esté listo.");
    } catch (error) {
      this.message.set(error instanceof ApiRequestError ? error.message : "El enlace no es válido o ha caducado.");
    } finally {
      this.busy.set(false);
      this.done.set(true);
    }
  }
}
