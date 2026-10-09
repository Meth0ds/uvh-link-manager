import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import type { CopyPhase } from "../core/services/copy-feedback.service";

@Component({
  selector: "app-copy-feedback-icon",
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { "aria-hidden": "true" },
  template: `
    @if (phase() === 'copied') {
      <svg class="confirmed" viewBox="0 0 24 24" fill="none"><path d="m5 12 4 4 10-10" /></svg>
    } @else {
      <mat-icon [class.pending]="phase() === 'copying'">{{ phase() === 'copying' ? 'hourglass_top' : 'content_copy' }}</mat-icon>
    }
  `,
  styles: `
    :host { display: inline-flex; width: 24px; height: 24px; flex: 0 0 24px; vertical-align: middle; }
    mat-icon { margin: 0 !important; width: 24px !important; height: 24px !important; }
    .confirmed { width: 24px; height: 24px; color: var(--uvh-success); }
    path { stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 24; stroke-dashoffset: 0; animation: copy-check 260ms ease-out; }
    .pending { animation: copy-wait 220ms ease-out; }
    @keyframes copy-check { from { stroke-dashoffset: 24; } }
    @keyframes copy-wait { from { opacity: .4; transform: rotate(-30deg); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { path, .pending { animation: none; } }
  `,
})
export class CopyFeedbackIconComponent { readonly phase = input<CopyPhase>("idle"); }
