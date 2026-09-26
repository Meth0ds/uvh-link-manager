import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from "@angular/core";
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
      <span><small>Biblioteca</small><b>Colecciones</b></span>
    </h2>
    <mat-dialog-content>
      <p class="message">
        Un único nivel, sin subcolecciones. El nombre es único sin distinguir mayúsculas.
        Al borrar una colección sus enlaces quedan vivos y sin agrupar.
      </p>
      @if (canWrite()) {
        <div class="inline-form">
          <mat-form-field appearance="outline">
            <mat-label>Nueva colección</mat-label>
            <input matInput [ngModel]="newName" (ngModelChange)="newName = $event" maxlength="60" placeholder="Campaña navidad" (keyup.enter)="create()" aria-label="Nombre de la nueva colección" />
          </mat-form-field>
          <button mat-flat-button color="primary" type="button" (click)="create()" [disabled]="busy() || !newName.trim()">
            <mat-icon>create_new_folder</mat-icon> Crear
          </button>
        </div>
      }
      @if (loading()) {
        <p class="empty">Cargando colecciones…</p>
      } @else if (!collections().length) {
        <p class="empty">Todavía no hay colecciones.</p>
      } @else {
        <ul class="row-list">
          @for (collection of collections(); track collection.id) {
            <li class="row-item">
              <span class="name">{{ collection.name }}</span>
              <span class="count">{{ collection.links }} enlaces</span>
              @if (canWrite()) {
                <button mat-stroked-button type="button" (click)="rename(collection)" [disabled]="busy()">Renombrar</button>
                <button mat-stroked-button type="button" class="bulk-danger" (click)="remove(collection)" [disabled]="busy()">
                  <mat-icon>delete_outline</mat-icon> Borrar
                </button>
              }
            </li>
          }
        </ul>
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
export class CollectionsDialogComponent {
  private readonly api = inject(ApiService);
  private readonly workspaces = inject(WorkspaceService);
  private readonly actions = inject(ActionDialogService);
  private readonly dialogRef = inject(MatDialogRef<CollectionsDialogComponent, boolean>);

  /** El workspace que abrió el gestor: crear/renombrar/borrar pertenece a ese. */
  private readonly openedIn = targetWorkspace(this.workspaces);

  readonly collections = signal<CollectionDto[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
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
      if (this.openedIn.workspaceId !== null && !this.openedIn.isCurrent()) this.dialogRef.close(this.changed);
    });
    void this.reload();
  }

  async create(): Promise<void> {
    const name = this.newName.trim();
    if (!name || this.busy()) return;
    await this.mutate(
      () => this.api.post("/api/v1/collections", { name }, decodeCollectionResponse),
      "No se pudo crear la colección",
    );
    this.newName = "";
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
    await this.mutate(
      () => this.api.patch(`/api/v1/collections/${collection.id}`, { name }, decodeCollectionMutationResponse),
      "No se pudo renombrar la colección",
    );
    await this.reload();
  }

  async remove(collection: CollectionDto): Promise<void> {
    const confirmed = await this.actions.confirm({
      title: "Borrar colección",
      message: `¿Quieres borrar «${collection.name}»? Sus ${collection.links} enlaces seguirán vivos, sin agrupar.`,
      confirmLabel: "Borrar colección",
      destructive: true,
    });
    if (!confirmed) return;
    await this.mutate(
      () => this.api.delete(`/api/v1/collections/${collection.id}`, undefined, decodeCollectionDeleteResponse),
      "No se pudo borrar la colección",
    );
    await this.reload();
  }

  close(): void {
    this.dialogRef.close(this.changed);
  }

  private async mutate<T>(run: () => Promise<T>, fallback: string): Promise<void> {
    // Comprobación síncrona antes de enviar: el interceptor pone el workspace
    // ACTUAL en la cabecera, y aquí el actual debe seguir siendo el de apertura.
    if (this.openedIn.workspaceId !== null && !this.openedIn.isCurrent()) {
      this.dialogRef.close(this.changed);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await run();
      this.changed = true;
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : fallback);
    } finally {
      this.busy.set(false);
    }
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.api.get("/api/v1/collections", undefined, decodeCollectionsResponse);
      this.collections.set(res.collections);
      this.loading.set(false);
    } catch (err) {
      this.loading.set(false);
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar las colecciones");
    }
  }
}
