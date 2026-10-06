import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
export interface ConfirmDialogData { title: string; body: string; destination: string; confirmLabel: string; danger: boolean; }
@Component({
  selector: 'app-confirm-dialog', standalone: true,
  imports: [MatButtonModule, MatDialogClose, MatDialogTitle, MatDialogContent, MatDialogActions, MatIconModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content><div class="destination"><mat-icon aria-hidden="true">shield</mat-icon>{{ data.destination }}</div><p>{{ data.body }}</p><small>Esta operación se ejecuta únicamente en el entorno local.</small></mat-dialog-content>
    <mat-dialog-actions align="end"><button mat-button [mat-dialog-close]="false" cdkFocusInitial>Cancelar</button><button mat-flat-button [mat-dialog-close]="true">{{ data.confirmLabel }}</button></mat-dialog-actions>
  `,
  styles: [`:host { display: block; } .destination { display: flex; gap: 9px; align-items: center; font-size: 12px; color: var(--olive); background: var(--hero); padding: 14px; border-radius: 7px; margin-bottom: 18px; } p { font-size: 13px; line-height: 1.8; } small { color: var(--muted); font-size: 11px; }`],
})
export class ConfirmDialogComponent { readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA); }
