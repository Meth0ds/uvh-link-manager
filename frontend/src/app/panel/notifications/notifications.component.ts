import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { Router, RouterLink } from "@angular/router";
import type { NotificationItem } from "../../core/models";
import { NOTIFICATION_KINDS, type NotificationKind } from "../../core/notification-kinds";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { LatestRequest } from "../../core/services/latest-request";
import { NotificationService } from "../../core/services/notification.service";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
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
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, PageHeaderComponent, PanelSkeletonComponent],
  templateUrl: "./notifications.component.html",
  styleUrl: "./notifications.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsComponent {
  private readonly notifications = inject(NotificationService);

  private readonly auth = inject(AuthService);
  private readonly workspaces = inject(WorkspaceService);
  private readonly router = inject(Router);
  private readonly requests = new LatestRequest(inject(DestroyRef));

  async openDetail(item: NotificationItem): Promise<void> {
    if (!item.route) return;
    if (item.workspaceId !== null) {
      if (!this.workspaces.list().some((workspace) => workspace.id === item.workspaceId)) {
        this.error.set("Ya no tienes acceso al workspace de esta notificación.");
        return;
      }
      this.workspaces.select(item.workspaceId);
    }
    await this.router.navigateByUrl(item.route);
  }

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
    if (this.busy()) return;
    this.loading.set(true);
    const request = this.requests.begin(this.auth.sessionGeneration());
    const current = (): boolean => this.requests.isCurrent(request, this.auth.sessionGeneration());
    this.error.set(null);
    try {
      const page = await this.notifications.list(undefined, { signal: request.signal });
      if (!current()) return;
      this.items.set(page.notifications);
      this.cursor.set(page.nextCursor);
    } catch {
      if (!current()) return;
      this.error.set("No se pudieron cargar tus notificaciones. Inténtalo de nuevo.");
    } finally {
      if (current()) this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    const before = this.cursor();
    if (before === null || this.busy() || this.loading()) return;
    this.busy.set(true);
    const request = this.requests.begin(this.auth.sessionGeneration());
    const current = (): boolean => this.requests.isCurrent(request, this.auth.sessionGeneration());
    this.error.set(null);
    try {
      const page = await this.notifications.list(before, { signal: request.signal });
      if (!current()) return;
      this.items.update((current) => [...current, ...page.notifications]);
      this.cursor.set(page.nextCursor);
    } catch {
      if (!current()) return;
      this.error.set("No se pudo cargar la siguiente página. Inténtalo de nuevo.");
    } finally {
      if (current()) this.busy.set(false);
    }
  }

  async markRead(item: NotificationItem): Promise<void> {
    if (item.readAt !== null || this.busy() || this.loading()) return;
    this.busy.set(true);
    const request = this.requests.begin(this.auth.sessionGeneration());
    const current = (): boolean => this.requests.isCurrent(request, this.auth.sessionGeneration());
    this.error.set(null);
    try {
      await this.notifications.markRead(item.id);
      if (!current()) return;
      this.items.update((current) => current.map((row) =>
        row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row));
    } catch {
      if (!current()) return;
      this.error.set("No se pudo marcar la notificación. Inténtalo de nuevo.");
    } finally {
      if (current()) this.busy.set(false);
    }
  }

  async markAllRead(): Promise<void> {
    if (this.busy() || this.loading()) return;
    this.busy.set(true);
    const request = this.requests.begin(this.auth.sessionGeneration());
    const current = (): boolean => this.requests.isCurrent(request, this.auth.sessionGeneration());
    this.error.set(null);
    try {
      await this.notifications.markAllRead();
      const now = new Date().toISOString();
      if (!current()) return;
      this.items.update((current) => current.map((row) => row.readAt === null ? { ...row, readAt: now } : row));
    } catch {
      if (!current()) return;
      this.error.set("No se pudo marcar la bandeja. Inténtalo de nuevo.");
    } finally {
      if (current()) this.busy.set(false);
    }
  }
}
