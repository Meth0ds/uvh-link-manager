import { Component, ChangeDetectionStrategy, DestroyRef, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators, type ValidatorFn } from "@angular/forms";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import type { Workspace } from "../core/models";
import { LatestRequest } from "../core/services/latest-request";
import { decodeCreatedWorkspaceResponse } from "../core/services/workspace-response-decoders";

export interface WorkspaceDialogResult {
  workspace: Workspace;
}

// Validate the same trimmed value that is sent to the API. Padding must not
// turn a blank or one-character name into an apparently valid workspace.
const meaningfulName: ValidatorFn = control =>
  typeof control.value === "string" && control.value.trim().length >= 2 ? null : { meaningfulName: true };

@Component({
  selector: "app-workspace-dialog",
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressBarModule,
  ],
  template: `
    <h2 mat-dialog-title><span class="title-icon" aria-hidden="true"><mat-icon>workspaces</mat-icon></span><span><small>Nuevo espacio</small><b>Crear workspace</b></span></h2>
    <mat-dialog-content>
      @if (busy()) { <mat-progress-bar mode="indeterminate" aria-label="Creando workspace" /> }
      <p class="intro">Dale un lugar propio a un proyecto o equipo. Sus enlaces, dominios y miembros se organizan dentro de este espacio.</p>
      <form [formGroup]="form" (ngSubmit)="save()">
        <mat-form-field appearance="outline" class="full" subscriptSizing="dynamic">
          <mat-label>Nombre del workspace</mat-label>
          <input matInput formControlName="name" autocomplete="organization" maxlength="80" placeholder="Por ejemplo, Estudio Norte" [readonly]="busy()" />
          <mat-icon matPrefix>workspaces</mat-icon>
          <mat-hint>Un nombre que tu equipo reconozca. Entre 2 y 80 caracteres.</mat-hint>
          @if (form.controls.name.invalid && form.controls.name.touched) { <mat-error>Escribe un nombre de al menos 2 caracteres, sin contar espacios al principio o al final.</mat-error> }
        </mat-form-field>
        @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      </form>
      <div class="workspace-note"><mat-icon aria-hidden="true">swap_horiz</mat-icon><p><b>Sin perder de vista los demás.</b> Podrás cambiar de espacio desde el selector de workspace del panel.</p></div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancelar</button>
      <button mat-flat-button color="primary" type="button" (click)="save()" [disabled]="form.invalid || busy()" [attr.aria-busy]="busy()">
        <mat-icon aria-hidden="true">{{ busy() ? 'hourglass_top' : 'add' }}</mat-icon> {{ busy() ? 'Creando…' : 'Crear workspace' }}
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./workspace-dialog.component.scss",
})
export class WorkspaceDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<WorkspaceDialogComponent, WorkspaceDialogResult | undefined>);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = this.fb.nonNullable.group({
    name: ["", [Validators.required, meaningfulName, Validators.maxLength(80)]],
  });

  async save(): Promise<void> {
    if (this.busy()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const name = this.form.controls.name.value.trim();
    const request = this.requests.begin(name);
    this.busy.set(true);
    this.error.set(null);
    try {
      const { workspace } = await this.api.post<{ workspace: Workspace }>("/api/v1/workspaces", {
        name,
      }, decodeCreatedWorkspaceResponse);
      if (!this.requests.isCurrent(request, name)) return;
      this.dialogRef.close({ workspace });
    } catch (err) {
      if (this.requests.isCurrent(request, name)) {
        this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo crear el workspace");
      }
    } finally {
      if (this.requests.isCurrent(request, name)) this.busy.set(false);
    }
  }
}
