import { LanguageSelectorComponent } from "./core/localisation/language-selector.component";
import { LocaleLinkDirective } from "./core/localisation/locale-link.directive";
import { Component, ChangeDetectionStrategy } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { PublicThemeToggleComponent } from "./core/public-theme-toggle.component";

@Component({
  selector: "app-status-page", standalone: true,
  imports: [LocaleLinkDirective, LanguageSelectorComponent,  MatButtonModule, MatIconModule, PublicThemeToggleComponent],
  templateUrl: "./status-page.component.html",
  styleUrl: "./status-page.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusPageComponent {
  // Restricted access is separate from the missing-page experience.
  readonly code = "403";
  readonly title = $localize`:@@ui.7c0d7d7d6042d9:Acceso restringido`;
  readonly lead = $localize`:@@ui.3db3813ef4f2df:Tu cuenta no tiene acceso a este recurso. Si crees que debería tenerlo, pídeselo al propietario del espacio de trabajo.`;
  readonly extras: ReadonlyArray<{ label: string; href: string; icon: string }> = [
    { label: $localize`:@@ui.7bd8389e26df94:Centro de ayuda`, href: "/help", icon: "support" },
    { label: $localize`:@@ui.33c62602febfb0:Estado del servicio`, href: "/status", icon: "monitor_heart" },
  ];

  focusMain(main: HTMLElement): void {
    main.focus();
  }
}
