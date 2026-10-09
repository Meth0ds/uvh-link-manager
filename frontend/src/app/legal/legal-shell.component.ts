import { Component, ChangeDetectionStrategy, DestroyRef, ElementRef, HostListener, ViewChild, inject, signal } from "@angular/core";
import { DOCUMENT, ViewportScroller } from "@angular/common";
import { RouterLink, RouterLinkActive } from "@angular/router";
import { MatIconModule } from "@angular/material/icon";
import { PublicThemeToggleComponent } from "../core/public-theme-toggle.component";

@Component({
  selector: "app-legal-shell",
  standalone: true,
  imports: [RouterLink, RouterLinkActive, MatIconModule, PublicThemeToggleComponent],
  templateUrl: "./legal-shell.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./legal-shell.component.scss",
})
export class LegalShellComponent {
  @ViewChild("menuButton") private menuButton?: ElementRef<HTMLButtonElement>;
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private focusFrame?: number;
  readonly year = new Date().getFullYear();
  readonly mobileOpen = signal(false);
  readonly pages = [
    { path: "/help", label: "Ayuda" },
    { path: "/status", label: "Estado del servicio" },
    { path: "/legal/terminos", label: "Términos" },
    { path: "/legal/privacidad", label: "Privacidad" },
    { path: "/legal/denuncias", label: "Denunciar enlace" },
  ];

  constructor() {
    const scroller = inject(ViewportScroller);
    // Router anchor scrolling uses coordinates, not CSS scroll-margin.
    scroller.setOffset(() => [0, (this.host.nativeElement.querySelector(".legal-header")?.getBoundingClientRect().height ?? 72) + 24]);
    this.destroyRef.onDestroy(() => {
      scroller.setOffset([0, 0]);
      this.document.body.classList.remove("uvh-menu-open");
      this.cancelFocus();
    });
  }

  toggleMenu(): void {
    if (this.mobileOpen()) this.closeMenu(true);
    else {
      this.cancelFocus();
      this.mobileOpen.set(true);
      this.document.body.classList.add("uvh-menu-open");
    }
  }

  closeMenu(restoreFocus = false): void {
    this.mobileOpen.set(false);
    this.document.body.classList.remove("uvh-menu-open");
    this.cancelFocus();
    const view = this.document.defaultView;
    if (restoreFocus && view && !this.destroyRef.destroyed) {
      this.focusFrame = view.requestAnimationFrame(() => {
        this.focusFrame = undefined;
        if (!this.destroyRef.destroyed) this.menuButton?.nativeElement.focus();
      });
    }
  }

  @HostListener("document:keydown.escape")
  onEscape(): void { if (this.mobileOpen()) this.closeMenu(true); }

  @HostListener("window:resize")
  onResize(): void { if ((this.document.defaultView?.innerWidth ?? 0) > 900 && this.mobileOpen()) this.closeMenu(); }

  private cancelFocus(): void {
    if (this.focusFrame !== undefined) this.document.defaultView?.cancelAnimationFrame(this.focusFrame);
    this.focusFrame = undefined;
  }
}
