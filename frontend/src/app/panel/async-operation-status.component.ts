import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import { formatWaitLabel } from "../core/retry-countdown";

/** Visual state of one async operation, from work in progress to its outcome. */
export type AsyncOperationTone = "working" | "ready" | "done" | "failed" | "expired";

/**
 * The shared face of an async operation: its icon, its state colour, whatever
 * copy and actions the caller projects, and — when the server asked for a wait
 * — the visible countdown that turns the wait into an action the person can
 * see ending instead of a dead error.
 *
 * The countdown is display only. No request is scheduled when it reaches zero:
 * expiry merely permits the person to choose another attempt.
 */
@Component({
  selector: "app-async-operation-status",
  standalone: true,
  imports: [MatIconModule],
  template: `
    <section class="async-operation" [class]="toneClass()" [attr.aria-busy]="tone() === 'working'">
      <mat-icon aria-hidden="true">{{ icon() }}</mat-icon>
      <div class="async-operation-body">
        <ng-content />
        @if (waitSeconds() > 0) {
          <p class="async-operation-wait">
            {{ waitText() }} <span role="timer" aria-live="off">{{ waitLabel() }}</span>.
            No se reintentará automáticamente.
          </p>
        }
      </div>
    </section>
  `,
  styles: `
    :host { display: block; }
    .async-operation {
      display: flex;
      align-items: flex-start;
      gap: 11px;
      padding: 12px;
      border-left: 2px solid var(--uvh-border);
      border-radius: 3px;
      background: var(--uvh-surface);
    }
    .async-operation > mat-icon { width: 20px; height: 20px; flex: 0 0 20px; color: var(--uvh-muted); font-size: 20px; }
    .async-operation-body { min-width: 0; }
    .async-operation-wait {
      margin: 8px 0 0;
      color: var(--uvh-muted);
      font-size: 10.5px;
      line-height: 1.5;

      [role="timer"] { font-family: "Courier New", monospace; font-variant-numeric: tabular-nums; }
    }
    .ready { border-left: 3px solid var(--uvh-success); background: var(--uvh-success-soft); }
    .ready > mat-icon { color: var(--uvh-success); }
    .failed { border-left: 3px solid var(--uvh-danger); background: var(--uvh-danger-soft); }
    .failed > mat-icon { color: var(--uvh-danger); }
    .expired { border-left: 3px solid var(--uvh-warn); background: var(--uvh-warn-soft); }
    .expired > mat-icon { color: var(--uvh-warn); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AsyncOperationStatusComponent {
  /** Visual state; only the settled states carry their own colour. */
  readonly tone = input<AsyncOperationTone>("working");
  readonly icon = input.required<string>();
  /** Seconds left of a server-proposed wait; 0 renders no countdown. */
  readonly waitSeconds = input(0);
  /** Sentence before the countdown, chosen by the caller. */
  readonly waitText = input("Reintento disponible en");

  readonly waitLabel = computed(() => formatWaitLabel(Math.max(0, this.waitSeconds())));
  readonly toneClass = computed(() => `async-operation ${this.tone()}`);
}
