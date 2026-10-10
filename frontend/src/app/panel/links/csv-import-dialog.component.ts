import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { targetWorkspace } from "../../core/services/workspace-target";
import { SessionContextService } from "../../core/services/session-context.service";
import { LatestRequest } from "../../core/services/latest-request";
import { csvFileCanFit, csvTextWithinLimit, MAX_CSV_IMPORT_BYTES } from "../../core/csv-import-limits";
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
      <textarea id="csv-content" class="csv-input" [(ngModel)]="csv" (ngModelChange)="onCsvInput()" aria-label="Contenido CSV" aria-describedby="csv-content-hint" [readonly]="busy() || done()" [attr.maxlength]="maxCsvCharacters"
        placeholder="alias,destination,tags_json&#10;oferta-1,https://example.org/oferta,&quot;[&quot;&quot;prensa;2026&quot;&quot;]&quot;&#10;oferta-2,https://example.org/novedades,&quot;[&quot;&quot;editorial&quot;&quot;]&quot;"
      ></textarea>
      <p class="note" id="csv-content-hint">Una cabecera y un enlace por fila. Alias y destino son obligatorios. Máximo 256 KiB.</p>
      <details class="csv-help"><summary>Formato, columnas y etiquetas</summary>
        <p>Las columnas obligatorias son <code>alias</code> y <code>destination</code>. También se admiten <code>fallback_destination</code>, <code>notes</code>, <code>scheduled_at</code>, <code>expires_at</code>, <code>max_clicks</code> y <code>single_use</code>.</p>
        <p><code>tags_json</code> contiene una lista JSON de nombres: <code>["prensa;2026"]</code> es una sola etiqueta. Es el formato del export y del ejemplo anterior.</p>
        <p>La alternativa <code>tags</code> separa nombres por <b>;</b>: un nombre que lo contenga se partiría en varias etiquetas. Las dos columnas no se pueden usar a la vez en el mismo archivo. Cada fila se comprueba con las mismas reglas que un enlace manual.</p>
      </details>
      @if (reading()) { <p class="csv-status" role="status">Leyendo el archivo…</p> }
      @if (busy()) { <p class="csv-status" role="status">{{ importing() ? 'Importando enlaces…' : 'Comprobando el CSV…' }}</p> }
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
      <button mat-button type="button" (click)="close()" [disabled]="importing()">{{ done() ? "Cerrar" : "Cancelar" }}</button>
      @if (!done()) {
        <button mat-stroked-button type="button" (click)="validate()" [disabled]="busy() || reading() || !csv.trim() || retryImport() !== null"><mat-icon aria-hidden="true">fact_check</mat-icon> Comprobar archivo</button>
        <button mat-flat-button type="button" (click)="import()" [disabled]="busy() || reading() || !csv.trim() || !report()?.dryRun || !report()?.valid || retryImport() !== null"><mat-icon aria-hidden="true">upload</mat-icon> {{ report()?.dryRun && report()?.valid ? 'Importar ' + report()!.valid + (report()!.valid === 1 ? ' enlace' : ' enlaces') : 'Importar enlaces' }}</button>
      }
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ["../dialog-identity.scss", "../scale-dialog.scss"],
})
export class CsvImportDialogComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly workspaces = inject(WorkspaceService);
  private readonly session = inject(SessionContextService);
  private readonly dialogRef = inject(MatDialogRef<CsvImportDialogComponent, number>);
  /** El workspace que abrió el diálogo: la importación pertenece a ese, no al que la cabecera seleccione después. */
  private readonly openedIn = targetWorkspace(this.workspaces);
  private readonly openedContext = this.context();
  private readonly fileRead = new LatestRequest(this.destroyRef);
  private closed = false;

  csv = "";
  readonly busy = signal(false);
  readonly reading = signal(false);
  readonly importing = signal(false);
  readonly maxCsvCharacters = MAX_CSV_IMPORT_BYTES;
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
      if (this.context() !== this.openedContext) this.closeNow();
    });
    this.destroyRef.onDestroy(() => { this.closed = true; });
  }

  async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.busy() || this.done() || !this.stillInOpenedWorkspace()) return;
    input.value = ""; // Selecting the same file again must fire change after a read failure.
    const read = this.fileRead.begin(this.context());
    this.reading.set(false);
    this.report.set(null);
    this.error.set(null);
    this.retryImport.set(null);
    if (!csvFileCanFit(file.size)) {
      this.error.set("El CSV supera el máximo de 256 KiB. Divide el archivo antes de importarlo.");
      return;
    }
    this.reading.set(true);
    const current = () => !this.closed && this.fileRead.isCurrent(read, this.context());
    try {
      const text = await file.text();
      if (!current()) return;
      if (!csvTextWithinLimit(text)) {
        this.error.set("El CSV supera el máximo de 256 KiB. Divide el archivo antes de importarlo.");
        return;
      }
      this.csv = text;
    } catch {
      if (current()) this.error.set("No se pudo leer el archivo. Vuelve a elegirlo o pega su contenido.");
    } finally {
      if (current()) this.reading.set(false);
    }
  }

  /** El texto cambió: el informe y el reintento congelado ya no describen lo que hay delante. */
  onCsvInput(): void {
    if (this.busy() || this.done() || this.closed) return;
    this.fileRead.invalidate();
    this.reading.set(false);
    this.report.set(null);
    this.retryImport.set(null);
    this.error.set(null);
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
    if (this.busy() || this.reading() || this.done() || pending === null) return;
    if (!this.stillInOpenedWorkspace()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.sendImport(pending.body, pending.key, this.context());
    } finally {
      this.busy.set(false);
    }
  }

  close(): void {
    if (this.importing()) return;
    this.closeNow();
  }

  private closeNow(): void {
    if (this.closed) return;
    this.closed = true;
    this.fileRead.invalidate();
    this.reading.set(false);
    this.dialogRef.close(this.created);
  }

  private context(): string {
    return JSON.stringify([this.session.generation(), this.session.user()?.id ?? null,
      this.workspaces.currentId(), this.workspaces.selectionGeneration(), this.workspaces.currentRole()]);
  }

  private owns(context: string): boolean {
    return !this.closed && context === this.context();
  }

  /**
   * Comprobación síncrona antes de enviar: el interceptor pone el workspace
   * ACTUAL en la cabecera, y aquí el actual debe seguir siendo el de apertura.
   */
  private stillInOpenedWorkspace(): boolean {
    if (this.closed) return false;
    if (!this.openedIn.isCurrent() || this.context() !== this.openedContext) {
      this.closeNow();
      return false;
    }
    return true;
  }

  private async send(dryRun: boolean): Promise<void> {
    if (this.busy() || this.reading() || this.done()) return;
    if (!this.stillInOpenedWorkspace()) return;
    if (!csvTextWithinLimit(this.csv)) {
      this.report.set(null);
      this.error.set("El CSV supera el máximo de 256 KiB. Divide el contenido antes de importarlo.");
      return;
    }
    if (!this.csv.trim()) return;
    const context = this.context();
    this.busy.set(true);
    this.error.set(null);
    if (!dryRun) {
      const body = { dryRun: false as const, csv: this.csv };
      const signature = this.csv;
      const key = this.lastImport?.signature === signature ? this.lastImport.key : crypto.randomUUID();
      this.lastImport = { signature, key };
      try {
        await this.sendImport(body, key, context);
      } finally {
        this.busy.set(false);
      }
      return;
    }
    try {
      const report = await this.api.post("/api/v1/links/import", { dryRun: true, csv: this.csv }, decodeImportReport);
      if (this.owns(context)) this.report.set(report);
    } catch (err) {
      if (this.owns(context)) this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo validar el CSV");
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
  private async sendImport(body: { dryRun: false; csv: string }, key: string, context: string): Promise<void> {
    const disabled = this.dialogRef.disableClose;
    this.dialogRef.disableClose = true;
    this.importing.set(true);
    try {
      const report = await this.api.post("/api/v1/links/import", body, decodeImportReport, { "Idempotency-Key": key });
      if (!this.owns(context)) return;
      this.lastImport = null;
      this.retryImport.set(null);
      this.report.set(report);
      this.created = report.created;
      this.done.set(true);
    } catch (err) {
      if (!this.owns(context)) return;
      if (err instanceof ApiRequestError && err.status === 409) {
        this.retryImport.set({ body, key });
      } else if (err instanceof ApiRequestError && err.status > 0 && err.status < 500) {
        this.lastImport = null;
        this.retryImport.set(null);
      }
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo importar el CSV");
    } finally {
      this.dialogRef.disableClose = disabled;
      this.importing.set(false);
    }
  }
}
