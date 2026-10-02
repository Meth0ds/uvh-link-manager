import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, Injector, signal, viewChild } from "@angular/core";
import { DOCUMENT, Location } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { AuthShellComponent } from "./auth-shell.component";
import { authBearer } from "./auth-bearer";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { AuthService } from "../core/services/auth.service";
import { LatestRequest } from "../core/services/latest-request";
import { decodeSecurityIncident } from "../core/services/public-action-response-decoders";

@Component({
  selector: "app-security-incident",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <section class="card center" aria-labelledby="security-incident-title">
        <span class="step-kicker">SEGURIDAD / RESPUESTA DE EMERGENCIA</span>
        @if (busy()) { <mat-progress-bar mode="indeterminate" aria-label="Revocando accesos" /> }
        <mat-icon class="icon" aria-hidden="true" [class.ok]="ok()" [class.bad]="failed() || (done() && !ok())">
          {{ ok() ? 'verified_user' : (failed() || done() ? 'error_outline' : 'gpp_maybe') }}
        </mat-icon>
        <h2 id="security-incident-title">{{ ok() ? 'Accesos revocados' : (!token ? 'Enlace no disponible' : (done() ? 'No se pudo usar el enlace' : 'Cerrar accesos de emergencia')) }}</h2>
        <p class="sub" [attr.role]="failed() ? 'alert' : 'status'">{{ message() }}</p>

        @if (!done()) {
          <div class="alert emergency-copy">
            Se cerrarán todas las sesiones, se revocarán los tokens API y se cancelarán cambios de email, exportaciones y eliminaciones pendientes. Tu email y tu MFA no se modificarán.
          </div>
          <button #actionButton mat-flat-button class="danger-action submit" type="button" (click)="revoke()" [disabled]="busy() || !token">
            {{ busy() ? 'Cerrando accesos…' : (failed() ? 'Reintentar revocación' : 'Revocar todos los accesos') }}
          </button>
          <a class="back" routerLink="/auth">No hacer cambios</a>
        } @else if (ok()) {
          <a #recoveryLink mat-flat-button color="primary" routerLink="/auth/forgot-password">Restablecer mi contraseña</a>
        } @else {
          <a #recoveryLink mat-flat-button color="primary" routerLink="/auth/forgot-password">Iniciar recuperación segura</a>
        }
      </section>
    </app-auth-shell>
  `,
  styleUrl: "./auth-card.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class SecurityIncidentComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly location = inject(Location);
  private readonly route = inject(ActivatedRoute);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly actionButton = viewChild<unknown, ElementRef<HTMLButtonElement>>("actionButton", { read: ElementRef });
  private readonly recoveryLink = viewChild<unknown, ElementRef<HTMLAnchorElement>>("recoveryLink", { read: ElementRef });

  readonly token = authBearer(this.route);
  readonly busy = signal(false);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly failed = signal(false);
  readonly message = signal("Usa este control si no reconoces el cambio o el cierre de sesiones comunicado por email.");

  constructor() {
    this.location.replaceState("/auth/security-incident");
    if (!this.token) {
      this.done.set(true);
      this.message.set("Falta el código de emergencia. Solicita una recuperación de contraseña para proteger la cuenta.");
    }
  }

  async revoke(): Promise<void> {
    if (!this.token || this.busy() || this.done()) return;
    const ownedFocus = this.document.activeElement === this.actionButton()?.nativeElement;
    const generation = this.auth.sessionGeneration();
    const request = this.requests.begin(this.token);
    this.busy.set(true);
    this.failed.set(false);
    try {
      const result = await this.api.post<{ ok: true; message: string; current: boolean }>(
        "/api/v1/auth/security-incident/revoke",
        { token: this.token },
        decodeSecurityIncident,
      );
      if (result.current) this.auth.accountSignedOut(generation);
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(true);
      this.done.set(true);
      this.message.set(result.message);
    } catch (error) {
      if (this.requests.isCurrent(request, this.token)) {
        this.failed.set(true);
        this.done.set(error instanceof ApiRequestError && error.status > 0 && error.status !== 429 && error.status < 500);
        this.message.set(error instanceof ApiRequestError ? error.message : "No se pudo confirmar el cierre de accesos. Inténtalo de nuevo.");
      }
    } finally {
      if (this.requests.isCurrent(request, this.token)) {
        this.busy.set(false);
        if (ownedFocus) {
          afterNextRender(() => {
            if (!this.requests.isCurrent(request, this.token) || this.document.activeElement !== this.document.body) return;
            const next = this.done() ? this.recoveryLink() : this.actionButton();
            next?.nativeElement.focus({ preventScroll: true });
          }, { injector: this.injector });
        }
      }
    }
  }
}
