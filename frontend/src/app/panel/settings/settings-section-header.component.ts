import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { MatIconModule } from "@angular/material/icon";

@Component({
  selector: "app-settings-section-header",
  standalone: true,
  imports: [MatIconModule],
  templateUrl: "./settings-section-header.component.html",
  styleUrl: "./settings-section-header.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsSectionHeaderComponent {
  readonly icon = input.required<string>();
  readonly eyebrow = input.required<string>();
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly headingId = input.required<string>();
  readonly tone = input<"default" | "danger">("default");
}
