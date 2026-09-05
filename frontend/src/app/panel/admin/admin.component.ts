import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatPaginatorModule, type PageEvent } from "@angular/material/paginator";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSelectModule } from "@angular/material/select";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { MatTabsModule } from "@angular/material/tabs";
import { MatTooltipModule } from "@angular/material/tooltip";
import type {
  AdminDomain,
  AdminAccountRecovery,
  AdminMailOutboxMessage,
  AdminOperations,
  AdminOverview,
  AdminReport,
  AdminUser,
  AuditEvent,
  AccountRecoveryStatus,
  DomainState,
  MailOutboxStatus,
  PrivacyRightRequest,
  PrivacyRightStatus,
  PrivacyRightType,
} from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { ActionDialogService } from "../action-dialog.service";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";

interface PageResponse<T> {
  total: number;
  page: number;
  perPage: number;
  users?: T[];
  reports?: T[];
  recoveries?: T[];
  domains?: T[];
  events?: T[];
  messages?: T[];
  requests?: T[];
}

type UserStatus = "" | "active" | "blocked" | "unverified" | "admin" | "mfa";
type ReportStatus = "" | AdminReport["status"];
type RecoveryStatus = "" | AccountRecoveryStatus;
type DomainFilter = "" | DomainState;
type MailStatusFilter = "" | MailOutboxStatus;
type PrivacyStatusFilter = "" | PrivacyRightStatus;
type PrivacyTypeFilter = "" | PrivacyRightType;

const DOMAIN_LABELS: Record<DomainState, string> = {
  pending: "Pendiente",
  verifying: "Verificando",
  verified: "Verificado",
  provisioning: "Emitiendo certificado",
  active: "Activo",
  error: "Error",
  disabled: "Desactivado",
};

const REPORT_LABELS: Record<AdminReport["status"], string> = {
  open: "Abierta",
  reviewed: "Revisada",
  actioned: "Resuelta",
  dismissed: "Desestimada",
};

const RECOVERY_LABELS: Record<AccountRecoveryStatus, string> = {
  requested: "Email pendiente",
  email_confirmed: "Lista para revisar",
  in_review: "En revisión",
  approved: "Aprobada",
  rejected: "Rechazada",
  completed: "Completada",
  expired: "Caducada",
  cancelled: "Cancelada",
};

@Component({
  selector: "app-admin",
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTabsModule,
    MatTooltipModule,
    PageHeaderComponent,
    PanelSkeletonComponent,
  ],
  templateUrl: "./admin.component.html",
  styleUrl: "./admin.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminComponent {
  private readonly api = inject(ApiService);
  private readonly snackbar = inject(MatSnackBar);
  private readonly actions = inject(ActionDialogService);

  readonly overview = signal<AdminOverview | null>(null);
  readonly operations = signal<AdminOperations | null>(null);
  readonly users = signal<AdminUser[]>([]);
  readonly reports = signal<AdminReport[]>([]);
  readonly recoveries = signal<AdminAccountRecovery[]>([]);
  readonly domains = signal<AdminDomain[]>([]);
  readonly events = signal<AuditEvent[]>([]);
  readonly mailMessages = signal<AdminMailOutboxMessage[]>([]);
  readonly privacyRequests = signal<PrivacyRightRequest[]>([]);

  readonly initialLoading = signal(true);
  readonly refreshing = signal(false);
  readonly summaryError = signal<string | null>(null);
  readonly usersLoading = signal(false);
  readonly usersError = signal<string | null>(null);
  readonly reportsLoading = signal(false);
  readonly reportsError = signal<string | null>(null);
  readonly recoveriesLoading = signal(false);
  readonly recoveriesError = signal<string | null>(null);
  readonly domainsLoading = signal(false);
  readonly domainsError = signal<string | null>(null);
  readonly auditLoading = signal(false);
  readonly auditError = signal<string | null>(null);
  readonly operationsLoading = signal(false);
  readonly operationsError = signal<string | null>(null);
  readonly mailLoading = signal(false);
  readonly mailError = signal<string | null>(null);
  readonly privacyLoading = signal(false);
  readonly privacyError = signal<string | null>(null);
  readonly actionKey = signal<string | null>(null);

  readonly userQuery = signal("");
  readonly userStatus = signal<UserStatus>("");
  readonly usersTotal = signal(0);
  readonly usersPage = signal(0);
  readonly usersPageSize = signal(25);

  readonly reportQuery = signal("");
  readonly reportStatus = signal<ReportStatus>("open");
  readonly reportsTotal = signal(0);
  readonly reportsPage = signal(0);
  readonly reportsPageSize = signal(25);

  readonly recoveryQuery = signal("");
  readonly recoveryStatus = signal<RecoveryStatus>("");
  readonly recoveriesTotal = signal(0);
  readonly recoveriesPage = signal(0);
  readonly recoveriesPageSize = signal(25);

  readonly domainQuery = signal("");
  readonly domainState = signal<DomainFilter>("");
  readonly domainsTotal = signal(0);
  readonly domainsPage = signal(0);
  readonly domainsPageSize = signal(25);

  readonly auditQuery = signal("");
  readonly auditTotal = signal(0);
  readonly auditPage = signal(0);
  readonly auditPageSize = signal(50);

  readonly mailStatus = signal<MailStatusFilter>("failed");
  readonly mailTotal = signal(0);
  readonly mailPage = signal(0);
  readonly mailPageSize = signal(25);

  readonly privacyStatus = signal<PrivacyStatusFilter>("");
  readonly privacyType = signal<PrivacyTypeFilter>("");
  readonly privacyTotal = signal(0);
  readonly privacyPage = signal(0);
  readonly privacyPageSize = signal(20);

  readonly domainLabel = (state: DomainState) => DOMAIN_LABELS[state] ?? state;
  readonly reportLabel = (status: AdminReport["status"]) => REPORT_LABELS[status] ?? status;
  readonly recoveryLabel = (status: AccountRecoveryStatus) => RECOVERY_LABELS[status] ?? status;

  countLabel(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  constructor() {
    void this.reloadAll();
  }

  async reloadAll(): Promise<void> {
    this.refreshing.set(true);
    await Promise.all([
      this.loadOverview(),
      this.loadOperations(),
      this.loadUsers(),
      this.loadRecoveries(),
      this.loadReports(),
      this.loadDomains(),
      this.loadAudit(),
      this.loadMailOutbox(),
      this.loadPrivacyRequests(),
    ]);
    this.initialLoading.set(false);
    this.refreshing.set(false);
  }

  async loadRecoveries(): Promise<void> {
    this.recoveriesLoading.set(true);
    this.recoveriesError.set(null);
    try {
      const response = await this.api.get<PageResponse<AdminAccountRecovery>>("/api/v1/admin/account-recoveries", {
        q: this.recoveryQuery(),
        status: this.recoveryStatus(),
        page: this.recoveriesPage() + 1,
        perPage: this.recoveriesPageSize(),
      });
      this.recoveries.set(response.recoveries ?? []);
      this.recoveriesTotal.set(response.total);
    } catch (error) {
      this.recoveriesError.set(this.adminError(error, "No se pudieron cargar las recuperaciones"));
    } finally {
      this.recoveriesLoading.set(false);
    }
  }

  searchRecoveries(query: string): void {
    this.recoveryQuery.set(query.trim());
    this.recoveriesPage.set(0);
    void this.loadRecoveries();
  }

  filterRecoveries(status: RecoveryStatus): void {
    this.recoveryStatus.set(status);
    this.recoveriesPage.set(0);
    void this.loadRecoveries();
  }

  onRecoveriesPage(event: PageEvent): void {
    this.recoveriesPage.set(event.pageIndex);
    this.recoveriesPageSize.set(event.pageSize);
    void this.loadRecoveries();
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
      });
      const message = result.status === "approved"
        ? "Doble aprobación completada; se ha emitido un enlace de 30 minutos"
        : result.status === "in_review"
          ? "Primera aprobación registrada; falta otro administrador"
          : "Expediente rechazado sin modificar la cuenta";
      this.snackbar.open(message, "Cerrar", { duration: 4000 });
      await Promise.all([this.loadRecoveries(), this.loadAudit(), this.loadOperations()]);
    } catch (error) {
      this.showError(error);
    } finally {
      this.actionKey.set(null);
    }
  }

  async loadOverview(): Promise<void> {
    this.summaryError.set(null);
    try {
      this.overview.set(await this.api.get<AdminOverview>("/api/v1/admin/overview"));
    } catch (error) {
      this.summaryError.set(this.adminError(error, "No se pudo cargar el resumen"));
    }
  }

  async loadUsers(): Promise<void> {
    this.usersLoading.set(true);
    this.usersError.set(null);
    try {
      const response = await this.api.get<PageResponse<AdminUser>>("/api/v1/admin/users", {
        q: this.userQuery(),
        status: this.userStatus(),
        page: this.usersPage() + 1,
        perPage: this.usersPageSize(),
      });
      this.users.set(response.users ?? []);
      this.usersTotal.set(response.total);
    } catch (error) {
      this.usersError.set(this.errorMessage(error, "No se pudieron cargar los usuarios"));
    } finally {
      this.usersLoading.set(false);
    }
  }

  searchUsers(query: string): void {
    this.userQuery.set(query.trim());
    this.usersPage.set(0);
    void this.loadUsers();
  }

  filterUsers(status: UserStatus): void {
    this.userStatus.set(status);
    this.usersPage.set(0);
    void this.loadUsers();
  }

  onUsersPage(event: PageEvent): void {
    this.usersPage.set(event.pageIndex);
    this.usersPageSize.set(event.pageSize);
    void this.loadUsers();
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
      await Promise.all([this.loadUsers(), this.loadAudit()]);
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
      await Promise.all([this.loadUsers(), this.loadOverview(), this.loadOperations(), this.loadAudit()]);
    } catch (error) {
      this.showError(error);
    } finally {
      this.actionKey.set(null);
    }
  }

  async loadReports(): Promise<void> {
    this.reportsLoading.set(true);
    this.reportsError.set(null);
    try {
      const response = await this.api.get<PageResponse<AdminReport>>("/api/v1/admin/reports", {
        q: this.reportQuery(),
        status: this.reportStatus(),
        page: this.reportsPage() + 1,
        perPage: this.reportsPageSize(),
      });
      this.reports.set(response.reports ?? []);
      this.reportsTotal.set(response.total);
    } catch (error) {
      this.reportsError.set(this.errorMessage(error, "No se pudieron cargar las denuncias"));
    } finally {
      this.reportsLoading.set(false);
    }
  }

  searchReports(query: string): void {
    this.reportQuery.set(query.trim());
    this.reportsPage.set(0);
    void this.loadReports();
  }

  filterReports(status: ReportStatus): void {
    this.reportStatus.set(status);
    this.reportsPage.set(0);
    void this.loadReports();
  }

  onReportsPage(event: PageEvent): void {
    this.reportsPage.set(event.pageIndex);
    this.reportsPageSize.set(event.pageSize);
    void this.loadReports();
  }

  async reviewReport(report: AdminReport): Promise<void> {
    await this.moderate(report, "review", "Denuncia marcada como revisada");
  }

  async dismissReport(report: AdminReport): Promise<void> {
    const confirmed = await this.actions.confirm({
      title: "Desestimar denuncia",
      message: `La denuncia sobre “${report.alias}” se cerrará sin modificar el enlace.`,
      confirmLabel: "Desestimar",
      destructive: false,
    });
    if (confirmed) await this.moderate(report, "dismiss", "Denuncia desestimada");
  }

  async blockLink(report: AdminReport): Promise<void> {
    const reason = await this.actions.prompt({
      title: "Bloquear enlace",
      message: `La resolución de “${report.alias}” se detendrá y la denuncia quedará resuelta.`,
      confirmLabel: "Bloquear enlace",
      destructive: true,
      inputLabel: "Motivo del bloqueo",
      inputPlaceholder: "Describe el incumplimiento…",
      inputHint: "Entre 3 y 500 caracteres.",
      inputRequired: true,
      inputMinLength: 3,
      inputMaxLength: 500,
    });
    if (reason) await this.moderate(report, "block", "Enlace bloqueado", reason);
  }

  async unblockLink(report: AdminReport): Promise<void> {
    const confirmed = await this.actions.confirm({
      title: "Desbloquear enlace",
      message: `“${report.alias}” volverá al estado que corresponda según su programación y caducidad.`,
      confirmLabel: "Desbloquear",
      destructive: false,
    });
    if (confirmed) await this.moderate(report, "unblock", "Enlace desbloqueado");
  }

  async loadDomains(): Promise<void> {
    this.domainsLoading.set(true);
    this.domainsError.set(null);
    try {
      const response = await this.api.get<PageResponse<AdminDomain>>("/api/v1/admin/domains", {
        q: this.domainQuery(),
        state: this.domainState(),
        page: this.domainsPage() + 1,
        perPage: this.domainsPageSize(),
      });
      this.domains.set(response.domains ?? []);
      this.domainsTotal.set(response.total);
    } catch (error) {
      this.domainsError.set(this.errorMessage(error, "No se pudieron cargar los dominios"));
    } finally {
      this.domainsLoading.set(false);
    }
  }

  searchDomains(query: string): void {
    this.domainQuery.set(query.trim());
    this.domainsPage.set(0);
    void this.loadDomains();
  }

  filterDomains(state: DomainFilter): void {
    this.domainState.set(state);
    this.domainsPage.set(0);
    void this.loadDomains();
  }

  onDomainsPage(event: PageEvent): void {
    this.domainsPage.set(event.pageIndex);
    this.domainsPageSize.set(event.pageSize);
    void this.loadDomains();
  }

  async loadAudit(): Promise<void> {
    this.auditLoading.set(true);
    this.auditError.set(null);
    try {
      const response = await this.api.get<PageResponse<AuditEvent>>("/api/v1/admin/audit", {
        q: this.auditQuery(),
        page: this.auditPage() + 1,
        perPage: this.auditPageSize(),
      });
      this.events.set(response.events ?? []);
      this.auditTotal.set(response.total);
    } catch (error) {
      this.auditError.set(this.errorMessage(error, "No se pudo cargar la auditoría"));
    } finally {
      this.auditLoading.set(false);
    }
  }

  searchAudit(query: string): void {
    this.auditQuery.set(query.trim());
    this.auditPage.set(0);
    void this.loadAudit();
  }

  onAuditPage(event: PageEvent): void {
    this.auditPage.set(event.pageIndex);
    this.auditPageSize.set(event.pageSize);
    void this.loadAudit();
  }

  async loadOperations(): Promise<void> {
    this.operationsLoading.set(true);
    this.operationsError.set(null);
    try {
      this.operations.set(await this.api.get<AdminOperations>("/api/v1/admin/operations"));
    } catch (error) {
      this.operationsError.set(this.errorMessage(error, "No se pudo leer el estado operativo"));
    } finally {
      this.operationsLoading.set(false);
    }
  }

  async loadMailOutbox(): Promise<void> {
    this.mailLoading.set(true);
    this.mailError.set(null);
    try {
      const response = await this.api.get<PageResponse<AdminMailOutboxMessage>>("/api/v1/admin/mail-outbox", {
        status: this.mailStatus(),
        page: this.mailPage() + 1,
        perPage: this.mailPageSize(),
      });
      this.mailMessages.set(response.messages ?? []);
      this.mailTotal.set(response.total);
    } catch (error) {
      this.mailError.set(this.adminError(error, "No se pudo cargar el outbox de correo"));
    } finally {
      this.mailLoading.set(false);
    }
  }

  filterMail(status: MailStatusFilter): void {
    this.mailStatus.set(status);
    this.mailPage.set(0);
    void this.loadMailOutbox();
  }

  onMailPage(event: PageEvent): void {
    this.mailPage.set(event.pageIndex);
    this.mailPageSize.set(event.pageSize);
    void this.loadMailOutbox();
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
      await Promise.all([this.loadMailOutbox(), this.loadOperations(), this.loadAudit()]);
    } catch (error) {
      this.showError(error);
      await this.loadMailOutbox();
    } finally {
      this.actionKey.set(null);
    }
  }

  mailStatusLabel(status: MailOutboxStatus): string {
    return ({
      pending: "Pendiente",
      queued: "En cola",
      processing: "Procesando",
      sent: "Enviado",
      failed: "Fallido",
      obsolete: "Obsoleto",
      comp_pending: "Compensación pendiente",
      compensating: "Compensando",
      compensated: "Compensado",
    })[status];
  }

  async loadPrivacyRequests(): Promise<void> {
    this.privacyLoading.set(true);
    this.privacyError.set(null);
    try {
      const response = await this.api.get<PageResponse<PrivacyRightRequest>>("/api/v1/admin/privacy-requests", {
        status: this.privacyStatus(),
        type: this.privacyType(),
        page: this.privacyPage() + 1,
        perPage: this.privacyPageSize(),
      });
      this.privacyRequests.set(response.requests ?? []);
      this.privacyTotal.set(response.total);
    } catch (error) {
      this.privacyError.set(this.adminError(error, "No se pudieron cargar las solicitudes de privacidad"));
    } finally {
      this.privacyLoading.set(false);
    }
  }

  filterPrivacyStatus(status: PrivacyStatusFilter): void {
    this.privacyStatus.set(status);
    this.privacyPage.set(0);
    void this.loadPrivacyRequests();
  }

  filterPrivacyType(type: PrivacyTypeFilter): void {
    this.privacyType.set(type);
    this.privacyPage.set(0);
    void this.loadPrivacyRequests();
  }

  onPrivacyPage(event: PageEvent): void {
    this.privacyPage.set(event.pageIndex);
    this.privacyPageSize.set(event.pageSize);
    void this.loadPrivacyRequests();
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

  privacyTypeLabel(type: PrivacyRightType): string {
    return ({ access: "Acceso", rectification: "Rectificación", erasure: "Supresión", objection: "Oposición", restriction: "Limitación", portability: "Portabilidad" })[type];
  }

  privacyStatusLabel(status: PrivacyRightStatus): string {
    return ({ submitted: "Registrada", in_progress: "En revisión", waiting_user: "Espera al usuario", completed: "Resuelta", rejected: "Cerrada", cancelled: "Cancelada" })[status];
  }

  privacyActive(status: PrivacyRightStatus): boolean {
    return ["submitted", "in_progress", "waiting_user"].includes(status);
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
      await Promise.all([this.loadPrivacyRequests(), this.loadOperations(), this.loadAudit()]);
    } catch (error) {
      this.showError(error);
    } finally {
      this.actionKey.set(null);
    }
  }

  count(map: Record<string, number>, key: string): number {
    return map[key] ?? 0;
  }

  auditLabel(action: string): string {
    return action.replace(/\./g, " · ");
  }

  formatDate(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("es-ES");
  }

  ageLabel(seconds: number | null): string {
    if (seconds === null) return "Sin espera";
    if (seconds < 60) return `${seconds} s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
    return `${Math.floor(seconds / 3600)} h`;
  }

  private async moderate(
    report: AdminReport,
    action: "block" | "unblock" | "review" | "dismiss",
    success: string,
    reason?: string,
  ): Promise<void> {
    if (this.actionKey()) return;
    this.actionKey.set(`report-${report.id}`);
    try {
      await this.api.post(`/api/v1/admin/reports/${report.id}/moderate`, { action, reason });
      this.snackbar.open(success, "Cerrar", { duration: 2500 });
      await Promise.all([this.loadReports(), this.loadOverview(), this.loadOperations(), this.loadAudit()]);
    } catch (error) {
      this.showError(error);
    } finally {
      this.actionKey.set(null);
    }
  }

  private adminError(error: unknown, fallback: string): string {
    if (error instanceof ApiRequestError && error.status === 403) {
      return "La consola requiere una sesión de administrador con MFA completado en este navegador.";
    }
    return this.errorMessage(error, fallback);
  }

  private errorMessage(error: unknown, fallback: string): string {
    return error instanceof ApiRequestError ? error.message : fallback;
  }

  private showError(error: unknown): void {
    this.snackbar.open(this.errorMessage(error, "No se pudo completar la acción"), "Cerrar", { duration: 4000 });
  }
}
