import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, Injectable, inject, input, signal } from "@angular/core";
import { MatRippleModule } from "@angular/material/core";
import { MatTooltipModule } from "@angular/material/tooltip";
import { ThemeService } from "./services/theme.service";

/** One transition owner prevents overlapping snapshots across public shells. */
@Injectable({ providedIn: "root" })
export class PublicThemeTransitionService {
  readonly theme = inject(ThemeService);
  readonly busy = signal(false);
  private readonly document = inject(DOCUMENT);

  toggle(event: MouseEvent): void {
    if (this.busy()) return;
    const view = this.document.defaultView;
    const reduced = typeof view?.matchMedia === "function"
      && view.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!view || reduced || typeof this.document.startViewTransition !== "function") {
      this.theme.toggle();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, view.innerWidth - x), Math.max(y, view.innerHeight - y));
    const root = this.document.documentElement;
    root.style.setProperty("--landing-theme-x", `${x}px`);
    root.style.setProperty("--landing-theme-y", `${y}px`);
    root.style.setProperty("--landing-theme-radius", `${radius}px`);
    root.classList.add("landing-theme-transition");
    this.busy.set(true);
    const cleanup = (): void => {
      root.classList.remove("landing-theme-transition");
      root.style.removeProperty("--landing-theme-x");
      root.style.removeProperty("--landing-theme-y");
      root.style.removeProperty("--landing-theme-radius");
      this.busy.set(false);
    };
    // Let Angular settle in the next task. A painted-frame wait deadlocks a
    // native snapshot; a manual ApplicationRef.tick can re-enter Zone's tick.
    try {
      const transition = this.document.startViewTransition(async () => {
        this.theme.toggle({ x, y });
        await new Promise<void>((resolve) => view.setTimeout(resolve, 0));
      });
      void transition.ready.catch(() => undefined);
      void transition.updateCallbackDone.catch(() => undefined);
      void transition.finished.catch(() => undefined).finally(cleanup);
    } catch {
      // A browser may expose the method but reject starting a snapshot.
      cleanup();
      this.theme.toggle();
    }
  }
}

@Component({
  selector: "app-public-theme-toggle",
  standalone: true,
  imports: [MatRippleModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button matRipple type="button" role="switch" [class.with-label]="showLabel()"
      [disabled]="transition.busy()" [attr.aria-checked]="transition.theme.resolved() === 'dark'"
      aria-label="Modo oscuro"
      [matTooltip]="showLabel() ? '' : (transition.theme.resolved() === 'dark' ? 'Cambiar a papel claro' : 'Cambiar a tinta oscura')"
      (click)="transition.toggle($event)">
      <span class="theme-disc" aria-hidden="true">◐</span>
      @if (showLabel()) { <span>Apariencia</span><b>{{ transition.theme.resolved() === 'dark' ? 'Oscuro' : 'Claro' }}</b> }
    </button>
  `,
  styles: `
    :host { display: inline-block; }
    button { display: inline-flex; align-items: center; justify-content: center; gap: 16px; min-width: 44px; min-height: 44px; border: 1px solid var(--line, #cecec0); border-radius: 0; background: transparent; color: var(--ink, #262821); cursor: pointer; font: 12px Manrope, sans-serif; transition: background-color 180ms ease, transform 180ms ease; }
    button.with-label { width: 100%; padding: 12px 16px; }
    button:hover { background: var(--soft, #eae7dd); }
    button:active { transform: scale(.97); }
    button:focus-visible { outline: 3px solid var(--accent, #c44324); outline-offset: 4px; }
    button:disabled { cursor: wait; }
    .theme-disc { display: inline-block; font: 25px Georgia, serif; transition: transform 350ms cubic-bezier(.2,.8,.2,1); }
    button[aria-checked="true"] .theme-disc { transform: rotate(180deg); }
    b { margin-left: auto; font: 11px "Courier New", monospace; }
    @media (prefers-reduced-motion: reduce) { button, .theme-disc { transition: none; } }
  `,
})
export class PublicThemeToggleComponent {
  readonly transition = inject(PublicThemeTransitionService);
  readonly showLabel = input(false);
}
