import { Component, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { AuthShellComponent } from "./auth-shell.component";
import { ApiService, ApiRequestError } from "../core/services/api.service";

@Component({
  selector: "app-verify-email",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <div class="card center">
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" />
        }
        <mat-icon class="icon" [class.ok]="ok()" [class.bad]="!ok() && !busy() && done()">
          {{ ok() ? 'verified_user' : (done() ? 'error_outline' : 'schedule') }}
        </mat-icon>
        <h2>{{ ok() ? 'Email verificado' : (done() ? 'No se pudo verificar' : 'Verificando…') }}</h2>
        <p class="sub">{{ message() }}</p>
        @if (done()) {
          <a mat-flat-button color="primary" routerLink="/auth">Iniciar sesión</a>
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

  readonly busy = signal(true);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly message = signal("");

  constructor() {
    const token = this.route.snapshot.queryParamMap.get("token") ?? "";
    void this.verify(token);
  }

  private async verify(token: string): Promise<void> {
    try {
      await this.api.post("/api/v1/auth/verify-email", { token });
      this.ok.set(true);
      this.message.set("Tu email quedó confirmado. Ya puedes iniciar sesión y crear enlaces.");
    } catch (err) {
      this.ok.set(false);
      this.message.set(err instanceof ApiRequestError ? err.message : "El enlace de verificación no es válido o ha caducado.");
    } finally {
      this.busy.set(false);
      this.done.set(true);
    }
  }
}
