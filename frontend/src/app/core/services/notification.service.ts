import { Injectable, computed, inject, signal } from "@angular/core";
import { AuthService } from "./auth.service";
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
  private readonly auth = inject(AuthService);
  private readonly count = signal({ generation: -1, value: 0 });
  private gate = { generation: -1, readRevision: 0, epoch: 0, pending: 0, tail: Promise.resolve() };

  private currentGate(): typeof this.gate {
    const generation = this.auth.sessionGeneration();
    if (this.gate.generation !== generation) {
      this.gate = { generation, readRevision: 0, epoch: 0, pending: 0, tail: Promise.resolve() };
    }
    return this.gate;
  }
  readonly unread = computed(() => {
    // Depend on the identity signal too: authenticated can stay true across
    // an account replacement while the session generation changes.
    if (!this.auth.user() || !this.auth.authenticated()) return 0;
    const state = this.count();
    return state.generation === this.auth.sessionGeneration() ? state.value : 0;
  });

  private async readCount<T>(operation: () => Promise<T>, value: (result: T) => number): Promise<T> {
    const gate = this.currentGate();
    const generation = gate.generation;
    const revision = ++gate.readRevision;
    const epoch = gate.epoch;
    const startedDuringMutation = gate.pending > 0;
    const result = await operation();
    if (!startedDuringMutation && generation === this.auth.sessionGeneration() && revision === gate.readRevision
      && epoch === gate.epoch && gate.pending === 0) {
      this.count.set({ generation, value: value(result) });
    }
    return result;
  }

  private async mutateCount(operation: () => Promise<{ unread: number }>): Promise<number> {
    const gate = this.currentGate();
    ++gate.pending;
    ++gate.epoch;
    const pending = gate.tail.then(async () => {
      // A queued read-all must never execute with a replacement account's cookie.
      if (gate.generation !== this.auth.sessionGeneration()) throw new Error("La sesión cambió");
      const result = await operation();
      if (gate.generation === this.auth.sessionGeneration()) {
        this.count.set({ generation: gate.generation, value: result.unread });
      }
      return result.unread;
    }).finally(() => {
      --gate.pending;
      ++gate.epoch;
    });
    gate.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async refreshUnread(): Promise<number> {
    const result = await this.readCount(() => this.api.get<{ unread: number }>(
      "/api/v1/notifications/unread", undefined, decodeNotificationUnread), (row) => row.unread);
    return result.unread;
  }

  async list(before?: number | null, options?: ApiReadOptions): Promise<NotificationInboxPage> {
    return this.readCount(() => this.api.get<NotificationInboxPage>(
      "/api/v1/notifications", before ? { before } : undefined, decodeNotificationInbox, options), (page) => page.unread);
  }

  async markRead(id: number): Promise<number> {
    return this.mutateCount(() => this.api.post<{ unread: number }>(
      `/api/v1/notifications/${id}/read`, {}, decodeNotificationUnread));
  }

  async markAllRead(): Promise<number> {
    return this.mutateCount(() => this.api.post<{ unread: number }>(
      "/api/v1/notifications/read-all", {}, decodeNotificationUnread));
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
