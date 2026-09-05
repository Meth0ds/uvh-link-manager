import { Component, ChangeDetectionStrategy } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ThemeToggleComponent } from "../core/theme-toggle.component";

/**
 * Split-screen shell for every auth surface (login, register, MFA, recovery,
 * forgot/reset password, verify email, invitation). Left: brand panel with the
 * value proposition. Right: the routed form (transcluded).
 */
@Component({
  selector: "app-auth-shell",
  standalone: true,
  imports: [RouterLink, ThemeToggleComponent],
  template: `
    <div class="auth-shell">
      <div class="auth-theme"><app-theme-toggle /></div>
      <aside class="auth-brand">
        <div class="auth-brand-inner">
          <a class="brand" routerLink="/" aria-label="UVH, inicio">
            <span class="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 64 64" width="34" height="34">
                <rect width="64" height="64" rx="14" fill="#0d1b2e" />
                <path d="M26 38a8 8 0 0 1 0-12l6-6a8 8 0 0 1 12 12l-3 3" fill="none" stroke="#00D2C4" stroke-width="5" stroke-linecap="round" />
                <path d="M38 26a8 8 0 0 1 0 12l-6 6a8 8 0 0 1-12-12l3-3" fill="none" stroke="#5D7CFF" stroke-width="5" stroke-linecap="round" />
              </svg>
            </span>
            <span class="brand-name">UVH</span>
          </a>

          <div class="brand-copy">
            <h1>Una decisión clara<br /><em>por cada enlace.</em></h1>
            <p>Crea, dirige y mide tus enlaces desde el mismo workspace.</p>
          </div>

          <div class="brand-sequence" aria-label="Crear, dirigir y medir">
            <span>Crear</span><i aria-hidden="true"></i><span>Dirigir</span><i aria-hidden="true"></i><span>Medir</span>
          </div>
        </div>
      </aside>

      <main class="auth-main">
        <ng-content />
      </main>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
      }

      .auth-shell {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
        min-height: 100vh;
        background: var(--uvh-surface);
      }

      .auth-theme {
        position: fixed;
        z-index: 8;
        top: 18px;
        right: 20px;
        display: flex;
        padding: 4px;
        border: 1px solid color-mix(in srgb, var(--uvh-border) 78%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--uvh-surface-raised) 88%, transparent);
        box-shadow: var(--uvh-shadow-sm);
        backdrop-filter: blur(14px);
      }

      /* ---------- Brand panel ---------- */
      .auth-brand {
        position: relative;
        overflow: hidden;
        background: #07111f;
        color: #fff;
      }

      .auth-brand::before {
        content: "";
        position: absolute;
        inset: 0;
        background-image: linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
        background-size: 56px 56px;
        mask-image: linear-gradient(to bottom, black, transparent 82%);
        pointer-events: none;
      }

      .auth-brand::after {
        content: "";
        position: absolute;
        top: -180px;
        left: -140px;
        width: 560px;
        height: 560px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(36, 87, 245, 0.38), transparent 66%);
        pointer-events: none;
      }

      .auth-brand-inner {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 34px;
        max-width: 460px;
        margin: 0 auto;
        padding: 44px 40px;
        min-height: 100vh;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        color: #f7f9ff;
        font-size: 20px;
        font-weight: 800;
        letter-spacing: -0.04em;
        text-decoration: none;
      }

      .brand-mark {
        display: inline-flex;
      }

      .brand-copy {
        h1 {
          margin: 14px 0 14px;
          font-size: clamp(30px, 3.4vw, 42px);
          font-weight: 800;
          letter-spacing: -0.055em;
          line-height: 1.04;

          em {
            background: linear-gradient(100deg, #a6b8ff 5%, #4bd8cc 95%);
            background-clip: text;
            -webkit-background-clip: text;
            color: transparent;
            font-style: normal;
          }
        }

        p {
          margin: 0;
          color: #a8b8ce;
          font-size: 14.5px;
          line-height: 1.7;
        }
      }

      .brand-sequence {
        display: flex;
        align-items: center;
        gap: 16px;
        margin: auto 0 24px;
        color: #edf4ff;
        font-size: 17px;
        font-weight: 750;
        letter-spacing: -0.025em;

        i {
          width: 34px;
          height: 1px;
          background: linear-gradient(90deg, rgba(143, 166, 255, .72), rgba(87, 207, 194, .72));
        }
      }

      /* ---------- Main panel ---------- */
      .auth-main {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px 24px;
        background:
          radial-gradient(620px 420px at 100% 0%, color-mix(in srgb, var(--uvh-electric) 7%, transparent), transparent 72%),
          var(--uvh-surface);
      }

      /* ---------- Responsive ---------- */
      @media (max-width: 960px) {
        .auth-shell {
          display: block;
        }

        .auth-brand {
          min-height: 0;
        }

        .auth-brand-inner {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          min-height: 0;
          padding: 18px 104px 18px 22px;
          gap: 18px;
        }

        .brand-copy h1 {
          margin: 0;
          font-size: 22px;
          line-height: 1.05;
        }

        .brand-copy p,
        .brand-copy br {
          display: none;
        }

        .brand-sequence {
          display: none;
        }

        .auth-main {
          align-items: flex-start;
          padding: 24px 16px 38px;
        }

        .auth-theme {
          top: 14px;
          right: 15px;
          border-color: rgba(255, 255, 255, .18);
          background: rgba(9, 25, 45, .82);
        }
      }

      @media (max-width: 520px) {
        .auth-brand-inner {
          grid-template-columns: 1fr;
          padding: 15px 96px 15px 18px;
          gap: 10px;
        }

        .brand-copy h1 { font-size: 19px; }
        .brand-copy h1 em { display: inline; }
        .auth-main { padding: 18px 12px 30px; }
      }

      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation-duration: 0.01ms !important;
          transition-duration: 0.01ms !important;
        }
      }
    `,
  ],
})
export class AuthShellComponent {}
