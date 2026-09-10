import { Component, DestroyRef, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { Router, RouterLink } from "@angular/router";

import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatSelectModule } from "@angular/material/select";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { ChartsComponent } from "./charts.component";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { AnalyticsOverview } from "../../core/models";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { LatestRequest } from "../../core/services/latest-request";
import { decodeAnalyticsOverview } from "../../core/services/link-response-decoders";

@Component({
  selector: "app-analytics",
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    MatProgressBarModule,
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
  private api = inject(ApiService);
  private workspaces = inject(WorkspaceService);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  readonly router = inject(Router);

  readonly overview = signal<AnalyticsOverview | null>(null);
  readonly period = signal("7d");
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

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
    const request = this.requests.begin(workspaceId);
    this.loading.set(true);
    this.error.set(null);
    try {
      const a = await this.api.get<AnalyticsOverview>(
        "/api/v1/analytics/overview",
        { period: this.period() },
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

  openLink(id: number): void {
    void this.router.navigate(["/app/links", id]);
  }

  openLinkFromKeyboard(event: KeyboardEvent, id: number): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.openLink(id);
  }
}
