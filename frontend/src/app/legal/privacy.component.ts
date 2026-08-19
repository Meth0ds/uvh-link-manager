import { Component, ChangeDetectionStrategy } from "@angular/core";
import { LegalShellComponent } from "./legal-shell.component";

@Component({
  selector: "app-privacy",
  standalone: true,
  imports: [LegalShellComponent],
  templateUrl: "./privacy.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./legal-doc.scss",
})
export class PrivacyComponent {}
