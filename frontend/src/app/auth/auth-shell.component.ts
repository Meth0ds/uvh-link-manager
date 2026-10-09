import { Component, ChangeDetectionStrategy, ElementRef, viewChild } from "@angular/core";
import { RouterLink } from "@angular/router";
import { PublicThemeToggleComponent } from "../core/public-theme-toggle.component";

/** Shared presentation for login, registration and their existing recovery
 * states. Projected forms retain their own validation, CAPTCHA and submission.
 */
@Component({
  selector: "app-auth-shell",
  standalone: true,
  imports: [RouterLink, PublicThemeToggleComponent],
  template: `
    <div class="auth-shell">
      <button class="skip-form" type="button" (click)="skipToForm()">Saltar al formulario</button>
      <header class="auth-header">
        <a class="brand" routerLink="/" aria-label="UVH, inicio">uvh<span>.</span></a>
        <a class="back-link" routerLink="/">Volver a la web <span aria-hidden="true">↗</span></a>
        <app-public-theme-toggle />
      </header>
      <aside class="auth-brand">
        <div class="brand-copy">
          <span class="eyebrow">Acortador y gestor de enlaces</span>
          <h1>Gestiona tus enlaces.<br /><span>Actualiza su destino.</span></h1>
          <p>Crea direcciones cortas, consulta sus clics y organiza el trabajo con tu equipo.</p>
        </div>
        <div class="brand-note"><span class="note-index">El enlace que compartes</span><div class="note-alias">uvh.es/<b>catalogo</b></div><div class="note-destination"><span aria-hidden="true">↳</span><div><span>Destino editable</span><code>tienda.example/catalogo</code></div></div><p>Puedes cambiar el destino conservando la dirección corta.</p><small>Ejemplo ilustrativo.</small></div>
        <div class="brand-footer"><span>Enlaces, dominios y equipo.</span><a routerLink="/help">Centro de ayuda <span aria-hidden="true">↗</span></a></div>
      </aside>
      <main #mainContent class="auth-main" tabindex="-1"><ng-content /></main>
      <footer class="auth-footer"><span>UVH · Acceso a tu cuenta</span><nav aria-label="Información legal"><a routerLink="/legal/privacidad">Privacidad</a><a routerLink="/legal/terminos">Términos</a><a routerLink="/help">Ayuda</a></nav></footer>
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
