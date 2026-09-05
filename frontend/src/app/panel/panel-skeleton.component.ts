import { ChangeDetectionStrategy, Component, input } from "@angular/core";

export type PanelSkeletonVariant = "dashboard" | "list" | "cards" | "form" | "detail";

@Component({
  selector: "app-panel-skeleton",
  standalone: true,
  template: `
    <div class="skeleton-shell" [class]="'skeleton-shell ' + variant()" role="status" aria-live="polite">
      <span class="sr-only">{{ label() }}</span>
      @if (variant() === "dashboard" || variant() === "detail") {
        <div class="metric-grid" aria-hidden="true">
          @for (item of items; track item) { <span class="sk metric"></span> }
        </div>
        <span class="sk chart" aria-hidden="true"></span>
        <div class="split" aria-hidden="true"><span class="sk panel"></span><span class="sk panel"></span></div>
      } @else if (variant() === "cards") {
        <div class="cards-grid" aria-hidden="true">
          @for (item of items; track item) {
            <span class="sk card-item"><i></i><b></b><small></small></span>
          }
        </div>
      } @else if (variant() === "form") {
        <div class="form-card" aria-hidden="true">
          <span class="sk line title"></span>
          <span class="sk field"></span>
          <span class="sk field short"></span>
          <span class="sk button"></span>
        </div>
      } @else {
        <div class="list-card" aria-hidden="true">
          @for (item of rows; track item) {
            <span class="list-row"><i class="sk avatar"></i><span><b class="sk line"></b><small class="sk line"></small></span><em class="sk action"></em></span>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
    .skeleton-shell { display: grid; gap: 16px; }
    .sk { position: relative; display: block; overflow: hidden; border-radius: 10px; background: color-mix(in srgb, var(--uvh-muted) 11%, var(--uvh-surface-raised)); }
    .sk::after { content: ""; position: absolute; inset: 0; transform: translateX(-105%); background: linear-gradient(90deg, transparent, color-mix(in srgb, #fff 42%, transparent), transparent); animation: shimmer 1.55s infinite cubic-bezier(.4,0,.2,1); }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
    .metric { height: 112px; border: 1px solid var(--uvh-border); }
    .chart { height: 300px; border: 1px solid var(--uvh-border); border-radius: 16px; }
    .split { display: grid; grid-template-columns: 1.15fr .85fr; gap: 16px; }
    .panel { height: 250px; border: 1px solid var(--uvh-border); border-radius: 16px; }
    .cards-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .card-item { display: grid; height: 178px; padding: 22px; border: 1px solid var(--uvh-border); border-radius: 16px; }
    .card-item i { width: 40px; height: 40px; border-radius: 12px; background: color-mix(in srgb, var(--uvh-muted) 12%, transparent); }
    .card-item b { width: 42%; height: 16px; border-radius: 5px; background: color-mix(in srgb, var(--uvh-muted) 12%, transparent); }
    .card-item small { width: 74%; height: 11px; border-radius: 5px; background: color-mix(in srgb, var(--uvh-muted) 10%, transparent); }
    .form-card, .list-card { padding: 22px; border: 1px solid var(--uvh-border); border-radius: 16px; background: var(--uvh-surface-raised); box-shadow: var(--uvh-shadow-sm); }
    .form-card { display: grid; gap: 16px; }
    .line { height: 13px; }
    .line.title { width: 30%; height: 18px; }
    .field { height: 56px; border: 1px solid var(--uvh-border); }
    .field.short { width: 62%; }
    .button { width: 145px; height: 42px; }
    .list-card { display: grid; padding-block: 6px; }
    .list-row { display: grid; min-height: 82px; grid-template-columns: 38px minmax(0, 1fr) 76px; align-items: center; gap: 14px; padding: 15px 10px; border-bottom: 1px solid var(--uvh-border); }
    .list-row:last-child { border-bottom: 0; }
    .list-row > span { display: grid; gap: 9px; }
    .list-row b { width: min(250px, 68%); }
    .list-row small { width: min(390px, 88%); height: 10px; }
    .avatar { width: 38px; height: 38px; border-radius: 12px; }
    .action { width: 76px; height: 34px; }
    @keyframes shimmer { to { transform: translateX(105%); } }
    @media (max-width: 860px) { .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .split, .cards-grid { grid-template-columns: 1fr; } }
    @media (max-width: 520px) { .metric-grid { grid-template-columns: 1fr 1fr; gap: 10px; } .metric { height: 94px; } .chart { height: 230px; } .list-row { grid-template-columns: 34px minmax(0, 1fr); } .list-row .action { display: none; } .field.short { width: 100%; } }
    @media (prefers-reduced-motion: reduce) { .sk::after { animation: none; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PanelSkeletonComponent {
  readonly variant = input<PanelSkeletonVariant>("list");
  readonly label = input("Cargando contenido");
  readonly items = [1, 2, 3, 4] as const;
  readonly rows = [1, 2, 3, 4] as const;
}
