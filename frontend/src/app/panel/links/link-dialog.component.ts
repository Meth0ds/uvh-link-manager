import { Component, DestroyRef, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatIconModule } from "@angular/material/icon";
import { MatTabsModule } from "@angular/material/tabs";
import { MatChipsModule } from "@angular/material/chips";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatTooltipModule } from "@angular/material/tooltip";

import { ApiService, ApiRequestError } from "../../core/services/api.service";
import type { DomainDto, LinkDto, RedirectRule } from "../../core/models";
import { decodeDomainsResponse } from "../../core/services/domain-response-decoders";
import { decodeAliasAvailability, decodeLinkResponse, decodeRulesResponse } from "../../core/services/link-response-decoders";
import { LatestRequest } from "../../core/services/latest-request";

export interface LinkDialogData {
  mode: "create" | "edit";
  link?: LinkDto;
  initialDestination?: string;
}
type RuleGroup = FormGroup<{
  priority: FormControl<number>;
  country: FormControl<string>;
  language: FormControl<string>;
  device: FormControl<string>;
  os: FormControl<string>;
  timeFrom: FormControl<string>;
  timeTo: FormControl<string>;
  referrer: FormControl<string>;
  campaign: FormControl<string>;
  destination: FormControl<string>;
}>;

function httpUrlValidator(control: AbstractControl): ValidationErrors | null {
  const raw = String(control.value ?? "").trim();
  if (!raw) return null;
  if (raw.length > 2048) return { url: true };
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? null : { url: true };
  } catch {
    return { url: true };
  }
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function noControlCharacters(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? "");
  return CONTROL_CHARACTERS.test(value) ? { controlCharacters: true } : null;
}

function localDateTimeValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? "");
  if (!value) return null;
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return { localDateTime: true };

  const [, year, month, day, hour, minute] = match.map(Number);
  const parsed = new Date(year, month - 1, day, hour, minute);
  return parsed.getFullYear() === year
    && parsed.getMonth() === month - 1
    && parsed.getDate() === day
    && parsed.getHours() === hour
    && parsed.getMinutes() === minute
    ? null
    : { localDateTime: true };
}

function lifecycleOrderValidator(control: AbstractControl): ValidationErrors | null {
  const scheduled = control.get("scheduledAt");
  const expires = control.get("expiresAt");
  if (!scheduled?.value || !expires?.value || scheduled.invalid || expires.invalid) return null;
  return new Date(scheduled.value).getTime() < new Date(expires.value).getTime()
    ? null
    : { lifecycleOrder: true };
}

function integerValidator(control: AbstractControl): ValidationErrors | null {
  return control.value == null || Number.isInteger(control.value) ? null : { integer: true };
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

@Component({
  selector: "app-link-dialog",
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatIconModule,
    MatTabsModule,
    MatChipsModule,
    MatProgressBarModule,
    MatTooltipModule
],
  templateUrl: "./link-dialog.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./link-dialog.component.scss",
})
export class LinkDialogComponent {
  private fb = inject(FormBuilder);
  private api = inject(ApiService);
  private dialogRef = inject(MatDialogRef<LinkDialogComponent>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly domainRequests = new LatestRequest(this.destroyRef);
  private readonly ruleRequests = new LatestRequest(this.destroyRef);
  readonly data = inject<LinkDialogData>(MAT_DIALOG_DATA);

  readonly isEdit = this.data.mode === "edit";
  readonly busy = signal(false);
  readonly loading = signal(this.isEdit);
  readonly editDetailsLoaded = signal(!this.isEdit);
  readonly error = signal<string | null>(null);
  readonly domains = signal<DomainDto[]>([]);
  readonly tags = signal<string[]>([]);
  readonly aliasStatus = signal<"idle" | "checking" | "available" | "taken" | "invalid" | "reserved">("idle");
  readonly aliasStatusText = signal("");
  private aliasRequest = 0;
  private saveRequest = 0;

  form = this.fb.nonNullable.group({
    destination: ["", [Validators.required, Validators.maxLength(2048), httpUrlValidator]],
    alias: ["", [Validators.maxLength(64), Validators.pattern(/^[a-z0-9][a-z0-9_-]{0,63}$/i)]],
    domainId: [null as number | null],
    fallbackDestination: ["", [Validators.maxLength(2048), httpUrlValidator]],
    password: ["", [Validators.maxLength(72)]],
    clearPassword: [false],
    maxClicks: [null as number | null, [Validators.min(1), Validators.max(10_000_000)]],
    singleUse: [false],
    scheduledAt: ["", [localDateTimeValidator]],
    expiresAt: ["", [localDateTimeValidator]],
    notes: ["", [Validators.maxLength(1000), noControlCharacters]],
    utm: this.fb.nonNullable.group({
      source: ["", [Validators.maxLength(100), noControlCharacters]],
      medium: ["", [Validators.maxLength(100), noControlCharacters]],
      campaign: ["", [Validators.maxLength(100), noControlCharacters]],
      term: ["", [Validators.maxLength(100), noControlCharacters]],
      content: ["", [Validators.maxLength(100), noControlCharacters]],
    }),
  }, { validators: lifecycleOrderValidator });

  rules = this.fb.array<RuleGroup>([]);

  constructor() {
    this.form.controls.alias.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.checkAlias());
    this.form.controls.domainId.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.checkAlias());
    this.destroyRef.onDestroy(() => {
      // Invalidate every completion already queued for this dialog. This is
      // still necessary even if a future transport layer adds cancellation.
      ++this.aliasRequest;
      ++this.saveRequest;
    });
    void this.load();
  }

  private async load(): Promise<void> {
    const requests: Promise<void>[] = [this.loadDomains()];
    if (this.isEdit && this.data.link) {
      this.patchFromLink(this.data.link);
      requests.push(this.loadEditRules(this.data.link.id));
    } else {
      this.form.controls.destination.setValue(this.data.initialDestination ?? "");
      this.addRule();
    }

    try {
      await Promise.all(requests);
    } finally {
      if (!this.destroyRef.destroyed) this.loading.set(false);
    }
  }

  private async loadDomains(): Promise<void> {
    const request = this.domainRequests.begin("link-dialog-domains");
    try {
      const { domains } = await this.api.get<{ domains: DomainDto[] }>(
        "/api/v1/domains",
        undefined,
        decodeDomainsResponse,
        { signal: request.signal },
      );
      if (!this.domainRequests.isCurrent(request, "link-dialog-domains")) return;
      this.domains.set(domains.filter((d) => d.state === "active" && d.edgeEligible && d.tlsReadyAt !== null));
    } catch {
      if (this.domainRequests.isCurrent(request, "link-dialog-domains")) this.domains.set([]);
    }
  }

  private async loadEditRules(linkId: number): Promise<void> {
    const request = this.ruleRequests.begin(linkId);
    try {
      const { rules } = await this.api.get<{ rules: RedirectRule[] }>(
        `/api/v1/links/${linkId}`,
        undefined,
        decodeRulesResponse,
        { signal: request.signal },
      );
      if (!this.ruleRequests.isCurrent(request, linkId)) return;
      this.rules.clear();
      rules.forEach((rule) => this.addRule(rule));
      this.editDetailsLoaded.set(true);
    } catch (err) {
      if (this.ruleRequests.isCurrent(request, linkId)) {
        this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar las reglas del enlace");
      }
    }
  }

  private patchFromLink(link: LinkDto): void {
    this.form.patchValue({
      destination: link.destination,
      alias: link.alias,
      domainId: link.domainId,
      fallbackDestination: link.fallbackDestination ?? "",
      maxClicks: link.maxClicks,
      singleUse: link.singleUse,
      scheduledAt: toLocalInput(link.scheduledAt),
      expiresAt: toLocalInput(link.expiresAt),
      notes: link.notes ?? "",
      utm: {
        source: link.utm.source ?? "",
        medium: link.utm.medium ?? "",
        campaign: link.utm.campaign ?? "",
        term: link.utm.term ?? "",
        content: link.utm.content ?? "",
      },
    });
    this.tags.set(link.tags);
  }

  private async checkAlias(): Promise<void> {
    const requestId = ++this.aliasRequest;
    const alias = this.form.value.alias?.trim() ?? "";
    const sameAsCurrent = this.isEdit && this.data.link?.alias === alias && this.data.link.domainId === this.form.value.domainId;
    if (!alias) {
      this.aliasStatus.set("idle");
      this.aliasStatusText.set("");
      return;
    }
    if (this.form.controls.alias.invalid) {
      this.aliasStatus.set("invalid");
      this.aliasStatusText.set("Alias inválido");
      return;
    }
    if (sameAsCurrent) {
      this.aliasStatus.set("available");
      this.aliasStatusText.set("Alias actual");
      return;
    }

    this.aliasStatus.set("checking");
    // Debounce keystrokes locally so the availability endpoint cannot be used
    // as an accidental request amplifier while typing.
    await new Promise((resolve) => setTimeout(resolve, 220));
    if (this.destroyRef.destroyed || requestId !== this.aliasRequest) return;
    try {
      const { available, reason } = await this.api.post<{ available: boolean; reason?: string }>("/api/v1/links/check-alias", {
        alias,
        domainId: this.form.value.domainId,
      }, decodeAliasAvailability);
      if (this.destroyRef.destroyed || requestId !== this.aliasRequest) return;
      if (available) {
        this.aliasStatus.set("available");
        this.aliasStatusText.set("Alias disponible");
      } else {
        this.aliasStatus.set(reason === "reserved" ? "reserved" : reason === "invalid" ? "invalid" : "taken");
        this.aliasStatusText.set(
          reason === "reserved" ? "Alias reservado" : reason === "invalid" ? "Alias inválido" : "Este alias ya está en uso",
        );
      }
    } catch {
      if (this.destroyRef.destroyed || requestId !== this.aliasRequest) return;
      this.aliasStatus.set("idle");
      this.aliasStatusText.set("");
    }
  }

  // ---------- Tags ----------
  addTag(event: { value: string; chipInput: { clear: () => void } }): void {
    const value = (event.value ?? "").trim().slice(0, 40);
    // PostgreSQL resolves tag identity case-insensitively in LinkService, so
    // mirror that rule before presenting what would be the same server tag.
    const duplicate = this.tags().some((tag) => tag.toLowerCase() === value.toLowerCase());
    if (value && !CONTROL_CHARACTERS.test(value) && !duplicate && this.tags().length < 20) {
      this.tags.update((t) => [...t, value]);
    }
    event.chipInput.clear();
  }

  removeTag(tag: string): void {
    this.tags.update((t) => t.filter((x) => x !== tag));
  }

  // ---------- Rules ----------
  get ruleForms(): RuleGroup[] {
    return this.rules.controls;
  }

  /** Blank destinations delete rows, so only rules that will be sent can block saving. */
  get hasInvalidRules(): boolean {
    return this.rules.controls.some((rule) => Boolean(rule.controls.destination.value.trim()) && rule.invalid);
  }

  addRule(initial: Partial<RedirectRule> = {}): void {
    if (this.rules.length >= 20) return;
    const raw = initial as RedirectRule & { time_from?: string | null; time_to?: string | null };
    this.rules.push(
      this.fb.nonNullable.group({
        priority: [initial.priority ?? this.rules.length, [Validators.min(0), Validators.max(1000), integerValidator]],
        country: [initial.country ?? "", [Validators.pattern(/^[a-zA-Z]{2}$/)]],
        language: [initial.language ?? "", [Validators.maxLength(8), Validators.pattern(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,4})?$/)]],
        device: [initial.device ?? ""],
        os: [initial.os ?? "", [Validators.maxLength(40), noControlCharacters]],
        timeFrom: [initial.timeFrom ?? raw.time_from ?? "", [Validators.pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)]],
        timeTo: [initial.timeTo ?? raw.time_to ?? "", [Validators.pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)]],
        referrer: [initial.referrer ?? "", [Validators.maxLength(200), noControlCharacters]],
        campaign: [initial.campaign ?? "", [Validators.maxLength(100), noControlCharacters]],
        // Empty means delete/omit the row. Non-empty destinations must still
        // satisfy exactly the same URL contract as the primary destination.
        destination: [initial.destination ?? "", [Validators.maxLength(2048), httpUrlValidator]],
      }),
    );
  }

  removeRule(index: number): void {
    this.rules.removeAt(index);
  }

  private rulesPayload(): RedirectRule[] {
    const out: RedirectRule[] = [];
    this.rules.controls.forEach((g, index) => {
      const v = g.value;
      const destination = v.destination?.trim();
      if (!destination) return;
      out.push({
        priority: v.priority ?? index,
        country: v.country?.trim() || null,
        language: v.language?.trim() || null,
        device: (v.device as "desktop" | "mobile" | "tablet" | null) || null,
        os: v.os?.trim() || null,
        timeFrom: v.timeFrom || null,
        timeTo: v.timeTo || null,
        referrer: v.referrer?.trim() || null,
        campaign: v.campaign?.trim() || null,
        destination,
      });
    });
    return out;
  }

  async save(): Promise<void> {
    const aliasUnavailable = ["checking", "taken", "invalid", "reserved"].includes(this.aliasStatus());
    if (this.destroyRef.destroyed || this.form.invalid || this.hasInvalidRules || aliasUnavailable
      || this.busy() || (this.isEdit && !this.editDetailsLoaded())) return;
    const requestId = ++this.saveRequest;
    this.busy.set(true);
    this.error.set(null);
    const v = this.form.value;
    const passwordValue = v.password ?? "";
    const password = this.isEdit
      ? (v.clearPassword ? null : passwordValue !== "" ? passwordValue : undefined)
      : (passwordValue !== "" ? passwordValue : null);
    const payload = {
      // The backend rejects stale writes instead of overwriting a newer edit
      // from another browser. New links intentionally have no version.
      ...(this.isEdit ? { version: this.data.link!.version } : {}),
      destination: v.destination?.trim(),
      alias: v.alias?.trim() || null,
      domainId: v.domainId,
      fallbackDestination: v.fallbackDestination?.trim() || null,
      password,
      maxClicks: v.maxClicks,
      singleUse: v.singleUse,
      scheduledAt: toIso(v.scheduledAt),
      expiresAt: toIso(v.expiresAt),
      notes: v.notes?.trim() || null,
      utm: {
        source: v.utm?.source?.trim() || null,
        medium: v.utm?.medium?.trim() || null,
        campaign: v.utm?.campaign?.trim() || null,
        term: v.utm?.term?.trim() || null,
        content: v.utm?.content?.trim() || null,
      },
      tags: this.tags(),
      rules: this.rulesPayload(),
    };
    try {
      let link: LinkDto;
      if (this.isEdit) {
        const expectedLinkId = this.data.link!.id;
        const res = await this.api.patch<{ link: LinkDto }>(
          `/api/v1/links/${expectedLinkId}`,
          payload,
          (value) => decodeLinkResponse(value, expectedLinkId),
        );
        link = res.link;
      } else {
        const res = await this.api.post<{ link: LinkDto }>("/api/v1/links", payload, decodeLinkResponse);
        link = res.link;
      }
      if (this.destroyRef.destroyed || requestId !== this.saveRequest) return;
      this.dialogRef.close(link);
    } catch (err) {
      if (!this.destroyRef.destroyed && requestId === this.saveRequest) {
        this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo guardar el enlace");
      }
    } finally {
      if (!this.destroyRef.destroyed && requestId === this.saveRequest) this.busy.set(false);
    }
  }
}
