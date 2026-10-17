import { LocaleLinkDirective } from "../core/localisation/locale-link.directive";
import { UI_TEXT } from "../core/localisation/template-messages";
import { DOCUMENT } from "@angular/common";
import { Component, DestroyRef, ElementRef, Injector, afterNextRender, inject, signal, ChangeDetectionStrategy, ViewChild } from "@angular/core";
import { RouterLink } from "@angular/router";

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
import { decodePublicActionAcknowledgement } from "../core/services/public-action-response-decoders";

interface PublicConfigResponse {
  hcaptcha?: {
    enabled?: boolean;
    siteKey?: string | null;
  };
}

// Stable submission values: translate labels, never the API category.
const REASONS = [
  "Phishing o suplantación de identidad",
  "Fraude, estafa o cobro engañoso",
  "Malware o software malicioso",
  "Spam o comunicaciones no solicitadas",
  "Amenazas o contenido ilegal",
  "Vulneración de privacidad o derechos",
  "Otro"
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
  imports: [LocaleLinkDirective,
    RouterLink,
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
  readonly uiText = UI_TEXT;
  @ViewChild("reportCaptcha") private captchaWidget?: HCaptchaWidgetComponent;

  private fb = inject(FormBuilder);
  private api = inject(ApiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly configRequests = new LatestRequest(inject(DestroyRef));
  private readonly submitRequests = new LatestRequest(inject(DestroyRef));

  readonly reasons = REASONS;
  readonly reasonLabels: Record<(typeof REASONS)[number], string> = {
    "Phishing o suplantación de identidad": $localize`:@@ui.f47ef94315ae01:Phishing o suplantación de identidad`,
    "Fraude, estafa o cobro engañoso": $localize`:@@ui.df8ed68c8eed9d:Fraude, estafa o cobro engañoso`,
    "Malware o software malicioso": $localize`:@@ui.9c50a4c1cce536:Malware o software malicioso`,
    "Spam o comunicaciones no solicitadas": $localize`:@@ui.a43078886681de:Spam o comunicaciones no solicitadas`,
    "Amenazas o contenido ilegal": $localize`:@@ui.537c8cd7d7500c:Amenazas o contenido ilegal`,
    "Vulneración de privacidad o derechos": $localize`:@@ui.f7874e3c5424b4:Vulneración de privacidad o derechos`,
    "Otro": $localize`:@@ui.0d5a52a92cb9f4:Otro`,
  };
  // Guidance is presentation-only: submitted categories and API validation
  // remain unchanged. Never ask the visitor to visit or investigate a target.
  readonly reasonHints: Record<(typeof REASONS)[number], string> = {
    "Phishing o suplantación de identidad": $localize`:@@ui.04a91becf7cd5b:Páginas que aparentan ser una persona o entidad para pedir contraseñas, códigos o datos privados.`,
    "Fraude, estafa o cobro engañoso": $localize`:@@ui.3d6af076c3d1ca:Ofertas, pagos o solicitudes de dinero que inducen a engaño.`,
    "Malware o software malicioso": $localize`:@@ui.4f0675238bfb01:Enlaces que distribuyen archivos o programas potencialmente dañinos. No descargues nada para comprobarlo.`,
    "Spam o comunicaciones no solicitadas": $localize`:@@ui.1a2e7575cd48ed:Enlaces difundidos de forma abusiva o en mensajes no solicitados.`,
    "Amenazas o contenido ilegal": $localize`:@@ui.c42c2f4e69efb2:Contenido que amenaza a personas o cuya difusión podría ser ilegal. Ante peligro inmediato, contacta con las autoridades.`,
    "Vulneración de privacidad o derechos": $localize`:@@ui.e00d2e463c49f3:Difusión de datos personales o contenido que pueda vulnerar derechos de terceros.`,
    "Otro": $localize`:@@ui.9f0c0ed05df1bb:Si ninguna categoría encaja, puedes explicar el problema en el contexto opcional, sin incluir datos sensibles.`,
  };
  readonly reportTypes = [
    { icon: "phishing", title: $localize`:@@ui.e43f4493624fda:Phishing y fraude`, text: $localize`:@@ui.357f661d2e8a0f:Suplantación, robo de credenciales, pagos engañosos o estafas.` },
    { icon: "bug_report", title: $localize`:@@ui.518a3b2192d9d7:Malware`, text: $localize`:@@ui.f54bb81a5c4ebe:Descargas dañinas, ransomware, scripts o software malicioso.` },
    { icon: "campaign", title: $localize`:@@ui.0112ff1baa7651:Spam y abuso`, text: $localize`:@@ui.9bc7c7bff2afc6:Mensajes no solicitados, cloaking o evasión reiterada de bloqueos.` },
    { icon: "gavel", title: $localize`:@@ui.d71911c8d431b2:Contenido ilegal`, text: $localize`:@@ui.598a3fc1bf660d:Amenazas, explotación o vulneración de derechos de terceros.` },
  ];
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly done = signal(false);
  readonly receivedReference = signal<string | null>(null);
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

  get selectedReasonHint(): string {
    const hint = this.reasonHints[this.form.controls.reason.value as (typeof REASONS)[number]];
    return typeof hint === "string" ? hint : $localize`:@@ui.e108626690aa24:Si no estás seguro, elige la opción más próxima o «Otro».`;
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
      const response = await this.api.get<PublicConfigResponse>("/api/v1/config", undefined, decodePublicConfig, { signal: request.signal });
      if (!this.configRequests.isCurrent(request, null)) return;
      const siteKey = response.hcaptcha?.enabled && typeof response.hcaptcha.siteKey === "string"
        ? response.hcaptcha.siteKey.trim()
        : "";
      if (!/^[A-Za-z0-9_-]{20,200}$/.test(siteKey)) throw new Error("missing hCaptcha public configuration");
      this.hcaptchaSiteKey.set(siteKey);
    } catch {
      if (this.configRequests.isCurrent(request, null)) {
        this.hcaptchaSiteKey.set("");
        this.captchaConfigError.set($localize`:@@ui.909e47ff30c9a7:No se pudo cargar la comprobación antiabuso.`);
      }
    } finally {
      if (this.configRequests.isCurrent(request, null)) this.captchaConfigBusy.set(false);
    }
  }

  startAnotherReport(): void {
    if (this.busy() || !this.done()) return;
    this.done.set(false);
    this.receivedReference.set(null);
    this.error.set(null);
    this.focusAfterRender('[formControlName="link"]');
  }

  private focusAfterRender(selector: string): void {
    afterNextRender(() => {
      if (this.destroyRef.destroyed) return;
      const active = this.document.activeElement;
      // Do not steal focus from navigation chosen while the response arrived.
      if (active !== this.document.body && active && !this.host.nativeElement.querySelector(".report-card")?.contains(active)) return;
      this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
    }, { injector: this.injector });
  }

  async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Bring the first invalid control into view, including the Material
      // select. Keep errors beside their fields instead of leaving a dead CTA.
      this.host.nativeElement.querySelector<HTMLElement>("[formControlName].ng-invalid")?.focus();
      return;
    }
    if (!this.captchaToken()) {
      this.error.set($localize`:@@ui.3b2bd85c3cd18e:Completa la comprobación antiabuso antes de enviar la denuncia.`);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.done.set(false);

    const v = this.form.getRawValue();
    this.form.disable({ emitEvent: false });
    const context = normalizeReportReference(v.link);
    const request = this.submitRequests.begin(context);
    try {
      const response = await this.api.post<unknown>("/api/v1/report", {
        reportedUrl: context,
        reason: v.reason,
        details: v.details?.trim() || undefined,
        email: v.email?.trim() || "",
        captchaToken: this.captchaToken(),
      });
      if (!this.submitRequests.isCurrent(request, context)) return;
      try {
        decodePublicActionAcknowledgement(response);
      } catch {
        throw new ApiRequestError($localize`:@@ui.9b68f29feea40f:No se ha podido confirmar el registro de la denuncia. Los datos se han conservado para que puedas revisarlos.`, 502);
      }
      this.receivedReference.set(context);
      this.done.set(true);
      this.form.reset();
      this.focusAfterRender(".report-receipt");
    } catch (err) {
      if (this.submitRequests.isCurrent(request, context)) {
        this.error.set(err instanceof ApiRequestError ? err.message : $localize`:@@ui.942220145a1df8:No se pudo enviar la denuncia`);
      }
    } finally {
      // hCaptcha tokens are single-use even when the API rejects another
      // field, so never retain a token after an attempted submission.
      if (this.submitRequests.isCurrent(request, context)) {
        this.form.enable({ emitEvent: false });
        this.captchaToken.set("");
        this.captchaWidget?.reset();
        this.busy.set(false);
      }
    }
  }
}
