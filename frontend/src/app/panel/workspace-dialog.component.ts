import { UI_TEXT } from "../core/localisation/template-messages";
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
    <h2 mat-dialog-title><span class="title-icon" aria-hidden="true"><mat-icon>workspaces</mat-icon></span><span><small><ng-container i18n="@@ui.d047cbb0534dca">Nuevo espacio</ng-container></small><b><ng-container i18n="@@ui.204a65194041a4">Crear workspace</ng-container></b></span></h2>
    <mat-dialog-content>
      @if (busy()) { <mat-progress-bar mode="indeterminate" aria-label="Creando workspace"  i18n-aria-label="@@ui.7854f8c35a9a48"/> }
      <p class="intro"><ng-container i18n="@@ui.2b958f9e252bb4">Dale un lugar propio a un proyecto o equipo. Sus enlaces, dominios y miembros se organizan dentro de este espacio.</ng-container></p>
      <form [formGroup]="form" (ngSubmit)="save()">
        <mat-form-field appearance="outline" class="full" subscriptSizing="dynamic">
          <mat-label><ng-container i18n="@@ui.14bccd90f6df1e">Nombre del workspace</ng-container></mat-label>
          <input matInput formControlName="name" autocomplete="organization" maxlength="80" placeholder="Por ejemplo, Estudio Norte" [readonly]="busy()"  i18n-placeholder="@@ui.c8342cbe164144"/>
          <mat-icon matPrefix>workspaces</mat-icon>
          <mat-hint><ng-container i18n="@@ui.79e3b6a33d9bb1">Un nombre que tu equipo reconozca. Entre 2 y 80 caracteres.</ng-container></mat-hint>
          @if (form.controls.name.invalid && form.controls.name.touched) { <mat-error><ng-container i18n="@@ui.cc2843c5fefe64">Escribe un nombre de al menos 2 caracteres, sin contar espacios al principio o al final.</ng-container></mat-error> }
        </mat-form-field>
        @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      </form>
      <div class="workspace-note"><mat-icon aria-hidden="true">swap_horiz</mat-icon><p><b><ng-container i18n="@@ui.dcd2000332c9b4">Sin perder de vista los demás.</ng-container></b> <ng-container i18n="@@ui.b242348515a635">Podrás cambiar de espacio desde el selector de workspace del panel.</ng-container></p></div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close><ng-container i18n="@@ui.bb9dbb406dcbd5">Cancelar</ng-container></button>
      <button mat-flat-button color="primary" type="button" (click)="save()" [disabled]="form.invalid || busy()" [attr.aria-busy]="busy()">
        <mat-icon aria-hidden="true">{{ busy() ? 'hourglass_top' : 'add' }}</mat-icon> {{ busy() ? uiText.ui_7b5825e6fdd079 : uiText.ui_204a65194041a4 }}
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./workspace-dialog.component.scss",
})
export class WorkspaceDialogComponent {
  readonly uiText = UI_TEXT;
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
        this.error.set(err instanceof ApiRequestError ? err.message : $localize`:@@ui.e1d38f0c154b02:No se pudo crear el workspace`);
      }
    } finally {
      if (this.requests.isCurrent(request, name)) this.busy.set(false);
    }
  }
}
