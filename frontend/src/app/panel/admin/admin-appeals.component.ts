import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal, untracked } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatSelectModule } from "@angular/material/select";
import { MatSnackBar } from "@angular/material/snack-bar";
import { apiMessage } from "../../core/api-message";
import { countLabel } from "../../core/count-label";
import { dateTimeLabel } from "../../core/date-time-label";
import { isLinkState, linkStateLabel } from "../../core/link-state-label";
import { linkAppealStatusLabel, LINK_APPEAL_STATUS_ORDER } from "../../core/link-appeal-status";
import type { AdminAppeal, LinkAppealStatus } from "../../core/models";
import { QueuePaging } from "../../core/queue-paging";
import { ApiService } from "../../core/services/api.service";
import { decodeAdminAppealsPage } from "../../core/services/admin-response-decoders";
import { ActionDialogService } from "../action-dialog.service";
import { QueueSectionComponent } from "../queue-section.component";

type AppealStatusFilter = "" | LinkAppealStatus;

/**
 * The appeals owners of blocked links have filed, and the two ways to close one.
 *
 * This is the only surface where a false positive reaches a human, so it owns
 * its filter, its pages and its verdicts. Like the report queue, it does not
 * decide what else a decision invalidates: it says `changed` and the console
 * re-reads the counters, the trail and the views that print the same link.
 */
@Component({
  selector: "app-admin-appeals",
  standalone: true,
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatSelectModule, QueueSectionComponent],
  templateUrl: "./admin-appeals.component.html",
  styleUrl: "./admin-appeals.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAppealsComponent {
  private readonly api = inject(ApiService);
  private readonly actions = inject(ActionDialogService);
  private readonly snackbar = inject(MatSnackBar);

  /** Bumped by the console when another view of these links changed. */
  readonly reloadToken = input(0);

  /** A verdict landed: the console re-reads what it summarises. */
  readonly changed = output<void>();

  readonly status = signal<AppealStatusFilter>("open");
  /** One verdict at a time: every case waits for the one in flight. */
  readonly busy = signal(false);

  readonly appeals = new QueuePaging<AdminAppeal>({
    destroyRef: inject(DestroyRef),
    fallback: "No se pudieron cargar las apelaciones",
    filters: () => [this.status()],
    read: async (page, perPage, signal) => {
      const response = await this.api.get(
        "/api/v1/admin/appeals",
        { status: this.status(), page, perPage },
        (value) => decodeAdminAppealsPage(value, { page, perPage }),
        { signal },
      );
      return { rows: response.appeals ?? [], total: response.total };
    },
  });

  readonly appealLabel = linkAppealStatusLabel;
  readonly appealStatusOptions = LINK_APPEAL_STATUS_ORDER;
  readonly countLabel = countLabel;
  readonly formatDate = dateTimeLabel;
  /** A case carries the state of its link as plain text; print it as a state. */
  readonly linkStateLabel = (state: string) => (isLinkState(state) ? linkStateLabel(state) : state);
  readonly pageSizes = [10, 25, 50];

  constructor() {
    effect(() => {
      this.reloadToken();
      untracked(() => void this.appeals.load());
    });
  }

  filter(status: AppealStatusFilter): void {
    this.status.set(status);
    this.appeals.restart();
  }

  /**
   * Decide one appeal: restore the link, or uphold the block.
   *
   * Restoring also drops the denylist entries that applied to the link's
   * destinations, so the state an operator saw here a moment ago is no longer
   * what the link says — which is why the console, not this queue, re-reads the
   * views that describe it.
   */
  async resolve(appeal: AdminAppeal, decision: "restore" | "uphold"): Promise<void> {
    if (this.busy()) return;
    const restoring = decision === "restore";
    const note = await this.actions.prompt({
      title: restoring ? "Restaurar el enlace" : "Confirmar el bloqueo",
      message: restoring
        ? `Vas a resolver a favor la apelación de /${appeal.alias}: recupera su estado anterior y se retiran las entradas de lista negra que aplicaban a su destino.`
        : `Vas a resolver en contra la apelación de /${appeal.alias}: el enlace sigue bloqueado.`,
      confirmLabel: restoring ? "Restaurar enlace" : "Confirmar bloqueo",
      inputLabel: "Nota del expediente (opcional)",
      inputPlaceholder: "Por qué se decide así…",
      inputHint: "Hasta 500 caracteres. Queda en el expediente del enlace, junto a la decisión.",
      inputRequired: false,
      inputMaxLength: 500,
    });
    // `null` is a cancelled dialog; an empty string is a decision without a note.
    if (note === null || this.busy()) return;
    this.busy.set(true);
    try {
      await this.api.post(`/api/v1/admin/appeals/${appeal.id}/decision`, { decision, note: note.trim() });
      this.snackbar.open(restoring ? "Enlace restaurado" : "Bloqueo confirmado", "Cerrar", { duration: 2500 });
      this.changed.emit();
    } catch (error) {
      this.snackbar.open(apiMessage(error, "No se pudo completar la acción"), "Cerrar", { duration: 4000 });
    } finally {
      this.busy.set(false);
    }
  }
}
