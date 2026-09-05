import { Component, ChangeDetectionStrategy } from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";
import { MatIconModule } from "@angular/material/icon";
import { ThemeToggleComponent } from "../core/theme-toggle.component";

@Component({
  selector: "app-legal-shell",
  standalone: true,
  imports: [RouterLink, RouterLinkActive, MatIconModule, ThemeToggleComponent],
  templateUrl: "./legal-shell.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./legal-shell.component.scss",
})
export class LegalShellComponent {
  readonly year = new Date().getFullYear();
}
