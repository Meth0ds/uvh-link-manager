import { Component, computed, DestroyRef, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";

import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatChipsModule } from "@angular/material/chips";
import { MatMenuModule } from "@angular/material/menu";
import { MatDividerModule } from "@angular/material/divider";
import { MatSelectModule } from "@angular/material/select";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { LinkDialogService } from "./link-dialog.service";
import { QrDialogComponent } from "./qr-dialog.component";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";
import { MatDialog } from "@angular/material/dialog";
import { ChartsComponent } from "../analytics/charts.component";
import type { LinkDetailResponse, AnalyticsOverview, AuditEvent, LinkDto, RedirectRule } from "../../core/models";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { LatestRequest } from "../../core/services/latest-request";
import { targetWorkspace } from "../../core/services/workspace-target";
import {
  decodeAnalyticsOverview,
  decodeLinkActivityResponse,
  decodeLinkDetailResponse,
} from "../../core/services/link-response-decoders";
import { linkStateLabel } from "../../core/link-state-label";

@Component({
  selector: "app-link-detail",
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatMenuModule,
    MatDividerModule,
    MatSelectModule,
    MatFormFieldModule,
    MatProgressBarModule,
    MatSnackBarModule,
    ChartsComponent,
    PanelSkeletonComponent,
  ],
  templateUrl: "./link-detail.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./link-detail.component.scss",
})
export class LinkDetailComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snackbar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private workspaces = inject(WorkspaceService);
  private actions = inject(ActionDialogService);
  private linkDialog = inject(LinkDialogService);
  private readonly loadRequests = new LatestRequest(inject(DestroyRef));
  private readonly analyticsRequests = new LatestRequest(inject(DestroyRef));
  private readonly activityRequests = new LatestRequest(inject(DestroyRef));

  readonly link = signal<LinkDto | null>(null);
  readonly rules = signal<RedirectRule[]>([]);
  readonly analytics = signal<AnalyticsOverview | null>(null);
  readonly activity = signal<AuditEvent[]>([]);
  readonly period = signal("30d");
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly actionBusy = signal(false);
  readonly analyticsError = signal<string | null>(null);
  readonly activityError = signal<string | null>(null);
  /** The activity view is bounded server-side; this says whether it was cut. */
  readonly activityTruncated = signal(false);
  readonly canWrite = computed(() => {
    const role = this.workspaces.currentRole();
    return role === "owner" || role === "admin" || role === "editor";
  });

  /**
   * The route's `:id`, kept reactive.
   *
   * Angular reuses this component when only the parameter changes, so an id
   * captured once from the snapshot would keep addressing the link the view was
   * first opened with: it would show one link's data, and act on that link,
   * while the URL names another one.
   */
  private readonly linkId = signal(this.paramId());

  /** `workspace:link` the current view belongs to; null while unresolved. */
  private loadedContext: string | null = null;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => this.linkId.set(this.paramId()));

    effect(() => {
      const workspaceId = this.workspaces.currentId();
      const linkId = this.linkId();
      const context = workspaceId === null ? null : `${workspaceId}:${linkId}`;
      if (context === this.loadedContext) return;
      this.loadedContext = context;
      this.loadRequests.invalidate();
      this.analyticsRequests.invalidate();
      this.activityRequests.invalidate();
      // The route can stay mounted while its workspace authorization changes.
      this.link.set(null);
      this.rules.set([]);
      this.analytics.set(null);
      this.activity.set([]);
      this.error.set(null);
      this.analyticsError.set(null);
      this.activityError.set(null);
      this.activityTruncated.set(false);
      if (!Number.isSafeInteger(linkId) || linkId < 1) {
        this.error.set("El identificador del enlace no es válido");
        this.loading.set(false);
        return;
      }
      if (workspaceId === null) {
        this.loading.set(false);
        return;
      }
      void this.load();
    });
  }

  private paramId(): number {
    return Number(this.route.snapshot.paramMap.get("id"));
  }

  async load(): Promise<void> {
    const workspaceId = this.workspaces.currentId();
    const linkId = this.linkId();
    if (workspaceId === null) {
      this.loadRequests.invalidate();
      this.link.set(null);
      this.rules.set([]);
      this.loading.set(false);
      return;
    }
    const context = `${workspaceId}:${linkId}`;
    const request = this.loadRequests.begin(context);
    this.loading.set(true);
    this.error.set(null);
    try {
      const detail = await this.api.get<LinkDetailResponse>(
        `/api/v1/links/${linkId}`,
        undefined,
        (value) => decodeLinkDetailResponse(value, linkId),
        { signal: request.signal },
      );
      if (!this.loadRequests.isCurrent(request, this.currentContext())) return;
      this.link.set(detail.link);
      this.rules.set(detail.rules);
      await Promise.all([this.loadAnalytics(), this.loadActivity()]);
    } catch (err) {
      if (!this.loadRequests.isCurrent(request, this.currentContext())) return;
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo cargar el enlace");
    } finally {
      if (this.loadRequests.isCurrent(request, this.currentContext())) this.loading.set(false);
    }
  }

  async loadAnalytics(): Promise<void> {
    const workspaceId = this.workspaces.currentId();
    const linkId = this.linkId();
    if (workspaceId === null) {
      this.analyticsRequests.invalidate();
      this.analytics.set(null);
      return;
    }
    const context = `${workspaceId}:${linkId}`;
    const request = this.analyticsRequests.begin(context);
    this.analyticsError.set(null);
    try {
      const a = await this.api.get<AnalyticsOverview>("/api/v1/analytics/overview", {
        linkId,
        period: this.period(),
      }, decodeAnalyticsOverview, { signal: request.signal });
      if (!this.analyticsRequests.isCurrent(request, this.currentContext())) return;
      this.analytics.set(a);
    } catch (err) {
      if (!this.analyticsRequests.isCurrent(request, this.currentContext())) return;
      this.analytics.set(null);
      this.analyticsError.set(err instanceof ApiRequestError ? err.message : "No se pudo cargar la analítica");
    }
  }

  async loadActivity(): Promise<void> {
    const workspaceId = this.workspaces.currentId();
    if (workspaceId === null) {
      this.activityRequests.invalidate();
      this.activity.set([]);
      this.activityTruncated.set(false);
      return;
    }
    const context = `${workspaceId}:${this.linkId()}`;
    const request = this.activityRequests.begin(context);
    this.activityError.set(null);
    try {
      const { events, truncated } = await this.api.get<{ events: AuditEvent[]; truncated: boolean }>(
        `/api/v1/links/${this.linkId()}/activity`,
        undefined,
        decodeLinkActivityResponse,
        { signal: request.signal },
      );
      if (!this.activityRequests.isCurrent(request, this.currentContext())) return;
      this.activity.set(events);
      this.activityTruncated.set(truncated);
    } catch (err) {
      if (!this.activityRequests.isCurrent(request, this.currentContext())) return;
      this.activity.set([]);
      this.activityTruncated.set(false);
      this.activityError.set(err instanceof ApiRequestError ? err.message : "No se pudo cargar la actividad");
    }
  }

  /** The identity a request must still match to be applied to this view. */
  private currentContext(): string | null {
    const workspaceId = this.workspaces.currentId();
    return workspaceId === null ? null : `${workspaceId}:${this.linkId()}`;
  }

  retryAnalytics(): void {
    void this.loadAnalytics();
  }

  retryActivity(): void {
    void this.loadActivity();
  }

  async onPeriod(value: string): Promise<void> {
    this.period.set(value);
    await this.loadAnalytics();
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

  showQr(): void {
    const l = this.link();
    if (l) this.dialog.open(QrDialogComponent, { data: l.shortUrl });
  }

  edit(): void {
    const l = this.link();
    if (!l || !this.canWrite()) return;
    this.linkDialog.openEdit(l).subscribe((updated) => {
      if (updated) void this.load();
    });
  }

  async setState(state: "active" | "paused" | "archived"): Promise<void> {
    if (!this.canWrite() || this.actionBusy()) return;
    // The state transition names a link of one workspace; its id means nothing
    // in another one.
    const target = targetWorkspace(this.workspaces);
    if (target.workspaceId === null) return;
    this.actionBusy.set(true);
    try {
      await this.api.post(`/api/v1/links/${this.linkId()}/state`, { state });
      if (!target.isCurrent()) return;
      this.snackbar.open("Estado actualizado", "Cerrar", { duration: 2000 });
      void this.load();
    } catch (err) {
      if (!target.isCurrent()) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 3000 });
    } finally {
      if (target.isCurrent()) this.actionBusy.set(false);
    }
  }

  async remove(): Promise<void> {
    const l = this.link();
    if (!l || !this.canWrite()) return;
    // The dialog names a link from one workspace. Never apply its answer to a
    // newer selection, or the delete would land on another tenant's row.
    const target = targetWorkspace(this.workspaces);
    const confirmed = await this.actions.confirm({
      title: "Eliminar enlace",
      message: `¿Quieres eliminar ${l.shortUrl}? Dejará de estar disponible de inmediato.`,
      confirmLabel: "Eliminar enlace",
      destructive: true,
    });
    if (!confirmed || this.actionBusy() || !target.isCurrent()) return;
    this.actionBusy.set(true);
    try {
      await this.api.delete(`/api/v1/links/${this.linkId()}`);
      this.snackbar.open("Enlace eliminado", "Cerrar", { duration: 2000 });
      await this.router.navigate(["/app/links"]);
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 3000 });
    } finally {
      this.actionBusy.set(false);
    }
  }

  ruleSummary(rule: RedirectRule): string {
    const parts: string[] = [];
    const raw = rule as RedirectRule & { time_from?: string | null; time_to?: string | null };
    const timeFrom = rule.timeFrom ?? raw.time_from;
    const timeTo = rule.timeTo ?? raw.time_to;
    if (rule.country) parts.push(`País: ${rule.country.toUpperCase()}`);
    if (rule.language) parts.push(`Idioma: ${rule.language}`);
    if (rule.device) parts.push(`Dispositivo: ${rule.device}`);
    if (rule.os) parts.push(`SO: ${rule.os}`);
    if (timeFrom || timeTo) parts.push(`Horario: ${timeFrom ?? "00:00"}–${timeTo ?? "23:59"} UTC`);
    if (rule.referrer) parts.push(`Referente: ${rule.referrer}`);
    if (rule.campaign) parts.push(`Campaña: ${rule.campaign}`);
    return parts.length ? parts.join(" · ") : "Sin condición";
  }

  actionLabel(action: string): string {
    const map: Record<string, string> = {
      "link.create": "Creación",
      "link.update": "Edición",
      "link.state_change": "Cambio de estado",
      "link.delete": "Eliminación",
      "link.restore": "Restauración",
    };
    return map[action] ?? action;
  }

  /** Short URL without the scheme, for display. */
  displayUrl(url: string): string {
    return url.replace(/^https?:\/\//, "");
  }

  readonly stateLabel = linkStateLabel;
}
