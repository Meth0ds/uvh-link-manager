import { LanguageSelectorComponent } from "./core/localisation/language-selector.component";
import { LocaleLinkDirective } from "./core/localisation/locale-link.directive";
import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, ViewChild, ViewEncapsulation } from "@angular/core";
import { Meta } from "@angular/platform-browser";
import { PublicThemeToggleComponent } from "./core/public-theme-toggle.component";
import { mountPuzzle } from "../../public/visitor-assets/puzzle.v1.mjs";

@Component({
  selector: "app-not-found", standalone: true,
  imports: [LocaleLinkDirective, LanguageSelectorComponent, PublicThemeToggleComponent],
  templateUrl: "./not-found.component.html",
  styleUrls: ["../../public/visitor-assets/not-found.v1.css"],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundComponent {
  @ViewChild("puzzle") private puzzle!: ElementRef<HTMLElement>;
  private readonly destroyRef = inject(DestroyRef);
  private readonly meta = inject(Meta);
  constructor() {
    const previous = this.meta.getTag('name="robots"')?.content;
    this.meta.updateTag({ name: "robots", content: "noindex, nofollow" });
    let cleanup: (() => void) | undefined;
    afterNextRender(() => { cleanup = mountPuzzle(this.puzzle.nativeElement); });
    this.destroyRef.onDestroy(() => {
      cleanup?.();
      if (previous === undefined) this.meta.removeTag('name="robots"');
      else this.meta.updateTag({ name: "robots", content: previous });
    });
  }
  focusMain(main: HTMLElement): void { main.focus(); }
}
