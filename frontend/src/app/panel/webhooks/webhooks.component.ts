import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { MatExpansionModule } from "@angular/material/expansion";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import type { WebhookDto, WebhookDelivery } from "../../core/models";

const EVENTS = [
  "link.created",
  "link.updated",
  "link.deleted",
  "link.threshold_reached",
  "domain.verified",
] as const;

@Component({
  selector: "app-webhooks",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatCheckboxModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatExpansionModule,
  ],
  templateUrl: "./webhooks.component.html",
  styleUrl: "./webhooks.component.scss",
})
export class WebhooksComponent {
  private api = inject(ApiService);
  private snackbar = inject(MatSnackBar);

  readonly webhooks = signal<WebhookDto[]>([]);
  readonly deliveries = signal<Record<number, WebhookDelivery[]>>({});
  readonly loading = signal(true);
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);

  readonly showForm = signal(false);
  readonly editId = signal<number | null>(null);
  readonly url = signal("");
  readonly secret = signal("");
  readonly selectedEvents = signal<string[]>([]);
  readonly eventOptions = EVENTS;
  readonly saving = signal(false);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const { webhooks } = await this.api.get<{ webhooks: WebhookDto[] }>("/api/v1/webhooks");
      this.webhooks.set(webhooks);
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar los webhooks");
    } finally {
      this.loading.set(false);
    }
  }

  toggleEvent(e: string): void {
    this.selectedEvents.update((list) => (list.includes(e) ? list.filter((x) => x !== e) : [...list, e]));
  }

  resetForm(): void {
    this.showForm.set(false);
    this.editId.set(null);
    this.url.set("");
    this.secret.set("");
    this.selectedEvents.set([]);
  }

  startCreate(): void {
    this.resetForm();
    this.showForm.set(true);
  }

  startEdit(w: WebhookDto): void {
    this.showForm.set(true);
    this.editId.set(w.id);
    this.url.set(w.url);
    this.secret.set("");
    this.selectedEvents.set(w.events);
  }

  async save(): Promise<void> {
    if (!this.url().trim() || !this.selectedEvents().length || this.saving()) return;
    this.saving.set(true);
    const payload = {
      url: this.url().trim(),
      events: this.selectedEvents(),
      secret: this.secret() || undefined,
    };
    try {
      if (this.editId()) {
        await this.api.patch(`/api/v1/webhooks/${this.editId()}`, payload);
        this.snackbar.open("Webhook actualizado", "Cerrar", { duration: 2500 });
      } else {
        const { webhook, secret } = await this.api.post<{ webhook: WebhookDto; secret: string }>("/api/v1/webhooks", payload);
        this.webhooks.update((list) => [webhook, ...list]);
        this.snackbar.open("Webhook creado. Guárdalo en tu servidor.", "Cerrar", { duration: 5000 });
        void secret;
      }
      this.resetForm();
      void this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo guardar el webhook", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  async toggleActive(w: WebhookDto): Promise<void> {
    try {
      await this.api.patch(`/api/v1/webhooks/${w.id}`, { active: !w.active });
      void this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    }
  }

  async test(w: WebhookDto): Promise<void> {
    try {
      await this.api.post(`/api/v1/webhooks/${w.id}/test`);
      this.snackbar.open("Ping enviado", "Cerrar", { duration: 2500 });
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    }
  }

  async remove(w: WebhookDto): Promise<void> {
    if (!confirm(`¿Eliminar este webhook?`)) return;
    try {
      await this.api.delete(`/api/v1/webhooks/${w.id}`);
      this.webhooks.update((list) => list.filter((x) => x.id !== w.id));
      this.snackbar.open("Webhook eliminado", "Cerrar", { duration: 2500 });
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    }
  }

  async loadDeliveries(w: WebhookDto): Promise<void> {
    if (this.deliveries()[w.id]) return;
    try {
      const { deliveries } = await this.api.get<{ deliveries: WebhookDelivery[] }>(`/api/v1/webhooks/${w.id}/deliveries`);
      this.deliveries.update((d) => ({ ...d, [w.id]: deliveries }));
    } catch {
      this.deliveries.update((d) => ({ ...d, [w.id]: [] }));
    }
  }

  async resend(w: WebhookDto, deliveryId: number): Promise<void> {
    try {
      await this.api.post(`/api/v1/webhooks/${w.id}/deliveries/${deliveryId}/resend`);
      this.snackbar.open("Reenvío programado", "Cerrar", { duration: 2500 });
      this.deliveries.update((d) => ({ ...d, [w.id]: [] }));
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    }
  }

  trackByWebhook(_i: number, w: WebhookDto): number {
    return w.id;
  }
}
