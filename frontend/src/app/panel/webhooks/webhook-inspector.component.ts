import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import type { WebhookDelivery, WebhookDeliveryPage, WebhookDto } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { decodeWebhookDeliveriesResponse, decodeWebhooksResponse } from "../../core/services/credential-response-decoders";
import { LatestRequest } from "../../core/services/latest-request";
import { WorkspaceService } from "../../core/services/workspace.service";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";

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

  private readonly webhookId = Number(this.route.snapshot.paramMap.get("id"));
  private loadedContext: string | null = null;

  constructor() {
    if (!Number.isSafeInteger(this.webhookId) || this.webhookId < 1) {
      this.error.set("El identificador del webhook no es válido");
      this.loading.set(false);
      return;
    }
    effect(() => {
      const workspaceId = this.workspaces.currentId();
      const role = this.workspaces.currentRole();
      const context = workspaceId === null || role === null ? null : `${workspaceId}:${role}`;
      if (context === this.loadedContext) return;
      this.loadedContext = context;
      this.requests.invalidate();
      this.webhook.set(null);
      this.deliveries.set([]);
      this.total.set(0);
      this.page.set(1);
      this.error.set(null);
      if (context === null) {
        this.loading.set(false);
        return;
      }
      void this.load();
    });
  }

  async load(targetPage = this.page()): Promise<void> {
    const workspaceId = this.workspaces.currentId();
    const role = this.workspaces.currentRole();
    if (workspaceId === null || role === null) return;
    const context = `${workspaceId}:${role}:${targetPage}`;
    const request = this.requests.begin(context);
    this.loading.set(true);
    this.error.set(null);
    try {
      const [webhooksResponse, deliveryPage] = await Promise.all([
        this.api.get<{ webhooks: WebhookDto[] }>("/api/v1/webhooks", undefined, decodeWebhooksResponse),
        this.api.get<WebhookDeliveryPage>(
          `/api/v1/webhooks/${this.webhookId}/deliveries`,
          { page: targetPage, perPage: this.perPage },
          (value) => decodeWebhookDeliveriesResponse(value, { webhookId: this.webhookId, page: targetPage, perPage: this.perPage }),
        ),
      ]);
      if (!this.requests.isCurrent(request, `${this.workspaces.currentId()}:${this.workspaces.currentRole()}:${targetPage}`)) return;
      const webhook = webhooksResponse.webhooks.find((item) => item.id === this.webhookId) ?? null;
      if (!webhook) throw new ApiRequestError("Webhook no encontrado", 404);
      this.webhook.set(webhook);
      this.deliveries.set(deliveryPage.deliveries);
      this.total.set(deliveryPage.total);
      this.page.set(deliveryPage.page);
    } catch (err) {
      if (!this.requests.isCurrent(request, `${this.workspaces.currentId()}:${this.workspaces.currentRole()}:${targetPage}`)) return;
      this.deliveries.set([]);
      this.error.set(err instanceof ApiRequestError && (err.status === 401 || err.status === 403)
        ? "Ya no tienes acceso a este inspector."
        : err instanceof ApiRequestError ? err.message : "No se pudo cargar el inspector");
    } finally {
      if (this.requests.isCurrent(request, `${this.workspaces.currentId()}:${this.workspaces.currentRole()}:${targetPage}`)) this.loading.set(false);
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

  formatDate(value: string | null): string {
    return value ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
  }
}
