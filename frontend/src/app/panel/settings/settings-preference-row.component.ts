import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { MatIconModule } from "@angular/material/icon";

@Component({
  selector: "app-settings-preference-row",
  standalone: true,
  imports: [MatIconModule],
  templateUrl: "./settings-preference-row.component.html",
  styleUrl: "./settings-preference-row.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPreferenceRowComponent {
  readonly icon = input.required<string>();
  readonly label = input.required<string>();
  readonly fixedLabel = input<string | null>(null);
}
