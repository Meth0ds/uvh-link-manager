import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog } from "@angular/material/dialog";
import { QrDialogComponent } from "../src/app/panel/links/qr-dialog.component";

/** Design-only fixture: no real account, HTTP API or persisted logo. */
@Component({
  standalone: true,
  imports: [MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<main style="padding: 32px"><h1>QR · Vista de diseño</h1><p>Enlace ficticio. Las imágenes se procesan localmente.</p><button mat-flat-button (click)="open()">Personalizar QR</button></main>`,
})
export class QrPreviewComponent {
  private readonly dialog = inject(MatDialog);
  open(): void {
    this.dialog.open(QrDialogComponent, { data: "https://uvh.es/tu-proximo-paso", width: "760px", maxWidth: "calc(100vw - 32px)" });
  }
}
