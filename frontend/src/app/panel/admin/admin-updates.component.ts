import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, untracked } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { ApiService } from "../../core/services/api.service";
import { LatestRequest } from "../../core/services/latest-request";
import { SessionContextService } from "../../core/services/session-context.service";
import { decodeRecoverySnapshot, decodeRecoveryTicket, type RecoverySnapshot } from "../../core/services/recovery-response-decoder";
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
  private readonly api = inject(ApiService);
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
  private timer: ReturnType<typeof setTimeout> | undefined;
  private portal: Window | null = null;
  private readonly visibility = () => {
    if (typeof document === "undefined") return;
    clearTimeout(this.timer);
    if (document.visibilityState === "visible" && this.view.eligible()) void this.reload();
  };

  constructor() {
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.visibility);
    effect(() => {
      this.view.key();
      untracked(() => { this.requests.invalidate(); this.state.set(null); this.password = ""; this.factorCode = ""; clearTimeout(this.timer); if (this.view.eligible()) void this.reload(); });
    });
    this.destroy.onDestroy(() => { clearTimeout(this.timer); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.visibility); this.password = ""; this.factorCode = ""; });
  }
  async reload(): Promise<void> {
    clearTimeout(this.timer);
    const intent = this.view.capture(); if (!intent()) return;
    const request = this.requests.begin(this.view.key()); this.loading.set(true);
    try {
      const state = await this.api.get("/api/v1/admin/updates", undefined, decodeRecoverySnapshot, { signal: request.signal });
      if (!intent() || !this.requests.isCurrent(request, this.view.key())) return;
      this.state.set(state); this.error.set(null);
    } catch (error) {
      if (intent() && this.requests.isCurrent(request, this.view.key())) this.error.set(adminMessage(error, $localize`:@@recovery.loadError:No se pudo consultar el controlador local. Inicia UVH Control con recuperación habilitada.`));
    } finally {
      if (intent() && this.requests.isCurrent(request, this.view.key())) {
        this.loading.set(false);
        if (typeof document === "undefined" || document.visibilityState === "visible") this.timer = setTimeout(() => { void this.reload(); }, 10000);
      }
    }
  }
  async createBackup(): Promise<void> {
    const intent = this.view.capture(), operation = this.view.begin("backup", intent);
    if (!operation) return;
    try { await this.api.post("/api/v1/admin/updates/backup", { requestId: crypto.randomUUID(), target: { tag: "manual" }, password: this.password, factorCode: this.factorCode }); if (operation.isCurrent()) await this.reload(); }
    catch (error) { if (operation.isCurrent()) this.error.set(adminMessage(error, $localize`:@@recovery.backupError:No se pudo iniciar la copia. Consulta el resultado antes de repetirla.`)); }
    finally { operation.settle(); }
  }
  async check(): Promise<void> {
    const intent = this.view.capture(), operation = this.view.begin("check", intent);
    if (!operation) return;
    try { await this.api.post("/api/v1/admin/updates/check", { requestId: crypto.randomUUID(), target: {} }); if (operation.isCurrent()) await this.reload(); }
    catch (error) { if (operation.isCurrent()) this.error.set(adminMessage(error, $localize`:@@recovery.checkError:No se pudo iniciar la comprobación. Consulta el resultado antes de repetirla.`)); }
    finally { operation.settle(); }
  }
  async openRecovery(): Promise<void> {
    const intent = this.view.capture(), operation = this.view.begin("access", intent);
    if (!operation) return;
    // Open synchronously so popup blocking cannot strand a one-use authorization.
    const popup = window.open("/__uvh/admin", "_blank"); this.portal = popup;
    if (!popup) { operation.settle(); this.error.set($localize`:@@recovery.popupError:Permite abrir la ventana del centro de recuperación y vuelve a intentarlo.`); return; }
    let ready = false, ticket: string | null = null;
    const deliver = () => { if (ready && ticket && operation.isCurrent() && !popup.closed) { popup.postMessage({ type: "uvh-recovery-ticket", ticket }, window.location.origin); ticket = null; } };
    const listener = (event: MessageEvent) => { if (event.source === popup && event.origin === window.location.origin && event.data?.type === "uvh-recovery-ready") { ready = true; deliver(); } };
    window.addEventListener("message", listener);
    try {
      ticket = await this.api.post("/api/v1/admin/updates/access", { password: this.password, factorCode: this.factorCode }, decodeRecoveryTicket);
      if (!operation.isCurrent()) { popup.close(); return; }
      deliver();
      // Wait for the independently served page to finish loading.
      for (let attempt = 0; ticket && attempt < 100 && operation.isCurrent(); attempt++) { await new Promise(resolve => setTimeout(resolve, 100)); deliver(); }
      if (ticket && operation.isCurrent()) this.error.set($localize`:@@recovery.portalError:No se pudo conectar con la página de recuperación. Comprueba que el controlador siga abierto.`);
    } catch (error) { popup.close(); if (operation.isCurrent()) this.error.set(adminMessage(error, $localize`:@@recovery.authError:No se pudo autorizar el acceso de recuperación.`)); }
    finally { ticket = null; window.removeEventListener("message", listener); this.password = ""; this.factorCode = ""; operation.settle(); this.portal = null; }
  }
}
