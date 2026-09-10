import { Component, ChangeDetectionStrategy, inject } from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";
import { LegalShellComponent } from "./legal-shell.component";
import { LegalIdentityService } from "./legal-identity.service";

@Component({
  selector: "app-privacy",
  standalone: true,
  imports: [LegalShellComponent, RouterLink, RouterLinkActive],
  templateUrl: "./privacy.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./legal-doc.scss",
})
export class PrivacyComponent {
  // A section is selected only when its fragment matches, not the entire route.
  readonly fragmentMatch = { paths: "exact", fragment: "exact", queryParams: "ignored", matrixParams: "ignored" } as const;
  readonly legal = inject(LegalIdentityService);

  constructor() { void this.legal.load(); }
}
