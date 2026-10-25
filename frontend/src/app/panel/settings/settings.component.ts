import { Location } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, Injector, NgZone, signal, untracked, viewChild, type AfterViewInit } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { MatDialog, MatDialogRef } from "@angular/material/dialog";
import { LanguageSelectorComponent } from "../../core/localisation/language-selector.component";
import { LocaleLinkDirective } from "../../core/localisation/locale-link.directive";
import { UI_TEXT } from "../../core/localisation/template-messages";
import { AccountDeletionDialogComponent } from "./account-deletion-dialog.component";
import { DataExportDialogComponent, type DataExportDialogResult } from "./data-export-dialog.component";
import { EmailAccessDialogComponent, type EmailAccessDialogData } from "./email-access-dialog.component";
import { PasswordChangeDialogComponent } from "./password-change-dialog.component";
import { SettingsExportCoordinator } from "./settings-export-coordinator";
import { SettingsMfaCoordinator } from "./settings-mfa-coordinator";
import { SettingsPrivacyCoordinator } from "./settings-privacy-coordinator";
import { SettingsSessionsCoordinator } from "./settings-sessions-coordinator";

import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatDividerModule } from "@angular/material/divider";
import { MAT_FORM_FIELD_DEFAULT_OPTIONS, MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatPaginatorModule, type PageEvent } from "@angular/material/paginator";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSelectModule } from "@angular/material/select";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ActivatedRoute, Router } from "@angular/router";
import { AsyncPoller } from "../../core/async-poller";
import { dateTimeMediumLabel } from "../../core/date-time-label";
import type { AccountDeletionImpact, DataExportStage, DataExportStatus, NotificationPreference, PrivacyRightRequest, PrivacyRightType, Session } from "../../core/models";
import {
  NOTIFICATION_DELIVERIES,
  NOTIFICATION_DELIVERY_LABELS,
  NOTIFICATION_KINDS,
  type NotificationDelivery,
  type NotificationKind,
} from "../../core/notification-kinds";
import {
  PRIVACY_RIGHT_GUIDANCE,
  PRIVACY_RIGHT_TYPE_ORDER,
  privacyRightIsActive,
  privacyRightMessageAuthor,
  privacyRightNextStep,
  privacyRightStatusLabel,
  privacyRightTypeLabel,
} from "../../core/privacy-right-label";
import { ReadDeadline } from "../../core/read-deadline";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { LatestRequest } from "../../core/services/latest-request";
import { NotificationService } from "../../core/services/notification.service";
import { QrCodeService } from "../../core/services/qr-code.service";
import { ThemeService, type ThemePreference } from "../../core/services/theme.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { sessionAgentLabel } from "../../core/session-agent-label";
import { ActionDialogService } from "../action-dialog.service";
import { AsyncOperationStatusComponent, type AsyncOperationTone } from "../async-operation-status.component";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { SettingsPreferenceRowComponent } from "./settings-preference-row.component";
import { SettingsSectionHeaderComponent } from "./settings-section-header.component";
import { SettingsSectionNavComponent, type SettingsSectionNavItem } from "./settings-section-nav.component";

@Component({
  selector: "app-settings",
  standalone: true,
  imports: [LanguageSelectorComponent, LocaleLinkDirective,
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
    SettingsSectionNavComponent,
    SettingsSectionHeaderComponent,
    SettingsPreferenceRowComponent,
  ],
  templateUrl: "./settings.component.html",
  // Hints and validation messages must reserve their real height on narrow screens.
  providers: [{ provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { subscriptSizing: "dynamic" } }],
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./settings.component.scss",
})
export class SettingsComponent implements AfterViewInit {
  readonly uiText = UI_TEXT;
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
  private readonly qrCode = inject(QrCodeService);
  private deletionDialog?: MatDialogRef<AccountDeletionDialogComponent, boolean>;
  private emailDialog?: MatDialogRef<EmailAccessDialogComponent, boolean>;
  private passwordDialog?: MatDialogRef<PasswordChangeDialogComponent, boolean>;
  private exportDialog?: MatDialogRef<DataExportDialogComponent, DataExportDialogResult>;
  private mfaRequests = new LatestRequest(this.destroyRef);
  private profileRequests = new LatestRequest(this.destroyRef);
  private profileRefreshRequests = new LatestRequest(this.destroyRef);
  private workspaceNavigationRequests = new LatestRequest(this.destroyRef);
  private sessionRevocationRequests = new LatestRequest(this.destroyRef);
  private sessionsRequest = new LatestRequest(this.destroyRef);
  private exportRequest = new LatestRequest(this.destroyRef);
  private exportHistoryRequest = new LatestRequest(this.destroyRef);
  private deletionRequest = new LatestRequest(this.destroyRef);
  private privacyRequest = new LatestRequest(this.destroyRef);
  private exportMutationRequest = new LatestRequest(this.destroyRef);
  private privacyMutationRequest = new LatestRequest(this.destroyRef);
  readonly user = this.auth.user;
  readonly userRefreshRequired = this.auth.userRefreshRequired;
  readonly userMutationUnconfirmed = this.auth.userMutationUnconfirmed;
  readonly profileRefreshBusy = signal(false);
  /** Ruta canónica de cada sección: la URL nombra la sección que se está leyendo. */
  private static readonly SECTION_PATHS: Record<string, string> = {
    account: "/app/settings/profile",
    security: "/app/settings/security",
    notifications: "/app/settings/notifications",
    privacy: "/app/settings/privacy",
    danger: "/app/settings/danger",
  };
  readonly activeSection = signal(this.initialSection());
  readonly sectionNavItems = computed<SettingsSectionNavItem[]>(() => [
    { id: "account", label: $localize`:@@ui.86c6655806304c:Perfil y apariencia`, description: $localize`:@@ui.69d87dc7a26c46:Nombre, email y tema`, icon: "person_outline", status: this.userRefreshRequired() ? $localize`:@@ui.52fadddb772ffb:Revisar` : null, statusTone: "attention" },
    { id: "security", label: $localize`:@@ui.c95ad05d6312a1:Acceso y seguridad`, description: $localize`:@@ui.62cfe8ac639774:Contraseña, MFA y sesiones`, icon: "lock_outline", status: this.userRefreshRequired() ? $localize`:@@ui.2ef68536d8e212:Pendiente` : this.user()?.mfaEnabled ? "Protegido" : $localize`:@@ui.8c32d8d87598cb:MFA recomendado`, statusTone: this.userRefreshRequired() || !this.user()?.mfaEnabled ? "attention" : "success" },
    { id: "notifications", label: $localize`:@@ui.80dade6fab6f93:Notificaciones`, description: $localize`:@@ui.3f2c956adb16ad:Avisos y frecuencia`, icon: "notifications", status: this.notificationPrefsBusy() ? "Guardando" : null, statusTone: "quiet" },
    { id: "privacy", label: $localize`:@@ui.200922014753a8:Tus datos`, description: $localize`:@@ui.90490606bc5b4b:Descargas y solicitudes`, icon: "policy", status: this.privacyAction() ? $localize`:@@ui.75f1f75e333774:En curso` : null, statusTone: "quiet" },
    { id: "danger", label: $localize`:@@ui.e11487df7ef5ea:Cerrar la cuenta`, description: $localize`:@@ui.6b11fcb8bef647:Requisitos y consecuencias`, icon: "warning_amber", status: null, statusTone: "attention" },
  ]);
  /** Per-view admission of section reads, cleared with the account context. */
  private readonly initializedSections = new Set<string>();
  readonly sessionAgent = sessionAgentLabel;

  private initialSection(): string {
    const section: unknown = this.route.snapshot.data["section"];
    return typeof section === "string" && Object.hasOwn(SettingsComponent.SECTION_PATHS, section) ? section : "account";
  }

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
    // Preserve the browser contract for opening a canonical link elsewhere.
    if (event instanceof MouseEvent && (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
    if (!Object.hasOwn(SettingsComponent.SECTION_PATHS, section.id)) return;
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
    this.activeSection.set(section.id);
    this.loadSection(section.id);
    // Reveal synchronously so focus does not land on a hidden destination.
    // Angular reconciles all five visibility bindings on this event.
    section.hidden = false;
    section.focus({ preventScroll: true });
    section.scrollIntoView({ block: "start", behavior: "instant" });
  }
  readonly userInitials = computed(() => {
    const parts = (this.user()?.name ?? "UVH").trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "UV";
  });

  // ---------------- Profile ----------------
  readonly profileBusy = signal(false);
  readonly profileSaveState = signal<"idle" | "saved">("idle");
  profileForm = this.fb.nonNullable.group({
    name: [this.user()?.name ?? "", [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
  });

  // ---------------- Sessions ----------------
  readonly sessions = signal<Session[]>([]);
  /** The server held session rows back, so this list is not the whole registry. */
  readonly sessionsTruncated = signal(false);
  readonly sessionsLoading = signal(true);
  readonly sessionsError = signal<string | null>(null);
  private sessionDeadlineContext: string | null = null;
  private readonly sessionDeadline = new ReadDeadline(this.destroyRef, inject(NgZone), () => {
    if (this.sessionDeadlineContext !== this.accountContext() || !this.user() || this.sessionsLoading()) return;
    this.sessions.update(rows => rows.filter(row => Date.parse(row.expires_at) > Date.now()));
    void this.loadSessions();
  });

  // ---------------- Data export ----------------
  readonly exportStatus = signal<DataExportStatus | null>(null);
  readonly exportLoading = signal(true);
  readonly exportError = signal<string | null>(null);
  readonly exportRefreshing = signal(false);
  readonly exportBusy = signal(false);
  private readonly exportHeading = viewChild<ElementRef<HTMLElement>>("exportHeading");
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
  private readonly privacyResponseInput = viewChild<ElementRef<HTMLTextAreaElement>>("privacyResponseInput");
  private readonly privacyReceiptBlock = viewChild<ElementRef<HTMLElement>>("privacyReceiptBlock");
  // ---------------- Account deletion ----------------
  readonly deletionImpact = signal<AccountDeletionImpact | null>(null);
  readonly deletionLoading = signal(true);
  readonly deletionError = signal<string | null>(null);

  // ---------------- Privacy rights ----------------
  readonly privacyRequests = signal<PrivacyRightRequest[]>([]);
  readonly privacyLoading = signal(true);
  readonly privacyBusy = signal(false);
  readonly privacyError = signal<string | null>(null);
  readonly privacyMutationError = signal<string | null>(null);
  readonly privacyAction = signal<"create" | "respond" | "cancel" | null>(null);
  readonly privacyReceipt = signal<Pick<PrivacyRightRequest, "id" | "type" | "dueAt"> | null>(null);
  readonly privacyPage = signal(0);
  readonly privacyPageSize = signal(5);
  readonly privacyTotal = signal(0);
  readonly privacyResponseId = signal<number | null>(null);
  private readonly privacyResponseDrafts = new Map<string, string>();
  private privacyResponseContext: string | null = null;
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
  readonly mfaQrLoading = signal(false);
  readonly recoveryCodes = signal<string[]>([]);
  readonly recoveryCodesAcknowledged = signal(false);
  readonly recoveryIssueUnconfirmed = this.auth.mfaRecoveryIssueUnconfirmed;
  private readonly uncertainMfaSetup = signal(false);
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
    { value: "light", label: $localize`:@@ui.2f3e8dcc246498:Claro` },
    { value: "dark", label: $localize`:@@ui.1b1c27c397aee6:Oscuro` },
    { value: "system", label: $localize`:@@ui.a1b5f5425a6f80:Seguir sistema` },
  ];

  // ---------------- Notification preferences ----------------
  private readonly notificationPrefsRequests = new LatestRequest(this.destroyRef);
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

  private resetNotificationPreferences(): void {
    this.notificationPrefsRequests.invalidate();
    this.notificationPreferences.set([]);
    this.notificationPrefsError.set(null);
    this.notificationPrefsLoading.set(false);
    this.notificationPrefsBusy.set(false);
  }

  async loadNotificationPreferences(): Promise<void> {
    if (this.notificationPrefsBusy()) return;
    if (!this.user()) {
      this.resetNotificationPreferences();
      return;
    }
    const request = this.notificationPrefsRequests.begin(this.accountContext());
    const current = (): boolean => this.notificationPrefsRequests.isCurrent(request, this.accountContext());
    this.notificationPrefsLoading.set(true);
    this.notificationPrefsError.set(null);
    try {
      const preferences = await this.notifications.preferences({ signal: request.signal });
      if (current()) this.notificationPreferences.set(preferences);
    } catch {
      if (current()) this.notificationPrefsError.set($localize`:@@ui.3f032ac1f4eac5:No se pudieron cargar tus preferencias de aviso. Inténtalo de nuevo.`);
    } finally {
      if (current()) this.notificationPrefsLoading.set(false);
    }
  }

  async setNotificationDelivery(pref: NotificationPreference, delivery: NotificationDelivery): Promise<void> {
    // El servidor rechaza cambiar un obligatorio; no se le manda ni se intenta.
    if (!this.user() || pref.category === "mandatory" || pref.delivery === delivery || this.notificationPrefsBusy()) return;
    // The write supersedes earlier reads; its response owns the visible snapshot.
    // Never abort the server mutation when this view or identity goes away.
    const request = this.notificationPrefsRequests.begin(this.accountContext());
    const current = (): boolean => this.notificationPrefsRequests.isCurrent(request, this.accountContext());
    this.notificationPrefsLoading.set(false);
    this.notificationPrefsError.set(null);
    this.notificationPrefsBusy.set(true);
    try {
      const preferences = await this.notifications.updatePreferences([{ kind: pref.kind, delivery }]);
      if (!current()) return;
      this.notificationPreferences.set(preferences);
      this.snackbar.open($localize`:@@ui.80ee592bd13d13:Preferencia de avisos guardada`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 3000 });
    } catch (err) {
      if (current()) this.toast(err, $localize`:@@ui.e6b3f4e6a5412d:No se pudo guardar la preferencia. Inténtalo de nuevo.`);
    } finally {
      if (current()) this.notificationPrefsBusy.set(false);
    }
  }

  private readonly exportCoordinator = this.createSettingsExportCoordinator();

  private createSettingsExportCoordinator(): SettingsExportCoordinator {
    const owner = () => this;
    return new SettingsExportCoordinator({
      $EXPORT_STAGE_LABELS: SettingsComponent.EXPORT_STAGE_LABELS,
      $EXPORT_STATUS_LABELS: SettingsComponent.EXPORT_STATUS_LABELS,
      accountContext: this.accountContext.bind(this),
      get actions() { return owner().actions; },
      get auth() { return owner().auth; },
      get destroyRef() { return owner().destroyRef; },
      get dialogs() { return owner().dialogs; },
      get exportBusy() { return owner().exportBusy; },
      get exportDialog() { return owner().exportDialog; },
      set exportDialog(value) { owner().exportDialog = value; },
      get exportError() { return owner().exportError; },
      get exportExpiryTimer() { return owner().exportExpiryTimer; },
      set exportExpiryTimer(value) { owner().exportExpiryTimer = value; },
      get exportHeading() { return owner().exportHeading; },
      get exportHistory() { return owner().exportHistory; },
      get exportHistoryRequest() { return owner().exportHistoryRequest; },
      get exportLoading() { return owner().exportLoading; },
      get exportMutationRequest() { return owner().exportMutationRequest; },
      get exportPollLastStatus() { return owner().exportPollLastStatus; },
      set exportPollLastStatus(value) { owner().exportPollLastStatus = value; },
      get exportPoller() { return owner().exportPoller; },
      get exportRefreshing() { return owner().exportRefreshing; },
      get exportRequest() { return owner().exportRequest; },
      get exportStatus() { return owner().exportStatus; },
      get injector() { return owner().injector; },
      settleAfterConfirmedMutation: this.settleAfterConfirmedMutation.bind(this),
      get snackbar() { return owner().snackbar; },
      toast: this.toast.bind(this),
      get user() { return owner().user; },
    });
  }

  private readonly sessionsCoordinator = this.createSettingsSessionsCoordinator();

  private createSettingsSessionsCoordinator(): SettingsSessionsCoordinator {
    const owner = () => this;
    return new SettingsSessionsCoordinator({
      accountContext: this.accountContext.bind(this),
      get auth() { return owner().auth; },
      get destroyRef() { return owner().destroyRef; },
      get router() { return owner().router; },
      get sessionDeadline() { return owner().sessionDeadline; },
      get sessionDeadlineContext() { return owner().sessionDeadlineContext; },
      set sessionDeadlineContext(value) { owner().sessionDeadlineContext = value; },
      get sessionRevocationRequests() { return owner().sessionRevocationRequests; },
      get sessions() { return owner().sessions; },
      get sessionsError() { return owner().sessionsError; },
      get sessionsLoading() { return owner().sessionsLoading; },
      get sessionsRequest() { return owner().sessionsRequest; },
      get sessionsTruncated() { return owner().sessionsTruncated; },
      get snackbar() { return owner().snackbar; },
      toast: this.toast.bind(this),
      get user() { return owner().user; },
    });
  }

  private readonly privacyCoordinator = this.createSettingsPrivacyCoordinator();

  private createSettingsPrivacyCoordinator(): SettingsPrivacyCoordinator {
    const owner = () => this;
    return new SettingsPrivacyCoordinator({
      accountContext: this.accountContext.bind(this),
      get actions() { return owner().actions; },
      get activeSection() { return owner().activeSection; },
      get api() { return owner().api; },
      get auth() { return owner().auth; },
      get destroyRef() { return owner().destroyRef; },
      get injector() { return owner().injector; },
      get privacyAction() { return owner().privacyAction; },
      get privacyBusy() { return owner().privacyBusy; },
      get privacyError() { return owner().privacyError; },
      get privacyForm() { return owner().privacyForm; },
      get privacyLoading() { return owner().privacyLoading; },
      get privacyMutationError() { return owner().privacyMutationError; },
      get privacyMutationRequest() { return owner().privacyMutationRequest; },
      get privacyPage() { return owner().privacyPage; },
      get privacyPageSize() { return owner().privacyPageSize; },
      get privacyReceipt() { return owner().privacyReceipt; },
      get privacyReceiptBlock() { return owner().privacyReceiptBlock; },
      get privacyRequest() { return owner().privacyRequest; },
      get privacyRequests() { return owner().privacyRequests; },
      get privacyResponseContext() { return owner().privacyResponseContext; },
      set privacyResponseContext(value) { owner().privacyResponseContext = value; },
      get privacyResponseDrafts() { return owner().privacyResponseDrafts; },
      get privacyResponseForm() { return owner().privacyResponseForm; },
      get privacyResponseId() { return owner().privacyResponseId; },
      get privacyResponseInput() { return owner().privacyResponseInput; },
      get privacyTotal() { return owner().privacyTotal; },
      get snackbar() { return owner().snackbar; },
      toast: this.toast.bind(this),
      get user() { return owner().user; },
    });
  }

  private readonly mfaCoordinator = this.createSettingsMfaCoordinator();

  private createSettingsMfaCoordinator(): SettingsMfaCoordinator {
    const owner = () => this;
    return new SettingsMfaCoordinator({
      accountContext: this.accountContext.bind(this),
      get actions() { return owner().actions; },
      get auth() { return owner().auth; },
      get destroyRef() { return owner().destroyRef; },
      loadSessions: this.loadSessions.bind(this),
      get mfaBusy() { return owner().mfaBusy; },
      get mfaCodeForm() { return owner().mfaCodeForm; },
      get mfaDisableForm() { return owner().mfaDisableForm; },
      get mfaPasswordForm() { return owner().mfaPasswordForm; },
      get mfaQr() { return owner().mfaQr; },
      get mfaQrLoading() { return owner().mfaQrLoading; },
      get mfaReconfigureForm() { return owner().mfaReconfigureForm; },
      get mfaReconfiguring() { return owner().mfaReconfiguring; },
      get mfaRequests() { return owner().mfaRequests; },
      get mfaSecret() { return owner().mfaSecret; },
      get mfaUri() { return owner().mfaUri; },
      get qrCode() { return owner().qrCode; },
      get recoveryCodes() { return owner().recoveryCodes; },
      get recoveryCodesAcknowledged() { return owner().recoveryCodesAcknowledged; },
      get recoveryRegenerateForm() { return owner().recoveryRegenerateForm; },
      get recoveryRegenerating() { return owner().recoveryRegenerating; },
      settleAfterConfirmedMutation: this.settleAfterConfirmedMutation.bind(this),
      get snackbar() { return owner().snackbar; },
      toast: this.toast.bind(this),
      get uncertainMfaSetup() { return owner().uncertainMfaSetup; },
      get userMutationUnconfirmed() { return owner().userMutationUnconfirmed; },
      get userRefreshRequired() { return owner().userRefreshRequired; },
    });
  }

  constructor() {
    this.profileForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.profileSaveState.set("idle"));
    let identity = this.accountContext();
    effect(() => {
      const nextIdentity = this.accountContext();
      if (identity !== nextIdentity) {
        identity = nextIdentity;
        untracked(() => {
          this.clearAccountView();
          this.loadAccountView();
        });
      }
    });
    effect(() => {
      if (this.uncertainMfaSetup() && !this.userRefreshRequired() && this.user()) {
        untracked(() => this.settleUncertainMfaUi());
      }
    });
    this.destroyRef.onDestroy(() => {
      this.clearAccountView();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", this.exportReadyRefreshHandler);
        window.removeEventListener("focus", this.exportReadyRefreshHandler);
      }
    });
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.exportReadyRefreshHandler);
      window.addEventListener("focus", this.exportReadyRefreshHandler);
    }
    this.loadAccountView();
  }

  private loadAccountView(): void {
    if (!this.user() || this.destroyRef.destroyed) return;
    // Observe pending exports even before Privacy is opened, preserving the
    // existing polling, completion/history refresh and expiry behavior.
    void this.loadExportStatus(true, false, false);
    this.loadSection(this.activeSection());
  }

  private loadSection(section: string): void {
    if (!this.user() || this.destroyRef.destroyed || this.initializedSections.has(section)
      || !Object.hasOwn(SettingsComponent.SECTION_PATHS, section)) return;
    // Mark before starting reads: direct routes also activate after view init,
    // and returning while a request is pending must not restart it. Explicit
    // retries and mutation refreshes keep using their existing read methods.
    this.initializedSections.add(section);
    switch (section) {
      case "security": void this.loadSessions(); break;
      case "notifications": void this.loadNotificationPreferences(); break;
      case "privacy":
        void this.loadExportHistory();
        void this.loadPrivacyRequests();
        break;
      case "danger": void this.loadDeletionImpact(); break;
    }
  }

  /** Clear the outgoing owner's data before any replacement reads can settle. */
  private clearAccountView(): void {
    this.initializedSections.clear();
    this.clearSensitiveMfaUi();
    this.resetNotificationPreferences();
    for (const requests of [this.profileRequests, this.profileRefreshRequests, this.workspaceNavigationRequests,
      this.sessionsRequest, this.exportRequest, this.exportHistoryRequest, this.deletionRequest, this.privacyRequest,
      this.exportMutationRequest, this.privacyMutationRequest]) requests.invalidate();
    // Session revocation retains its own guard for the intentional current-
    // session logout transition; reads and other commands never own that exit.
    this.profileBusy.set(false);
    this.profileSaveState.set("idle");
    this.profileRefreshBusy.set(false);
    this.profileForm.reset({ name: this.user()?.name ?? "" });
    this.sessionDeadline.stop();
    this.sessionDeadlineContext = null;
    this.sessions.set([]);
    this.sessionsTruncated.set(false);
    this.sessionsLoading.set(false);
    this.sessionsError.set(null);
    this.exportPoller.stop();
    this.exportPoller.reset();
    this.stopExportExpiryCheck();
    this.exportPollLastStatus = null;
    this.exportStatus.set(null);
    this.exportHistory.set([]);
    this.exportLoading.set(false);
    this.exportError.set(null);
    this.exportRefreshing.set(false);
    this.exportBusy.set(false);
    this.deletionImpact.set(null);
    this.deletionError.set(null);
    this.deletionLoading.set(false);
    this.privacyRequests.set([]);
    this.privacyTotal.set(0);
    this.privacyPage.set(0);
    this.privacyLoading.set(false);
    this.privacyBusy.set(false);
    this.privacyError.set(null);
    this.privacyMutationError.set(null);
    this.privacyAction.set(null);
    this.privacyReceipt.set(null);
    this.privacyForm.enable({ emitEvent: false });
    this.privacyResponseForm.enable({ emitEvent: false });
    this.privacyResponseId.set(null);
    this.privacyResponseDrafts.clear();
    this.privacyResponseContext = null;
    this.privacyForm.reset({ type: "access", details: "" });
    this.privacyResponseForm.reset();
    const overlays = [this.deletionDialog, this.emailDialog, this.passwordDialog, this.exportDialog];
    this.deletionDialog = undefined;
    this.emailDialog = undefined;
    this.passwordDialog = undefined;
    this.exportDialog = undefined;
    for (const overlay of overlays) overlay?.close(false);
  }

  private toast(err: unknown, fallback: string): void {
    const message = err instanceof ApiRequestError
      ? err.message
      : fallback || $localize`:@@ui.b1c26ea000def7:No se pudo completar la operación`;
    this.snackbar.open(message, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 4000 });
  }

  /** A committed security change must never be reported as rolled back. */
  private async settleAfterConfirmedMutation(tasks: Promise<unknown>[]): Promise<void> {
    const context = this.accountContext();
    const results = await Promise.allSettled(tasks);
    if (context === this.accountContext() && !this.destroyRef.destroyed && results.some((result) => result.status === "rejected")) {
      this.snackbar.open($localize`:@@ui.118b2d3dee30e7:El cambio se aplicó, pero no se pudo actualizar toda la vista. Recárgala antes de repetir la operación.`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 5000 });
    }
  }

  async saveProfile(): Promise<void> {
    if (this.profileForm.invalid || this.profileBusy()) return;
    const request = this.profileRequests.begin(this.accountContext());
    const current = () => this.profileRequests.isCurrent(request, this.accountContext());
    this.profileBusy.set(true);
    try {
      await this.auth.updateProfile(this.profileForm.controls.name.value.trim());
      if (!current()) return;
      this.profileForm.markAsPristine();
      this.profileSaveState.set("saved");
      this.snackbar.open($localize`:@@ui.0d776709ee6731:Perfil actualizado`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 2500 });
    } catch (err) {
      if (!current()) return;
      this.toast(err, "");
    } finally {
      if (current()) this.profileBusy.set(false);
    }
  }

  navigateFromSectionNav({ id, event }: { id: string; event: MouseEvent }): void {
    const section = id === "account" ? this.accountSectionRef()
      : id === "security" ? this.securitySectionRef()
        : id === "notifications" ? this.notificationsSectionRef()
          : id === "privacy" ? this.privacySectionRef()
            : id === "danger" ? this.dangerSectionRef() : null;
    if (section) this.goToSection(event, section.nativeElement);
  }

  async refreshAccountView(event?: Event): Promise<void> {
    if (this.profileRefreshBusy()) return;
    const control = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const section = control?.closest<HTMLElement>(".settings-section");
    const wasUnconfirmed = this.userMutationUnconfirmed();
    const request = this.profileRefreshRequests.begin(this.accountContext());
    const current = () => this.profileRefreshRequests.isCurrent(request, this.accountContext());
    this.profileRefreshBusy.set(true);
    try {
      await this.auth.refreshUser();
      if (current() && !this.userRefreshRequired() && wasUnconfirmed) {
        // /me cannot recover a lost write-only pending secret or credential
        // issue. Drop the uncertain enrollment and keep explicit recovery help.
        this.settleUncertainMfaUi();
      }
      if (current() && !this.userRefreshRequired() && control
        && (document.activeElement === control || (!control.isConnected && document.activeElement === document.body))) {
        // The successful read removes its retry button. Keep keyboard focus in
        // the section unless the user already chose another control meanwhile.
        section?.focus({ preventScroll: true });
      }
    } catch (error) {
      if (current()) this.toast(error, $localize`:@@ui.8c51e56c2213c0:Los cambios siguen confirmados, pero no se pudo actualizar la vista.`);
    } finally {
      if (current()) this.profileRefreshBusy.set(false);
    }
  }

  openEmailDialog(mode: EmailAccessDialogData["mode"]): void {
    if (this.emailDialog || !this.user() || this.destroyRef.destroyed) return;
    const context = this.accountContext();
    const data: EmailAccessDialogData = { mode, pendingEmail: this.user()?.pendingEmail };
    const dialog = this.dialogs.open(EmailAccessDialogComponent, {
      data, width: "min(560px, 94vw)", maxWidth: "94vw", maxHeight: "92dvh",
      autoFocus: mode === "change" ? "#email-address-step input" : "first-heading", restoreFocus: true, injector: this.injector,
      ariaLabel: mode === "change" ? $localize`:@@ui.7d85a47228f751:Cambiar el email de acceso` : $localize`:@@ui.f07602dac1c062:Cancelar el cambio de email pendiente`,
    });
    this.emailDialog = dialog;
    dialog.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((completed) => {
      if (this.emailDialog !== dialog) return;
      this.emailDialog = undefined;
      if (!completed || context !== this.accountContext() || this.destroyRef.destroyed) return;
      this.snackbar.open(mode === "change" ? $localize`:@@ui.85a964ac8eaabf:Confirmación enviada al nuevo email` : $localize`:@@ui.0e55f6ade6c6aa:Cambio de email cancelado`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 3500 });
    });
  }

  openPasswordDialog(): void {
    if (this.passwordDialog || !this.user() || this.destroyRef.destroyed) return;
    const context = this.accountContext();
    const dialog = this.dialogs.open(PasswordChangeDialogComponent, {
      width: "min(610px, 94vw)", maxWidth: "94vw", maxHeight: "92dvh",
      autoFocus: "#password-credentials-step input", restoreFocus: true, injector: this.injector,
      ariaLabel: $localize`:@@ui.1ae6668b609d6a:Cambiar la contraseña de acceso`,
    });
    this.passwordDialog = dialog;
    dialog.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((completed) => {
      if (this.passwordDialog !== dialog) return;
      this.passwordDialog = undefined;
      if (!completed || context !== this.accountContext() || this.destroyRef.destroyed) return;
      this.snackbar.open($localize`:@@ui.f29a5970a4ab27:Contraseña actualizada`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 2500 });
      void this.settleAfterConfirmedMutation([this.auth.refreshUser(), this.loadSessions()]);
    });
  }

  async loadSessions(): Promise<void> {
    return this.sessionsCoordinator.loadSessions();
  }

  /**
   * `silent` lo usan las sondas: no mueve el esqueleto, no avisa de nada y
   * conserva el último estado conocido si la red falla (la siguiente sonda
   * reintenta). Un fallo de lectura nunca confirma que no hay exportación.
   */
  async loadExportStatus(notify = true, silent = false, reloadHistory = true): Promise<void> {
    return this.exportCoordinator.loadExportStatus(notify, silent, reloadHistory);
  }

  /** Recover the observation, keeping keyboard focus and never replaying a write. */
  async retryExportStatus(): Promise<void> {
    return this.exportCoordinator.retryExportStatus();
  }

  /**
   * Historial de exportaciones (máximo diez). Un fallo aquí nunca bloquea la
   * tarjeta de estado: lo que manda es la exportación activa.
   */
  async loadExportHistory(): Promise<void> {
    return this.exportCoordinator.loadExportHistory();
  }

  private exportNeedsPoll(): boolean {
    return this.exportCoordinator.exportNeedsPoll();
  }

  /** Una exportación lista no sondea: al volver a la pestaña se refresca una vez. */
  private readonly exportReadyRefreshHandler = (): void => {
    if (this.exportRefreshing() || (typeof document !== "undefined" && document.hidden)) return;
    if ((this.exportStatus()?.status ?? null) === "ready") void this.loadExportStatus(false, true);
  };

  /**
   * Un único temporizador hasta `downloadExpiresAt`: al caducar, la tarjeta se
   * refresca una vez y pasa a `expired` sin sondeos periódicos.
   */
  private armExportExpiryCheck(status: DataExportStatus | null): void {
    return this.exportCoordinator.armExportExpiryCheck(status);
  }

  private stopExportExpiryCheck(): void {
    return this.exportCoordinator.stopExportExpiryCheck();
  }

  openDataExportDialog(purpose: "request" | "download" = "request"): void {
    return this.exportCoordinator.openDataExportDialog(purpose);
  }

  async cancelDataExport(): Promise<void> {
    return this.exportCoordinator.cancelDataExport();
  }

  exportIsActive(): boolean {
    return this.exportCoordinator.exportIsActive();
  }

  /** Los estados con acción propia no repiten la entrada «Solicitar mi archivo». */
  exportShowsRequestEntry(): boolean {
    return this.exportCoordinator.exportShowsRequestEntry();
  }

  private static readonly EXPORT_STAGE_LABELS: Record<DataExportStage, string> = {
    collecting: $localize`:@@ui.ded18e499b9989:Recopilando tus datos`,
    analytics: $localize`:@@ui.d0e456ee29ea8c:Calculando totales`,
    encoding: $localize`:@@ui.0de61228d15e5f:Preparando el contenido`,
    encrypting: $localize`:@@ui.90a0155ac11d8c:Cifrando el archivo`,
    finalizing: $localize`:@@ui.ec4e979c0a2474:Finalizando la entrega`,
  };

  private static readonly EXPORT_STATUS_LABELS: Record<DataExportStatus["status"], string> = {
    processing: $localize`:@@ui.e7f805cdbc6e2a:En preparación`,
    ready: "Lista",
    downloaded: "Descargada",
    failed: $localize`:@@ui.184f9f08775f92:Falló`,
    cancelled: "Cancelada",
    expired: "Caducada",
  };

  /** Etapa viva de la generación; sin etapa conocida, texto neutro. */
  exportStageLabel(stage: DataExportStage | null): string {
    return this.exportCoordinator.exportStageLabel(stage);
  }

  exportStatusLabel(status: DataExportStatus["status"]): string {
    return this.exportCoordinator.exportStatusLabel(status);
  }

  /** Icono y tono de la tarjeta comparten el estado de la exportación. */
  exportTone(status: DataExportStatus["status"]): AsyncOperationTone {
    return this.exportCoordinator.exportTone(status);
  }

  exportIcon(status: DataExportStatus["status"]): string {
    return this.exportCoordinator.exportIcon(status);
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
    if (!this.user() || this.destroyRef.destroyed) return;
    const context = this.auth.sessionGeneration();
    const request = this.deletionRequest.begin(context);
    this.deletionLoading.set(true);
    this.deletionError.set(null);
    try {
      const impact = await this.auth.accountDeletionImpact({ signal: request.signal });
      if (!this.deletionRequest.isCurrent(request, this.auth.sessionGeneration())) return;
      this.deletionImpact.set(impact);
    } catch (err) {
      if (!this.deletionRequest.isCurrent(request, this.auth.sessionGeneration())) return;
      this.deletionImpact.set(null);
      this.deletionError.set(err instanceof ApiRequestError ? err.message : $localize`:@@ui.f704117f5b61d6:No se pudo consultar el impacto de la eliminación`);
      if (notify) this.toast(err, $localize`:@@ui.f704117f5b61d6:No se pudo consultar el impacto de la eliminación`);
    } finally {
      if (this.deletionRequest.isCurrent(request, this.auth.sessionGeneration())) this.deletionLoading.set(false);
    }
  }

  openAccountDeletion(): void {
    if (this.deletionDialog || this.deletionLoading() || !this.deletionImpact()?.canDelete || !this.user() || this.destroyRef.destroyed) return;
    const context = this.accountContext();
    const dialog = this.dialogs.open(AccountDeletionDialogComponent, {
      width: "min(580px, 94vw)", maxWidth: "94vw", maxHeight: "92dvh",
      autoFocus: "first-heading", restoreFocus: true, injector: this.injector,
      ariaLabel: $localize`:@@ui.71e30909a34f9d:Solicitar el cierre de cuenta`,
    });
    this.deletionDialog = dialog;
    dialog.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.deletionDialog !== dialog) return;
      this.deletionDialog = undefined;
      if (context !== this.accountContext() || this.destroyRef.destroyed) return;
      // Refresh even on Escape after a successful send; the returned value is
      // never used as proof of server state and contains no credentials.
      void this.loadDeletionImpact();
    });
  }

  async loadPrivacyRequests(notify = false): Promise<void> {
    return this.privacyCoordinator.loadPrivacyRequests(notify);
  }

  onPrivacyPage(event: PageEvent): void {
    return this.privacyCoordinator.onPrivacyPage(event);
  }

  async submitPrivacyRequest(): Promise<void> {
    return this.privacyCoordinator.submitPrivacyRequest();
  }

  beginPrivacyResponse(id: number): void {
    return this.privacyCoordinator.beginPrivacyResponse(id);
  }

  async respondPrivacy(request: PrivacyRightRequest): Promise<void> {
    return this.privacyCoordinator.respondPrivacy(request);
  }

  async cancelPrivacy(request: PrivacyRightRequest): Promise<void> {
    return this.privacyCoordinator.cancelPrivacy(request);
  }

  closePrivacyResponse(): void {
    return this.privacyCoordinator.closePrivacyResponse();
  }

  private rememberPrivacyResponse(): void {
    return this.privacyCoordinator.rememberPrivacyResponse();
  }

  private startPrivacyMutation(action: "create" | "respond" | "cancel"): void {
    return this.privacyCoordinator.startPrivacyMutation(action);
  }

  private finishPrivacyMutation(): void {
    return this.privacyCoordinator.finishPrivacyMutation();
  }

  private confirmPrivacyAcknowledgement(response: unknown): void {
    return this.privacyCoordinator.confirmPrivacyAcknowledgement(response);
  }

  private privacyFailure(error: unknown): string {
    return this.privacyCoordinator.privacyFailure(error);
  }

  readonly privacyGuidance = PRIVACY_RIGHT_GUIDANCE;
  readonly privacyMessageAuthor = privacyRightMessageAuthor;
  readonly privacyNextStep = privacyRightNextStep;

  readonly privacyTypeLabel = privacyRightTypeLabel;
  readonly privacyStatusLabel = privacyRightStatusLabel;
  readonly privacyIsActive = privacyRightIsActive;
  readonly privacyTypeOptions = PRIVACY_RIGHT_TYPE_ORDER;

  async openOwnedWorkspace(id: number): Promise<void> {
    const request = this.workspaceNavigationRequests.begin(this.accountContext());
    const current = () => this.workspaceNavigationRequests.isCurrent(request, this.accountContext());
    const previous = this.workspaces.currentId();
    this.workspaces.select(id);
    try {
      const navigated = await this.router.navigate(["/app/team"]);
      if (!current()) return;
      if (!navigated && this.workspaces.currentId() === id) this.workspaces.select(previous);
    } catch (error) {
      if (!current()) return;
      if (this.workspaces.currentId() === id) this.workspaces.select(previous);
      this.toast(error, $localize`:@@ui.1e00cd61af484f:No se pudo abrir el workspace`);
    }
  }

  async revokeSession(session: Session): Promise<void> {
    return this.sessionsCoordinator.revokeSession(session);
  }

  async startMfaSetup(): Promise<void> {
    return this.mfaCoordinator.startMfaSetup();
  }

  async startMfaReconfiguration(): Promise<void> {
    return this.mfaCoordinator.startMfaReconfiguration();
  }

  private async stageMfaSetup(password: string, code?: string): Promise<void> {
    return this.mfaCoordinator.stageMfaSetup(password, code);
  }

  beginMfaReconfiguration(): void {
    return this.mfaCoordinator.beginMfaReconfiguration();
  }

  async enableMfa(): Promise<void> {
    return this.mfaCoordinator.enableMfa();
  }

  async disableMfa(): Promise<void> {
    return this.mfaCoordinator.disableMfa();
  }

  async cancelMfaSetup(): Promise<void> {
    return this.mfaCoordinator.cancelMfaSetup();
  }

  cancelMfaReconfiguration(): void {
    return this.mfaCoordinator.cancelMfaReconfiguration();
  }

  private accountContext(): string {
    return `${this.auth.user()?.id}:${this.auth.sessionGeneration()}`;
  }

  private clearSensitiveMfaUi(): void {
    return this.mfaCoordinator.clearSensitiveMfaUi();
  }

  private clearMfaSetupUi(): void {
    return this.mfaCoordinator.clearMfaSetupUi();
  }

  private settleUncertainMfaUi(): void {
    return this.mfaCoordinator.settleUncertainMfaUi();
  }

  finishRecoveryCodes(): void {
    return this.mfaCoordinator.finishRecoveryCodes();
  }

  beginRecoveryRegeneration(): void {
    return this.mfaCoordinator.beginRecoveryRegeneration();
  }

  cancelRecoveryRegeneration(): void {
    return this.mfaCoordinator.cancelRecoveryRegeneration();
  }

  async regenerateRecoveryCodes(): Promise<void> {
    return this.mfaCoordinator.regenerateRecoveryCodes();
  }

  copyRecoveryCodes(): void {
    return this.mfaCoordinator.copyRecoveryCodes();
  }

  downloadRecoveryCodes(): void {
    return this.mfaCoordinator.downloadRecoveryCodes();
  }

  setTheme(pref: ThemePreference): void {
    this.theme.set(pref);
  }

  formatDate(iso: string): string {
    return dateTimeMediumLabel(iso, $localize`:@@ui.4657b321be4201:Fecha no disponible`);
  }
}
