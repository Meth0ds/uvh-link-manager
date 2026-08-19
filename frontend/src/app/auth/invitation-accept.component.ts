import { Component, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { AuthShellComponent } from "./auth-shell.component";
import { ApiService, ApiRequestError } from "../core/services/api.service";
import { AuthService } from "../core/services/auth.service";

@Component({
  selector: "app-invitation-accept",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <div class="card center">
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" />
        }
        <mat-icon class="icon" [class.ok]="ok()" [class.bad]="!ok() && done()">{{ ok() ? 'group_add' : (done() ? 'error_outline' : 'schedule') }}</mat-icon>
        <h2>{{ ok() ? 'Invitación aceptada' : (done() ? 'No se pudo aceptar' : 'Procesando…') }}</h2>
        <p class="sub">{{ message() }}</p>
        @if (ok()) {
          <a mat-flat-button color="primary" routerLink="/app">Ir a mi panel</a>
        }
        @if (done() && !ok() && needsLogin()) {
          <a mat-flat-button color="primary" [routerLink]="['/auth']" [queryParams]="{ returnTo: returnTo }">Iniciar sesión para continuar</a>
          <button mat-stroked-button type="button" (click)="reject()">Rechazar invitación</button>
        }
        @if (done() && !ok() && !needsLogin()) {
          <a mat-flat-button color="primary" routerLink="/auth">Volver a iniciar sesión</a>
        }
      </div>
    </app-auth-shell>
    `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./auth-card.scss",
})
export class InvitationAcceptComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly busy = signal(true);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly needsLogin = signal(false);
  readonly message = signal("");
  readonly token = this.route.snapshot.queryParamMap.get("token") ?? "";
  readonly returnTo = `/auth/invitations/accept?token=${encodeURIComponent(this.token)}`;

  constructor() {
    void this.accept(this.token);
  }

  async reject(): Promise<void> {
    if (!this.token || !this.auth.authenticated() || this.busy()) return;
    this.busy.set(true);
    try {
      await this.api.post("/api/v1/workspaces/invitations/reject", { token: this.token });
      this.ok.set(false);
      this.needsLogin.set(false);
      this.message.set("La invitación ha sido rechazada.");
    } catch (err) {
      this.message.set(err instanceof ApiRequestError ? err.message : "No se pudo rechazar la invitación.");
    } finally {
      this.busy.set(false);
      this.done.set(true);
    }
  }

  private async accept(token: string): Promise<void> {
    if (!this.auth.loaded()) {
      await this.auth.init();
    }
    if (!this.auth.authenticated()) {
      this.busy.set(false);
      this.done.set(true);
      this.ok.set(false);
      this.needsLogin.set(true);
      this.message.set("Necesitas iniciar sesión para aceptar la invitación. Volveremos aquí automáticamente después del login.");
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
