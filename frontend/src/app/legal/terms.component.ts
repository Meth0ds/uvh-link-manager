import { Component } from "@angular/core";
import { LegalShellComponent } from "./legal-shell.component";

@Component({
  selector: "app-terms",
  standalone: true,
  imports: [LegalShellComponent],
  templateUrl: "./terms.component.html",
  styleUrl: "./legal-doc.scss",
})
export class TermsComponent {}
