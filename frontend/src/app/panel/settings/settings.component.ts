import { Component, computed, inject, signal, ChangeDetectionStrategy, DestroyRef, ElementRef, Injector, viewChild, type AfterViewInit } from "@angular/core";
import { Location } from "@angular/common";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { MatDialog, MatDialogRef } from "@angular/material/dialog";
import { AccountDeletionDialogComponent } from "./account-deletion-dialog.component";
import { EmailAccessDialogComponent, type EmailAccessDialogData } from "./email-access-dialog.component";
import { PasswordChangeDialogComponent } from "./password-change-dialog.component";
import { DataExportDialogComponent, type DataExportDialogResult } from "./data-export-dialog.component";

import { ActivatedRoute, Router } from "@angular/router";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MAT_FORM_FIELD_DEFAULT_OPTIONS, MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { MatDividerModule } from "@angular/material/divider";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatSelectModule } from "@angular/material/select";
import { MatPaginatorModule, type PageEvent } from "@angular/material/paginator";
import QRCode from "qrcode";
import { dateTimeMediumLabel } from "../../core/date-time-label";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ThemeService, type ThemePreference } from "../../core/services/theme.service";
import { downloadBlob } from "../../core/services/browser-download";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import type { AccountDeletionImpact, DataExportStage, DataExportStatus, NotificationPreference, PrivacyRightRequest, PrivacyRightType, Session } from "../../core/models";
import {
  NOTIFICATION_DELIVERIES,
  NOTIFICATION_DELIVERY_LABELS,
  NOTIFICATION_KINDS,
  type NotificationDelivery,
  type NotificationKind,
} from "../../core/notification-kinds";
import { NotificationService } from "../../core/services/notification.service";
import {
  privacyRightIsActive,
  privacyRightStatusLabel,
  privacyRightTypeLabel,
  PRIVACY_RIGHT_TYPE_ORDER,
} from "../../core/privacy-right-label";
import { ActionDialogService } from "../action-dialog.service";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { LatestRequest } from "../../core/services/latest-request";
import { decodePrivacyRequestsPage } from "../../core/services/privacy-response-decoders";
import { AsyncPoller } from "../../core/async-poller";
import { AsyncOperationStatusComponent, type AsyncOperationTone } from "../async-operation-status.component";

@Component({
  selector: "app-settings",
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,

    MatDividerModule,
    MatCheckboxModule,
    MatSelectModule,
    MatPaginatorModule,
    PageHeaderComponent,
    PanelSkeletonComponent,
    AsyncOperationStatusComponent,
  ],
  templateUrl: "./settings.component.html",
  // Hints and validation messages must reserve their real height on narrow screens.
  providers: [{ provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { subscriptSizing: "dynamic" } }],
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./settings.component.scss",
})
export class SettingsComponent implements AfterViewInit {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private workspaces = inject(WorkspaceService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private theme = inject(ThemeService);
  private snackbar = inject(MatSnackBar);
  private actions = inject(ActionDialogService);
  private api = inject(ApiService);
  private destroyRef = inject(DestroyRef);
  private readonly dialogs = inject(MatDialog);
  private readonly injector = inject(Injector);
  private readonly notifications = inject(NotificationService);
  private deletionDialog?: MatDialogRef<AccountDeletionDialogComponent, boolean>;
  private emailDialog?: MatDialogRef<EmailAccessDialogComponent, boolean>;
  private passwordDialog?: MatDialogRef<PasswordChangeDialogComponent, boolean>;
  private exportDialog?: MatDialogRef<DataExportDialogComponent, DataExportDialogResult>;
  private sessionsRequest = new LatestRequest(this.destroyRef);
  private exportRequest = new LatestRequest(this.destroyRef);
  private exportHistoryRequest = new LatestRequest(this.destroyRef);
  private deletionRequest = new LatestRequest(this.destroyRef);
  private privacyRequest = new LatestRequest(this.destroyRef);
  readonly user = this.auth.user;
  /** Ruta canónica de cada sección: la URL nombra la sección que se está leyendo. */
  private static readonly SECTION_PATHS: Record<string, string> = {
    account: "/app/settings/profile",
    security: "/app/settings/security",
    notifications: "/app/settings/notifications",
    privacy: "/app/settings/privacy",
    danger: "/app/settings/danger",
  };
  private readonly accountSectionRef = viewChild<ElementRef<HTMLElement>>("accountSection");
  private readonly securitySectionRef = viewChild<ElementRef<HTMLElement>>("securitySection");
  private readonly notificationsSectionRef = viewChild<ElementRef<HTMLElement>>("notificationsSection");
  private readonly privacySectionRef = viewChild<ElementRef<HTMLElement>>("privacySection");
  private readonly dangerSectionRef = viewChild<ElementRef<HTMLElement>>("dangerSection");

  /** Keep local jumps inside this route despite the document's base href.
   * Focus follows the section so keyboard users continue at the destination.
   * No form is unmounted: unfinished MFA setup and recovery codes stay intact.
   */
  goToSection(event: Event, section: HTMLElement): void {
    event.preventDefault();
    this.jumpTo(section);
    // La barra de direcciones sigue a la sección visible para poder
    // compartirla. `replaceState` no navega: nada se re-renderiza ni se
    // desmonta, y el contrato de salto local se mantiene.
    const path = SettingsComponent.SECTION_PATHS[section.id];
    if (path) this.location.replaceState(path);
  }

  /** Una ruta de sección (`/app/settings/security`) activa su sección como un salto. */
  ngAfterViewInit(): void {
    const section = this.route.snapshot.data["section"] as string | undefined;
    const ref = section === "account" ? this.accountSectionRef()
      : section === "security" ? this.securitySectionRef()
        : section === "notifications" ? this.notificationsSectionRef()
          : section === "privacy" ? this.privacySectionRef()
            : section === "danger" ? this.dangerSectionRef()
              : null;
    if (ref) this.jumpTo(ref.nativeElement);
  }

  private jumpTo(section: HTMLElement): void {
    section.focus({ preventScroll: true });
    section.scrollIntoView({ block: "start", behavior: "instant" });
  }
  readonly userInitials = computed(() => {
    const parts = (this.user()?.name ?? "UVH").trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "UV";
  });

  // ---------------- Profile ----------------
  readonly profileBusy = signal(false);
  profileForm = this.fb.nonNullable.group({
    name: [this.user()?.name ?? "", [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
  });

  // ---------------- Sessions ----------------
  readonly sessions = signal<Session[]>([]);
  /** The server held session rows back, so this list is not the whole registry. */
  readonly sessionsTruncated = signal(false);
  readonly sessionsLoading = signal(true);
  readonly sessionsError = signal<string | null>(null);

  // ---------------- Data export ----------------
  readonly exportStatus = signal<DataExportStatus | null>(null);
  readonly exportLoading = signal(true);
  readonly exportBusy = signal(false);
  /** Historial acotado: las últimas diez filas, como el servidor. */
  readonly exportHistory = signal<DataExportStatus[]>([]);
  /**
   * Sondas automáticas SÓLO mientras la exportación se está generando: el
   * estado avanza solo y la página no debe pedir nada al usuario. La secuencia
   * crece 3→5→8→13→21→30 s y se reinicia cuando el estado cambia; se pausa con
   * la pestaña oculta y se retoma al volver. En `ready` no hay sondeo: la
   * descarga ya existe y un GET cada 30 s durante 48 h sólo gasta peticiones;
   * ahí la tarjeta se refresca al recuperar la pestaña y con un único
   * temporizador hasta la caducidad.
   */
  private static readonly EXPORT_POLL_DELAYS_MS = [3_000, 5_000, 8_000, 13_000, 21_000, 30_000];
  private exportPollLastStatus: DataExportStatus["status"] | null = null;
  private exportExpiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly exportPoller = new AsyncPoller({
    destroyRef: this.destroyRef,
    delays: SettingsComponent.EXPORT_POLL_DELAYS_MS,
    wantsMore: () => this.exportNeedsPoll(),
    attempt: () => void this.loadExportStatus(false, true),
  });
  private readonly privacyFormBlock = viewChild<ElementRef<HTMLElement>>("privacyFormBlock");
  // ---------------- Account deletion ----------------
  readonly deletionImpact = signal<AccountDeletionImpact | null>(null);
  readonly deletionLoading = signal(true);

  // ---------------- Privacy rights ----------------
  readonly privacyRequests = signal<PrivacyRightRequest[]>([]);
  readonly privacyLoading = signal(true);
  readonly privacyBusy = signal(false);
  readonly privacyError = signal<string | null>(null);
  readonly privacyPage = signal(0);
  readonly privacyPageSize = signal(5);
  readonly privacyTotal = signal(0);
  readonly privacyResponseId = signal<number | null>(null);
  privacyForm = this.fb.nonNullable.group({
    type: ["access" as PrivacyRightType, [Validators.required]],
    details: ["", [Validators.maxLength(2000)]],
  });
  privacyResponseForm = this.fb.nonNullable.group({
    message: ["", [Validators.required, Validators.minLength(10), Validators.maxLength(2000)]],
  });

  // ---------------- MFA ----------------
  readonly mfaBusy = signal(false);
  readonly mfaSecret = signal<string | null>(null);
  readonly mfaUri = signal<string | null>(null);
  readonly mfaQr = signal<string | null>(null);
  readonly recoveryCodes = signal<string[]>([]);
  readonly recoveryCodesAcknowledged = signal(false);
  /** A user with an active factor must deliberately enter this flow to replace it. */
  readonly mfaReconfiguring = signal(false);
  readonly recoveryRegenerating = signal(false);
  readonly mfaSetupStep = computed<1 | 2 | 3>(() => this.recoveryCodes().length ? 3 : this.mfaSecret() ? 2 : 1);
  mfaPasswordForm = this.fb.nonNullable.group({
    password: ["", [Validators.required, Validators.maxLength(72)]],
  });
  mfaCodeForm = this.fb.nonNullable.group({
    code: ["", [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });
  mfaReconfigureForm = this.fb.nonNullable.group({
    password: ["", [Validators.required, Validators.maxLength(72)]],
    factorCode: ["", [Validators.required, Validators.pattern(/^(?:\d{6}|[A-Za-z2-9\s-]{16,24})$/)]],
  });
  mfaDisableForm = this.fb.nonNullable.group({
    password: ["", [Validators.required, Validators.maxLength(72)]],
    factorCode: ["", [Validators.required, Validators.pattern(/^(?:\d{6}|[A-Za-z2-9\s-]{16,24})$/)]],
  });
  recoveryRegenerateForm = this.fb.nonNullable.group({
    password: ["", [Validators.required, Validators.maxLength(72)]],
    factorCode: ["", [Validators.required, Validators.pattern(/^(?:\d{6}|[A-Za-z2-9\s-]{16,24})$/)]],
  });

  // ---------------- Appearance ----------------
  readonly themePref = this.theme.preference;
  readonly themeOptions: Array<{ value: ThemePreference; label: string }> = [
    { value: "light", label: "Claro" },
    { value: "dark", label: "Oscuro" },
    { value: "system", label: "Seguir sistema" },
  ];

  // ---------------- Notification preferences ----------------
  readonly notificationPreferences = signal<NotificationPreference[]>([]);
  readonly notificationPrefsLoading = signal(true);
  readonly notificationPrefsBusy = signal(false);
  readonly notificationPrefsError = signal<string | null>(null);
  readonly notificationDeliveries = NOTIFICATION_DELIVERIES;
  // Los críticos —credenciales, MFA, email, exportación o eliminación de
  // cuenta— llegan siempre; el servidor además rechaza silenciarlos.
  readonly mandatoryPreferences = computed(() => this.notificationPreferences().filter((p) => p.category === "mandatory"));
  readonly operationalPreferences = computed(() => this.notificationPreferences().filter((p) => p.category === "operational"));

  notificationKindLabel(kind: NotificationKind): string {
    return NOTIFICATION_KINDS[kind].label;
  }

  notificationKindIcon(kind: NotificationKind): string {
    return NOTIFICATION_KINDS[kind].icon;
  }

  notificationDeliveryLabel(delivery: NotificationDelivery): string {
    return NOTIFICATION_DELIVERY_LABELS[delivery];
  }

  async loadNotificationPreferences(): Promise<void> {
    this.notificationPrefsLoading.set(true);
    this.notificationPrefsError.set(null);
    try {
      this.notificationPreferences.set(await this.notifications.preferences());
    } catch {
      this.notificationPrefsError.set("No se pudieron cargar tus preferencias de aviso. Inténtalo de nuevo.");
    } finally {
      this.notificationPrefsLoading.set(false);
    }
  }

  async setNotificationDelivery(pref: NotificationPreference, delivery: NotificationDelivery): Promise<void> {
    // El servidor rechaza cambiar un obligatorio; no se le manda ni se intenta.
    if (pref.category === "mandatory" || pref.delivery === delivery || this.notificationPrefsBusy()) return;
    this.notificationPrefsBusy.set(true);
    try {
      this.notificationPreferences.set(await this.notifications.updatePreferences([{ kind: pref.kind, delivery }]));
      this.snackbar.open("Preferencia de avisos guardada", "Cerrar", { duration: 3000 });
    } catch (err) {
      this.toast(err, "No se pudo guardar la preferencia. Inténtalo de nuevo.");
    } finally {
      this.notificationPrefsBusy.set(false);
    }
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.deletionDialog?.close();
      this.emailDialog?.close();
      this.passwordDialog?.close();
      this.exportDialog?.close();
      this.stopExportExpiryCheck();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", this.exportReadyRefreshHandler);
        window.removeEventListener("focus", this.exportReadyRefreshHandler);
      }
    });
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.exportReadyRefreshHandler);
      window.addEventListener("focus", this.exportReadyRefreshHandler);
    }
    void this.loadSessions();
    void this.loadExportStatus();
    void this.loadDeletionImpact();
    void this.loadPrivacyRequests();
    void this.loadNotificationPreferences();
  }

  private toast(err: unknown, fallback: string): void {
    const message = err instanceof ApiRequestError
      ? err.message
      : fallback || "No se pudo completar la operación";
    this.snackbar.open(message, "Cerrar", { duration: 4000 });
  }

  /** A committed security change must never be reported as rolled back. */
  private async settleAfterConfirmedMutation(tasks: Promise<unknown>[]): Promise<void> {
    const results = await Promise.allSettled(tasks);
    if (!this.destroyRef.destroyed && results.some((result) => result.status === "rejected")) {
      this.snackbar.open("El cambio se aplicó, pero no se pudo actualizar toda la vista. Recárgala antes de repetir la operación.", "Cerrar", { duration: 5000 });
    }
  }

  async saveProfile(): Promise<void> {
    if (this.profileForm.invalid || this.profileBusy()) return;
    this.profileBusy.set(true);
    try {
      await this.auth.updateProfile(this.profileForm.controls.name.value.trim());
      this.snackbar.open("Perfil actualizado", "Cerrar", { duration: 2500 });
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.profileBusy.set(false);
    }
  }

  openEmailDialog(mode: EmailAccessDialogData["mode"]): void {
    if (this.emailDialog) return;
    const data: EmailAccessDialogData = { mode, pendingEmail: this.user()?.pendingEmail };
    this.emailDialog = this.dialogs.open(EmailAccessDialogComponent, {
      data, width: "min(560px, 94vw)", maxWidth: "94vw", maxHeight: "92dvh",
      autoFocus: mode === "change" ? "#email-address-step input" : "first-heading", restoreFocus: true, injector: this.injector,
      ariaLabel: mode === "change" ? "Cambiar el email de acceso" : "Cancelar el cambio de email pendiente",
    });
    this.emailDialog.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((completed) => {
      this.emailDialog = undefined;
      if (!completed) return;
      this.snackbar.open(mode === "change" ? "Confirmación enviada al nuevo email" : "Cambio de email cancelado", "Cerrar", { duration: 3500 });
    });
  }

  openPasswordDialog(): void {
    if (this.passwordDialog) return;
    this.passwordDialog = this.dialogs.open(PasswordChangeDialogComponent, {
      width: "min(610px, 94vw)", maxWidth: "94vw", maxHeight: "92dvh",
      autoFocus: "#password-credentials-step input", restoreFocus: true, injector: this.injector,
      ariaLabel: "Cambiar la contraseña de acceso",
    });
    this.passwordDialog.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((completed) => {
      this.passwordDialog = undefined;
      if (!completed) return;
      this.snackbar.open("Contraseña actualizada", "Cerrar", { duration: 2500 });
      void this.settleAfterConfirmedMutation([this.auth.refreshUser(), this.loadSessions()]);
    });
  }

  async loadSessions(): Promise<void> {
    const context = this.auth.sessionGeneration();
    const request = this.sessionsRequest.begin(context);
    this.sessionsLoading.set(true);
    this.sessionsError.set(null);
    try {
      const now = Date.now();
      const { sessions, truncated } = await this.auth.listSessions({ signal: request.signal });
      if (!this.sessionsRequest.isCurrent(request, this.auth.sessionGeneration())) return;
      this.sessions.set(sessions.filter((session) => !session.revoked_at && new Date(session.expires_at).getTime() > now));
      this.sessionsTruncated.set(truncated);
    } catch (err) {
      if (!this.sessionsRequest.isCurrent(request, this.auth.sessionGeneration())) return;
      this.sessions.set([]);
      this.sessionsTruncated.set(false);
      this.sessionsError.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar las sesiones");
    } finally {
      if (this.sessionsRequest.isCurrent(request, this.auth.sessionGeneration())) this.sessionsLoading.set(false);
    }
  }

  /**
   * `silent` lo usan las sondas: no mueve el esqueleto, no avisa de nada y
   * conserva el último estado conocido si la red falla (la siguiente sonda
   * reintenta). Las cargas visibles mantienen su comportamiento original.
   */
  async loadExportStatus(notify = true, silent = false): Promise<void> {
    const context = this.auth.sessionGeneration();
    const request = this.exportRequest.begin(context);
    if (!silent) this.exportLoading.set(true);
    try {
      const status = await this.auth.dataExportStatus({ signal: request.signal });
      if (!this.exportRequest.isCurrent(request, this.auth.sessionGeneration())) return;
      const statusChanged = (status?.status ?? null) !== this.exportPollLastStatus;
      if (statusChanged) this.exportPoller.reset();
      this.exportPollLastStatus = status?.status ?? null;
      this.exportStatus.set(status);
      this.armExportExpiryCheck(status);
      // El historial sólo cambia cuando cambia el estado visible; las sondas
      // silenciosas no lo tocan mientras la exportación siga igual.
      if (statusChanged) void this.loadExportHistory();
    } catch (err) {
      if (!this.exportRequest.isCurrent(request, this.auth.sessionGeneration())) return;
      if (silent) return;
      this.exportStatus.set(null);
      if (notify) this.toast(err, "No se pudo consultar el estado de la exportación");
    } finally {
      if (this.exportRequest.isCurrent(request, this.auth.sessionGeneration())) {
        if (!silent) this.exportLoading.set(false);
        this.exportPoller.schedule();
      }
    }
  }

  /**
   * Historial de exportaciones (máximo diez). Un fallo aquí nunca bloquea la
   * tarjeta de estado: lo que manda es la exportación activa.
   */
  async loadExportHistory(): Promise<void> {
    const context = this.auth.sessionGeneration();
    const request = this.exportHistoryRequest.begin(context);
    try {
      const exports = await this.auth.dataExportHistory({ signal: request.signal });
      if (!this.exportHistoryRequest.isCurrent(request, this.auth.sessionGeneration())) return;
      this.exportHistory.set(exports);
    } catch {
      // Sin historial no se pierde nada operativo; se conserva el último visto.
    }
  }

  private exportNeedsPoll(): boolean {
    // Sólo la generación avanza sola. `ready` es un estado final vivo: no se
    // sondea, se refresca al recuperar la pestaña y al caducar la descarga.
    return (this.exportStatus()?.status ?? null) === "processing";
  }

  /** Una exportación lista no sondea: al volver a la pestaña se refresca una vez. */
  private readonly exportReadyRefreshHandler = (): void => {
    if (typeof document !== "undefined" && document.hidden) return;
    if ((this.exportStatus()?.status ?? null) === "ready") void this.loadExportStatus(false, true);
  };

  /**
   * Un único temporizador hasta `downloadExpiresAt`: al caducar, la tarjeta se
   * refresca una vez y pasa a `expired` sin sondeos periódicos.
   */
  private armExportExpiryCheck(status: DataExportStatus | null): void {
    this.stopExportExpiryCheck();
    if (status?.status !== "ready" || !status.downloadExpiresAt) return;
    const expiresAt = new Date(status.downloadExpiresAt).getTime();
    if (!Number.isFinite(expiresAt)) return;
    // setTimeout acepta hasta 2^31-1 ms; un retardo negativo ya ha caducado.
    const delay = Math.min(Math.max(expiresAt - Date.now(), 0), 2_147_483_647);
    this.exportExpiryTimer = setTimeout(() => {
      this.exportExpiryTimer = null;
      void this.loadExportStatus(false, true);
    }, delay);
  }

  private stopExportExpiryCheck(): void {
    if (this.exportExpiryTimer !== null) {
      clearTimeout(this.exportExpiryTimer);
      this.exportExpiryTimer = null;
    }
  }

  openDataExportDialog(purpose: "request" | "download" = "request"): void {
    if (this.exportDialog || this.exportBusy()) return;
    this.exportDialog = this.dialogs.open(DataExportDialogComponent, {
      data: { purpose },
      width: "min(560px, 94vw)", maxWidth: "94vw", maxHeight: "92dvh",
      autoFocus: "#export-password-step input", restoreFocus: true, injector: this.injector,
      ariaLabel: purpose === "download" ? "Descargar la exportación de datos" : "Solicitar una exportación de datos",
    });
    this.exportDialog.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      this.exportDialog = undefined;
      if (!result) return;
      if (result === "unconfirmed") {
        this.snackbar.open("Archivo descargado. No pudimos confirmar la recepción: puedes descargarlo de nuevo o dejar que caduque.", "Cerrar", { duration: 6000 });
      } else {
        this.snackbar.open(purpose === "download" ? "Archivo descargado" : "Solicitud de exportación iniciada", "Cerrar", { duration: 3500 });
      }
      void this.settleAfterConfirmedMutation([this.loadExportStatus(false), this.loadExportHistory()]);
    });
  }

  async cancelDataExport(): Promise<void> {
    if (this.exportBusy()) return;
    const confirmed = await this.actions.confirm({
      title: "Cancelar exportación",
      message: "La descarga pendiente dejará de funcionar y se eliminará el archivo privado si ya estaba preparado.",
      confirmLabel: "Cancelar exportación",
      destructive: true,
    });
    // The answer can arrive after another attempt started; the dialog is not a
    // lock on the operation it describes.
    if (!confirmed || this.exportBusy()) return;
    this.exportBusy.set(true);
    try {
      await this.auth.cancelDataExport();
      this.snackbar.open("Exportación cancelada", "Cerrar", { duration: 2500 });
      await this.settleAfterConfirmedMutation([this.loadExportStatus(false), this.loadExportHistory()]);
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.exportBusy.set(false);
    }
  }

  exportIsActive(): boolean {
    return ["processing", "ready"].includes(this.exportStatus()?.status ?? "");
  }

  /** Los estados con acción propia no repiten la entrada «Solicitar mi archivo». */
  exportShowsRequestEntry(): boolean {
    const status = this.exportStatus()?.status ?? null;
    return status === null || status === "downloaded" || status === "cancelled";
  }

  private static readonly EXPORT_STAGE_LABELS: Record<DataExportStage, string> = {
    collecting: "Recopilando tus datos",
    analytics: "Calculando totales",
    encoding: "Preparando el contenido",
    encrypting: "Cifrando el archivo",
    finalizing: "Finalizando la entrega",
  };

  private static readonly EXPORT_STATUS_LABELS: Record<DataExportStatus["status"], string> = {
    processing: "En preparación",
    ready: "Lista",
    downloaded: "Descargada",
    failed: "Falló",
    cancelled: "Cancelada",
    expired: "Caducada",
  };

  /** Etapa viva de la generación; sin etapa conocida, texto neutro. */
  exportStageLabel(stage: DataExportStage | null): string {
    return stage ? SettingsComponent.EXPORT_STAGE_LABELS[stage] : "Preparando el archivo";
  }

  exportStatusLabel(status: DataExportStatus["status"]): string {
    return SettingsComponent.EXPORT_STATUS_LABELS[status];
  }

  /** Icono y tono de la tarjeta comparten el estado de la exportación. */
  exportTone(status: DataExportStatus["status"]): AsyncOperationTone {
    return status === "processing" ? "working"
      : status === "ready" ? "ready"
      : status === "failed" ? "failed"
      : status === "expired" ? "expired"
      : "done";
  }

  exportIcon(status: DataExportStatus["status"]): string {
    return status === "processing" ? "hourglass_top"
      : status === "ready" ? "task_alt"
      : status === "downloaded" ? "download_done"
      : status === "failed" ? "error_outline"
      : "history";
  }

  /** El límite automático se resuelve por el flujo de portabilidad, no por soporte. */
  openPortabilityFlow(): void {
    this.privacyForm.reset({ type: "portability", details: "" });
    const target = this.privacyFormBlock();
    if (!target) return;
    target.nativeElement.focus({ preventScroll: true });
    target.nativeElement.scrollIntoView({ block: "start", behavior: "instant" });
  }

  async loadDeletionImpact(notify = true): Promise<void> {
    const context = this.auth.sessionGeneration();
    const request = this.deletionRequest.begin(context);
    this.deletionLoading.set(true);
    try {
      const impact = await this.auth.accountDeletionImpact({ signal: request.signal });
      if (!this.deletionRequest.isCurrent(request, this.auth.sessionGeneration())) return;
      this.deletionImpact.set(impact);
    } catch (err) {
      if (!this.deletionRequest.isCurrent(request, this.auth.sessionGeneration())) return;
      this.deletionImpact.set(null);
      if (notify) this.toast(err, "No se pudo consultar el impacto de la eliminación");
    } finally {
      if (this.deletionRequest.isCurrent(request, this.auth.sessionGeneration())) this.deletionLoading.set(false);
    }
  }

  openAccountDeletion(): void {
    if (this.deletionDialog || this.deletionLoading() || !this.deletionImpact()?.canDelete) return;
    this.deletionDialog = this.dialogs.open(AccountDeletionDialogComponent, {
      width: "min(580px, 94vw)", maxWidth: "94vw", maxHeight: "92dvh",
      autoFocus: "first-heading", restoreFocus: true, injector: this.injector,
      ariaLabel: "Solicitar el cierre de cuenta",
    });
    this.deletionDialog.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.deletionDialog = undefined;
      // Refresh even on Escape after a successful send; the returned value is
      // never used as proof of server state and contains no credentials.
      void this.loadDeletionImpact();
    });
  }

  async loadPrivacyRequests(notify = false): Promise<void> {
    const page = this.privacyPage() + 1;
    const perPage = this.privacyPageSize();
    const context = `${this.auth.sessionGeneration()}:${this.privacyPage()}:${perPage}`;
    const request = this.privacyRequest.begin(context);
    this.privacyLoading.set(true);
    this.privacyError.set(null);
    try {
      const response = await this.api.get<{ requests: PrivacyRightRequest[]; total: number }>("/api/v1/auth/privacy-requests", {
        page,
        perPage,
      }, (value) => decodePrivacyRequestsPage(value, { page, perPage }), { signal: request.signal });
      const current = `${this.auth.sessionGeneration()}:${this.privacyPage()}:${this.privacyPageSize()}`;
      if (!this.privacyRequest.isCurrent(request, current)) return;
      this.privacyRequests.set(response.requests);
      this.privacyTotal.set(response.total);
    } catch (error) {
      const current = `${this.auth.sessionGeneration()}:${this.privacyPage()}:${this.privacyPageSize()}`;
      if (!this.privacyRequest.isCurrent(request, current)) return;
      this.privacyRequests.set([]);
      this.privacyError.set(error instanceof ApiRequestError ? error.message : "No se pudieron cargar las solicitudes");
      if (notify) this.toast(error, "No se pudieron cargar las solicitudes");
    } finally {
      const current = `${this.auth.sessionGeneration()}:${this.privacyPage()}:${this.privacyPageSize()}`;
      if (this.privacyRequest.isCurrent(request, current)) this.privacyLoading.set(false);
    }
  }

  onPrivacyPage(event: PageEvent): void {
    this.privacyPage.set(event.pageIndex);
    this.privacyPageSize.set(event.pageSize);
    void this.loadPrivacyRequests();
  }

  async submitPrivacyRequest(): Promise<void> {
    const type = this.privacyForm.controls.type.value;
    const detailControl = this.privacyForm.controls.details;
    const details = detailControl.value.trim();
    if (detailControl.hasError("detailRequired")) {
      const remaining = { ...(detailControl.errors ?? {}) };
      delete remaining["detailRequired"];
      detailControl.setErrors(Object.keys(remaining).length ? remaining : null);
    }
    if (["rectification", "objection", "restriction"].includes(type) && details.length < 10) {
      detailControl.setErrors({ ...(detailControl.errors ?? {}), detailRequired: true });
    }
    if (this.privacyForm.invalid || this.privacyBusy()) {
      this.privacyForm.markAllAsTouched();
      return;
    }
    this.privacyBusy.set(true);
    try {
      await this.api.post("/api/v1/auth/privacy-requests", { type, details });
      this.privacyForm.reset({ type: "access", details: "" });
      this.privacyPage.set(0);
      await this.loadPrivacyRequests(false);
      this.snackbar.open("Solicitud registrada y plazo iniciado", "Cerrar", { duration: 3500 });
    } catch (error) {
      this.toast(error, "");
      await this.loadPrivacyRequests(false);
    } finally {
      this.privacyBusy.set(false);
    }
  }

  beginPrivacyResponse(id: number): void {
    this.privacyResponseId.set(id);
    this.privacyResponseForm.reset();
  }

  async respondPrivacy(request: PrivacyRightRequest): Promise<void> {
    if (this.privacyResponseForm.invalid || this.privacyBusy()) {
      this.privacyResponseForm.markAllAsTouched();
      return;
    }
    this.privacyBusy.set(true);
    try {
      await this.api.post(`/api/v1/auth/privacy-requests/${request.id}/respond`, {
        message: this.privacyResponseForm.controls.message.value.trim(),
      });
      this.privacyResponseId.set(null);
      await this.loadPrivacyRequests(false);
      this.snackbar.open("Respuesta incorporada al expediente", "Cerrar", { duration: 3000 });
    } catch (error) {
      this.toast(error, "");
    } finally {
      this.privacyBusy.set(false);
    }
  }

  async cancelPrivacy(request: PrivacyRightRequest): Promise<void> {
    const confirmed = await this.actions.confirm({
      title: "Cancelar solicitud",
      message: "El expediente quedará cerrado como cancelado. Podrás crear otra solicitud del mismo tipo más adelante.",
      confirmLabel: "Cancelar solicitud",
      destructive: true,
    });
    if (!confirmed || this.privacyBusy()) return;
    this.privacyBusy.set(true);
    try {
      await this.api.post(`/api/v1/auth/privacy-requests/${request.id}/cancel`, {});
      await this.loadPrivacyRequests();
      this.snackbar.open("Solicitud cancelada", "Cerrar", { duration: 2500 });
    } catch (error) {
      this.toast(error, "");
    } finally {
      this.privacyBusy.set(false);
    }
  }

  readonly privacyTypeLabel = privacyRightTypeLabel;
  readonly privacyStatusLabel = privacyRightStatusLabel;
  readonly privacyIsActive = privacyRightIsActive;
  readonly privacyTypeOptions = PRIVACY_RIGHT_TYPE_ORDER;

  async openOwnedWorkspace(id: number): Promise<void> {
    const previous = this.workspaces.currentId();
    this.workspaces.select(id);
    try {
      const navigated = await this.router.navigate(["/app/team"]);
      if (!navigated && this.workspaces.currentId() === id) this.workspaces.select(previous);
    } catch (error) {
      if (this.workspaces.currentId() === id) this.workspaces.select(previous);
      this.toast(error, "No se pudo abrir el workspace");
    }
  }

  async revokeSession(session: Session): Promise<void> {
    let revokedCurrent: boolean;
    try {
      revokedCurrent = await this.auth.revokeSession(session.id, session.current);
    } catch (err) {
      this.toast(err, "No se pudo revocar la sesión");
      return;
    }
    if (revokedCurrent) {
      try {
        const navigated = await this.router.navigate(["/auth"]);
        if (!navigated) this.snackbar.open("La sesión quedó revocada. Abre la pantalla de acceso para continuar.", "Cerrar", { duration: 5000 });
      } catch {
        this.snackbar.open("La sesión quedó revocada, pero no se pudo abrir la pantalla de acceso.", "Cerrar", { duration: 5000 });
      }
      return;
    }
    this.snackbar.open("Sesión revocada", "Cerrar", { duration: 2500 });
    void this.loadSessions();
  }

  async startMfaSetup(): Promise<void> {
    if (this.mfaPasswordForm.invalid || this.mfaBusy()) return;
    await this.stageMfaSetup(this.mfaPasswordForm.controls.password.value);
  }

  async startMfaReconfiguration(): Promise<void> {
    if (this.mfaReconfigureForm.invalid || this.mfaBusy()) return;
    await this.stageMfaSetup(
      this.mfaReconfigureForm.controls.password.value,
      this.mfaReconfigureForm.controls.factorCode.value,
    );
  }

  private async stageMfaSetup(password: string, code?: string): Promise<void> {
    this.mfaBusy.set(true);
    try {
      const { secret, uri } = await this.auth.mfaSetup(password, code);
      this.mfaSecret.set(secret);
      this.mfaUri.set(uri);
      try {
        this.mfaQr.set(await QRCode.toDataURL(uri, { width: 240, margin: 1 }));
      } catch {
        // The server-side setup already exists. Preserve the manual secret
        // instead of inviting a retry that could rotate it again.
        this.mfaQr.set(null);
        this.snackbar.open("La configuración está preparada, pero no se pudo generar el QR. Usa la clave manual mostrada.", "Cerrar", { duration: 5000 });
      }
      this.mfaCodeForm.reset();
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.mfaBusy.set(false);
    }
  }

  beginMfaReconfiguration(): void {
    if (this.mfaBusy()) return;
    this.mfaReconfiguring.set(true);
    this.mfaReconfigureForm.reset();
  }

  async enableMfa(): Promise<void> {
    if (this.mfaCodeForm.invalid || this.mfaBusy()) return;
    this.mfaBusy.set(true);
    try {
      const { recoveryCodes } = await this.auth.mfaEnable(this.mfaCodeForm.controls.code.value);
      this.recoveryCodes.set(recoveryCodes);
      this.recoveryCodesAcknowledged.set(false);
      this.clearMfaSetupUi();
      this.snackbar.open("MFA activado", "Cerrar", { duration: 2500 });
      await this.settleAfterConfirmedMutation([this.auth.refreshUser()]);
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.mfaBusy.set(false);
    }
  }

  async disableMfa(): Promise<void> {
    if (this.mfaDisableForm.invalid || this.mfaBusy()) return;
    const confirmed = await this.actions.confirm({
      title: "Desactivar MFA",
      message: "Tu cuenta perderá la verificación en dos pasos. Solo podrás continuar con tu contraseña y el código TOTP actual.",
      confirmLabel: "Desactivar MFA",
      destructive: true,
    });
    if (!confirmed || this.mfaBusy()) return;
    this.mfaBusy.set(true);
    try {
      await this.auth.mfaDisable(
        this.mfaDisableForm.controls.password.value,
        this.mfaDisableForm.controls.factorCode.value,
      );
      this.mfaSecret.set(null);
      this.mfaUri.set(null);
      this.mfaQr.set(null);
      this.recoveryCodes.set([]);
      this.recoveryCodesAcknowledged.set(false);
      this.mfaReconfiguring.set(false);
      this.mfaPasswordForm.reset();
      this.mfaCodeForm.reset();
      this.mfaDisableForm.reset();
      this.snackbar.open("MFA desactivado", "Cerrar", { duration: 2500 });
      await this.settleAfterConfirmedMutation([this.auth.refreshUser()]);
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.mfaBusy.set(false);
    }
  }

  async cancelMfaSetup(): Promise<void> {
    if (this.mfaBusy()) return;
    this.mfaBusy.set(true);
    try {
      await this.auth.mfaCancelSetup();
      this.clearMfaSetupUi();
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.mfaBusy.set(false);
    }
  }

  cancelMfaReconfiguration(): void {
    if (this.mfaBusy()) return;
    this.mfaReconfiguring.set(false);
    this.mfaReconfigureForm.reset();
  }

  private clearMfaSetupUi(): void {
    this.mfaSecret.set(null);
    this.mfaUri.set(null);
    this.mfaQr.set(null);
    this.mfaPasswordForm.reset();
    this.mfaCodeForm.reset();
    this.mfaReconfigureForm.reset();
    this.mfaReconfiguring.set(false);
  }

  finishRecoveryCodes(): void {
    if (!this.recoveryCodesAcknowledged()) return;
    this.recoveryCodes.set([]);
    this.recoveryCodesAcknowledged.set(false);
    this.snackbar.open("Configuración completada", "Cerrar", { duration: 2500 });
  }

  beginRecoveryRegeneration(): void {
    if (this.mfaBusy()) return;
    this.recoveryRegenerating.set(true);
    this.recoveryRegenerateForm.reset();
  }

  cancelRecoveryRegeneration(): void {
    if (this.mfaBusy()) return;
    this.recoveryRegenerating.set(false);
    this.recoveryRegenerateForm.reset();
  }

  async regenerateRecoveryCodes(): Promise<void> {
    if (this.recoveryRegenerateForm.invalid || this.mfaBusy()) {
      this.recoveryRegenerateForm.markAllAsTouched();
      return;
    }
    const confirmed = await this.actions.confirm({
      title: "Regenerar códigos de recuperación",
      message: "Los códigos anteriores dejarán de funcionar y se cerrarán las demás sesiones de tu cuenta.",
      confirmLabel: "Regenerar códigos",
      destructive: true,
    });
    if (!confirmed || this.mfaBusy()) return;

    this.mfaBusy.set(true);
    try {
      const { recoveryCodes } = await this.auth.mfaRegenerateRecoveryCodes(
        this.recoveryRegenerateForm.controls.password.value,
        this.recoveryRegenerateForm.controls.factorCode.value,
      );
      this.recoveryCodes.set(recoveryCodes);
      this.recoveryCodesAcknowledged.set(false);
      this.recoveryRegenerating.set(false);
      this.recoveryRegenerateForm.reset();
      this.snackbar.open("Códigos regenerados", "Cerrar", { duration: 2500 });
      await this.settleAfterConfirmedMutation([this.auth.refreshUser(), this.loadSessions()]);
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.mfaBusy.set(false);
    }
  }

  copyRecoveryCodes(): void {
    const codes = this.recoveryCodes();
    if (!codes.length) return;
    const copy = navigator.clipboard?.writeText(codes.join("\n"));
    if (!copy) {
      this.snackbar.open("El navegador no permite copiar automáticamente", "Cerrar", { duration: 2500 });
      return;
    }
    void copy.then(
      () => this.snackbar.open("Códigos copiados", "Cerrar", { duration: 2000 }),
      () => this.snackbar.open("No se pudieron copiar los códigos", "Cerrar", { duration: 2500 }),
    );
  }

  downloadRecoveryCodes(): void {
    const codes = this.recoveryCodes();
    if (!codes.length || typeof document === "undefined") return;
    const body = [
      "UVH · Códigos de recuperación",
      "",
      "Cada código funciona una sola vez. Guárdalos fuera de tu cuenta.",
      "",
      ...codes,
      "",
      `Generados: ${new Date().toISOString()}`,
    ].join("\n");
    if (!downloadBlob(new Blob([body], { type: "text/plain;charset=utf-8" }), "uvh-codigos-recuperacion.txt")) {
      this.snackbar.open("El navegador no pudo descargar los códigos. Cópialos antes de continuar.", "Cerrar", { duration: 5000 });
    }
  }

  setTheme(pref: ThemePreference): void {
    this.theme.set(pref);
  }

  formatDate(iso: string): string {
    return dateTimeMediumLabel(iso, "Fecha no disponible");
  }
}
