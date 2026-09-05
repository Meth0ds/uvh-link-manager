import { Component, inject, signal, ChangeDetectionStrategy } from "@angular/core";

import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import QRCode from "qrcode";

@Component({
  selector: "app-qr-dialog",
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title><span class="title-icon"><mat-icon>qr_code_2</mat-icon></span><span><small>Formato visual</small><b>QR del enlace</b></span></h2>
    <mat-dialog-content class="qr-body">
      @if (!dataUrl()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (dataUrl()) {
        <img [src]="dataUrl()" alt="Código QR de {{ url }}" class="qr-img" />
      }
      <p class="url tnum">{{ url }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="download()" [disabled]="!dataUrl()">
        <mat-icon>download</mat-icon> Descargar PNG
      </button>
      <button mat-flat-button color="primary" mat-dialog-close>Cerrar</button>
    </mat-dialog-actions>
    `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      h2 { display: flex; align-items: center; gap: 11px; }
      h2 > span:last-child { display: flex; flex-direction: column; }
      h2 small { color: var(--uvh-muted-soft); font-size: 8.5px; font-weight: 850; letter-spacing: .12em; text-transform: uppercase; }
      h2 b { color: var(--uvh-ink); font-size: 19px; font-weight: 850; letter-spacing: -.035em; }
      .title-icon { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 11px; background: color-mix(in srgb, var(--uvh-electric) 10%, transparent); color: var(--uvh-electric); }
      .title-icon mat-icon { width: 20px; height: 20px; font-size: 20px; }
      .qr-body { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 18px 8px; text-align: center; min-width: 260px; }
      .qr-img { width: 240px; height: 240px; border: 1px solid var(--uvh-border); border-radius: 16px; padding: 11px; background: #fff; box-shadow: var(--uvh-shadow-sm); }
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
