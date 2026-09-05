import { Component, computed, inject, signal, ChangeDetectionStrategy } from "@angular/core";

import { Router } from "@angular/router";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { MatRadioModule } from "@angular/material/radio";
import { MatDividerModule } from "@angular/material/divider";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatSelectModule } from "@angular/material/select";
import { MatPaginatorModule, type PageEvent } from "@angular/material/paginator";
import QRCode from "qrcode";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ThemeService, type ThemePreference } from "../../core/services/theme.service";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import type { AccountDeletionImpact, DataExportStatus, PrivacyRightRequest, PrivacyRightStatus, PrivacyRightType, Session } from "../../core/models";
import { ActionDialogService } from "../action-dialog.service";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";

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
    MatRadioModule,
    MatDividerModule,
    MatCheckboxModule,
    MatSelectModule,
    MatPaginatorModule,
    PageHeaderComponent,
    PanelSkeletonComponent,
  ],
  templateUrl: "./settings.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./settings.component.scss",
})
export class SettingsComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private workspaces = inject(WorkspaceService);
  private router = inject(Router);
  private theme = inject(ThemeService);
  private snackbar = inject(MatSnackBar);
  private actions = inject(ActionDialogService);
  private api = inject(ApiService);
  private readonly dateTimeFormatter = new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  readonly user = this.auth.user;
  readonly userInitials = computed(() => {
    const parts = (this.user()?.name ?? "UVH").trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "UV";
  });

  // ---------------- Profile ----------------
  readonly profileBusy = signal(false);
  profileForm = this.fb.nonNullable.group({
    name: [this.user()?.name ?? "", [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
  });
  readonly emailBusy = signal(false);
  readonly emailChangeOpen = signal(false);
  emailChangeForm = this.fb.nonNullable.group({
    newEmail: ["", [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ["", [Validators.required, Validators.maxLength(72)]],
    factorCode: ["", [Validators.pattern(/^(?:\d{6}|[A-Za-z2-9\s-]{16,24})$/)]],
  });
  emailCancelForm = this.fb.nonNullable.group({
    password: ["", [Validators.required, Validators.maxLength(72)]],
    factorCode: ["", [Validators.pattern(/^(?:\d{6}|[A-Za-z2-9\s-]{16,24})$/)]],
  });

  // ---------------- Password ----------------
  readonly passwordBusy = signal(false);
  readonly hidePassword = signal(true);
  passwordForm = this.fb.nonNullable.group(
    {
      current: ["", [Validators.required]],
      next: ["", [Validators.required, Validators.minLength(10), Validators.maxLength(72)]],
      confirm: ["", [Validators.required]],
      factorCode: ["", [Validators.pattern(/^(?:\d{6}|[A-Za-z2-9\s-]{16,24})$/)]],
    },
    { validators: (g) => (g.get("next")?.value === g.get("confirm")?.value ? null : { mismatch: true }) },
  );

  // ---------------- Sessions ----------------
  readonly sessions = signal<Session[]>([]);
  readonly sessionsLoading = signal(true);
  readonly sessionsError = signal<string | null>(null);

  // ---------------- Data export ----------------
  readonly exportStatus = signal<DataExportStatus | null>(null);
  readonly exportLoading = signal(true);
  readonly exportBusy = signal(false);
  exportForm = this.fb.nonNullable.group({
    password: ["", [Validators.required, Validators.maxLength(72)]],
    factorCode: ["", [Validators.pattern(/^(?:\d{6}|[A-Za-z2-9\s-]{16,24})$/)]],
  });

  // ---------------- Account deletion ----------------
  readonly deletionImpact = signal<AccountDeletionImpact | null>(null);
  readonly deletionLoading = signal(true);
  readonly deletionBusy = signal(false);
  deletionForm = this.fb.nonNullable.group({
    password: ["", [Validators.required, Validators.maxLength(72)]],
    factorCode: ["", [Validators.pattern(/^(?:\d{6}|[A-Za-z2-9\s-]{16,24})$/)]],
    confirmation: ["", [Validators.required, Validators.pattern(/^ELIMINAR MI CUENTA$/)]],
  });

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

  constructor() {
    void this.loadSessions();
    void this.loadExportStatus();
    void this.loadDeletionImpact();
    void this.loadPrivacyRequests();
  }

  private toast(err: unknown, ok: string): void {
    if (err instanceof ApiRequestError) {
      this.snackbar.open(err.message, "Cerrar", { duration: 4000 });
    } else {
      this.snackbar.open(ok, "Cerrar", { duration: 2500 });
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

  beginEmailChange(): void {
    if (this.emailBusy()) return;
    this.emailChangeOpen.set(true);
    this.emailChangeForm.reset();
  }

  closeEmailChange(): void {
    if (this.emailBusy()) return;
    this.emailChangeOpen.set(false);
    this.emailChangeForm.reset();
  }

  async requestEmailChange(): Promise<void> {
    const factor = this.emailChangeForm.controls.factorCode;
    if (this.user()?.mfaEnabled && !factor.value.trim()) {
      factor.setErrors({ required: true });
      factor.markAsTouched();
    }
    if (this.emailChangeForm.invalid || this.emailBusy()) {
      this.emailChangeForm.markAllAsTouched();
      return;
    }

    this.emailBusy.set(true);
    try {
      await this.auth.requestEmailChange(
        this.emailChangeForm.controls.newEmail.value.trim(),
        this.emailChangeForm.controls.password.value,
        factor.value.trim() || undefined,
      );
      this.emailChangeForm.reset();
      this.emailCancelForm.reset();
      this.emailChangeOpen.set(false);
      this.snackbar.open("Confirmación enviada al nuevo email", "Cerrar", { duration: 3500 });
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.emailBusy.set(false);
    }
  }

  async cancelEmailChange(): Promise<void> {
    const factor = this.emailCancelForm.controls.factorCode;
    if (this.user()?.mfaEnabled && !factor.value.trim()) {
      factor.setErrors({ required: true });
      factor.markAsTouched();
    }
    if (this.emailCancelForm.invalid || this.emailBusy()) {
      this.emailCancelForm.markAllAsTouched();
      return;
    }
    const confirmed = await this.actions.confirm({
      title: "Cancelar cambio de email",
      message: "El enlace enviado al nuevo buzón dejará de funcionar.",
      confirmLabel: "Cancelar cambio",
      destructive: true,
    });
    if (!confirmed) return;

    this.emailBusy.set(true);
    try {
      await this.auth.cancelEmailChange(
        this.emailCancelForm.controls.password.value,
        factor.value.trim() || undefined,
      );
      this.emailCancelForm.reset();
      this.snackbar.open("Cambio de email cancelado", "Cerrar", { duration: 2500 });
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.emailBusy.set(false);
    }
  }

  async changePassword(): Promise<void> {
    const factorControl = this.passwordForm.controls.factorCode;
    if (this.user()?.mfaEnabled && !factorControl.value.trim()) {
      factorControl.setErrors({ required: true });
      factorControl.markAsTouched();
    }
    if (this.passwordForm.invalid || this.passwordBusy()) return;
    this.passwordBusy.set(true);
    try {
      await this.auth.changePassword(
        this.passwordForm.controls.current.value,
        this.passwordForm.controls.next.value,
        factorControl.value.trim() || undefined,
      );
      this.passwordForm.reset();
      await Promise.all([this.auth.refreshUser(), this.loadSessions()]);
      this.snackbar.open("Contraseña actualizada", "Cerrar", { duration: 2500 });
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.passwordBusy.set(false);
    }
  }

  async loadSessions(): Promise<void> {
    this.sessionsLoading.set(true);
    this.sessionsError.set(null);
    try {
      const now = Date.now();
      const sessions = await this.auth.listSessions();
      this.sessions.set(sessions.filter((session) => !session.revoked_at && new Date(session.expires_at).getTime() > now));
    } catch (err) {
      this.sessions.set([]);
      this.sessionsError.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar las sesiones");
    } finally {
      this.sessionsLoading.set(false);
    }
  }

  async loadExportStatus(): Promise<void> {
    this.exportLoading.set(true);
    try {
      this.exportStatus.set(await this.auth.dataExportStatus());
    } catch (err) {
      this.exportStatus.set(null);
      this.toast(err, "");
    } finally {
      this.exportLoading.set(false);
    }
  }

  async requestDataExport(): Promise<void> {
    const factor = this.exportForm.controls.factorCode;
    if (this.user()?.mfaEnabled && !factor.value.trim()) {
      factor.setErrors({ required: true });
      factor.markAsTouched();
    }
    if (this.exportForm.invalid || this.exportBusy()) {
      this.exportForm.markAllAsTouched();
      return;
    }
    this.exportBusy.set(true);
    try {
      const status = await this.auth.requestDataExport(
        this.exportForm.controls.password.value,
        factor.value.trim() || undefined,
      );
      this.exportStatus.set(status);
      this.exportForm.reset();
      await this.auth.refreshUser();
      this.snackbar.open("Revisa tu email para confirmar la exportación", "Cerrar", { duration: 3500 });
    } catch (err) {
      this.toast(err, "");
      void this.loadExportStatus();
    } finally {
      this.exportBusy.set(false);
    }
  }

  async cancelDataExport(): Promise<void> {
    if (this.exportBusy()) return;
    const confirmed = await this.actions.confirm({
      title: "Cancelar exportación",
      message: "La confirmación o descarga pendiente dejará de funcionar y se eliminará el archivo privado si ya estaba preparado.",
      confirmLabel: "Cancelar exportación",
      destructive: true,
    });
    if (!confirmed) return;
    this.exportBusy.set(true);
    try {
      await this.auth.cancelDataExport();
      await this.loadExportStatus();
      this.snackbar.open("Exportación cancelada", "Cerrar", { duration: 2500 });
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.exportBusy.set(false);
    }
  }

  exportIsActive(): boolean {
    return ["requested", "processing", "ready"].includes(this.exportStatus()?.status ?? "");
  }

  async loadDeletionImpact(): Promise<void> {
    this.deletionLoading.set(true);
    try {
      this.deletionImpact.set(await this.auth.accountDeletionImpact());
    } catch (err) {
      this.deletionImpact.set(null);
      this.toast(err, "");
    } finally {
      this.deletionLoading.set(false);
    }
  }

  async requestAccountDeletion(): Promise<void> {
    const factor = this.deletionForm.controls.factorCode;
    if (this.user()?.mfaEnabled && !factor.value.trim()) {
      factor.setErrors({ required: true });
      factor.markAsTouched();
    }
    if (this.deletionForm.invalid || this.deletionBusy()) {
      this.deletionForm.markAllAsTouched();
      return;
    }
    const confirmed = await this.actions.confirm({
      title: "Solicitar eliminación de cuenta",
      message: "Te enviaremos un email y tendrás que confirmar de nuevo. Al hacerlo se cerrará el acceso y comenzará un periodo de gracia de 7 días.",
      confirmLabel: "Enviar confirmación",
      destructive: true,
    });
    if (!confirmed) return;

    this.deletionBusy.set(true);
    try {
      await this.auth.requestAccountDeletion(
        this.deletionForm.controls.password.value,
        this.deletionForm.controls.confirmation.value,
        factor.value.trim() || undefined,
      );
      this.deletionForm.reset();
      await Promise.all([this.loadDeletionImpact(), this.auth.refreshUser()]);
      this.snackbar.open("Revisa tu email para confirmar la solicitud", "Cerrar", { duration: 4000 });
    } catch (err) {
      this.toast(err, "");
      void this.loadDeletionImpact();
    } finally {
      this.deletionBusy.set(false);
    }
  }

  async loadPrivacyRequests(): Promise<void> {
    this.privacyLoading.set(true);
    this.privacyError.set(null);
    try {
      const response = await this.api.get<{ requests: PrivacyRightRequest[]; total: number }>("/api/v1/auth/privacy-requests", {
        page: this.privacyPage() + 1,
        perPage: this.privacyPageSize(),
      });
      this.privacyRequests.set(response.requests);
      this.privacyTotal.set(response.total);
    } catch (error) {
      this.privacyRequests.set([]);
      this.privacyError.set(error instanceof ApiRequestError ? error.message : "No se pudieron cargar las solicitudes");
    } finally {
      this.privacyLoading.set(false);
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
      await this.loadPrivacyRequests();
      this.snackbar.open("Solicitud registrada y plazo iniciado", "Cerrar", { duration: 3500 });
    } catch (error) {
      this.toast(error, "");
      await this.loadPrivacyRequests();
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
      await this.loadPrivacyRequests();
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

  privacyTypeLabel(type: PrivacyRightType): string {
    return ({ access: "Acceso", rectification: "Rectificación", erasure: "Supresión", objection: "Oposición", restriction: "Limitación", portability: "Portabilidad" })[type];
  }

  privacyStatusLabel(status: PrivacyRightStatus): string {
    return ({ submitted: "Registrada", in_progress: "En revisión", waiting_user: "Requiere respuesta", completed: "Resuelta", rejected: "Cerrada", cancelled: "Cancelada" })[status];
  }

  privacyIsActive(status: PrivacyRightStatus): boolean {
    return ["submitted", "in_progress", "waiting_user"].includes(status);
  }

  async openOwnedWorkspace(id: number): Promise<void> {
    this.workspaces.select(id);
    await this.router.navigate(["/app/team"]);
  }

  async revokeSession(session: Session): Promise<void> {
    try {
      await this.auth.revokeSession(session.id, session.current);
      if (session.current) {
        await this.router.navigate(["/auth"]);
        return;
      }
      this.snackbar.open("Sesión revocada", "Cerrar", { duration: 2500 });
      void this.loadSessions();
    } catch (err) {
      this.toast(err, "");
    }
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
      this.mfaQr.set(await QRCode.toDataURL(uri, { width: 240, margin: 1 }));
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
      await this.auth.refreshUser();
      this.clearMfaSetupUi();
      this.snackbar.open("MFA activado", "Cerrar", { duration: 2500 });
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
    if (!confirmed) return;
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
      await this.auth.refreshUser();
      this.snackbar.open("MFA desactivado", "Cerrar", { duration: 2500 });
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
    if (!confirmed) return;

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
      await this.auth.refreshUser();
      void this.loadSessions();
      this.snackbar.open("Códigos regenerados", "Cerrar", { duration: 2500 });
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
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "uvh-codigos-recuperacion.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  setTheme(pref: ThemePreference): void {
    this.theme.set(pref);
  }

  formatDate(iso: string): string {
    const date = new Date(iso);
    return iso && !Number.isNaN(date.getTime())
      ? this.dateTimeFormatter.format(date)
      : "Fecha no disponible";
  }
}
