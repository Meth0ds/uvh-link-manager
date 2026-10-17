import { UI_TEXT } from "../../core/localisation/template-messages";
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal, untracked } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MatSnackBar } from "@angular/material/snack-bar";
import { MatTooltipModule } from "@angular/material/tooltip";
import { apiMessage } from "../../core/api-message";
import { countLabel } from "../../core/count-label";
import { dateTimeLabel } from "../../core/date-time-label";
import { destinationKindLabel } from "../../core/destination-entry-label";
import { isLinkState, linkStateLabel } from "../../core/link-state-label";
import type { AdminReport } from "../../core/models";
import { QueuePaging } from "../../core/queue-paging";
import { reportStatusLabel, REPORT_STATUS_ORDER } from "../../core/report-status-label";
import { ApiService } from "../../core/services/api.service";
import { decodeAdminReportsPage, decodeDestinationBlock } from "../../core/services/admin-response-decoders";
import { ActionDialogService } from "../action-dialog.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { AdminViewContext, type AdminIntent } from "./admin-view-context";
import { QueueSectionComponent } from "../queue-section.component";

type ReportStatus = "" | AdminReport["status"];

/**
 * The queue of abuse reports, and the decisions that close a case.
 *
 * A case can be reviewed, dismissed, blocked or unblocked, and the destination
 * behind it can be blocked for every link. All of that is this queue's own
 * state, so it lives here and not in the console: the console only says when to
 * re-read (`reloadToken`) and hears back that something changed (`changed`),
 * because a decision here is also a change to the counters, the trail and the
 * other queues that print the same links. The paging itself is the shared
 * engine's (`QueuePaging`), and the frame around the rows is shared too.
 */
@Component({
  selector: "app-admin-reports",
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MatTooltipModule, QueueSectionComponent],
  templateUrl: "./admin-reports.component.html",
  styleUrl: "./admin-reports.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminReportsComponent {
  readonly uiText = UI_TEXT;
  private readonly api = inject(ApiService);
  private readonly actions = inject(ActionDialogService);
  private readonly snackbar = inject(MatSnackBar);
  private readonly view = new AdminViewContext(inject(SessionContextService), inject(DestroyRef));
  readonly canOperate = this.view.eligible;

  /** Bumped by the console when another view of these links changed. */
  readonly reloadToken = input(0);

  /** A decision landed: the console re-reads what it summarises. */
  readonly changed = output<void>();

  readonly query = signal("");
  readonly status = signal<ReportStatus>("open");
  /** One decision at a time: every row waits for the one in flight. */
  readonly busy = this.view.busy;

  readonly reports = new QueuePaging<AdminReport>({
    destroyRef: inject(DestroyRef),
    context: () => this.view.key(),
    enabled: () => this.view.capture()(),
    fallback: $localize`:@@ui.c8f6ca1239ac3d:No se pudieron cargar las denuncias`,
    filters: () => [this.query(), this.status()],
    read: async (page, perPage, signal) => {
      const response = await this.api.get(
        "/api/v1/admin/reports",
        { q: this.query(), status: this.status(), page, perPage },
        (value) => decodeAdminReportsPage(value, { page, perPage }),
        { signal },
      );
      return { rows: response.reports ?? [], total: response.total };
    },
  });

  readonly reportLabel = reportStatusLabel;
  readonly reportStatusOptions = REPORT_STATUS_ORDER;
  readonly kindLabel = destinationKindLabel;
  readonly countLabel = countLabel;
  readonly formatDate = dateTimeLabel;
  /** A report carries the state of its link as plain text; print it as a state. */
  readonly linkStateLabel = (state: string) => (isLinkState(state) ? linkStateLabel(state) : state);
  readonly pageSizes = [10, 25, 50];

  constructor() {
    let context = this.view.key();
    effect(() => {
      const current = this.view.key();
      this.reloadToken();
      untracked(() => {
        if (current !== context) {
          context = current;
          this.reports.reset();
          this.query.set(""); this.status.set("open");
        }
        void this.reports.load();
      });
    });
  }

  search(query: string): void {
    this.query.set(query.trim());
    this.reports.restart();
  }

  filter(status: ReportStatus): void {
    this.status.set(status);
    this.reports.restart();
  }

  async review(report: AdminReport): Promise<void> {
    await this.moderate(report, "review", $localize`:@@ui.9af6b702139a73:Denuncia marcada como revisada`);
  }

  async dismiss(report: AdminReport): Promise<void> {
    const intent = this.view.capture();
    if (!intent() || this.reports.stale() || this.busy()) return;
    const confirmed = await this.actions.confirm({
      title: $localize`:@@ui.9662348c879b20:Desestimar denuncia`,
      message: $localize`:@@ui.c2e7f46ca5e397:La denuncia sobre “${report.alias}” se cerrará sin modificar el enlace.`,
      confirmLabel: $localize`:@@ui.d026272ace4419:Desestimar`,
      destructive: false,
    });
    if (confirmed && intent()) await this.moderate(report, "dismiss", $localize`:@@ui.bdc606b5338c79:Denuncia desestimada`, undefined, intent);
  }

  async block(report: AdminReport): Promise<void> {
    const intent = this.view.capture();
    if (!intent() || this.reports.stale() || this.busy()) return;
    const reason = await this.actions.prompt({
      title: $localize`:@@ui.6ca93c1e4ff21b:Bloquear enlace`,
      message: $localize`:@@ui.27f044d3dca068:La resolución de “${report.alias}” se detendrá y la denuncia quedará resuelta.`,
      confirmLabel: $localize`:@@ui.6ca93c1e4ff21b:Bloquear enlace`,
      destructive: true,
      inputLabel: $localize`:@@ui.213a8dca4906ef:Motivo del bloqueo`,
      inputPlaceholder: $localize`:@@ui.d46e9ad106a454:Describe el incumplimiento…`,
      inputHint: "Entre 3 y 500 caracteres.",
      inputRequired: true,
      inputMinLength: 3,
      inputMaxLength: 500,
    });
    if (reason && intent()) await this.moderate(report, "block", $localize`:@@ui.d6b873f3278abd:Enlace bloqueado`, reason, intent);
  }

  async unblock(report: AdminReport): Promise<void> {
    const intent = this.view.capture();
    if (!intent() || this.reports.stale() || this.busy()) return;
    const confirmed = await this.actions.confirm({
      title: $localize`:@@ui.720111af094ae0:Desbloquear enlace`,
      message: $localize`:@@ui.2a97b03bafdb0b:“${report.alias}” volverá al estado que corresponda según su programación y caducidad.`,
      confirmLabel: $localize`:@@ui.d4c2d75416f69c:Desbloquear`,
      destructive: false,
    });
    if (confirmed && intent()) await this.moderate(report, "unblock", $localize`:@@ui.ea22b74e1ad6e8:Enlace desbloqueado`, undefined, intent);
  }

  /**
   * Block the destination a reported link points at.
   *
   * Blocking the link alone left the abuse reachable: the same URL came back as
   * another link and could also be served through a redirect rule. The scope is
   * the operator's decision — the exact URL, or the whole host — and the sweep
   * that follows is bounded, so the answer says whether it reached every link.
   */
  async blockDestination(report: AdminReport, scope: "url" | "host"): Promise<void> {
    const intent = this.view.capture();
    if (!intent() || this.reports.stale() || this.busy()) return;
    const host = this.hostOf(report.destination);
    if (scope === "host" && host === null) {
      this.snackbar.open($localize`:@@ui.47b24a750ef1e6:No se pudo leer el host de ese destino`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 3500 });
      return;
    }
    const reason = await this.actions.prompt({
      title: scope === "host" ? $localize`:@@ui.a0e86becffc0e1:Bloquear todo el host` : $localize`:@@ui.05c0b748b19558:Bloquear la URL exacta`,
      message: scope === "host"
        ? $localize`:@@ui.d13f3644d45f71:Todo ${host} dejará de resolverse para cualquier enlace, y se reanalizan en segundo plano los que ya apuntaban ahí. Un sufijo público como co.uk se rechaza.`
        : $localize`:@@ui.aca47ace4a1e0e:${report.destination} dejará de resolverse para cualquier enlace. Si el abuso puede reaparecer en otra URL del mismo host, este alcance no lo detiene.`,
      confirmLabel: $localize`:@@ui.7b748cb5b81414:Bloquear destino`,
      destructive: true,
      inputLabel: "Motivo",
      inputPlaceholder: $localize`:@@ui.954eb8b8923535:Suplantación de identidad, phishing confirmado…`,
      inputHint: $localize`:@@ui.fe077e52123211:Obligatorio: entre 3 y 500 caracteres. Queda en el registro.`,
      inputRequired: true,
      inputMinLength: 3,
      inputMaxLength: 500,
    });
    if (reason === null || this.reports.stale()) return;
    const operation = this.view.begin(`destination-${report.link_id}`, intent);
    if (!operation) return;
    try {
      const result = await this.api.post(
        `/api/v1/admin/links/${report.link_id}/block-destination`,
        { reason: reason.trim(), scope },
        decodeDestinationBlock,
      );
      if (!operation.isCurrent()) return;
      this.snackbar.open($localize`:@@ui.814726653e1d89:Destino bloqueado. ${this.sweepLabel(result.linksScheduled, result.linksSweepTruncated)}`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 4500 });
      this.changed.emit();
    } catch (error) {
      if (!operation.isCurrent()) return;
      this.showError(error);
    } finally {
      operation.settle();
    }
  }

  /** What the sweep that follows a destination block did, in the operator's words. */
  private sweepLabel(scheduled: number, truncated: boolean): string {
    if (truncated) {
      return $localize`:@@ui.22185b0ace33ae:Los enlaces restantes que apuntaban ahí se reanalizan en segundo plano.`;
    }
    return scheduled > 0
      ? $localize`:@@ui.05cffa33d227f9:${countLabel(scheduled, $localize`:@@ui.e95853803a9fd2:enlace ya apuntaba ahí y se reanaliza`, $localize`:@@ui.843a5ee48f8d83:enlaces ya apuntaban ahí y se reanalizan`)}.`
      : $localize`:@@ui.b2a794700e8bbe:No había enlaces que apuntaran ahí.`;
  }

  /** The host of a decoded destination, or null when it cannot be read as one. */
  private hostOf(destination: string): string | null {
    try {
      const host = new URL(destination).host;
      return host === "" ? null : host;
    } catch {
      return null;
    }
  }

  private async moderate(
    report: AdminReport,
    action: "block" | "unblock" | "review" | "dismiss",
    success: string,
    reason?: string,
    intent: AdminIntent = this.view.capture(),
  ): Promise<void> {
    if (this.reports.stale()) return;
    const operation = this.view.begin(`report-${report.id}`, intent);
    if (!operation) return;
    try {
      await this.api.post(`/api/v1/admin/reports/${report.id}/moderate`, { action, reason });
      if (!operation.isCurrent()) return;
      this.snackbar.open(success, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 2500 });
      this.changed.emit();
    } catch (error) {
      if (!operation.isCurrent()) return;
      this.showError(error);
    } finally {
      operation.settle();
    }
  }

  private showError(error: unknown): void {
    this.snackbar.open(apiMessage(error, $localize`:@@ui.e04201e3425722:No se pudo completar la acción`), $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 4000 });
  }
}
