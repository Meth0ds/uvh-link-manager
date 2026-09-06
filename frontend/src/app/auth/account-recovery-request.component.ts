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
      <main class="card recovery-card" aria-labelledby="recovery-title">
        <span class="step-kicker">Recuperación reforzada</span>
        <h2 id="recovery-title">¿Has perdido todos tus factores?</h2>
        <p class="sub">Utiliza este procedimiento sólo si no puedes acceder a tu contraseña, autenticador ni códigos de recuperación.</p>

        @if (!sent()) {
          <section class="process" aria-label="Proceso de recuperación">
            <div><span>1</span><p><b>Confirma tu email</b><small>El enlace no inicia sesión ni desactiva MFA.</small></p></div>
            <div><span>2</span><p><b>Verificación por soporte</b><small>La identidad se contrasta fuera de esta página.</small></p></div>
            <div><span>3</span><p><b>Doble aprobación</b><small>Dos administradores distintos con MFA deben aprobar.</small></p></div>
          </section>

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
      </main>
    </app-auth-shell>
  `,
  styles: [`
    .recovery-card { max-width: 520px; }
    .step-kicker { display: block; margin-bottom: 8px; color: var(--uvh-electric); font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .process { display: grid; gap: 8px; margin: 0 0 20px; }
    .process > div { display: grid; grid-template-columns: 30px 1fr; align-items: start; gap: 10px; padding: 11px 12px; border: 1px solid var(--uvh-border); border-radius: 11px; background: var(--uvh-surface-subtle); }
    .process > div > span { display: grid; width: 25px; height: 25px; place-items: center; border-radius: 8px; background: color-mix(in srgb, var(--uvh-electric) 12%, transparent); color: var(--uvh-electric); font-size: 11px; font-weight: 850; }
    .process p { display: flex; flex-direction: column; gap: 2px; margin: 0; }
    .process b { color: var(--uvh-ink); font-size: 12px; }
    .process small { color: var(--uvh-muted); font-size: 10.5px; line-height: 1.45; }
    .result { padding: 18px 10px 8px; text-align: center; }
    .result h3 { margin: 4px 0 7px; color: var(--uvh-ink); font-size: 19px; }
    .result p { margin: 0; color: var(--uvh-muted); font-size: 13px; line-height: 1.6; }
  `],
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
      const config = await this.api.get<PublicAuthConfig>("/api/v1/config", undefined, decodePublicConfig);
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
