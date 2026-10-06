import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { MatIconModule } from "@angular/material/icon";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { targetWorkspace } from "../../core/services/workspace-target";
import { ActionDialogService } from "../action-dialog.service";
import {
  decodeTagMergeResponse,
  decodeTagRenameResponse,
  decodeTagsResponse,
} from "../../core/services/scale-response-decoders";
import type { TagDto } from "../../core/models";

/**
 * Gestor de etiquetas (F7c): una etiqueta es sólo un nombre colgando de
 * enlaces, así que gestionarla es renombrarla o fundirla en otra. La fusión
 * mueve las adhesiones —sin duplicar las que ya tenían ambas— y borra las de
 * origen: ningún enlace pierde ni gana grupos por una fusión.
 */
@Component({
  selector: "app-tags-dialog",
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatIconModule, MatCheckboxModule],
  template: `
    <h2 mat-dialog-title>
      <span class="title-mark" aria-hidden="true"><mat-icon>sell</mat-icon></span>
      <span><small>Organiza tus enlaces</small><b>Etiquetas</b></span>
    </h2>
    <mat-dialog-content class="manager-content">
      <p class="message">Encuentra enlaces por tema. Renombrar una etiqueta actualiza todos los enlaces que la usan.</p>
      @if (loading()) { <p class="manager-status" role="status">Cargando etiquetas…</p> }
      @if (loadError()) {
        <div class="error manager-error" role="alert"><span>{{ error() }}</span><button mat-stroked-button type="button" (click)="reload()" [disabled]="loading() || busy()">Reintentar</button></div>
      }
      @if (!loading() && !loadError() && !tags().length) {
        <div class="manager-empty"><mat-icon aria-hidden="true">sell</mat-icon><h3>Todavía no hay etiquetas</h3><p>{{ canWrite() ? 'Añádelas al crear o editar un enlace. Después podrás renombrarlas o fusionarlas aquí.' : 'Aquí aparecerán las etiquetas que utilice el equipo.' }}</p></div>
      }
      @if (tags().length) {
        <div class="manager-summary"><h3>Tus etiquetas</h3><span>{{ tags().length }} en este espacio</span></div>
        @if (canWrite()) { <p class="manager-hint">Selecciona dos o más etiquetas para fusionarlas en otra.</p> }
        <ul class="row-list manager-list" [attr.aria-busy]="loading() || busy()" aria-label="Etiquetas del espacio">
          @for (tag of tags(); track tag.id) {
            <li class="row-item">
              @if (canWrite()) { <mat-checkbox [checked]="selected().has(tag.id)" (change)="toggle(tag.id)" [disabled]="busy()" [aria-label]="'Seleccionar la etiqueta ' + tag.name"></mat-checkbox> }
              <div class="row-copy"><span class="name">#{{ tag.name }}</span><span class="count">{{ tag.links }} {{ tag.links === 1 ? 'enlace' : 'enlaces' }}</span></div>
              @if (canWrite()) { <button mat-button type="button" (click)="rename(tag)" [disabled]="busy()" [attr.aria-label]="'Renombrar etiqueta ' + tag.name">Renombrar</button> }
            </li>
          }
        </ul>
        @if (canWrite() && selected().size > 1) {
          <section class="manager-merge" aria-label="Fusionar etiquetas seleccionadas">
            <h3>{{ selected().size }} etiquetas seleccionadas</h3><p>Los enlaces pasarán a usar la etiqueta de destino. Las seleccionadas desaparecerán.</p>
            @if (!mergeTargets().length) { <p class="manager-hint" role="status">Deja al menos una etiqueta sin seleccionar para usarla como destino.</p> }
            <div class="merge-bar">
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Etiqueta de destino</mat-label><mat-select [value]="mergeTargetId()" (selectionChange)="mergeTargetId.set($event.value)" [disabled]="busy() || !mergeTargets().length">
                @for (tag of mergeTargets(); track tag.id) { <mat-option [value]="tag.id">#{{ tag.name }}</mat-option> }
              </mat-select></mat-form-field>
              <button mat-flat-button type="button" (click)="merge()" [disabled]="busy() || mergeTargetId() === null">Fusionar etiquetas</button>
            </div>
          </section>
        }
      }
      @if (busy()) { <p class="manager-status" role="status">Guardando cambios…</p> }
      @if (error() && !loadError()) { <div class="error" role="alert">{{ error() }}</div> }
      <p class="note">Los recuentos no incluyen enlaces de la papelera.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end"><button mat-stroked-button type="button" (click)="close()">Cerrar</button></mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ["../dialog-identity.scss", "../scale-dialog.scss"],
})
export class TagsDialogComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private active = true;

  private isCurrent(): boolean {
    return this.active && !this.destroyRef.destroyed && this.openedIn.isCurrent();
  }
  private readonly workspaces = inject(WorkspaceService);
  private readonly actions = inject(ActionDialogService);
  private readonly dialogRef = inject(MatDialogRef<TagsDialogComponent, boolean>);

  /** El workspace que abrió el gestor: renombrar/fusionar pertenece a ese. */
  private readonly openedIn = targetWorkspace(this.workspaces);

  readonly tags = signal<TagDto[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly loadError = signal(false);
  readonly selected = signal<ReadonlySet<number>>(new Set());
  readonly mergeTargetId = signal<number | null>(null);
  private changed = false;

  readonly canWrite = computed(() => {
    const role = this.workspaces.currentRole();
    return role === "owner" || role === "admin" || role === "editor";
  });

  /** Sólo las etiquetas NO seleccionadas pueden ser destino de la fusión. */
  readonly mergeTargets = computed(() => this.tags().filter((tag) => !this.selected().has(tag.id)));

  constructor() {
    // El selector global sigue usable con el modal abierto: si cambia, el
    // gestor se cierra en vez de tocar etiquetas de otro workspace.
    effect(() => {
      if (!this.openedIn.isCurrent()) {
        this.active = false;
        this.dialogRef.close(this.changed);
      }
    });
    void this.reload();
  }

  toggle(id: number): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // El destino deja de ser válido si queda dentro del origen.
    if (this.selected().has(this.mergeTargetId() ?? -1)) this.mergeTargetId.set(null);
  }

  async rename(tag: TagDto): Promise<void> {
    const name = await this.actions.prompt({
      title: "Renombrar etiqueta",
      message: `El nuevo nombre se aplicará a #${tag.name} en todos tus enlaces.`,
      confirmLabel: "Renombrar",
      inputLabel: "Nombre",
      inputRequired: true,
      inputMinLength: 1,
      inputMaxLength: 40,
    });
    if (name === null || name === tag.name) return;
    if (!this.isCurrent()) {
      this.dialogRef.close(this.changed);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const res = await this.api.post(`/api/v1/tags/${tag.id}/rename`, { name }, decodeTagRenameResponse);
      if (!this.isCurrent()) return;
      this.tags.update((tags) => tags.map((item) => (item.id === tag.id ? { ...item, name: res.name } : item)));
      this.changed = true;
    } catch (err) {
      if (!this.isCurrent()) return;
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo renombrar la etiqueta");
    } finally {
      if (this.isCurrent()) this.busy.set(false);
    }
  }

  async merge(): Promise<void> {
    const targetId = this.mergeTargetId();
    const sourceIds = [...this.selected()];
    if (targetId === null || sourceIds.length < 2) return;
    const target = this.tags().find((tag) => tag.id === targetId);
    const confirmed = await this.actions.confirm({
      title: "Fusionar etiquetas",
      message: `Las etiquetas seleccionadas se fusionarán en #${target?.name ?? ""} y dejarán de existir.`,
      confirmLabel: "Fusionar",
      destructive: true,
    });
    if (!confirmed) return;
    if (!this.isCurrent()) {
      this.dialogRef.close(this.changed);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.post("/api/v1/tags/merge", { sourceIds, targetId }, decodeTagMergeResponse);
      if (!this.isCurrent()) return;
      this.changed = true;
      this.selected.set(new Set());
      this.mergeTargetId.set(null);
      await this.reload();
    } catch (err) {
      if (!this.isCurrent()) return;
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron fusionar las etiquetas");
    } finally {
      if (this.isCurrent()) this.busy.set(false);
    }
  }

  close(): void {
    this.active = false;
    this.dialogRef.close(this.changed);
  }

  async reload(): Promise<void> {
    if (!this.isCurrent() || this.loading()) return;
    this.loadError.set(false);
    this.error.set(null);
    this.loading.set(true);
    try {
      const res = await this.api.get("/api/v1/tags", undefined, decodeTagsResponse);
      if (!this.isCurrent()) return;
      this.tags.set(res.tags);
      this.loading.set(false);
    } catch (err) {
      if (!this.isCurrent()) return;
      this.loading.set(false);
      this.loadError.set(true);
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar las etiquetas");
    }
  }
}
