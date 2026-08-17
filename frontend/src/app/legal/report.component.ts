import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { LegalShellComponent } from "./legal-shell.component";
import { ApiService, ApiRequestError } from "../core/services/api.service";

const REASONS = [
  "Phishing o suplantación de identidad",
  "Spam o publicidad no deseada",
  "Malware o software malicioso",
  "Contenido ilegal o inapropiado",
  "Otro",
];

/** Accepts a full short URL ("https://uvh.es/abc123") or a bare alias ("abc123"). */
function extractAlias(input: string): string {
  let t = input.trim();
  if (!t) return "";
  t = t.replace(/^https?:\/\//i, "");
  t = t.replace(/[?#].*$/, "");
  const parts = t.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? t;
}

@Component({
  selector: "app-report",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatProgressBarModule,
    LegalShellComponent,
  ],
  templateUrl: "./report.component.html",
  styleUrl: "./report.component.scss",
})
export class ReportComponent {
  private fb = inject(FormBuilder);
  private api = inject(ApiService);

  readonly reasons = REASONS;
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly done = signal(false);

  form = this.fb.nonNullable.group({
    link: ["", [Validators.required]],
    reason: ["", [Validators.required]],
    details: ["", [Validators.maxLength(2000)]],
    email: ["", [Validators.email, Validators.maxLength(254)]],
  });

  async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.done.set(false);

    const v = this.form.getRawValue();
    try {
      await this.api.post("/api/v1/report", {
        alias: extractAlias(v.link),
        reason: v.reason,
        details: v.details?.trim() || undefined,
        email: v.email?.trim() || "",
      });
      this.done.set(true);
      this.form.reset();
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo enviar la denuncia");
    } finally {
      this.busy.set(false);
    }
  }
}
