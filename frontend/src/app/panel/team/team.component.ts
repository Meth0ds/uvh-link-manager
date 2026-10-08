import { Component, computed, DestroyRef, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";

import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule, type MatSelect } from "@angular/material/select";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatPaginatorModule, type PageEvent } from "@angular/material/paginator";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { WorkspaceDetail, Member, MemberSearchHit, Invitation, WorkspaceRole } from "../../core/models";
import { ActionDialogService } from "../action-dialog.service";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { InvitationRetryService } from "./invitation-retry.service";
import { LatestRequest } from "../../core/services/latest-request";
import { OwnedMutations } from "../../core/services/owned-mutations";
import { targetWorkspace } from "../../core/services/workspace-target";
import { decodeWorkspaceDetail, decodeWorkspaceMemberSearch } from "../../core/services/workspace-response-decoders";
import { isWorkspaceRole, workspaceRoleLabel } from "../../core/workspace-role-label";
import { invitationStatusLabel } from "../../core/invitation-status-label";

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
  private readonly destroyRef = inject(DestroyRef);
  private readonly requests = new LatestRequest(this.destroyRef);
  private readonly mutationContexts = new LatestRequest(this.destroyRef);
  // The picker searches independently of the paged team snapshot, so a slow
  // lookup must never cancel (or be cancelled by) the page load.
  private readonly transferRequests = new LatestRequest(this.destroyRef);
  private transferSearchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly detail = signal<WorkspaceDetail | null>(null);
  readonly loading = signal(true);
  readonly renameValue = signal("");
  readonly inviteEmail = signal("");
  readonly inviteRole = signal<"admin" | "editor" | "viewer">("editor");
  private readonly mutations = new OwnedMutations();
  readonly saving = this.mutations.busy;
  readonly error = signal<string | null>(null);
  readonly user = this.auth.user;
  readonly transferOpen = signal(false);
  /** The recipient picked from the remote search; never read from the loaded page. */
  readonly transferTarget = signal<MemberSearchHit | null>(null);
  readonly transferQuery = signal("");
  /** Null until a search answers: the picker must not claim "nobody" by default. */
  readonly transferResults = signal<MemberSearchHit[] | null>(null);
  readonly transferTotal = signal(0);
  readonly transferSearching = signal(false);
  readonly transferSearchError = signal(false);
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

  readonly roleLabel = (r: string) => (isWorkspaceRole(r) ? workspaceRoleLabel(r) : r);
  readonly invitationLabel = invitationStatusLabel;
  /** The roles an admin hands out here; ownership is transferred, never assigned. */
  readonly assignableRoles = computed<readonly ("admin" | "editor" | "viewer")[]>(() =>
    this.isOwner() ? ["admin", "editor", "viewer"] : ["editor", "viewer"]);

  private readonly effectiveRole = computed(() => {
    const workspace = this.detail()?.workspace;
    return workspace?.id === this.workspaces.currentId() && workspace.role === this.workspaces.currentRole()
      ? workspace.role : null;
  });
  readonly isOwner = computed(() => this.effectiveRole() === "owner");
  readonly canLeave = computed(() => this.effectiveRole() !== null && this.effectiveRole() !== "owner");
  readonly isAdmin = computed(() => {
    const role = this.effectiveRole();
    return role === "owner" || role === "admin";
  });

  private loadedContext: string | undefined;
  private lastWorkspaceName: string | null = null;

  /** View publication is scoped to the account, selection revision and role. */
  private viewContext(): string {
    return `${this.auth.sessionGeneration()}:${this.user()?.id ?? ""}:${this.workspaces.selectionGeneration()}:${this.workspaces.currentId()}:${this.workspaces.currentRole()}`;
  }

  private captureTarget(workspaceId: number | null) {
    const target = targetWorkspace(this.workspaces, workspaceId);
    const context = this.viewContext();
    return {
      workspaceId: target.workspaceId,
      isCurrent: () => !this.destroyRef.destroyed && context === this.viewContext() && target.isCurrent(),
    };
  }

  canManageMember(member: Member): boolean {
    return this.isAdmin() && member.role !== "owner" && (this.isOwner() || member.role !== "admin");
  }

  canManageInvitation(invitation: Invitation): boolean {
    return this.isAdmin() && (this.isOwner() || invitation.role !== "admin");
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.transferSearchTimer !== null) clearTimeout(this.transferSearchTimer);
      this.mutations.reset();
      this.deletePassword.set("");
      this.deleteFactorCode.set("");
      this.transferPassword.set("");
      this.transferFactorCode.set("");
    });
    effect(() => {
      const workspaceId = this.workspaces.currentId();
      const context = this.viewContext();
      if (context === this.loadedContext) return;
      this.loadedContext = context;
      this.mutations.reset();
      this.renameValue.set("");
      this.lastWorkspaceName = null;
      this.inviteEmail.set("");
      this.inviteRole.set("editor");
      this.error.set(null);
      this.requests.invalidate();
      this.mutationContexts.invalidate();
      this.detail.set(null);
      this.memberPageIndex.set(0);
      this.invitationPageIndex.set(0);
      this.resetTransferPicker();
      this.deleteOpen.set(false);
      this.deleteConfirmation.set("");
      this.deletePassword.set("");
      this.deleteFactorCode.set("");
      this.transferOpen.set(false);
      this.transferPassword.set("");
      this.transferFactorCode.set("");
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
      this.mutationContexts.invalidate();
      this.detail.set(null);
      this.loading.set(false);
      return;
    }
    const context = this.viewContext();
    const request = this.requests.begin(context);
    const previousName = this.lastWorkspaceName;
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
      if (!this.requests.isCurrent(request, this.viewContext())) return;
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
      if (previousName === null || this.renameValue() === previousName) {
        this.renameValue.set(detail.workspace.name);
      }
      this.lastWorkspaceName = detail.workspace.name;
    } catch (err) {
      if (!this.requests.isCurrent(request, this.viewContext())) return;
      this.detail.set(null);
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo cargar el workspace");
    } finally {
      if (this.requests.isCurrent(request, this.viewContext())) this.loading.set(false);
    }
  }

  async rename(): Promise<void> {
    const target = this.captureTarget(this.detail()?.workspace.id ?? null);
    const { workspaceId } = target;
    if (workspaceId === null || !target.isCurrent() || !this.isAdmin() || !this.renameValue().trim() || this.saving()) return;
    const generation = this.auth.sessionGeneration();
    const name = this.renameValue().trim();
    const operation = this.mutations.begin(workspaceId ?? 0);
    try {
      await this.api.patch(`/api/v1/workspaces/${workspaceId}`, { name });
      // The navigation list is account-wide, so it is refreshed even when the
      // selection moved on: the new name must not be lost with the view that
      // asked for it.
      if (generation !== this.auth.sessionGeneration()) return;
      await this.auth.refreshWorkspaces();
      if (!target.isCurrent()) return;
      if (this.renameValue().trim() === name) this.renameValue.set(name);
      this.snackbar.open("Workspace renombrado", "Cerrar", { duration: 2500 });
      const detail = this.detail();
      if (detail) this.detail.set({ ...detail, workspace: { ...detail.workspace, name } });
      this.lastWorkspaceName = name;
      void this.load();
    } catch (err) {
      if (!target.isCurrent()) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.mutations.settle(operation);
    }
  }

  async invite(): Promise<void> {
    const target = this.captureTarget(this.detail()?.workspace.id ?? null);
    const { workspaceId } = target;
    const email = this.inviteEmail().trim();
    if (workspaceId === null || !target.isCurrent() || !email || !this.isAdmin() || !this.assignableRoles().includes(this.inviteRole()) || this.saving()
      || this.invitationRetry.remaining(workspaceId, email) > 0) return;
    const operation = this.mutations.begin(workspaceId ?? 0);
    try {
      await this.api.post(`/api/v1/workspaces/${workspaceId}/invitations`, {
        email,
        role: this.inviteRole(),
      });
      if (!target.isCurrent()) return;
      if (this.inviteEmail().trim() === email) this.inviteEmail.set("");
      this.invitationPageIndex.set(0);
      this.snackbar.open("Invitación enviada", "Cerrar", { duration: 3000 });
      void this.load();
    } catch (err) {
      if (target.isCurrent()) this.showInvitationError(err, workspaceId, email);
    } finally {
      this.mutations.settle(operation);
    }
  }

  async changeRole(m: Member, role: WorkspaceRole, selection?: MatSelect): Promise<void> {
    const target = this.captureTarget(this.detail()?.workspace.id ?? null);
    const { workspaceId } = target;
    if (workspaceId === null || !target.isCurrent() || !this.canManageMember(m)
      || role === "owner" || !this.assignableRoles().includes(role) || this.saving()) {
      if (selection) selection.value = m.role;
      return;
    }
    const operation = this.mutations.begin(workspaceId ?? 0);
    try {
      await this.api.patch(`/api/v1/workspaces/${workspaceId}/members/${m.id}`, { role });
      if (!target.isCurrent()) return;
      const detail = this.detail();
      if (detail) this.detail.set({ ...detail, members: detail.members.map(row => row.id === m.id ? { ...row, role } : row) });
      this.snackbar.open("Rol actualizado", "Cerrar", { duration: 2500 });
      void this.load();
    } catch (err) {
      if (!target.isCurrent()) return;
      if (selection) selection.value = m.role;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.mutations.settle(operation);
    }
  }

  async removeMember(m: Member): Promise<void> {
    const target = this.captureTarget(this.detail()?.workspace.id ?? null);
    const { workspaceId } = target;
    if (workspaceId === null || !target.isCurrent() || !this.canManageMember(m) || this.saving()) return;
    const confirmed = await this.actions.confirm({
      title: "Eliminar miembro",
      message: `¿Eliminar a ${m.name} del workspace? Perderá el acceso a sus enlaces y analítica, y se desactivarán los webhooks que creó. Si hay una entrega en curso, podrás reintentar al terminar.`,
      confirmLabel: "Eliminar miembro",
      destructive: true,
    });
    // The confirmation names a member of one workspace. Never apply it to a
    // newer selection or once another mutation is already running.
    if (!confirmed || this.saving() || !target.isCurrent()) return;
    const operation = this.mutations.begin(workspaceId ?? 0);
    try {
      await this.api.delete(`/api/v1/workspaces/${workspaceId}/members/${m.id}`);
      if (!target.isCurrent()) return;
      this.snackbar.open("Miembro eliminado", "Cerrar", { duration: 2500 });
      void this.load();
    } catch (err) {
      if (!target.isCurrent()) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.mutations.settle(operation);
    }
  }

  async cancelInvite(inv: Invitation): Promise<void> {
    const target = this.captureTarget(this.detail()?.workspace.id ?? null);
    const { workspaceId } = target;
    if (workspaceId === null || !target.isCurrent() || !this.canManageInvitation(inv) || this.saving()) return;
    const operation = this.mutations.begin(workspaceId ?? 0);
    try {
      await this.api.delete(`/api/v1/workspaces/${workspaceId}/invitations/${inv.id}`);
      if (!target.isCurrent()) return;
      void this.load();
    } catch (err) {
      if (!target.isCurrent()) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.mutations.settle(operation);
    }
  }

  async resendInvite(inv: Invitation): Promise<void> {
    const target = this.captureTarget(this.detail()?.workspace.id ?? null);
    const { workspaceId } = target;
    if (workspaceId === null || !target.isCurrent() || !this.canManageInvitation(inv) || this.saving()
      || this.invitationRetry.remaining(workspaceId, inv.email) > 0) return;
    const operation = this.mutations.begin(workspaceId ?? 0);
    try {
      await this.api.post(`/api/v1/workspaces/${workspaceId}/invitations/${inv.id}/resend`);
      if (!target.isCurrent()) return;
      this.snackbar.open("Invitación reenviada", "Cerrar", { duration: 2500 });
      // Refresh expiry/status after rotation. A refresh failure must not imply
      // that the already-admitted mail failed and encourage another resend.
      await this.load();
      if (target.isCurrent() && this.error()) {
        this.snackbar.open("Invitación reenviada. Recarga para actualizar su estado.", "Cerrar", { duration: 4000 });
      }
    } catch (err) {
      if (target.isCurrent()) this.showInvitationError(err, workspaceId, inv.email);
    } finally {
      this.mutations.settle(operation);
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
    if (this.saving()) return;
    // Leaving is irreversible from the panel, so it must target the workspace
    // the confirmation was opened for, not whichever one is selected now.
    const target = this.captureTarget(this.detail()?.workspace.id ?? null);
    const generation = this.auth.sessionGeneration();
    const request = this.mutationContexts.begin(target.workspaceId);
    const isCurrent = () => generation === this.auth.sessionGeneration()
      && this.mutationContexts.isCurrent(request, this.workspaces.currentId()) && target.isCurrent();
    const { workspaceId } = target;
    if (workspaceId === null) return;
    const confirmed = await this.actions.confirm({
      title: "Abandonar workspace",
      message: "Dejarás de tener acceso a este workspace y necesitarás una nueva invitación para volver.",
      confirmLabel: "Abandonar workspace",
      destructive: true,
    });
    if (!confirmed || this.saving() || !isCurrent()) return;
    const operation = this.mutations.begin(workspaceId ?? 0);
    try {
      await this.api.post(`/api/v1/workspaces/${workspaceId}/leave`);
      if (isCurrent()) void this.router.navigate(["/app/dashboard"]);
      if (generation === this.auth.sessionGeneration()) await this.auth.refreshWorkspaces();
    } catch (err) {
      if (!isCurrent()) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.mutations.settle(operation);
    }
  }

  async deleteWorkspace(): Promise<void> {
    if (this.saving()) return;
    const workspace = this.detail()?.workspace;
    const target = this.captureTarget(workspace?.id ?? null);
    const generation = this.auth.sessionGeneration();
    const request = this.mutationContexts.begin(target.workspaceId);
    const isCurrent = () => generation === this.auth.sessionGeneration()
      && this.mutationContexts.isCurrent(request, this.workspaces.currentId()) && target.isCurrent();
    if (!workspace || !this.isOwner() || !isCurrent() || this.deleteConfirmation() !== workspace.name
      || !this.deletePassword()
      || (this.user()?.mfaEnabled && !this.deleteFactorCode().trim())) return;
    const payload = {
      confirmation: this.deleteConfirmation(), password: this.deletePassword(),
      ...(this.deleteFactorCode().trim() ? { factorCode: this.deleteFactorCode().trim() } : {}),
    };
    const confirmed = await this.actions.confirm({
      title: "Eliminar workspace definitivamente",
      message: `Se eliminará “${workspace.name}” con sus enlaces, dominios, tokens y miembros. Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar definitivamente",
      destructive: true,
    });
    if (!confirmed || this.saving()) return;
    if (!isCurrent()) {
      return;
    }
    const operation = this.mutations.begin(workspace.id);
    try {
      await this.api.delete(`/api/v1/workspaces/${workspace.id}`, payload);
      if (isCurrent()) {
        this.deleteOpen.set(false);
        this.deleteConfirmation.set("");
        this.deletePassword.set("");
        this.deleteFactorCode.set("");
        void this.router.navigate(["/app/dashboard"]);
      }
      try {
        if (generation === this.auth.sessionGeneration()) await this.auth.refreshWorkspaces();
      } catch {
        if (isCurrent()) {
          this.snackbar.open("Workspace eliminado. Recarga el panel para actualizar la navegación.", "Cerrar", { duration: 4000 });
        }
      }
    } catch (err) {
      if (!isCurrent()) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.mutations.settle(operation);
    }
  }

  beginWorkspaceDeletion(): void {
    if (this.saving() || !this.isOwner()) return;
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
    if (this.saving() || !this.isOwner()) return;
    this.transferOpen.set(true);
    this.resetTransferPicker();
    this.transferPassword.set("");
    this.transferFactorCode.set("");
    // Opening the picker lists the first window of members right away, so the
    // recipient is findable even without remembering a name to type.
    void this.searchTransferCandidates();
  }

  cancelOwnershipTransfer(): void {
    if (this.saving()) return;
    this.transferOpen.set(false);
    this.resetTransferPicker();
    this.transferPassword.set("");
    this.transferFactorCode.set("");
  }

  private resetTransferPicker(): void {
    if (this.transferSearchTimer !== null) {
      clearTimeout(this.transferSearchTimer);
      this.transferSearchTimer = null;
    }
    this.transferRequests.invalidate();
    this.transferTarget.set(null);
    this.transferQuery.set("");
    this.transferResults.set(null);
    this.transferTotal.set(0);
    this.transferSearching.set(false);
    this.transferSearchError.set(false);
  }

  /** Debounce keystrokes so typing a name is one search, not one per letter. */
  onTransferQuery(value: string): void {
    this.transferQuery.set(value);
    this.transferRequests.invalidate();
    this.transferResults.set(null);
    this.transferTotal.set(0);
    this.transferSearching.set(true);
    this.transferSearchError.set(false);
    if (this.transferSearchTimer !== null) clearTimeout(this.transferSearchTimer);
    this.transferSearchTimer = setTimeout(() => {
      this.transferSearchTimer = null;
      void this.searchTransferCandidates();
    }, 250);
  }

  /**
   * Search every member of the workspace, not just the page of the team list.
   * A result that arrives after a newer query is dropped: the picker must show
   * matches for what is typed now, never for a superseded term.
   */
  async searchTransferCandidates(): Promise<void> {
    const detail = this.detail();
    if (!detail || !this.isOwner()) return;
    const target = this.captureTarget(detail.workspace.id);
    if (!target.isCurrent()) return;
    const query = this.transferQuery().trim();
    const request = this.transferRequests.begin(query);
    this.transferSearching.set(true);
    this.transferResults.set(null);
    this.transferSearchError.set(false);
    try {
      const result = await this.api.get<{ members: MemberSearchHit[]; total: number }>(
        `/api/v1/workspaces/${detail.workspace.id}/members`,
        { q: query, perPage: 10 },
        decodeWorkspaceMemberSearch,
        { signal: request.signal },
      );
      if (!(target.isCurrent() && this.transferRequests.isCurrent(request, this.transferQuery().trim()))) return;
      // Ownership is transferred, never assigned: the current owner is never a
      // candidate, whatever page of the team list happens to be loaded.
      this.transferResults.set(result.members.filter((member) => member.role !== "owner"));
      this.transferTotal.set(result.total);
    } catch {
      if (!(target.isCurrent() && this.transferRequests.isCurrent(request, this.transferQuery().trim()))) return;
      this.transferResults.set(null);
      this.transferSearchError.set(true);
    } finally {
      if (target.isCurrent() && this.transferRequests.isCurrent(request, this.transferQuery().trim())) this.transferSearching.set(false);
    }
  }

  selectTransferTarget(candidate: MemberSearchHit): void {
    if (this.saving() || !this.isOwner() || this.transferSearching() || candidate.role === "owner"
      || !this.transferResults()?.some(row => row.id === candidate.id)) return;
    this.transferTarget.set(candidate);
    this.transferResults.set(null);
  }

  clearTransferTarget(): void {
    if (this.saving()) return;
    this.transferTarget.set(null);
    void this.searchTransferCandidates();
  }

  async transferOwnership(): Promise<void> {
    if (this.saving()) return;
    const detail = this.detail();
    const scope = this.captureTarget(detail?.workspace.id ?? null);
    const generation = this.auth.sessionGeneration();
    const request = this.mutationContexts.begin(scope.workspaceId);
    const isCurrent = () => generation === this.auth.sessionGeneration()
      && this.mutationContexts.isCurrent(request, this.workspaces.currentId()) && scope.isCurrent();
    const recipient = this.transferTarget();
    if (!detail || !this.isOwner() || !recipient || recipient.role === "owner" || !this.transferPassword()
      || (this.user()?.mfaEnabled && !this.transferFactorCode()) || this.saving()) return;

    const payload = {
      targetUserId: recipient.id, password: this.transferPassword(),
      ...(this.transferFactorCode().trim() ? { factorCode: this.transferFactorCode().trim() } : {}),
    };
    const confirmed = await this.actions.confirm({
      title: "Transferir propiedad",
      message: `${recipient.name} pasará a controlar el workspace. Tu rol cambiará a administrador y sólo el nuevo propietario podrá eliminarlo o volver a transferirlo. Las invitaciones pendientes de administrador que enviaste quedarán canceladas.`,
      confirmLabel: "Transferir propiedad",
      destructive: true,
    });
    if (!confirmed || this.saving() || !isCurrent()) return;

    const operation = this.mutations.begin(scope.workspaceId ?? 0);
    try {
      await this.api.post(`/api/v1/workspaces/${detail.workspace.id}/transfer-ownership`, payload);
      if (isCurrent()) {
        this.transferOpen.set(false);
        this.transferPassword.set("");
        this.transferFactorCode.set("");
        this.resetTransferPicker();
        this.snackbar.open("Propiedad transferida", "Cerrar", { duration: 3000 });
      }
      try {
        if (generation !== this.auth.sessionGeneration()) return;
        await Promise.all([this.auth.refreshWorkspaces(), this.auth.refreshUser()]);
        if (isCurrent()) await this.load();
      } catch {
        if (!isCurrent()) return;
        this.snackbar.open("Propiedad transferida. Recarga el panel para actualizar permisos.", "Cerrar", { duration: 4000 });
      }
    } catch (err) {
      if (!isCurrent()) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo transferir la propiedad", "Cerrar", { duration: 4000 });
    } finally {
      this.mutations.settle(operation);
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
