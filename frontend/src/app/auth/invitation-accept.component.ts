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
import { authBearer, bearerExpiry } from "./auth-bearer";
import { LatestRequest } from "../core/services/latest-request";

/**
 * Shown when the server never took the park. The credentials live in a HttpOnly
 * cookie now, so a refusal is not "the browser blocked storage": nothing was
 * stored, and the link in the email is the way back in.
 */
const NOT_PARKED = "No hemos podido guardar la invitación en este navegador. Vuelve a abrir el enlace del correo.";

@Component({
  selector: "app-invitation-accept",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <section class="card center" aria-labelledby="invitation-accept-title">
        <span class="step-kicker">TRABAJO EN EQUIPO</span>
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" aria-label="Procesando solicitud" />
        }
        <mat-icon class="icon" aria-hidden="true" [class.ok]="ok()" [class.invitation-neutral]="rejected()" [class.bad]="!busy() && !ok() && !rejected() && done() && !needsLogin()">{{ busy() ? 'hourglass_empty' : ok() ? 'group_add' : (rejected() ? 'person_remove' : (done() && !needsLogin() ? 'error_outline' : 'group_add')) }}</mat-icon>
        <h2 id="invitation-accept-title">{{ busy() ? 'Procesando invitación' : ok() ? 'Ya formas parte del equipo' : (rejected() ? 'Invitación rechazada' : (ready() ? 'Tú decides si te unes' : (done() && !needsLogin() ? 'No se pudo completar' : 'Acceso necesario'))) }}</h2>
        <p class="sub" role="status">{{ busy() ? 'Espera a que termine la comprobación. No cierres la página mientras se procesa una acción.' : message() }}</p>
        @if (ready()) {
          <div class="decision-guide"><div><h3>Si aceptas</h3><p>Se añadirá tu cuenta al workspace de la invitación. El servidor comprobará que corresponde a tu cuenta.</p></div><div><h3>Si rechazas</h3><p>Este enlace de invitación quedará invalidado. Tendrás que pedir una nueva invitación si cambias de opinión.</p></div></div>
          <div class="invitation-actions">
          <button mat-flat-button color="primary" type="button" (click)="accept()" [disabled]="busy()">Aceptar invitación</button>
          <button mat-stroked-button type="button" (click)="reject()" [disabled]="busy()">Rechazar</button>
          </div>
        }
        @if (ok() || rejected()) {
          <a mat-flat-button color="primary" routerLink="/app">Ir a mi panel</a>
        }
        @if (done() && !ok() && needsLogin()) {
          <a mat-flat-button color="primary" [routerLink]="['/auth']" [queryParams]="{ returnTo: returnTo }">Iniciar sesión para continuar</a>
        }
        @if (!busy() && done() && !ok() && !rejected() && !needsLogin() && !ready()) {
          <div class="invitation-actions">
          <button mat-flat-button color="primary" type="button" (click)="switchAccount()" [disabled]="busy()">Cambiar de cuenta</button>
          <button mat-stroked-button type="button" (click)="discard()" [disabled]="busy()">Descartar de este navegador</button>
          </div><p class="auth-note">Cambiar de cuenta cierra tu sesión actual. Descartar solo borra la invitación pendiente de este navegador; no equivale a rechazarla.</p>
        }
      </section>
    </app-auth-shell>
    `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./security-flow.scss",
})
export class InvitationAcceptComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private invitations = inject(PendingInvitationService);
  private readonly operations = new LatestRequest(inject(DestroyRef));
  /** Whether this browser is holding an invitation, and which park it was. */
  private parked = false;
  private revision = 0;

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
    const fragmentExpiry = bearerExpiry(this.route);
    // Parking is optimistic: the bearer leaves the URL immediately and the
    // server still has to take it. `initialize()` waits for that before the
    // component offers to spend it.
    this.parked = incoming ? this.invitations.capture(incoming, fragmentExpiry) : false;
    this.revision = this.invitations.revision();
    this.location.replaceState("/invitations/accept");
    // This async setup is the only path to a usable screen: an unexpected
    // failure has to end in a message, never in a view stuck on "Procesando".
    void this.initialize().catch((error: unknown) => {
      this.busy.set(false);
      this.ready.set(false);
      this.done.set(true);
      this.message.set(error instanceof ApiRequestError
        ? error.message
        : "No se pudo preparar la invitación. Vuelve a abrir el enlace del correo.");
    });
  }

  async reject(): Promise<void> {
    if (!this.parked || !this.auth.authenticated() || !this.ready() || this.busy()) return;
    const generation = this.auth.sessionGeneration();
    const context = this.context(generation);
    const request = this.operations.begin(context);
    this.busy.set(true);
    this.ready.set(false);
    try {
      if (!await this.parkIsSpendable()) {
        this.message.set(NOT_PARKED);
        return;
      }
      // The bearer is in the server's cookie now, so the body carries none.
      await this.api.post("/api/v1/workspaces/invitations/reject", {});
      if (!this.operations.isCurrent(request, context)
        || this.auth.sessionGeneration() !== generation
        || !this.stillParked()) return;
      // A terminal answer drops the cookie on the server side as well.
      this.invitations.hide();
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
    const context = this.context();
    const request = this.operations.begin(context);
    this.busy.set(true);
    try {
      await this.auth.logout();
      if (!this.operations.isCurrent(request, context)) return;
      await this.router.navigate(["/auth"], { queryParams: { returnTo: this.returnTo } });
    } catch (error) {
      if (this.operations.isCurrent(request, context)) {
        this.message.set(error instanceof ApiRequestError ? error.message : "No se pudo cerrar la sesión actual.");
      }
    } finally {
      if (this.operations.isCurrent(request, context)) this.busy.set(false);
    }
  }

  discard(): void {
    if (this.busy()) return;
    this.operations.invalidate();
    // `forget`, not `hide`: this browser is holding a live park, so the server
    // has to drop the cookie too.
    void this.invitations.forget();
    void this.router.navigate(["/app"]);
  }

  async accept(): Promise<void> {
    if (!this.parked || !this.auth.authenticated() || !this.ready() || this.busy()) return;
    const generation = this.auth.sessionGeneration();
    const context = this.context(generation);
    const request = this.operations.begin(context);
    this.busy.set(true);
    this.ready.set(false);
    try {
      if (!await this.parkIsSpendable()) {
        this.message.set(NOT_PARKED);
        return;
      }
      await this.api.post<{ workspaceId: number }>("/api/v1/workspaces/invitations/accept", {});
      if (!this.operations.isCurrent(request, context)
        || this.auth.sessionGeneration() !== generation
        || !this.stillParked()) return;
      this.invitations.hide();
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
        // 400 is the server's terminal answer, and it drops the cookie with it.
        if (err instanceof ApiRequestError && err.status === 400) this.invitations.hide();
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
    if (!this.parked) {
      // No bearer in the URL: this visit is the login round-trip, and the park
      // made on the first visit is what brought the visitor back. Only the
      // server can say whether it is still there.
      await this.invitations.refresh();
      this.parked = this.invitations.pending();
      this.revision = this.invitations.revision();
    }
    if (!this.parked) {
      this.busy.set(false);
      this.done.set(true);
      this.message.set("La invitación no está disponible o ha caducado.");
      return;
    }
    // A park made moments ago may still be in flight, and the server may cap
    // the deadline it confirms. Both settle here, and the ordering key is taken
    // afterwards: adopting the confirmed park is the point of waiting, not a
    // handoff that changed under the request.
    if (!await this.invitations.confirmed()) {
      this.busy.set(false);
      this.done.set(true);
      this.message.set(NOT_PARKED);
      return;
    }
    this.revision = this.invitations.revision();
    const request = this.operations.begin(this.context());
    if (!this.stillParked()) {
      this.busy.set(false);
      this.done.set(true);
      this.message.set(NOT_PARKED);
      return;
    }
    if (!this.auth.loaded()) {
      try {
        await this.auth.init();
      } catch (error) {
        if (this.operations.isCurrent(request, this.context())) {
          this.busy.set(false);
          this.done.set(true);
          this.message.set(error instanceof ApiRequestError
            ? error.message
            : "No se pudo comprobar la sesión. Reintenta cuando recuperes la conexión.");
        }
        return;
      }
    }
    if (!this.operations.isCurrent(request, this.context()) || !this.stillParked()) return;
    if (!this.auth.authenticated()) {
      this.busy.set(false);
      this.done.set(true);
      this.ok.set(false);
      this.needsLogin.set(true);
      this.message.set(this.invitations.persistent() === false
        ? "Necesitas iniciar sesión, y este navegador no ha podido guardar la invitación. Inicia sesión y vuelve a abrir el enlace del correo."
        : "Necesitas iniciar sesión para aceptar la invitación. Volveremos aquí automáticamente después del login.");
      return;
    }
    this.busy.set(false);
    this.done.set(false);
    this.ready.set(true);
    this.message.set("Acepta para añadir tu cuenta al workspace o rechaza para invalidar este enlace.");
  }

  /** Ordering key of a request: which park, under which session generation. */
  private context(generation = this.auth.sessionGeneration()): string {
    return `${this.parked}:${this.revision}:${generation}`;
  }

  /** True when the server has taken the park and nothing about it moved since. */
  private async parkIsSpendable(): Promise<boolean> {
    if (!await this.invitations.confirmed()) return false;

    return this.stillParked();
  }

  private stillParked(): boolean {
    return this.invitations.pending() && this.invitations.revision() === this.revision;
  }
}
