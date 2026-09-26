import { ChangeDetectionStrategy, Component, effect, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { targetWorkspace } from "../../core/services/workspace-target";
import { decodeImportReport } from "../../core/services/scale-response-decoders";
import type { ImportReport } from "../../core/models";

/**
 * Importación CSV de enlaces (F7b).
 *
 * El camino es siempre el mismo: validar primero (dry run, que no escribe
 * nada) y decidir después con el informe de errores por fila delante. La
 * importación real viaja con una `Idempotency-Key` por intención: si la red se
 * cae sin respuesta, el reintento reproduce el resultado de la primera en vez
 * de crear los enlaces dos veces.
 */
@Component({
  selector: "app-csv-import-dialog",
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>
      <span class="title-mark" aria-hidden="true"><mat-icon>upload</mat-icon></span>
      <span><small>Biblioteca</small><b>Importar enlaces desde CSV</b></span>
    </h2>
    <mat-dialog-content>
      <p class="message">
        Las columnas obligatorias son <b>alias</b> y <b>destination</b>; también se admiten
        fallback_destination, notes, tags (separadas por <b>;</b>), scheduled_at, expires_at,
        max_clicks y single_use. Cada fila se valida con las mismas reglas que un enlace manual.
      </p>
      <textarea
        class="csv-input"
        [(ngModel)]="csv"
        (ngModelChange)="report.set(null)"
        aria-label="Contenido CSV"
        placeholder="alias,destination,tags&#10;oferta-1,https://example.org/oferta,prensa;2026"
      ></textarea>
      <div class="inline-form">
        <button mat-stroked-button type="button" (click)="pick.click()">
          <mat-icon>attach_file</mat-icon> Cargar archivo
        </button>
        <input #pick type="file" accept=".csv,text/csv" hidden (change)="onFile($event)" />
      </div>

      @if (report(); as current) {
        <div class="report" [class.ok]="!current.errors.length">
          @if (current.dryRun) {
            <b>Dry run: nada escrito todavía.</b>
            <span>{{ current.valid }} filas válidas listas para importar.</span>
          } @else {
            <b>Importación completada.</b>
            <span>{{ current.created }} enlaces creados de {{ current.valid }} filas válidas.</span>
          }
          @if (current.errors.length) {
            <ul class="row-errors">
              @for (row of current.errors; track row.row) {
                <li><b>Fila {{ row.row }}:</b> {{ row.error }}</li>
              }
            </ul>
            @if (current.truncated) {
              <p class="note">Hay más errores de los que se muestran: corrige estos y vuelve a validar.</p>
            }
          }
        </div>
      }
      @if (error()) {
        <div class="error" role="alert">{{ error() }}</div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="close()">{{ done() ? "Cerrar" : "Cancelar" }}</button>
      @if (!done()) {
        <button mat-stroked-button type="button" (click)="validate()" [disabled]="busy() || !csv.trim()">
          <mat-icon>fact_check</mat-icon> Validar
        </button>
        <button mat-flat-button color="primary" type="button" (click)="import()" [disabled]="busy() || !csv.trim()">
          <mat-icon>upload</mat-icon> Importar
        </button>
      }
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ["../dialog-identity.scss", "../scale-dialog.scss"],
})
export class CsvImportDialogComponent {
  private readonly api = inject(ApiService);
  private readonly workspaces = inject(WorkspaceService);
  private readonly dialogRef = inject(MatDialogRef<CsvImportDialogComponent, number>);
  /** El workspace que abrió el diálogo: la importación pertenece a ese, no al que la cabecera seleccione después. */
  private readonly openedIn = targetWorkspace(this.workspaces);

  csv = "";
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly report = signal<ImportReport | null>(null);
  readonly done = signal(false);
  private created = 0;
  /** Misma política que la barra masiva: la clave sobrevive a fallos sin respuesta. */
  private lastImport: { signature: string; key: string } | null = null;

  constructor() {
    // El selector global sigue usable con el modal abierto: si cambia, el
    // diálogo se cierra en vez de importar en un workspace que no pidió nada.
    effect(() => {
      if (this.openedIn.workspaceId !== null && !this.openedIn.isCurrent()) this.dialogRef.close(this.created);
    });
  }

  async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.csv = await file.text();
    this.report.set(null);
    this.error.set(null);
  }

  async validate(): Promise<void> {
    await this.send(true);
  }

  async import(): Promise<void> {
    await this.send(false);
  }

  close(): void {
    this.dialogRef.close(this.created);
  }

  private async send(dryRun: boolean): Promise<void> {
    if (this.busy() || !this.csv.trim()) return;
    // Comprobación síncrona antes de enviar: el interceptor pone el workspace
    // ACTUAL en la cabecera, y aquí el actual debe seguir siendo el de apertura.
    if (this.openedIn.workspaceId !== null && !this.openedIn.isCurrent()) {
      this.dialogRef.close(this.created);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    if (!dryRun) {
      const signature = this.csv;
      const key = this.lastImport?.signature === signature ? this.lastImport.key : crypto.randomUUID();
      this.lastImport = { signature, key };
      try {
        const report = await this.api.post("/api/v1/links/import", { dryRun: false, csv: this.csv }, decodeImportReport, {
          "Idempotency-Key": key,
        });
        this.lastImport = null;
        this.report.set(report);
        this.created = report.created;
        this.done.set(true);
      } catch (err) {
        if (err instanceof ApiRequestError && err.status > 0 && err.status < 500) this.lastImport = null;
        this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo importar el CSV");
      } finally {
        this.busy.set(false);
      }
      return;
    }
    try {
      this.report.set(await this.api.post("/api/v1/links/import", { dryRun: true, csv: this.csv }, decodeImportReport));
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo validar el CSV");
    } finally {
      this.busy.set(false);
    }
  }
}
