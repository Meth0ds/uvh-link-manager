import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { DashboardComponent } from "../src/app/panel/dashboard/dashboard.component";
import { GettingStartedComponent } from "../src/app/panel/getting-started/getting-started.component";
import { fixtureMode } from "./workspace-fixture";

@Component({
  selector: "app-workspace-preview", standalone: true,
  imports: [DashboardComponent, GettingStartedComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="fixture-toolbar" aria-label="Controles de la vista de diseño">
      <b>VISTA DE DISEÑO · DATOS FICTICIOS · SIN API</b>
      <div role="group" aria-label="Escenario simulado">
        @for (option of modes; track option.value) {
          <button type="button" [attr.aria-pressed]="mode() === option.value" (click)="mode.set(option.value)">{{ option.label }}</button>
        }
      </div>
    </aside>
    <!-- Changing a scenario creates a fresh component, cancelling pending
         reads without test hooks in the real application or its router. -->
    @for (scenario of [mode()]; track scenario) {
      @if (page === 'getting-started') { <app-getting-started /> } @else { <app-dashboard /> }
    }
  `,
  styles: `
    .fixture-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin: 0 0 26px; padding: 10px 12px; border: 1px dashed var(--uvh-muted); color: var(--uvh-muted); }
    b { font: 10px/1.6 monospace; }
    .fixture-toolbar > div { display: flex; gap: 4px; flex-wrap: wrap; }
    button { min-height: 36px; padding: 6px 9px; border: 1px solid var(--uvh-border); border-radius: 2px; color: var(--uvh-ink); background: var(--uvh-surface); font: 11px/1.4 monospace; cursor: pointer; }
    button[aria-pressed=true] { border-color: var(--uvh-electric); color: var(--uvh-electric); }
    button:focus-visible { outline: 2px solid var(--uvh-electric); outline-offset: 2px; }
  `,
})
export class WorkspacePreviewComponent {
  readonly mode = fixtureMode;
  readonly page = inject(ActivatedRoute).snapshot.data["page"] as string;
  readonly modes = [{ value: "populated", label: "Con datos" }, { value: "empty", label: "Vacío" },
    { value: "error", label: "Error" }, { value: "loading", label: "Cargando" }] as const;
}
