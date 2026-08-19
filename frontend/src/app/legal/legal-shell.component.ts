import { Component, ChangeDetectionStrategy } from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";

@Component({
  selector: "app-legal-shell",
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: "./legal-shell.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./legal-shell.component.scss",
})
export class LegalShellComponent {
  readonly year = new Date().getFullYear();
}
