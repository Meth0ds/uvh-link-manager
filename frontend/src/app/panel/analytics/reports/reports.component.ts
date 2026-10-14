import {
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { PageHeaderComponent } from "../../page-header.component";
import { ActionDialogService } from "../../action-dialog.service";
import { CopyFeedbackService } from "../../../core/services/copy-feedback.service";
import { SharingService } from "../../../core/services/sharing.service";
import { LatestRequest } from "../../../core/services/latest-request";
import type { AnalyticsReport } from "../../../core/sharing";
@Component({
  selector: "app-reports",
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    PageHeaderComponent,
  ],
  providers: [CopyFeedbackService],
  templateUrl: "./reports.component.html",
  styleUrl: "./reports.component.scss",
})
export class ReportsComponent {
  readonly sharing = inject(SharingService);
  readonly copy = inject(CopyFeedbackService);
  private actions = inject(ActionDialogService);
  private destroy = inject(DestroyRef);
  private requests = new LatestRequest(this.destroy);
  readonly reports = signal<AnalyticsReport[]>([]);
  readonly loading = signal(false);
  readonly error = signal("");
  readonly busy = signal<number | null>(null);
  readonly page = signal(1);
  readonly lastPage = signal(1);
  readonly context = () => this.sharing.context();
  private intent?: { signature: string; key: string };
  constructor() {
    effect(() => {
      this.sharing.context();
      this.sharing.reportsEnabled();
      this.requests.invalidate();
      this.reports.set([]);
      this.error.set("");
      this.busy.set(null);
      this.page.set(1);
      if (this.sharing.canPublish()) untracked(() => void this.load());
    });
  }
  async load(): Promise<void> {
    if (!this.sharing.canPublish()) return;
    const r = this.requests.begin(this.context());
    this.loading.set(true);
    this.error.set("");
    try {
      const data = await this.sharing.list(this.page(), r.signal);
      if (this.requests.isCurrent(r, this.context())) {
        this.reports.set(data.reports);
        this.lastPage.set(data.lastPage);
      }
    } catch (e) {
      if (this.requests.isCurrent(r, this.context()))
        this.error.set(
          e instanceof Error
            ? e.message
            : "No se pudieron cargar los informes.",
        );
    } finally {
      if (this.requests.isCurrent(r, this.context())) this.loading.set(false);
    }
  }
  async edit(report?: AnalyticsReport): Promise<void> {
    const context = this.context();
    if (
      (await this.sharing.open([], report)) &&
      context === this.context() &&
      !this.destroy.destroyed
    )
      await this.load();
  }
  async action(
    report: AnalyticsReport,
    action: "revoke" | "rotate-access",
  ): Promise<void> {
    if (this.busy() !== null) return;
    const context = this.context();
    const confirmed = await this.actions.confirm({
      title:
        action === "revoke"
          ? "Revocar este informe"
          : "Cambiar la URL de acceso",
      message:
        action === "revoke"
          ? "El cliente dejará de poder abrir el informe. Para compartirlo de nuevo tendrás que crear otro."
          : "La URL anterior y los accesos abiertos dejarán de funcionar. Tendrás que compartir la nueva URL.",
      confirmLabel: action === "revoke" ? "Revocar informe" : "Cambiar URL",
      destructive: action === "revoke",
    });
    if (!confirmed || context !== this.context() || this.destroy.destroyed)
      return;
    const signature = JSON.stringify([report.id, report.version, action]);
    if (this.intent?.signature !== signature)
      this.intent = { signature, key: crypto.randomUUID() };
    this.busy.set(report.id);
    this.error.set("");
    try {
      await this.sharing.action(report, action, this.intent.key);
      if (context === this.context() && !this.destroy.destroyed)
        await this.load();
    } catch (e) {
      if (context === this.context() && !this.destroy.destroyed)
        this.error.set(
          e instanceof Error ? e.message : "No se pudo completar la acción.",
        );
    } finally {
      if (context === this.context() && !this.destroy.destroyed)
        this.busy.set(null);
    }
  }
  changePage(delta: number): void {
    this.page.update((v) => v + delta);
    void this.load();
  }
  state(report: AnalyticsReport): string {
    return {
      active: "Activo",
      expired: "Caducado",
      revoked: "Revocado",
      needs_review: "Requiere revisión",
    }[report.state];
  }
}
