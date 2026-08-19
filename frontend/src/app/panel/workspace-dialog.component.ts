import { Component, ChangeDetectionStrategy, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import type { Workspace } from "../core/models";

export interface WorkspaceDialogResult {
  workspace: Workspace;
}

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
    <h2 mat-dialog-title>Crear workspace</h2>
    <mat-dialog-content>
      @if (busy()) { <mat-progress-bar mode="indeterminate" /> }
      <p class="intro">Crea un espacio separado para organizar enlaces, dominios y miembros.</p>
      <form [formGroup]="form" (ngSubmit)="save()">
        <mat-form-field appearance="outline" class="full">
          <mat-label>Nombre del workspace</mat-label>
          <input matInput formControlName="name" autocomplete="organization" maxlength="80" />
          <mat-icon matPrefix>workspaces</mat-icon>
          <mat-hint>Entre 2 y 80 caracteres.</mat-hint>
        </mat-form-field>
        @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancelar</button>
      <button mat-flat-button color="primary" type="button" (click)="save()" [disabled]="form.invalid || busy()">
        <mat-icon>add</mat-icon> Crear workspace
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; min-width: min(420px, 82vw); }
    .intro { color: var(--uvh-muted); font-size: 13.5px; line-height: 1.55; margin: 4px 0 18px; }
    .full { width: 100%; }
    .error { margin-top: 8px; padding: 10px 12px; border-radius: 10px; background: var(--uvh-danger-soft); color: var(--uvh-danger); font-size: 13px; }
  `],
})
export class WorkspaceDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<WorkspaceDialogComponent, WorkspaceDialogResult | undefined>);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = this.fb.nonNullable.group({
    name: ["", [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
  });

  async save(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const { workspace } = await this.api.post<{ workspace: Workspace }>("/api/v1/workspaces", {
        name: this.form.controls.name.value.trim(),
      });
      this.dialogRef.close({ workspace });
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo crear el workspace");
    } finally {
      this.busy.set(false);
    }
  }
}
