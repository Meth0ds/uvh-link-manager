import { Component, DestroyRef, ViewChild, computed, inject, signal, ChangeDetectionStrategy } from "@angular/core";

import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { AuthShellComponent } from "./auth-shell.component";
import { ApiService, ApiRequestError } from "../core/services/api.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { PendingInvitationService } from "../core/services/pending-invitation.service";
import { HCaptchaWidgetComponent } from "./hcaptcha-widget.component";
import { LatestRequest } from "../core/services/latest-request";
import { decodePublicConfig } from "../core/services/public-response-decoders";

interface PublicAuthConfig {
  hcaptcha?: { enabled?: boolean; siteKey?: string | null };
}

@Component({
  selector: "app-forgot-password",
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, AuthShellComponent, HCaptchaWidgetComponent],
  templateUrl: "./forgot-password.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./auth-card.scss",
})
export class ForgotPasswordComponent {
  @ViewChild("forgotCaptcha") private captchaWidget?: HCaptchaWidgetComponent;

  private fb = inject(FormBuilder);
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private intents = inject(PendingLinkIntentService);
  private invitations = inject(PendingInvitationService);
  private readonly configRequests = new LatestRequest(inject(DestroyRef));
  private readonly submitRequests = new LatestRequest(inject(DestroyRef));

  readonly busy = signal(false);
  readonly sent = signal(false);
  readonly error = signal<string | null>(null);
  readonly captchaConfigBusy = signal(true);
  readonly captchaConfigError = signal<string | null>(null);
  readonly hcaptchaSiteKey = signal("");
  readonly captchaToken = signal("");
  readonly pendingLink = this.intents.pending;
  readonly pendingInvitation = this.invitations.hasPending();
  readonly loginQueryParams = computed(() => {
    const returnTo = this.route.snapshot.queryParamMap.get("returnTo");
    if (returnTo) return { returnTo };
    if (this.pendingLink()) return { returnTo: "/app/links" };
    return this.pendingInvitation ? { returnTo: "/invitations/accept" } : {};
  });

  form = this.fb.nonNullable.group({
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
    const email = this.form.controls.email.value.toLowerCase();
    const request = this.submitRequests.begin(email);
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.post("/api/v1/auth/forgot-password", {
        email,
        captchaToken: this.captchaToken(),
      });
      if (!this.submitRequests.isCurrent(request, email)) return;
      this.sent.set(true);
    } catch (err) {
      if (!this.submitRequests.isCurrent(request, email)) return;
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo enviar el correo");
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

  async retryCaptchaConfiguration(): Promise<void> {
    await this.loadCaptchaConfiguration();
  }

  private async loadCaptchaConfiguration(): Promise<void> {
    const request = this.configRequests.begin(null);
    this.captchaConfigBusy.set(true);
    this.captchaConfigError.set(null);
    try {
      const config = await this.api.get<PublicAuthConfig>("/api/v1/config", undefined, decodePublicConfig);
      if (!this.configRequests.isCurrent(request, null)) return;
      const siteKey = config.hcaptcha?.enabled ? config.hcaptcha.siteKey : null;
      if (!siteKey || !/^[A-Za-z0-9_-]{20,200}$/.test(siteKey)) throw new Error("hCaptcha no está configurado");
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
