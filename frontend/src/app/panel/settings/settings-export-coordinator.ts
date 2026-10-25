import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import type { DataExportStage, DataExportStatus } from "../../core/models";
import { ApiRequestError } from "../../core/services/api.service";
import { type AsyncOperationTone } from "../async-operation-status.component";
import { DataExportDialogComponent } from "./data-export-dialog.component";
import type { SettingsComponent } from "./settings.component";

interface SettingsExportCoordinatorContext {
  readonly $EXPORT_STAGE_LABELS: (typeof SettingsComponent)["EXPORT_STAGE_LABELS"];
  readonly $EXPORT_STATUS_LABELS: (typeof SettingsComponent)["EXPORT_STATUS_LABELS"];
  readonly accountContext: SettingsComponent["accountContext"];
  readonly actions: SettingsComponent["actions"];
  readonly auth: SettingsComponent["auth"];
  readonly destroyRef: SettingsComponent["destroyRef"];
  readonly dialogs: SettingsComponent["dialogs"];
  readonly exportBusy: SettingsComponent["exportBusy"];
  exportDialog: SettingsComponent["exportDialog"];
  readonly exportError: SettingsComponent["exportError"];
  exportExpiryTimer: SettingsComponent["exportExpiryTimer"];
  readonly exportHeading: SettingsComponent["exportHeading"];
  readonly exportHistory: SettingsComponent["exportHistory"];
  readonly exportHistoryRequest: SettingsComponent["exportHistoryRequest"];
  readonly exportLoading: SettingsComponent["exportLoading"];
  readonly exportMutationRequest: SettingsComponent["exportMutationRequest"];
  exportPollLastStatus: SettingsComponent["exportPollLastStatus"];
  readonly exportPoller: SettingsComponent["exportPoller"];
  readonly exportRefreshing: SettingsComponent["exportRefreshing"];
  readonly exportRequest: SettingsComponent["exportRequest"];
  readonly exportStatus: SettingsComponent["exportStatus"];
  readonly injector: SettingsComponent["injector"];
  readonly settleAfterConfirmedMutation: SettingsComponent["settleAfterConfirmedMutation"];
  readonly snackbar: SettingsComponent["snackbar"];
  readonly toast: SettingsComponent["toast"];
  readonly user: SettingsComponent["user"];
}

/** Behaviour coordinator; forms and signals remain owned by the mounted view. */
export class SettingsExportCoordinator {
  constructor(private readonly context: SettingsExportCoordinatorContext) {}

  async loadExportStatus(notify = true, silent = false, reloadHistory = true): Promise<void> {
    if (!this.context.user() || this.context.destroyRef.destroyed) return;
    const context = this.context.auth.sessionGeneration();
    const request = this.context.exportRequest.begin(context);
    if (!silent) this.context.exportLoading.set(true);
    try {
      const status = await this.context.auth.dataExportStatus({ signal: request.signal });
      if (!this.context.exportRequest.isCurrent(request, this.context.auth.sessionGeneration())) return;
      const statusChanged = (status?.status ?? null) !== this.context.exportPollLastStatus;
      if (statusChanged) this.context.exportPoller.reset();
      this.context.exportPollLastStatus = status?.status ?? null;
      this.context.exportStatus.set(status);
      this.context.exportError.set(null);
      this.armExportExpiryCheck(status);
      // El historial sólo cambia cuando cambia el estado visible; las sondas
      // silenciosas no lo tocan mientras la exportación siga igual.
      if (statusChanged && reloadHistory) void this.loadExportHistory();
    } catch (err) {
      if (!this.context.exportRequest.isCurrent(request, this.context.auth.sessionGeneration())) return;
      this.context.exportError.set(err instanceof ApiRequestError ? err.message : $localize`:@@ui.221074773ba701:No se pudo consultar el estado de la exportación`);
      if (notify && !silent) this.context.toast(err, $localize`:@@ui.221074773ba701:No se pudo consultar el estado de la exportación`);
    } finally {
      if (this.context.exportRequest.isCurrent(request, this.context.auth.sessionGeneration())) {
        if (!silent) this.context.exportLoading.set(false);
        this.context.exportPoller.schedule();
      }
    }
  }

  async retryExportStatus(): Promise<void> {
    if (!this.context.exportError() || this.context.exportRefreshing() || this.context.exportLoading() || this.context.exportBusy()
      || !this.context.user() || this.context.destroyRef.destroyed) return;
    const context = this.context.accountContext();
    const current = () => context === this.context.accountContext() && !this.context.destroyRef.destroyed;
    this.context.exportRefreshing.set(true);
    this.context.exportPoller.stop();
    this.stopExportExpiryCheck();
    try {
      await this.loadExportStatus(false, true);
      if (current() && !this.context.exportError()) this.context.exportHeading()?.nativeElement.focus({ preventScroll: true });
    } finally {
      if (current()) {
        this.context.exportRefreshing.set(false);
        this.context.exportPoller.schedule();
      }
    }
  }

  async loadExportHistory(): Promise<void> {
    if (!this.context.user() || this.context.destroyRef.destroyed) return;
    const context = this.context.auth.sessionGeneration();
    const request = this.context.exportHistoryRequest.begin(context);
    try {
      const exports = await this.context.auth.dataExportHistory({ signal: request.signal });
      if (!this.context.exportHistoryRequest.isCurrent(request, this.context.auth.sessionGeneration())) return;
      this.context.exportHistory.set(exports);
    } catch {
      // Sin historial no se pierde nada operativo; se conserva el último visto.
    }
  }

  exportNeedsPoll(): boolean {
    // Sólo la generación avanza sola. `ready` es un estado final vivo: no se
    // sondea, se refresca al recuperar la pestaña y al caducar la descarga.
    return !this.context.exportRefreshing() && (this.context.exportStatus()?.status ?? null) === "processing";
  }

  armExportExpiryCheck(status: DataExportStatus | null): void {
    this.stopExportExpiryCheck();
    if (status?.status !== "ready" || !status.downloadExpiresAt) return;
    const expiresAt = new Date(status.downloadExpiresAt).getTime();
    if (!Number.isFinite(expiresAt)) return;
    // setTimeout acepta hasta 2^31-1 ms; un retardo negativo ya ha caducado.
    const delay = Math.min(Math.max(expiresAt - Date.now(), 0), 2_147_483_647);
    this.context.exportExpiryTimer = setTimeout(() => {
      this.context.exportExpiryTimer = null;
      void this.loadExportStatus(false, true);
    }, delay);
  }

  stopExportExpiryCheck(): void {
    if (this.context.exportExpiryTimer !== null) {
      clearTimeout(this.context.exportExpiryTimer);
      this.context.exportExpiryTimer = null;
    }
  }

  openDataExportDialog(purpose: "request" | "download" = "request"): void {
    if (this.context.exportDialog || this.context.exportBusy() || this.context.exportLoading() || this.context.exportError() || this.context.exportRefreshing()
      || !this.context.user() || this.context.destroyRef.destroyed) return;
    const context = this.context.accountContext();
    const dialog = this.context.dialogs.open(DataExportDialogComponent, {
      data: { purpose },
      width: "min(560px, 94vw)", maxWidth: "94vw", maxHeight: "92dvh",
      autoFocus: "#export-password-step input", restoreFocus: true, injector: this.context.injector,
      ariaLabel: purpose === "download" ? $localize`:@@ui.d14302fe9e5469:Descargar la exportación de datos` : $localize`:@@ui.638968dd8eea63:Solicitar una exportación de datos`,
    });
    this.context.exportDialog = dialog;
    dialog.afterClosed().pipe(takeUntilDestroyed(this.context.destroyRef)).subscribe((result) => {
      if (this.context.exportDialog !== dialog) return;
      this.context.exportDialog = undefined;
      if (!result || context !== this.context.accountContext() || this.context.destroyRef.destroyed) return;
      if (result === "unconfirmed") {
        this.context.snackbar.open($localize`:@@ui.8ba338ee08955f:Archivo descargado. No pudimos confirmar la recepción: puedes descargarlo de nuevo o dejar que caduque.`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 6000 });
      } else {
        this.context.snackbar.open(purpose === "download" ? $localize`:@@ui.415a5c68626ffb:Archivo descargado` : $localize`:@@ui.0f44741eab4e98:Solicitud de exportación iniciada`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 3500 });
      }
      void this.context.settleAfterConfirmedMutation([this.loadExportStatus(false), this.loadExportHistory()]);
    });
  }

  async cancelDataExport(): Promise<void> {
    if (this.context.exportBusy() || this.context.exportLoading() || this.context.exportError() || this.context.exportRefreshing()
      || !this.context.user() || this.context.destroyRef.destroyed) return;
    const request = this.context.exportMutationRequest.begin(this.context.accountContext());
    const current = () => this.context.exportMutationRequest.isCurrent(request, this.context.accountContext());
    const confirmed = await this.context.actions.confirm({
      title: $localize`:@@ui.18b3cbc9663064:Cancelar exportación`,
      message: $localize`:@@ui.773975fc9171ab:La descarga pendiente dejará de funcionar y se eliminará el archivo privado si ya estaba preparado.`,
      confirmLabel: $localize`:@@ui.18b3cbc9663064:Cancelar exportación`,
      destructive: true,
    });
    // The answer can arrive after another attempt started; the dialog is not a
    // lock on the operation it describes.
    if (!confirmed || !current() || this.context.exportBusy() || this.context.exportLoading() || this.context.exportError() || this.context.exportRefreshing()) return;
    this.context.exportBusy.set(true);
    try {
      await this.context.auth.cancelDataExport();
      if (!current()) return;
      this.context.snackbar.open($localize`:@@ui.5de8ee35ff5ac2:Exportación cancelada`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 2500 });
      await this.context.settleAfterConfirmedMutation([this.loadExportStatus(false), this.loadExportHistory()]);
    } catch (err) {
      if (current()) this.context.toast(err, "");
    } finally {
      if (current()) this.context.exportBusy.set(false);
    }
  }

  exportIsActive(): boolean {
    return ["processing", "ready"].includes(this.context.exportStatus()?.status ?? "");
  }

  exportShowsRequestEntry(): boolean {
    if (!this.context.user() || this.context.exportLoading() || this.context.exportError() || this.context.exportRefreshing()) return false;
    const status = this.context.exportStatus()?.status ?? null;
    return status === null || status === "downloaded" || status === "cancelled";
  }

  exportStageLabel(stage: DataExportStage | null): string {
    return stage ? this.context.$EXPORT_STAGE_LABELS[stage] : $localize`:@@ui.5462b220b401da:Preparando el archivo`;
  }

  exportStatusLabel(status: DataExportStatus["status"]): string {
    return this.context.$EXPORT_STATUS_LABELS[status];
  }

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
}
