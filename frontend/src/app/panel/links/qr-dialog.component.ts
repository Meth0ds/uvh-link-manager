import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import QRCode from "qrcode";

@Component({
  selector: "app-qr-dialog",
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title>QR del enlace</h2>
    <mat-dialog-content class="qr-body">
      <mat-progress-bar mode="indeterminate" *ngIf="!dataUrl()" />
      <img *ngIf="dataUrl()" [src]="dataUrl()" alt="Código QR de {{ url }}" class="qr-img" />
      <p class="url tnum">{{ url }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="download()" [disabled]="!dataUrl()">
        <mat-icon>download</mat-icon> Descargar PNG
      </button>
      <button mat-flat-button color="primary" mat-dialog-close>Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .qr-body { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 12px 8px; text-align: center; min-width: 260px; }
      .qr-img { width: 240px; height: 240px; border: 1px solid var(--uvh-border); border-radius: 14px; padding: 10px; background: #fff; }
      .url { color: var(--uvh-muted); font-size: 13px; word-break: break-all; margin: 0; }
    `,
  ],
})
export class QrDialogComponent {
  private dialogRef = inject(MatDialogRef<QrDialogComponent>);
  readonly url = inject<string>(MAT_DIALOG_DATA);
  readonly dataUrl = signal<string | null>(null);

  constructor() {
    void QRCode.toDataURL(this.url, {
      width: 480,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#07111F", light: "#FFFFFF" },
    }).then((d) => this.dataUrl.set(d));
  }

  download(): void {
    const d = this.dataUrl();
    if (!d) return;
    const a = document.createElement("a");
    a.href = d;
    const alias = this.url.split("/").pop() ?? "uvh";
    a.download = `uvh-${alias}.png`;
    a.click();
  }
}
