import { Component, computed, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";

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
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";
import { MatDialog } from "@angular/material/dialog";
import { ChartsComponent } from "../analytics/charts.component";
import type { LinkDetailResponse, AnalyticsOverview, AuditEvent, LinkDto, RedirectRule } from "../../core/models";

@Component({
  selector: "app-link-detail",
  standalone: true,
  imports: [
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
    ChartsComponent
],
  templateUrl: "./link-detail.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./link-detail.component.scss",
})
export class LinkDetailComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snackbar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private workspaces = inject(WorkspaceService);
  private actions = inject(ActionDialogService);
  private linkDialog = inject(LinkDialogService);

  readonly link = signal<LinkDto | null>(null);
  readonly rules = signal<RedirectRule[]>([]);
  readonly analytics = signal<AnalyticsOverview | null>(null);
  readonly activity = signal<AuditEvent[]>([]);
  readonly period = signal("30d");
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly actionBusy = signal(false);
  readonly analyticsError = signal<string | null>(null);
  readonly activityError = signal<string | null>(null);
  readonly canWrite = computed(() => {
    const role = this.workspaces.currentRole();
    return role === "owner" || role === "admin" || role === "editor";
  });

  private linkId = Number(this.route.snapshot.paramMap.get("id"));

  private loadedWorkspaceId: number | null | undefined;

  constructor() {
    if (!Number.isSafeInteger(this.linkId) || this.linkId < 1) {
      this.error.set("El identificador del enlace no es válido");
      this.loading.set(false);
      return;
    }
    effect(() => {
      const workspaceId = this.workspaces.currentId();
      if (workspaceId === this.loadedWorkspaceId) return;
      this.loadedWorkspaceId = workspaceId;
      if (workspaceId === null) {
        this.loading.set(false);
        return;
      }
      void this.load();
    });
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
    this.analyticsError.set(null);
    try {
      const a = await this.api.get<AnalyticsOverview>("/api/v1/analytics/overview", {
        linkId: this.linkId,
        period: this.period(),
      });
      this.analytics.set(a);
    } catch (err) {
      this.analytics.set(null);
      this.analyticsError.set(err instanceof ApiRequestError ? err.message : "No se pudo cargar la analítica");
    }
  }

  async loadActivity(): Promise<void> {
    this.activityError.set(null);
    try {
      const { events } = await this.api.get<{ events: AuditEvent[] }>(`/api/v1/links/${this.linkId}/activity`);
      this.activity.set(events);
    } catch (err) {
      this.activity.set([]);
      this.activityError.set(err instanceof ApiRequestError ? err.message : "No se pudo cargar la actividad");
    }
  }

  retryAnalytics(): void {
    void this.loadAnalytics();
  }

  retryActivity(): void {
    void this.loadActivity();
  }

  async onPeriod(value: string): Promise<void> {
    this.period.set(value);
    await this.loadAnalytics();
  }

  copy(url: string): void {
    const write = navigator.clipboard?.writeText(url);
    if (!write) {
      this.snackbar.open("El navegador no permite copiar automáticamente", "Cerrar", { duration: 2500 });
      return;
    }
    void write.then(
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
    if (!l || !this.canWrite()) return;
    this.linkDialog.openEdit(l).subscribe((updated) => {
      if (updated) void this.load();
    });
  }

  async setState(state: "active" | "paused" | "archived"): Promise<void> {
    if (!this.canWrite() || this.actionBusy()) return;
    this.actionBusy.set(true);
    try {
      await this.api.post(`/api/v1/links/${this.linkId}/state`, { state });
      this.snackbar.open("Estado actualizado", "Cerrar", { duration: 2000 });
      void this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 3000 });
    } finally {
      this.actionBusy.set(false);
    }
  }

  async remove(): Promise<void> {
    const l = this.link();
    if (!l || !this.canWrite()) return;
    const confirmed = await this.actions.confirm({
      title: "Eliminar enlace",
      message: `¿Quieres eliminar ${l.shortUrl}? Dejará de estar disponible de inmediato.`,
      confirmLabel: "Eliminar enlace",
      destructive: true,
    });
    if (!confirmed || this.actionBusy()) return;
    this.actionBusy.set(true);
    try {
      await this.api.delete(`/api/v1/links/${this.linkId}`);
      this.snackbar.open("Enlace eliminado", "Cerrar", { duration: 2000 });
      await this.router.navigate(["/app/links"]);
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 3000 });
    } finally {
      this.actionBusy.set(false);
    }
  }

  ruleSummary(rule: RedirectRule): string {
    const parts: string[] = [];
    const raw = rule as RedirectRule & { time_from?: string | null; time_to?: string | null };
    const timeFrom = rule.timeFrom ?? raw.time_from;
    const timeTo = rule.timeTo ?? raw.time_to;
    if (rule.country) parts.push(`País: ${rule.country.toUpperCase()}`);
    if (rule.language) parts.push(`Idioma: ${rule.language}`);
    if (rule.device) parts.push(`Dispositivo: ${rule.device}`);
    if (rule.os) parts.push(`SO: ${rule.os}`);
    if (timeFrom || timeTo) parts.push(`Horario: ${timeFrom ?? "00:00"}–${timeTo ?? "23:59"} UTC`);
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
