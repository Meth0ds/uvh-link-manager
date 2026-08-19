import { Component, ChangeDetectionStrategy } from "@angular/core";
import { LegalShellComponent } from "./legal-shell.component";

@Component({
  selector: "app-terms",
  standalone: true,
  imports: [LegalShellComponent],
  templateUrl: "./terms.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./legal-doc.scss",
})
export class TermsComponent {}
