import { Injectable, inject, signal } from "@angular/core";
import type { NotificationPreference } from "../models";
import type { NotificationDelivery, NotificationKind } from "../notification-kinds";
import { ApiService, type ApiReadOptions } from "./api.service";
import {
  decodeNotificationInbox,
  decodeNotificationPreferences,
  decodeNotificationUnread,
  type NotificationInboxPage,
} from "./notification-response-decoders";

@Injectable({ providedIn: "root" })
export class NotificationService {
  private readonly api = inject(ApiService);

  /**
   * El contador de no leídas lo comparten la campana del panel y la bandeja:
   * una sola señal, para que marcar como leída en la página apague la campana
   * sin otra petición ni una segunda fuente de verdad.
   */
  readonly unread = signal(0);

  async refreshUnread(): Promise<number> {
    const { unread } = await this.api.get<{ unread: number }>(
      "/api/v1/notifications/unread", undefined, decodeNotificationUnread);
    this.unread.set(unread);
    return unread;
  }

  /** Página de bandeja, de más reciente a más antigua; `before` pagina por cursor. */
  async list(before?: number | null, options?: ApiReadOptions): Promise<NotificationInboxPage> {
    const page = await this.api.get<NotificationInboxPage>(
      "/api/v1/notifications", before ? { before } : undefined, decodeNotificationInbox, options);
    this.unread.set(page.unread);
    return page;
  }

  async markRead(id: number): Promise<number> {
    const { unread } = await this.api.post<{ unread: number }>(
      `/api/v1/notifications/${id}/read`, {}, decodeNotificationUnread);
    this.unread.set(unread);
    return unread;
  }

  async markAllRead(): Promise<number> {
    const { unread } = await this.api.post<{ unread: number }>(
      "/api/v1/notifications/read-all", {}, decodeNotificationUnread);
    this.unread.set(unread);
    return unread;
  }

  async preferences(): Promise<NotificationPreference[]> {
    const { preferences } = await this.api.get<{ preferences: NotificationPreference[] }>(
      "/api/v1/notifications/preferences", undefined, decodeNotificationPreferences);
    return preferences;
  }

  /** Cambia entregas; el servidor valida el lote entero y lo audita. */
  async updatePreferences(changes: { kind: NotificationKind; delivery: NotificationDelivery }[]): Promise<NotificationPreference[]> {
    const { preferences } = await this.api.patch<{ preferences: NotificationPreference[] }>(
      "/api/v1/notifications/preferences", { preferences: changes }, decodeNotificationPreferences);
    return preferences;
  }
}
