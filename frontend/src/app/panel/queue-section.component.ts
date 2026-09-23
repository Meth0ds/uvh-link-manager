import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatPaginatorModule } from "@angular/material/paginator";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import type { QueuePagingView } from "../core/queue-paging";

/**
 * The frame a queue of the panel is drawn in: its heading, its progress, its
 * notice, its empty state and its pager.
 *
 * Every queue of the console and of moderation shows those six pieces around
 * its own rows, and each one used to write them out again — seven identical
 * error notices, nine paginators, nine progress bars. The rows, the filters and
 * the summary stay with the queue, which knows what they mean:
 *
 *   - `[queue-summary]` inside the heading, next to the title;
 *   - `[queue-actions]` at the far right of the heading;
 *   - `[queue-filters]` under the heading;
 *   - `[queue-rows]` between the notice and the empty state.
 */
@Component({
  selector: "app-queue-section",
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatPaginatorModule, MatProgressBarModule],
  templateUrl: "./queue-section.component.html",
  styleUrl: "./queue-section.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueueSectionComponent {
  readonly title = input.required<string>();

  /** The read side of the list this frame wraps. */
  readonly paging = input.required<QueuePagingView>();

  readonly loadingLabel = input.required<string>();
  readonly pagerLabel = input.required<string>();
  readonly emptyIcon = input.required<string>();
  readonly emptyTitle = input.required<string>();
  readonly emptyHint = input.required<string>();
  readonly pageSizes = input<readonly number[]>([10, 25, 50, 100]);

  /** A list that draws its own container hides the pager while it has no rows. */
  readonly showPagerWhenEmpty = input(true);

  /** A queue that lives under another one in the same tab separates itself with a rule. */
  readonly spaced = input(false);

  readonly compactEmpty = input(false);
}
