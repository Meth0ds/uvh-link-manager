import { Component, inject, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { ApiService, ApiRequestError } from "../core/services/api.service";

@Component({
  selector: "app-verify-email",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    <div class="wrap">
      <div class="card">
        <mat-progress-bar mode="indeterminate" *ngIf="busy()" />
        <mat-icon class="icon" [class.ok]="ok()" [class.bad]="!ok() && !busy() && done()">
          {{ ok() ? 'verified_user' : (done() ? 'error_outline' : 'schedule') }}
        </mat-icon>
        <h2>{{ ok() ? 'Email verificado' : (done() ? 'No se pudo verificar' : 'Verificando…') }}</h2>
        <p class="sub">{{ message() }}</p>
        <a mat-flat-button color="primary" routerLink="/auth" *ngIf="done()">Ir al panel</a>
      </div>
    </div>
  `,
  styles: [
    `
      .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--uvh-surface); }
      .card { position: relative; width: 100%; max-width: 420px; background: #fff; border: 1px solid var(--uvh-border); border-radius: 18px; box-shadow: 0 24px 70px rgba(7,17,31,.1); padding: 36px 28px; text-align: center; overflow: hidden; }
      .icon { font-size: 56px; width: 56px; height: 56px; margin-bottom: 12px; color: var(--uvh-muted); }
      .icon.ok { color: var(--uvh-teal); }
      .icon.bad { color: #b91c1c; }
      h2 { font-size: 21px; font-weight: 800; margin: 0 0 8px; }
      .sub { color: var(--uvh-muted); font-size: 14.5px; line-height: 1.6; margin: 0 0 18px; }
      a { display: inline-flex; }
    `,
  ],
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
