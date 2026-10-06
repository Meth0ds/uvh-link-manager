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
 * de crear los enlaces dos veces. Un `409` tampoco descarta la intención —pide
 * repetir el mismo cuerpo con la misma clave (docs/api.md)—, así que clave y
 * cuerpo quedan congelados hasta que el reintento real se ejecuta.
 */
@Component({
  selector: "app-csv-import-dialog",
  host: { class: "csv-dialog" },
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>
      <span class="title-mark" aria-hidden="true"><mat-icon>upload</mat-icon></span>
      <span><small>Biblioteca</small><b>Importar enlaces desde CSV</b></span>
    </h2>
    <mat-dialog-content class="csv-content">
      <p class="message">Trae varios enlaces a tu biblioteca. Primero comprobaremos el contenido; después podrás confirmar la importación.</p>
      <div class="csv-start">
        <button mat-stroked-button type="button" (click)="pick.click()" [disabled]="busy() || done()"><mat-icon aria-hidden="true">attach_file</mat-icon> Elegir archivo CSV</button>
        <span>También puedes pegar su contenido debajo.</span>
        <input #pick type="file" accept=".csv,text/csv" hidden (change)="onFile($event)" />
      </div>
      <label class="csv-label" for="csv-content">Contenido del archivo</label>
      <textarea id="csv-content" class="csv-input" [(ngModel)]="csv" (ngModelChange)="onCsvInput()" aria-label="Contenido CSV" aria-describedby="csv-content-hint" [readonly]="busy() || done()"
        placeholder="alias,destination,tags_json&#10;oferta-1,https://example.org/oferta,&quot;[&quot;&quot;prensa;2026&quot;&quot;]&quot;&#10;oferta-2,https://example.org/novedades,&quot;[&quot;&quot;editorial&quot;&quot;]&quot;"
      ></textarea>
      <p class="note" id="csv-content-hint">Una cabecera y un enlace por fila. Alias y destino son obligatorios.</p>
      <details class="csv-help"><summary>Formato, columnas y etiquetas</summary>
        <p>Las columnas obligatorias son <code>alias</code> y <code>destination</code>. También se admiten <code>fallback_destination</code>, <code>notes</code>, <code>scheduled_at</code>, <code>expires_at</code>, <code>max_clicks</code> y <code>single_use</code>.</p>
        <p><code>tags_json</code> contiene una lista JSON de nombres: <code>["prensa;2026"]</code> es una sola etiqueta. Es el formato del export y del ejemplo anterior.</p>
        <p>La alternativa <code>tags</code> separa nombres por <b>;</b>: un nombre que lo contenga se partiría en varias etiquetas. Las dos columnas no se pueden usar a la vez en el mismo archivo. Cada fila se comprueba con las mismas reglas que un enlace manual.</p>
      </details>
      @if (busy()) { <p class="csv-status" role="status">Procesando el archivo…</p> }
      @if (report(); as current) {
        <div class="report csv-report" role="status" [class.ok]="!current.errors.length">
          @if (current.dryRun) {
            <b>Comprobación terminada. Todavía no se ha importado ningún enlace.</b>
            <span>{{ current.valid }} filas importables con el estado actual del workspace. La comprobación no reserva alias ni cuota.</span>
          } @else {
            <b>Importación completada.</b>
            <span>
              {{ current.created }} enlaces creados de {{ current.valid }} filas válidas.
              @if (current.failed > 0) {
                <b>{{ current.failed }} filas</b> no se pudieron crear.
              }
            </span>
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
        <div class="error" role="alert">
          <span>{{ error() }}</span>
          @if (retryImport()) {
            <button mat-stroked-button type="button" (click)="retry()" [disabled]="busy()">
              <mat-icon>replay</mat-icon> Reintentar
            </button>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="close()">{{ done() ? "Cerrar" : "Cancelar" }}</button>
      @if (!done()) {
        <button mat-stroked-button type="button" (click)="validate()" [disabled]="busy() || !csv.trim() || retryImport() !== null"><mat-icon aria-hidden="true">fact_check</mat-icon> Comprobar archivo</button>
        <button mat-flat-button type="button" (click)="import()" [disabled]="busy() || !csv.trim() || !report()?.dryRun || !report()?.valid || retryImport() !== null"><mat-icon aria-hidden="true">upload</mat-icon> {{ report()?.dryRun && report()?.valid ? 'Importar ' + report()!.valid + (report()!.valid === 1 ? ' enlace' : ' enlaces') : 'Importar enlaces' }}</button>
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
  /**
   * Reintento congelado tras un `409`: el contrato (docs/api.md) pide repetir
   * el MISMO cuerpo con la MISMA clave, así que ambos quedan aquí tal cual
   * salieron. Cambiar el CSV es otra intención y lo descarta.
   */
  readonly retryImport = signal<{ body: { dryRun: false; csv: string }; key: string } | null>(null);

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
    this.retryImport.set(null);
  }

  /** El texto cambió: el informe y el reintento congelado ya no describen lo que hay delante. */
  onCsvInput(): void {
    this.report.set(null);
    this.retryImport.set(null);
  }

  async validate(): Promise<void> {
    await this.send(true);
  }

  async import(): Promise<void> {
    await this.send(false);
  }

  /** Repite la importación desplazada por un `409`: mismo cuerpo y misma clave. */
  async retry(): Promise<void> {
    const pending = this.retryImport();
    if (this.busy() || pending === null) return;
    if (!this.stillInOpenedWorkspace()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.sendImport(pending.body, pending.key);
    } finally {
      this.busy.set(false);
    }
  }

  close(): void {
    this.dialogRef.close(this.created);
  }

  /**
   * Comprobación síncrona antes de enviar: el interceptor pone el workspace
   * ACTUAL en la cabecera, y aquí el actual debe seguir siendo el de apertura.
   */
  private stillInOpenedWorkspace(): boolean {
    if (this.openedIn.workspaceId !== null && !this.openedIn.isCurrent()) {
      this.dialogRef.close(this.created);
      return false;
    }
    return true;
  }

  private async send(dryRun: boolean): Promise<void> {
    if (this.busy() || !this.csv.trim()) return;
    if (!this.stillInOpenedWorkspace()) return;
    this.busy.set(true);
    this.error.set(null);
    if (!dryRun) {
      const body = { dryRun: false as const, csv: this.csv };
      const signature = this.csv;
      const key = this.lastImport?.signature === signature ? this.lastImport.key : crypto.randomUUID();
      this.lastImport = { signature, key };
      try {
        await this.sendImport(body, key);
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

  /**
   * Envía la importación real y decide qué hacer con la intención según la
   * respuesta. Un `409` no cierra nada: pide repetir el mismo cuerpo con la
   * misma clave, y ambos se congelan para el reintento real. Cualquier otra
   * respuesta del servidor es definitiva y descarta la clave; sin respuesta
   * (red o 5xx) también se conserva, para que el reintento reproduzca en vez
   * de abrir un lote nuevo que re-ejecutaría filas ya persistidas.
   */
  private async sendImport(body: { dryRun: false; csv: string }, key: string): Promise<void> {
    try {
      const report = await this.api.post("/api/v1/links/import", body, decodeImportReport, { "Idempotency-Key": key });
      this.lastImport = null;
      this.retryImport.set(null);
      this.report.set(report);
      this.created = report.created;
      this.done.set(true);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        this.retryImport.set({ body, key });
      } else if (err instanceof ApiRequestError && err.status > 0 && err.status < 500) {
        this.lastImport = null;
        this.retryImport.set(null);
      }
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo importar el CSV");
    }
  }
}
