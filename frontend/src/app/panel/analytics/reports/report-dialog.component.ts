import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import type {
  AnalyticsReport,
  ReportLink,
  ReportSection,
  ReportSpec,
} from "../../../core/sharing";
import type { LinkDto } from "../../../core/models";
import { SharingService } from "../../../core/services/sharing.service";
import { LatestRequest } from "../../../core/services/latest-request";
import { decodeLinksResponse } from "../../../core/services/link-response-decoders";
import { ApiRequestError } from "../../../core/services/api.service";
import { CopyFeedbackService } from "../../../core/services/copy-feedback.service";
import {
  localDateTimeIso,
  localDateTimeValue,
} from "../../../core/strict-wire";
@Component({
  selector: "app-report-dialog",
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatProgressBarModule,
  ],
  providers: [CopyFeedbackService],
  templateUrl: "./report-dialog.component.html",
  styleUrl: "./report-dialog.component.scss",
})
export class ReportDialogComponent {
  readonly sharing = inject(SharingService);
  readonly copy = inject(CopyFeedbackService);
  readonly ref = inject(MatDialogRef<ReportDialogComponent>);
  readonly data = inject<{ initial: ReportLink[]; report?: AnalyticsReport }>(
    MAT_DIALOG_DATA,
  );
  private readonly destroy = inject(DestroyRef);
  private readonly searches = new LatestRequest(this.destroy);
  private readonly successHeading =
    viewChild<ElementRef<HTMLElement>>("successHeading");
  readonly context = this.sharing.context();
  readonly copyContext = () => this.sharing.context();
  readonly selection = signal<ReportLink[]>(
    this.data.report?.links.map((l) => ({ ...l })) ??
      this.data.initial.map((l) => ({ ...l })),
  );
  readonly results = signal<LinkDto[]>([]);
  readonly searching = signal(false);
  readonly searchError = signal("");
  readonly busy = signal(false);
  readonly error = signal("");
  readonly saved = signal<AnalyticsReport | null>(null);
  readonly searchTotal = signal(0);
  readonly sections: { key: ReportSection; title: string; hint: string }[] = [
    { key: "visits", title: "Visitas", hint: "Total registrado en el periodo" },
    {
      key: "series",
      title: "Evolución diaria",
      hint: "Actividad a lo largo del tiempo",
    },
    { key: "countries", title: "Países", hint: "Procedencia aproximada" },
    { key: "devices", title: "Dispositivos", hint: "Móvil, ordenador y otros" },
  ];
  spec: ReportSpec = this.data.report
    ? {
        ...this.data.report.spec,
        sections: [...this.data.report.spec.sections],
      }
    : {
        version: 1,
        title: "",
        description: "",
        period: "30d",
        from: null,
        to: null,
        sections: ["visits", "series", "countries", "devices"],
      };
  expiryEnabled = this.data.report ? this.data.report.expiresAt !== null : true;
  expiry = localDateTimeValue(
    this.data.report?.expiresAt ??
      new Date(Date.now() + 30 * 86400000).toISOString(),
  );
  passwordAction: "keep" | "set" | "remove" = "keep";
  password = "";
  query = "";
  searchPage = 1;
  private timer?: ReturnType<typeof setTimeout>;
  private intent = { body: "", key: crypto.randomUUID() };
  constructor() {
    effect(() => {
      const el = this.successHeading();
      if (this.saved() && el)
        queueMicrotask(() => {
          if (!this.destroy.destroyed) el.nativeElement.focus();
        });
    });
    effect(() => {
      if (this.sharing.context() !== this.context || !this.sharing.canPublish())
        this.ref.close(false);
    });
    this.destroy.onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
      this.password = "";
    });
    void this.search();
  }
  has(id: number): boolean {
    return this.selection().some((l) => l.linkId === id);
  }
  toggle(link: LinkDto): void {
    if (this.has(link.id)) {
      this.remove(link.id);
      return;
    }
    if (this.selection().length >= 100) return;
    this.selection.update((s) => [
      ...s,
      { linkId: link.id, label: link.alias },
    ]);
  }
  remove(id: number): void {
    this.selection.update((s) => s.filter((l) => l.linkId !== id));
  }
  label(id: number, value: string): void {
    this.selection.update((s) =>
      s.map((l) => (l.linkId === id ? { ...l, label: value } : l)),
    );
  }
  section(key: ReportSection, enabled: boolean): void {
    this.spec = {
      ...this.spec,
      sections: enabled
        ? [...this.spec.sections, key]
        : this.spec.sections.filter((s) => s !== key),
    };
  }
  onQuery(value: string): void {
    this.query = value;
    this.searchPage = 1;
    this.searches.invalidate();
    this.results.set([]);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.search(), 180);
  }
  async search(): Promise<void> {
    const req = this.searches.begin(this.context);
    const page = this.searchPage;
    this.searching.set(true);
    this.searchError.set("");
    try {
      const r = await this.sharing.api.get(
        "/api/v1/links",
        { q: this.query, page: String(page), perPage: "20" },
        (v) => decodeLinksResponse(v, { page, perPage: 20 }),
        { signal: req.signal },
      );
      if (this.searches.isCurrent(req, this.sharing.context())) {
        this.results.set(
          r.links.filter((l) => l.state !== "blocked" && l.state !== "deleted"),
        );
        this.searchTotal.set(r.total);
      }
    } catch (e) {
      if (this.searches.isCurrent(req, this.sharing.context()))
        this.searchError.set(
          e instanceof ApiRequestError
            ? e.message
            : "No se pudieron cargar los enlaces.",
        );
    } finally {
      if (this.searches.isCurrent(req, this.sharing.context()))
        this.searching.set(false);
    }
  }
  page(delta: number): void {
    this.searchPage += delta;
    void this.search();
  }
  async save(): Promise<void> {
    if (this.busy() || this.sharing.context() !== this.context) return;
    this.error.set("");
    const original = (this.saved() ?? this.data.report)?.expiresAt;
    const expiresAt = this.expiryEnabled
      ? original && this.expiry === localDateTimeValue(original)
        ? original
        : localDateTimeIso(this.expiry)
      : null;
    if (
      this.expiryEnabled &&
      (!expiresAt || Date.parse(expiresAt) <= Date.now())
    ) {
      this.error.set("Elige una caducidad futura.");
      return;
    }
    if (
      !this.spec.title.trim() ||
      !this.selection().length ||
      !this.spec.sections.length
    ) {
      this.error.set(
        "Completa el título, selecciona enlaces y elige al menos una sección.",
      );
      return;
    }
    const report = this.saved() ?? this.data.report;
    const body = {
      spec: {
        ...this.spec,
        title: this.spec.title.trim(),
        from: this.spec.period === "custom" ? this.spec.from : null,
        to: this.spec.period === "custom" ? this.spec.to : null,
      },
      links: this.selection(),
      expiresAt,
      ...(report ? { version: report.version } : {}),
      ...(this.passwordAction === "set"
        ? { password: this.password }
        : this.passwordAction === "remove"
          ? { password: null }
          : {}),
    };
    const signature = JSON.stringify(body);
    if (this.intent.body !== signature)
      this.intent = { body: signature, key: crypto.randomUUID() };
    this.busy.set(true);
    this.ref.disableClose = true;
    try {
      const result = await this.sharing.save(body, this.intent.key, report);
      if (this.sharing.context() === this.context && !this.destroy.destroyed) {
        this.saved.set(result.report);
        this.password = "";
        this.passwordAction = "keep";
      }
    } catch (e) {
      if (this.sharing.context() === this.context && !this.destroy.destroyed)
        this.error.set(
          e instanceof ApiRequestError
            ? e.message
            : "No se pudo guardar el informe. Puedes reintentar.",
        );
    } finally {
      if (!this.destroy.destroyed) {
        this.busy.set(false);
        this.ref.disableClose = false;
      }
    }
  }
  close(): void {
    if (!this.busy()) this.ref.close(this.saved() !== null);
  }
}
