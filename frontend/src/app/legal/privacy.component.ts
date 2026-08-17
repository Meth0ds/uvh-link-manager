import { Component } from "@angular/core";
import { LegalShellComponent } from "./legal-shell.component";

@Component({
  selector: "app-privacy",
  standalone: true,
  imports: [LegalShellComponent],
  templateUrl: "./privacy.component.html",
  styleUrl: "./legal-doc.scss",
})
export class PrivacyComponent {}
