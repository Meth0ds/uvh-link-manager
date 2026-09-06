import { Component, DestroyRef, inject, signal, ChangeDetectionStrategy, ViewChild } from "@angular/core";

import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { LegalShellComponent } from "./legal-shell.component";
import { ApiService, ApiRequestError } from "../core/services/api.service";
import { HCaptchaWidgetComponent } from "../auth/hcaptcha-widget.component";
import { LatestRequest } from "../core/services/latest-request";
import { decodePublicConfig } from "../core/services/public-response-decoders";

interface PublicConfigResponse {
  hcaptcha?: {
    enabled?: boolean;
    siteKey?: string | null;
  };
}

const REASONS = [
  "Phishing o suplantación de identidad",
  "Fraude, estafa o cobro engañoso",
  "Malware o software malicioso",
  "Spam o comunicaciones no solicitadas",
  "Amenazas o contenido ilegal",
  "Vulneración de privacidad o derechos",
  "Otro",
] as const;

/** Normalize without resolving or visiting the reported destination. */
export function normalizeReportReference(input: string): string {
  const value = input.trim();
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) return value.toLowerCase();
  if (!/^https?:\/\//i.test(value) && /^[^\s/]+\/.+/.test(value)) return `https://${value}`;
  return value;
}

export function reportReferenceValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = normalizeReportReference(control.value ?? "");
  if (!value) return null;
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) return null;

  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || !url.hostname) return { reportReference: true };
    const segments = url.pathname.split("/").filter(Boolean);
    const alias = segments.length === 2 && segments[0].toLowerCase() === "r" ? segments[1] : segments.length === 1 ? segments[0] : "";
    return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(alias) ? null : { reportReference: true };
  } catch {
    return { reportReference: true };
  }
}

@Component({
  selector: "app-report",
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatProgressBarModule,
    LegalShellComponent,
    HCaptchaWidgetComponent,
],
  templateUrl: "./report.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./report.component.scss",
})
export class ReportComponent {
  @ViewChild("reportCaptcha") private captchaWidget?: HCaptchaWidgetComponent;

  private fb = inject(FormBuilder);
  private api = inject(ApiService);
  private readonly configRequests = new LatestRequest(inject(DestroyRef));
  private readonly submitRequests = new LatestRequest(inject(DestroyRef));

  readonly reasons = REASONS;
  readonly reportTypes = [
    { icon: "phishing", title: "Phishing y fraude", text: "Suplantación, robo de credenciales, pagos engañosos o estafas." },
    { icon: "bug_report", title: "Malware", text: "Descargas dañinas, ransomware, scripts o software malicioso." },
    { icon: "campaign", title: "Spam y abuso", text: "Mensajes no solicitados, cloaking o evasión reiterada de bloqueos." },
    { icon: "gavel", title: "Contenido ilegal", text: "Amenazas, explotación o vulneración de derechos de terceros." },
  ];
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly done = signal(false);
  readonly captchaConfigBusy = signal(true);
  readonly captchaConfigError = signal<string | null>(null);
  readonly hcaptchaSiteKey = signal("");
  readonly captchaToken = signal("");

  form = this.fb.nonNullable.group({
    link: ["", [Validators.required, Validators.maxLength(2048), reportReferenceValidator]],
    reason: ["", [Validators.required]],
    details: ["", [Validators.maxLength(2000)]],
    email: ["", [Validators.email, Validators.maxLength(254)]],
  });

  constructor() {
    void this.loadCaptchaConfiguration();
  }

  onCaptchaToken(token: string): void {
    this.captchaToken.set(token);
    if (token) this.error.set(null);
  }

  async loadCaptchaConfiguration(): Promise<void> {
    if (this.captchaConfigBusy() && this.hcaptchaSiteKey()) return;
    const request = this.configRequests.begin(null);
    this.captchaConfigBusy.set(true);
    this.captchaConfigError.set(null);
    this.captchaToken.set("");
    try {
      const response = await this.api.get<PublicConfigResponse>("/api/v1/config", undefined, decodePublicConfig);
      if (!this.configRequests.isCurrent(request, null)) return;
      const siteKey = response.hcaptcha?.enabled && typeof response.hcaptcha.siteKey === "string"
        ? response.hcaptcha.siteKey.trim()
        : "";
      if (!/^[A-Za-z0-9_-]{20,200}$/.test(siteKey)) throw new Error("missing hCaptcha public configuration");
      this.hcaptchaSiteKey.set(siteKey);
    } catch {
      if (this.configRequests.isCurrent(request, null)) {
        this.hcaptchaSiteKey.set("");
        this.captchaConfigError.set("No se pudo cargar la comprobación antiabuso.");
      }
    } finally {
      if (this.configRequests.isCurrent(request, null)) this.captchaConfigBusy.set(false);
    }
  }

  async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (!this.captchaToken()) {
      this.error.set("Completa la comprobación antiabuso antes de enviar la denuncia.");
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.done.set(false);

    const v = this.form.getRawValue();
    const context = normalizeReportReference(v.link);
    const request = this.submitRequests.begin(context);
    try {
      await this.api.post("/api/v1/report", {
        reportedUrl: context,
        reason: v.reason,
        details: v.details?.trim() || undefined,
        email: v.email?.trim() || "",
        captchaToken: this.captchaToken(),
      });
      if (!this.submitRequests.isCurrent(request, context)) return;
      this.done.set(true);
      this.form.reset();
    } catch (err) {
      if (this.submitRequests.isCurrent(request, context)) {
        this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo enviar la denuncia");
      }
    } finally {
      // hCaptcha tokens are single-use even when the API rejects another
      // field, so never retain a token after an attempted submission.
      if (this.submitRequests.isCurrent(request, context)) {
        this.captchaToken.set("");
        this.captchaWidget?.reset();
        this.busy.set(false);
      }
    }
  }
}
