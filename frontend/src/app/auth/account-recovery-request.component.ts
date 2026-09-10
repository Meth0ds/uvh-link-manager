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
        <span class="step-kicker">Recuperación reforzada</span>
        <h2 id="recovery-title">¿Has perdido todos tus factores?</h2>
        <p class="sub">Utiliza este procedimiento sólo si no puedes acceder a tu contraseña, autenticador ni códigos de recuperación.</p>

        @if (!sent()) {
          <ol class="process" aria-label="Proceso de recuperación">
            <li><span>01</span><p><b>Confirma tu email</b><small>El enlace no inicia sesión ni desactiva MFA.</small></p></li>
            <li><span>02</span><p><b>Verificación por soporte</b><small>La identidad se contrasta fuera de esta página.</small></p></li>
            <li><span>03</span><p><b>Doble aprobación</b><small>Dos administradores distintos con MFA deben aprobar.</small></p></li>
          </ol>

          <form class="form" [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field appearance="outline">
              <mat-label>Email de la cuenta</mat-label>
              <mat-icon matPrefix aria-hidden="true">mail_outline</mat-icon>
              <input matInput type="email" formControlName="email" autocomplete="email" maxlength="254" />
            </mat-form-field>

            @if (captchaConfigBusy()) {
              <div class="alert info" role="status">Cargando hCaptcha…</div>
            } @else if (hcaptchaSiteKey(); as siteKey) {
              <app-hcaptcha-widget #recoveryCaptcha [siteKey]="siteKey" (tokenChange)="onCaptchaToken($event)" />
            } @else {
              <div class="alert error" role="alert">{{ captchaConfigError() }} <button mat-button type="button" (click)="loadCaptchaConfiguration()">Reintentar</button></div>
            }
            @if (error(); as message) { <div class="alert error" role="alert">{{ message }}</div> }
            <button mat-flat-button color="primary" class="submit" type="submit" [disabled]="form.invalid || busy() || !captchaToken()">
              {{ busy() ? 'Abriendo solicitud…' : 'Iniciar recuperación reforzada' }}
            </button>
          </form>
        } @else {
          <section class="result" role="status">
            <mat-icon class="icon ok" aria-hidden="true">mark_email_read</mat-icon>
            <h3>Revisa tu correo</h3>
            <p>Si la cuenta cumple los requisitos, recibirás un enlace válido durante una hora. La respuesta es deliberadamente idéntica para todas las direcciones.</p>
          </section>
        }

        <a class="back" routerLink="/auth">← Volver al acceso</a>
      </section>
    </app-auth-shell>
  `,
  styleUrl: "./auth-card.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountRecoveryRequestComponent {
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
      if (!this.captchaToken()) this.error.set("Completa hCaptcha para continuar.");
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
      });
      if (!this.submitRequests.isCurrent(request, email)) return;
      this.sent.set(true);
    } catch (error) {
      if (!this.submitRequests.isCurrent(request, email)) return;
      this.error.set(error instanceof ApiRequestError ? error.message : "No se pudo iniciar la recuperación");
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
        this.captchaConfigError.set("No se pudo cargar hCaptcha.");
      }
    } finally {
      if (this.configRequests.isCurrent(request, null)) this.captchaConfigBusy.set(false);
    }
  }
}
