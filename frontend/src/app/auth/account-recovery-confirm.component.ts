import { UI_TEXT } from "../core/localisation/template-messages";
import { DOCUMENT, Location } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, inject, signal, viewChild } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { authBearer } from "./auth-bearer";
import { AuthShellComponent } from "./auth-shell.component";
import { LatestRequest } from "../core/services/latest-request";
import { decodePublicActionMessage } from "../core/services/public-action-response-decoders";

@Component({
  selector: "app-account-recovery-confirm",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <section class="card center" aria-labelledby="account-recovery-confirm-title">
        <span class="step-kicker"><ng-container i18n="@@ui.cb8ea5f355df6e">RECUPERACIÓN / CONFIRMAR SOLICITUD</ng-container></span>
        @if (busy()) { <mat-progress-bar mode="indeterminate" aria-label="Confirmando solicitud"  i18n-aria-label="@@ui.5f6bf3c814c0a4"/> }
        <mat-icon class="icon" [class.ok]="ok()" [class.bad]="done() && !ok()" aria-hidden="true">
          {{ ok() ? 'task_alt' : (done() ? 'error_outline' : 'fact_check') }}
        </mat-icon>
        <h2 id="account-recovery-confirm-title">{{ ok() ? uiText.ui_dae25bf0b02cf3 : (!token ? uiText.ui_11e385a1023bde : (done() ? uiText.ui_0e44a67c2e7662 : uiText.ui_b7f104249fb265)) }}</h2>
        <p class="sub" role="status">{{ message() }}</p>
        @if (!done() || retryable()) {
          <div class="alert info"><ng-container i18n="@@ui.2f393e2df4b3bb">Este paso sólo acredita el acceso al email. No inicia sesión, no cambia la contraseña y no desactiva MFA.</ng-container></div>
          <button #confirmButton mat-flat-button color="primary" class="submit" type="button" (click)="confirm()" [disabled]="busy() || !token">
            {{ busy() ? uiText.ui_923b438a98a7e0 : (retryable() ? uiText.ui_536ca3adeeb621 : uiText.ui_c2e97d1ad1d805) }}
          </button>
          <a class="back" routerLink="/auth"><ng-container i18n="@@ui.398d77ac3e135b">No continuar</ng-container></a>
        } @else {
          <a #accessLink mat-flat-button color="primary" routerLink="/auth"><ng-container i18n="@@ui.7c60b6892ea0a1">Volver al acceso</ng-container></a>
        }
      </section>
    </app-auth-shell>
  `,
  styleUrl: "./auth-card.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountRecoveryConfirmComponent {
  readonly uiText = UI_TEXT;
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly confirmButton = viewChild<unknown, ElementRef<HTMLButtonElement>>("confirmButton", { read: ElementRef });
  private readonly accessLink = viewChild<unknown, ElementRef<HTMLAnchorElement>>("accessLink", { read: ElementRef });
  private readonly requests = new LatestRequest(inject(DestroyRef));

  readonly token = authBearer(this.route);
  readonly busy = signal(false);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly retryable = signal(false);
  readonly message = signal($localize`:@@ui.cacb67e73627a3:Confirma que tú solicitaste recuperar una cuenta sin sus factores de acceso.`);

  constructor() {
    this.location.replaceState("/auth/account-recovery/confirm");
    if (!this.token) {
      this.done.set(true);
      this.message.set($localize`:@@ui.bf01bbe4192fe9:Falta el código de confirmación. Inicia una solicitud nueva.`);
    }
  }

  async confirm(): Promise<void> {
    if (!this.token || this.busy() || (this.done() && !this.retryable())) return;
    const ownedFocus = this.document.activeElement === this.confirmButton()?.nativeElement;
    const request = this.requests.begin(this.token);
    this.busy.set(true);
    this.done.set(false);
    this.retryable.set(false);
    try {
      const result = await this.api.post<{ ok: true; message: string }>(
        "/api/v1/auth/account-recovery/confirm",
        { token: this.token },
        decodePublicActionMessage,
      );
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(true);
      this.message.set(result.message);
    } catch (error) {
      if (this.requests.isCurrent(request, this.token)) {
        this.ok.set(false);
        this.retryable.set(!(error instanceof ApiRequestError) || error.status === 0 || error.status === 429 || error.status >= 500);
        this.message.set(error instanceof ApiRequestError ? error.message : $localize`:@@ui.75ea5152f1621d:No se pudo conectar con el servidor. Inténtalo de nuevo.`);
      }
    } finally {
      if (this.requests.isCurrent(request, this.token)) {
        this.busy.set(false);
        this.done.set(true);
        if (ownedFocus) {
          afterNextRender(() => {
            // Disabling/removing the action may send focus to the body. Restore
            // its logical successor without overriding a later user choice.
            if (!this.requests.isCurrent(request, this.token) || this.document.activeElement !== this.document.body) return;
            const next = this.retryable() ? this.confirmButton() : this.accessLink();
            next?.nativeElement.focus({ preventScroll: true });
          }, { injector: this.injector });
        }
      }
    }
  }
}
