import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { MatDialogRef } from "@angular/material/dialog";
import { CsvImportDialogComponent } from "./csv-import-dialog.component";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { ImportReport } from "../../core/models";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const csv = "alias,destination\nuno,https://example.test";
const preview: ImportReport = { dryRun: true, valid: 1, created: 0, failed: 0, errors: [], truncated: false };
const imported: ImportReport = { ...preview, dryRun: false, created: 1 };

describe("CSV file and response ownership", () => {
  let fixture: ComponentFixture<CsvImportDialogComponent>;
  let component: CsvImportDialogComponent;
  let api: jasmine.SpyObj<ApiService>;
  let dialog: jasmine.SpyObj<MatDialogRef<CsvImportDialogComponent, number>>;
  let session: SessionContextService;
  const id = signal<number | null>(1);
  const generation = signal(0);
  const role = signal("owner");

  function file(text: Promise<string>, size = 128) {
    return { size, text: jasmine.createSpy("File.text").and.returnValue(text) };
  }

  function event(value: ReturnType<typeof file> | File): Event {
    return { target: { files: [value], value: "selected.csv" } } as unknown as Event;
  }

  beforeEach(async () => {
    id.set(1); generation.set(0); role.set("owner");
    api = jasmine.createSpyObj<ApiService>("API", ["post"]);
    api.post.and.resolveTo(preview);
    dialog = jasmine.createSpyObj<MatDialogRef<CsvImportDialogComponent, number>>("Dialog", ["close"]);
    dialog.disableClose = false;
    await TestBed.configureTestingModule({ imports: [CsvImportDialogComponent], providers: [
      { provide: ApiService, useValue: api },
      { provide: WorkspaceService, useValue: { currentId: id, selectionGeneration: generation, currentRole: role } },
      { provide: MatDialogRef, useValue: dialog },
    ] }).compileComponents();
    session = TestBed.inject(SessionContextService);
    fixture = TestBed.createComponent(CsvImportDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  it("does not read a 1 GiB file or send it to the server", async () => {
    const oversized = file(Promise.resolve("unused"), 1024 ** 3);
    await component.onFile(event(oversized));
    expect(oversized.text).not.toHaveBeenCalled();
    expect(component.csv).toBe("");
    expect(component.error()).toContain("256");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("permits native UTF-8 BOM stripping at the exact payload limit", async () => {
    const payload = "a".repeat(262_144);
    const native = new File([new Uint8Array([239, 187, 191]), payload], "bom.csv");
    expect(native.size).toBe(262_147);
    await component.onFile(event(native));
    expect(component.csv).toBe(payload);
    expect(component.error()).toBeNull();
  });

  it("rejects a file one byte beyond the conservative preflight without reading it", async () => {
    const oversized = file(Promise.resolve(csv), 262_148);
    await component.onFile(event(oversized));
    expect(oversized.text).not.toHaveBeenCalled();
    expect(component.error()).toContain("256");
  });

  it("checks decoded UTF-8 size even when raw file size passes preflight", async () => {
    await component.onFile(event(file(Promise.resolve("é".repeat(131_073)), 262_146)));
    expect(component.csv).toBe("");
    expect(component.error()).toContain("256");
  });

  it("never lets slow file A overwrite the more recent file B", async () => {
    const a = deferred<string>(), b = deferred<string>();
    const first = component.onFile(event(file(a.promise)));
    const second = component.onFile(event(file(b.promise)));
    b.resolve(csv); await second;
    await component.validate();
    a.resolve("obsolete"); await first;
    expect(component.csv).toBe(csv);
    expect(component.report()).toEqual(preview);
  });

  it("shows a current read failure and keeps the existing text editable", async () => {
    component.csv = csv;
    const read = deferred<string>();
    const pending = component.onFile(event(file(read.promise)));
    read.reject(new Error("private filesystem details"));
    await pending;
    expect(component.csv).toBe(csv);
    expect(component.error()).toContain("leer");
    expect(component.error()).not.toContain("private filesystem");
    await component.validate();
    expect(component.report()).toEqual(preview);
  });

  it("discards a stale read error without clearing the current report", async () => {
    const a = deferred<string>();
    const pending = component.onFile(event(file(a.promise)));
    await component.onFile(event(file(Promise.resolve(csv))));
    await component.validate();
    a.reject(new Error("obsolete")); await pending;
    expect(component.error()).toBeNull();
    expect(component.report()).toEqual(preview);
  });

  it("preserves pasted text when an earlier file finishes", async () => {
    const read = deferred<string>();
    const pending = component.onFile(event(file(read.promise)));
    component.csv = csv;
    component.onCsvInput();
    read.resolve("obsolete"); await pending;
    expect(component.csv).toBe(csv);
    await component.validate();
    expect(api.post.calls.mostRecent().args[1]).toEqual({ dryRun: true, csv });
  });

  for (const ending of ["close", "destroy"] as const) {
    it(`discards a file read after ${ending}`, async () => {
      const read = deferred<string>();
      const pending = component.onFile(event(file(read.promise)));
      if (ending === "close") component.close(); else fixture.destroy();
      read.resolve(csv); await pending;
      expect(component.csv).toBe("");
      expect(component.report()).toBeNull();
    });
  }

  for (const change of ["workspace", "ABA", "session", "role"] as const) {
    it(`discards a file if ${change} changes before the read returns`, async () => {
      const read = deferred<string>();
      const pending = component.onFile(event(file(read.promise)));
      if (change === "workspace") id.set(2);
      if (change === "ABA") { id.set(2); generation.update(value => value + 1); id.set(1); generation.update(value => value + 1); }
      if (change === "session") session.advance();
      if (change === "role") role.set("viewer");
      read.resolve(csv); await pending;
      expect(component.csv).toBe("");
      expect(component.report()).toBeNull();
    });
  }

  it("invalidates pending A even when replacement B is too large", async () => {
    const read = deferred<string>();
    const pending = component.onFile(event(file(read.promise)));
    const oversized = file(Promise.resolve("unused"), 1024 ** 3);
    await component.onFile(event(oversized));
    read.resolve(csv); await pending;
    expect(component.csv).toBe("");
    expect(component.error()).toContain("256");
    expect(oversized.text).not.toHaveBeenCalled();
  });

  it("blocks check/import while a file is being read and leaves replacement/editing usable", async () => {
    component.csv = csv;
    component.report.set(preview);
    const read = deferred<string>();
    const pending = component.onFile(event(file(read.promise)));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(root.querySelectorAll("button"));
    expect(buttons.find(button => button.textContent?.includes("Comprobar"))?.disabled).toBeTrue();
    expect(buttons.find(button => button.textContent?.includes("Importar enlaces"))?.disabled).toBeTrue();
    expect(buttons.find(button => button.textContent?.includes("Elegir archivo"))?.disabled).toBeFalse();
    expect(root.querySelector("textarea")?.readOnly).toBeFalse();
    await component.validate(); await component.import();
    expect(api.post).not.toHaveBeenCalled();
    read.resolve(csv); await pending;
  });

  it("does not let a file selection clear an in-flight import or its eventual frozen retry", async () => {
    component.csv = csv;
    const response = deferred<ImportReport>(); api.post.and.returnValue(response.promise);
    const pending = component.import();
    const unwanted = file(Promise.resolve("different"));
    await component.onFile(event(unwanted));
    expect(unwanted.text).not.toHaveBeenCalled();
    response.reject(new ApiRequestError("Reintenta con la misma clave", 409)); await pending;
    expect(component.retryImport()?.body.csv).toBe(csv);
  });

  it("keeps close/backdrop/Escape disabled during a real import and returns its actual count afterward", async () => {
    component.csv = csv;
    const response = deferred<ImportReport>(); api.post.and.returnValue(response.promise);
    const pending = component.import();
    expect(dialog.disableClose).toBeTrue();
    component.close();
    expect(dialog.close).not.toHaveBeenCalled();
    response.resolve(imported); await pending;
    expect(dialog.disableClose).toBeFalse();
    component.close();
    expect(dialog.close).toHaveBeenCalledOnceWith(1);
  });

  it("restores an existing close policy instead of forcibly enabling close", async () => {
    dialog.disableClose = true; component.csv = csv;
    api.post.and.resolveTo(imported);
    await component.import();
    expect(dialog.disableClose).toBeTrue();
  });

  it("allows closing a dry run and discards its late report", async () => {
    component.csv = csv;
    const response = deferred<ImportReport>(); api.post.and.returnValue(response.promise);
    const pending = component.validate();
    component.close();
    expect(dialog.close).toHaveBeenCalledOnceWith(0);
    response.resolve(preview); await pending;
    expect(component.report()).toBeNull();
  });

  it("does not publish an import response in a changed workspace", async () => {
    component.csv = csv;
    const response = deferred<ImportReport>(); api.post.and.returnValue(response.promise);
    const pending = component.import();
    id.set(2); fixture.detectChanges();
    response.resolve(imported); await pending;
    expect(component.report()).toBeNull();
    expect(component.done()).toBeFalse();
    expect(dialog.close).toHaveBeenCalledOnceWith(0);
  });

  it("does not publish an old error after the session generation changes", async () => {
    component.csv = csv;
    const response = deferred<ImportReport>(); api.post.and.returnValue(response.promise);
    const pending = component.validate();
    session.advance();
    response.reject(new ApiRequestError("obsolete error", 422)); await pending;
    expect(component.error()).toBeNull();
  });

  it("rejects oversized pasted UTF-8 before either preview or import POST", async () => {
    component.csv = "€".repeat(87_382);
    await component.validate(); await component.import();
    expect(api.post).not.toHaveBeenCalled();
    expect(component.error()).toContain("256");
  });

  it("refuses a mutation when the dialog opened without a workspace", async () => {
    fixture.destroy(); id.set(null);
    fixture = TestBed.createComponent(CsvImportDialogComponent); component = fixture.componentInstance;
    component.csv = csv;
    await component.import();
    expect(api.post).not.toHaveBeenCalled();
    expect(dialog.close).toHaveBeenCalled();
  });
});
