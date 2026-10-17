import { UI_TEXT } from "../core/localisation/template-messages";
import { ChangeDetectionStrategy, Component, DestroyRef, ViewChild, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { AuthShellComponent } from "./auth-shell.component";
import { HCaptchaWidgetComponent } from "./hcaptcha-widget.component";
import { LatestRequest } from "../core/services/latest-request";
import { decodePublicConfig } from "../core/services/public-response-decoders";
import { decodePublicActionMessage } from "../core/services/public-action-response-decoders";

interface PublicAuthConfig {
  hcaptcha?: { enabled?: boolean; siteKey?: string | null };
}

@Component({
  selector: "app-account-recovery-request",
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, AuthShellComponent, HCaptchaWidgetComponent],
  template: `
    <app-auth-shell>
      <section class="card recovery-card" aria-labelledby="recovery-title">
        <span class="step-kicker"><ng-container i18n="@@ui.5e04be35224e3a">Recuperación reforzada</ng-container></span>
        <h2 id="recovery-title"><ng-container i18n="@@ui.ea82b6d5ec23c9">¿Has perdido todos tus factores?</ng-container></h2>
        <p class="sub"><ng-container i18n="@@ui.0865d7cd12cff3">Utiliza este procedimiento sólo si no puedes acceder a tu contraseña, autenticador ni códigos de recuperación.</ng-container></p>

        @if (!sent()) {
          <ol class="process" aria-label="Proceso de recuperación" i18n-aria-label="@@ui.751ae564e8a807">
            <li><span>01</span><p><b><ng-container i18n="@@ui.c5b70c6a213876">Confirma tu email</ng-container></b><small><ng-container i18n="@@ui.94222936d47e90">El enlace no inicia sesión ni desactiva MFA.</ng-container></small></p></li>
            <li><span>02</span><p><b><ng-container i18n="@@ui.ab795adbc42f9c">Verificación por soporte</ng-container></b><small><ng-container i18n="@@ui.74a9150bcdaf92">La identidad se contrasta fuera de esta página.</ng-container></small></p></li>
            <li><span>03</span><p><b><ng-container i18n="@@ui.c1d2ee1b29c0c5">Doble aprobación</ng-container></b><small><ng-container i18n="@@ui.809def221143dd">Dos administradores distintos con MFA deben aprobar.</ng-container></small></p></li>
          </ol>

          <form class="form" [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field subscriptSizing="dynamic" appearance="outline">
              <mat-label><ng-container i18n="@@ui.1e0ac11d2d1d36">Email de la cuenta</ng-container></mat-label>
              <mat-icon matPrefix aria-hidden="true">mail_outline</mat-icon>
              <input matInput type="email" formControlName="email" autocomplete="email" maxlength="254" />
            </mat-form-field>

            @if (captchaConfigBusy()) {
              <div class="alert info" role="status"><ng-container i18n="@@ui.5284d73a63e99c">Cargando hCaptcha…</ng-container></div>
            } @else if (hcaptchaSiteKey(); as siteKey) {
              <app-hcaptcha-widget #recoveryCaptcha [siteKey]="siteKey" (tokenChange)="onCaptchaToken($event)" />
            } @else {
              <div class="alert error" role="alert">{{ captchaConfigError() }} <button mat-button type="button" (click)="loadCaptchaConfiguration()"><ng-container i18n="@@ui.a9254c5f812829">Reintentar</ng-container></button></div>
            }
            @if (error(); as message) { <div class="alert error" role="alert">{{ message }}</div> }
            <button mat-flat-button color="primary" class="submit" type="submit" [disabled]="form.invalid || busy() || !captchaToken()">
              {{ busy() ? uiText.ui_f4ef05a8596210 : uiText.ui_9197b1259dc022 }}
            </button>
          </form>
        } @else {
          <section class="result" role="status">
            <mat-icon class="icon ok" aria-hidden="true">mark_email_read</mat-icon>
            <h3><ng-container i18n="@@ui.0c3d6e9b22cd1e">Revisa tu correo</ng-container></h3>
            <p><ng-container i18n="@@ui.f2c1794d6be5a6">Si la cuenta cumple los requisitos, recibirás un enlace válido durante una hora. La respuesta es deliberadamente idéntica para todas las direcciones.</ng-container></p>
          </section>
        }

        <a class="back" routerLink="/auth"><ng-container i18n="@@ui.161fc295cd82f8">← Volver al acceso</ng-container></a>
      </section>
    </app-auth-shell>
  `,
  styleUrl: "./auth-card.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountRecoveryRequestComponent {
  readonly uiText = UI_TEXT;
  @ViewChild("recoveryCaptcha") private captchaWidget?: HCaptchaWidgetComponent;

  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly configRequests = new LatestRequest(inject(DestroyRef));
  private readonly submitRequests = new LatestRequest(inject(DestroyRef));

  readonly busy = signal(false);
  readonly sent = signal(false);
  readonly error = signal<string | null>(null);
  readonly captchaConfigBusy = signal(true);
  readonly captchaConfigError = signal<string | null>(null);
  readonly hcaptchaSiteKey = signal("");
  readonly captchaToken = signal("");
  readonly form = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email, Validators.maxLength(254)]],
  });

  constructor() {
    void this.loadCaptchaConfiguration();
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.busy() || !this.captchaToken()) {
      this.form.markAllAsTouched();
      if (!this.captchaToken()) this.error.set($localize`:@@ui.00dcf638b0a511:Completa hCaptcha para continuar.`);
      return;
    }
    const email = this.form.controls.email.value.trim().toLowerCase();
    const request = this.submitRequests.begin(email);
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.post("/api/v1/auth/account-recovery/request", {
        email,
        captchaToken: this.captchaToken(),
      }, decodePublicActionMessage);
      if (!this.submitRequests.isCurrent(request, email)) return;
      this.sent.set(true);
    } catch (error) {
      if (!this.submitRequests.isCurrent(request, email)) return;
      this.error.set(error instanceof ApiRequestError ? error.message : $localize`:@@ui.bbee5dfac4d0ea:No se pudo iniciar la recuperación`);
      this.captchaToken.set("");
      this.captchaWidget?.reset();
    } finally {
      if (this.submitRequests.isCurrent(request, email)) this.busy.set(false);
    }
  }

  onCaptchaToken(token: string): void {
    this.captchaToken.set(token);
    if (token && this.error() === "Completa hCaptcha para continuar.") this.error.set(null);
  }

  async loadCaptchaConfiguration(): Promise<void> {
    const request = this.configRequests.begin(null);
    this.captchaConfigBusy.set(true);
    this.captchaConfigError.set(null);
    try {
      const config = await this.api.get<PublicAuthConfig>("/api/v1/config", undefined, decodePublicConfig, { signal: request.signal });
      if (!this.configRequests.isCurrent(request, null)) return;
      const siteKey = config.hcaptcha?.enabled ? config.hcaptcha.siteKey : null;
      if (!siteKey || !/^[A-Za-z0-9_-]{20,200}$/.test(siteKey)) throw new Error("hCaptcha unavailable");
      this.hcaptchaSiteKey.set(siteKey);
    } catch {
      if (this.configRequests.isCurrent(request, null)) {
        this.hcaptchaSiteKey.set("");
        this.captchaConfigError.set($localize`:@@ui.f818e9091c2c63:No se pudo cargar hCaptcha.`);
      }
    } finally {
      if (this.configRequests.isCurrent(request, null)) this.captchaConfigBusy.set(false);
    }
  }
}
