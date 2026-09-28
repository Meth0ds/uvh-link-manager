import { signal, type WritableSignal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { MatDialogRef } from "@angular/material/dialog";
import { CsvImportDialogComponent } from "./csv-import-dialog.component";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { ImportReport } from "../../core/models";

const dryRunReport: ImportReport = {
  dryRun: true,
  valid: 2,
  created: 0,
  failed: 0,
  errors: [{ row: 3, error: "Alias inválido" }],
  truncated: false,
};

describe("CsvImportDialogComponent", () => {
  let fixture: ComponentFixture<CsvImportDialogComponent>;
  let component: CsvImportDialogComponent;
  let api: jasmine.SpyObj<ApiService>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<CsvImportDialogComponent, number>>;
  let workspaceId: WritableSignal<number | null>;

  function importKey(callIndex: number): string {
    const headers = api.post.calls.argsFor(callIndex)[3] as Record<string, string>;
    return headers["Idempotency-Key"];
  }

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    api.post.and.resolveTo(dryRunReport);
    dialogRef = jasmine.createSpyObj<MatDialogRef<CsvImportDialogComponent, number>>("MatDialogRef", ["close"]);
    workspaceId = signal(1);

    await TestBed.configureTestingModule({
      imports: [CsvImportDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ApiService, useValue: api },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: WorkspaceService, useValue: { currentId: workspaceId } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CsvImportDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it("validates with a dry run that sends no idempotency key and reports rows", async () => {
    component.csv = "alias,destination\nok,https://example.test";
    await component.validate();

    const [path, body, , headers] = api.post.calls.mostRecent().args;
    expect(path).toBe("/api/v1/links/import");
    expect(body).toEqual({ dryRun: true, csv: component.csv });
    expect(headers).toBeUndefined();
    expect(component.report()).toEqual(dryRunReport);
    expect(component.done()).toBeFalse();
  });

  it("keeps the idempotency key across an ambiguous failure and rotates it after a definitive answer", async () => {
    component.csv = "alias,destination\nok,https://example.test";

    // Sin respuesta del servidor: el reintento debe ser la MISMA intención.
    api.post.and.rejectWith(new ApiRequestError("No se pudo conectar con el servidor", 0));
    await component.import();
    const first = importKey(0);
    expect(first).toBeTruthy();
    await component.import();
    expect(importKey(1)).toBe(first);

    // El servidor respondió y negó de forma definitiva: la clave se descarta
    // con la intención y el siguiente clic es una intención nueva.
    api.post.and.rejectWith(new ApiRequestError("CSV inválido (vacío o demasiado grande)", 422));
    await component.import();
    expect(importKey(2)).toBe(first);
    api.post.and.rejectWith(new ApiRequestError("No se pudo conectar con el servidor", 0));
    await component.import();
    expect(importKey(3)).not.toBe(first);
  });

  it("repeats the exact request after a 409: same body and same key, never a new batch", async () => {
    component.csv = "alias,destination\nok,https://example.test";

    // El 409 del contrato («Reintenta con la misma clave») no puede descartar
    // la intención: hacerlo abriría un lote nuevo que re-ejecuta filas ya
    // persistidas y las reporta como «alias ya está en uso».
    api.post.and.rejectWith(new ApiRequestError("La operación ha sido retomada por otro intento. Reintenta con la misma clave.", 409));
    await component.import();

    const key = importKey(0);
    const body = api.post.calls.argsFor(0)[1];
    expect(key).toBeTruthy();
    expect(component.retryImport()).not.toBeNull();

    // El reintento real vuelve a salir idéntico: mismo cuerpo, misma clave.
    api.post.and.resolveTo({ dryRun: false, valid: 1, created: 1, failed: 0, errors: [], truncated: false });
    await component.retry();
    expect(importKey(1)).toBe(key);
    expect(api.post.calls.argsFor(1)[1]).toEqual(body);
    expect(component.done()).toBeTrue();
    expect(component.retryImport()).toBeNull();
    expect(component.report()?.failed).toBe(0);
  });

  it("drops the frozen retry when the CSV changes: that is another body, hence another intention", async () => {
    component.csv = "alias,destination\nok,https://example.test";
    api.post.and.rejectWith(new ApiRequestError("La operación ha sido retomada por otro intento. Reintenta con la misma clave.", 409));
    await component.import();
    expect(component.retryImport()).not.toBeNull();

    component.csv = "alias,destination\notra,https://example.test";
    component.onCsvInput();

    expect(component.retryImport()).toBeNull();
  });

  it("makes tags_json discoverable and warns that ';' splits names in tags", () => {
    const root = fixture.nativeElement as HTMLElement;
    const help = root.textContent ?? "";
    // La capacidad existía en el contrato pero era inalcanzable: la ayuda
    // tiene que nombrar la columna y su forma, y avisar de lo que «;» hace
    // con la columna tags (el nombre se partiría en varias etiquetas).
    expect(help).toContain("tags_json");
    expect(help).toContain("[\"prensa;2026\"]");
    expect(help).toContain("se partiría en varias etiquetas");
    // Y el ejemplo del textarea la muestra, no sólo la forma con «;».
    expect(root.querySelector("textarea")?.getAttribute("placeholder")).toContain("tags_json");
  });

  it("carries a tag name containing ';' through tags_json to the API without splitting it", async () => {
    // El export de UVH emite tags_json justamente para nombres con «;»; el
    // diálogo debe transportar la celda tal cual: el nombre viaja como UNA
    // etiqueta dentro de la lista JSON, jamás partido por el separador.
    const csv = "alias,destination,tags_json\noferta-2,https://example.org/oferta,\"[\"\"prensa;2026\"\"]\"";
    component.csv = csv;

    await component.validate();
    expect(api.post.calls.mostRecent().args[1]).toEqual({ dryRun: true, csv });

    api.post.and.resolveTo({ dryRun: false, valid: 1, created: 1, failed: 0, errors: [], truncated: false });
    await component.import();
    expect(api.post.calls.mostRecent().args[1]).toEqual({ dryRun: false, csv });
  });

  it("refuses to import into a workspace selected after the dialog opened", async () => {
    component.csv = "alias,destination\nok,https://example.test";
    // El selector global cambia con el modal abierto: la importación pertenece
    // al workspace de apertura y no debe salir NUNCA hacia el nuevo.
    workspaceId.set(2);

    await component.import();

    expect(api.post).not.toHaveBeenCalled();
    expect(dialogRef.close).toHaveBeenCalled();
  });

  it("closes itself when the workspace selection changes while it is open", async () => {
    workspaceId.set(2);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(dialogRef.close).toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("closes reporting how many links the import created", async () => {
    api.post.and.resolveTo({ dryRun: false, valid: 2, created: 2, failed: 0, errors: [], truncated: false });
    component.csv = "alias,destination\nok,https://example.test";
    await component.import();
    component.close();
    expect(dialogRef.close).toHaveBeenCalledOnceWith(2);
  });
});
