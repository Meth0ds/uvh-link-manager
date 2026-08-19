import { Component, computed, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";

import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { WorkspaceDetail, Member, Invitation, WorkspaceRole } from "../../core/models";
import { ActionDialogService } from "../action-dialog.service";

const ROLE_LABEL: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  editor: "Editor",
  viewer: "Visor",
};

@Component({
  selector: "app-team",
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatProgressBarModule,
    MatSnackBarModule
],
  templateUrl: "./team.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./team.component.scss",
})
export class TeamComponent {
  private api = inject(ApiService);
  private snackbar = inject(MatSnackBar);
  private router = inject(Router);
  private auth = inject(AuthService);
  private workspaces = inject(WorkspaceService);
  private actions = inject(ActionDialogService);

  readonly detail = signal<WorkspaceDetail | null>(null);
  readonly loading = signal(true);
  readonly renameValue = signal("");
  readonly inviteEmail = signal("");
  readonly inviteRole = signal<"admin" | "editor" | "viewer">("editor");
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly roleLabel = (r: string) => ROLE_LABEL[r] ?? r;

  readonly isOwner = computed(() => this.detail()?.workspace.role === "owner");
  readonly isAdmin = computed(() => {
    const role = this.detail()?.workspace.role;
    return role === "owner" || role === "admin";
  });

  private loadedWorkspaceId: number | null | undefined;

  constructor() {
    effect(() => {
      const workspaceId = this.workspaces.currentId();
      if (workspaceId === this.loadedWorkspaceId) return;
      this.loadedWorkspaceId = workspaceId;
      this.detail.set(null);
      if (workspaceId === null) {
        this.loading.set(false);
        return;
      }
      void this.load();
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const wid = this.workspaces.currentId();
    if (wid == null) {
      this.loading.set(false);
      return;
    }
    try {
      const detail = await this.api.get<WorkspaceDetail>(`/api/v1/workspaces/${wid}`);
      this.detail.set(detail);
      this.renameValue.set(detail.workspace.name);
    } catch (err) {
      this.detail.set(null);
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo cargar el workspace");
    } finally {
      this.loading.set(false);
    }
  }

  async rename(): Promise<void> {
    const wid = this.detail()?.workspace.id;
    if (!wid || !this.renameValue().trim() || this.saving()) return;
    this.saving.set(true);
    try {
      await this.api.patch(`/api/v1/workspaces/${wid}`, { name: this.renameValue().trim() });
      this.snackbar.open("Workspace renombrado", "Cerrar", { duration: 2500 });
      await this.auth.refreshWorkspaces();
      void this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  async invite(): Promise<void> {
    const wid = this.detail()?.workspace.id;
    if (!wid || !this.inviteEmail().trim() || this.saving()) return;
    this.saving.set(true);
    try {
      await this.api.post(`/api/v1/workspaces/${wid}/invitations`, {
        email: this.inviteEmail().trim(),
        role: this.inviteRole(),
      });
      this.inviteEmail.set("");
      this.snackbar.open("Invitación enviada", "Cerrar", { duration: 3000 });
      void this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  async changeRole(m: Member, role: WorkspaceRole): Promise<void> {
    const wid = this.detail()?.workspace.id;
    if (!wid || this.saving()) return;
    this.saving.set(true);
    try {
      await this.api.patch(`/api/v1/workspaces/${wid}/members/${m.id}`, { role });
      this.snackbar.open("Rol actualizado", "Cerrar", { duration: 2500 });
      void this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  async removeMember(m: Member): Promise<void> {
    const wid = this.detail()?.workspace.id;
    if (!wid) return;
    const confirmed = await this.actions.confirm({
      title: "Eliminar miembro",
      message: `¿Eliminar a ${m.name} del workspace? Perderá el acceso a sus enlaces y analítica.`,
      confirmLabel: "Eliminar miembro",
      destructive: true,
    });
    if (!confirmed || this.saving()) return;
    this.saving.set(true);
    try {
      await this.api.delete(`/api/v1/workspaces/${wid}/members/${m.id}`);
      this.snackbar.open("Miembro eliminado", "Cerrar", { duration: 2500 });
      void this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  async cancelInvite(inv: Invitation): Promise<void> {
    const wid = this.detail()?.workspace.id;
    if (!wid || this.saving()) return;
    this.saving.set(true);
    try {
      await this.api.delete(`/api/v1/workspaces/${wid}/invitations/${inv.id}`);
      void this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  async resendInvite(inv: Invitation): Promise<void> {
    const wid = this.detail()?.workspace.id;
    if (!wid || this.saving()) return;
    this.saving.set(true);
    try {
      await this.api.post(`/api/v1/workspaces/${wid}/invitations/${inv.id}/resend`);
      this.snackbar.open("Invitación reenviada", "Cerrar", { duration: 2500 });
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  async leave(): Promise<void> {
    const wid = this.detail()?.workspace.id;
    if (!wid) return;
    const confirmed = await this.actions.confirm({
      title: "Abandonar workspace",
      message: "Dejarás de tener acceso a este workspace y necesitarás una nueva invitación para volver.",
      confirmLabel: "Abandonar workspace",
      destructive: true,
    });
    if (!confirmed || this.saving()) return;
    this.saving.set(true);
    try {
      await this.api.post(`/api/v1/workspaces/${wid}/leave`);
      await this.auth.refreshWorkspaces();
      this.router.navigate(["/app/dashboard"]);
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  async deleteWorkspace(): Promise<void> {
    const wid = this.detail()?.workspace.id;
    if (!wid) return;
    const confirmed = await this.actions.confirm({
      title: "Eliminar workspace definitivamente",
      message: "Se eliminarán el workspace, sus enlaces, dominios, tokens y miembros. Esta acción no se puede deshacer.",
      confirmLabel: "Eliminar definitivamente",
      destructive: true,
    });
    if (!confirmed || this.saving()) return;
    this.saving.set(true);
    try {
      await this.api.delete(`/api/v1/workspaces/${wid}`);
      await this.auth.refreshWorkspaces();
      this.router.navigate(["/app/dashboard"]);
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  trackByMember(_i: number, m: Member): number {
    return m.id;
  }
  trackByInvitation(_i: number, inv: Invitation): number {
    return inv.id;
  }
}
