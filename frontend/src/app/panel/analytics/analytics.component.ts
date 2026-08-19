import { Component, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";
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
    ChartsComponent
],
  templateUrl: "./analytics.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./analytics.component.scss",
})
export class AnalyticsComponent {
  private api = inject(ApiService);
  private workspaces = inject(WorkspaceService);
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
      const a = await this.api.get<AnalyticsOverview>("/api/v1/analytics/overview", { period: this.period() });
      this.overview.set(a);
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar las métricas");
    } finally {
      this.loading.set(false);
    }
  }

  async onPeriod(value: string): Promise<void> {
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
