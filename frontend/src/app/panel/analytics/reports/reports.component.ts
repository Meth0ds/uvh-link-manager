import { UI_TEXT } from "../../../core/localisation/template-messages";
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
  readonly uiText = UI_TEXT;
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
            : $localize`:@@ui.c2b9f6ea59e3f6:No se pudieron cargar los informes.`,
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
          ? $localize`:@@ui.065750855ed9ef:Revocar este informe`
          : $localize`:@@ui.587b98f52c5ce6:Cambiar la URL de acceso`,
      message:
        action === "revoke"
          ? $localize`:@@ui.7f90684e0b09fc:El cliente dejará de poder abrir el informe. Para compartirlo de nuevo tendrás que crear otro.`
          : $localize`:@@ui.0f81f22316b3de:La URL anterior y los accesos abiertos dejarán de funcionar. Tendrás que compartir la nueva URL.`,
      confirmLabel: action === "revoke" ? $localize`:@@ui.06980a043a6b02:Revocar informe` : $localize`:@@ui.81e9c5f348c032:Cambiar URL`,
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
          e instanceof Error ? e.message : $localize`:@@ui.4d8c09fb8e5553:No se pudo completar la acción.`,
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
      active: $localize`:@@ui.723858144bd548:Activo`,
      expired: "Caducado",
      revoked: "Revocado",
      needs_review: $localize`:@@ui.0970a2881d7e5a:Requiere revisión`,
    }[report.state];
  }
}
