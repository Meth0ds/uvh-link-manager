import { Component, computed, input, ChangeDetectionStrategy } from "@angular/core";

import type { AnalyticsOverview } from "../../core/models";

@Component({
  selector: "app-charts",
  standalone: true,
  imports: [],
  templateUrl: "./charts.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./charts.component.scss",
})
export class ChartsComponent {
  readonly overview = input.required<AnalyticsOverview>();
  // The dashboard shows the time series once; full analytics keeps all six
  // breakdowns. This is presentation only, never a different metric query.
  readonly showBreakdowns = input(true);
  private readonly numberFormatter = new Intl.NumberFormat("es-ES");

  readonly maxClicks = computed(() => {
    const m = Math.max(0, ...this.overview().series.map((s) => s.clicks));
    return m === 0 ? 1 : m;
  });

  /** Numeric plot coordinates are the source of truth for every SVG shape. */
  private readonly plotPoints = computed(() => {
    const series = this.overview().series;
    if (series.length === 0) return [];
    const W = 720;
    const H = 220;
    const pad = 8;
    const step = series.length === 1 ? 0 : (W - pad * 2) / (series.length - 1);
    return series
      .map((s, i) => {
        // Centre a single observation instead of pinning it to the left edge.
        const x = series.length === 1 ? W / 2 : pad + i * step;
        const y = H - pad - (s.clicks / this.maxClicks()) * (H - pad * 2);
        return { x, y };
      });
  });

  readonly points = computed(() => this.plotPoints()
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" "));

  readonly singlePoint = computed(() => {
    const coordinates = this.plotPoints();
    return coordinates.length === 1 ? coordinates[0] : null;
  });

  readonly areaPoints = computed(() => {
    const coordinates = this.plotPoints();
    if (coordinates.length === 0) return "";
    const H = 220;
    const pad = 8;
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    return `${this.points()} L${last.x.toFixed(1)},${H - pad} L${first.x.toFixed(1)},${H - pad} Z`;
  });

  readonly labels = computed(() => {
    const series = this.overview().series;
    // Hidden flex children still take up space. Render only three ticks at
    // their actual plot positions so a 90-day series also fits a 320px screen.
    const indexes = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])];
    return series.length ? indexes.map((i) => ({ day: series[i].day,
      text: this.dayLabel(series[i].day), position: series.length === 1 ? 50 : i / (series.length - 1) * 100,
    })) : [];
  });

  readonly breakdownKeys = ["countries", "devices", "browsers", "os", "referrers", "campaigns"] as const;

  breakdown(key: (typeof this.breakdownKeys)[number]) {
    const items = this.overview()[key];
    const max = Math.max(1, ...items.map((i) => i.value));
    return { items, max };
  }

  pct(value: number, max: number): number {
    // Zero is genuinely zero; a minimum painted width would invent activity.
    return max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0;
  }

  formatCount(value: number): string {
    return this.numberFormatter.format(value);
  }

  dayLabel(day: string): string {
    // The API date is a calendar bucket, not a local instant. Do not shift it
    // through the browser's timezone while formatting an axis/table label.
    return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
  }

  label(key: string): string {
    const map: Record<string, string> = {
      countries: "Países",
      devices: "Dispositivos",
      browsers: "Navegadores",
      os: "Sistemas",
      referrers: "Referentes",
      campaigns: "Campañas",
    };
    return map[key] ?? key;
  }
}
