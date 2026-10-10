import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { MatDialogRef } from "@angular/material/dialog";
import { CsvImportDialogComponent } from "./csv-import-dialog.component";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";

describe("CSV check and confirm flow", () => {
  let fixture: ComponentFixture<CsvImportDialogComponent>;
  let api: jasmine.SpyObj<ApiService>;
  const csv = 'alias,destination,tags_json\neditorial,https://example.invalid,"[""prensa;2026""]"';
  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    api.post.and.resolveTo({ dryRun: true, valid: 1, created: 0, failed: 0, errors: [], truncated: false });
    await TestBed.configureTestingModule({ imports: [CsvImportDialogComponent], providers: [
      { provide: ApiService, useValue: api },
      { provide: WorkspaceService, useValue: { currentId: signal(1), selectionGeneration: () => 0, currentRole: () => "owner" } },
      { provide: MatDialogRef, useValue: { close: jasmine.createSpy("close") } },
    ] }).compileComponents();
    fixture = TestBed.createComponent(CsvImportDialogComponent); fixture.detectChanges(); await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector("textarea")!;
    input.value = csv; input.dispatchEvent(new Event("input"));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());
  function button(prefix: string): HTMLButtonElement {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll("button"))
      .find(element => element.querySelector(".mdc-button__label")?.textContent?.trim().startsWith(prefix))!;
  }
  async function click(prefix: string): Promise<void> {
    button(prefix).click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  }
  it("requires a check before the import control can write", async () => {
    expect(button("Importar").disabled).toBeTrue();
    await click("Comprobar");
    expect(api.post.calls.mostRecent().args[1]).toEqual({ dryRun: true, csv });
    expect(button("Importar").disabled).toBeFalse();
    expect(button("Importar").textContent).toContain("1 enlace");
  });
  it("invalidates the prior check when the text is edited", async () => {
    await click("Comprobar");
    expect(button("Importar").disabled).toBeFalse();
    const input = (fixture.nativeElement as HTMLElement).querySelector("textarea")!;
    input.value = csv + "\n"; input.dispatchEvent(new Event("input")); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(button("Importar").disabled).toBeTrue();
    expect(fixture.componentInstance.report()).toBeNull();
  });
  it("does not offer an import when no rows can be imported", async () => {
    api.post.and.resolveTo({ dryRun: true, valid: 0, created: 0, failed: 0, errors: [{ row: 2, error: "Alias inválido" }], truncated: false });
    await click("Comprobar");
    expect(button("Importar").disabled).toBeTrue();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain("Alias inválido");
  });
  it("retries a conflict through the UI using the original body and idempotency key", async () => {
    await click("Comprobar");
    api.post.and.rejectWith(new ApiRequestError("Reintenta con la misma clave", 409));
    await click("Importar");
    const original = api.post.calls.mostRecent().args;
    expect(button("Importar").disabled).toBeTrue();
    expect(button("Comprobar").disabled).toBeTrue();
    api.post.and.resolveTo({ dryRun: false, valid: 1, created: 1, failed: 0, errors: [], truncated: false });
    await click("Reintentar");
    const retry = api.post.calls.mostRecent().args;
    expect(retry[1]).toEqual(original[1]); expect(retry[3]).toEqual(original[3]);
    expect(fixture.componentInstance.done()).toBeTrue();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain("Importación completada");
  });
});
