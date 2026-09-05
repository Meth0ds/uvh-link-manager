import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { MatIconModule } from "@angular/material/icon";

@Component({
  selector: "app-page-header",
  standalone: true,
  imports: [MatIconModule],
  template: `
    <header class="page-hero">
      <div class="page-ambient" aria-hidden="true"></div>
      <div class="page-heading">
        <span class="page-icon" aria-hidden="true"><mat-icon>{{ icon() }}</mat-icon></span>
        <div class="page-copy">
          <span class="page-eyebrow">{{ eyebrow() }}</span>
          <h1>{{ title() }}</h1>
          <p>{{ description() }}</p>
        </div>
      </div>
      <div class="page-actions"><ng-content /></div>
    </header>
  `,
  styles: `
    :host { display: block; margin-bottom: 24px; container-type: inline-size; }

    .page-hero {
      position: relative;
      isolation: isolate;
      display: flex;
      min-height: 132px;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      flex-wrap: wrap;
      overflow: hidden;
      padding: 24px 26px;
      border: 1px solid color-mix(in srgb, var(--uvh-electric) 16%, var(--uvh-border));
      border-radius: 20px;
      background:
        linear-gradient(118deg, color-mix(in srgb, var(--uvh-surface-raised) 96%, var(--uvh-electric)) 0%, var(--uvh-surface-raised) 58%, color-mix(in srgb, var(--uvh-surface-raised) 92%, var(--uvh-teal)) 100%);
      box-shadow: 0 1px 1px color-mix(in srgb, var(--uvh-ink) 4%, transparent), 0 18px 50px -38px color-mix(in srgb, var(--uvh-electric) 52%, transparent);
    }

    .page-hero::before {
      content: "";
      position: absolute;
      z-index: -1;
      inset: 0;
      opacity: .44;
      background-image:
        linear-gradient(color-mix(in srgb, var(--uvh-electric) 7%, transparent) 1px, transparent 1px),
        linear-gradient(90deg, color-mix(in srgb, var(--uvh-electric) 7%, transparent) 1px, transparent 1px);
      background-size: 28px 28px;
      mask-image: linear-gradient(90deg, transparent 34%, #000 100%);
    }

    .page-ambient {
      position: absolute;
      z-index: -1;
      width: 260px;
      height: 260px;
      right: -100px;
      top: -130px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--uvh-electric) 18%, transparent);
      filter: blur(10px);
    }

    .page-heading { display: flex; min-width: 0; flex: 1 1 430px; align-items: flex-start; gap: 16px; }

    .page-icon {
      display: grid;
      width: 46px;
      height: 46px;
      flex: 0 0 46px;
      place-items: center;
      margin-top: 2px;
      border: 1px solid color-mix(in srgb, var(--uvh-electric) 25%, var(--uvh-border));
      border-radius: 14px;
      background: linear-gradient(145deg, color-mix(in srgb, var(--uvh-electric) 14%, var(--uvh-surface-raised)), color-mix(in srgb, var(--uvh-teal) 10%, var(--uvh-surface-raised)));
      color: var(--uvh-electric);
      box-shadow: inset 0 1px color-mix(in srgb, #fff 45%, transparent), 0 10px 24px -18px var(--uvh-electric);
    }

    .page-icon mat-icon { width: 22px; height: 22px; font-size: 22px; }
    .page-copy { min-width: 0; }

    .page-eyebrow {
      display: block;
      margin-bottom: 5px;
      color: var(--uvh-electric);
      font-size: 9.5px;
      font-weight: 850;
      letter-spacing: .14em;
      text-transform: uppercase;
    }

    .page-copy h1 {
      margin: 0;
      color: var(--uvh-ink);
      font-size: clamp(25px, 2.5vw, 34px);
      font-weight: 850;
      letter-spacing: -.055em;
      line-height: 1.08;
      text-wrap: balance;
    }

    .page-copy p {
      max-width: 650px;
      margin: 7px 0 0;
      color: var(--uvh-muted);
      font-size: 13.5px;
      line-height: 1.6;
      text-wrap: pretty;
    }

    .page-actions {
      position: relative;
      z-index: 1;
      display: flex;
      flex: 0 1 auto;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }

    @container (max-width: 760px) {
      :host { margin-bottom: 18px; }
      .page-hero { min-height: 0; align-items: stretch; flex-direction: column; gap: 18px; padding: 20px; border-radius: 17px; }
      .page-heading { flex-basis: auto; }
      .page-icon { width: 42px; height: 42px; flex-basis: 42px; border-radius: 13px; }
      .page-actions { justify-content: flex-start; }
    }

    @container (max-width: 430px) {
      .page-hero { padding: 18px 16px; }
      .page-heading { gap: 12px; }
      .page-icon { width: 38px; height: 38px; flex-basis: 38px; }
      .page-icon mat-icon { width: 20px; height: 20px; font-size: 20px; }
      .page-copy h1 { font-size: 25px; }
      .page-copy p { font-size: 13px; }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageHeaderComponent {
  readonly icon = input.required<string>();
  readonly eyebrow = input("Workspace");
  readonly title = input.required<string>();
  readonly description = input.required<string>();
}
