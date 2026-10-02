import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, Injector, signal, viewChild } from "@angular/core";
import { DOCUMENT, Location } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { AuthShellComponent } from "./auth-shell.component";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { AuthService } from "../core/services/auth.service";
import { authBearer } from "./auth-bearer";
import { LatestRequest } from "../core/services/latest-request";
import { decodeCredentialChange } from "../core/services/public-action-response-decoders";

@Component({
  selector: "app-confirm-email-change",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <section class="card center" aria-labelledby="confirm-email-change-title">
        <span class="step-kicker">CAMBIO DE DIRECCIÓN</span>
        @if (busy()) { <mat-progress-bar mode="indeterminate" aria-label="Procesando solicitud" /> }
        <mat-icon class="icon" aria-hidden="true" [class.ok]="ok()" [class.bad]="done() && !ok()">
          {{ ok() ? 'mark_email_read' : (done() ? 'error_outline' : 'mark_email_unread') }}
        </mat-icon>
        <h2 id="confirm-email-change-title">{{ ok() ? 'Email actualizado' : (!hasLink ? 'Enlace no disponible' : (done() ? 'No se pudo completar' : 'Confirmar nuevo email')) }}</h2>
        <p class="sub" [attr.role]="done() && !ok() ? 'alert' : 'status'">{{ message() }}</p>
        @if (!done() || retryable()) {
          <button #confirmButton mat-flat-button color="primary" type="button" (click)="confirm()" [disabled]="busy()">
            {{ busy() ? 'Confirmando…' : (retryable() ? 'Reintentar confirmación' : 'Confirmar y cerrar sesiones') }}
          </button>
          <a class="back" routerLink="/auth">No cambiar mi email</a>
        } @else {
          <a #accessLink mat-flat-button color="primary" routerLink="/auth">{{ ok() ? 'Iniciar sesión con el nuevo email' : 'Volver al acceso' }}</a>
        }
      </section>
    </app-auth-shell>
  `,
  styleUrl: "./auth-card.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ConfirmEmailChangeComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly confirmButton = viewChild<unknown, ElementRef<HTMLButtonElement>>("confirmButton", { read: ElementRef });
  private readonly accessLink = viewChild<unknown, ElementRef<HTMLAnchorElement>>("accessLink", { read: ElementRef });
  private readonly token: string;

  get hasLink(): boolean { return this.token.length > 0; }

  readonly busy = signal(false);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly retryable = signal(false);
  readonly message = signal("Al confirmar, el nuevo email sustituirá al actual y todas las sesiones quedarán cerradas.");

  constructor() {
    this.token = authBearer(this.route);
    this.location.replaceState("/auth/confirm-email");
    if (!this.token) {
      this.done.set(true);
      this.message.set("Falta el token de confirmación.");
    }
  }

  async confirm(): Promise<void> {
    if (this.busy() || (this.done() && !this.retryable()) || !this.token) return;
    const ownedFocus = this.document.activeElement === this.confirmButton()?.nativeElement;
    const generation = this.auth.sessionGeneration();
    const request = this.requests.begin(this.token);
    this.busy.set(true);
    this.done.set(false);
    this.retryable.set(false);
    try {
      const result = await this.api.post("/api/v1/auth/confirm-email-change", { token: this.token }, decodeCredentialChange);
      // Reconcile affected auth even after destruction, while preserving a
      // different identity or a login from a newer generation.
      if (result.current) this.auth.accountSignedOut(generation);
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(true);
      this.message.set("La nueva dirección ha quedado verificada. Hemos cerrado todas las sesiones para proteger la cuenta.");
    } catch (error) {
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(false);
      this.retryable.set(!(error instanceof ApiRequestError) || error.status === 0 || error.status === 429 || error.status >= 500);
      this.message.set(error instanceof ApiRequestError ? error.message : "No se pudo conectar con el servidor. Inténtalo de nuevo.");
    } finally {
      if (this.requests.isCurrent(request, this.token)) {
        this.busy.set(false);
        this.done.set(true);
        if (ownedFocus) {
          afterNextRender(() => {
            if (!this.requests.isCurrent(request, this.token) || this.document.activeElement !== this.document.body) return;
            const next = this.retryable() ? this.confirmButton() : this.accessLink();
            next?.nativeElement.focus({ preventScroll: true });
          }, { injector: this.injector });
        }
      }
    }
  }
}
