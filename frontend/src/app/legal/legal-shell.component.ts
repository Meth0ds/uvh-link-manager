import { Component, ChangeDetectionStrategy, DestroyRef, inject } from "@angular/core";
import { DOCUMENT, ViewportScroller } from "@angular/common";
import { RouterLink, RouterLinkActive } from "@angular/router";
import { PublicThemeToggleComponent } from "../core/public-theme-toggle.component";

@Component({
  selector: "app-legal-shell",
  standalone: true,
  imports: [RouterLink, RouterLinkActive, PublicThemeToggleComponent],
  templateUrl: "./legal-shell.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./legal-shell.component.scss",
})
export class LegalShellComponent {
  readonly year = new Date().getFullYear();

  constructor() {
    const document = inject(DOCUMENT);
    const scroller = inject(ViewportScroller);
    // Angular's anchor scroll uses coordinates, not CSS scroll-margin. Measure
    // the responsive header at navigation time so it never covers the title.
    scroller.setOffset(() => [0, (document.querySelector(".legal-header")?.getBoundingClientRect().height ?? 0) + 24]);
    inject(DestroyRef).onDestroy(() => scroller.setOffset([0, 0]));
  }
}
