import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatTabsModule } from "@angular/material/tabs";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import type { AdminOverview, AdminUser, AdminReport, AuditEvent } from "../../core/models";

@Component({
  selector: "app-admin",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatProgressBarModule,
    MatSnackBarModule,
  ],
  templateUrl: "./admin.component.html",
  styleUrl: "./admin.component.scss",
})
export class AdminComponent {
  private api = inject(ApiService);
  private snackbar = inject(MatSnackBar);

  readonly overview = signal<AdminOverview | null>(null);
  readonly users = signal<AdminUser[]>([]);
  readonly reports = signal<AdminReport[]>([]);
  readonly events = signal<AuditEvent[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly userQuery = signal("");
  readonly reportStatus = signal("");

  constructor() {
    void this.loadOverview();
  }

  private toast(err: unknown, ok: string): void {
    this.snackbar.open(
      err instanceof ApiRequestError ? err.message : ok,
      "Cerrar",
      { duration: 4000 },
    );
  }

  async loadOverview(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.overview.set(await this.api.get<AdminOverview>("/api/v1/admin/overview"));
      void this.loadUsers();
      void this.loadReports();
      void this.loadAudit();
    } catch (err) {
      this.error.set(
        err instanceof ApiRequestError && err.status === 403
          ? "El área de administración requiere MFA activado en tu cuenta."
          : err instanceof ApiRequestError
            ? err.message
            : "No se pudo cargar la administración",
      );
    } finally {
      this.loading.set(false);
    }
  }

  async loadUsers(): Promise<void> {
    try {
      const { users } = await this.api.get<{ users: AdminUser[] }>("/api/v1/admin/users", {
        q: this.userQuery(),
      });
      this.users.set(users);
    } catch {
      /* overview already surfaced the error */
    }
  }

  searchUsers(value: string): void {
    this.userQuery.set(value);
    void this.loadUsers();
  }

  async toggleAdmin(u: AdminUser): Promise<void> {
    try {
      await this.api.patch(`/api/v1/admin/users/${u.id}`, { isAdmin: u.is_admin !== 1 });
      this.snackbar.open("Rol actualizado", "Cerrar", { duration: 2500 });
      void this.loadUsers();
    } catch (err) {
      this.toast(err, "");
    }
  }

  async toggleBlock(u: AdminUser): Promise<void> {
    if (!confirm(`¿${u.deleted_at ? "Desbloquear" : "Bloquear"} a ${u.email}?`)) return;
    try {
      await this.api.patch(`/api/v1/admin/users/${u.id}`, { blocked: !u.deleted_at });
      this.snackbar.open("Usuario actualizado", "Cerrar", { duration: 2500 });
      void this.loadUsers();
    } catch (err) {
      this.toast(err, "");
    }
  }

  async loadReports(): Promise<void> {
    try {
      const { reports } = await this.api.get<{ reports: AdminReport[] }>("/api/v1/admin/reports", {
        status: this.reportStatus(),
      });
      this.reports.set(reports);
    } catch {
      /* ignore */
    }
  }

  filterReports(status: string): void {
    this.reportStatus.set(status);
    void this.loadReports();
  }

  async setReportStatus(r: AdminReport, status: AdminReport["status"]): Promise<void> {
    try {
      await this.api.patch(`/api/v1/admin/reports/${r.id}`, { status });
      this.snackbar.open("Denuncia actualizada", "Cerrar", { duration: 2500 });
      void this.loadReports();
    } catch (err) {
      this.toast(err, "");
    }
  }

  async blockLink(r: AdminReport): Promise<void> {
    const reason = prompt("Motivo del bloqueo del enlace:");
    if (!reason || reason.trim().length < 3) return;
    try {
      await this.api.post(`/api/v1/admin/links/${r.link_id}/block`, { reason: reason.trim() });
      this.snackbar.open("Enlace bloqueado", "Cerrar", { duration: 2500 });
      void this.loadReports();
    } catch (err) {
      this.toast(err, "");
    }
  }

  async unblockLink(r: AdminReport): Promise<void> {
    try {
      await this.api.post(`/api/v1/admin/links/${r.link_id}/unblock`);
      this.snackbar.open("Enlace desbloqueado", "Cerrar", { duration: 2500 });
      void this.loadReports();
    } catch (err) {
      this.toast(err, "");
    }
  }

  async loadAudit(): Promise<void> {
    try {
      const { events } = await this.api.get<{ events: AuditEvent[] }>("/api/v1/admin/audit");
      this.events.set(events);
    } catch {
      /* ignore */
    }
  }

  auditLabel(action: string): string {
    return action.replace(/\./g, " · ");
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }
}
