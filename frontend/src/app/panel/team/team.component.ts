import { Component, computed, DestroyRef, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";

import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatPaginatorModule, type PageEvent } from "@angular/material/paginator";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { WorkspaceDetail, Member, Invitation, WorkspaceRole } from "../../core/models";
import { ActionDialogService } from "../action-dialog.service";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { InvitationRetryService } from "./invitation-retry.service";
import { LatestRequest } from "../../core/services/latest-request";
import { targetWorkspace } from "../../core/services/workspace-target";
import { decodeWorkspaceDetail } from "../../core/services/workspace-response-decoders";

const ROLE_LABEL: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  editor: "Editor",
  viewer: "Visor",
};

@Component({
  selector: "app-team",
  standalone: true,
  providers: [InvitationRetryService],
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatProgressBarModule,
    MatPaginatorModule,
    MatSnackBarModule,
    PageHeaderComponent,
    PanelSkeletonComponent,
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
  readonly invitationRetry = inject(InvitationRetryService);
  private readonly requests = new LatestRequest(inject(DestroyRef));

  readonly detail = signal<WorkspaceDetail | null>(null);
  readonly loading = signal(true);
  readonly renameValue = signal("");
  readonly inviteEmail = signal("");
  readonly inviteRole = signal<"admin" | "editor" | "viewer">("editor");
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly user = this.auth.user;
  readonly transferOpen = signal(false);
  readonly transferTargetId = signal<number | null>(null);
  readonly transferPassword = signal("");
  readonly transferFactorCode = signal("");
  readonly deleteOpen = signal(false);
  readonly deleteConfirmation = signal("");
  readonly deletePassword = signal("");
  readonly deleteFactorCode = signal("");
  readonly memberPageIndex = signal(0);
  readonly memberPageSize = signal(25);
  readonly invitationPageIndex = signal(0);
  readonly invitationPageSize = signal(25);

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
      this.requests.invalidate();
      this.detail.set(null);
      this.memberPageIndex.set(0);
      this.invitationPageIndex.set(0);
      if (workspaceId === null) {
        this.loading.set(false);
        return;
      }
      void this.load();
    });
  }

  async load(): Promise<void> {
    const wid = this.workspaces.currentId();
    if (wid == null) {
      this.requests.invalidate();
      this.detail.set(null);
      this.loading.set(false);
      return;
    }
    const request = this.requests.begin(wid);
    const memberPage = this.memberPageIndex() + 1;
    const memberPerPage = this.memberPageSize();
    const invitationPage = this.invitationPageIndex() + 1;
    const invitationPerPage = this.invitationPageSize();
    this.loading.set(true);
    this.error.set(null);
    try {
      const detail = await this.api.get<WorkspaceDetail>(`/api/v1/workspaces/${wid}`, {
        memberPage,
        memberPerPage,
        invitationPage,
        invitationPerPage,
      }, (value) => decodeWorkspaceDetail(value, {
        workspaceId: wid,
        memberPage,
        memberPerPage,
        invitationPage,
        invitationPerPage,
      }), { signal: request.signal });
      if (!this.requests.isCurrent(request, this.workspaces.currentId())) return;
      if (detail.members.length === 0 && detail.membersPage.total > 0 && this.memberPageIndex() > 0) {
        this.memberPageIndex.set(Math.max(0, Math.ceil(detail.membersPage.total / detail.membersPage.perPage) - 1));
        await this.load();
        return;
      }
      if (detail.invitations.length === 0 && detail.invitationsPage.total > 0 && this.invitationPageIndex() > 0) {
        this.invitationPageIndex.set(Math.max(0, Math.ceil(detail.invitationsPage.total / detail.invitationsPage.perPage) - 1));
        await this.load();
        return;
      }
      this.detail.set(detail);
      this.renameValue.set(detail.workspace.name);
    } catch (err) {
      if (!this.requests.isCurrent(request, this.workspaces.currentId())) return;
      this.detail.set(null);
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo cargar el workspace");
    } finally {
      if (this.requests.isCurrent(request, this.workspaces.currentId())) this.loading.set(false);
    }
  }

  async rename(): Promise<void> {
    const target = targetWorkspace(this.workspaces, this.detail()?.workspace.id ?? null);
    const { workspaceId } = target;
    if (workspaceId === null || !this.renameValue().trim() || this.saving()) return;
    this.saving.set(true);
    try {
      await this.api.patch(`/api/v1/workspaces/${workspaceId}`, { name: this.renameValue().trim() });
      // The navigation list is account-wide, so it is refreshed even when the
      // selection moved on: the new name must not be lost with the view that
      // asked for it.
      await this.auth.refreshWorkspaces();
      if (!target.isCurrent()) return;
      this.snackbar.open("Workspace renombrado", "Cerrar", { duration: 2500 });
      void this.load();
    } catch (err) {
      if (!target.isCurrent()) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  async invite(): Promise<void> {
    const target = targetWorkspace(this.workspaces, this.detail()?.workspace.id ?? null);
    const { workspaceId } = target;
    const email = this.inviteEmail().trim();
    if (workspaceId === null || !target.isCurrent() || !email || this.saving()
      || this.invitationRetry.remaining(workspaceId, email) > 0) return;
    this.saving.set(true);
    try {
      await this.api.post(`/api/v1/workspaces/${workspaceId}/invitations`, {
        email,
        role: this.inviteRole(),
      });
      if (!target.isCurrent()) return;
      this.inviteEmail.set("");
      this.invitationPageIndex.set(0);
      this.snackbar.open("Invitación enviada", "Cerrar", { duration: 3000 });
      void this.load();
    } catch (err) {
      this.showInvitationError(err, workspaceId, email);
    } finally {
      this.saving.set(false);
    }
  }

  async changeRole(m: Member, role: WorkspaceRole): Promise<void> {
    const target = targetWorkspace(this.workspaces, this.detail()?.workspace.id ?? null);
    const { workspaceId } = target;
    if (workspaceId === null || !target.isCurrent() || this.saving()) return;
    this.saving.set(true);
    try {
      await this.api.patch(`/api/v1/workspaces/${workspaceId}/members/${m.id}`, { role });
      if (!target.isCurrent()) return;
      this.snackbar.open("Rol actualizado", "Cerrar", { duration: 2500 });
      void this.load();
    } catch (err) {
      if (!target.isCurrent()) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  async removeMember(m: Member): Promise<void> {
    const target = targetWorkspace(this.workspaces, this.detail()?.workspace.id ?? null);
    const { workspaceId } = target;
    if (workspaceId === null) return;
    const confirmed = await this.actions.confirm({
      title: "Eliminar miembro",
      message: `¿Eliminar a ${m.name} del workspace? Perderá el acceso a sus enlaces y analítica, y se desactivarán los webhooks que creó. Si hay una entrega en curso, podrás reintentar al terminar.`,
      confirmLabel: "Eliminar miembro",
      destructive: true,
    });
    // The confirmation names a member of one workspace. Never apply it to a
    // newer selection or once another mutation is already running.
    if (!confirmed || this.saving() || !target.isCurrent()) return;
    this.saving.set(true);
    try {
      await this.api.delete(`/api/v1/workspaces/${workspaceId}/members/${m.id}`);
      this.snackbar.open("Miembro eliminado", "Cerrar", { duration: 2500 });
      void this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  async cancelInvite(inv: Invitation): Promise<void> {
    const target = targetWorkspace(this.workspaces, this.detail()?.workspace.id ?? null);
    const { workspaceId } = target;
    if (workspaceId === null || !target.isCurrent() || this.saving()) return;
    this.saving.set(true);
    try {
      await this.api.delete(`/api/v1/workspaces/${workspaceId}/invitations/${inv.id}`);
      void this.load();
    } catch (err) {
      if (!target.isCurrent()) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  async resendInvite(inv: Invitation): Promise<void> {
    const target = targetWorkspace(this.workspaces, this.detail()?.workspace.id ?? null);
    const { workspaceId } = target;
    if (workspaceId === null || !target.isCurrent() || this.saving()
      || this.invitationRetry.remaining(workspaceId, inv.email) > 0) return;
    this.saving.set(true);
    try {
      await this.api.post(`/api/v1/workspaces/${workspaceId}/invitations/${inv.id}/resend`);
      if (!target.isCurrent()) return;
      this.snackbar.open("Invitación reenviada", "Cerrar", { duration: 2500 });
      // Refresh expiry/status after rotation. A refresh failure must not imply
      // that the already-admitted mail failed and encourage another resend.
      await this.load();
      if (this.error()) {
        this.snackbar.open("Invitación reenviada. Recarga para actualizar su estado.", "Cerrar", { duration: 4000 });
      }
    } catch (err) {
      this.showInvitationError(err, workspaceId, inv.email);
    } finally {
      this.saving.set(false);
    }
  }

  private showInvitationError(error: unknown, workspaceId: number, email: string): void {
    let message = error instanceof ApiRequestError ? error.message : "Error";
    if (error instanceof ApiRequestError && error.status === 429) {
      // Capture the original request identity, not the form/selection at response
      // time. A late response must not place a different recipient on cooldown.
      this.invitationRetry.defer(workspaceId, email, error.retryAfterSeconds);
      const seconds = this.invitationRetry.remaining(workspaceId, email);
      message += seconds > 0
        ? ` Vuelve a intentarlo en ${this.invitationRetry.label(seconds)}. No se reenviará automáticamente.`
        : " Inténtalo más tarde; el servidor no ha indicado una espera válida.";
    }
    this.snackbar.open(message, "Cerrar", { duration: 6000 });
  }

  async leave(): Promise<void> {
    // Leaving is irreversible from the panel, so it must target the workspace
    // the confirmation was opened for, not whichever one is selected now.
    const target = targetWorkspace(this.workspaces, this.detail()?.workspace.id ?? null);
    const { workspaceId } = target;
    if (workspaceId === null) return;
    const confirmed = await this.actions.confirm({
      title: "Abandonar workspace",
      message: "Dejarás de tener acceso a este workspace y necesitarás una nueva invitación para volver.",
      confirmLabel: "Abandonar workspace",
      destructive: true,
    });
    if (!confirmed || this.saving() || !target.isCurrent()) return;
    this.saving.set(true);
    try {
      await this.api.post(`/api/v1/workspaces/${workspaceId}/leave`);
      await this.auth.refreshWorkspaces();
      this.router.navigate(["/app/dashboard"]);
    } catch (err) {
      if (!target.isCurrent()) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  async deleteWorkspace(): Promise<void> {
    const workspace = this.detail()?.workspace;
    const target = targetWorkspace(this.workspaces, workspace?.id ?? null);
    if (!workspace || !target.isCurrent() || this.deleteConfirmation() !== workspace.name
      || !this.deletePassword()
      || (this.user()?.mfaEnabled && !this.deleteFactorCode().trim())) return;
    const confirmed = await this.actions.confirm({
      title: "Eliminar workspace definitivamente",
      message: `Se eliminará “${workspace.name}” con sus enlaces, dominios, tokens y miembros. Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar definitivamente",
      destructive: true,
    });
    if (!confirmed || this.saving()) return;
    if (!target.isCurrent()) {
      // The panel below belongs to a workspace this decision no longer names.
      this.cancelWorkspaceDeletion();
      return;
    }
    this.saving.set(true);
    try {
      await this.api.delete(`/api/v1/workspaces/${workspace.id}`, {
        confirmation: this.deleteConfirmation(),
        password: this.deletePassword(),
        ...(this.deleteFactorCode().trim() ? { factorCode: this.deleteFactorCode().trim() } : {}),
      });
      this.deleteOpen.set(false);
      this.deleteConfirmation.set("");
      this.deletePassword.set("");
      this.deleteFactorCode.set("");
      void this.router.navigate(["/app/dashboard"]);
      try {
        await this.auth.refreshWorkspaces();
      } catch {
        this.snackbar.open("Workspace eliminado. Recarga el panel para actualizar la navegación.", "Cerrar", { duration: 4000 });
      }
    } catch (err) {
      if (!target.isCurrent()) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  beginWorkspaceDeletion(): void {
    if (this.saving()) return;
    this.deleteOpen.set(true);
    this.deleteConfirmation.set("");
    this.deletePassword.set("");
    this.deleteFactorCode.set("");
  }

  cancelWorkspaceDeletion(): void {
    if (this.saving()) return;
    this.deleteOpen.set(false);
    this.deleteConfirmation.set("");
    this.deletePassword.set("");
    this.deleteFactorCode.set("");
  }

  beginOwnershipTransfer(): void {
    if (this.saving()) return;
    this.transferOpen.set(true);
    this.transferTargetId.set(null);
    this.transferPassword.set("");
    this.transferFactorCode.set("");
  }

  cancelOwnershipTransfer(): void {
    if (this.saving()) return;
    this.transferOpen.set(false);
    this.transferPassword.set("");
    this.transferFactorCode.set("");
  }

  async transferOwnership(): Promise<void> {
    const detail = this.detail();
    const scope = targetWorkspace(this.workspaces, detail?.workspace.id ?? null);
    const targetId = this.transferTargetId();
    const recipient = detail?.members.find((member) => member.id === targetId && member.role !== "owner");
    if (!detail || !recipient || !this.transferPassword()
      || (this.user()?.mfaEnabled && !this.transferFactorCode()) || this.saving()) return;

    const confirmed = await this.actions.confirm({
      title: "Transferir propiedad",
      message: `${recipient.name} pasará a controlar el workspace. Tu rol cambiará a administrador y sólo el nuevo propietario podrá eliminarlo o volver a transferirlo. Las invitaciones pendientes de administrador que enviaste quedarán canceladas.`,
      confirmLabel: "Transferir propiedad",
      destructive: true,
    });
    if (!confirmed) return;
    if (!scope.isCurrent()) {
      // A different workspace is selected now; this recipient and password
      // belong to the previous one, so drop the panel instead of transferring
      // blindly.
      this.cancelOwnershipTransfer();
      return;
    }

    this.saving.set(true);
    try {
      await this.api.post(`/api/v1/workspaces/${detail.workspace.id}/transfer-ownership`, {
        targetUserId: recipient.id,
        password: this.transferPassword(),
        ...(this.transferFactorCode().trim() ? { factorCode: this.transferFactorCode().trim() } : {}),
      });
      this.transferOpen.set(false);
      this.transferPassword.set("");
      this.transferFactorCode.set("");
      this.transferTargetId.set(null);
      this.snackbar.open("Propiedad transferida", "Cerrar", { duration: 3000 });
      try {
        await Promise.all([this.auth.refreshWorkspaces(), this.auth.refreshUser()]);
        await this.load();
      } catch {
        this.snackbar.open("Propiedad transferida. Recarga el panel para actualizar permisos.", "Cerrar", { duration: 4000 });
      }
    } catch (err) {
      if (!scope.isCurrent()) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo transferir la propiedad", "Cerrar", { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  onMembersPage(event: PageEvent): void {
    this.memberPageIndex.set(event.pageIndex);
    this.memberPageSize.set(event.pageSize);
    void this.load();
  }

  onInvitationsPage(event: PageEvent): void {
    this.invitationPageIndex.set(event.pageIndex);
    this.invitationPageSize.set(event.pageSize);
    void this.load();
  }

  trackByMember(_i: number, m: Member): number {
    return m.id;
  }
  trackByInvitation(_i: number, inv: Invitation): number {
    return inv.id;
  }
}
