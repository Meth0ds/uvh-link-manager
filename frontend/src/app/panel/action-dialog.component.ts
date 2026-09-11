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
      <span class="title-mark" [class.danger]="data.destructive" aria-hidden="true"><mat-icon>{{ data.destructive ? 'warning' : 'help_outline' }}</mat-icon></span>
      <span><small>{{ data.destructive ? 'Confirmación sensible' : 'Confirmación' }}</small><b>{{ data.title }}</b></span>
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
        [class.destructive-confirm]="data.destructive"
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
  styleUrl: "./dialog-identity.scss",
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
