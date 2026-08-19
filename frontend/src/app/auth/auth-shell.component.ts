import { Component, ChangeDetectionStrategy } from "@angular/core";
import { RouterLink } from "@angular/router";
import { MatIconModule } from "@angular/material/icon";

/**
 * Split-screen shell for every auth surface (login, register, MFA, recovery,
 * forgot/reset password, verify email, invitation). Left: brand panel with the
 * value proposition. Right: the routed form (transcluded).
 */
@Component({
  selector: "app-auth-shell",
  standalone: true,
  imports: [RouterLink, MatIconModule],
  template: `
    <div class="auth-shell">
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
            <span class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span> Link intelligence</span>
            <h1>Enlaces cortos.<br /><em>Control total.</em></h1>
            <p>Acorta, administra y mide cada enlace desde un único panel. Sin píxeles de terceros, con la analítica en tus manos.</p>
          </div>

          <ul class="brand-points">
            <li><mat-icon aria-hidden="true">check_circle</mat-icon><span><b>Redirección real</b> HTTP 302, sin JavaScript intermedio.</span></li>
            <li><mat-icon aria-hidden="true">check_circle</mat-icon><span><b>Analítica propia</b> clics, países, dispositivos y referentes.</span></li>
            <li><mat-icon aria-hidden="true">check_circle</mat-icon><span><b>Seguridad por diseño</b> MFA, CSRF y auditoría de acciones.</span></li>
          </ul>

          <blockquote class="brand-quote">
            <mat-icon aria-hidden="true">format_quote</mat-icon>
            <p>Pasamos de enlaces sin control a saber exactamente qué campaña trae tráfico y desde qué país.</p>
            <footer><span class="quote-avatar" aria-hidden="true">LF</span><span><b>Lucía Fernández</b><small>Growth Lead · Northwind</small></span></footer>
          </blockquote>
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
        display: grid;
        grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
        min-height: 100vh;
        background: var(--uvh-surface);
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

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 9px;
        color: #8fa6ff;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .eyebrow-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
        box-shadow: 0 0 0 5px rgba(143, 166, 255, 0.16);
      }

      .brand-points {
        display: flex;
        flex-direction: column;
        gap: 14px;
        margin: 0;
        padding: 0;
        list-style: none;

        li {
          display: flex;
          align-items: flex-start;
          gap: 11px;
          color: #c4d0df;
          font-size: 13px;
          line-height: 1.55;

          mat-icon {
            flex: 0 0 auto;
            width: 19px;
            height: 19px;
            margin-top: 1px;
            color: #57cfc2;
            font-size: 19px;
          }

          b {
            display: block;
            color: #edf4ff;
            font-size: 13px;
            font-weight: 800;
          }
        }
      }

      .brand-quote {
        margin: auto 0 0;
        padding: 18px 20px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);

        > mat-icon {
          width: 20px;
          height: 20px;
          color: #57cfc2;
          font-size: 20px;
        }

        p {
          margin: 8px 0 14px;
          color: #c4d0df;
          font-size: 13px;
          line-height: 1.65;
        }

        footer {
          display: flex;
          align-items: center;
          gap: 10px;

          .quote-avatar {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: linear-gradient(135deg, #2457f5, #00a99d);
            color: #fff;
            font-size: 10px;
            font-weight: 800;
          }

          b {
            display: block;
            font-size: 12px;
            font-weight: 800;
          }

          small {
            display: block;
            color: #8295b0;
            font-size: 10.5px;
            margin-top: 2px;
          }
        }
      }

      /* ---------- Main panel ---------- */
      .auth-main {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px 24px;
        background: var(--uvh-surface);
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
          min-height: 0;
          padding: 28px 24px 22px;
          gap: 20px;
        }

        .brand-copy h1 {
          font-size: 26px;
          margin: 10px 0;
        }

        .brand-copy p {
          display: none;
        }

        .brand-points {
          display: none;
        }

        .brand-quote {
          display: none;
        }
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
