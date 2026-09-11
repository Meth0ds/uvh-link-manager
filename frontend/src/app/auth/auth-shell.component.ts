import { Component, ChangeDetectionStrategy } from "@angular/core";
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
      <header class="auth-header">
        <a class="brand" routerLink="/" aria-label="UVH, inicio">uvh<span>.</span></a>
        <a class="back-link" routerLink="/">Volver a la web <span aria-hidden="true">↗</span></a>
        <app-public-theme-toggle />
      </header>
      <aside class="auth-brand">
        <div class="brand-copy">
          <span class="eyebrow">TU ESPACIO EN UVH</span>
          <h1>Lo que compartes.<br /><em>Lo que viene<br />después.</em></h1>
          <p>Un sitio para tus enlaces, tu equipo y las decisiones que aún puedes cambiar.</p>
        </div>
        <div class="brand-note"><span class="note-index">01 / UN ENLACE CON RECORRIDO</span><div class="note-alias">uvh.es/<b>tu-proximo-paso</b></div><div class="note-path" aria-hidden="true">└───────────→</div><p>La dirección se queda.<br />Tú decides adónde lleva.</p></div>
        <div class="brand-footer"><span>ENLACES CON RECORRIDO.</span><a routerLink="/help">¿Necesitas ayuda? ↗</a></div>
      </aside>
      <main class="auth-main"><ng-content /></main>
      <footer class="auth-footer"><span>UVH / ACCESO A TU CUENTA</span><nav aria-label="Información legal"><a routerLink="/legal/privacidad">Privacidad</a><a routerLink="/legal/terminos">Términos</a><a routerLink="/help">Ayuda</a></nav></footer>
    </div>
  `,
  styleUrl: "./auth-shell.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthShellComponent {}
