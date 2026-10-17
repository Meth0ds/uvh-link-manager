import { UI_LOCALE } from "../core/localisation/locale";
import { UI_TEXT } from "../core/localisation/template-messages";
import { Meta } from "@angular/platform-browser";
import { DOCUMENT, DatePipe } from "@angular/common";
import { Component, DestroyRef, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { ApiService, ApiRequestError } from "../core/services/api.service";
import { LatestRequest } from "../core/services/latest-request";
import { decodePublicReport } from "../core/services/sharing-decoders";
import { boolean, record } from "../core/services/response-decoder-helpers";
import type { PublicReport } from "../core/sharing";
@Component({
  selector: "app-public-report",
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
  ],
  templateUrl: "./public-report.component.html",
  styleUrl: "./public-report.component.scss",
})
export class PublicReportComponent {
  readonly uiText = UI_TEXT;
  private readonly meta = inject(Meta);
  private readonly api = inject(ApiService);
  private readonly document = inject(DOCUMENT);
  private readonly destroy = inject(DestroyRef);
  private readonly requests = new LatestRequest(this.destroy);
  private readonly route = inject(ActivatedRoute);
  private readonly id = this.route.snapshot.paramMap.get("publicId") ?? "";
  private token = "";
  readonly report = signal<PublicReport | null>(null);
  readonly loading = signal(true);
  readonly passwordRequired = signal(false);
  readonly error = signal("");
  readonly unavailable = signal(false);
  password = "";
  readonly number = new Intl.NumberFormat(UI_LOCALE);
  readonly graph = computed(() => {
    const series = this.report()?.series ?? [];
    const max = Math.max(
      1,
      ...series.filter((p) => p.available).map((p) => p.visits),
    );
    let next = true;
    return series
      .map((p, i) => {
        if (!p.available) {
          next = true;
          return "";
        }
        const x =
          series.length === 1 ? 360 : 8 + (i * 704) / (series.length - 1);
        const y = 210 - (p.visits / max) * 190;
        const step = (next ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
        next = false;
        return step;
      })
      .join(" ");
  });
  readonly hasMissing = computed(
    () => this.report()?.series.some((p) => !p.available) ?? false,
  );
  readonly onePoint = computed(() => {
    const s = this.report()?.series ?? [];
    return s.length === 1 && s[0].available
      ? { y: 210 - (s[0].visits / Math.max(1, s[0].visits)) * 190 }
      : null;
  });
  constructor() {
    const previous = this.meta.getTag("name=robots")?.content;
    this.meta.updateTag({
      name: "robots",
      content: "noindex, nofollow, noarchive",
    });
    this.destroy.onDestroy(() => {
      if (previous !== undefined)
        this.meta.updateTag({ name: "robots", content: previous });
      else this.meta.removeTag("name=robots");
    });
    const win = this.document.defaultView;
    const hash = win?.location.hash ?? "";
    const candidate = new URLSearchParams(hash.slice(1)).get("token") ?? "";
    if (/^[A-Za-z0-9_-]{43}$/.test(candidate)) this.token = candidate;
    if (hash)
      win?.history.replaceState(
        win.history.state,
        "",
        win.location.pathname + win.location.search,
      );
    const timer = setInterval(() => {
      if (
        this.report() &&
        !this.loading() &&
        this.document.visibilityState === "visible"
      )
        void this.load();
    }, 60000);
    this.destroy.onDestroy(() => {
      this.token = "";
      this.password = "";
      clearInterval(timer);
    });
    if (!/^[a-f0-9-]{36}$/.test(this.id)) {
      this.loading.set(false);
      this.unavailable.set(true);
    } else if (hash && !this.token) {
      this.loading.set(false);
      this.unavailable.set(true);
    } else if (this.token) void this.access();
    else void this.load();
  }
  async access(): Promise<void> {
    this.loading.set(true);
    this.error.set("");
    try {
      const result = await this.api.accessSharedReport(
        `/api/v1/shared-reports/${this.id}/access`,
        { token: this.token, password: this.password || null },
        (v) => ({
          passwordRequired: boolean(
            record(v, "report access")["passwordRequired"],
            "password required",
          ),
        }),
      );
      if (this.destroy.destroyed) return;
      this.passwordRequired.set(result.passwordRequired);
      if (!result.passwordRequired) {
        this.token = "";
        this.password = "";
        await this.load();
      }
    } catch (e) {
      if (!this.destroy.destroyed) {
        this.error.set(
          e instanceof ApiRequestError
            ? e.message
            : $localize`:@@ui.37d2a46265d9de:No se pudo abrir el informe.`,
        );
        this.unavailable.set(e instanceof ApiRequestError && e.status === 404);
      }
    } finally {
      if (!this.destroy.destroyed) this.loading.set(false);
    }
  }
  async load(): Promise<void> {
    const request = this.requests.begin(this.id);
    this.loading.set(true);
    this.error.set("");
    try {
      const data = await this.api.get(
        `/api/v1/shared-reports/${this.id}/overview`,
        undefined,
        decodePublicReport,
        { signal: request.signal },
      );
      if (this.requests.isCurrent(request, this.id)) {
        this.report.set(data);
        this.document.title = data.title + $localize`:@@ui.94d7033db698ea: · Informe UVH`;
      }
    } catch (e) {
      if (this.requests.isCurrent(request, this.id)) {
        this.report.set(null);
        this.error.set(
          e instanceof ApiRequestError
            ? e.message
            : $localize`:@@ui.87f43233fde235:No se pudieron actualizar los resultados.`,
        );
        this.unavailable.set(
          e instanceof ApiRequestError && [401, 404].includes(e.status),
        );
      }
    } finally {
      if (this.requests.isCurrent(request, this.id)) this.loading.set(false);
    }
  }
  retry(): void {
    if (this.token) void this.access();
    else void this.load();
  }
  device(key: string): string {
    return (
      (
        {
          mobile: $localize`:@@ui.cac5d3230b6884:Móvil`,
          desktop: "Ordenador",
          tablet: "Tablet",
          bot: "Automatizado",
        } as Record<string, string>
      )[key] ?? key
    );
  }
  country(key: string): string {
    try {
      return (
        new Intl.DisplayNames([UI_LOCALE], { type: "region" }).of(
          key.toUpperCase(),
        ) ?? key
      );
    } catch {
      return key;
    }
  }
  pct(value: number, rows: { value: number }[]): number {
    return (value / Math.max(1, ...rows.map((r) => r.value))) * 100;
  }
}
