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

    // El servidor respondió y negó: la clave se descarta con la intención.
    api.post.and.rejectWith(new ApiRequestError("Este alias ya está en uso", 409));
    await component.import();
    expect(importKey(2)).toBe(first);
    api.post.and.resolveTo({ dryRun: false, valid: 1, created: 1, errors: [], truncated: false });
    await component.import();
    expect(importKey(3)).not.toBe(first);
    expect(component.done()).toBeTrue();
    expect(component.report()?.created).toBe(1);
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
    api.post.and.resolveTo({ dryRun: false, valid: 2, created: 2, errors: [], truncated: false });
    component.csv = "alias,destination\nok,https://example.test";
    await component.import();
    component.close();
    expect(dialogRef.close).toHaveBeenCalledOnceWith(2);
  });
});
