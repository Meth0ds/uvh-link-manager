import { Component, DestroyRef, inject, signal, ChangeDetectionStrategy } from "@angular/core";

import { MAT_DIALOG_DATA, MatDialogModule } from "@angular/material/dialog";
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
      @if (!dataUrl() && !error()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (error()) {
        <p class="qr-error" role="alert">{{ error() }}</p>
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
      /* Dialog identity matches panel/dialog-identity.scss: framed icon mark,
         monospace eyebrow, no rounded-card chrome. */
      h2 { display: flex; align-items: center; gap: 14px; }
      h2 > span:last-child { display: flex; min-width: 0; flex-direction: column; }
      h2 small { margin-bottom: 6px; color: var(--uvh-muted); font: 10px/1.4 "Courier New", monospace; letter-spacing: .1em; text-transform: uppercase; }
      h2 b { color: var(--uvh-ink); font-size: 21px; font-weight: 800; letter-spacing: -.045em; }
      .title-icon { display: grid; width: 38px; height: 38px; flex: 0 0 38px; place-items: center; border: 1px solid var(--uvh-border); border-radius: 3px; background: var(--uvh-surface); color: var(--uvh-electric); }
      .title-icon mat-icon { width: 20px; height: 20px; font-size: 20px; }
      .qr-body { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 18px 8px; text-align: center; min-width: 260px; }
      /* The QR itself stays on white paper (scanners need the contrast) but
         as a flat plate with a hairline frame, not an elevated rounded card. */
      .qr-img { width: 240px; height: 240px; border: 1px solid var(--uvh-border); border-radius: 3px; padding: 11px; background: #fff; }
      .url { color: var(--uvh-muted); font-size: 12px; font-variant-numeric: tabular-nums; word-break: break-all; margin: 0; }
      .qr-error { border-left: 3px solid var(--uvh-danger); background: var(--uvh-danger-soft); color: var(--uvh-danger); font-size: 13px; padding: 10px 12px; margin: 24px 0 8px; text-align: left; }
    `,
  ],
})
export class QrDialogComponent {
  private readonly destroyRef = inject(DestroyRef);
  readonly url = inject<string>(MAT_DIALOG_DATA);
  readonly dataUrl = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.generate();
  }

  download(): void {
    const d = this.dataUrl();
    if (!d) return;
    try {
      const a = document.createElement("a");
      a.href = d;
      // Constrain untrusted path text before it becomes a suggested filename.
      const rawAlias = this.url.split("/").pop() || "uvh";
      const alias = rawAlias.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80) || "uvh";
      a.download = `uvh-${alias}.png`;
      a.click();
    } catch {
      this.error.set("El navegador no pudo iniciar la descarga del QR.");
    }
  }

  private async generate(): Promise<void> {
    try {
      const dataUrl = await QRCode.toDataURL(this.url, {
        width: 480,
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#262821", light: "#FFFFFF" },
      });
      if (!this.destroyRef.destroyed) this.dataUrl.set(dataUrl);
    } catch {
      if (!this.destroyRef.destroyed) this.error.set("No se pudo generar el código QR para este enlace.");
    }
  }
}
