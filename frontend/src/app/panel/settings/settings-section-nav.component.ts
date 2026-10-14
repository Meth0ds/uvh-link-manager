import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { MatIconModule } from "@angular/material/icon";

export interface SettingsSectionNavItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  status?: string | null;
  statusTone?: "quiet" | "attention" | "success";
}

@Component({
  selector: "app-settings-section-nav",
  standalone: true,
  imports: [MatIconModule],
  templateUrl: "./settings-section-nav.component.html",
  styleUrl: "./settings-section-nav.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsSectionNavComponent {
  readonly items = input.required<SettingsSectionNavItem[]>();
  readonly activeId = input.required<string>();
  readonly navigate = output<{ id: string; event: MouseEvent }>();

  select(event: MouseEvent, id: string): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    this.navigate.emit({ id, event });
  }
}
