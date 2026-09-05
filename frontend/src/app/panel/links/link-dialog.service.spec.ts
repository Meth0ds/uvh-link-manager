import { TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { firstValueFrom, of } from "rxjs";
import type { LinkDto } from "../../core/models";
import { LinkDialogService } from "./link-dialog.service";

describe("LinkDialogService", () => {
  const link = { id: 42, alias: "operativa" } as LinkDto;
  let dialog: jasmine.SpyObj<MatDialog>;
  let service: LinkDialogService;

  beforeEach(() => {
    dialog = jasmine.createSpyObj<MatDialog>("MatDialog", ["open"]);
    TestBed.configureTestingModule({
      providers: [LinkDialogService, { provide: MatDialog, useValue: dialog }],
    });
    service = TestBed.inject(LinkDialogService);
  });

  it("returns the created link itself so consumers can navigate with its id", async () => {
    dialog.open.and.returnValue({ afterClosed: () => of(link) } as never);

    const result = await firstValueFrom(service.openCreate("https://example.com"));

    expect(result).toBe(link);
    expect(result?.id).toBe(42);
  });

  it("normalizes a cancelled dialog to null", async () => {
    dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);

    await expectAsync(firstValueFrom(service.openCreate())).toBeResolvedTo(null);
  });
});
