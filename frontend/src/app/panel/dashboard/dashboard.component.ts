import { Component, computed, DestroyRef, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { Router, RouterLink } from "@angular/router";

import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBarModule } from "@angular/material/snack-bar";
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
import { CopyFeedbackService } from "../../core/services/copy-feedback.service";
import { CopyFeedbackIconComponent } from "../copy-feedback-icon.component";
import { linkStateLabel } from "../../core/link-state-label";

type DashboardPeriod = "24h" | "7d" | "30d" | "90d";

interface DashboardPeriodOption {
  value: DashboardPeriod;
  label: string;
}

@Component({
  selector: "app-dashboard",
  standalone: true,
  providers: [CopyFeedbackService],
  imports: [
    CopyFeedbackIconComponent,
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
  private readonly dialogOwner = inject(DestroyRef);
  readonly router = inject(Router);
  private linkDialog = inject(LinkDialogService);
  private auth = inject(AuthService);
  private workspaces = inject(WorkspaceService);
  readonly copyFeedback = inject(CopyFeedbackService);
  readonly copyScope = () => `${this.workspaces.currentId()}:${this.workspaces.selectionGeneration()}`;
  private readonly analyticsRequests = new LatestRequest(inject(DestroyRef));
  private readonly recentRequests = new LatestRequest(inject(DestroyRef));

  readonly user = this.auth.user;
  readonly hasWorkspace = computed(() => this.workspaces.currentId() !== null);
  readonly workspaceName = computed(() => this.workspaces.list().find((w) => w.id === this.workspaces.currentId())?.name);
  readonly canCreate = computed(() => {
    const role = this.workspaces.list().find((w) => w.id === this.workspaces.currentId())?.role;
    return role === "owner" || role === "admin" || role === "editor";
  });
  readonly overview = signal<AnalyticsOverview | null>(null);
  readonly recent = signal<LinkDto[]>([]);
  readonly analyticsLoading = signal(true);
  readonly analyticsError = signal<string | null>(null);
  readonly recentLoading = signal(true);
  readonly recentError = signal<string | null>(null);
  readonly recentLoaded = signal(false);
  readonly period = signal<DashboardPeriod>("30d");
  readonly periods: readonly DashboardPeriodOption[] = [
    { value: "24h", label: "24 h" },
    { value: "7d", label: "7 días" },
    { value: "30d", label: "30 días" },
    { value: "90d", label: "90 días" },
  ];
  readonly periodLabel = computed(() => this.periods.find((option) => option.value === this.period())?.label ?? "30 días");

  private readonly numberFormatter = new Intl.NumberFormat("es-ES");

  private loadedContext: string | null | undefined;

  private currentContext(): string | null {
    const actorId = this.auth.user()?.id;
    const workspaceId = this.workspaces.currentId();
    if (actorId === undefined || workspaceId === null) return null;
    return JSON.stringify([actorId, this.auth.sessionGeneration(), workspaceId,
      this.workspaces.selectionGeneration(), this.workspaces.currentRole()]);
  }
  constructor() {
    effect(() => {
      const context = this.currentContext();
      if (context === this.loadedContext) return;
      this.loadedContext = context;
      this.analyticsRequests.invalidate();
      this.recentRequests.invalidate();
      this.overview.set(null);
      this.recent.set([]);
      this.recentLoaded.set(false);
      this.analyticsError.set(null);
      this.recentError.set(null);
      this.analyticsLoading.set(context !== null);
      this.recentLoading.set(context !== null);
      if (context !== null) void this.load();
    });
  }

  async load(): Promise<void> {
    // Each read publishes independently: one unavailable service must not hide
    // the other service's successful response or make its retry fetch twice.
    await Promise.all([this.loadAnalytics(), this.loadRecent()]);
  }

  async loadAnalytics(): Promise<void> {
    const context = this.currentContext();
    const request = this.analyticsRequests.begin(context);
    if (context === null) {
      this.overview.set(null);
      this.analyticsError.set(null);
      this.analyticsLoading.set(false);
      return;
    }
    const period = this.period();
    this.analyticsLoading.set(true);
    this.analyticsError.set(null);
    try {
      const overview = await this.api.get<AnalyticsOverview>("/api/v1/analytics/overview", { period },
        decodeAnalyticsOverview, { signal: request.signal });
      if (this.analyticsRequests.isCurrent(request, this.currentContext())) this.overview.set(overview);
    } catch (error) {
      if (!this.analyticsRequests.isCurrent(request, this.currentContext())) return;
      this.analyticsError.set(error instanceof ApiRequestError ? error.message : "No se pudo cargar la actividad del periodo.");
    } finally {
      if (this.analyticsRequests.isCurrent(request, this.currentContext())) this.analyticsLoading.set(false);
    }
  }

  async loadRecent(): Promise<void> {
    const context = this.currentContext();
    const request = this.recentRequests.begin(context);
    if (context === null) {
      this.recent.set([]);
      this.recentLoaded.set(false);
      this.recentError.set(null);
      this.recentLoading.set(false);
      return;
    }
    this.recentLoading.set(true);
    this.recentError.set(null);
    try {
      const links = await this.api.get<LinksResponse>("/api/v1/links", { sort: "created_at_desc", perPage: 5 },
        (value) => decodeLinksResponse(value, { page: 1, perPage: 5 }), { signal: request.signal });
      if (!this.recentRequests.isCurrent(request, this.currentContext())) return;
      this.recent.set(links.links);
      this.recentLoaded.set(true);
    } catch (error) {
      if (!this.recentRequests.isCurrent(request, this.currentContext())) return;
      this.recentError.set(error instanceof ApiRequestError ? error.message : "No se pudieron cargar los enlaces recientes.");
    } finally {
      if (this.recentRequests.isCurrent(request, this.currentContext())) this.recentLoading.set(false);
    }
  }

  setPeriod(period: DashboardPeriod): void {
    if (this.period() === period) return;
    // Discard the previous period before showing its new label. Recent links
    // are cumulative and independent, including a read that is still pending.
    this.analyticsRequests.invalidate();
    this.overview.set(null);
    this.period.set(period);
    void this.loadAnalytics();
  }

  newLink(): void {
    // UI capability only: the API remains authoritative. Unknown/viewer roles
    // should not be invited into a form they cannot submit successfully.
    if (!this.canCreate()) return;
    this.linkDialog.openCreate("", this.dialogOwner).subscribe((created) => {
      if (created) void this.router.navigate(["/app/links", created.id]);
    });
  }

  copy(url: string): void { this.copyFeedback.copy(url, this.copyScope); }

  /** Short URL without the scheme, for display. */
  displayUrl(url: string): string {
    return url.replace(/^https?:\/\//, "");
  }

  formatCount(value: number): string {
    return this.numberFormatter.format(value);
  }

  readonly stateLabel = linkStateLabel;

  /** Percentage a country value represents of the total clicks (for bars). */
  geoPct(value: number, o: AnalyticsOverview): number {
    // Countries are capped by the API and omit unlocated clicks.
    const total = o.totals.clicks;
    return total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
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
