import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSelectModule } from "@angular/material/select";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { MatTabsModule } from "@angular/material/tabs";
import type {
  AdminDomain,
  AdminAccountRecovery,
  AdminMailOutboxMessage,
  AdminOperations,
  AdminOverview,
  AdminUser,
  AuditEvent,
  AccountRecoveryStatus,
  DomainState,
  MailOutboxStatus,
  PrivacyRightRequest,
  PrivacyRightStatus,
  PrivacyRightType,
} from "../../core/models";
import { adminMessage, apiMessage } from "../../core/api-message";
import { QueuePaging } from "../../core/queue-paging";
import { ApiService } from "../../core/services/api.service";
import { accountRecoveryStateLabel, ACCOUNT_RECOVERY_REVIEW_FILTER } from "../../core/account-recovery-state-label";
import { resourceTypeLabel } from "../../core/resource-type-label";
import { ADMIN_ACCOUNT_FLAG_LABEL, ADMIN_USER_FILTERS, adminAccountStateLabel, type AdminUserFilterValue } from "../../core/admin-user-label";
import { DOMAIN_STATE_ORDER, domainStateLabel } from "../../core/domain-state-label";
import { mailOutboxStateLabel, MAIL_OUTBOX_STATE_ORDER } from "../../core/mail-outbox-state-label";
import {
  privacyRightIsActive,
  privacyRightStatusLabel,
  privacyRightTypeLabel,
  PRIVACY_RIGHT_STATUS_ORDER,
  PRIVACY_RIGHT_TYPE_ORDER,
} from "../../core/privacy-right-label";
import { countLabel } from "../../core/count-label";
import { dateTimeLabel } from "../../core/date-time-label";
import {
  decodeAccountRecoveryDecision,
  decodeAdminAuditPage,
  decodeAdminDomainsPage,
  decodeAdminMailPage,
  decodeAdminOperations,
  decodeAdminOverview,
  decodeAdminRecoveriesPage,
  decodeAdminUsersPage,
} from "../../core/services/admin-response-decoders";
import { LatestRequest } from "../../core/services/latest-request";
import { decodePrivacyRequestsPage } from "../../core/services/privacy-response-decoders";
import { ActionDialogService } from "../action-dialog.service";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { QueueSectionComponent } from "../queue-section.component";
import { AdminAppealsComponent } from "./admin-appeals.component";
import { AdminDestinationsComponent } from "./admin-destinations.component";
import { AdminReportsComponent } from "./admin-reports.component";

type UserStatus = "" | AdminUserFilterValue;
type RecoveryStatus = "" | AccountRecoveryStatus;
type DomainFilter = "" | DomainState;
type MailStatusFilter = "" | MailOutboxStatus;
type PrivacyStatusFilter = "" | PrivacyRightStatus;
type PrivacyTypeFilter = "" | PrivacyRightType;

@Component({
  selector: "app-admin",
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    QueueSectionComponent,
    MatSelectModule,
    MatSnackBarModule,
    MatTabsModule,
    PageHeaderComponent,
    PanelSkeletonComponent,
    AdminAppealsComponent,
    AdminDestinationsComponent,
    AdminReportsComponent,
  ],
  templateUrl: "./admin.component.html",
  styleUrl: "./admin.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(ApiService);
  private readonly snackbar = inject(MatSnackBar);
  private readonly actions = inject(ActionDialogService);

  // The console's own sources: the two snapshots above the tabs and the guards
  // that keep a late answer from landing on a newer one.
  private readonly reloadRequests = new LatestRequest(this.destroyRef);

  /** Tabs opened at least once; a closed one makes no request at all. */
  private readonly openedTabs = new Set<number>();
  private readonly overviewRequests = new LatestRequest(this.destroyRef);
  private readonly operationsRequests = new LatestRequest(this.destroyRef);

  readonly overview = signal<AdminOverview | null>(null);
  readonly operations = signal<AdminOperations | null>(null);

  readonly initialLoading = signal(true);
  readonly refreshing = signal(false);
  readonly summaryError = signal<string | null>(null);
  readonly operationsLoading = signal(false);
  readonly operationsError = signal<string | null>(null);
  readonly actionKey = signal<string | null>(null);

  // Each paged queue declares its filters and its request; the page on screen,
  // the loading flag, the notice and the cancel-on-supersede rule come from the
  // shared engine, and the frame drawn around them from the shared component.
  readonly userQuery = signal("");
  readonly userStatus = signal<UserStatus>("");
  readonly users = new QueuePaging<AdminUser>({
    destroyRef: this.destroyRef,
    fallback: "No se pudieron cargar los usuarios",
    message: adminMessage,
    filters: () => [this.userQuery(), this.userStatus()],
    read: async (page, perPage, signal) => {
      const response = await this.api.get(
        "/api/v1/admin/users",
        { q: this.userQuery(), status: this.userStatus(), page, perPage },
        (value) => decodeAdminUsersPage(value, { page, perPage }),
        { signal },
      );
      return { rows: response.users ?? [], total: response.total };
    },
  });

  readonly recoveryQuery = signal("");
  readonly recoveryStatus = signal<RecoveryStatus>("");
  readonly recoveries = new QueuePaging<AdminAccountRecovery>({
    destroyRef: this.destroyRef,
    fallback: "No se pudieron cargar las recuperaciones",
    message: adminMessage,
    filters: () => [this.recoveryQuery(), this.recoveryStatus()],
    read: async (page, perPage, signal) => {
      const response = await this.api.get(
        "/api/v1/admin/account-recoveries",
        { q: this.recoveryQuery(), status: this.recoveryStatus(), page, perPage },
        (value) => decodeAdminRecoveriesPage(value, { page, perPage }),
        { signal },
      );
      return { rows: response.recoveries ?? [], total: response.total };
    },
  });

  readonly domainQuery = signal("");
  readonly domainState = signal<DomainFilter>("");
  readonly domains = new QueuePaging<AdminDomain>({
    destroyRef: this.destroyRef,
    fallback: "No se pudieron cargar los dominios",
    message: adminMessage,
    filters: () => [this.domainQuery(), this.domainState()],
    read: async (page, perPage, signal) => {
      const response = await this.api.get(
        "/api/v1/admin/domains",
        { q: this.domainQuery(), state: this.domainState(), page, perPage },
        (value) => decodeAdminDomainsPage(value, { page, perPage }),
        { signal },
      );
      return { rows: response.domains ?? [], total: response.total };
    },
  });

  readonly auditQuery = signal("");
  readonly audit = new QueuePaging<AuditEvent>({
    destroyRef: this.destroyRef,
    fallback: "No se pudo cargar la auditoría",
    message: adminMessage,
    pageSize: 50,
    filters: () => [this.auditQuery()],
    read: async (page, perPage, signal) => {
      const response = await this.api.get(
        "/api/v1/admin/audit",
        { q: this.auditQuery(), page, perPage },
        (value) => decodeAdminAuditPage(value, { page, perPage }),
        { signal },
      );
      return { rows: response.events ?? [], total: response.total };
    },
  });

  readonly mailStatus = signal<MailStatusFilter>("failed");
  readonly mail = new QueuePaging<AdminMailOutboxMessage>({
    destroyRef: this.destroyRef,
    fallback: "No se pudo cargar el outbox de correo",
    message: adminMessage,
    filters: () => [this.mailStatus()],
    read: async (page, perPage, signal) => {
      const response = await this.api.get(
        "/api/v1/admin/mail-outbox",
        { status: this.mailStatus(), page, perPage },
        (value) => decodeAdminMailPage(value, { page, perPage }),
        { signal },
      );
      return { rows: response.messages ?? [], total: response.total };
    },
  });

  readonly privacyStatus = signal<PrivacyStatusFilter>("");
  readonly privacyType = signal<PrivacyTypeFilter>("");
  readonly privacy = new QueuePaging<PrivacyRightRequest>({
    destroyRef: this.destroyRef,
    fallback: "No se pudieron cargar las solicitudes de privacidad",
    message: adminMessage,
    pageSize: 20,
    filters: () => [this.privacyStatus(), this.privacyType()],
    read: async (page, perPage, signal) => {
      const response = await this.api.get(
        "/api/v1/admin/privacy-requests",
        { status: this.privacyStatus(), type: this.privacyType(), page, perPage },
        (value) => decodePrivacyRequestsPage(value, { page, perPage, admin: true }),
        { signal },
      );
      return { rows: response.requests ?? [], total: response.total };
    },
  });

  /**
   * The console's signal that what the moderation views describe has changed.
   *
   * It is what the three queues of the moderation tab listen to, so none of them
   * has to know which sibling acted: the console decides when they re-read.
   */
  readonly moderationRevision = signal(0);

  // Every state label and every filter option this console prints comes from the
  // vocabulary of the entity it describes, so a badge and the filter that selects
  // it cannot name the same state differently.
  readonly domainLabel = domainStateLabel;
  readonly recoveryLabel = accountRecoveryStateLabel;
  readonly mailStatusLabel = mailOutboxStateLabel;
  readonly privacyStatusLabel = privacyRightStatusLabel;
  readonly privacyTypeLabel = privacyRightTypeLabel;
  readonly privacyActive = privacyRightIsActive;
  readonly accountStateLabel = adminAccountStateLabel;

  readonly accountFlags = ADMIN_ACCOUNT_FLAG_LABEL;
  readonly userFilters = ADMIN_USER_FILTERS;
  readonly domainStateOptions = DOMAIN_STATE_ORDER;
  readonly recoveryStatusOptions = ACCOUNT_RECOVERY_REVIEW_FILTER;
  readonly mailStatusOptions = MAIL_OUTBOX_STATE_ORDER;
  readonly privacyStatusOptions = PRIVACY_RIGHT_STATUS_ORDER;
  readonly privacyTypeOptions = PRIVACY_RIGHT_TYPE_ORDER;

  /** Number agreement for the counts this screen prints, in one place. */
  readonly countLabel = countLabel;
  readonly formatDate = dateTimeLabel;

  constructor() {
    void this.start();
  }

  /**
   * The first paint: the two snapshots above the tabs and the queue of the tab
   * that is already open. Every other queue reads nothing until its tab is
   * opened, and the moderation queues read when their tab first instantiates —
   * a closed tab asks for nothing.
   */
  private async start(): Promise<void> {
    this.openTab(0);
    await Promise.all([this.loadOverview(), this.loadOperations()]);
    this.initialLoading.set(false);
  }

  /** Tab position to the queue it pages; moderation owns its queues inside its own lazy content. */
  private queueForTab(index: number): { load: () => Promise<void> } | null {
    const queues: Array<{ load: () => Promise<void> } | null> = [
      this.users, this.recoveries, null, this.domains, this.audit, this.privacy, this.mail,
    ];

    return queues[index] ?? null;
  }

  /** A tab reads its queue once, when first opened. */
  openTab(index: number): void {
    if (this.openedTabs.has(index)) return;
    this.openedTabs.add(index);
    const queue = this.queueForTab(index);
    if (queue) void queue.load();
  }

  async reloadAll(): Promise<void> {
    const request = this.reloadRequests.begin(null);
    this.refreshing.set(true);
    // The queues of the moderation tab re-read on the revision instead of being
    // awaited here: each one reports its own progress inside its own tab.
    this.moderationRevision.update((value) => value + 1);
    await Promise.all([
      this.loadOverview(),
      this.loadOperations(),
      this.users.load(),
      this.recoveries.load(),
      this.domains.load(),
      this.audit.load(),
      this.mail.load(),
      this.privacy.load(),
    ]);
    if (!this.reloadRequests.isCurrent(request, null)) return;
    this.initialLoading.set(false);
    this.refreshing.set(false);
  }

  searchRecoveries(query: string): void {
    this.recoveryQuery.set(query.trim());
    this.recoveries.restart();
  }

  filterRecoveries(status: RecoveryStatus): void {
    this.recoveryStatus.set(status);
    this.recoveries.restart();
  }

  async approveRecovery(recovery: AdminAccountRecovery): Promise<void> {
    const confirmed = await this.actions.confirm({
      title: "Registrar aprobación independiente",
      message: `Confirma únicamente si has verificado personalmente la identidad de ${recovery.email} mediante el procedimiento externo aprobado. Esta decisión queda auditada y no sustituye la aprobación de otro administrador.`,
      confirmLabel: "He verificado la identidad",
      destructive: false,
    });
    if (!confirmed || this.actionKey()) return;
    await this.decideRecovery(recovery, "approve", "identity_verified_external");
  }

  async rejectRecovery(recovery: AdminAccountRecovery): Promise<void> {
    const confirmed = await this.actions.confirm({
      title: "Rechazar recuperación",
      message: `El expediente de ${recovery.email} se cerrará sin cambiar la contraseña, MFA ni sesiones de la cuenta.`,
      confirmLabel: "Rechazar expediente",
      destructive: true,
    });
    if (!confirmed || this.actionKey()) return;
    await this.decideRecovery(recovery, "reject", "insufficient_evidence");
  }

  private async decideRecovery(recovery: AdminAccountRecovery, decision: "approve" | "reject", reasonCode: string): Promise<void> {
    this.actionKey.set(`recovery-${recovery.id}`);
    try {
      const result = await this.api.post<{ status: AccountRecoveryStatus; approvalCount: number }>(`/api/v1/admin/account-recoveries/${recovery.id}/decision`, {
        decision,
        reasonCode,
        identityVerified: decision === "approve",
      }, decodeAccountRecoveryDecision);
      const message = result.status === "approved"
        ? "Doble aprobación completada; se ha emitido un enlace de 30 minutos"
        : result.status === "in_review"
          ? "Primera aprobación registrada; falta otro administrador"
          : "Expediente rechazado sin modificar la cuenta";
      this.snackbar.open(message, "Cerrar", { duration: 4000 });
      await Promise.all([this.recoveries.load(), this.audit.load(), this.loadOperations()]);
    } catch (error) {
      this.showError(error);
    } finally {
      this.actionKey.set(null);
    }
  }

  async loadOverview(): Promise<void> {
    const request = this.overviewRequests.begin(null);
    this.summaryError.set(null);
    try {
      const response = await this.api.get<AdminOverview>("/api/v1/admin/overview", undefined, decodeAdminOverview, { signal: request.signal });
      if (!this.overviewRequests.isCurrent(request, null)) return;
      this.overview.set(response);
    } catch (error) {
      if (!this.overviewRequests.isCurrent(request, null)) return;
      this.summaryError.set(adminMessage(error, "No se pudo cargar el resumen"));
    }
  }

  searchUsers(query: string): void {
    this.userQuery.set(query.trim());
    this.users.restart();
  }

  filterUsers(status: UserStatus): void {
    this.userStatus.set(status);
    this.users.restart();
  }

  isAdminUser(user: AdminUser): boolean {
    return user.is_admin === true || user.is_admin === 1;
  }

  hasMfa(user: AdminUser): boolean {
    return user.mfa_enabled === true || user.mfa_enabled === 1;
  }

  async toggleAdmin(user: AdminUser): Promise<void> {
    const granting = !this.isAdminUser(user);
    const confirmed = await this.actions.confirm({
      title: granting ? "Conceder acceso administrador" : "Retirar acceso administrador",
      message: granting
        ? `${user.email} podrá gestionar cuentas, moderación y operación de la plataforma. El acceso seguirá requiriendo MFA.`
        : `${user.email} dejará de acceder a la consola administrativa.`,
      confirmLabel: granting ? "Conceder acceso" : "Retirar acceso",
      destructive: !granting,
    });
    if (!confirmed || this.actionKey()) return;

    const key = `admin-${user.id}`;
    this.actionKey.set(key);
    try {
      await this.api.patch(`/api/v1/admin/users/${user.id}`, { isAdmin: granting });
      this.snackbar.open("Permisos actualizados", "Cerrar", { duration: 2500 });
      await Promise.all([this.users.load(), this.audit.load()]);
    } catch (error) {
      this.showError(error);
    } finally {
      this.actionKey.set(null);
    }
  }

  async toggleBlock(user: AdminUser): Promise<void> {
    const blocking = !user.deleted_at;
    const confirmed = await this.actions.confirm({
      title: blocking ? "Bloquear cuenta" : "Restaurar cuenta",
      message: blocking
        ? `Se cerrarán las sesiones de ${user.email} y se invalidarán sus tokens de API y recuperación pendientes.`
        : `${user.email} podrá volver a iniciar sesión. Sus sesiones y tokens anteriores seguirán invalidados.`,
      confirmLabel: blocking ? "Bloquear cuenta" : "Restaurar cuenta",
      destructive: blocking,
    });
    if (!confirmed || this.actionKey()) return;

    const key = `block-${user.id}`;
    this.actionKey.set(key);
    try {
      await this.api.patch(`/api/v1/admin/users/${user.id}`, { blocked: blocking });
      this.snackbar.open(blocking ? "Cuenta bloqueada" : "Cuenta restaurada", "Cerrar", { duration: 2500 });
      await Promise.all([this.users.load(), this.loadOverview(), this.loadOperations(), this.audit.load()]);
    } catch (error) {
      this.showError(error);
    } finally {
      this.actionKey.set(null);
    }
  }

  /**
   * A queue of the moderation tab decided something.
   *
   * The decision lands in three places the acting queue does not own: the
   * counters that summarise it, the trail that records it and the other queues
   * that print the same links. Each of those has to re-read, so the console is
   * the only place that knows what a decision invalidates.
   */
  onModerationChanged(): void {
    void this.refreshModeration();
  }

  /**
   * Re-read every view a moderation decision can change, and tell the queues
   * themselves to re-read: the two queues print the state of the same links and
   * the blocked-destination list is where a case writes, so a decision lands in
   * all of them or in none.
   */
  private async refreshModeration(): Promise<void> {
    this.moderationRevision.update((value) => value + 1);
    await Promise.all([this.loadOverview(), this.loadOperations(), this.audit.load()]);
  }

  searchDomains(query: string): void {
    this.domainQuery.set(query.trim());
    this.domains.restart();
  }

  filterDomains(state: DomainFilter): void {
    this.domainState.set(state);
    this.domains.restart();
  }

  searchAudit(query: string): void {
    this.auditQuery.set(query.trim());
    this.audit.restart();
  }

  async loadOperations(): Promise<void> {
    const request = this.operationsRequests.begin(null);
    this.operationsLoading.set(true);
    this.operationsError.set(null);
    try {
      const response = await this.api.get<AdminOperations>("/api/v1/admin/operations", undefined, decodeAdminOperations, { signal: request.signal });
      if (!this.operationsRequests.isCurrent(request, null)) return;
      this.operations.set(response);
    } catch (error) {
      if (!this.operationsRequests.isCurrent(request, null)) return;
      this.operationsError.set(adminMessage(error, "No se pudo leer el estado operativo"));
    } finally {
      if (this.operationsRequests.isCurrent(request, null)) this.operationsLoading.set(false);
    }
  }

  filterMail(status: MailStatusFilter): void {
    this.mailStatus.set(status);
    this.mail.restart();
  }

  async retryMail(message: AdminMailOutboxMessage): Promise<void> {
    if (!message.retryable || this.actionKey()) return;
    const confirmed = await this.actions.confirm({
      title: "Reintentar correo transaccional",
      message: "Se volverá a comprobar el estado del evento antes de publicar el correo. El destinatario y el contenido permanecen cifrados y no se muestran en esta consola.",
      confirmLabel: "Reintentar entrega",
      destructive: false,
    });
    if (!confirmed) return;

    this.actionKey.set(`mail-${message.id}`);
    try {
      await this.api.post(`/api/v1/admin/mail-outbox/${message.id}/retry`, {});
      this.snackbar.open("Correo admitido de nuevo en la cola", "Cerrar", { duration: 3000 });
      await Promise.all([this.mail.load(), this.loadOperations(), this.audit.load()]);
    } catch (error) {
      this.showError(error);
      await this.mail.load();
    } finally {
      this.actionKey.set(null);
    }
  }

  filterPrivacyStatus(status: PrivacyStatusFilter): void {
    this.privacyStatus.set(status);
    this.privacy.restart();
  }

  filterPrivacyType(type: PrivacyTypeFilter): void {
    this.privacyType.set(type);
    this.privacy.restart();
  }

  async startPrivacyReview(request: PrivacyRightRequest): Promise<void> {
    await this.runPrivacyAction(request, "start_review", "");
  }

  async requestPrivacyInformation(request: PrivacyRightRequest): Promise<void> {
    const message = await this.privacyMessage("Solicitar información", "Explica qué información adicional es necesaria. No solicites contraseñas, códigos MFA ni documentos por este canal.", "Enviar petición");
    if (message) await this.runPrivacyAction(request, "request_information", message);
  }

  async completePrivacy(request: PrivacyRightRequest): Promise<void> {
    const message = await this.privacyMessage("Resolver solicitud", "Redacta una respuesta autosuficiente que describa las medidas aplicadas o los datos facilitados.", "Registrar resolución");
    if (message) await this.runPrivacyAction(request, "complete", message);
  }

  async rejectPrivacy(request: PrivacyRightRequest): Promise<void> {
    const message = await this.privacyMessage("Cerrar con respuesta motivada", "Explica de forma concreta el fundamento, las alternativas y las vías de reclamación aplicables.", "Cerrar expediente", true);
    if (message) await this.runPrivacyAction(request, "reject", message);
  }

  async extendPrivacy(request: PrivacyRightRequest, reasonCode: "complexity" | "request_volume"): Promise<void> {
    const message = await this.privacyMessage("Ampliar plazo", "Explica por qué la complejidad o el volumen impiden responder dentro del mes ordinario.", "Notificar ampliación");
    if (message) await this.runPrivacyAction(request, "extend", message, reasonCode);
  }

  private async privacyMessage(title: string, message: string, confirmLabel: string, destructive = false): Promise<string | null> {
    return this.actions.prompt({
      title,
      message,
      confirmLabel,
      destructive,
      inputLabel: "Respuesta para el expediente",
      inputPlaceholder: "Respuesta clara y verificable…",
      inputHint: "Entre 10 y 2.000 caracteres.",
      inputRequired: true,
      inputMinLength: 10,
      inputMaxLength: 2000,
    });
  }

  private async runPrivacyAction(request: PrivacyRightRequest, action: "start_review" | "request_information" | "complete" | "reject" | "extend", message: string, reasonCode = ""): Promise<void> {
    if (this.actionKey()) return;
    this.actionKey.set(`privacy-${request.id}`);
    try {
      await this.api.post(`/api/v1/admin/privacy-requests/${request.id}/action`, { action, message, reasonCode });
      this.snackbar.open("Expediente actualizado", "Cerrar", { duration: 3000 });
      await Promise.all([this.privacy.load(), this.loadOperations(), this.audit.load()]);
    } catch (error) {
      this.showError(error);
    } finally {
      this.actionKey.set(null);
    }
  }

  count(map: Record<string, number>, key: string): number {
    return map[key] ?? 0;
  }

  /**
   * The trail identifies an action by its code, and this tab's own search
   * matches that code verbatim. Stood in for a translation it used to be
   * rewritten as `link · create`, which looked like a label and was not one:
   * pasting back what you read returned nothing. Print the identifier intact.
   */
  auditLabel(action: string): string {
    return action;
  }

  /** Same vocabulary as the workspace activity list, for the same trail. */
  resourceLabel(type: string | null): string {
    return resourceTypeLabel(type);
  }

  /** Which deployment this process is running in, said in the panel's language. */
  environmentLabel(value: string): string {
    return ({ local: "Desarrollo local", testing: "Pruebas", staging: "Preproducción", production: "Producción" } as Record<string, string>)[value] ?? value;
  }

  ageLabel(seconds: number | null): string {
    if (seconds === null) return "Sin espera";
    if (seconds < 60) return `${seconds} s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
    return `${Math.floor(seconds / 3600)} h`;
  }

  private showError(error: unknown): void {
    this.snackbar.open(apiMessage(error, "No se pudo completar la acción"), "Cerrar", { duration: 4000 });
  }
}
