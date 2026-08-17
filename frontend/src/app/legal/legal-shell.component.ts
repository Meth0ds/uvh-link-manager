import { Component } from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";

@Component({
  selector: "app-legal-shell",
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: "./legal-shell.component.html",
  styleUrl: "./legal-shell.component.scss",
})
export class LegalShellComponent {
  readonly year = new Date().getFullYear();
}
