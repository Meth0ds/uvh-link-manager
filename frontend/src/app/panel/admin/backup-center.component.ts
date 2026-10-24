import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import type { RecoverySnapshot } from "../../core/services/recovery-response-decoder";

@Component({
  selector: "app-backup-center",
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  templateUrl: "./backup-center.component.html",
  styleUrl: "./backup-center.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackupCenterComponent {
  readonly snapshot = input.required<RecoverySnapshot>();
  readonly canCreate = input(false);
  readonly busy = input(false);
  readonly create = output<void>();
}
