import { Component, inject, signal } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { ApiService, ApiRequestError } from "../core/services/api.service";
import { AuthService } from "../core/services/auth.service";

@Component({
  selector: "app-invitation-accept",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    <div class="wrap">
      <div class="card">
        <mat-progress-bar mode="indeterminate" *ngIf="busy()" />
        <mat-icon class="icon" [class.ok]="ok()" [class.bad]="!ok() && done()">{{ ok() ? 'group_add' : (done() ? 'error_outline' : 'schedule') }}</mat-icon>
        <h2>{{ ok() ? 'Invitación aceptada' : (done() ? 'No se pudo aceptar' : 'Procesando…') }}</h2>
        <p class="sub">{{ message() }}</p>
        <a mat-flat-button color="primary" routerLink="/app" *ngIf="ok()">Ir a mi panel</a>
        <a mat-flat-button color="primary" routerLink="/auth" *ngIf="done() && !ok()">Iniciar sesión</a>
      </div>
    </div>
  `,
  styles: [
    `
      .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--uvh-surface); }
      .card { position: relative; width: 100%; max-width: 440px; background: #fff; border: 1px solid var(--uvh-border); border-radius: 18px; box-shadow: 0 24px 70px rgba(7,17,31,.1); padding: 36px 28px; text-align: center; overflow: hidden; }
      .icon { font-size: 56px; width: 56px; height: 56px; margin-bottom: 12px; color: var(--uvh-muted); }
      .icon.ok { color: var(--uvh-teal); }
      .icon.bad { color: #b91c1c; }
      h2 { font-size: 21px; font-weight: 800; margin: 0 0 8px; }
      .sub { color: var(--uvh-muted); font-size: 14.5px; line-height: 1.6; margin: 0 0 18px; }
      a { display: inline-flex; }
    `,
  ],
})
export class InvitationAcceptComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly busy = signal(true);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly message = signal("");

  constructor() {
    const token = this.route.snapshot.queryParamMap.get("token") ?? "";
    void this.accept(token);
  }

  private async accept(token: string): Promise<void> {
    if (!this.auth.loaded()) {
      await this.auth.init();
    }
    if (!this.auth.authenticated()) {
      this.busy.set(false);
      this.done.set(true);
      this.ok.set(false);
      this.message.set("Necesitas iniciar sesión para aceptar la invitación.");
      return;
    }
    try {
      await this.api.post<{ workspaceId: number }>("/api/v1/workspaces/invitations/accept", { token });
      await this.auth.refreshWorkspaces();
      this.ok.set(true);
      this.message.set("Te has unido al workspace. Ya puedes colaborar en sus enlaces.");
    } catch (err) {
      this.ok.set(false);
      this.message.set(err instanceof ApiRequestError ? err.message : "La invitación no es válida o ha caducado.");
    } finally {
      this.busy.set(false);
      this.done.set(true);
    }
  }
}
