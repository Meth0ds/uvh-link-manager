import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, convertToParamMap, provideRouter } from "@angular/router";
import { MatSnackBar } from "@angular/material/snack-bar";
import { of } from "rxjs";
import { ApiService } from "../core/services/api.service";
import { SessionContextService } from "../core/services/session-context.service";
import { WorkspaceService } from "../core/services/workspace.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import type { Workspace } from "../core/models";
import { LinksComponent } from "./links/links.component";
import { AnalyticsComponent } from "./analytics/analytics.component";

function deferredBlob() {
  let resolve!: (blob: Blob) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Blob>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

for (const screen of ["links", "analytics"] as const) {
  describe(`${screen} export read context`, () => {
    let api: jasmine.SpyObj<ApiService>;
    let stored: string | null;
    beforeEach(async () => {
      stored = localStorage.getItem("uvh.workspaceId");
      localStorage.removeItem("uvh.workspaceId");
      api = jasmine.createSpyObj<ApiService>("api", ["get", "getBlob", "post", "delete"]);
      api.get.and.callFake(((path: string) => Promise.resolve(path.endsWith("domains") ? { domains: [] }
        : path.includes("analytics") ? { totals: { clicks: 0, visitors: 0 }, series: [] }
        : { links: [], total: 0, page: 1, perPage: 20 })) as typeof api.get);
      await TestBed.configureTestingModule({
        imports: [LinksComponent, AnalyticsComponent],
        providers: [
          provideRouter([]), WorkspaceService,
          { provide: ApiService, useValue: api },
          { provide: MatSnackBar, useValue: jasmine.createSpyObj("snack", ["open"]) },
          { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) }, queryParamMap: of(convertToParamMap({})) } },
          { provide: PendingLinkIntentService, useValue: { pending: signal(null) } },
        ],
      }).overrideComponent(LinksComponent, { set: { template: "", imports: [] } })
        .overrideComponent(AnalyticsComponent, { set: { template: "", imports: [] } }).compileComponents();
      TestBed.inject(WorkspaceService).setList([{ id: 1, name: "A", role: "owner" }, { id: 2, name: "B", role: "owner" }] as Workspace[]);
    });
    afterEach(() => {
      TestBed.resetTestingModule();
      if (stored === null) localStorage.removeItem("uvh.workspaceId");
      else localStorage.setItem("uvh.workspaceId", stored);
    });

    for (const transition of ["selection", "session"] as const) {
      for (const outcome of ["response", "error"] as const) {
        it(`cancels an old ${transition} download and ignores its late ${outcome} while the new export is pending`, async () => {
          const fixture = screen === "links" ? TestBed.createComponent(LinksComponent) : TestBed.createComponent(AnalyticsComponent);
          fixture.detectChanges();
          await fixture.whenStable();
          const component = fixture.componentInstance;
          const run = () => component instanceof LinksComponent ? component.exportCsv() : component.export("csv");
          const old = deferredBlob();
          const current = deferredBlob();
          api.getBlob.and.returnValues(old.promise, current.promise);
          const download = spyOn(URL, "createObjectURL");
          const first = run();
          const signal = api.getBlob.calls.argsFor(0)[2]?.signal;
          expect(signal instanceof AbortSignal).toBeTrue();
          if (transition === "selection") {
            const workspaces = TestBed.inject(WorkspaceService);
            workspaces.select(2);
            workspaces.select(1);
          } else TestBed.inject(SessionContextService).advance();
          fixture.detectChanges();
          expect(signal?.aborted).toBeTrue();
          const second = run();
          expect(component.exporting()).toBeTrue();
          if (outcome === "response") old.resolve(new Blob(["private old result"]));
          else old.reject(new Error("old error"));
          await first;
          expect(component.exporting()).toBeTrue();
          expect(download).not.toHaveBeenCalled();
          expect(TestBed.inject(MatSnackBar).open).not.toHaveBeenCalled();
          expect(api.getBlob.calls.argsFor(1)[2]?.signal?.aborted).toBeFalse();
          current.reject(new Error("current failure"));
          await second;
          expect(component.exporting()).toBeFalse();
          expect(TestBed.inject(MatSnackBar).open).toHaveBeenCalledTimes(1);
        });
      }
    }
  });
}
