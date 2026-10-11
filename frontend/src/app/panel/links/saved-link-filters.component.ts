import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatSelectModule } from "@angular/material/select";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatMenuModule } from "@angular/material/menu";
import { ApiService } from "../../core/services/api.service";
import { LinkWorkflowService } from "../../core/services/link-workflow.service";
import { decodeSavedFilter, decodeSavedFilters } from "../../core/services/link-workflow-decoders";
import { LatestRequest } from "../../core/services/latest-request";
import { ActionDialogService } from "../action-dialog.service";
import type { LinkFilterSpec, SavedLinkFilter } from "../../core/link-workflows";

@Component({ selector: "app-saved-link-filters", standalone: true, imports: [MatButtonModule, MatIconModule, MatSelectModule, MatFormFieldModule, MatMenuModule],
  template: `@if (workflows.enabled()) {
    <div class="saved-filter-bar">
      <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Mis filtros</mat-label>
        <mat-select [canSelectNullableOptions]="true" [value]="selectedId()" (selectionChange)="choose($event.value)" [disabled]="busy() || loading()">
          <mat-option [value]="null">Búsqueda actual</mat-option>
          @for (filter of filters(); track filter.id) { <mat-option [value]="filter.id">{{ filter.name }}{{ filter.valid ? '' : ' · Revisar' }}</mat-option> }
        </mat-select>
      </mat-form-field>
      <div class="saved-filter-actions">
        <button mat-stroked-button type="button" (click)="save(false)" [disabled]="busy() || loading() || filters().length >= (workflows.capabilities()?.maxSavedFilters ?? 50)"><mat-icon aria-hidden="true">bookmark_add</mat-icon>Guardar búsqueda</button>
        @if (selected(); as filter) {
          @if (modified() || !filter.valid) { <button mat-button type="button" (click)="save(true)" [disabled]="busy()"><mat-icon aria-hidden="true">sync</mat-icon>Actualizar filtro</button> }
          <button mat-icon-button type="button" [matMenuTriggerFor]="filterMenu" [disabled]="busy()" [attr.aria-label]="'Gestionar filtro ' + filter.name"><mat-icon>more_horiz</mat-icon></button>
          <mat-menu #filterMenu="matMenu"><button mat-menu-item (click)="rename(filter)"><mat-icon>edit</mat-icon>Renombrar</button><button mat-menu-item (click)="remove(filter)"><mat-icon>delete_outline</mat-icon>Eliminar filtro</button></mat-menu>
        }
      </div>
    </div>
    @if (error()) { <p class="filter-message error" role="alert">{{ error() }} <button mat-button type="button" (click)="reload()">Volver a cargar</button></p> }
    @else if (confirmation()) { <p class="filter-message" role="status"><mat-icon aria-hidden="true">check</mat-icon>{{ confirmation() }}</p> }
    @else if (modified()) { <p class="filter-message">Esta búsqueda tiene cambios sin guardar. Aplicar filtros nunca los sobrescribe.</p> }
    @else { <p class="filter-message">Solo tú ves estos filtros. Se guardan en este workspace.</p> }
  }`,
  styles: [`:host{display:block;min-width:0}.saved-filter-bar{display:flex;align-items:center;gap:16px;padding-top:16px}.saved-filter-bar mat-form-field{width:240px;max-width:100%}.saved-filter-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.saved-filter-actions button{min-height:44px}.filter-message{display:flex;align-items:center;gap:8px;margin:10px 0 16px;font-size:12px;color:var(--uvh-muted);line-height:1.5;min-height:20px}.filter-message mat-icon{font-size:16px;height:16px;width:16px}.error{color:var(--uvh-danger)}@media(max-width:620px){.saved-filter-bar{align-items:stretch;flex-direction:column;gap:8px}.saved-filter-bar mat-form-field{width:100%}.saved-filter-actions{justify-content:space-between}.filter-message{flex-wrap:wrap}}`], changeDetection: ChangeDetectionStrategy.Eager })
export class SavedLinkFiltersComponent {
  readonly spec = input.required<LinkFilterSpec>(); readonly filterApplied = output<{ spec: LinkFilterSpec; id: number }>();
  readonly workflows = inject(LinkWorkflowService); private readonly api = inject(ApiService); private readonly actions = inject(ActionDialogService);
  private readonly owner = inject(DestroyRef); private readonly requests = new LatestRequest(this.owner);
  readonly filters = signal<SavedLinkFilter[]>([]); readonly selectedId = signal<number | null>(null); readonly busy = signal(false); readonly loading = signal(false);
  readonly error = signal<string | null>(null); readonly confirmation = signal<string | null>(null);
  readonly selected = computed(() => this.filters().find(filter => filter.id === this.selectedId()) ?? null);
  readonly modified = computed(() => { const filter = this.selected(); return filter !== null && JSON.stringify(filter.spec) !== JSON.stringify(this.spec()); });
  private context = "";
  private currentContext(): string { return `${this.workflows.context()}:${this.workflows.enabled()}`; }
  private isCurrent(context: string): boolean { return !this.owner.destroyed && context === this.currentContext(); }
  constructor() { effect(() => { const context = this.workflows.context(); const enabled = this.workflows.enabled(); if (`${context}:${enabled}` === this.context) return; this.context = `${context}:${enabled}`; this.requests.invalidate(); this.filters.set([]); this.selectedId.set(null); this.error.set(null); this.confirmation.set(null); this.busy.set(false); this.loading.set(false); if (enabled) void this.reload(); }); }
  async reload(): Promise<void> {
    if (!this.workflows.enabled() || this.context !== this.currentContext()) return;
    const request = this.requests.begin(this.context); this.loading.set(true); this.error.set(null);
    try { const { filters } = await this.api.get("/api/v1/link-filters", undefined, decodeSavedFilters, { signal: request.signal }); if (this.requests.isCurrent(request, this.currentContext())) this.filters.set(filters); }
    catch (error) { if (this.requests.isCurrent(request, this.currentContext())) this.error.set(error instanceof Error ? error.message : "No se pudieron cargar tus filtros."); }
    finally { if (this.requests.isCurrent(request, this.currentContext())) this.loading.set(false); }
  }
  async choose(id: number | null): Promise<void> {
    if (this.context !== this.currentContext() || !this.workflows.enabled()) return;
    this.selectedId.set(id); this.confirmation.set(null);
    if (id === null) return;
    const context = this.context; await this.reload();
    if (!this.isCurrent(context) || this.selectedId() !== id || this.error()) return;
    const filter = this.selected();
    if (!filter || !filter.valid) { this.error.set("Este filtro tiene referencias que ya no existen. Ajusta la búsqueda actual y pulsa «Actualizar filtro» para repararlo."); return; }
    this.filterApplied.emit({ spec: structuredClone(filter.spec), id: filter.id });
  }
  async save(update: boolean): Promise<void> {
    if (this.busy() || !this.workflows.enabled() || this.context !== this.currentContext()) return;
    const filter = update ? this.selected() : null; if (update && !filter) return;
    const context = this.context, spec = structuredClone(this.spec());
    const name = filter?.name ?? await this.actions.prompt({ title: "Guardar búsqueda", message: "Guarda estos criterios para volver a utilizarlos. Los resultados se actualizarán al abrir el filtro.", inputLabel: "Nombre del filtro", inputPlaceholder: "Activos de Navidad", inputRequired: true, inputMaxLength: 80, confirmLabel: "Guardar filtro" });
    if (name === null || this.owner.destroyed || !this.isCurrent(context) || this.busy()) return;
    await this.mutate(context, async () => {
      const response = filter ? await this.api.patch(`/api/v1/link-filters/${filter.id}`, { name, spec, version: filter.version }, decodeSavedFilter)
        : await this.api.post("/api/v1/link-filters", { name, spec }, decodeSavedFilter);
      if (!this.isCurrent(context)) return; this.filters.update(filters => [...filters.filter(f => f.id !== response.filter.id), response.filter].sort((a, b) => a.name.localeCompare(b.name)));
      this.selectedId.set(response.filter.id); this.confirmation.set(filter ? "Filtro actualizado." : "Búsqueda guardada.");
    });
  }
  async rename(filter: SavedLinkFilter): Promise<void> {
    const context = this.context;
    const name = await this.actions.prompt({ title: "Renombrar filtro", message: "Los criterios de la búsqueda se conservarán.", inputLabel: "Nombre", inputValue: filter.name, inputRequired: true, inputMaxLength: 80, confirmLabel: "Guardar nombre" });
    if (name === null || !this.isCurrent(context) || this.owner.destroyed || this.busy()) return;
    await this.mutate(context, async () => { const response = await this.api.patch(`/api/v1/link-filters/${filter.id}`, { name, version: filter.version }, decodeSavedFilter); if (this.isCurrent(context)) { this.filters.update(filters => filters.map(f => f.id === filter.id ? response.filter : f)); this.confirmation.set("Nombre actualizado."); } });
  }
  async remove(filter: SavedLinkFilter): Promise<void> {
    const context = this.context;
    if (!await this.actions.confirm({ title: "Eliminar filtro", message: `Se eliminará «${filter.name}». Tus enlaces se conservarán.`, confirmLabel: "Eliminar filtro", destructive: true }) || !this.isCurrent(context) || this.owner.destroyed || this.busy()) return;
    await this.mutate(context, async () => { await this.api.delete(`/api/v1/link-filters/${filter.id}`, { version: filter.version }); if (this.isCurrent(context)) { this.filters.update(filters => filters.filter(f => f.id !== filter.id)); if (this.selectedId() === filter.id) this.selectedId.set(null); this.confirmation.set("Filtro eliminado. La búsqueda actual se conserva."); } });
  }
  private async mutate(context: string, action: () => Promise<void>): Promise<void> {
    if (!this.isCurrent(context) || !this.workflows.enabled()) return;
    this.busy.set(true); this.error.set(null); this.confirmation.set(null);
    try { await action(); } catch (error) { if (this.isCurrent(context) && !this.owner.destroyed) this.error.set(error instanceof Error ? error.message : "No se pudo guardar el cambio."); }
    finally { if (this.isCurrent(context) && !this.owner.destroyed) this.busy.set(false); }
  }
}
