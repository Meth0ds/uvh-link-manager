import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, output, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { QrLibraryService, type SavedQrDesign } from "../../core/services/qr-library.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { validateQrDesign, type QrDesignSpec } from "../../core/services/qr-design";
import type { QrCustomLogo } from "../../core/services/qr-custom-logo";

export interface AppliedQrDesign { spec: QrDesignSpec; logo: QrCustomLogo | null }

@Component({
  selector: "app-qr-design-picker", standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (available()) {
      <section class="design-library" aria-label="Diseños del workspace">
        <button mat-stroked-button type="button" (click)="toggle()" [attr.aria-expanded]="open()" [disabled]="disabled() || !!busy()"><mat-icon>folder_open</mat-icon>Diseños del workspace</button>
        @if (open()) {
          <p>Aplicar un diseño solo cambia este QR. Guardar cambios es una acción separada.</p>
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Diseño guardado</mat-label>
            <mat-select [value]="selectionId()" (selectionChange)="apply($event.value)" [disabled]="disabled() || !!busy()">
              @for (item of designs(); track item.id) { <mat-option [value]="item.id">{{ item.name }}</mat-option> }
            </mat-select>
          </mat-form-field>
          @if (!designs().length && !busy()) { <p>Aún no hay diseños. Guarda el primero para reutilizarlo con tu equipo.</p> }
          @if (canWrite()) {
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Nombre del diseño</mat-label><input matInput maxlength="80" [ngModel]="name()" (ngModelChange)="name.set($event)" [disabled]="disabled() || !!busy()" /></mat-form-field>
            <div class="library-actions">
              <button mat-stroked-button class="save-action" (click)="save(false)" [disabled]="disabled() || busy() || !name().trim()">Guardar como nuevo</button>
              @if (selected()) {
                <button mat-stroked-button class="save-action" (click)="save(true)" [disabled]="disabled() || busy() || !name().trim()">Guardar cambios</button>
                <button mat-button (click)="duplicate()" [disabled]="disabled() || !!busy()">Duplicar guardado</button>
                <button mat-button class="delete-action" (click)="deleting.set(true)" [disabled]="disabled() || !!busy()">Eliminar</button>
              }
            </div>
            @if (deleting()) { <div class="delete-confirm"><p>¿Eliminar el diseño guardado? Los QR de campaña conservarán su diseño y su logo.</p><button mat-button (click)="deleting.set(false)">Cancelar</button><button mat-stroked-button (click)="remove()" [disabled]="busy()">Eliminar diseño</button></div> }
          } @else { <p>Puedes aplicar diseños. Para guardarlos necesitas permiso de edición.</p> }
          @if (busy()) { <p role="status">{{ busy() }}</p> }
          @if (message()) { <p role="status">{{ message() }}</p> }
          @if (error()) { <p class="error" role="alert">{{ error() }}</p><button mat-button (click)="retryError()" [disabled]="busy()">{{ initialPending() || retryApplyId() !== null ? 'Reintentar logo guardado' : 'Actualizar biblioteca' }}</button> }
        }
      </section>
    }
  `,
  styles: [`:host{display:block}.design-library{display:flex;flex-direction:column;gap:12px;border-bottom:1px solid var(--uvh-border);padding-bottom:18px}.design-library p{font-size:12px;line-height:1.6;color:var(--uvh-muted);margin:0}.design-library mat-form-field{width:100%}.library-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.library-actions .save-action{grid-column:1 / -1}.library-actions button{min-width:0;min-height:40px;white-space:normal}.library-actions .delete-action{color:var(--uvh-danger)}.delete-confirm{padding:12px;border-left:2px solid var(--uvh-danger);background:var(--uvh-surface)}.design-library .error{color:var(--uvh-danger)}`],
})
export class QrDesignPickerComponent {
  private readonly library = inject(QrLibraryService);
  private readonly workspace = inject(WorkspaceService);
  private readonly session = inject(SessionContextService);
  private readonly destroy = inject(DestroyRef);
  readonly spec = input.required<QrDesignSpec>();
  readonly initial = input<QrDesignSpec | null>(null);
  readonly initiallyOpen = input(false);
  private initialApplied = false;
  private initiallyOpened = false;
  readonly logo = input<QrCustomLogo | null>(null);
  readonly file = input<File | null>(null);
  readonly disabled = input(false);
  readonly applied = output<AppliedQrDesign>();
  readonly invalidated = output<void>();
  readonly working = output<boolean>();
  readonly designs = signal<SavedQrDesign[]>([]);
  readonly selected = signal<SavedQrDesign | null>(null);
  readonly selectionId = signal<number | null>(null);
  readonly initialPending = signal(false);
  readonly retryApplyId = signal<number | null>(null);
  readonly name = signal("");
  readonly open = signal(false);
  readonly busy = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  readonly deleting = signal(false);
  readonly available = computed(() => !!this.workspace.currentId() && !!this.session.user()?.id);
  readonly canWrite = computed(() => ["owner", "admin", "editor"].includes(this.workspace.currentRole() ?? ""));
  private context = "";
  private revision = 0;
  private abort = new AbortController();
  private duplicateRetry: { signature: string; key: string } | null = null;
  private retry: { signature: string; file: File | null; key: string; uploadKey: string; assetId?: number } | null = null;

  constructor() {
    effect(() => this.working.emit(!!this.busy()));
    effect(() => {
      const initial = this.initial();
      if (initial && !this.initialApplied) { this.initialApplied = true; this.initialPending.set(true); void this.applyInitial(initial); }
      if (this.initiallyOpen() && !this.initiallyOpened) { this.initiallyOpened = true; this.open.set(true); if (!initial) void this.load(); }
    });
    effect(() => {
      const key = JSON.stringify([this.workspace.currentId(), this.workspace.selectionGeneration(), this.workspace.currentRole(), this.session.user()?.id, this.session.generation()]);
      if (this.context && key !== this.context) {
        ++this.revision; this.abort.abort(); this.abort = new AbortController(); this.designs.set([]); this.selected.set(null); this.selectionId.set(null); this.retryApplyId.set(null); this.busy.set(null); this.retry = null; this.duplicateRetry = null;
        this.invalidated.emit();
      }
      this.context = key;
    });
    this.destroy.onDestroy(() => { ++this.revision; this.abort.abort(); });
  }
  private snapshotContext(): string { return JSON.stringify([this.workspace.currentId(), this.workspace.selectionGeneration(), this.workspace.currentRole(), this.session.user()?.id, this.session.generation()]); }
  private current(revision: number, context: string): boolean {
    const now = JSON.stringify([this.workspace.currentId(), this.workspace.selectionGeneration(), this.workspace.currentRole(), this.session.user()?.id, this.session.generation()]);
    return !this.destroy.destroyed && revision === this.revision && context === now;
  }
  async toggle(): Promise<void> { this.open.update(value => !value); if (this.open() && !this.designs().length) await this.load(); }
  async load(): Promise<void> {
    const revision = ++this.revision, context = this.snapshotContext();
    this.busy.set("Cargando diseños…"); this.error.set(null);
    try {
      const rows = await this.library.list({ signal: this.abort.signal });
      if (this.current(revision, context)) {
        const selected = this.selected();
        if (selected && rows.find(row => row.id === selected.id)?.version !== selected.version) {
          this.selected.set(null); this.selectionId.set(null);
          this.message.set("El diseño guardado cambió. Selecciónalo de nuevo para aplicar su versión actual o guarda tus ajustes como un diseño nuevo.");
        }
        this.designs.set(rows);
      }
    }
    catch (error) { if (this.current(revision, context)) this.error.set(error instanceof Error ? error.message : "No se pudo cargar la biblioteca."); }
    finally { if (this.current(revision, context)) this.busy.set(null); }
  }
  private async applyInitial(spec: QrDesignSpec): Promise<void> {
    const context = this.snapshotContext();
    const provisional: SavedQrDesign = { id: 0, name: "Logo de campaña", spec, version: 1, createdAt: "", updatedAt: "" };
    this.designs.update(rows => [...rows, provisional]);
    await this.apply(0);
    if (this.destroy.destroyed || context !== this.snapshotContext()) return;
    this.initialPending.set(this.selected()?.id !== 0);
    if (this.initialPending()) this.open.set(true);
    this.retryApplyId.set(null);
    this.designs.update(rows => rows.filter(row => row.id !== 0)); this.selected.set(null); this.selectionId.set(null); this.name.set("");
  }
  async retryError(): Promise<void> {
    if (this.busy()) return;
    const initial = this.initial();
    if (this.initialPending() && initial) await this.applyInitial(initial);
    else if (this.retryApplyId() !== null) await this.apply(this.retryApplyId()!);
    else await this.load();
  }
  async apply(id: number): Promise<void> {
    if ((this.disabled() && id !== 0) || this.busy()) return;
    const item = this.designs().find(item => item.id === id); if (!item) return;
    this.selectionId.set(id);
    const revision = ++this.revision, context = this.snapshotContext();
    this.busy.set("Aplicando diseño…"); this.error.set(null);
    try {
      let logo: QrCustomLogo | null = null;
      if (item.spec.logo.kind === "custom" && item.spec.logo.assetId) {
        logo = await this.library.preparedLogo(item.spec.logo.assetId, item.name, { signal: this.abort.signal });
      }
      if (!this.current(revision, context)) return;
      this.retryApplyId.set(null); this.selected.set(item); this.name.set(item.name); this.deleting.set(false); this.message.set("Diseño aplicado a este QR."); this.applied.emit({ spec: validateQrDesign(item.spec), logo });
    } catch (error) { if (this.current(revision, context)) { this.retryApplyId.set(id); this.selectionId.set(this.selected()?.id ?? null); this.error.set(error instanceof Error ? error.message : "No se pudo aplicar el diseño."); } }
    finally { if (this.current(revision, context)) this.busy.set(null); }
  }
  async save(update: boolean): Promise<void> {
    if (!this.canWrite() || this.busy() || this.disabled()) return;
    const revision = ++this.revision, context = this.snapshotContext();
    const selected = this.selected(), file = this.file();
    this.busy.set("Guardando diseño…"); this.error.set(null); this.message.set(null);
    try {
      const spec = validateQrDesign(this.spec()), name = this.name().trim();
      const signature = JSON.stringify([update ? selected?.id : null, name, spec, file?.name, file?.size, file?.lastModified]);
      if (this.retry?.signature !== signature || this.retry.file !== file) this.retry = { signature, file, key: crypto.randomUUID(), uploadKey: crypto.randomUUID() };
      const retry = this.retry;
      if (spec.logo.kind === "custom" && spec.logo.assetId === null) {
        if (!file || !this.logo()) throw new Error("Elige tu logo antes de guardar el diseño.");
        const id = retry.assetId ?? await this.library.upload(file, retry.uploadKey);
        if (!this.current(revision, context)) return;
        retry.assetId = id; spec.logo = { kind: "custom", assetId: id };
      }
      const row = update && selected ? await this.library.update(selected, name, spec) : await this.library.create(name, spec, retry.key);
      if (!this.current(revision, context)) return;
      this.retry = null; this.selected.set(row); this.selectionId.set(row.id); this.designs.update(rows => [...rows.filter(item => item.id !== row.id), row].sort((a, b) => a.name.localeCompare(b.name)));
      this.retryApplyId.set(row.id);
      const logo = row.spec.logo.kind === "custom" && row.spec.logo.assetId ? await this.library.preparedLogo(row.spec.logo.assetId, row.name, { signal: this.abort.signal }) : null;
      if (!this.current(revision, context)) return;
      this.retryApplyId.set(null); this.message.set("Diseño guardado en el workspace."); this.applied.emit({ spec: row.spec, logo });
    } catch (error) { if (this.current(revision, context)) this.error.set(error instanceof Error ? error.message : "No se pudo guardar el diseño."); }
    finally { if (this.current(revision, context)) this.busy.set(null); }
  }
  async duplicate(): Promise<void> {
    const selected = this.selected(); if (!selected || this.busy() || !this.canWrite()) return;
    const revision = ++this.revision, context = this.snapshotContext(); this.busy.set("Duplicando diseño…"); this.error.set(null);
    try {
      const signature = JSON.stringify([selected.id, selected.version]);
      if (this.duplicateRetry?.signature !== signature) this.duplicateRetry = { signature, key: crypto.randomUUID() };
      const row = await this.library.create([...selected.name].slice(0, 70).join("") + " (copia)", selected.spec, this.duplicateRetry.key);
      if (this.current(revision, context)) { this.duplicateRetry = null; this.designs.update(rows => [...rows.filter(item => item.id !== row.id), row]); this.message.set("Diseño duplicado."); }
    } catch (error) { if (this.current(revision, context)) this.error.set(error instanceof Error ? error.message : "No se pudo duplicar."); }
    finally { if (this.current(revision, context)) this.busy.set(null); }
  }
  async remove(): Promise<void> {
    const selected = this.selected(); if (!selected || this.busy() || !this.canWrite()) return;
    const revision = ++this.revision, context = this.snapshotContext(); this.busy.set("Eliminando diseño…"); this.error.set(null);
    try {
      await this.library.delete(selected);
      if (this.current(revision, context)) { this.designs.update(rows => rows.filter(item => item.id !== selected.id)); this.selected.set(null); this.selectionId.set(null); this.deleting.set(false); this.message.set("Diseño eliminado. Los QR existentes conservan su diseño."); }
    } catch (error) { if (this.current(revision, context)) this.error.set(error instanceof Error ? error.message : "No se pudo eliminar."); }
    finally { if (this.current(revision, context)) this.busy.set(null); }
  }
}
