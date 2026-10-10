import { TestBed } from "@angular/core/testing";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { provideRouter } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { CsvImportDialogComponent } from "./csv-import-dialog.component";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { ImportReport, Workspace } from "../../core/models";

describe("CSV import with a real Material dialog", () => {
  let api: jasmine.SpyObj<ApiService>;
  let dialog: MatDialog;
  let stored: string | null;
  const drain = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  beforeEach(async () => {
    stored = localStorage.getItem("uvh.workspaceId"); localStorage.removeItem("uvh.workspaceId");
    api = jasmine.createSpyObj<ApiService>("API", ["post"]);
    await TestBed.configureTestingModule({ imports: [MatDialogModule], providers: [
      provideRouter([]), WorkspaceService, { provide: ApiService, useValue: api },
    ] }).compileComponents();
    TestBed.inject(WorkspaceService).setList([{ id: 1, role: "owner" }] as Workspace[]);
    dialog = TestBed.inject(MatDialog);
  });
  afterEach(async () => {
    dialog.closeAll(); await drain(); TestBed.resetTestingModule();
    if (stored === null) localStorage.removeItem("uvh.workspaceId"); else localStorage.setItem("uvh.workspaceId", stored);
  });

  it("holds backdrop and Escape during the write, then closes with the actual created count", async () => {
    let resolve!: (report: ImportReport) => void;
    api.post.and.returnValue(new Promise<ImportReport>(done => { resolve = done; }));
    const ref = dialog.open(CsvImportDialogComponent);
    await firstValueFrom(ref.afterOpened()); TestBed.tick(); await drain();
    const component = ref.componentInstance;
    component.csv = "alias,destination\nuno,https://example.test";
    const writing = component.import();
    const closing = firstValueFrom(ref.afterClosed());
    const pane = document.querySelector(".cdk-overlay-pane")!;
    pane.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
    (document.querySelector(".cdk-overlay-backdrop") as HTMLElement).click();
    await drain();
    expect(dialog.openDialogs).toContain(ref);
    resolve({ dryRun: false, valid: 2, created: 2, failed: 0, errors: [], truncated: false });
    await writing;
    component.close();
    await expectAsync(closing).toBeResolvedTo(2);
    expect(dialog.openDialogs).not.toContain(ref);
  });
});
