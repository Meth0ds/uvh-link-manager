import { Component, computed, DestroyRef, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { Router, RouterLink } from "@angular/router";

import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { LinkDialogService } from "../links/link-dialog.service";
import { ChartsComponent } from "../analytics/charts.component";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { GettingStartedComponent } from "../getting-started/getting-started.component";
import type { AnalyticsOverview, LinksResponse, LinkDto } from "../../core/models";
import { LatestRequest } from "../../core/services/latest-request";
import { decodeAnalyticsOverview, decodeLinksResponse } from "../../core/services/link-response-decoders";

type DashboardPeriod = "24h" | "7d" | "30d" | "90d";

interface DashboardPeriodOption {
  value: DashboardPeriod;
  label: string;
}

@Component({
  selector: "app-dashboard",
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    ChartsComponent,
    PageHeaderComponent,
    PanelSkeletonComponent,
    GettingStartedComponent,
  ],
  templateUrl: "./dashboard.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./dashboard.component.scss",
})
export class DashboardComponent {
  private api = inject(ApiService);
  readonly router = inject(Router);
  private snackbar = inject(MatSnackBar);
  private linkDialog = inject(LinkDialogService);
  private auth = inject(AuthService);
  private workspaces = inject(WorkspaceService);
  private readonly requests = new LatestRequest(inject(DestroyRef));

  readonly user = this.auth.user;
  readonly hasWorkspace = computed(() => this.workspaces.currentId() !== null);
  readonly workspaceName = computed(() => this.workspaces.list().find((w) => w.id === this.workspaces.currentId())?.name);
  readonly canCreate = computed(() => {
    const role = this.workspaces.list().find((w) => w.id === this.workspaces.currentId())?.role;
    return role === "owner" || role === "admin" || role === "editor";
  });
  readonly overview = signal<AnalyticsOverview | null>(null);
  readonly recent = signal<LinkDto[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly period = signal<DashboardPeriod>("30d");
  readonly periods: readonly DashboardPeriodOption[] = [
    { value: "24h", label: "24 h" },
    { value: "7d", label: "7 días" },
    { value: "30d", label: "30 días" },
    { value: "90d", label: "90 días" },
  ];
  readonly periodLabel = computed(() => this.periods.find((option) => option.value === this.period())?.label ?? "30 días");

  private readonly numberFormatter = new Intl.NumberFormat("es-ES");

  private loadedWorkspaceId: number | null | undefined;
  constructor() {
    effect(() => {
      const workspaceId = this.workspaces.currentId();
      if (workspaceId === this.loadedWorkspaceId) return;
      this.loadedWorkspaceId = workspaceId;
      this.requests.invalidate();
      this.overview.set(null);
      this.recent.set([]);
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
      this.recent.set([]);
      this.loading.set(false);
      return;
    }
    const request = this.requests.begin(workspaceId);
    const period = this.period();
    this.loading.set(true);
    this.error.set(null);
    try {
      const [a, links] = await Promise.all([
        this.api.get<AnalyticsOverview>("/api/v1/analytics/overview", { period }, decodeAnalyticsOverview, { signal: request.signal }),
        this.api.get<LinksResponse>("/api/v1/links", { sort: "created_at_desc", perPage: 5 },
          (value) => decodeLinksResponse(value, { page: 1, perPage: 5 }), { signal: request.signal }),
      ]);
      if (!this.requests.isCurrent(request, this.workspaces.currentId())) return;
      this.overview.set(a);
      this.recent.set(links.links);
    } catch (err) {
      if (!this.requests.isCurrent(request, this.workspaces.currentId())) return;
      const message = err instanceof ApiRequestError ? err.message : "No se pudieron cargar los datos";
      this.error.set(message);
      this.snackbar.open(message, "Cerrar", { duration: 3500 });
    } finally {
      if (this.requests.isCurrent(request, this.workspaces.currentId())) this.loading.set(false);
    }
  }

  setPeriod(period: DashboardPeriod): void {
    if (this.period() === period) return;
    // The period label changes immediately, so discard the prior snapshot
    // before publishing that label and requesting its replacement.
    this.requests.invalidate();
    this.overview.set(null);
    this.period.set(period);
    void this.load();
  }

  retry(): void {
    void this.load();
  }

  newLink(): void {
    // UI capability only: the API remains authoritative. Unknown/viewer roles
    // should not be invited into a form they cannot submit successfully.
    if (!this.canCreate()) return;
    this.linkDialog.openCreate().subscribe((created) => {
      if (created) void this.router.navigate(["/app/links", created.id]);
    });
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

  /** Short URL without the scheme, for display. */
  displayUrl(url: string): string {
    return url.replace(/^https?:\/\//, "");
  }

  formatCount(value: number): string {
    return this.numberFormatter.format(value);
  }

  stateLabel(state: LinkDto["state"]): string {
    return { active: "Activo", paused: "Pausado", scheduled: "Programado", expired: "Caducado",
      blocked: "Bloqueado", archived: "Archivado", deleted: "En papelera" }[state];
  }

  /** Percentage a country value represents of the total clicks (for bars). */
  geoPct(value: number, o: AnalyticsOverview): number {
    const total = o.countries.reduce((s, c) => s + c.value, 0);
    return total > 0 ? Math.round((value / total) * 100) : 0;
  }

  /** Regional emoji flag for a 2-letter country code. */
  flag(code: string): string {
    if (!/^[A-Za-z]{2}$/.test(code)) return "🌐";
    const upper = code.toUpperCase();
    return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  }

  /** Friendly country name for a 2-letter code (fallback: the code itself). */
  countryName(code: string): string {
    if (!/^[A-Za-z]{2}$/.test(code)) return code;
    try {
      return new Intl.DisplayNames(["es"], { type: "region" }).of(code.toUpperCase()) ?? code;
    } catch {
      return code;
    }
  }
}
