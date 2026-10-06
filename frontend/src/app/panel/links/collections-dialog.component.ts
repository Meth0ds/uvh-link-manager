import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { targetWorkspace } from "../../core/services/workspace-target";
import { ActionDialogService } from "../action-dialog.service";
import {
  decodeCollectionDeleteResponse,
  decodeCollectionMutationResponse,
  decodeCollectionResponse,
  decodeCollectionsResponse,
} from "../../core/services/scale-response-decoders";
import type { CollectionDto } from "../../core/models";

/**
 * Gestor de colecciones (F7d): agrupación plana de un solo nivel dentro del
 * workspace. Borrar una colección nunca borra enlaces —sólo los deja sin
 * agrupar— porque la agrupación es una comodidad, no una propiedad del enlace.
 */
@Component({
  selector: "app-collections-dialog",
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>
      <span class="title-mark" aria-hidden="true"><mat-icon>folder</mat-icon></span>
      <span><small>Organiza tus enlaces</small><b>Colecciones</b></span>
    </h2>
    <mat-dialog-content class="manager-content">
      <p class="message">Agrupa enlaces de una campaña o proyecto. Borrar una colección conserva sus enlaces, sin agrupar.</p>
      @if (canWrite()) {
        <div class="inline-form manager-create">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Nueva colección</mat-label>
            <input matInput [ngModel]="newName" (ngModelChange)="newName = $event" name="collection-name" autocomplete="off" maxlength="120" placeholder="Por ejemplo, Lanzamiento de otoño" (keyup.enter)="create()" aria-label="Nombre de la nueva colección" [readonly]="busy()" />
            <mat-hint>Hasta 60 caracteres. Usa un nombre único en este espacio.</mat-hint>
          </mat-form-field>
          <button mat-flat-button type="button" (click)="create()" [disabled]="busy() || !newName.trim()" [attr.aria-busy]="busy()">
            <mat-icon aria-hidden="true">add</mat-icon> Crear colección
          </button>
        </div>
      }
      @if (loading()) { <p class="manager-status" role="status">Cargando colecciones…</p> }
      @if (loadError()) {
        <div class="error manager-error" role="alert"><span>{{ error() }}</span><button mat-stroked-button type="button" (click)="reload()" [disabled]="loading() || busy()">Reintentar</button></div>
      }
      @if (!loading() && !loadError() && !collections().length) {
        <div class="manager-empty"><mat-icon aria-hidden="true">folder_open</mat-icon><h3>Todavía no hay colecciones</h3><p>{{ canWrite() ? 'Crea la primera arriba. Después podrás asignar enlaces desde el editor o mover varios desde la biblioteca.' : 'Aquí aparecerán las colecciones que cree el equipo.' }}</p></div>
      }
      @if (collections().length) {
        <div class="manager-summary"><h3>Tus colecciones</h3><span>{{ collections().length }} en este espacio</span></div>
        <ul class="row-list manager-list" [attr.aria-busy]="loading() || busy()" aria-label="Colecciones del espacio">
          @for (collection of collections(); track collection.id) {
            <li class="row-item">
              <div class="row-copy"><span class="name">{{ collection.name }}</span><span class="count">{{ collection.links }} {{ collection.links === 1 ? 'enlace' : 'enlaces' }}</span></div>
              @if (canWrite()) {
                <div class="manager-actions">
                  <button mat-button type="button" (click)="rename(collection)" [disabled]="busy()" [attr.aria-label]="'Renombrar colección ' + collection.name">Renombrar</button>
                  <button mat-icon-button type="button" class="manager-danger" (click)="remove(collection)" [disabled]="busy()" [attr.aria-label]="'Borrar colección ' + collection.name"><mat-icon aria-hidden="true">delete_outline</mat-icon></button>
                </div>
              }
            </li>
          }
        </ul>
      }
      @if (busy()) { <p class="manager-status" role="status">Guardando cambios…</p> }
      @if (error() && !loadError()) { <div class="error" role="alert">{{ error() }}</div> }
    </mat-dialog-content>
    <mat-dialog-actions align="end"><button mat-stroked-button type="button" (click)="close()">Cerrar</button></mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ["../dialog-identity.scss", "../scale-dialog.scss"],
})
export class CollectionsDialogComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private active = true;

  private isCurrent(): boolean {
    return this.active && !this.destroyRef.destroyed && this.openedIn.isCurrent();
  }
  private readonly workspaces = inject(WorkspaceService);
  private readonly actions = inject(ActionDialogService);
  private readonly dialogRef = inject(MatDialogRef<CollectionsDialogComponent, boolean>);

  /** El workspace que abrió el gestor: crear/renombrar/borrar pertenece a ese. */
  private readonly openedIn = targetWorkspace(this.workspaces);

  readonly collections = signal<CollectionDto[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly loadError = signal(false);
  newName = "";
  private changed = false;

  readonly canWrite = computed(() => {
    const role = this.workspaces.currentRole();
    return role === "owner" || role === "admin" || role === "editor";
  });

  constructor() {
    // El selector global sigue usable con el modal abierto: si cambia, el
    // gestor se cierra en vez de tocar colecciones de otro workspace.
    effect(() => {
      if (!this.openedIn.isCurrent()) {
        this.active = false;
        this.dialogRef.close(this.changed);
      }
    });
    void this.reload();
  }

  async create(): Promise<void> {
    const name = this.newName.trim();
    if (!name || this.busy()) return;
    if (Array.from(name).length > 60) {
      this.error.set("El nombre admite hasta 60 caracteres.");
      return;
    }
    const draft = this.newName;
    const created = await this.mutate(
      () => this.api.post("/api/v1/collections", { name }, decodeCollectionResponse),
      "No se pudo crear la colección",
    );
    if (!created || !this.isCurrent()) return;
    if (this.newName === draft) this.newName = "";
    await this.reload();
  }

  async rename(collection: CollectionDto): Promise<void> {
    const name = await this.actions.prompt({
      title: "Renombrar colección",
      message: "El nombre es único dentro del workspace sin distinguir mayúsculas.",
      confirmLabel: "Renombrar",
      inputLabel: "Nombre",
      inputRequired: true,
      inputMinLength: 1,
      inputMaxLength: 60,
    });
    if (name === null || name === collection.name) return;
    const renamed = await this.mutate(
      () => this.api.patch(`/api/v1/collections/${collection.id}`, { name }, decodeCollectionMutationResponse),
      "No se pudo renombrar la colección",
    );
    if (renamed) await this.reload();
  }

  async remove(collection: CollectionDto): Promise<void> {
    const confirmed = await this.actions.confirm({
      title: "Borrar colección",
      message: `¿Quieres borrar «${collection.name}»? Sus ${collection.links} enlaces seguirán vivos, sin agrupar.`,
      confirmLabel: "Borrar colección",
      destructive: true,
    });
    if (!confirmed) return;
    const removed = await this.mutate(
      () => this.api.delete(`/api/v1/collections/${collection.id}`, undefined, decodeCollectionDeleteResponse),
      "No se pudo borrar la colección",
    );
    if (removed) await this.reload();
  }

  close(): void {
    this.active = false;
    this.dialogRef.close(this.changed);
  }

  private async mutate<T>(run: () => Promise<T>, fallback: string): Promise<boolean> {
    // Comprobación síncrona antes de enviar: el interceptor pone el workspace
    // ACTUAL en la cabecera, y aquí el actual debe seguir siendo el de apertura.
    if (!this.isCurrent()) {
      this.dialogRef.close(this.changed);
      return false;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await run();
      if (!this.isCurrent()) return false;
      this.changed = true;
      return true;
    } catch (err) {
      if (!this.isCurrent()) return false;
      this.error.set(err instanceof ApiRequestError ? err.message : fallback);
      return false;
    } finally {
      if (this.isCurrent()) this.busy.set(false);
    }
  }

  async reload(): Promise<void> {
    if (!this.isCurrent() || this.loading()) return;
    this.loadError.set(false);
    this.error.set(null);
    this.loading.set(true);
    try {
      const res = await this.api.get("/api/v1/collections", undefined, decodeCollectionsResponse);
      if (!this.isCurrent()) return;
      this.collections.set(res.collections);
      this.loading.set(false);
    } catch (err) {
      if (!this.isCurrent()) return;
      this.loading.set(false);
      this.loadError.set(true);
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar las colecciones");
    }
  }
}
