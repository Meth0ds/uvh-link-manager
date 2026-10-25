import { AsyncPoller } from "../../core/async-poller";
import { RecoveryAdminApi } from "./recovery-admin-api";
import { RecoveryPortal } from "./recovery-portal";
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, untracked } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { ApiService } from "../../core/services/api.service";
import { LatestRequest } from "../../core/services/latest-request";
import { SessionContextService } from "../../core/services/session-context.service";
import { type RecoverySnapshot } from "../../core/services/recovery-response-decoder";
import { AdminViewContext } from "./admin-view-context";
import { adminMessage } from "../../core/api-message";
import { dateTimeLabel } from "../../core/date-time-label";
import { BackupCenterComponent } from "./backup-center.component";

@Component({
  selector: "app-admin-updates", standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, BackupCenterComponent],
  templateUrl: "./admin-updates.component.html", styleUrl: "./admin-updates.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUpdatesComponent {
  private readonly api = new RecoveryAdminApi(inject(ApiService));
  private readonly destroy = inject(DestroyRef);
  private readonly view = new AdminViewContext(inject(SessionContextService), this.destroy);
  private readonly requests = new LatestRequest(this.destroy);
  readonly state = signal<RecoverySnapshot | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly busy = this.view.busy;
  readonly canOperate = this.view.eligible;
  readonly date = dateTimeLabel;
  password = "";
  factorCode = "";
  private readonly poller = new AsyncPoller({
    destroyRef: this.destroy, delays: [10000], resumeOnFocus: false,
    wantsMore: () => this.view.eligible() && !this.loading(), attempt: () => this.reload(),
  });
  private readonly portal = new RecoveryPortal(this.api, this.destroy);

  constructor() {
    effect(() => {
      this.view.key();
      untracked(() => { this.requests.invalidate(); this.state.set(null); this.password = ""; this.factorCode = ""; this.poller.stop(); if (this.view.eligible()) void this.reload(); });
    });
    this.destroy.onDestroy(() => { this.poller.stop(); this.password = ""; this.factorCode = ""; });
  }
  async reload(): Promise<void> {
    this.poller.stop();
    const intent = this.view.capture(); if (!intent()) return;
    const request = this.requests.begin(this.view.key()); this.loading.set(true);
    try {
      const state = await this.api.snapshot(request.signal);
      if (!intent() || !this.requests.isCurrent(request, this.view.key())) return;
      this.state.set(state); this.error.set(null);
    } catch (error) {
      if (intent() && this.requests.isCurrent(request, this.view.key())) this.error.set(adminMessage(error, $localize`:@@recovery.loadError:No se pudo consultar el controlador local. Inicia UVH Control con recuperación habilitada.`));
    } finally {
      if (intent() && this.requests.isCurrent(request, this.view.key())) {
        this.loading.set(false);
        if (typeof document === "undefined" || document.visibilityState === "visible") this.poller.schedule();
      }
    }
  }
  async createBackup(): Promise<void> {
    const intent = this.view.capture(), operation = this.view.begin("backup", intent);
    if (!operation) return;
    try { await this.api.backup(this.password, this.factorCode); if (operation.isCurrent()) await this.reload(); }
    catch (error) { if (operation.isCurrent()) this.error.set(adminMessage(error, $localize`:@@recovery.backupError:No se pudo iniciar la copia. Consulta el resultado antes de repetirla.`)); }
    finally { operation.settle(); }
  }
  async check(): Promise<void> {
    const intent = this.view.capture(), operation = this.view.begin("check", intent);
    if (!operation) return;
    try { await this.api.check(); if (operation.isCurrent()) await this.reload(); }
    catch (error) { if (operation.isCurrent()) this.error.set(adminMessage(error, $localize`:@@recovery.checkError:No se pudo iniciar la comprobación. Consulta el resultado antes de repetirla.`)); }
    finally { operation.settle(); }
  }
  async openRecovery(): Promise<void> {
    const intent = this.view.capture(), operation = this.view.begin("access", intent);
    if (!operation) return;
    let attempted = true;
    try {
      attempted = await this.portal.open(this.password, this.factorCode, operation.isCurrent, message => this.error.set(message));
    } catch (error) {
      if (operation.isCurrent()) this.error.set(adminMessage(error, $localize`:@@recovery.authError:No se pudo autorizar el acceso de recuperación.`));
    } finally { if (attempted) { this.password = ""; this.factorCode = ""; } operation.settle(); }
  }
}
