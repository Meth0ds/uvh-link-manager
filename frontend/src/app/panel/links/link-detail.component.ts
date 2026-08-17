import { Component, inject, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { CommonModule } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatChipsModule } from "@angular/material/chips";
import { MatMenuModule } from "@angular/material/menu";
import { MatDividerModule } from "@angular/material/divider";
import { MatSelectModule } from "@angular/material/select";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { LinkDialogService } from "./link-dialog.service";
import { QrDialogComponent } from "./qr-dialog.component";
import { MatDialog } from "@angular/material/dialog";
import { ChartsComponent } from "../analytics/charts.component";
import type { LinkDetailResponse, AnalyticsOverview, AuditEvent, LinkDto, RedirectRule } from "../../core/models";

@Component({
  selector: "app-link-detail",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatMenuModule,
    MatDividerModule,
    MatSelectModule,
    MatFormFieldModule,
    MatProgressBarModule,
    MatSnackBarModule,
    ChartsComponent,
  ],
  templateUrl: "./link-detail.component.html",
  styleUrl: "./link-detail.component.scss",
})
export class LinkDetailComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private snackbar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private linkDialog = inject(LinkDialogService);

  readonly link = signal<LinkDto | null>(null);
  readonly rules = signal<RedirectRule[]>([]);
  readonly analytics = signal<AnalyticsOverview | null>(null);
  readonly activity = signal<AuditEvent[]>([]);
  readonly period = signal("30d");
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  private linkId = Number(this.route.snapshot.paramMap.get("id"));

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const detail = await this.api.get<LinkDetailResponse>(`/api/v1/links/${this.linkId}`);
      this.link.set(detail.link);
      this.rules.set(detail.rules);
      await Promise.all([this.loadAnalytics(), this.loadActivity()]);
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo cargar el enlace");
    } finally {
      this.loading.set(false);
    }
  }

  async loadAnalytics(): Promise<void> {
    try {
      const a = await this.api.get<AnalyticsOverview>("/api/v1/analytics/overview", {
        linkId: this.linkId,
        period: this.period(),
      });
      this.analytics.set(a);
    } catch {
      this.analytics.set(null);
    }
  }

  async loadActivity(): Promise<void> {
    try {
      const { events } = await this.api.get<{ events: AuditEvent[] }>(`/api/v1/links/${this.linkId}/activity`);
      this.activity.set(events);
    } catch {
      this.activity.set([]);
    }
  }

  async onPeriod(value: string): Promise<void> {
    this.period.set(value);
    await this.loadAnalytics();
  }

  copy(url: string): void {
    void navigator.clipboard.writeText(url).then(
      () => this.snackbar.open("Enlace copiado", "Cerrar", { duration: 2000 }),
      () => this.snackbar.open("No se pudo copiar", "Cerrar", { duration: 2500 }),
    );
  }

  showQr(): void {
    const l = this.link();
    if (l) this.dialog.open(QrDialogComponent, { data: l.shortUrl });
  }

  edit(): void {
    const l = this.link();
    if (!l) return;
    this.linkDialog.openEdit(l).subscribe((updated) => {
      if (updated) void this.load();
    });
  }

  async setState(state: "active" | "paused" | "archived"): Promise<void> {
    try {
      await this.api.post(`/api/v1/links/${this.linkId}/state`, { state });
      this.snackbar.open("Estado actualizado", "Cerrar", { duration: 2000 });
      void this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 3000 });
    }
  }

  async remove(): Promise<void> {
    const l = this.link();
    if (!l || !confirm(`¿Eliminar el enlace ${l.shortUrl}?`)) return;
    try {
      await this.api.delete(`/api/v1/links/${this.linkId}`);
      this.snackbar.open("Enlace eliminado", "Cerrar", { duration: 2000 });
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 3000 });
    }
  }

  ruleSummary(rule: RedirectRule): string {
    const parts: string[] = [];
    if (rule.country) parts.push(`País: ${rule.country.toUpperCase()}`);
    if (rule.language) parts.push(`Idioma: ${rule.language}`);
    if (rule.device) parts.push(`Dispositivo: ${rule.device}`);
    if (rule.os) parts.push(`SO: ${rule.os}`);
    if (rule.timeFrom || rule.timeTo) parts.push(`Horario: ${rule.timeFrom ?? "00:00"}–${rule.timeTo ?? "23:59"} UTC`);
    if (rule.referrer) parts.push(`Referente: ${rule.referrer}`);
    if (rule.campaign) parts.push(`Campaña: ${rule.campaign}`);
    return parts.length ? parts.join(" · ") : "Sin condición";
  }

  actionLabel(action: string): string {
    const map: Record<string, string> = {
      "link.create": "Creación",
      "link.update": "Edición",
      "link.state_change": "Cambio de estado",
      "link.delete": "Eliminación",
      "link.restore": "Restauración",
    };
    return map[action] ?? action;
  }

  /** Short URL without the scheme, for display. */
  displayUrl(url: string): string {
    return url.replace(/^https?:\/\//, "");
  }
}
