import { ChangeDetectionStrategy, Component } from "@angular/core";
import { RouterLink } from "@angular/router";

/**
 * Public, versioned operational guidance. Keep these instructions aligned with
 * the public API contract whenever signing or delivery semantics change.
 */
@Component({
  selector: "app-help",
  standalone: true,
  imports: [RouterLink],
  templateUrl: "./help.component.html",
  styleUrl: "./help.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpComponent {
  readonly guideVersion = "2026-09-06";
  readonly year = new Date().getFullYear();
}
