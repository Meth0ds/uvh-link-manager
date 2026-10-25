import { downloadBlob } from "../../core/services/browser-download";
import type { SettingsComponent } from "./settings.component";

interface SettingsMfaCoordinatorContext {
  readonly accountContext: SettingsComponent["accountContext"];
  readonly actions: SettingsComponent["actions"];
  readonly auth: SettingsComponent["auth"];
  readonly destroyRef: SettingsComponent["destroyRef"];
  readonly loadSessions: SettingsComponent["loadSessions"];
  readonly mfaBusy: SettingsComponent["mfaBusy"];
  readonly mfaCodeForm: SettingsComponent["mfaCodeForm"];
  readonly mfaDisableForm: SettingsComponent["mfaDisableForm"];
  readonly mfaPasswordForm: SettingsComponent["mfaPasswordForm"];
  readonly mfaQr: SettingsComponent["mfaQr"];
  readonly mfaQrLoading: SettingsComponent["mfaQrLoading"];
  readonly mfaReconfigureForm: SettingsComponent["mfaReconfigureForm"];
  readonly mfaReconfiguring: SettingsComponent["mfaReconfiguring"];
  readonly mfaRequests: SettingsComponent["mfaRequests"];
  readonly mfaSecret: SettingsComponent["mfaSecret"];
  readonly mfaUri: SettingsComponent["mfaUri"];
  readonly qrCode: SettingsComponent["qrCode"];
  readonly recoveryCodes: SettingsComponent["recoveryCodes"];
  readonly recoveryCodesAcknowledged: SettingsComponent["recoveryCodesAcknowledged"];
  readonly recoveryRegenerateForm: SettingsComponent["recoveryRegenerateForm"];
  readonly recoveryRegenerating: SettingsComponent["recoveryRegenerating"];
  readonly settleAfterConfirmedMutation: SettingsComponent["settleAfterConfirmedMutation"];
  readonly snackbar: SettingsComponent["snackbar"];
  readonly toast: SettingsComponent["toast"];
  readonly uncertainMfaSetup: SettingsComponent["uncertainMfaSetup"];
  readonly userMutationUnconfirmed: SettingsComponent["userMutationUnconfirmed"];
  readonly userRefreshRequired: SettingsComponent["userRefreshRequired"];
}

/** Behaviour coordinator; forms and signals remain owned by the mounted view. */
export class SettingsMfaCoordinator {
  constructor(private readonly context: SettingsMfaCoordinatorContext) {}

  async startMfaSetup(): Promise<void> {
    if (this.context.mfaPasswordForm.invalid || this.context.mfaBusy() || this.context.userRefreshRequired()) return;
    await this.stageMfaSetup(this.context.mfaPasswordForm.controls.password.value);
  }

  async startMfaReconfiguration(): Promise<void> {
    if (this.context.mfaReconfigureForm.invalid || this.context.mfaBusy() || this.context.userRefreshRequired()) return;
    await this.stageMfaSetup(
      this.context.mfaReconfigureForm.controls.password.value,
      this.context.mfaReconfigureForm.controls.factorCode.value,
    );
  }

  async stageMfaSetup(password: string, code?: string): Promise<void> {
    const request = this.context.mfaRequests.begin(this.context.accountContext());
    const current = () => this.context.mfaRequests.isCurrent(request, this.context.accountContext());
    this.context.mfaBusy.set(true);
    try {
      const { secret, uri } = await this.context.auth.mfaSetup(password, code);
      if (!current()) return;
      this.context.mfaCodeForm.reset();
      this.context.mfaSecret.set(secret);
      this.context.mfaUri.set(uri);
      this.context.mfaQr.set(null);
      this.context.mfaQrLoading.set(true);
      try {
        const generator = await this.context.qrCode.load();
        if (!current()) return;
        const qr = await generator.toDataURL(uri, { width: 480 });
        if (!current()) return;
        this.context.mfaQr.set(qr);
      } catch {
        if (!current()) return;
        // The server-side setup already exists. Preserve the manual secret
        // instead of inviting a retry that could rotate it again.
        this.context.mfaQr.set(null);
        this.context.snackbar.open($localize`:@@ui.8bf0f88cbc0a91:La configuración está preparada, pero no se pudo generar el QR. Usa la clave manual mostrada.`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 5000 });
      } finally {
        if (current()) this.context.mfaQrLoading.set(false);
      }
      if (code) await this.context.settleAfterConfirmedMutation([this.context.auth.refreshUser()]);
    } catch (err) {
      if (!current()) return;
      this.context.toast(err, "");
    } finally {
      if (current()) this.context.mfaBusy.set(false);
    }
  }

  beginMfaReconfiguration(): void {
    if (this.context.mfaBusy() || this.context.userRefreshRequired()) return;
    this.context.mfaReconfiguring.set(true);
    this.context.mfaReconfigureForm.reset();
  }

  async enableMfa(): Promise<void> {
    if (this.context.mfaCodeForm.invalid || this.context.mfaBusy() || this.context.userRefreshRequired()) return;
    const request = this.context.mfaRequests.begin(this.context.accountContext());
    const current = () => this.context.mfaRequests.isCurrent(request, this.context.accountContext());
    this.context.mfaBusy.set(true);
    try {
      const { recoveryCodes } = await this.context.auth.mfaEnable(this.context.mfaCodeForm.controls.code.value);
      if (!current()) return;
      this.context.recoveryCodes.set(recoveryCodes);
      this.context.uncertainMfaSetup.set(false);
      this.context.recoveryCodesAcknowledged.set(false);
      this.clearMfaSetupUi();
      this.context.snackbar.open($localize`:@@ui.99b29f803bfed8:MFA activado`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 2500 });
      await this.context.settleAfterConfirmedMutation([this.context.auth.refreshUser(), this.context.loadSessions()]);
    } catch (err) {
      if (!current()) return;
      if (this.context.userMutationUnconfirmed()) this.context.uncertainMfaSetup.set(true);
      this.context.toast(err, "");
    } finally {
      if (current()) this.context.mfaBusy.set(false);
    }
  }

  async disableMfa(): Promise<void> {
    if (this.context.mfaDisableForm.invalid || this.context.mfaBusy() || this.context.userRefreshRequired()) return;
    const request = this.context.mfaRequests.begin(this.context.accountContext());
    const current = () => this.context.mfaRequests.isCurrent(request, this.context.accountContext());
    const confirmed = await this.context.actions.confirm({
      title: $localize`:@@ui.abda53de5e75f0:Desactivar MFA`,
      message: $localize`:@@ui.8ba04bd6cd693e:Tu cuenta perderá la verificación en dos pasos. Confirma con tu contraseña y un código de tu aplicación o de recuperación.`,
      confirmLabel: $localize`:@@ui.abda53de5e75f0:Desactivar MFA`,
      destructive: true,
    });
    if (!confirmed || !current() || this.context.mfaBusy() || this.context.userRefreshRequired()) return;
    this.context.mfaBusy.set(true);
    try {
      await this.context.auth.mfaDisable(
        this.context.mfaDisableForm.controls.password.value,
        this.context.mfaDisableForm.controls.factorCode.value,
      );
      if (!current()) return;
      this.context.mfaSecret.set(null);
      this.context.mfaUri.set(null);
      this.context.mfaQr.set(null);
      this.context.recoveryCodes.set([]);
      this.context.recoveryCodesAcknowledged.set(false);
      this.context.mfaReconfiguring.set(false);
      this.context.mfaPasswordForm.reset();
      this.context.mfaCodeForm.reset();
      this.context.mfaDisableForm.reset();
      this.context.snackbar.open($localize`:@@ui.af28c171782d92:MFA desactivado`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 2500 });
      await this.context.settleAfterConfirmedMutation([this.context.auth.refreshUser(), this.context.loadSessions()]);
    } catch (err) {
      if (!current()) return;
      this.context.toast(err, "");
    } finally {
      if (current()) this.context.mfaBusy.set(false);
    }
  }

  async cancelMfaSetup(): Promise<void> {
    if (this.context.mfaBusy()) return;
    const request = this.context.mfaRequests.begin(this.context.accountContext());
    const current = () => this.context.mfaRequests.isCurrent(request, this.context.accountContext());
    this.context.mfaBusy.set(true);
    try {
      await this.context.auth.mfaCancelSetup();
      if (!current()) return;
      this.clearMfaSetupUi();
    } catch (err) {
      if (!current()) return;
      this.context.toast(err, "");
    } finally {
      if (current()) this.context.mfaBusy.set(false);
    }
  }

  cancelMfaReconfiguration(): void {
    if (this.context.mfaBusy()) return;
    this.context.mfaReconfiguring.set(false);
    this.context.mfaReconfigureForm.reset();
  }

  clearSensitiveMfaUi(): void {
    this.context.mfaRequests.invalidate();
    this.clearMfaSetupUi();
    this.context.recoveryCodes.set([]);
    this.context.uncertainMfaSetup.set(false);
    this.context.recoveryCodesAcknowledged.set(false);
    this.context.recoveryRegenerating.set(false);
    this.context.recoveryRegenerateForm.reset();
    this.context.mfaDisableForm.reset();
    this.context.mfaBusy.set(false);
  }

  clearMfaSetupUi(): void {
    this.context.mfaQrLoading.set(false);
    this.context.mfaSecret.set(null);
    this.context.mfaUri.set(null);
    this.context.mfaQr.set(null);
    this.context.mfaPasswordForm.reset();
    this.context.mfaCodeForm.reset();
    this.context.mfaReconfigureForm.reset();
    this.context.mfaReconfiguring.set(false);
  }

  settleUncertainMfaUi(): void {
    this.context.uncertainMfaSetup.set(false);
    this.clearMfaSetupUi();
    this.context.recoveryCodes.set([]);
    this.context.recoveryCodesAcknowledged.set(false);
    this.context.recoveryRegenerating.set(false);
    this.context.recoveryRegenerateForm.reset();
  }

  finishRecoveryCodes(): void {
    if (!this.context.recoveryCodesAcknowledged()) return;
    this.context.recoveryCodes.set([]);
    this.context.recoveryCodesAcknowledged.set(false);
    this.context.snackbar.open($localize`:@@ui.8ab09e6cdebc14:Configuración completada`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 2500 });
  }

  beginRecoveryRegeneration(): void {
    if (this.context.mfaBusy() || this.context.userRefreshRequired()) return;
    this.context.recoveryRegenerating.set(true);
    this.context.recoveryRegenerateForm.reset();
  }

  cancelRecoveryRegeneration(): void {
    if (this.context.mfaBusy()) return;
    this.context.recoveryRegenerating.set(false);
    this.context.recoveryRegenerateForm.reset();
  }

  async regenerateRecoveryCodes(): Promise<void> {
    if (this.context.recoveryRegenerateForm.invalid || this.context.mfaBusy() || this.context.userRefreshRequired()) {
      this.context.recoveryRegenerateForm.markAllAsTouched();
      return;
    }
    const request = this.context.mfaRequests.begin(this.context.accountContext());
    const current = () => this.context.mfaRequests.isCurrent(request, this.context.accountContext());
    const confirmed = await this.context.actions.confirm({
      title: $localize`:@@ui.d11ca81ed62f56:Regenerar códigos de recuperación`,
      message: $localize`:@@ui.dd893854c65e40:Los códigos anteriores dejarán de funcionar y se cerrarán las demás sesiones de tu cuenta.`,
      confirmLabel: $localize`:@@ui.3ddb11527b0b1e:Regenerar códigos`,
      destructive: true,
    });
    if (!confirmed || !current() || this.context.mfaBusy() || this.context.userRefreshRequired()) return;

    this.context.mfaBusy.set(true);
    try {
      const { recoveryCodes } = await this.context.auth.mfaRegenerateRecoveryCodes(
        this.context.recoveryRegenerateForm.controls.password.value,
        this.context.recoveryRegenerateForm.controls.factorCode.value,
      );
      if (!current()) return;
      this.context.recoveryCodes.set(recoveryCodes);
      this.context.uncertainMfaSetup.set(false);
      this.context.recoveryCodesAcknowledged.set(false);
      this.context.recoveryRegenerating.set(false);
      this.context.recoveryRegenerateForm.reset();
      this.context.snackbar.open($localize`:@@ui.7787db03239183:Códigos regenerados`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 2500 });
      await this.context.settleAfterConfirmedMutation([this.context.auth.refreshUser(), this.context.loadSessions()]);
    } catch (err) {
      if (!current()) return;
      if (this.context.userMutationUnconfirmed()) this.context.uncertainMfaSetup.set(true);
      this.context.toast(err, "");
    } finally {
      if (current()) this.context.mfaBusy.set(false);
    }
  }

  copyRecoveryCodes(): void {
    const codes = this.context.recoveryCodes();
    if (!codes.length) return;
    const context = this.context.accountContext();
    const current = () => !this.context.destroyRef.destroyed && context === this.context.accountContext() && codes === this.context.recoveryCodes();
    const copy = navigator.clipboard?.writeText(codes.join("\n"));
    if (!copy) {
      this.context.snackbar.open($localize`:@@ui.b2b3a94dcbea08:El navegador no permite copiar automáticamente`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 2500 });
      return;
    }
    void copy.then(
      () => { if (current()) this.context.snackbar.open($localize`:@@ui.03f45134535134:Códigos copiados`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 2000 }); },
      () => { if (current()) this.context.snackbar.open($localize`:@@ui.9e5d87300baeca:No se pudieron copiar los códigos`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 2500 }); },
    );
  }

  downloadRecoveryCodes(): void {
    const codes = this.context.recoveryCodes();
    if (!codes.length || typeof document === "undefined") return;
    const body = [
      $localize`:@@ui.15572ca1eaeb8e:UVH · Códigos de recuperación`,
      "",
      $localize`:@@ui.3a70ca36235f4c:Cada código funciona una sola vez. Guárdalos fuera de tu cuenta.`,
      "",
      ...codes,
      "",
      `Generados: ${new Date().toISOString()}`,
    ].join("\n");
    if (!downloadBlob(new Blob([body], { type: "text/plain;charset=utf-8" }), "uvh-codigos-recuperacion.txt")) {
      this.context.snackbar.open($localize`:@@ui.f499cedfd63ea2:El navegador no pudo descargar los códigos. Cópialos antes de continuar.`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 5000 });
    }
  }
}
