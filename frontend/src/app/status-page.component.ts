import { Component, ChangeDetectionStrategy, inject } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";

@Component({
  selector: "app-status-page",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule],
  template: `
    <main class="status-page" [attr.data-kind]="kind">
      <a class="brand" routerLink="/" aria-label="UVH, inicio">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 64 64" width="32" height="32">
            <rect width="64" height="64" rx="16" fill="#07111F" />
            <path d="M26 38a8 8 0 0 1 0-12l6-6a8 8 0 0 1 12 12l-3 3" fill="none" stroke="#00D2C4" stroke-width="5" stroke-linecap="round" />
            <path d="M38 26a8 8 0 0 1 0 12l-6 6a8 8 0 0 1-12-12l3-3" fill="none" stroke="#5D7CFF" stroke-width="5" stroke-linecap="round" />
          </svg>
        </span>
        <span>UVH</span>
      </a>

      <section class="status-card" aria-labelledby="status-title">
        <span class="status-icon" aria-hidden="true"><mat-icon>{{ icon }}</mat-icon></span>
        <span class="status-code tnum">{{ code }}</span>
        <h1 id="status-title">{{ title }}</h1>
        <p>{{ message }}</p>
        <div class="actions">
          <a mat-flat-button color="primary" routerLink="/">Volver al inicio</a>
          @if (kind === 'forbidden') {
            <a mat-stroked-button routerLink="/app/dashboard">Ir al panel</a>
          }
        </div>
      </section>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host { display: block; min-height: 100vh; }
      .status-page {
        min-height: 100vh;
        display: grid;
        place-items: center;
        gap: 36px;
        padding: 34px 20px;
        background:
          radial-gradient(700px 420px at 15% 0%, color-mix(in srgb, var(--uvh-electric) 13%, transparent), transparent 70%),
          radial-gradient(600px 420px at 90% 100%, color-mix(in srgb, var(--uvh-teal) 12%, transparent), transparent 70%),
          var(--uvh-surface);
        color: var(--uvh-ink);
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        color: var(--uvh-ink);
        font-size: 21px;
        font-weight: 800;
        letter-spacing: -0.04em;
        text-decoration: none;
      }
      .brand-mark { display: inline-flex; filter: drop-shadow(0 8px 18px rgba(36, 87, 245, .22)); }
      .status-card {
        width: min(100%, 520px);
        padding: 42px 34px 36px;
        text-align: center;
        background: var(--mat-sys-surface-container-lowest, #fff);
        border: 1px solid var(--uvh-border);
        border-radius: var(--uvh-radius-lg);
        box-shadow: var(--uvh-shadow-lg);
      }
      .status-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 64px;
        height: 64px;
        margin-bottom: 14px;
        border-radius: 20px;
        color: var(--uvh-electric);
        background: color-mix(in srgb, var(--uvh-electric) 12%, transparent);
      }
      .status-icon mat-icon { width: 34px; height: 34px; font-size: 34px; }
      .status-code {
        display: block;
        color: var(--uvh-muted-soft);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: .14em;
      }
      h1 { margin: 8px 0 8px; font-size: clamp(24px, 4vw, 32px); letter-spacing: -.04em; }
      p { max-width: 420px; margin: 0 auto; color: var(--uvh-muted); font-size: 14px; line-height: 1.65; }
      .actions { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
      @media (max-width: 520px) {
        .status-page { align-content: center; }
        .status-card { padding: 32px 22px 28px; }
      }
    `,
  ],
})
export class StatusPageComponent {
  private readonly route = inject(ActivatedRoute);
  readonly kind = this.route.snapshot.data["kind"] === "forbidden" ? "forbidden" : "not-found";
  readonly code = this.kind === "forbidden" ? "403" : "404";
  readonly icon = this.kind === "forbidden" ? "lock" : "travel_explore";
  readonly title = this.kind === "forbidden" ? "No tienes acceso a esta zona" : "Esta ruta no existe";
  readonly message = this.kind === "forbidden"
    ? "La plataforma ha bloqueado esta navegación porque tu cuenta no tiene los permisos necesarios."
    : "La dirección puede haber cambiado o el enlace que has seguido ya no está disponible.";
}
