import { Component, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import {
  FormArray,
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

export interface LinkDialogData {
  mode: "create" | "edit";
  link?: LinkDto;
  initialDestination?: string;
}
export interface LinkDialogResult {
  link: LinkDto;
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

  form = this.fb.nonNullable.group({
    destination: ["", [Validators.required, Validators.maxLength(2048), httpUrlValidator]],
    alias: ["", [Validators.maxLength(64)]],
    domainId: [null as number | null],
    fallbackDestination: ["", [Validators.maxLength(2048), httpUrlValidator]],
    password: ["", [Validators.maxLength(256)]],
    clearPassword: [false],
    maxClicks: [null as number | null, [Validators.min(1), Validators.max(10_000_000)]],
    singleUse: [false],
    scheduledAt: [""],
    expiresAt: [""],
    notes: ["", [Validators.maxLength(1000)]],
    utm: this.fb.nonNullable.group({
      source: [""],
      medium: [""],
      campaign: [""],
      term: [""],
      content: [""],
    }),
  });

  rules = this.fb.array<RuleGroup>([]);

  constructor() {
    this.form.controls.alias.valueChanges.subscribe(() => this.checkAlias());
    this.form.controls.domainId.valueChanges.subscribe(() => this.checkAlias());
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
      this.loading.set(false);
    }
  }

  private async loadDomains(): Promise<void> {
    try {
      const { domains } = await this.api.get<{ domains: DomainDto[] }>("/api/v1/domains");
      this.domains.set(domains.filter((d) => d.state === "verified" || d.state === "active"));
    } catch {
      this.domains.set([]);
    }
  }

  private async loadEditRules(linkId: number): Promise<void> {
    try {
      const { rules } = await this.api.get<{ rules: RedirectRule[] }>(`/api/v1/links/${linkId}`);
      this.rules.clear();
      rules.forEach((rule) => this.addRule(rule));
      this.editDetailsLoaded.set(true);
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar las reglas del enlace");
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
    if (sameAsCurrent) {
      this.aliasStatus.set("available");
      this.aliasStatusText.set("Alias actual");
      return;
    }

    this.aliasStatus.set("checking");
    // Debounce keystrokes locally so the availability endpoint cannot be used
    // as an accidental request amplifier while typing.
    await new Promise((resolve) => setTimeout(resolve, 220));
    if (requestId !== this.aliasRequest) return;
    try {
      const { available, reason } = await this.api.post<{ available: boolean; reason?: string }>("/api/v1/links/check-alias", {
        alias,
        domainId: this.form.value.domainId,
      });
      if (requestId !== this.aliasRequest) return;
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
      if (requestId !== this.aliasRequest) return;
      this.aliasStatus.set("idle");
      this.aliasStatusText.set("");
    }
  }

  // ---------- Tags ----------
  addTag(event: { value: string; chipInput: { clear: () => void } }): void {
    const value = (event.value ?? "").trim().slice(0, 40);
    if (value && !this.tags().includes(value)) {
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

  addRule(initial: Partial<RedirectRule> = {}): void {
    const raw = initial as RedirectRule & { time_from?: string | null; time_to?: string | null };
    this.rules.push(
      this.fb.nonNullable.group({
        priority: [initial.priority ?? this.rules.length],
        country: [initial.country ?? ""],
        language: [initial.language ?? ""],
        device: [initial.device ?? ""],
        os: [initial.os ?? ""],
        timeFrom: [initial.timeFrom ?? raw.time_from ?? ""],
        timeTo: [initial.timeTo ?? raw.time_to ?? ""],
        referrer: [initial.referrer ?? ""],
        campaign: [initial.campaign ?? ""],
        destination: [initial.destination ?? ""],
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
    if (this.form.invalid || this.busy() || (this.isEdit && !this.editDetailsLoaded())) return;
    this.busy.set(true);
    this.error.set(null);
    const v = this.form.value;
    const passwordValue = v.password ?? "";
    const password = this.isEdit
      ? (v.clearPassword ? null : passwordValue !== "" ? passwordValue : undefined)
      : (passwordValue !== "" ? passwordValue : null);
    const payload = {
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
        const res = await this.api.patch<{ link: LinkDto }>(`/api/v1/links/${this.data.link!.id}`, payload);
        link = res.link;
      } else {
        const res = await this.api.post<{ link: LinkDto }>("/api/v1/links", payload);
        link = res.link;
      }
      this.dialogRef.close({ link });
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo guardar el enlace");
    } finally {
      this.busy.set(false);
    }
  }
}


