import { ChangeDetectionStrategy, Component, inject, input } from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import { ThemeService } from "./services/theme.service";

@Component({
  selector: "app-theme-toggle",
  standalone: true,
  imports: [MatIconModule],
  template: `
    <button
      class="theme-switch"
      type="button"
      role="switch"
      [class.with-label]="showLabel()"
      [class.compact]="compact()"
      [class.is-dark]="theme.resolved() === 'dark'"
      [attr.aria-checked]="theme.resolved() === 'dark'"
      [attr.aria-label]="theme.resolved() === 'dark' ? 'Activar tema claro' : 'Activar tema oscuro'"
      [attr.title]="theme.resolved() === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'"
      (click)="toggle($event)"
    >
      <span class="theme-orbit" aria-hidden="true">
        <span class="orbit-halo"></span>
        <mat-icon class="theme-icon sun">light_mode</mat-icon>
        <mat-icon class="theme-icon moon">dark_mode</mat-icon>
        <i class="star star-one"></i><i class="star star-two"></i>
      </span>
      @if (showLabel()) {
        <span class="theme-copy">
          <small>Apariencia</small>
          <b>{{ theme.resolved() === 'dark' ? 'Modo oscuro' : 'Modo claro' }}</b>
        </span>
        <span class="theme-next">Cambiar a {{ theme.resolved() === 'dark' ? 'claro' : 'oscuro' }}</span>
      }
    </button>
  `,
  styles: `
    :host { display: inline-flex; }

    .theme-switch {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      padding: 0;
      overflow: hidden;
      border: 1px solid color-mix(in srgb, var(--uvh-border-strong) 74%, transparent);
      border-radius: 14px;
      background: color-mix(in srgb, var(--uvh-surface-raised) 84%, transparent);
      box-shadow: 0 1px 0 color-mix(in srgb, white 48%, transparent) inset, 0 6px 20px color-mix(in srgb, var(--uvh-ink) 7%, transparent);
      color: var(--uvh-ink);
      font: inherit;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: border-color 180ms ease, background-color 240ms ease, box-shadow 220ms ease, transform 180ms ease;
    }

    .theme-switch:hover {
      border-color: color-mix(in srgb, var(--uvh-electric) 48%, var(--uvh-border));
      background: color-mix(in srgb, var(--uvh-electric) 7%, var(--uvh-surface-raised));
      box-shadow: 0 1px 0 color-mix(in srgb, white 45%, transparent) inset, 0 9px 24px color-mix(in srgb, var(--uvh-electric) 13%, transparent);
      transform: translateY(-1px);
    }

    .theme-switch:active { transform: translateY(0) scale(.96); }
    .theme-switch:focus-visible { outline: 2px solid var(--uvh-electric); outline-offset: 3px; }

    .theme-orbit {
      position: relative;
      display: grid;
      width: 32px;
      height: 32px;
      flex: 0 0 auto;
      place-items: center;
      border-radius: 11px;
      background: color-mix(in srgb, #ffb21c 12%, transparent);
      transition: background-color 260ms ease, transform 360ms cubic-bezier(.22, 1, .36, 1);
    }

    .orbit-halo {
      position: absolute;
      width: 23px;
      height: 23px;
      border: 1px solid color-mix(in srgb, #ffb21c 25%, transparent);
      border-radius: 50%;
      opacity: .75;
      transition: border-color 240ms ease, transform 360ms cubic-bezier(.22, 1, .36, 1), opacity 180ms ease;
    }

    .theme-icon {
      position: absolute;
      z-index: 2;
      width: 18px;
      height: 18px;
      font-size: 18px;
      transition: opacity 180ms ease, transform 420ms cubic-bezier(.22, 1, .36, 1), color 240ms ease;
    }

    .sun { color: #d98400; opacity: 1; transform: rotate(0) scale(1); }
    .moon { color: #a8baff; opacity: 0; transform: rotate(64deg) scale(.35); }
    .theme-switch.is-dark .theme-orbit { background: color-mix(in srgb, var(--uvh-electric) 17%, transparent); transform: rotate(-5deg); }
    .theme-switch.is-dark .orbit-halo { border-color: color-mix(in srgb, var(--uvh-electric) 30%, transparent); opacity: .5; transform: scale(.86); }
    .theme-switch.is-dark .sun { opacity: 0; transform: rotate(-70deg) scale(.35); }
    .theme-switch.is-dark .moon { opacity: 1; transform: rotate(-12deg) scale(1); }

    .star { position: absolute; z-index: 3; width: 2px; height: 2px; border-radius: 50%; background: #dce4ff; opacity: 0; transition: opacity 220ms ease, transform 360ms ease; }
    .star-one { top: 7px; right: 6px; }
    .star-two { right: 8px; bottom: 7px; }
    .theme-switch.is-dark .star { opacity: .9; transform: scale(1.35); }

    .theme-switch.with-label {
      justify-content: flex-start;
      gap: 11px;
      width: 100%;
      height: 58px;
      padding: 7px 12px 7px 8px;
      border-radius: 16px;
    }
    .theme-copy { display: grid; min-width: 0; text-align: left; }
    .theme-copy small { color: var(--uvh-muted-soft); font-size: 9px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
    .theme-copy b { margin-top: 2px; color: var(--uvh-ink); font-size: 12.5px; font-weight: 850; }
    .theme-next { margin-left: auto; color: var(--uvh-muted-soft); font-size: 9.5px; font-weight: 700; }

    .theme-switch.compact { width: 38px; height: 38px; border-radius: 12px; }
    .theme-switch.compact .theme-orbit { width: 28px; height: 28px; border-radius: 9px; }
    .theme-switch.compact .theme-icon { width: 16px; height: 16px; font-size: 16px; }

    @media (prefers-reduced-motion: reduce) {
      .theme-switch,
      .theme-orbit,
      .orbit-halo,
      .theme-icon,
      .star { transition: none; }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeToggleComponent {
  readonly showLabel = input(false);
  readonly compact = input(false);
  readonly theme = inject(ThemeService);

  toggle(event: MouseEvent): void {
    this.theme.toggle({ x: event.clientX, y: event.clientY });
  }
}
