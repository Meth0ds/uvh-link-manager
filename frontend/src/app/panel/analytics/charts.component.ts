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

  readonly maxClicks = computed(() => {
    const m = Math.max(0, ...this.overview().series.map((s) => s.clicks));
    return m === 0 ? 1 : m;
  });

  readonly points = computed(() => {
    const series = this.overview().series;
    if (series.length === 0) return "";
    const W = 720;
    const H = 220;
    const pad = 8;
    const step = series.length === 1 ? W / 2 : (W - pad * 2) / (series.length - 1);
    return series
      .map((s, i) => {
        const x = pad + i * step;
        const y = H - pad - (s.clicks / this.maxClicks()) * (H - pad * 2);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  });

  readonly areaPoints = computed(() => {
    const p = this.points();
    if (!p) return "";
    const H = 220;
    const pad = 8;
    const last = p.split(" ").pop()?.split(",") ?? ["0", "0"];
    const first = p.split(" ")[0]?.slice(1).split(",") ?? ["0", "0"];
    return `${p} L${last[0]},${H - pad} L${first[0]},${H - pad} Z`;
  });

  readonly labels = computed(() => {
    const series = this.overview().series;
    const every = Math.max(1, Math.ceil(series.length / 8));
    return series.map((s, i) => ({ day: s.day.slice(5), show: i % every === 0 || i === series.length - 1 }));
  });

  readonly breakdownKeys = ["countries", "devices", "browsers", "os", "referrers", "campaigns"] as const;

  breakdown(key: (typeof this.breakdownKeys)[number]) {
    const items = this.overview()[key];
    const max = Math.max(1, ...items.map((i) => i.value));
    return { items, max };
  }

  pct(value: number, max: number): number {
    return Math.max(4, Math.round((value / max) * 100));
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
