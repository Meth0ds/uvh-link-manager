import { UI_TEXT } from "../core/localisation/template-messages";
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from "@angular/core";
import { Location } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { AuthShellComponent } from "./auth-shell.component";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { authBearer } from "./auth-bearer";
import { LatestRequest } from "../core/services/latest-request";

@Component({
  selector: "app-cancel-account-deletion",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <section class="card center" aria-labelledby="cancel-account-deletion-title">
        <span class="step-kicker"><ng-container i18n="@@ui.e3cb4c2b08abbd">CONSERVAR TU CUENTA</ng-container></span>
        <mat-icon class="icon" aria-hidden="true" [class.ok]="done()" [class.bad]="error()">{{ done() ? 'restore' : (error() ? 'error_outline' : 'undo') }}</mat-icon>
        <h2 id="cancel-account-deletion-title">{{ done() ? uiText.ui_dc871d829e4a71 : (!hasLink ? uiText.ui_11e385a1023bde : (error() ? uiText.ui_bd35c6c73755ee : uiText.ui_f714721b7c2e0e)) }}</h2>
        <p class="sub" role="status">{{ message() }}</p>
        @if (!done() && (!error() || retryable())) {
          <button mat-flat-button color="primary" type="button" (click)="cancel()" [disabled]="busy()">{{ busy() ? uiText.ui_cba38b93d3d3e1 : (retryable() ? uiText.ui_86fdca151b1337 : uiText.ui_c5a8f91a675f5c) }}</button>
        } @else {
          <a mat-flat-button color="primary" routerLink="/auth">{{ done() ? uiText.ui_7db772cf5391b6 : uiText.ui_7c60b6892ea0a1 }}</a>
        }
      </section>
    </app-auth-shell>
  `,
  styleUrl: "./auth-card.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class CancelAccountDeletionComponent {
  readonly uiText = UI_TEXT;
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  private readonly token: string;

  get hasLink(): boolean { return this.token.length > 0; }

  readonly busy = signal(false);
  readonly done = signal(false);
  readonly error = signal(false);
  readonly retryable = signal(false);
  readonly message = signal($localize`:@@ui.eade5c41249fd3:La cuenta volverá a estar disponible. Tendrás que iniciar sesión de nuevo. Los tokens API revocados y las invitaciones canceladas no se restaurarán.`);

  constructor() {
    this.token = authBearer(this.route);
    this.location.replaceState("/auth/cancel-account-deletion");
    if (!this.token) {
      this.error.set(true);
      this.message.set($localize`:@@ui.bebdf2c6e52f20:Falta el token de cancelación.`);
    }
  }

  async cancel(): Promise<void> {
    if (this.busy() || this.done() || (this.error() && !this.retryable())) return;
    const request = this.requests.begin(this.token);
    this.busy.set(true);
    this.error.set(false);
    this.retryable.set(false);
    try {
      await this.api.post("/api/v1/auth/account-deletion/cancel", { token: this.token });
      if (!this.requests.isCurrent(request, this.token)) return;
      this.done.set(true);
      this.message.set($localize`:@@ui.22553b810c450a:La cuenta vuelve a estar activa. Inicia sesión para revisar tus sesiones, MFA y accesos de integración.`);
    } catch (error) {
      if (!this.requests.isCurrent(request, this.token)) return;
      this.error.set(true);
      this.retryable.set(!(error instanceof ApiRequestError) || error.status === 0 || error.status === 429 || error.status >= 500);
      this.message.set(error instanceof ApiRequestError ? error.message : $localize`:@@ui.7e8c4217b265a4:No se pudo cancelar la eliminación.`);
    } finally {
      if (this.requests.isCurrent(request, this.token)) this.busy.set(false);
    }
  }
}
