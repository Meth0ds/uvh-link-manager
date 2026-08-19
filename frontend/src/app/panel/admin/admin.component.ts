import { Component, inject, signal, ChangeDetectionStrategy } from "@angular/core";

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
import { ActionDialogService } from "../action-dialog.service";

@Component({
  selector: "app-admin",
  standalone: true,
  imports: [
    FormsModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatProgressBarModule,
    MatSnackBarModule
],
  templateUrl: "./admin.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./admin.component.scss",
})
export class AdminComponent {
  private api = inject(ApiService);
  private snackbar = inject(MatSnackBar);
  private actions = inject(ActionDialogService);

  readonly overview = signal<AdminOverview | null>(null);
  readonly users = signal<AdminUser[]>([]);
  readonly reports = signal<AdminReport[]>([]);
  readonly events = signal<AuditEvent[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly usersLoading = signal(false);
  readonly usersError = signal<string | null>(null);
  readonly reportsLoading = signal(false);
  readonly reportsError = signal<string | null>(null);
  readonly auditLoading = signal(false);
  readonly auditError = signal<string | null>(null);
  readonly actionKey = signal<string | null>(null);

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
      await Promise.all([this.loadUsers(), this.loadReports(), this.loadAudit()]);
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
    this.usersLoading.set(true);
    this.usersError.set(null);
    try {
      const { users } = await this.api.get<{ users: AdminUser[] }>("/api/v1/admin/users", {
        q: this.userQuery(),
      });
      this.users.set(users);
    } catch (err) {
      this.usersError.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar los usuarios");
    } finally {
      this.usersLoading.set(false);
    }
  }

  searchUsers(value: string): void {
    this.userQuery.set(value);
    void this.loadUsers();
  }

  isAdminUser(u: AdminUser): boolean {
    return u.is_admin === true || u.is_admin === 1;
  }

  hasMfa(u: AdminUser): boolean {
    return u.mfa_enabled === true || u.mfa_enabled === 1;
  }

  async toggleAdmin(u: AdminUser): Promise<void> {
    const key = `admin-${u.id}`;
    if (this.actionKey()) return;
    this.actionKey.set(key);
    try {
      await this.api.patch(`/api/v1/admin/users/${u.id}`, { isAdmin: !this.isAdminUser(u) });
      this.snackbar.open("Rol actualizado", "Cerrar", { duration: 2500 });
      void this.loadUsers();
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.actionKey.set(null);
    }
  }

  async toggleBlock(u: AdminUser): Promise<void> {
    const action = u.deleted_at ? "Desbloquear" : "Bloquear";
    const confirmed = await this.actions.confirm({
      title: `${action} usuario`,
      message: u.deleted_at
        ? `¿Restaurar el acceso de ${u.email}?`
        : `¿Bloquear a ${u.email}? Se revocarán sus sesiones y tokens API.`,
      confirmLabel: action,
      destructive: !u.deleted_at,
    });
    if (!confirmed || this.actionKey()) return;
    const key = `block-${u.id}`;
    this.actionKey.set(key);
    try {
      await this.api.patch(`/api/v1/admin/users/${u.id}`, { blocked: !u.deleted_at });
      this.snackbar.open("Usuario actualizado", "Cerrar", { duration: 2500 });
      void this.loadUsers();
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.actionKey.set(null);
    }
  }

  async loadReports(): Promise<void> {
    this.reportsLoading.set(true);
    this.reportsError.set(null);
    try {
      const { reports } = await this.api.get<{ reports: AdminReport[] }>("/api/v1/admin/reports", {
        status: this.reportStatus(),
      });
      this.reports.set(reports);
    } catch (err) {
      this.reportsError.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar las denuncias");
    } finally {
      this.reportsLoading.set(false);
    }
  }

  filterReports(status: string): void {
    this.reportStatus.set(status);
    void this.loadReports();
  }

  async setReportStatus(r: AdminReport, status: AdminReport["status"]): Promise<void> {
    const key = `report-${r.id}`;
    if (this.actionKey()) return;
    this.actionKey.set(key);
    try {
      await this.api.patch(`/api/v1/admin/reports/${r.id}`, { status });
      this.snackbar.open("Denuncia actualizada", "Cerrar", { duration: 2500 });
      void this.loadReports();
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.actionKey.set(null);
    }
  }

  async blockLink(r: AdminReport): Promise<void> {
    const reason = await this.actions.prompt({
      title: "Bloquear enlace",
      message: `Explica por qué se bloquea “${r.alias}”. El motivo quedará registrado en la auditoría.`,
      confirmLabel: "Bloquear enlace",
      destructive: true,
      inputLabel: "Motivo del bloqueo",
      inputPlaceholder: "Describe el incumplimiento…",
      inputHint: "Entre 3 y 500 caracteres.",
      inputRequired: true,
      inputMinLength: 3,
      inputMaxLength: 500,
    });
    if (!reason || this.actionKey()) return;
    const key = `report-${r.id}`;
    this.actionKey.set(key);
    try {
      await this.api.post(`/api/v1/admin/links/${r.link_id}/block`, { reason });
      this.snackbar.open("Enlace bloqueado", "Cerrar", { duration: 2500 });
      void this.loadReports();
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.actionKey.set(null);
    }
  }

  async unblockLink(r: AdminReport): Promise<void> {
    const key = `report-${r.id}`;
    if (this.actionKey()) return;
    this.actionKey.set(key);
    try {
      await this.api.post(`/api/v1/admin/links/${r.link_id}/unblock`);
      this.snackbar.open("Enlace desbloqueado", "Cerrar", { duration: 2500 });
      void this.loadReports();
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.actionKey.set(null);
    }
  }

  async loadAudit(): Promise<void> {
    this.auditLoading.set(true);
    this.auditError.set(null);
    try {
      const { events } = await this.api.get<{ events: AuditEvent[] }>("/api/v1/admin/audit");
      this.events.set(events);
    } catch (err) {
      this.auditError.set(err instanceof ApiRequestError ? err.message : "No se pudo cargar la auditoría");
    } finally {
      this.auditLoading.set(false);
    }
  }

  auditLabel(action: string): string {
    return action.replace(/\./g, " · ");
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }
}
