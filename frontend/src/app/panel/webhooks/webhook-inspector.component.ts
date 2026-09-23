import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { dateTimeMediumLabel } from "../../core/date-time-label";
import type { WebhookDelivery, WebhookDeliveryPage, WebhookDto } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { decodeWebhookDeliveriesResponse, decodeWebhooksResponse } from "../../core/services/credential-response-decoders";
import { LatestRequest } from "../../core/services/latest-request";
import { WorkspaceService } from "../../core/services/workspace.service";
import { parseRouteId } from "../../core/strict-wire";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { webhookDeliveryIcon, webhookDeliveryLabel, webhookStateLabel } from "../../core/webhook-label";

@Component({
  selector: "app-webhook-inspector",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, MatSnackBarModule, PageHeaderComponent, PanelSkeletonComponent],
  templateUrl: "./webhook-inspector.component.html",
  styleUrl: "./webhook-inspector.component.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class WebhookInspectorComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly workspaces = inject(WorkspaceService);
  private readonly snackbar = inject(MatSnackBar);
  private readonly requests = new LatestRequest(inject(DestroyRef));

  readonly webhook = signal<WebhookDto | null>(null);
  readonly deliveries = signal<WebhookDelivery[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly perPage = 20;
  readonly loading = signal(true);
  readonly actionId = signal<number | null>(null);
  readonly error = signal<string | null>(null);
  readonly canEdit = computed(() => {
    const role = this.workspaces.currentRole();
    return role === "owner" || role === "admin" || role === "editor";
  });
  readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.perPage)));

  /**
   * The route's `:id`, kept reactive.
   *
   * Angular reuses this component when only the parameter changes, so an id
   * captured once from the snapshot would keep showing — and re-sending — the
   * deliveries of the webhook the view was first opened with, while the URL
   * names another one.
   */
  private readonly webhookId = signal(this.paramId());
  private loadedContext: string | null = null;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => this.webhookId.set(this.paramId()));

    effect(() => {
      const workspaceId = this.workspaces.currentId();
      const role = this.workspaces.currentRole();
      const webhookId = this.webhookId();
      const context = workspaceId === null || role === null ? null : `${workspaceId}:${role}:${webhookId}`;
      if (context === this.loadedContext) return;
      this.loadedContext = context;
      this.requests.invalidate();
      this.webhook.set(null);
      this.deliveries.set([]);
      this.total.set(0);
      this.page.set(1);
      this.error.set(null);
      if (webhookId === null) {
        this.error.set("El identificador del webhook no es válido");
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

  /** The identity a request must still match to be applied to this view. */
  private currentContext(targetPage: number): string | null {
    const workspaceId = this.workspaces.currentId();
    const role = this.workspaces.currentRole();
    return workspaceId === null || role === null
      ? null
      : `${workspaceId}:${role}:${this.webhookId()}:${targetPage}`;
  }

  async load(targetPage = this.page()): Promise<void> {
    const workspaceId = this.workspaces.currentId();
    const role = this.workspaces.currentRole();
    const webhookId = this.webhookId();
    if (workspaceId === null || role === null || webhookId === null) return;
    const request = this.requests.begin(`${workspaceId}:${role}:${webhookId}:${targetPage}`);
    this.loading.set(true);
    this.error.set(null);
    try {
      const [webhooksResponse, deliveryPage] = await Promise.all([
        this.api.get<{ webhooks: WebhookDto[] }>("/api/v1/webhooks", undefined, decodeWebhooksResponse, { signal: request.signal }),
        this.api.get<WebhookDeliveryPage>(
          `/api/v1/webhooks/${webhookId}/deliveries`,
          { page: targetPage, perPage: this.perPage },
          (value) => decodeWebhookDeliveriesResponse(value, { webhookId, page: targetPage, perPage: this.perPage }),
          { signal: request.signal },
        ),
      ]);
      if (!this.requests.isCurrent(request, this.currentContext(targetPage))) return;
      const webhook = webhooksResponse.webhooks.find((item) => item.id === webhookId) ?? null;
      if (!webhook) throw new ApiRequestError("Webhook no encontrado", 404);
      this.webhook.set(webhook);
      this.deliveries.set(deliveryPage.deliveries);
      this.total.set(deliveryPage.total);
      this.page.set(deliveryPage.page);
    } catch (err) {
      if (!this.requests.isCurrent(request, this.currentContext(targetPage))) return;
      // A failed read is not an empty history, and it is not a disappearance
      // either: drop the delivery rows and the count, but keep the last known
      // endpoint so the page still says which webhook failed. Every action on
      // that card is disabled while an error is shown, so stale metadata can
      // never be acted upon.
      this.deliveries.set([]);
      this.total.set(0);
      this.error.set(err instanceof ApiRequestError && (err.status === 401 || err.status === 403)
        ? "Ya no tienes acceso a este inspector."
        : err instanceof ApiRequestError ? err.message : "No se pudo cargar el inspector");
    } finally {
      if (this.requests.isCurrent(request, this.currentContext(targetPage))) this.loading.set(false);
    }
  }

  async sendTest(): Promise<void> {
    const webhook = this.webhook();
    if (!webhook || !webhook.active || !this.canEdit() || this.actionId() !== null) return;
    this.actionId.set(0);
    try {
      await this.api.post(`/api/v1/webhooks/${webhook.id}/test`);
      this.snackbar.open("Ping admitido en la cola", "Cerrar", { duration: 3000 });
      await this.load(1);
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo enviar la prueba", "Cerrar", { duration: 5000 });
    } finally {
      this.actionId.set(null);
    }
  }

  async resend(delivery: WebhookDelivery): Promise<void> {
    const webhook = this.webhook();
    if (!webhook || !this.canEdit() || this.actionId() !== null || delivery.status === "processing" || delivery.status === "success") return;
    this.actionId.set(delivery.id);
    try {
      await this.api.post(`/api/v1/webhooks/${webhook.id}/deliveries/${delivery.id}/resend`);
      this.snackbar.open("Entrega pendiente en la cola", "Cerrar", { duration: 3000 });
      await this.load(this.page());
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo programar el reenvío", "Cerrar", { duration: 5000 });
    } finally {
      this.actionId.set(null);
    }
  }

  payload(delivery: WebhookDelivery): string {
    return JSON.stringify(delivery.payloadPreview, null, 2);
  }

  // Translate only presentation labels; queue states and action guards retain
  // their server meaning. A queued event is not a confirmed delivery. The wording
  // and the icons are the entity's own, shared with the webhook list.
  readonly stateLabel = webhookStateLabel;
  readonly deliveryLabel = webhookDeliveryLabel;
  readonly deliveryIcon = webhookDeliveryIcon;

  formatDate(value: string | null): string {
    return dateTimeMediumLabel(value);
  }
}
