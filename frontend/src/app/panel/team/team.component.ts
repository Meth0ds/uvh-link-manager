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
    const email = this.inviteEmail().trim();
    if (!wid || wid !== this.workspaces.currentId() || !email || this.saving()
      || this.invitationRetry.remaining(wid, email) > 0) return;
    this.saving.set(true);
    try {
      await this.api.post(`/api/v1/workspaces/${wid}/invitations`, {
        email,
        role: this.inviteRole(),
      });
      this.inviteEmail.set("");
      this.invitationPageIndex.set(0);
      this.snackbar.open("Invitación enviada", "Cerrar", { duration: 3000 });
      void this.load();
    } catch (err) {
      this.showInvitationError(err, wid, email);
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
      message: `¿Eliminar a ${m.name} del workspace? Perderá el acceso a sus enlaces y analítica, y se desactivarán los webhooks que creó. Si hay una entrega en curso, podrás reintentar al terminar.`,
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
    if (!wid || wid !== this.workspaces.currentId() || this.saving()
      || this.invitationRetry.remaining(wid, inv.email) > 0) return;
    this.saving.set(true);
    try {
      await this.api.post(`/api/v1/workspaces/${wid}/invitations/${inv.id}/resend`);
      this.snackbar.open("Invitación reenviada", "Cerrar", { duration: 2500 });
      // Refresh expiry/status after rotation. A refresh failure must not imply
      // that the already-admitted mail failed and encourage another resend.
      await this.load();
      if (this.error()) {
        this.snackbar.open("Invitación reenviada. Recarga para actualizar su estado.", "Cerrar", { duration: 4000 });
      }
    } catch (err) {
      this.showInvitationError(err, wid, inv.email);
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
    const workspace = this.detail()?.workspace;
    if (!workspace || this.deleteConfirmation() !== workspace.name || !this.deletePassword()
      || (this.user()?.mfaEnabled && !this.deleteFactorCode().trim())) return;
    const confirmed = await this.actions.confirm({
      title: "Eliminar workspace definitivamente",
      message: `Se eliminará “${workspace.name}” con sus enlaces, dominios, tokens y miembros. Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar definitivamente",
      destructive: true,
    });
    if (!confirmed || this.saving()) return;
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
    const targetId = this.transferTargetId();
    const target = detail?.members.find((member) => member.id === targetId && member.role !== "owner");
    if (!detail || !target || !this.transferPassword() || (this.user()?.mfaEnabled && !this.transferFactorCode()) || this.saving()) return;

    const confirmed = await this.actions.confirm({
      title: "Transferir propiedad",
      message: `${target.name} pasará a controlar el workspace. Tu rol cambiará a administrador y sólo el nuevo propietario podrá eliminarlo o volver a transferirlo. Las invitaciones pendientes de administrador que enviaste quedarán canceladas.`,
      confirmLabel: "Transferir propiedad",
      destructive: true,
    });
    if (!confirmed) return;

    this.saving.set(true);
    try {
      await this.api.post(`/api/v1/workspaces/${detail.workspace.id}/transfer-ownership`, {
        targetUserId: target.id,
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
