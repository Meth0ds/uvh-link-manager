import { Component, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { CommonModule } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatSelectModule } from "@angular/material/select";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { ChartsComponent } from "./charts.component";
import type { AnalyticsOverview } from "../../core/models";

@Component({
  selector: "app-analytics",
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    MatProgressBarModule,
    ChartsComponent,
  ],
  templateUrl: "./analytics.component.html",
  styleUrl: "./analytics.component.scss",
})
export class AnalyticsComponent {
  private api = inject(ApiService);
  readonly router = inject(Router);

  readonly overview = signal<AnalyticsOverview | null>(null);
  readonly period = signal("7d");
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
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
}
