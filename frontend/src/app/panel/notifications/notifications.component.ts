import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { RouterLink } from "@angular/router";
import type { NotificationItem } from "../../core/models";
import { NOTIFICATION_KINDS, type NotificationKind } from "../../core/notification-kinds";
import { NotificationService } from "../../core/services/notification.service";
import { PageHeaderComponent } from "../page-header.component";

/**
 * La bandeja del centro de notificaciones: avisos de seguridad y operativos de
 * la cuenta, con lectura individual o total y enlace interno seguro.
 *
 * La página nunca inventa destinos: `route` sólo se presenta como enlace de
 * router cuando la fila lo trae, y el texto que se muestra es el que el
 * servidor capturó —sin secretos, sin URLs bearer—.
 */
@Component({
  selector: "app-notifications",
  standalone: true,
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, PageHeaderComponent],
  templateUrl: "./notifications.component.html",
  styleUrl: "./notifications.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsComponent {
  private readonly notifications = inject(NotificationService);

  readonly items = signal<NotificationItem[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly cursor = signal<number | null>(null);
  readonly hasMore = computed(() => this.cursor() !== null);
  readonly unread = this.notifications.unread;

  kindLabel(kind: NotificationKind): string {
    return NOTIFICATION_KINDS[kind].label;
  }

  kindIcon(kind: NotificationKind): string {
    return NOTIFICATION_KINDS[kind].icon;
  }

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.notifications.list();
      this.items.set(page.notifications);
      this.cursor.set(page.nextCursor);
    } catch {
      this.error.set("No se pudieron cargar tus notificaciones. Inténtalo de nuevo.");
    } finally {
      this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    const before = this.cursor();
    if (before === null || this.busy()) return;
    this.busy.set(true);
    try {
      const page = await this.notifications.list(before);
      this.items.update((current) => [...current, ...page.notifications]);
      this.cursor.set(page.nextCursor);
    } catch {
      this.error.set("No se pudo cargar la siguiente página. Inténtalo de nuevo.");
    } finally {
      this.busy.set(false);
    }
  }

  async markRead(item: NotificationItem): Promise<void> {
    if (item.readAt !== null || this.busy()) return;
    this.busy.set(true);
    try {
      await this.notifications.markRead(item.id);
      this.items.update((current) => current.map((row) =>
        row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row));
    } catch {
      this.error.set("No se pudo marcar la notificación. Inténtalo de nuevo.");
    } finally {
      this.busy.set(false);
    }
  }

  async markAllRead(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.notifications.markAllRead();
      const now = new Date().toISOString();
      this.items.update((current) => current.map((row) => row.readAt === null ? { ...row, readAt: now } : row));
    } catch {
      this.error.set("No se pudo marcar la bandeja. Inténtalo de nuevo.");
    } finally {
      this.busy.set(false);
    }
  }
}
