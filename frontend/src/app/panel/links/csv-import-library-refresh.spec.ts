import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { ActivatedRoute, convertToParamMap, provideRouter } from "@angular/router";
import { MatDialog } from "@angular/material/dialog";
import { of, Subject } from "rxjs";
import { LinksComponent } from "./links.component";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { PendingLinkIntentService } from "../../core/services/pending-link-intent.service";
import type { Workspace } from "../../core/models";

describe("CSV import library refresh", () => {
  let fixture: ComponentFixture<LinksComponent>;
  let workspaces: WorkspaceService;
  let closed: Subject<unknown>;
  let reload: jasmine.Spy;
  let stored: string | null;
  const drain = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  beforeEach(async () => {
    stored = localStorage.getItem("uvh.workspaceId"); localStorage.removeItem("uvh.workspaceId");
    const api = jasmine.createSpyObj<ApiService>("API", ["get", "post", "delete", "getBlob"]);
    api.get.and.resolveTo({ links: [], domains: [], collections: [], total: 0, page: 1, perPage: 20 });
    closed = new Subject<unknown>();
    await TestBed.configureTestingModule({ imports: [LinksComponent], providers: [
      provideRouter([]), WorkspaceService,
      { provide: ApiService, useValue: api },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => closed }) } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) }, queryParamMap: of(convertToParamMap({})) } },
      { provide: PendingLinkIntentService, useValue: { pending: signal(null) } },
    ] }).overrideComponent(LinksComponent, { set: { template: "", imports: [] } }).compileComponents();
    workspaces = TestBed.inject(WorkspaceService);
    workspaces.setList([{ id: 1, role: "owner" }, { id: 2, role: "owner" }] as Workspace[]);
    fixture = TestBed.createComponent(LinksComponent); fixture.detectChanges(); await drain();
    reload = spyOn(fixture.componentInstance, "reload").and.resolveTo();
  });
  afterEach(() => {
    fixture.destroy(); closed.complete();
    if (stored === null) localStorage.removeItem("uvh.workspaceId"); else localStorage.setItem("uvh.workspaceId", stored);
  });

  for (const result of [2, undefined]) {
    it(`refreshes after ${result === undefined ? "an external close with unknown result" : "a confirmed import"}`, () => {
      fixture.componentInstance.importCsv();
      closed.next(result);
      expect(reload).toHaveBeenCalledTimes(1);
    });
  }
  it("avoids an extra reload after an explicit cancellation without creations", () => {
    fixture.componentInstance.importCsv(); closed.next(0);
    expect(reload).not.toHaveBeenCalled();
  });
  it("does not start a new read after the library view is destroyed", () => {
    fixture.componentInstance.importCsv(); fixture.destroy(); closed.next(3);
    expect(reload).not.toHaveBeenCalled();
  });
  it("does not apply a close notification to a returned workspace generation", () => {
    fixture.componentInstance.importCsv();
    workspaces.select(2); workspaces.select(1);
    closed.next(3);
    expect(reload).not.toHaveBeenCalled();
  });
});
