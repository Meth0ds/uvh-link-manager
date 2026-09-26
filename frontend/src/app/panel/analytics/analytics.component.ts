import { Component, DestroyRef, computed, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { RouterLink } from "@angular/router";

import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { ChartsComponent } from "./charts.component";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { AnalyticsOverview } from "../../core/models";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { LatestRequest } from "../../core/services/latest-request";
import { decodeAnalyticsOverview } from "../../core/services/link-response-decoders";
import { downloadBlob } from "../../core/services/browser-download";

@Component({
  selector: "app-analytics",
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    RouterLink,
    ChartsComponent,
    PageHeaderComponent,
    PanelSkeletonComponent,
  ],
  templateUrl: "./analytics.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./analytics.component.scss",
})
export class AnalyticsComponent {
  private readonly numberFormatter = new Intl.NumberFormat("es-ES");
  private api = inject(ApiService);
  private workspaces = inject(WorkspaceService);
  private snackbar = inject(MatSnackBar);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  readonly overview = signal<AnalyticsOverview | null>(null);
  readonly period = signal("7d");
  readonly customFrom = signal("");
  readonly customTo = signal("");
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly exporting = signal(false);
  readonly periodOptions = [
    { value: "24h", short: "24 h", label: "Últimas 24 horas" },
    { value: "7d", short: "7 d", label: "Últimos 7 días" },
    { value: "30d", short: "30 d", label: "Últimos 30 días" },
    { value: "90d", short: "90 d", label: "Últimos 90 días" },
    { value: "custom", short: "Personalizado", label: "Rango personalizado" },
  ] as const;
  private readonly dateFormatter = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });

  /** The date picker has no window yet: show the picker, not a false «no data». */
  readonly awaitingCustomRange = computed(() => this.period() === "custom"
    && (!this.customFrom() || !this.customTo()));
  readonly customRangeError = computed(() => this.period() === "custom"
    && this.customFrom() !== "" && this.customTo() !== "" && this.customFrom() > this.customTo()
    ? "La fecha inicial debe ser anterior o igual a la final."
    : null);

  private loadedWorkspaceId: number | null | undefined;

  constructor() {
    effect(() => {
      const workspaceId = this.workspaces.currentId();
      if (workspaceId === this.loadedWorkspaceId) return;
      this.loadedWorkspaceId = workspaceId;
      // Never retain metrics from the previous authorization context.
      this.requests.invalidate();
      this.overview.set(null);
      this.error.set(null);
      if (workspaceId === null) {
        this.loading.set(false);
        return;
      }
      void this.load();
    });
  }

  async load(): Promise<void> {
    const workspaceId = this.workspaces.currentId();
    if (workspaceId === null) {
      this.requests.invalidate();
      this.overview.set(null);
      this.loading.set(false);
      return;
    }
    if (this.awaitingCustomRange() || this.customRangeError() !== null) {
      // A custom range with no (or inverted) bounds is not an empty period:
      // wait for the picker instead of asking the API for a meaningless window.
      this.requests.invalidate();
      this.overview.set(null);
      this.loading.set(false);
      return;
    }
    const request = this.requests.begin(workspaceId);
    this.loading.set(true);
    this.error.set(null);
    try {
      const a = await this.api.get<AnalyticsOverview>(
        "/api/v1/analytics/overview",
        this.query(),
        decodeAnalyticsOverview,
        { signal: request.signal },
      );
      if (!this.requests.isCurrent(request, this.workspaces.currentId())) return;
      this.overview.set(a);
    } catch (err) {
      if (!this.requests.isCurrent(request, this.workspaces.currentId())) return;
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar las métricas");
    } finally {
      if (this.requests.isCurrent(request, this.workspaces.currentId())) this.loading.set(false);
    }
  }

  async onPeriod(value: string): Promise<void> {
    // Never relabel an old snapshot with the newly selected period. Clearing
    // first also leaves an unambiguous error state if the replacement fails.
    this.requests.invalidate();
    this.overview.set(null);
    this.period.set(value);
    await this.load();
  }

  async onCustomDate(side: "from" | "to", value: string): Promise<void> {
    this.requests.invalidate();
    this.overview.set(null);
    if (side === "from") this.customFrom.set(value);
    else this.customTo.set(value);
    await this.load();
  }

  private query(): Record<string, string> {
    if (this.period() !== "custom") return { period: this.period() };
    // Date-only bounds: `from` opens the first day and the API closes `to` at
    // the end of its day, so «hasta el 30» includes what happened on the 30th.
    return { period: "custom", from: this.customFrom(), to: this.customTo() };
  }

  periodLabel(): string {
    if (this.period() === "custom") {
      const from = this.formatDay(this.customFrom());
      const to = this.formatDay(this.customTo());
      return from !== "" && to !== "" ? `Del ${from} al ${to}` : "Rango personalizado";
    }
    return this.periodOptions.find((option) => option.value === this.period())?.label ?? "Periodo seleccionado";
  }

  private formatDay(value: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
    const [year, month, day] = value.split("-").map(Number);
    return this.dateFormatter.format(new Date(year, month - 1, day));
  }

  formatCount(value: number): string {
    return this.numberFormatter.format(value);
  }

  /**
   * Export del mismo periodo que se está leyendo (F7f): sólo agregados, sin
   * hashes de visitante, en CSV o en el overview JSON completo.
   */
  async export(format: "csv" | "json"): Promise<void> {
    if (this.exporting() || this.awaitingCustomRange() || this.customRangeError() !== null) return;
    this.exporting.set(true);
    try {
      const blob = await this.api.getBlob("/api/v1/analytics/export", { ...this.query(), format });
      const stamp = new Date().toISOString().slice(0, 10);
      if (!downloadBlob(blob, `uvh-analytics-${stamp}.${format}`)) {
        this.snackbar.open("No se pudo iniciar la descarga", "Cerrar", { duration: 3000 });
        return;
      }
      this.snackbar.open(`Export ${format.toUpperCase()} descargado`, "Cerrar", { duration: 2500 });
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo exportar la analítica", "Cerrar", { duration: 3500 });
    } finally {
      this.exporting.set(false);
    }
  }
}
