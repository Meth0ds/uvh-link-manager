import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from "@angular/core";
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
      <span><small>Biblioteca</small><b>Etiquetas</b></span>
    </h2>
    <mat-dialog-content>
      <p class="message">
        El recuento muestra sólo enlaces vivos. Renombrar cambia el nombre donde quiera que
        aparezca; fusionar funde las etiquetas seleccionadas en una sola.
      </p>
      @if (loading()) {
        <p class="empty">Cargando etiquetas…</p>
      } @else if (!tags().length) {
        <p class="empty">Todavía no hay etiquetas: se crean al etiquetar un enlace.</p>
      } @else {
        <ul class="row-list">
          @for (tag of tags(); track tag.id) {
            <li class="row-item">
              @if (canWrite()) {
                <mat-checkbox
                  [checked]="selected().has(tag.id)"
                  (change)="toggle(tag.id)"
                  [attr.aria-label]="'Seleccionar la etiqueta ' + tag.name"
                ></mat-checkbox>
              }
              <span class="name">#{{ tag.name }}</span>
              <span class="count">{{ tag.links }} enlaces</span>
              @if (canWrite()) {
                <button mat-stroked-button type="button" (click)="rename(tag)">Renombrar</button>
              }
            </li>
          }
        </ul>
        @if (canWrite() && selected().size > 1) {
          <div class="merge-bar">
            <mat-form-field appearance="outline">
              <mat-label>Fusionar en</mat-label>
              <mat-select [value]="mergeTargetId()" (selectionChange)="mergeTargetId.set($event.value)">
                @for (tag of mergeTargets(); track tag.id) {
                  <mat-option [value]="tag.id">#{{ tag.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <button mat-flat-button color="primary" type="button" (click)="merge()" [disabled]="busy() || mergeTargetId() === null">
              Fusionar {{ selected().size }} etiquetas
            </button>
          </div>
        }
      }
      @if (error()) {
        <div class="error" role="alert">{{ error() }}</div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button color="primary" type="button" (click)="close()">Cerrar</button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ["../dialog-identity.scss", "../scale-dialog.scss"],
})
export class TagsDialogComponent {
  private readonly api = inject(ApiService);
  private readonly workspaces = inject(WorkspaceService);
  private readonly actions = inject(ActionDialogService);
  private readonly dialogRef = inject(MatDialogRef<TagsDialogComponent, boolean>);

  /** El workspace que abrió el gestor: renombrar/fusionar pertenece a ese. */
  private readonly openedIn = targetWorkspace(this.workspaces);

  readonly tags = signal<TagDto[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
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
      if (this.openedIn.workspaceId !== null && !this.openedIn.isCurrent()) this.dialogRef.close(this.changed);
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
    if (this.openedIn.workspaceId !== null && !this.openedIn.isCurrent()) {
      this.dialogRef.close(this.changed);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const res = await this.api.post(`/api/v1/tags/${tag.id}/rename`, { name }, decodeTagRenameResponse);
      this.tags.update((tags) => tags.map((item) => (item.id === tag.id ? { ...item, name: res.name } : item)));
      this.changed = true;
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo renombrar la etiqueta");
    } finally {
      this.busy.set(false);
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
    if (this.openedIn.workspaceId !== null && !this.openedIn.isCurrent()) {
      this.dialogRef.close(this.changed);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.post("/api/v1/tags/merge", { sourceIds, targetId }, decodeTagMergeResponse);
      this.changed = true;
      this.selected.set(new Set());
      this.mergeTargetId.set(null);
      await this.reload();
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron fusionar las etiquetas");
    } finally {
      this.busy.set(false);
    }
  }

  close(): void {
    this.dialogRef.close(this.changed);
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.api.get("/api/v1/tags", undefined, decodeTagsResponse);
      this.tags.set(res.tags);
      this.loading.set(false);
    } catch (err) {
      this.loading.set(false);
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar las etiquetas");
    }
  }
}
