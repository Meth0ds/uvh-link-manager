import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal, untracked } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatSnackBar } from "@angular/material/snack-bar";
import { apiMessage } from "../../core/api-message";
import { countLabel } from "../../core/count-label";
import { dateTimeLabel } from "../../core/date-time-label";
import { destinationKindLabel, destinationSourceLabel } from "../../core/destination-entry-label";
import type { AdminDestinationEntry } from "../../core/models";
import { QueuePaging } from "../../core/queue-paging";
import { ApiService } from "../../core/services/api.service";
import { decodeAdminDestinationsPage, decodeDestinationRemoval } from "../../core/services/admin-response-decoders";
import { ActionDialogService } from "../action-dialog.service";
import { QueueSectionComponent } from "../queue-section.component";

/**
 * The destinations the platform refuses to serve.
 *
 * This is the list a moderation decision writes to and the only place it can be
 * undone, so it owns its own state: the console tells it when a case blocked a
 * destination, and hears back when a removal freed links that were blocked on
 * nothing else.
 *
 * It lives in its own component because the moderation tab already carries two
 * queues; a third listing with its own pagination, filters and removal flow
 * would make that screen unreadable as one unit.
 */
@Component({
  selector: "app-admin-destinations",
  standalone: true,
  imports: [MatButtonModule, MatIconModule, QueueSectionComponent],
  templateUrl: "./admin-destinations.component.html",
  styleUrl: "./admin-destinations.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDestinationsComponent {
  private readonly api = inject(ApiService);
  private readonly actions = inject(ActionDialogService);
  private readonly snackbar = inject(MatSnackBar);

  /**
   * Bumped by the console after a case blocks a destination.
   *
   * The console owns that action — it starts from a report — so this list cannot
   * learn about the new entry any other way than being told to re-read.
   */
  readonly reloadToken = input(0);

  /** An entry left the list, which can release links; the console re-reads them. */
  readonly changed = output<void>();

  /** A withdrawal is in flight: one at a time, and every row waits for it. */
  readonly busy = signal(false);

  readonly entries = new QueuePaging<AdminDestinationEntry>({
    destroyRef: inject(DestroyRef),
    fallback: "No se pudieron cargar los destinos bloqueados",
    // This list has no filters: one page is identified by its number alone.
    filters: () => null,
    read: async (page, perPage, signal) => {
      const response = await this.api.get(
        "/api/v1/admin/destinations",
        { page, perPage },
        (value) => decodeAdminDestinationsPage(value, { page, perPage }),
        { signal },
      );
      return { rows: response.entries ?? [], total: response.total };
    },
  });

  readonly kindLabel = destinationKindLabel;
  readonly sourceLabel = destinationSourceLabel;
  readonly countLabel = countLabel;
  readonly formatDate = dateTimeLabel;
  readonly pageSizes = [10, 25, 50];

  constructor() {
    effect(() => {
      this.reloadToken();
      untracked(() => void this.entries.load());
    });
  }

  /**
   * Withdraw an entry.
   *
   * The answer says how many links were released, because that is the effect the
   * operator just caused: the links are re-evaluated and only the ones with no
   * remaining ground come back.
   */
  async withdraw(entry: AdminDestinationEntry): Promise<void> {
    if (this.busy()) return;
    const confirmed = await this.actions.confirm({
      title: "Retirar el bloqueo",
      message: entry.match_kind === "host"
        ? `Se levanta el bloqueo de todo ${entry.match_value} y se reanalizan los enlaces que ya no tengan otro motivo para seguir bloqueados.`
        : "Se retira esta entrada de URL exacta y se reanalizan los enlaces que ya no tengan otro motivo para seguir bloqueados.",
      confirmLabel: "Retirar entrada",
      destructive: true,
    });
    if (!confirmed || this.busy()) return;
    this.busy.set(true);
    try {
      const result = await this.api.delete(`/api/v1/admin/destinations/${entry.id}`, undefined, decodeDestinationRemoval);
      this.snackbar.open(
        result.releasedLinks > 0
          ? `Entrada retirada. ${countLabel(result.releasedLinks, "enlace recupera su estado", "enlaces recuperan su estado")}.`
          : "Entrada retirada",
        "Cerrar",
        { duration: 3500 },
      );
      // The console re-reads every view of these links on `changed`, this list
      // included, so a reload here would ask the same question twice.
      this.changed.emit();
    } catch (error) {
      this.snackbar.open(apiMessage(error, "No se pudo retirar la entrada"), "Cerrar", { duration: 4000 });
    } finally {
      this.busy.set(false);
    }
  }
}
