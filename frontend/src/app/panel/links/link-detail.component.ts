import { UI_TEXT } from "../../core/localisation/template-messages";
import { SharingService } from "../../core/services/sharing.service";
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
import { QrCampaignPanelComponent } from "./qr-campaign-panel.component";
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
import { DestinationInspectionComponent } from "./destination-inspection.component";
import { LinkWorkflowService } from "../../core/services/link-workflow.service";
import { LinkFavoriteService } from "../../core/services/link-favorite.service";
import { linkStateLabel } from "../../core/link-state-label";
import { linkAppealStatusLabel } from "../../core/link-appeal-status";
import { utcTimeToLocalTime } from "../../core/strict-wire";

@Component({
  selector: "app-link-detail",
  standalone: true,
  providers: [CopyFeedbackService],
  imports: [QrCampaignPanelComponent, DestinationInspectionComponent,
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
  readonly uiText = UI_TEXT;
  readonly sharing = inject(SharingService);
  async editSocialCard(): Promise<void> {
    const link=this.link(); const context=this.sharing.context(); if (!link || !this.canWrite()) return;
    const {SocialPreviewDialogComponent}=await import("./social-preview-dialog.component");
    if (context!==this.sharing.context() || this.dialogOwner.destroyed) return;
    this.dialog.open(SocialPreviewDialogComponent,{data:link,width:"820px",maxWidth:"calc(100vw - 24px)",maxHeight:"calc(100dvh - 24px)"}).afterClosed().subscribe(updated=>{if(updated&&context===this.sharing.context()&&!this.dialogOwner.destroyed)void this.load();});
  }
  shareReport(): void { const link = this.link(); if (link) void this.sharing.open([{linkId:link.id,label:link.alias}]); }
  private api = inject(ApiService);
  readonly workflows = inject(LinkWorkflowService);
  readonly favorites = inject(LinkFavoriteService);
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
  readonly ruleTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

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
  private readonly requestedWorkspace = signal<string | null>(this.route.snapshot.queryParamMap?.get("workspaceId") ?? null);
  private readonly routeWorkspaceError = signal<string | null>(null);

  /** Security context and route revision the current view belongs to. */
  private loadedContext: string | null | undefined;

  constructor() {
    effect(() => { const message = this.favorites.error(); if (message) this.snackbar.open(message, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 4000 }); });
    this.dialogOwner.onDestroy(() => this.mutations.reset());
    this.route.queryParamMap?.pipe(takeUntilDestroyed()).subscribe(params => {
      this.requestedWorkspace.set(params.get("workspaceId"));
      this.routeWorkspaceError.set(null);
      this.copyRouteRevision.update(revision => revision + 1);
    });
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => {
      this.copyRouteRevision.update(revision => revision + 1);
      this.linkId.set(this.paramId());
    });

    effect(() => {
      this.resolveRequestedWorkspace();
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
      this.error.set(this.routeWorkspaceError());
      this.analyticsError.set(null);
      this.activityError.set(null);
      this.activityTruncated.set(false);
      if (linkId === null) {
        this.error.set($localize`:@@ui.bd0ef95f565dd3:El identificador del enlace no es válido`);
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

  private resolveRequestedWorkspace(): void {
    const raw = this.requestedWorkspace();
    if (raw === null || !this.auth.user()) return;
    const id = parseRouteId(raw);
    // Route parameters only suggest a selection. The authenticated membership
    // list is authoritative; never send an arbitrary workspace header.
    const member = id !== null && this.workspaces.list().some(workspace => workspace.id === id);
    this.requestedWorkspace.set(null);
    if (!member) {
      this.routeWorkspaceError.set($localize`:@@ui.9ca6f28a2bb86f:No tienes acceso al espacio de este aviso.`);
      return;
    }
    this.routeWorkspaceError.set(null);
    this.workspaces.select(id);
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
      this.error.set(err instanceof ApiRequestError ? err.message : $localize`:@@ui.c2c57ce995bba7:No se pudo cargar el enlace`);
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
      this.analyticsError.set(err instanceof ApiRequestError ? err.message : $localize`:@@ui.7cc975a589d8e1:No se pudo cargar la analítica`);
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
      this.activityError.set(err instanceof ApiRequestError ? err.message : $localize`:@@ui.bc6d36ee4fff5c:No se pudo cargar la actividad`);
    }
  }

  /** The identity a request must still match to be applied to this view. */
  private currentContext(): string | null {
    const actorId = this.auth.user()?.id;
    const workspaceId = this.workspaces.currentId();
    if (actorId === undefined || workspaceId === null || this.requestedWorkspace() !== null || this.routeWorkspaceError() !== null) return null;
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
    if (l) this.dialog.open(QrDialogComponent, { data: { url: l.shareUrl ?? l.shortUrl, linkId: l.id }, width: "760px", maxWidth: "calc(100vw - 32px)" });
  }

  openRuleSimulator(): void {
    const link = this.link();
    if (!link || this.dialogOwner.destroyed || !this.workflows.ruleSimulatorEnabled()) return;
    void import("./rule-simulator-dialog.component").then(({ RuleSimulatorDialogComponent }) => {
      if (this.dialogOwner.destroyed || this.link()?.id !== link.id) return;
      this.dialog.open(RuleSimulatorDialogComponent, {
        data: { appOpeningConfigured: !!link.appOpening, linkId: link.id, destination: link.destination, fallbackDestination: link.fallbackDestination, utm: link.utm, rules: this.rules() },
        width: "680px", maxWidth: "calc(100vw - 24px)", autoFocus: "first-tabbable",
      });
    });
  }

  openHistory(): void {
    const link = this.link();
    if (!link || this.dialogOwner.destroyed || !this.workflows.linkHistoryEnabled()) return;
    void import("./link-history-dialog.component").then(({ LinkHistoryDialogComponent }) => {
      if (this.dialogOwner.destroyed || this.link()?.id !== link.id) return;
      this.dialog.open(LinkHistoryDialogComponent, {
        data: { linkId: link.id, expectedVersion: link.version, canRestore: this.canWrite() && this.workflows.linkHistoryRestoreEnabled() },
        width: "900px", maxWidth: "calc(100vw - 24px)", autoFocus: "first-tabbable",
      }).afterClosed().subscribe((restored: boolean | undefined) => { if (restored && this.link()?.id === link.id) void this.load(); });
    });
  }

  edit(): void {
    const l = this.link();
    const target = this.targetLink();
    if (!l || !target) return;
    this.linkDialog.openEdit(l, this.dialogOwner).subscribe((updated) => {
      if (updated && target.isCurrent()) void this.load();
    });
  }

  duplicate(): void {
    const link = this.link(), target = this.targetLink();
    if (!link || !target || !this.workflows.enabled() || link.state === "blocked") return;
    this.linkDialog.openDuplicate(link, this.dialogOwner).subscribe(created => { if (created && target.isCurrent()) void this.router.navigate(["/app/links", created.id]); });
  }

  async setState(state: "active" | "paused" | "archived"): Promise<void> {
    if (!this.canWrite() || this.actionBusy()) return;
    const target = this.targetLink();
    if (!target) return;
    const action = this.mutations.begin(0);
    try {
      await this.api.post(`/api/v1/links/${target.linkId}/state`, { state });
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open($localize`:@@ui.64c6aa1a673969:Estado actualizado`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 2000 });
      void this.load();
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 3000 });
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
      title: $localize`:@@ui.ad730f5de914c2:Eliminar enlace`,
      message: $localize`:@@ui.481be642af23f8:¿Quieres eliminar ${l.shortUrl}? Dejará de estar disponible de inmediato.`,
      confirmLabel: $localize`:@@ui.ad730f5de914c2:Eliminar enlace`,
      destructive: true,
    });
    if (!confirmed || this.actionBusy() || !target.isCurrent()) return;
    const action = this.mutations.begin(0);
    try {
      await this.api.delete(`/api/v1/links/${target.linkId}`);
      // Quién publica el resultado es la operación que lo consiguió: una
      // operación vieja que llega tarde no navega fuera de la pantalla nueva.
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open($localize`:@@ui.603361fe8b670b:Enlace eliminado`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 2000 });
      await this.router.navigate(["/app/links"]);
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 3000 });
    } finally {
      this.mutations.settle(action);
    }
  }

  ruleSummary(rule: RedirectRule): string {
    const parts: string[] = [];
    const raw = rule as RedirectRule & { time_from?: string | null; time_to?: string | null };
    const timeFrom = rule.timeFrom ?? raw.time_from;
    const timeTo = rule.timeTo ?? raw.time_to;
    if (rule.country) parts.push($localize`:@@ui.b73b64f549dfbc:País: ${rule.country.toUpperCase()}`);
    if (rule.language) parts.push($localize`:@@ui.7c8d54d2c9000e:Idioma: ${rule.language}`);
    if (rule.device) parts.push(`Dispositivo: ${rule.device}`);
    if (rule.os) parts.push(`SO: ${rule.os}`);
    if (timeFrom || timeTo) {
      const localFrom = timeFrom ? utcTimeToLocalTime(timeFrom, this.ruleTimezone) ?? timeFrom : "00:00";
      const localTo = timeTo ? utcTimeToLocalTime(timeTo, this.ruleTimezone) ?? timeTo : "23:59";
      parts.push(`Horario: ${localFrom}–${localTo} ${this.ruleTimezone} (${timeFrom ?? "00:00"}–${timeTo ?? "23:59"} UTC)`);
    }
    if (rule.referrer) parts.push(`Referente: ${rule.referrer}`);
    if (rule.campaign) parts.push($localize`:@@ui.f31b3bce9a3998:Campaña: ${rule.campaign}`);
    return parts.length ? parts.join(" · ") : $localize`:@@ui.48425f98d74f26:Sin condición`;
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
      title: $localize`:@@ui.d8117d0aba2e11:Solicitar revisión del bloqueo`,
      message: $localize`:@@ui.70ed269b7b9295:Cuenta por qué crees que el bloqueo es un error. La revisión la resuelve la administración de la plataforma.`,
      confirmLabel: $localize`:@@ui.c9bb5c644aeb6e:Enviar solicitud`,
      inputLabel: $localize`:@@ui.bdd67fb232e8fa:Comentario (opcional)`,
      inputPlaceholder: $localize`:@@ui.65014c888e7694:Contexto que ayude a revisar el caso…`,
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
      this.snackbar.open($localize`:@@ui.9c03379ed2e3c9:Solicitud enviada. La revisión la resuelve la administración.`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 3500 });
      await this.load();
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : $localize`:@@ui.08b9f1d29ed1fb:No se pudo enviar la solicitud`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 4000 });
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
      "link.create": $localize`:@@ui.478a1f7d03d22b:Creación`,
      "link.duplicate": $localize`:@@ui.ef2f1e5dc70764:Duplicación`,
      "link.update": $localize`:@@ui.f162950691763a:Edición`,
      "link.state_change": $localize`:@@ui.a99d4d45d84189:Cambio de estado`,
      "link.delete": $localize`:@@ui.5a7b37de471971:Eliminación`,
      "link.restore": $localize`:@@ui.1c1b505bfe1665:Restauración`,
      "link.appeal": $localize`:@@ui.99d992452bef56:Revisión solicitada`,
      "admin.link_block": $localize`:@@ui.e27c7727003d88:Bloqueo de la plataforma`,
      "admin.link_unblock": $localize`:@@ui.932fed461ca49f:Bloqueo retirado`,
      "admin.link_appeal_resolved": $localize`:@@ui.d1cf6b6c8a3b13:Respuesta a la revisión`,
      "admin.report_moderate": $localize`:@@ui.ce47e0a34f57c0:Moderación de denuncia`,
      "system.link_block": $localize`:@@ui.f1588ab3631fb4:Bloqueo automático`,
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
