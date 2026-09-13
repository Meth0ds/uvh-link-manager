import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { PublicStatusComponent } from "../src/app/public-status/public-status.component";
import { fixtureMode } from "./workspace-fixture";
import { statusMode } from "./service-fixture";
@Component({
  selector: "app-public-status-preview", standalone: true, imports: [PublicStatusComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside aria-label="Escenarios ficticios de estado"><b>VISTA DE DISEÑO · SIN MONITOR REAL</b>
      @for (option of options; track option.value) { <button type="button" [attr.aria-pressed]="scenario() === option.value" (click)="select(option.value)">{{ option.label }}</button> }
    </aside>
    @for (key of [scenario()]; track key) { <app-public-status /> }
  `,
  styles: `aside { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 20px; color: var(--muted); background: var(--paper); border-bottom: 1px dashed var(--line); }
    b { font: 10px/1.6 monospace; margin-right: auto; }
    button { min-height: 44px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 3px; color: var(--ink); background: var(--paper-raised); cursor: pointer; }
    button[aria-pressed=true] { color: var(--accent); border-color: var(--accent); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }`,
})
export class PublicStatusPreviewComponent {
  readonly scenario = signal("operational");
  readonly options = [{ value: "operational", label: "Operativo" }, { value: "outage", label: "Interrupción" }, { value: "unknown", label: "Desconocido" }, { value: "error", label: "Error" }, { value: "loading", label: "Cargando" }] as const;
  constructor() { this.select("operational"); }
  select(value: "operational" | "outage" | "unknown" | "error" | "loading"): void {
    fixtureMode.set(value === "error" || value === "loading" ? value : "populated");
    statusMode.set(value === "outage" || value === "unknown" ? value : "operational");
    this.scenario.set(value);
  }
}
