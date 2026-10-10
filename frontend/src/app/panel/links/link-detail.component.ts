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
import { AuthService } from "../../core/services/auth.service";
import { LinkDialogService } from "./link-dialog.service";
import { QrDialogComponent } from "./qr-dialog.component";
import { WorkspaceService } from "../../core/services/workspace.service";
import { parseRouteId } from "../../core/strict-wire";
import { ActionDialogService } from "../action-dialog.service";
import { MatDialog } from "@angular/material/dialog";
import { ChartsComponent } from "../analytics/charts.component";
import type { LinkDetailResponse, AnalyticsOverview, AuditEvent, LinkAppeal, LinkDto, RedirectRule } from "../../core/models";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { LatestRequest } from "../../core/services/latest-request";
import { OwnedMutations } from "../../core/services/owned-mutations";
import {
  decodeAnalyticsOverview,
  decodeLinkActivityResponse,
  decodeLinkDetailResponse,
} from "../../core/services/link-response-decoders";
import { CopyFeedbackService } from "../../core/services/copy-feedback.service";
import { CopyFeedbackIconComponent } from "../copy-feedback-icon.component";
import { linkStateLabel } from "../../core/link-state-label";
import { linkAppealStatusLabel } from "../../core/link-appeal-status";

@Component({
  selector: "app-link-detail",
  standalone: true,
  providers: [CopyFeedbackService],
  imports: [
    CopyFeedbackIconComponent,
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
  private readonly auth = inject(AuthService);
  private readonly dialogOwner = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snackbar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private workspaces = inject(WorkspaceService);
  readonly copyFeedback = inject(CopyFeedbackService);
  readonly copyScope = () => `${this.workspaces.currentId()}:${this.workspaces.selectionGeneration()}:${this.copyRouteRevision()}:${this.linkId()}:${this.link()?.shortUrl ?? ""}`;
  private actions = inject(ActionDialogService);
  private linkDialog = inject(LinkDialogService);
  private readonly loadRequests = new LatestRequest(inject(DestroyRef));
  private readonly analyticsRequests = new LatestRequest(inject(DestroyRef));
  private readonly activityRequests = new LatestRequest(inject(DestroyRef));

  readonly link = signal<LinkDto | null>(null);
  readonly rules = signal<RedirectRule[]>([]);
  readonly appeal = signal<LinkAppeal | null>(null);
  /**
   * Why the platform is refusing the link, answered by the API.
   *
   * The reason lives in the decision that produced the block, which is the
   * backend's to read: this view prints what it is given, and says the block
   * without a cause when there is none to print.
   */
  readonly blockReason = signal<string | null>(null);
  readonly analytics = signal<AnalyticsOverview | null>(null);
  readonly activity = signal<AuditEvent[]>([]);
  readonly period = signal("30d");
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  /** La única mutación en vuelo y su dueño; ver `OwnedMutations`. */
  private readonly mutations = new OwnedMutations();
  readonly actionBusy = this.mutations.busy;
  readonly analyticsError = signal<string | null>(null);
  readonly activityError = signal<string | null>(null);
  /** The activity view is bounded server-side; this says whether it was cut. */
  readonly activityTruncated = signal(false);
  readonly canWrite = computed(() => {
    const role = this.workspaces.currentRole();
    return role === "owner" || role === "admin" || role === "editor";
  });

  /**
   * Whether the notice may offer to contest the block.
   *
   * The API accepts one *open* appeal per link, so a decided one does not forbid
   * the next: hiding the action after a verdict would leave an upheld block with
   * no way back in, which is the dead end this notice exists to remove.
   */
  readonly canRequestReview = computed(() => this.canWrite() && this.appeal()?.status !== "open");

  /**
   * The route's `:id`, kept reactive.
   *
   * Angular reuses this component when only the parameter changes, so an id
   * captured once from the snapshot would keep addressing the link the view was
   * first opened with: it would show one link's data, and act on that link,
   * while the URL names another one.
   */
  private readonly linkId = signal(this.paramId());
  private readonly copyRouteRevision = signal(0);

  /** Security context and route revision the current view belongs to. */
  private loadedContext: string | null | undefined;

  constructor() {
    this.dialogOwner.onDestroy(() => this.mutations.reset());
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => {
      this.copyRouteRevision.update(revision => revision + 1);
      this.linkId.set(this.paramId());
    });

    effect(() => {
      const linkId = this.linkId();
      const context = this.currentContext();
      if (context === this.loadedContext) return;
      this.loadedContext = context;
      this.loadRequests.invalidate();
      this.analyticsRequests.invalidate();
      this.activityRequests.invalidate();
      // An action still in flight belongs to the context that left the screen;
      // its guarded `finally` will not clear the flag here, so the new context
      // starts unblocked instead of inheriting a stuck busy state.
      this.mutations.reset();
      // The route can stay mounted while its workspace authorization changes.
      this.link.set(null);
      this.rules.set([]);
      this.appeal.set(null);
      this.blockReason.set(null);
      this.analytics.set(null);
      this.activity.set([]);
      this.error.set(null);
      this.analyticsError.set(null);
      this.activityError.set(null);
      this.activityTruncated.set(false);
      if (linkId === null) {
        this.error.set("El identificador del enlace no es válido");
        this.loading.set(false);
        return;
      }
      if (context === null) {
        this.loading.set(false);
        return;
      }
      void this.load();
    });
  }

  private paramId(): number | null {
    return parseRouteId(this.route.snapshot.paramMap.get("id"));
  }

  async load(): Promise<void> {
    const context = this.currentContext();
    const linkId = this.linkId();
    if (context === null || linkId === null) {
      this.loadRequests.invalidate();
      this.link.set(null);
      this.rules.set([]);
      this.appeal.set(null);
      this.blockReason.set(null);
      this.loading.set(false);
      return;
    }
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
      this.appeal.set(detail.appeal);
      this.blockReason.set(detail.blockReason);
      await Promise.all([this.loadAnalytics(), this.loadActivity()]);
    } catch (err) {
      if (!this.loadRequests.isCurrent(request, this.currentContext())) return;
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo cargar el enlace");
    } finally {
      if (this.loadRequests.isCurrent(request, this.currentContext())) this.loading.set(false);
    }
  }

  async loadAnalytics(): Promise<void> {
    const context = this.currentContext();
    const linkId = this.linkId();
    if (context === null || linkId === null) {
      this.analyticsRequests.invalidate();
      this.analytics.set(null);
      this.analyticsError.set(null);
      return;
    }
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
    const context = this.currentContext();
    const linkId = this.linkId();
    if (context === null || linkId === null) {
      this.activityRequests.invalidate();
      this.activity.set([]);
      this.activityError.set(null);
      this.activityTruncated.set(false);
      return;
    }
    const request = this.activityRequests.begin(context);
    this.activityError.set(null);
    try {
      const { events, truncated } = await this.api.get<{ events: AuditEvent[]; truncated: boolean }>(
        `/api/v1/links/${linkId}/activity`,
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
    const actorId = this.auth.user()?.id;
    const workspaceId = this.workspaces.currentId();
    if (actorId === undefined || workspaceId === null) return null;
    return JSON.stringify([actorId, this.auth.sessionGeneration(), workspaceId,
      this.workspaces.selectionGeneration(), this.workspaces.currentRole(), this.copyRouteRevision(), this.linkId()]);
  }

  /** A decision names the shown link and the exact context that asked for it. */
  private decisionContext(): string {
    return JSON.stringify([this.currentContext(), this.link()?.shortUrl]);
  }

  private targetLink(): { linkId: number; isCurrent(): boolean } | null {
    const link = this.link();
    const context = this.currentContext();
    if (!link || !this.auth.user() || context === null || link.id !== this.linkId()
      || this.loadedContext !== context || !this.canWrite() || this.dialogOwner.destroyed) return null;
    const linkId = link.id;
    const decision = this.decisionContext();
    return {
      linkId,
      isCurrent: () => !this.dialogOwner.destroyed && decision === this.decisionContext()
        && this.linkId() === linkId && this.link()?.id === linkId && this.canWrite(),
    };
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

  copy(url: string): void { this.copyFeedback.copy(url, this.copyScope); }

  showQr(): void {
    const l = this.link();
    if (l) this.dialog.open(QrDialogComponent, { data: l.shortUrl, width: "760px", maxWidth: "calc(100vw - 32px)" });
  }

  edit(): void {
    const l = this.link();
    const target = this.targetLink();
    if (!l || !target) return;
    this.linkDialog.openEdit(l, this.dialogOwner).subscribe((updated) => {
      if (updated && target.isCurrent()) void this.load();
    });
  }

  async setState(state: "active" | "paused" | "archived"): Promise<void> {
    if (!this.canWrite() || this.actionBusy()) return;
    const target = this.targetLink();
    if (!target) return;
    const action = this.mutations.begin(0);
    try {
      await this.api.post(`/api/v1/links/${target.linkId}/state`, { state });
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open("Estado actualizado", "Cerrar", { duration: 2000 });
      void this.load();
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 3000 });
    } finally {
      this.mutations.settle(action);
    }
  }

  async remove(): Promise<void> {
    const l = this.link();
    if (!l || !this.canWrite()) return;
    const target = this.targetLink();
    if (!target) return;
    const confirmed = await this.actions.confirm({
      title: "Eliminar enlace",
      message: `¿Quieres eliminar ${l.shortUrl}? Dejará de estar disponible de inmediato.`,
      confirmLabel: "Eliminar enlace",
      destructive: true,
    });
    if (!confirmed || this.actionBusy() || !target.isCurrent()) return;
    const action = this.mutations.begin(0);
    try {
      await this.api.delete(`/api/v1/links/${target.linkId}`);
      // Quién publica el resultado es la operación que lo consiguió: una
      // operación vieja que llega tarde no navega fuera de la pantalla nueva.
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open("Enlace eliminado", "Cerrar", { duration: 2000 });
      await this.router.navigate(["/app/links"]);
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 3000 });
    } finally {
      this.mutations.settle(action);
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

  /**
   * Ask the platform to review the block.
   *
   * The API accepts one open request per link and refuses anything but a
   * blocked link, so the view re-reads after answering: a 409 means this screen
   * is behind, and the newest state is the server's.
   */
  async requestReview(): Promise<void> {
    if (!this.canWrite() || this.actionBusy()) return;
    const target = this.targetLink();
    if (!target) return;
    const message = await this.actions.prompt({
      title: "Solicitar revisión del bloqueo",
      message: "Cuenta por qué crees que el bloqueo es un error. La revisión la resuelve la administración de la plataforma.",
      confirmLabel: "Enviar solicitud",
      inputLabel: "Comentario (opcional)",
      inputPlaceholder: "Contexto que ayude a revisar el caso…",
      inputHint: "Hasta 2000 caracteres.",
      inputRequired: false,
      inputMaxLength: 2000,
    });
    // `null` is a cancelled dialog; an empty string is a request without a comment.
    if (message === null || !target.isCurrent() || this.actionBusy()) return;
    const action = this.mutations.begin(0);
    try {
      await this.api.post(`/api/v1/links/${target.linkId}/appeal`, { message: message.trim() });
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open("Solicitud enviada. La revisión la resuelve la administración.", "Cerrar", { duration: 3500 });
      await this.load();
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo enviar la solicitud", "Cerrar", { duration: 4000 });
      await this.load();
    } finally {
      this.mutations.settle(action);
    }
  }

  /** The date that matters for the appeal's status: when it was asked, or decided. */
  appealDate(appeal: LinkAppeal): string | null {
    const at = appeal.status === "open" ? appeal.createdAt : appeal.decidedAt ?? appeal.createdAt;
    return at === null ? null : at.slice(0, 10);
  }

  actionLabel(action: string): string {
    const map: Record<string, string> = {
      "link.create": "Creación",
      "link.update": "Edición",
      "link.state_change": "Cambio de estado",
      "link.delete": "Eliminación",
      "link.restore": "Restauración",
      "link.appeal": "Revisión solicitada",
      "admin.link_block": "Bloqueo de la plataforma",
      "admin.link_unblock": "Bloqueo retirado",
      "admin.link_appeal_resolved": "Respuesta a la revisión",
      "admin.report_moderate": "Moderación de denuncia",
      "system.link_block": "Bloqueo automático",
    };
    return map[action] ?? action;
  }

  /** Short URL without the scheme, for display. */
  displayUrl(url: string): string {
    return url.replace(/^https?:\/\//, "");
  }

  readonly stateLabel = linkStateLabel;
  readonly appealStatusLabel = linkAppealStatusLabel;
}
