import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";

export interface ActionDialogData {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  inputLabel?: string;
  inputPlaceholder?: string;
  inputHint?: string;
  inputRequired?: boolean;
  inputMinLength?: number;
  inputMaxLength?: number;
}

export type ActionDialogResult = true | string | null;

@Component({
  selector: "app-action-dialog",
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>
      @if (data.destructive) { <mat-icon class="title-icon danger" aria-hidden="true">warning</mat-icon> }
      {{ data.title }}
    </h2>
    <mat-dialog-content>
      <p class="message">{{ data.message }}</p>
      @if (data.inputLabel) {
        <form (ngSubmit)="submit()" class="input-form">
          <mat-form-field appearance="outline" class="full">
            <mat-label>{{ data.inputLabel }}</mat-label>
            <input
              matInput
              [placeholder]="data.inputPlaceholder ?? ''"
              [maxlength]="data.inputMaxLength ?? null"
              [required]="data.inputRequired === true"
              [(ngModel)]="value"
              name="actionValue"
              autocomplete="off"
            />
            @if (data.inputHint) { <mat-hint>{{ data.inputHint }}</mat-hint> }
          </mat-form-field>
          @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
        </form>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="close()">Cancelar</button>
      <button
        mat-flat-button
        [color]="data.destructive ? 'warn' : 'primary'"
        type="button"
        (click)="submit()"
        [disabled]="data.inputRequired && !validInput()"
      >
        @if (data.destructive) { <mat-icon aria-hidden="true">delete_outline</mat-icon> }
        {{ data.confirmLabel }}
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; min-width: min(420px, 86vw); }
    h2 { display: flex; align-items: center; gap: 9px; letter-spacing: -.025em; }
    .title-icon { width: 21px; height: 21px; font-size: 21px; }
    .title-icon.danger { color: var(--uvh-danger); }
    .message { margin: 0 0 16px; color: var(--uvh-muted); font-size: 14px; line-height: 1.6; }
    .input-form { display: block; }
    .full { width: 100%; }
    .error { margin-top: -4px; color: var(--uvh-danger); font-size: 12px; }
  `],
})
export class ActionDialogComponent {
  readonly data = inject<ActionDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<ActionDialogComponent, ActionDialogResult>);
  value = "";
  readonly error = signal<string | null>(null);

  validInput(): boolean {
    const value = this.value.trim();
    return value.length >= (this.data.inputMinLength ?? 0)
      && value.length <= (this.data.inputMaxLength ?? Number.MAX_SAFE_INTEGER);
  }

  submit(): void {
    if (this.data.inputLabel) {
      if (this.data.inputRequired && !this.validInput()) {
        this.error.set(`Introduce al menos ${this.data.inputMinLength ?? 1} caracteres.`);
        return;
      }
      this.dialogRef.close(this.value.trim());
      return;
    }
    this.dialogRef.close(true);
  }

  close(): void {
    this.dialogRef.close(null);
  }
}
