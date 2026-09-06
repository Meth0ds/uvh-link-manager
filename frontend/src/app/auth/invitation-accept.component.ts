import { Location } from "@angular/common";
import { Component, DestroyRef, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { AuthShellComponent } from "./auth-shell.component";
import { ApiService, ApiRequestError } from "../core/services/api.service";
import { AuthService } from "../core/services/auth.service";
import { PendingInvitationService } from "../core/services/pending-invitation.service";
import { authBearer } from "./auth-bearer";
import { LatestRequest } from "../core/services/latest-request";

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
        <mat-icon class="icon" [class.ok]="ok() || rejected()" [class.bad]="!ok() && !rejected() && done() && !needsLogin()">{{ ok() ? 'group_add' : (rejected() ? 'person_remove' : (done() && !needsLogin() ? 'error_outline' : 'group_add')) }}</mat-icon>
        <h2>{{ ok() ? 'Invitación aceptada' : (rejected() ? 'Invitación rechazada' : (ready() ? 'Revisar invitación' : (done() && !needsLogin() ? 'No se pudo completar' : 'Acceso necesario'))) }}</h2>
        <p class="sub">{{ message() }}</p>
        @if (ready()) {
          <button mat-flat-button color="primary" type="button" (click)="accept()" [disabled]="busy()">Aceptar invitación</button>
          <button mat-stroked-button type="button" (click)="reject()" [disabled]="busy()">Rechazar</button>
        }
        @if (ok() || rejected()) {
          <a mat-flat-button color="primary" routerLink="/app">Ir a mi panel</a>
        }
        @if (done() && !ok() && needsLogin()) {
          <a mat-flat-button color="primary" [routerLink]="['/auth']" [queryParams]="{ returnTo: returnTo }">Iniciar sesión para continuar</a>
        }
        @if (done() && !ok() && !rejected() && !needsLogin() && !ready()) {
          <button mat-flat-button color="primary" type="button" (click)="switchAccount()" [disabled]="busy()">Cambiar de cuenta</button>
          <button mat-stroked-button type="button" (click)="discard()" [disabled]="busy()">Descartar invitación</button>
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
  private location = inject(Location);
  private invitations = inject(PendingInvitationService);
  private readonly operations = new LatestRequest(inject(DestroyRef));
  private readonly token: string;

  readonly busy = signal(true);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly rejected = signal(false);
  readonly ready = signal(false);
  readonly needsLogin = signal(false);
  readonly message = signal("");
  readonly returnTo = "/invitations/accept";

  constructor() {
    const incoming = authBearer(this.route);
    const fragmentExpiry = new URLSearchParams(this.route.snapshot.fragment ?? "").get("expiresAt");
    if (incoming) this.invitations.capture(incoming, fragmentExpiry);
    this.location.replaceState("/invitations/accept");
    this.token = this.invitations.token();
    void this.initialize();
  }

  async reject(): Promise<void> {
    if (!this.token || !this.auth.authenticated() || !this.ready() || this.busy()) return;
    const generation = this.auth.sessionGeneration();
    const context = `${this.token}:${generation}`;
    const request = this.operations.begin(context);
    this.busy.set(true);
    this.ready.set(false);
    try {
      await this.api.post("/api/v1/workspaces/invitations/reject", { token: this.token });
      if (!this.operations.isCurrent(request, context)
        || this.auth.sessionGeneration() !== generation
        || this.invitations.token() !== this.token) return;
      this.invitations.clear();
      this.ok.set(false);
      this.rejected.set(true);
      this.needsLogin.set(false);
      this.message.set("La invitación ha sido rechazada.");
    } catch (err) {
      if (this.operations.isCurrent(request, context)) {
        this.message.set(err instanceof ApiRequestError ? err.message : "No se pudo rechazar la invitación.");
      }
    } finally {
      if (this.operations.isCurrent(request, context)) {
        this.busy.set(false);
        this.done.set(true);
      }
    }
  }

  async switchAccount(): Promise<void> {
    if (this.busy()) return;
    const request = this.operations.begin(this.token);
    this.busy.set(true);
    try {
      await this.auth.logout();
      if (!this.operations.isCurrent(request, this.token)) return;
      await this.router.navigate(["/auth"], { queryParams: { returnTo: this.returnTo } });
    } catch (error) {
      if (this.operations.isCurrent(request, this.token)) {
        this.message.set(error instanceof ApiRequestError ? error.message : "No se pudo cerrar la sesión actual.");
      }
    } finally {
      if (this.operations.isCurrent(request, this.token)) this.busy.set(false);
    }
  }

  discard(): void {
    if (this.busy()) return;
    this.operations.invalidate();
    this.invitations.clear();
    void this.router.navigate(["/app"]);
  }

  async accept(): Promise<void> {
    if (!this.token || !this.auth.authenticated() || !this.ready() || this.busy()) return;
    const generation = this.auth.sessionGeneration();
    const context = `${this.token}:${generation}`;
    const request = this.operations.begin(context);
    this.busy.set(true);
    this.ready.set(false);
    try {
      await this.api.post<{ workspaceId: number }>("/api/v1/workspaces/invitations/accept", { token: this.token });
      if (!this.operations.isCurrent(request, context)
        || this.auth.sessionGeneration() !== generation
        || this.invitations.token() !== this.token) return;
      this.invitations.clear();
      this.ok.set(true);
      this.message.set("Te has unido al workspace. Ya puedes colaborar en sus enlaces.");
      try {
        const refreshed = await this.auth.refreshWorkspaces(generation);
        if (!refreshed && this.operations.isCurrent(request, context)) {
          this.message.set("La invitación se ha aceptado. Recarga el panel si el nuevo workspace aún no aparece.");
        }
      } catch {
        if (this.operations.isCurrent(request, context)) {
          this.message.set("La invitación se ha aceptado. Recarga el panel si el nuevo workspace aún no aparece.");
        }
      }
    } catch (err) {
      if (this.operations.isCurrent(request, context)) {
        this.ok.set(false);
        this.message.set(err instanceof ApiRequestError ? err.message : "La invitación no es válida o ha caducado.");
      }
    } finally {
      if (this.operations.isCurrent(request, context)) {
        this.busy.set(false);
        this.done.set(true);
      }
    }
  }

  private async initialize(): Promise<void> {
    const request = this.operations.begin(this.token);
    if (!this.token) {
      this.busy.set(false);
      this.done.set(true);
      this.message.set("La invitación no está disponible o ha caducado.");
      return;
    }
    if (!this.auth.loaded()) {
      try {
        await this.auth.init();
      } catch (error) {
        if (this.operations.isCurrent(request, this.token)) {
          this.busy.set(false);
          this.done.set(true);
          this.message.set(error instanceof ApiRequestError
            ? error.message
            : "No se pudo comprobar la sesión. Reintenta cuando recuperes la conexión.");
        }
        return;
      }
    }
    if (!this.operations.isCurrent(request, this.token) || this.invitations.token() !== this.token) return;
    if (!this.auth.authenticated()) {
      this.busy.set(false);
      this.done.set(true);
      this.ok.set(false);
      this.needsLogin.set(true);
      this.message.set(this.invitations.persistent()
        ? "Necesitas iniciar sesión para aceptar la invitación. Volveremos aquí automáticamente después del login."
        : "Necesitas iniciar sesión. Mantén esta pestaña abierta: el navegador ha bloqueado el almacenamiento persistente.");
      return;
    }
    this.busy.set(false);
    this.done.set(false);
    this.ready.set(true);
    this.message.set("Acepta para añadir tu cuenta al workspace o rechaza para invalidar este enlace.");
  }
}
