import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatExpansionModule } from "@angular/material/expansion";
import type { LinkUtm, RedirectRule, RuleSimulationInput, RuleSimulationResult } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { decodeRuleSimulationResult } from "../../core/services/link-history-response-decoders";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";

export interface RuleSimulatorDialogData {
  appOpeningConfigured?: boolean;
  linkId?: number;
  destination: string;
  fallbackDestination: string | null;
  utm: LinkUtm;
  rules: RedirectRule[];
}

@Component({
  selector: "app-rule-simulator-dialog",
  standalone: true,
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule, MatProgressBarModule, MatExpansionModule],
  templateUrl: "./rule-simulator-dialog.component.html",
  styleUrl: "./rule-simulator-dialog.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuleSimulatorDialogComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly ref = inject(MatDialogRef<RuleSimulatorDialogComponent>);
  private readonly auth = inject(AuthService);
  private readonly workspaces = inject(WorkspaceService);
  readonly data = inject<RuleSimulatorDialogData>(MAT_DIALOG_DATA);
  private readonly openedContext = this.contextKey();
  readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<RuleSimulationResult | null>(null);
  readonly form = this.fb.nonNullable.group({
    country: ["", [Validators.maxLength(2)]],
    device: [""],
    language: ["", [Validators.maxLength(8)]],
    os: ["", [Validators.maxLength(40)]],
    localTime: ["", [Validators.pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)]],
    referrer: ["", [Validators.maxLength(200)]],
    campaign: ["", [Validators.maxLength(100)]],
  });

  private contextKey(): string {
    return JSON.stringify([this.auth.user()?.id ?? null, this.auth.sessionGeneration(), this.workspaces.currentId(), this.workspaces.selectionGeneration(), this.workspaces.currentRole()]);
  }

  utcPreview(): string | null {
    const value = this.form.controls.localTime.value;
    if (!/^\d{2}:\d{2}$/.test(value)) return null;
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: this.timezone, timeZoneName: "shortOffset", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
    const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(offset);
    if (!match) return null;
    const delta = match[1] ? (Number(match[2]) * 60 + Number(match[3] ?? 0)) * (match[1] === "+" ? 1 : -1) : 0;
    const minutes = Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) - delta;
    const normalized = (minutes + 1440) % 1440;
    return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")} UTC`;
  }

  async simulate(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true); this.error.set(null); this.result.set(null);
    const value = this.form.getRawValue();
    const payload: RuleSimulationInput = {
      linkId: this.data.linkId,
      destination: this.data.destination,
      fallbackDestination: this.data.fallbackDestination,
      utm: this.data.utm,
      rules: this.data.rules,
      country: value.country.trim() || null,
      device: (value.device || null) as RuleSimulationInput["device"],
      language: value.language.trim() || null,
      os: value.os.trim() || null,
      localTime: value.localTime || null,
      timezone: this.timezone,
      referrer: value.referrer.trim() || null,
      campaign: value.campaign.trim() || null,
    };
    try {
      const result = await this.api.post<RuleSimulationResult>("/api/v1/link-rule-simulations", payload, decodeRuleSimulationResult);
      if (this.openedContext !== this.contextKey()) { this.ref.close(false); return; }
      this.result.set(result);
    } catch (error) {
      this.error.set(error instanceof ApiRequestError ? error.message : "No se pudo probar la configuración");
    } finally {
      this.busy.set(false);
    }
  }

  reset(): void { this.form.reset(); this.result.set(null); this.error.set(null); }
  ruleNumbers(values: number[]): string { return values.map((value) => String(value + 1)).join(", "); }
  close(): void { this.ref.close(); }
}
