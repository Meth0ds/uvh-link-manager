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
  private readonly api = inject(ApiService);
  private readonly actions = inject(ActionDialogService);
  private readonly snackbar = inject(MatSnackBar);

  /** Bumped by the console when another view of these links changed. */
  readonly reloadToken = input(0);

  /** A decision landed: the console re-reads what it summarises. */
  readonly changed = output<void>();

  readonly query = signal("");
  readonly status = signal<ReportStatus>("open");
  /** One decision at a time: every row waits for the one in flight. */
  readonly busy = signal(false);

  readonly reports = new QueuePaging<AdminReport>({
    destroyRef: inject(DestroyRef),
    fallback: "No se pudieron cargar las denuncias",
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
    effect(() => {
      this.reloadToken();
      untracked(() => void this.reports.load());
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
    await this.moderate(report, "review", "Denuncia marcada como revisada");
  }

  async dismiss(report: AdminReport): Promise<void> {
    const confirmed = await this.actions.confirm({
      title: "Desestimar denuncia",
      message: `La denuncia sobre “${report.alias}” se cerrará sin modificar el enlace.`,
      confirmLabel: "Desestimar",
      destructive: false,
    });
    if (confirmed) await this.moderate(report, "dismiss", "Denuncia desestimada");
  }

  async block(report: AdminReport): Promise<void> {
    const reason = await this.actions.prompt({
      title: "Bloquear enlace",
      message: `La resolución de “${report.alias}” se detendrá y la denuncia quedará resuelta.`,
      confirmLabel: "Bloquear enlace",
      destructive: true,
      inputLabel: "Motivo del bloqueo",
      inputPlaceholder: "Describe el incumplimiento…",
      inputHint: "Entre 3 y 500 caracteres.",
      inputRequired: true,
      inputMinLength: 3,
      inputMaxLength: 500,
    });
    if (reason) await this.moderate(report, "block", "Enlace bloqueado", reason);
  }

  async unblock(report: AdminReport): Promise<void> {
    const confirmed = await this.actions.confirm({
      title: "Desbloquear enlace",
      message: `“${report.alias}” volverá al estado que corresponda según su programación y caducidad.`,
      confirmLabel: "Desbloquear",
      destructive: false,
    });
    if (confirmed) await this.moderate(report, "unblock", "Enlace desbloqueado");
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
    if (this.busy()) return;
    const host = this.hostOf(report.destination);
    if (scope === "host" && host === null) {
      this.snackbar.open("No se pudo leer el host de ese destino", "Cerrar", { duration: 3500 });
      return;
    }
    const reason = await this.actions.prompt({
      title: scope === "host" ? "Bloquear todo el host" : "Bloquear la URL exacta",
      message: scope === "host"
        ? `Todo ${host} dejará de resolverse para cualquier enlace, y se reanalizan en segundo plano los que ya apuntaban ahí. Un sufijo público como co.uk se rechaza.`
        : `${report.destination} dejará de resolverse para cualquier enlace. Si el abuso puede reaparecer en otra URL del mismo host, este alcance no lo detiene.`,
      confirmLabel: "Bloquear destino",
      destructive: true,
      inputLabel: "Motivo",
      inputPlaceholder: "Suplantación de identidad, phishing confirmado…",
      inputHint: "Obligatorio: entre 3 y 500 caracteres. Queda en el registro.",
      inputRequired: true,
      inputMinLength: 3,
      inputMaxLength: 500,
    });
    if (reason === null || this.busy()) return;
    this.busy.set(true);
    try {
      const result = await this.api.post(
        `/api/v1/admin/links/${report.link_id}/block-destination`,
        { reason: reason.trim(), scope },
        decodeDestinationBlock,
      );
      this.snackbar.open(`Destino bloqueado. ${this.sweepLabel(result.linksScheduled, result.linksSweepTruncated)}`, "Cerrar", { duration: 4500 });
      this.changed.emit();
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }

  /** What the sweep that follows a destination block did, in the operator's words. */
  private sweepLabel(scheduled: number, truncated: boolean): string {
    if (truncated) {
      return "Los enlaces restantes que apuntaban ahí se reanalizan en segundo plano.";
    }
    return scheduled > 0
      ? `${countLabel(scheduled, "enlace ya apuntaba ahí y se reanaliza", "enlaces ya apuntaban ahí y se reanalizan")}.`
      : "No había enlaces que apuntaran ahí.";
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
  ): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.api.post(`/api/v1/admin/reports/${report.id}/moderate`, { action, reason });
      this.snackbar.open(success, "Cerrar", { duration: 2500 });
      this.changed.emit();
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }

  private showError(error: unknown): void {
    this.snackbar.open(apiMessage(error, "No se pudo completar la acción"), "Cerrar", { duration: 4000 });
  }
}
