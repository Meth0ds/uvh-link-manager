import { LanguageSelectorComponent } from "../core/localisation/language-selector.component";
import { Component, ChangeDetectionStrategy, ElementRef, viewChild } from "@angular/core";
import { RouterLink } from "@angular/router";
import { PublicThemeToggleComponent } from "../core/public-theme-toggle.component";

/** Shared presentation for login, registration and their existing recovery
 * states. Projected forms retain their own validation, CAPTCHA and submission.
 */
@Component({
  selector: "app-auth-shell",
  standalone: true,
  imports: [LanguageSelectorComponent, RouterLink, PublicThemeToggleComponent],
  template: `
    <div class="auth-shell">
      <button class="skip-form" type="button" (click)="skipToForm()"><ng-container i18n="@@ui.c5644918eda7a3">Saltar al formulario</ng-container></button>
      <header class="auth-header">
        <a class="brand" routerLink="/" aria-label="UVH, inicio" i18n-aria-label="@@ui.8afc7c79bbbb0d"><ng-container i18n="@@ui.3e4f24607f6041">uvh</ng-container><span>.</span></a>
        <a class="back-link" routerLink="/"><ng-container i18n="@@ui.99aaf1974546dd">Volver a la web </ng-container><span aria-hidden="true">↗</span></a>
        <app-language-selector /><app-public-theme-toggle />
      </header>
      <aside class="auth-brand">
        <div class="brand-copy">
          <span class="eyebrow"><ng-container i18n="@@ui.6dbb5a49e49195">Acortador y gestor de enlaces</ng-container></span>
          <h1><ng-container i18n="@@ui.209bccb02dca30">Gestiona tus enlaces.</ng-container><br /><span><ng-container i18n="@@ui.d0d5f6ca6491a0">Actualiza su destino.</ng-container></span></h1>
          <p><ng-container i18n="@@ui.7d7d246ef88573">Crea direcciones cortas, consulta sus clics y organiza el trabajo con tu equipo.</ng-container></p>
        </div>
        <div class="brand-note"><span class="note-index"><ng-container i18n="@@ui.3f4a675f257227">El enlace que compartes</ng-container></span><div class="note-alias">uvh.es/<b><ng-container i18n="@@ui.5d30794986031e">catalogo</ng-container></b></div><div class="note-destination"><span aria-hidden="true">↳</span><div><span><ng-container i18n="@@ui.2b13253b5e74b4">Destino editable</ng-container></span><code>tienda.example/catalogo</code></div></div><p><ng-container i18n="@@ui.1ab72fb056a863">Puedes cambiar el destino conservando la dirección corta.</ng-container></p><small><ng-container i18n="@@ui.2801ae9fa279c5">Ejemplo ilustrativo.</ng-container></small></div>
        <div class="brand-footer"><span><ng-container i18n="@@ui.f1493769698b9c">Enlaces, dominios y equipo.</ng-container></span><a routerLink="/help"><ng-container i18n="@@ui.bf4b636ecd06e4">Centro de ayuda </ng-container><span aria-hidden="true">↗</span></a></div>
      </aside>
      <main #mainContent class="auth-main" tabindex="-1"><ng-content /></main>
      <footer class="auth-footer"><span><ng-container i18n="@@ui.c72375e92b5c5a">UVH · Acceso a tu cuenta</ng-container></span><nav aria-label="Información legal" i18n-aria-label="@@ui.7bf153fbb17c4e"><a routerLink="/legal/privacidad"><ng-container i18n="@@ui.52233e2c4d6b2e">Privacidad</ng-container></a><a routerLink="/legal/terminos"><ng-container i18n="@@ui.60eaf1f65f2194">Términos</ng-container></a><a routerLink="/help"><ng-container i18n="@@ui.32b40035b08043">Ayuda</ng-container></a></nav></footer>
    </div>
  `,
  styleUrl: "./auth-shell.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthShellComponent {
  private readonly mainContent = viewChild.required<ElementRef<HTMLElement>>("mainContent");

  skipToForm(): void {
    const main = this.mainContent().nativeElement;
    // Auth links can carry credentials in the fragment; jumping by focus must
    // preserve the URL rather than replacing it with an anchor fragment.
    main.focus({ preventScroll: true });
    main.scrollIntoView({ block: "start", behavior: "auto" });
  }
}
